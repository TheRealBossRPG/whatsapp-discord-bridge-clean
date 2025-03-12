// modules/discordCommands.js - FIXED VERSION
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const path = require("path");
const fs = require("fs");
const qrcode = require("qrcode");
const bridgeInstanceManager = require("./BridgeInstanceManager");
const specialChannelCommands = require("../specialChannelCommands");
const { handleChannelSelect } = require("../interactionHandler");
let discordClientRef = null;

// Setup slash commands
async function registerCommands(client) {
  discordClientRef = client;

  let commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Set up a WhatsApp connection for this server")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Check the status of the WhatsApp connection")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("disconnect")
      .setDescription("Disconnect the WhatsApp connection")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Show WhatsApp bridge help and commands"),

    new SlashCommandBuilder()
      .setName("edit-messages")
      .setDescription("Edit WhatsApp bot messages and toggle features")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName("set-special-channel")
      .setDescription("Set a channel to show a custom message when mentioned")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("The channel to set as special")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("The message to show when this channel is mentioned")
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      new SlashCommandBuilder()
      .setName("add")
      .setDescription("Add a new WhatsApp connection")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

      new SlashCommandBuilder()
      .setName("manage")
      .setDescription("Manage existing WhatsApp connections")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];

  commands = specialChannelCommands.registerSpecialChannelCommands(commands);

  try {
    console.log("Started refreshing application (/) commands.");
    await client.application.commands.set(commands);
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error registering slash commands:", error);
  }
}

async function updateChannelSetting(guildId, type, channelId) {
  try {
    console.log(
      `Updating ${type} channel for guild ${guildId} to ${channelId}`
    );

    // Try both instance ID formats
    let instanceId = guildId;

    // Find the right instance
    const instance = bridgeInstanceManager.getInstanceByGuildId(guildId);
    if (instance) {
      instanceId = instance.instanceId || guildId;

      // IMPORTANT FIX: Update the instance directly for immediate effect
      if (type === "transcript") {
        instance.transcriptChannelId = channelId;
        if (instance.transcriptManager) {
          instance.transcriptManager.setTranscriptChannelId(channelId);
          instance.transcriptManager.localOnly = false; // Enable Discord sending
        }
      } else if (type === "vouch") {
        instance.vouchChannelId = channelId;
      }

      // CRITICAL FIX: Update customSettings to ensure persistence
      if (!instance.customSettings) {
        instance.customSettings = {};
      }

      // Save the setting in the proper format
      const settingsKey =
        type === "transcript" ? "transcriptChannelId" : "vouchChannelId";
      instance.customSettings[settingsKey] = channelId;

      // Also update feature flags
      if (type === "transcript") {
        instance.customSettings.transcriptsEnabled = true;
      } else if (type === "vouch") {
        instance.customSettings.vouchEnabled = true;
      }

      // Save to disk using all available methods for redundancy
      if (typeof instance.saveSettingsToDisk === "function") {
        const settings = {
          [settingsKey]: channelId,
          [type === "transcript" ? "transcriptsEnabled" : "vouchEnabled"]: true,
        };
        await instance.saveSettingsToDisk(settings);
      }
    }

    // Also ensure it's in the bridge configs
    if (bridgeInstanceManager.configs) {
      if (bridgeInstanceManager.configs[instanceId]) {
        if (type === "transcript") {
          bridgeInstanceManager.configs[instanceId].transcriptChannelId =
            channelId;
        } else if (type === "vouch") {
          bridgeInstanceManager.configs[instanceId].vouchChannelId = channelId;
        }
        bridgeInstanceManager.saveConfigurations();
      }
    }

    return true;
  } catch (error) {
    console.error(`Error updating ${type} channel:`, error);
    return false;
  }
}

async function handleChannelChange(interaction, type) {
  try {
    await interaction.deferUpdate();

    // Get all text channels in the guild
    const textChannels = interaction.guild.channels.cache.filter(
      (c) => c.type === ChannelType.GuildText
    );

    if (textChannels.size === 0) {
      await interaction.followUp({
        content: "❌ No text channels found in this server.",
        ephemeral: true,
      });
      return;
    }

    // Organize channels by category
    const channelsByCategory = {};
    const uncategorizedChannels = [];

    textChannels.forEach((channel) => {
      // Check if channel has appropriate permissions
      const botMember = interaction.guild.members.me;
      const permissions = channel.permissionsFor(botMember);

      // Skip channels where the bot can't view or send messages
      if (!permissions.has("ViewChannel") || !permissions.has("SendMessages")) {
        return;
      }

      if (channel.parentId) {
        const categoryName =
          interaction.guild.channels.cache.get(channel.parentId)?.name ||
          "Unknown Category";
        if (!channelsByCategory[categoryName]) {
          channelsByCategory[categoryName] = [];
        }
        channelsByCategory[categoryName].push(channel);
      } else {
        uncategorizedChannels.push(channel);
      }
    });

    // Create organized options for dropdown
    let channelOptions = [];

    // Add categorized channels
    Object.entries(channelsByCategory).forEach(([categoryName, channels]) => {
      channels.forEach((channel) => {
        channelOptions.push({
          label: channel.name,
          value: channel.id,
          description: `#${channel.name} (${categoryName})`,
        });
      });
    });

    // Add uncategorized channels
    uncategorizedChannels.forEach((channel) => {
      channelOptions.push({
        label: channel.name,
        value: channel.id,
        description: `#${channel.name} (No Category)`,
      });
    });

    // Ensure we don't exceed Discord's limit
    channelOptions = channelOptions.slice(0, 25);

    // Add a cancel button
    const actionRows = [];

    // Only add the select menu if we have channels
    if (channelOptions.length > 0) {
      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${type}_channel_select`)
          .setPlaceholder(
            `Select a channel for ${
              type === "transcript" ? "transcripts" : "vouches"
            }`
          )
          .addOptions(channelOptions)
      );
      actionRows.push(selectRow);
    }

    // Always add a cancel button
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("cancel_channel_select")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );
    actionRows.push(buttonRow);

    // Send the select menu
    if (channelOptions.length > 0) {
      await interaction.editReply({
        content: `Select a channel to use for ${
          type === "transcript" ? "ticket transcripts" : "vouches"
        }:`,
        components: actionRows,
      });
    } else {
      await interaction.editReply({
        content: `❌ No suitable channels found. Please make sure the bot has ViewChannel and SendMessages permissions in at least one text channel.`,
        components: [buttonRow],
      });
    }
  } catch (error) {
    console.error(`Error showing ${type} channel select:`, error);
    await interaction.followUp({
      content: `❌ Error: ${error.message}`,
      ephemeral: true,
    });
  }
}

/**
 * Handle feature toggle button click
 * @param {Interaction} interaction - Discord interaction
 * @param {string} feature - Feature to toggle ('transcripts', 'vouches', or 'closing_messages')
 */
async function handleToggleFeature(interaction, feature) {
  try {
    await interaction.deferUpdate();

    // Get instance
    const instance = bridgeInstanceManager.getInstanceByGuildId(
      interaction.guild.id
    );
    if (!instance) {
      await interaction.followUp({
        content: "❌ Error: Couldn't find WhatsApp bridge configuration.",
        ephemeral: true,
      });
      return;
    }

    // Map feature to settings key
    const settingKey =
      feature === "transcripts"
        ? "transcriptsEnabled"
        : feature === "vouches"
        ? "vouchEnabled"
        : "sendClosingMessage";

    // Determine current state and toggle it
    const currentEnabled = instance.customSettings?.[settingKey] !== false;
    const newEnabled = !currentEnabled;

    // Update settings directly
    // 1. Instance settings
    if (instance.customSettings) {
      instance.customSettings[settingKey] = newEnabled;
    }

    // 2. Update components based on feature
    if (feature === "transcripts" && instance.transcriptManager) {
      instance.transcriptManager.isDisabled = !newEnabled;
    } else if (feature === "vouches" && instance.vouchHandler) {
      instance.vouchHandler.isDisabled = !newEnabled;
    }

    // 3. Save to disk
    try {
      const settingsToSave = { [settingKey]: newEnabled };
      await bridgeInstanceManager.saveInstanceSettings(
        instance.instanceId || interaction.guild.id,
        settingsToSave
      );
    } catch (saveError) {
      console.error(`Error saving ${feature} setting:`, saveError);

      // Backup direct save
      try {
        const settingsPath = path.join(
          __dirname,
          "..",
          "instances",
          instance.instanceId || interaction.guild.id,
          "settings.json"
        );
        let settings = {};

        if (fs.existsSync(settingsPath)) {
          settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        }

        settings[settingKey] = newEnabled;
        fs.writeFileSync(
          settingsPath,
          JSON.stringify(settings, null, 2),
          "utf8"
        );
        console.log(`Direct settings save to ${settingsPath}`);
      } catch (directSaveError) {
        console.error("Error in direct settings save:", directSaveError);
      }
    }

    // Get message and current components
    const message = await interaction.fetchReply();
    const components = [...message.components];

    // Find the feature row
    const featureRowIndex = components.findIndex((row) =>
      row.components.some(
        (component) =>
          component.customId === "toggle_transcripts" ||
          component.customId === "toggle_vouches" ||
          component.customId === "toggle_closing_messages"
      )
    );

    if (featureRowIndex !== -1) {
      // Recreate the row with updated button
      const updatedRow = new ActionRowBuilder();

      // Add each component from the original row
      for (const component of components[featureRowIndex].components) {
        if (component.customId === `toggle_${feature}`) {
          // Replace this button with updated state
          updatedRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`toggle_${feature}`)
              .setLabel(
                `${
                  feature === "transcripts"
                    ? "Transcripts"
                    : feature === "vouches"
                    ? "Vouches"
                    : "Closing Messages"
                }: ${newEnabled ? "Enabled" : "Disabled"}`
              )
              .setStyle(
                newEnabled ? ButtonStyle.Success : ButtonStyle.Secondary
              )
          );
        } else {
          // Copy the other buttons as they are
          updatedRow.addComponents(
            new ButtonBuilder()
              .setCustomId(component.customId)
              .setLabel(component.label)
              .setStyle(component.style)
          );
        }
      }

      // Replace the row in the components array
      components[featureRowIndex] = updatedRow;

      // Update the message with new components
      await interaction.editReply({ components });

      // Notify success
      await interaction.followUp({
        content: `✅ ${
          feature === "transcripts"
            ? "Transcripts"
            : feature === "vouches"
            ? "Vouches"
            : "Closing messages"
        } ${newEnabled ? "enabled" : "disabled"} successfully.`,
        ephemeral: true,
      });
    } else {
      // Couldn't find the feature row - just update settings
      await interaction.editReply({
        content: `Settings updated. ${
          feature === "transcripts"
            ? "Transcripts"
            : feature === "vouches"
            ? "Vouches"
            : "Closing messages"
        }: ${newEnabled ? "Enabled" : "Disabled"}`,
        components: [],
      });
    }
  } catch (error) {
    console.error(`Error toggling ${feature}:`, error);
    await safeReply(interaction, `❌ Error: ${error.message}`, true);
  }
}

async function handleSetSpecialChannelCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    
    if (channel.type !== ChannelType.GuildText) {
      await interaction.editReply("You can only set text channels as special channels.");
      return;
    }
    
    // Get the instance
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guild.id);
    if (!instance) {
      await interaction.editReply("No WhatsApp connection found for this server!");
      return;
    }
    
    // Initialize specialChannels if needed
    if (!instance.customSettings) {
      instance.customSettings = {};
    }
    if (!instance.customSettings.specialChannels) {
      instance.customSettings.specialChannels = {};
    }
    
    // Add the special channel
    instance.customSettings.specialChannels[channel.id] = {
      message: message
    };
    
    // Save settings
    await bridgeInstanceManager.saveInstanceSettings(instance.instanceId, instance.customSettings);
    
    await interaction.editReply(`✅ <#${channel.id}> is now set as a special channel! When mentioned, it will show:\n\n${message}`);
    
  } catch (error) {
    console.error("Error setting special channel:", error);
    await interaction.editReply(`Error setting special channel: ${error.message}`);
  }
}

// Handle command interactions
async function handleCommand(interaction) {
  if (
    !interaction.isCommand() &&
    !interaction.isButton() &&
    !interaction.isStringSelectMenu()
  )
    return;

  try {
    // Check if it's a button first
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // Handle refresh QR code button
      if (customId === "refresh_qr") {
        await handleQRRefresh(interaction);
        return;
      }

      // Handle reconnect button from status
      if (customId === "reconnect_status") {
        await interaction.deferUpdate();
        await interaction.editReply({
          content:
            "🔄 Attempting to reconnect WhatsApp using saved credentials...",
          embeds: [],
          components: [],
        });

        try {
          // Get instance
          const instance = bridgeInstanceManager.getInstanceByGuildId(
            interaction.guild.id
          );
          if (!instance) {
            await interaction.editReply(
              "❌ No WhatsApp configuration found. Please use `/setup` to configure."
            );
            return;
          }

          // Try to reconnect
          const connected = await instance.connect();

          if (connected) {
            await interaction.editReply(
              "✅ Successfully reconnected to WhatsApp!"
            );
          } else {
            // Check if auth exists
            const authExists = fs.existsSync(
              path.join(
                __dirname,
                "..",
                "instances",
                instance.instanceId,
                "baileys_auth",
                "creds.json"
              )
            );

            if (authExists) {
              await interaction.editReply(
                "⚠️ Connection attempt failed with existing credentials. Try using `/setup` and selecting 'Reconnect'."
              );
            } else {
              await interaction.editReply(
                "❌ No existing credentials found. Please use `/setup` to create a new connection."
              );
            }
          }
        } catch (error) {
          console.error("Error reconnecting:", error);
          await interaction.editReply(
            `❌ Error reconnecting: ${error.message}`
          );
        }
        return;
      }

      // Handle confirmation buttons
      if (customId === "confirm_disconnect") {
        await disconnectServer(interaction);
        return;
      }

      if (customId === "cancel_disconnect") {
        await interaction.update({
          content: "Disconnection cancelled.",
          components: [],
        });
        return;
      }

      if(customId === "set_special_channel"){
        await handleSetSpecialChannelCommand(interaction);
        return;
      }

      // Custom message button during setup
      if (customId === "customize_messages") {
        // Just defer the update and show the modal - no further messages yet
        await handleCustomizationFlow(interaction);
        return;
      }

      if (customId === "continue_default") {
        await interaction.update({
          content: "Continuing with default messages.\n\nGenerating QR code...",
          components: [],
        });
        return;
      }

      // Setup button
      if (customId === "continue_setup") {
        await handleContinueSetupButton(interaction);
        return;
      }

      // Channel change buttons
      if (customId === "change_transcript_channel") {
        await handleChannelChange(interaction, "transcript");
        return;
      }

      if (customId === "change_vouch_channel") {
        await handleChannelChange(interaction, "vouch");
        return;
      }

      // Toggle feature buttons
      if (customId === "toggle_transcripts") {
        await handleToggleFeature(interaction, "transcripts");
        return;
      }

      if (customId === "toggle_vouches") {
        await handleToggleFeature(interaction, "vouches");
        return;
      }

      if (customId === "toggle_closing_messages") {
        await handleToggleFeature(interaction, "closing_messages");
        return;
      }

      // Unknown button
      return;
    }

    // Handle select menus
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "transcript_channel_select") {
        await handleChannelSelect(interaction, "transcript");
        return;
      }

      if (interaction.customId === "vouch_channel_select") {
        await handleChannelSelect(interaction, "vouch");
        return;
      }

      if (interaction.customId === "category_select") {
        // This is handled elsewhere, but included for completeness
        return;
      }
    }

    // It's a slash command
    const { commandName } = interaction;

    switch (commandName) {
      case "setup":
        await handleSetupCommand(interaction);
        break;
      case "status":
        await handleStatusCommand(interaction);
        break;
      case "disconnect":
        await handleDisconnectCommand(interaction);
        break;
      case "help":
        await handleHelpCommand(interaction);
        break;
      case "edit-messages":
        await handleEditMessagesCommand(interaction);
        break;
      case "add-special-channel":
        await specialChannelCommands.handleAddSpecialChannel(interaction);
        break;
      case "manage-special-channels":
        await specialChannelCommands.handleManageSpecialChannels(interaction);
        break;
    }
  } catch (error) {
    console.error(`Error handling command:`, error);

    // Try to send error message if interaction hasn't been replied to yet
    try {
      const message = `❌ Error executing command: ${error.message}`;
      if (interaction.deferred) {
        await interaction.editReply({ content: message, ephemeral: true });
      } else if (!interaction.replied) {
        await interaction.reply({ content: message, ephemeral: true });
      }
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}

async function handleContinueSetupButton(interaction) {
  try {
    const guildId = interaction.guild.id;

    // Get setup info from storage
    const setupParams = global.setupStorage.getSetupParams(guildId);

    if (!setupParams || !setupParams.categoryId) {
      console.error(`Setup parameters not found for guild ${guildId}`);
      await interaction.update({
        content: "❌ Error: Setup information not found. Please run /setup again.",
        components: [],
      });
      return;
    }

    // Update the button message
    await interaction.update({
      content: `Continuing with setup and generating QR code...`,
      components: [],
    });

    // Check multiple sources for custom settings:
    // 1. First check if there are custom settings in the setupParams
    // 2. Then check the global variable
    // 3. Fall back to defaults if neither exists
    let customSettings = setupParams.customSettings || global.lastCustomSettings || {
      welcomeMessage: "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
      introMessage: "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
      reopenTicketMessage: "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
      newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
      closingMessage: "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
      vouchMessage: "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.",
      vouchSuccessMessage: "✅ Thank you for your vouch! It has been posted to our community channel.",
      sendClosingMessage: true,
      transcriptsEnabled: !!setupParams.transcriptChannelId,
      vouchEnabled: !!setupParams.vouchChannelId,
    };

    // Log which source we're using for customSettings
    if (setupParams.customSettings) {
      console.log(`Using custom settings from setupParams for guild ${guildId}`);
    } else if (global.lastCustomSettings) {
      console.log(`Using custom settings from global.lastCustomSettings for guild ${guildId}`);
    } else {
      console.log(`Using default settings for guild ${guildId}`);
    }

    // Clear the global variable
    global.lastCustomSettings = null;

    // Generate QR code with this configuration
    const qrCode = await bridgeInstanceManager.generateQRCode({
      guildId,
      categoryId: setupParams.categoryId,
      transcriptChannelId: setupParams.transcriptChannelId,
      vouchChannelId: setupParams.vouchChannelId,
      customSettings,
      discordClient: discordClientRef || interaction.client,
    });

    if (qrCode === null) {
      await interaction.editReply({
        content: "✅ WhatsApp is already connected for this server!",
        components: [],
      });

      // Clean up setup params
      global.setupStorage.cleanupSetupParams(guildId);
      return;
    }

    if (qrCode === "TIMEOUT") {
      await interaction.editReply({
        content: "⚠️ QR code generation timed out. Please try again later.",
        components: [],
      });

      // Clean up setup params
      global.setupStorage.cleanupSetupParams(guildId);
      return;
    }

    // Display the QR code
    await displayQRCode(interaction, qrCode, guildId);

    // Clean up setup params after successful QR code display
    global.setupStorage.cleanupSetupParams(guildId);
  } catch (error) {
    console.error("Error handling continue setup button:", error);
    try {
      await interaction.editReply({
        content: `❌ Error continuing setup: ${error.message}`,
      });
    } catch (followupError) {
      console.error("Error sending error message:", followupError);
    }
  }
}

async function handleCustomizeMessagesModalSubmission(interaction) {
  try {
    console.log(`Processing modal submission for ${interaction.customId}`);

    // Get values from the modal fields
    const welcomeMessage = interaction.fields.getTextInputValue("welcome_message");
    const introMessage = interaction.fields.getTextInputValue("intro_message");
    const reopenMessage = interaction.fields.getTextInputValue("reopen_message");
    const vouchMessage = interaction.fields.getTextInputValue("vouch_message");
    const closeMessage = interaction.fields.getTextInputValue("close_message");

    // Log the fields we got for debugging
    console.log("Modal fields received:", {
      welcomeMessage: welcomeMessage ? welcomeMessage.substring(0, 20) + "..." : "missing",
      introMessage: introMessage ? introMessage.substring(0, 20) + "..." : "missing",
      reopenMessage: reopenMessage ? reopenMessage.substring(0, 20) + "..." : "missing",
      vouchMessage: vouchMessage ? vouchMessage.substring(0, 20) + "..." : "missing",
      closeMessage: closeMessage ? closeMessage.substring(0, 20) + "..." : "missing",
    });

    // Store settings in global variable for setup flow
    const customSettings = {
      welcomeMessage,
      introMessage,
      reopenTicketMessage: reopenMessage,
      vouchMessage,
      closingMessage: closeMessage,
      // Include default new ticket message
      newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
      sendClosingMessage: true,
      transcriptsEnabled: true,
      vouchEnabled: true,
    };

    // Store in global variable for later use in QR code generation
    global.lastCustomSettings = customSettings;

    // Try to get an instance - but don't fail if we can't find one (setup flow)
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    if (instance && !instance.isTemporary) {
      // If we have a real instance, update its settings too
      console.log(`Updating existing instance ${instance.instanceId} settings`);
      
      if (!instance.customSettings) {
        instance.customSettings = {};
      }
      
      // Update the settings
      Object.assign(instance.customSettings, customSettings);
      
      // Save to disk if possible
      if (typeof instance.saveSettingsToDisk === 'function') {
        await instance.saveSettingsToDisk(customSettings);
      } else if (bridgeInstanceManager && typeof bridgeInstanceManager.saveInstanceSettings === 'function') {
        await bridgeInstanceManager.saveInstanceSettings(instance.instanceId, customSettings);
      }
    } else {
      // We're in setup mode, just log that we're storing temporary settings
      console.log("No existing instance found - storing settings for later use in setup");
      
      // Make sure these settings are saved to setupStorage too
      const setupParams = global.setupStorage.getSetupParams(interaction.guildId) || {};
      setupParams.customSettings = customSettings;
      global.setupStorage.saveSetupParams(interaction.guildId, setupParams);
    }

    // Create continue setup button
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

    const continueRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("continue_setup")
        .setLabel("Continue Setup")
        .setStyle(ButtonStyle.Primary)
    );

    // Reply with success message and continue button - CRITICAL: Use reply not update
    await interaction.reply({
      content: "✅ Messages customized successfully! Click 'Continue Setup' to proceed.",
      components: [continueRow],
      ephemeral: true,
    });

    // Show preview of the customized messages
    let previewContent = "**Preview of your custom messages:**\n\n";

    if (welcomeMessage) {
      previewContent += `**First contact:** "${welcomeMessage}"\n\n`;
    }

    if (introMessage) {
      previewContent += `**After name:** "${introMessage.replace("{name}", "John")}"\n\n`;
    }

    if (reopenMessage) {
      previewContent += `**When reopening ticket:** "${reopenMessage.replace("{name}", "John")}"\n\n`;
    }

    if (vouchMessage) {
      previewContent += `**Vouch instructions:** "${vouchMessage.replace("{name}", "John")}"\n\n`;
    }

    if (closeMessage) {
      previewContent += `**Closing message:** "${closeMessage.replace("{name}", "John")}"\n\n`;
    }

    previewContent += 'Click the "Continue Setup" button to proceed with setup.';

    try {
      await interaction.followUp({
        content: previewContent,
        ephemeral: true,
      });
    } catch (followupError) {
      console.error("Error sending preview followup:", followupError);
      // Try again with a simpler message
      try {
        await interaction.followUp({
          content: "Messages saved successfully. Click 'Continue Setup' to proceed.",
          ephemeral: true,
        });
      } catch (retryError) {
        console.error("Error sending simplified followup:", retryError);
      }
    }

    console.log(`Setup customization completed by ${interaction.user.tag}`);
    return true;
  } catch (modalError) {
    console.error("Error handling customization modal:", modalError);

    try {
      if (!interaction.replied) {
        await interaction.reply({
          content: `Error processing form: ${modalError.message}. Default settings will be used.`,
          ephemeral: true,
        });
      } else {
        await interaction.followUp({
          content: `Error processing form: ${modalError.message}. Default settings will be used.`,
          ephemeral: true,
        });
      }
    } catch (finalError) {
      console.error("Failed to send error message:", finalError);
    }

    // Create continue button anyway to prevent users from getting stuck
    try {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

      const continueRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("continue_setup")
          .setLabel("Continue with Default Settings")
          .setStyle(ButtonStyle.Primary)
      );

      if (!interaction.replied) {
        await interaction.reply({
          content: "There was an error processing your settings. Click to continue with default settings.",
          components: [continueRow],
          ephemeral: true,
        });
      } else {
        await interaction.followUp({
          content: "There was an error processing your settings. Click to continue with default settings.",
          components: [continueRow],
          ephemeral: true,
        });
      }
    } catch (buttonError) {
      console.error("Failed to create continue button:", buttonError);
    }

    return false;
  }
}

// FIXED: Improved customization flow that properly handles interactions
async function handleCustomizationFlow(interaction) {
  try {
    console.log("Starting customization flow");

    // Create the modal with all the required fields
    const modal = new ModalBuilder()
      .setCustomId("customize_messages_modal")
      .setTitle("Customize Messages");

    // Welcome message
    const welcomeInput = new TextInputBuilder()
      .setCustomId("welcome_message")
      .setLabel("Welcome Message (first contact)")
      .setPlaceholder("Welcome to Support! What's your name?")
      .setStyle(TextInputStyle.Paragraph)
      .setValue(
        "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?"
      )
      .setRequired(true);

    // Introduction message
    const introInput = new TextInputBuilder()
      .setCustomId("intro_message")
      .setLabel("Introduction (after user gives name)")
      .setPlaceholder("Nice to meet you, {name}!")
      .setStyle(TextInputStyle.Paragraph)
      .setValue(
        "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!"
      )
      .setRequired(true);

    // Reopen message
    const reopenInput = new TextInputBuilder()
      .setCustomId("reopen_message")
      .setLabel("Reopen Message (when user contacts again)")
      .setPlaceholder("Welcome back, {name}!")
      .setStyle(TextInputStyle.Paragraph)
      .setValue(
        "Welcome back, {name}! 👋 Our team will continue assisting you with your request."
      )
      .setRequired(true);

    // Vouch message
    const vouchInput = new TextInputBuilder()
      .setCustomId("vouch_message")
      .setLabel("Vouch Command Message (for !vouch)")
      .setPlaceholder("Hey {name}! Thanks for using our service!")
      .setStyle(TextInputStyle.Paragraph)
      .setValue(
        "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback."
      )
      .setRequired(true);

    // Close ticket message
    const closeTicketInput = new TextInputBuilder()
      .setCustomId("close_message")
      .setLabel("Closing Message (sent when ticket closes)")
      .setPlaceholder("Thank you for contacting support!")
      .setStyle(TextInputStyle.Paragraph)
      .setValue(
        "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved."
      )
      .setRequired(true);

    // Create action rows for each input
    const welcomeRow = new ActionRowBuilder().addComponents(welcomeInput);
    const introRow = new ActionRowBuilder().addComponents(introInput);
    const reopenRow = new ActionRowBuilder().addComponents(reopenInput);
    const vouchRow = new ActionRowBuilder().addComponents(vouchInput);
    const closeRow = new ActionRowBuilder().addComponents(closeTicketInput);

    // Add components to the modal
    modal.addComponents(welcomeRow, introRow, reopenRow, vouchRow, closeRow);

    // Show the modal - IMPORTANT: Just show the modal without updating or deferring
    await interaction.showModal(modal);
    console.log("Customization modal shown to user");

    return true;
  } catch (error) {
    console.error("Error in customization flow:", error);

    try {
      // Try to send a followup about the error
      await interaction.followUp({
        content: `Error showing customization form: ${error.message}. Please try again or use default messages.`,
        ephemeral: true,
      });
    } catch (followUpError) {
      console.error("Error sending followup:", followUpError);

      // Last resort attempt
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `Error showing customization form: ${error.message}. Please try again or use default messages.`,
            ephemeral: true,
          });
        }
      } catch (finalError) {
        console.error("Final error attempt failed:", finalError);
      }
    }

    return false;
  }
}

// Handle QR code refresh button
async function handleQRRefresh(interaction) {
  await interaction.update({
    content: "🔄 Refreshing QR code... This will take a moment.",
    components: [],
  });

  try {
    // Find the instance for this guild
    const instance = bridgeInstanceManager.getInstanceByGuildId(
      interaction.guild.id
    );

    if (!instance) {
      await interaction.editReply({
        content:
          "❌ No WhatsApp connection is configured for this server. Use `/setup` to set one up.",
        components: [],
      });
      return;
    }

    // Generate a fresh QR code
    const refreshedQR = await bridgeInstanceManager.generateQRCode({
      guildId: interaction.guild.id,
      categoryId: instance.categoryId,
      transcriptChannelId: instance.transcriptChannelId,
      vouchChannelId: instance.vouchChannelId,
      discordClient: discordClientRef || interaction.client,
    });

    if (refreshedQR === null) {
      // Already authenticated
      await interaction.editReply({
        content: "✅ WhatsApp is already connected for this server!",
        embeds: [],
        components: [],
        files: [],
      });
      return;
    }

    if (refreshedQR === "TIMEOUT") {
      await interaction.editReply({
        content: "⚠️ QR code generation timed out. Please try again later.",
        embeds: [],
        components: [],
        files: [],
      });
      return;
    }

    // Display the new QR code
    await displayQRCode(interaction, refreshedQR, interaction.guild.id);
  } catch (error) {
    console.error(`Error refreshing QR code: ${error.message}`);
    await interaction.editReply({
      content: `⚠️ Error refreshing QR code: ${error.message}. Please try running /setup again.`,
      embeds: [],
      components: [],
      files: [],
    });
  }
}

function createMessageEditModal(
  messageType,
  currentSettings,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
) {
  // Configure modal based on message type
  let modalTitle, modalId, inputId, currentValue, placeholderValue;

  switch (messageType) {
    case "welcome":
      modalTitle = "Edit Welcome Message";
      modalId = "edit_welcome_modal";
      inputId = "welcome_message";
      currentValue =
        currentSettings.welcomeMessage ||
        "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
      placeholderValue = "Welcome to Support! What's your name?";
      break;

    case "intro":
      modalTitle = "Edit Introduction Message";
      modalId = "edit_intro_modal";
      inputId = "intro_message";
      currentValue =
        currentSettings.introMessage ||
        "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
      placeholderValue =
        "Nice to meet you, {name}! Setting up your ticket now...";
      break;

    case "reopen":
      modalTitle = "Edit Reopen Message";
      modalId = "edit_reopen_modal";
      inputId = "reopen_message";
      currentValue =
        currentSettings.reopenTicketMessage ||
        "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
      placeholderValue = "Welcome back, {name}! Our team will assist you.";
      break;

    case "vouch":
      modalTitle = "Edit Vouch Message";
      modalId = "edit_vouch_modal";
      inputId = "vouch_message";
      currentValue =
        currentSettings.vouchMessage ||
        "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
      placeholderValue =
        "Hey {name}! Thanks for using our service! We'd love your feedback...";
      break;

    case "vouch_success":
      modalTitle = "Edit Vouch Success Message";
      modalId = "edit_vouch_success_modal";
      inputId = "vouch_success_message";
      currentValue =
        currentSettings.vouchSuccessMessage ||
        "✅ Thank you for your vouch! It has been posted to our community channel.";
      placeholderValue = "Thank you for your vouch! It has been posted.";
      break;

    case "close":
      modalTitle = "Edit Closing Message";
      modalId = "edit_close_modal";
      inputId = "close_message";
      currentValue =
        currentSettings.closingMessage ||
        "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
      placeholderValue =
        "Thank you for contacting support. Your ticket is being closed.";
      break;

    default:
      modalTitle = "Edit Message";
      modalId = "edit_generic_modal";
      inputId = "message_content";
      currentValue = "Message content not found for this type.";
      placeholderValue = "Enter message content here...";
  }

  // Create message editing modal
  const modal = new ModalBuilder().setCustomId(modalId).setTitle(modalTitle);

  // Create the text input for the message content
  const textInput = new TextInputBuilder()
    .setCustomId(inputId)
    .setLabel(modalTitle)
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentValue)
    .setPlaceholder(placeholderValue)
    .setRequired(true);

  // Add the input to the modal
  const actionRow = new ActionRowBuilder().addComponents(textInput);
  modal.addComponents(actionRow);

  return modal;
}

function getReadableMessageType(messageType) {
  switch (messageType) {
    case "welcome":
      return "Welcome";
    case "intro":
      return "Introduction";
    case "reopen":
      return "Ticket Reopening";
    case "vouch":
      return "Vouch Command";
    case "vouch_success":
      return "Vouch Success";
    case "close":
      return "Closing";
    default:
      return messageType.charAt(0).toUpperCase() + messageType.slice(1);
  }
}

function getVariableGuide(messageType) {
  switch (messageType) {
    case "welcome":
      return "No variables available in this message.";
    case "intro":
    case "reopen":
    case "vouch":
    case "close":
      return "Use {name} to include the user's name.";
    case "vouch_success":
      return "No variables available in this message.";
    default:
      return "";
  }
}

// Handle setup command with interactive UI
async function handleSetupCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    // Check if interaction has a valid guild
    if (!interaction.guild) {
      await interaction.editReply({
        content: "❌ This command can only be used in a server, not in DMs.",
        components: [],
      });
      return;
    }

    const guildId = interaction.guild.id;

    // Check if an instance already exists
    const existingInstance =
      bridgeInstanceManager.getInstanceByGuildId(guildId);

    if (existingInstance) {
      // Option to reconnect
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("reconnect")
          .setLabel("Reconnect WhatsApp")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("edit_settings")
          .setLabel("Edit Settings")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      const response = await interaction.editReply({
        content:
          "WhatsApp is already configured for this server. What would you like to do?",
        components: [row],
      });

      // Wait for button press
      try {
        const confirmation = await response.awaitMessageComponent({
          filter: (i) => i.user.id === interaction.user.id,
          time: 60000,
        });

        if (confirmation.customId === "cancel") {
          await confirmation.update({
            content: "Setup cancelled.",
            components: [],
          });
          return;
        }

        if (confirmation.customId === "edit_settings") {
          await confirmation.update({
            content: "Loading current settings...",
            components: [],
          });
          return await handleSettingsEdit(interaction, existingInstance);
        }

        if (confirmation.customId === "reconnect") {
          await confirmation.update({
            content: "Reconnecting WhatsApp...",
            components: [],
          });

          // Use existing configuration to generate a new QR code
          const refreshedQR = await bridgeInstanceManager.generateQRCode({
            guildId,
            categoryId: existingInstance.categoryId,
            transcriptChannelId: existingInstance.transcriptChannelId,
            vouchChannelId:
              existingInstance.vouchChannelId ||
              existingInstance.transcriptChannelId,
            customSettings: existingInstance.customSettings || {},
            discordClient: discordClientRef || interaction.client,
          });

          if (refreshedQR === null) {
            await interaction.editReply({
              content: "✅ WhatsApp is already connected!",
            });
            return;
          }

          if (refreshedQR === "TIMEOUT") {
            await interaction.editReply({
              content: "⚠️ QR code generation timed out. Please try again.",
            });
            return;
          }

          // Display the QR code
          await displayQRCode(interaction, refreshedQR, guildId);
          return;
        }
      } catch (e) {
        await interaction.editReply({
          content: "Confirmation timed out.",
          components: [],
        });
        return;
      }
    }

    // New setup process
    // Step 1: Select ticket category
    const categories = interaction.guild.channels.cache.filter(
      (c) => c.type === ChannelType.GuildCategory
    );

    if (categories.size === 0) {
      await interaction.editReply({
        content:
          "❌ No categories found in this server. Please create a category first.",
        components: [],
      });
      return;
    }

    // Create options for select menu - limit to first 25 categories
    const options = categories
      .map((category) => ({
        label: category.name,
        value: category.id,
        description: `Category with ${
          category.children?.cache.size || 0
        } channels`,
      }))
      .slice(0, 25); // Discord limit

    // Create select menu
    const categorySelectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("category_select")
        .setPlaceholder("Select a category for tickets")
        .addOptions(options)
    );

    const categoryMessage = await interaction.editReply({
      content: "Please select a category for WhatsApp support tickets:",
      components: [categorySelectRow],
    });

    // Wait for category selection
    let categoryId;
    try {
      const collector = categoryMessage.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === interaction.user.id,
        time: 60000,
        max: 1,
      });

      // Handle the selection
      const selection = await new Promise((resolve, reject) => {
        collector.on("collect", async (i) => {
          await i.deferUpdate();
          resolve(i);
        });

        collector.on("end", (collected) => {
          if (collected.size === 0) {
            reject(new Error("Selection timed out"));
          }
        });
      });

      categoryId = selection.values[0];

      // Save to setup storage
      global.setupStorage.saveSetupParams(guildId, {
        guildId: guildId,
        categoryId: categoryId,
      });
      console.log(
        `[Setup] Saved category ID ${categoryId} for guild ${guildId}`
      );

      // Verify category exists
      const selectedCategory = interaction.guild.channels.cache.get(categoryId);
      if (!selectedCategory) {
        // Try to fetch it directly as a fallback
        console.warn(
          `Guild with ID ${interaction.guild.id} not found in cache, attempting to fetch`
        );
        try {
          await interaction.guild.channels.fetch(categoryId);
        } catch (e) {
          await interaction.editReply({
            content: "❌ Selected category not found. Please try again.",
            components: [],
          });
          return;
        }
      }

      // Get text channels for later selection
      const textChannels = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildText
      );

      if (textChannels.size === 0) {
        await interaction.editReply({
          content:
            "❌ No text channels found in this server. Please create a text channel first.",
          components: [],
        });
        return;
      }

      // CHANGED: Ask if they want a transcript channel
      const transcriptOptionsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("use_transcript_channel")
          .setLabel("Yes, Save Transcripts")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("no_transcript_channel")
          .setLabel("No Transcript Channel")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `Category selected: <#${categoryId}>\n\nDo you want to save ticket transcripts to a channel?`,
        components: [transcriptOptionsRow],
      });

      // Wait for transcript channel decision
      let transcriptChannelId = null;
      const transcriptDecisionMessage = await interaction.fetchReply();

      const transcriptDecisionCollector =
        transcriptDecisionMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          filter: (i) => i.user.id === interaction.user.id,
          time: 60000,
          max: 1,
        });

      const transcriptDecision = await new Promise((resolve, reject) => {
        transcriptDecisionCollector.on("collect", async (i) => {
          await i.deferUpdate();
          resolve(i);
        });

        transcriptDecisionCollector.on("end", (collected) => {
          if (collected.size === 0) {
            reject(new Error("Selection timed out"));
          }
        });
      });

      if (transcriptDecision.customId === "use_transcript_channel") {
        // They want to use a transcript channel, let them select one
        const channelOptions = textChannels
          .map((channel) => ({
            label: channel.name,
            value: channel.id,
            description: "Channel for saving ticket transcripts",
          }))
          .slice(0, 25);

        const transcriptSelectRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("transcript_select")
            .setPlaceholder("Select a channel for transcripts")
            .addOptions(channelOptions)
        );

        await interaction.editReply({
          content: `Category selected: <#${categoryId}>\nNow select a channel for ticket transcripts:`,
          components: [transcriptSelectRow],
        });

        // Wait for transcript channel selection
        const transcriptMessage = await interaction.fetchReply();

        const transcriptCollector =
          transcriptMessage.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: (i) => i.user.id === interaction.user.id,
            time: 60000,
            max: 1,
          });

        // Handle the selection
        const transcriptSelection = await new Promise((resolve, reject) => {
          transcriptCollector.on("collect", async (i) => {
            await i.deferUpdate();
            resolve(i);
          });

          transcriptCollector.on("end", (collected) => {
            if (collected.size === 0) {
              reject(new Error("Selection timed out"));
            }
          });
        });

        transcriptChannelId = transcriptSelection.values[0];

        // Update setup params
        const setupParams = global.setupStorage.getSetupParams(guildId) || {};
        setupParams.transcriptChannelId = transcriptChannelId;
        global.setupStorage.saveSetupParams(guildId, setupParams);
        console.log(
          `[Setup] Saved transcript channel ID ${transcriptChannelId} for guild ${guildId}`
        );

        // Verify channel exists
        const selectedChannel =
          interaction.guild.channels.cache.get(transcriptChannelId);
        if (!selectedChannel) {
          await interaction.editReply({
            content: "❌ Selected channel not found. Please try again.",
            components: [],
          });
          return;
        }
      } else {
        // They don't want to use a transcript channel
        console.log("User chose not to use a transcript channel");
      }

      // CHANGED: Ask if they want a vouch channel
      const vouchOptionsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("use_vouch_channel")
          .setLabel("Yes, Enable Vouches")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("no_vouch_channel")
          .setLabel("No Vouches")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `Category: <#${categoryId}>\n${
          transcriptChannelId
            ? `Transcript channel: <#${transcriptChannelId}>`
            : "No transcript channel selected"
        }\n\nDo you want to enable the vouching system?`,
        components: [vouchOptionsRow],
      });

      // Wait for vouch channel decision
      let vouchChannelId = null;
      const vouchDecisionMessage = await interaction.fetchReply();

      const vouchDecisionCollector =
        vouchDecisionMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          filter: (i) => i.user.id === interaction.user.id,
          time: 60000,
          max: 1,
        });

      const vouchDecision = await new Promise((resolve, reject) => {
        vouchDecisionCollector.on("collect", async (i) => {
          await i.deferUpdate();
          resolve(i);
        });

        vouchDecisionCollector.on("end", (collected) => {
          if (collected.size === 0) {
            reject(new Error("Selection timed out"));
          }
        });
      });

      if (vouchDecision.customId === "use_vouch_channel") {
        if (transcriptChannelId) {
          // Ask if they want to use the same channel as transcript
          const sameChannelRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("same_vouch_channel")
              .setLabel("Use Same Channel for Vouches")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId("different_vouch_channel")
              .setLabel("Select Different Channel")
              .setStyle(ButtonStyle.Secondary)
          );

          await interaction.editReply({
            content: `Category: <#${categoryId}>\nTranscript channel: <#${transcriptChannelId}>\n\nDo you want to use the same channel for vouches, or select a different one?`,
            components: [sameChannelRow],
          });

          // Wait for same/different channel decision
          const sameChannelMessage = await interaction.fetchReply();

          const sameChannelCollector =
            sameChannelMessage.createMessageComponentCollector({
              componentType: ComponentType.Button,
              filter: (i) => i.user.id === interaction.user.id,
              time: 60000,
              max: 1,
            });

          const sameChannelDecision = await new Promise((resolve, reject) => {
            sameChannelCollector.on("collect", async (i) => {
              await i.deferUpdate();
              resolve(i);
            });

            sameChannelCollector.on("end", (collected) => {
              if (collected.size === 0) {
                reject(new Error("Selection timed out"));
              }
            });
          });

          if (sameChannelDecision.customId === "same_vouch_channel") {
            vouchChannelId = transcriptChannelId;

            // Update setup params
            const setupParams =
              global.setupStorage.getSetupParams(guildId) || {};
            setupParams.vouchChannelId = vouchChannelId;
            global.setupStorage.saveSetupParams(guildId, setupParams);
            console.log(
              `[Setup] Using same channel for vouches: ${vouchChannelId} for guild ${guildId}`
            );

            // Move directly to customization options
            await interaction.editReply({
              content: `Using same channel for vouches and transcripts: <#${transcriptChannelId}>\n\nSetting up customization options...`,
              components: [],
            });
          } else {
            // Select different channel for vouches
            const channelOptions = textChannels
              .map((channel) => ({
                label: channel.name,
                value: channel.id,
                description: "Channel for posting vouches",
              }))
              .slice(0, 25);

            const vouchSelectRow = new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId("vouch_select")
                .setPlaceholder("Select a channel for vouches")
                .addOptions(channelOptions)
            );

            await interaction.editReply({
              content: `Category: <#${categoryId}>\nTranscript channel: <#${transcriptChannelId}>\nNow select a channel for vouches:`,
              components: [vouchSelectRow],
            });

            // Wait for vouch channel selection
            const vouchMessage = await interaction.fetchReply();

            const vouchCollector = vouchMessage.createMessageComponentCollector(
              {
                componentType: ComponentType.StringSelect,
                filter: (i) => i.user.id === interaction.user.id,
                time: 60000,
                max: 1,
              }
            );

            // Handle the selection
            const vouchSelection = await new Promise((resolve, reject) => {
              vouchCollector.on("collect", async (i) => {
                await i.deferUpdate();
                resolve(i);
              });

              vouchCollector.on("end", (collected) => {
                if (collected.size === 0) {
                  reject(new Error("Selection timed out"));
                }
              });
            });

            vouchChannelId = vouchSelection.values[0];

            // Update setup params
            const setupParams =
              global.setupStorage.getSetupParams(guildId) || {};
            setupParams.vouchChannelId = vouchChannelId;
            global.setupStorage.saveSetupParams(guildId, setupParams);
            console.log(
              `[Setup] Saved separate vouch channel ID ${vouchChannelId} for guild ${guildId}`
            );

            // Verify channel exists
            const selectedChannel =
              interaction.guild.channels.cache.get(vouchChannelId);
            if (!selectedChannel) {
              await interaction.editReply({
                content: "❌ Selected channel not found. Please try again.",
                components: [],
              });
              return;
            }
          }
        } else {
          // No transcript channel but wants vouches, select a vouch channel
          const channelOptions = textChannels
            .map((channel) => ({
              label: channel.name,
              value: channel.id,
              description: "Channel for posting vouches",
            }))
            .slice(0, 25);

          const vouchSelectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("vouch_select")
              .setPlaceholder("Select a channel for vouches")
              .addOptions(channelOptions)
          );

          await interaction.editReply({
            content: `Category: <#${categoryId}>\nNo transcript channel selected\nNow select a channel for vouches:`,
            components: [vouchSelectRow],
          });

          // Wait for vouch channel selection
          const vouchMessage = await interaction.fetchReply();

          const vouchCollector = vouchMessage.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: (i) => i.user.id === interaction.user.id,
            time: 60000,
            max: 1,
          });

          // Handle the selection
          const vouchSelection = await new Promise((resolve, reject) => {
            vouchCollector.on("collect", async (i) => {
              await i.deferUpdate();
              resolve(i);
            });

            vouchCollector.on("end", (collected) => {
              if (collected.size === 0) {
                reject(new Error("Selection timed out"));
              }
            });
          });

          vouchChannelId = vouchSelection.values[0];

          // Update setup params
          const setupParams = global.setupStorage.getSetupParams(guildId) || {};
          setupParams.vouchChannelId = vouchChannelId;
          global.setupStorage.saveSetupParams(guildId, setupParams);
          console.log(
            `[Setup] Saved vouch-only channel ID ${vouchChannelId} for guild ${guildId}`
          );

          // Verify channel exists
          const selectedChannel =
            interaction.guild.channels.cache.get(vouchChannelId);
          if (!selectedChannel) {
            await interaction.editReply({
              content: "❌ Selected channel not found. Please try again.",
              components: [],
            });
            return;
          }
        }
      } else {
        // They don't want to use a vouch channel
        console.log("User chose not to use a vouch channel");
      }

      // Summarize selections
      let statusText = `Category: <#${categoryId}>\n`;
      if (transcriptChannelId) {
        statusText += `Transcript channel: <#${transcriptChannelId}>\n`;
      } else {
        statusText += `Transcript channel: None (disabled)\n`;
      }

      if (vouchChannelId) {
        statusText += `Vouch channel: <#${vouchChannelId}>\n`;
      } else {
        statusText += `Vouch channel: None (disabled)\n`;
      }

      // Create customize options buttons
      const customizeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("customize_messages")
          .setLabel("Customize Messages")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("continue_default")
          .setLabel("Continue with Defaults")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `${statusText}\nWould you like to customize the messages users will see?\n\nYou can include \`{name}\` in messages to insert the user's name automatically and \`{phoneNumber}\` for their phone number.`,
        components: [customizeRow],
      });

      // Wait for button click on customize/continue
      const customizeMessage = await interaction.fetchReply();

      try {
        // Wait for user's choice on customization
        const customizeDecision = await customizeMessage.awaitMessageComponent({
          filter: (i) =>
            i.user.id === interaction.user.id &&
            (i.customId === "customize_messages" ||
              i.customId === "continue_default"),
          time: 120000, // 2 minutes
        });

        // Handle choice
        if (customizeDecision.customId === "customize_messages") {
          // User wants to customize - call custom function without waiting for it
          // This just shows the modal without additional updates
          await handleCustomizationFlow(customizeDecision);

          // After the modal is shown, update the original message to inform the user
          await interaction.editReply({
            content: `${statusText}\n\n⌛ Please complete the customization form that has appeared...\n\n**Available Variables:**\n• \`{name}\` - User's name\n• \`{phoneNumber}\` - User's WhatsApp number\n\nAfter you submit the form, click the Continue Setup button that will appear.`,
            components: [],
          });

          // The rest of the flow is handled by the modal submission handler and continue button handler
          return;
        } else if (customizeDecision.customId === "continue_default") {
          // User chose to use defaults
          await customizeDecision.update({
            content: `${statusText}\nContinuing with default messages. Generating QR code...`,
            components: [],
          });
        }
      } catch (timeoutError) {
        console.error("Customization decision timed out:", timeoutError);
        await interaction.editReply({
          content: `${statusText}\nSelection timed out. Continuing with default messages. Generating QR code...`,
          components: [],
        });
      }

      // This will use either the custom settings from the modal submission or defaults
      let customSettings = global.lastCustomSettings || {
        welcomeMessage:
          "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
        introMessage:
          "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
        newTicketMessage:
          "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
        closingMessage:
          "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
        vouchMessage:
          "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.",
        transcriptsEnabled: !!transcriptChannelId,
        vouchEnabled: !!vouchChannelId,
      };

      // Clear the global variable if it exists
      if (global.lastCustomSettings) {
        global.lastCustomSettings = null;
      }

      // Generate QR code with this configuration
      const qrCode = await bridgeInstanceManager.generateQRCode({
        guildId,
        categoryId,
        transcriptChannelId,
        vouchChannelId,
        customSettings,
        discordClient: discordClientRef || interaction.client,
      });

      if (qrCode === null) {
        // Already authenticated
        await interaction.editReply({
          content: "✅ WhatsApp is already connected for this server!",
          components: [],
        });
        return;
      }

      if (qrCode === "TIMEOUT") {
        await interaction.editReply({
          content: "⚠️ QR code generation timed out. Please try again later.",
          components: [],
        });
        return;
      }

      // Display the QR code
      const displaySuccess = await displayQRCode(interaction, qrCode, guildId);

      // If display was successful, post a public message that WhatsApp is being connected
      if (displaySuccess && transcriptChannelId) {
        try {
          const publicChannel = await interaction.guild.channels.fetch(
            transcriptChannelId
          );
          if (publicChannel) {
            const publicEmbed = new EmbedBuilder()
              .setColor(0x57f287) // Discord green color
              .setTitle("WhatsApp Bridge Setup")
              .setDescription(
                `<@${interaction.user.id}> is connecting a WhatsApp account to this server for support tickets.`
              )
              .addFields({
                name: "Ticket Category",
                value: `<#${categoryId}>`,
                inline: true,
              });

            // Add transcript channel if enabled
            if (transcriptChannelId) {
              publicEmbed.addFields({
                name: "Transcript Channel",
                value: `<#${transcriptChannelId}>`,
                inline: true,
              });
            }

            // Add vouch channel if enabled
            if (vouchChannelId) {
              publicEmbed.addFields({
                name: "Vouch Channel",
                value: `<#${vouchChannelId}>`,
                inline: true,
              });
            }

            publicEmbed
              .setFooter({ text: "Use /status to check connection status" })
              .setTimestamp();

            await publicChannel.send({
              embeds: [publicEmbed],
            });
          }
        } catch (e) {
          console.error("Error posting public message:", e);
        }
      }
    } catch (error) {
      console.error("Error in category selection:", error);
      await interaction.editReply({
        content: "Category selection timed out or failed.",
        components: [],
      });
      return;
    }
  } catch (error) {
    console.error("Error in setup command:", error);
    await interaction.editReply({
      content: `❌ Error setting up WhatsApp bridge: ${error.message}`,
      components: [],
    });
  }
}

async function handleSettingsEdit(interaction, instance) {
  try {
    // Get current settings
    const currentSettings = instance.customSettings || {
      welcomeMessage:
        "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
      introMessage:
        "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
      transcriptsEnabled: true,
      vouchEnabled: true,
      sendClosingMessage: true,
    };

    // Create feature toggle buttons for the first row
    const featureRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("toggle_transcripts")
        .setLabel(
          `Transcripts: ${
            currentSettings.transcriptsEnabled !== false
              ? "Enabled"
              : "Disabled"
          }`
        )
        .setStyle(
          currentSettings.transcriptsEnabled !== false
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        ),
      new ButtonBuilder()
        .setCustomId("toggle_vouches")
        .setLabel(
          `Vouches: ${
            currentSettings.vouchEnabled !== false ? "Enabled" : "Disabled"
          }`
        )
        .setStyle(
          currentSettings.vouchEnabled !== false
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        ),
      new ButtonBuilder()
        .setCustomId("toggle_closing_messages")
        .setLabel(
          `Closing Messages: ${
            currentSettings.sendClosingMessage !== false
              ? "Enabled"
              : "Disabled"
          }`
        )
        .setStyle(
          currentSettings.sendClosingMessage !== false
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        )
    );

    // Create channel configuration buttons
    const channelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("change_transcript_channel")
        .setLabel("Change Transcript Channel")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("change_vouch_channel")
        .setLabel("Change Vouch Channel")
        .setStyle(ButtonStyle.Primary)
    );

    // Create a message edit button row
    const messageRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("edit_messages")
        .setLabel("Edit Messages")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("done_editing")
        .setLabel("Done")
        .setStyle(ButtonStyle.Success)
    );

    // Show current settings information
    const currentFeaturesText = [
      `Transcripts: ${
        currentSettings.transcriptsEnabled !== false
          ? "✅ Enabled"
          : "❌ Disabled"
      }${
        instance.transcriptChannelId
          ? ` (Channel: <#${instance.transcriptChannelId}>)`
          : ""
      }`,
      `Vouches: ${
        currentSettings.vouchEnabled !== false ? "✅ Enabled" : "❌ Disabled"
      }${
        instance.vouchChannelId
          ? ` (Channel: <#${instance.vouchChannelId}>)`
          : ""
      }`,
      `Closing Messages: ${
        currentSettings.sendClosingMessage !== false
          ? "✅ Enabled"
          : "❌ Disabled"
      }`,
    ].join("\n");

    await interaction.editReply({
      content: `Current settings:\n\n**Features:**\n${currentFeaturesText}\n\nYou can toggle features, change channels, or edit message templates.`,
      components: [featureRow, channelRow, messageRow],
    });

    // Start an interaction collector to handle 'done_editing' button
    const collector = interaction.channel.createMessageComponentCollector({
      filter: (i) =>
        i.user.id === interaction.user.id && i.customId === "done_editing",
      time: 300000, // 5 minutes timeout
    });

    collector.on("collect", async (i) => {
      // Handle the "Done" button
      await i.update({
        content: "Settings saved successfully!",
        components: [],
      });
      collector.stop();
    });

    collector.on("end", (collected, reason) => {
      if (reason === "time") {
        try {
          interaction.editReply({
            content:
              "Settings editing session timed out. Your changes have been saved.",
            components: [],
          });
        } catch (e) {
          console.error("Error updating message after timeout:", e);
        }
      }
    });

    return true;
  } catch (error) {
    console.error("Error editing settings:", error);
    await interaction.editReply({
      content: `❌ Error editing settings: ${error.message}`,
      components: [],
    });
    return false;
  }
}

async function handleEditMessagesCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    // Check if interaction has a valid guild
    if (!interaction.guild) {
      await interaction.editReply({
        content: "❌ This command can only be used in a server, not in DMs.",
        components: [],
      });
      return;
    }

    const guildId = interaction.guild.id;

    // Check if an instance exists
    const instance = bridgeInstanceManager.getInstanceByGuildId(guildId);

    if (!instance) {
      await interaction.editReply({
        content:
          "❌ No WhatsApp bridge is configured for this server. Use `/setup` to set one up.",
        components: [],
      });
      return;
    }

    // Get current settings with proper defaults
    const currentSettings = {
      welcomeMessage:
        "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
      introMessage:
        "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
      reopenTicketMessage:
        "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
      newTicketMessage:
        "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
      closingMessage:
        "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
      vouchMessage:
        "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.",
      vouchSuccessMessage:
        "✅ Thank you for your vouch! It has been posted to our community channel.",
      sendClosingMessage: true,
      transcriptsEnabled: true,
      vouchEnabled: true,
      ...instance.customSettings, // Override with actual instance settings
    };

    // Create category buttons for message editing
    const categoryRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("edit_welcome_category")
        .setLabel("Welcome Messages")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("👋"),
      new ButtonBuilder()
        .setCustomId("edit_ticket_category")
        .setLabel("Ticket Messages")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📋"),
      new ButtonBuilder()
        .setCustomId("edit_vouch_category")
        .setLabel("Vouch Messages")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("⭐")
    );

    // Create a row for feature toggles
    const featureRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("toggle_transcripts")
        .setLabel(
          `Transcripts: ${
            currentSettings.transcriptsEnabled !== false
              ? "Enabled"
              : "Disabled"
          }`
        )
        .setStyle(
          currentSettings.transcriptsEnabled !== false
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        ),
      new ButtonBuilder()
        .setCustomId("toggle_vouches")
        .setLabel(
          `Vouches: ${
            currentSettings.vouchEnabled !== false ? "Enabled" : "Disabled"
          }`
        )
        .setStyle(
          currentSettings.vouchEnabled !== false
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        ),
      new ButtonBuilder()
        .setCustomId("toggle_closing_messages")
        .setLabel(
          `Closing Messages: ${
            currentSettings.sendClosingMessage !== false
              ? "Enabled"
              : "Disabled"
          }`
        )
        .setStyle(
          currentSettings.sendClosingMessage !== false
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        )
    );

    // Send message with category buttons
    await interaction.editReply({
      content:
        "📝 **Edit WhatsApp Bot Messages**\n\nSelect a category of messages to edit or toggle features below.",
      components: [categoryRow, featureRow],
    });
  } catch (error) {
    console.error("Error in edit-messages command:", error);
    await interaction.editReply({
      content: `❌ Error: ${error.message}`,
      components: [],
    });
  }
}

async function handleEditSpecificMessage(interaction, messageType) {
  await interaction.deferReply({ ephemeral: true });

  try {
    // Check if interaction has a valid guild
    if (!interaction.guild) {
      await interaction.editReply({
        content: "❌ This command can only be used in a server, not in DMs.",
        components: [],
      });
      return;
    }

    const guildId = interaction.guild.id;

    // Check if an instance exists
    const instance = bridgeInstanceManager.getInstanceByGuildId(guildId);

    if (!instance) {
      await interaction.editReply({
        content:
          "❌ No WhatsApp bridge is configured for this server. Use `/setup` to set one up.",
        components: [],
      });
      return;
    }

    // Get current settings
    const currentSettings = instance.customSettings || {
      welcomeMessage:
        "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
      introMessage:
        "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
      newTicketMessage:
        "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
      closingMessage:
        "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
      vouchMessage:
        "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.",
    };

    // Show edit modal for the specific message type
    await showMessageEditModal(
      interaction,
      instance,
      messageType,
      currentSettings
    );
  } catch (error) {
    console.error(`Error in edit-${messageType} command:`, error);
    await interaction.editReply({
      content: `❌ Error: ${error.message}`,
      components: [],
    });
  }
}

// FIXED: Improved modal handling that prevents errors
async function showMessageEditModal(
  interaction,
  instance,
  messageType,
  currentSettings
) {
  try {
    let modalTitle,
      modalId,
      inputId,
      currentValue,
      placeholderValue,
      variableGuide;

    // Configure modal based on message type
    switch (messageType) {
      case "welcome":
        modalTitle = "Edit Welcome Message";
        modalId = "edit_welcome_modal";
        inputId = "welcome_message";
        currentValue =
          currentSettings.welcomeMessage ||
          "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
        placeholderValue = "Welcome to Support! What's your name?";
        variableGuide = "No variables available in this message.";
        break;

      case "intro":
        modalTitle = "Edit Introduction Message";
        modalId = "edit_intro_modal";
        inputId = "intro_message";
        currentValue =
          currentSettings.introMessage ||
          "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
        placeholderValue =
          "Nice to meet you, {name}! Setting up your ticket now...";
        variableGuide = "Use {name} to include the user's name.";
        break;

      case "reopen":
        modalTitle = "Edit Reopen Message";
        modalId = "edit_reopen_modal";
        inputId = "reopen_message";
        currentValue =
          currentSettings.reopenTicketMessage ||
          "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
        placeholderValue = "Welcome back, {name}! Our team will assist you.";
        variableGuide = "Use {name} to include the user's name.";
        break;

      case "vouch":
        modalTitle = "Edit Vouch Message";
        modalId = "edit_vouch_modal";
        inputId = "vouch_message";
        currentValue =
          currentSettings.vouchMessage ||
          "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.";
        placeholderValue =
          "Hey {name}! Thanks for using our service! We'd love your feedback...";
        variableGuide = "Use {name} to include the user's name.";
        break;

      case "vouch_success":
        modalTitle = "Edit Vouch Success Message";
        modalId = "edit_vouch_success_modal";
        inputId = "vouch_success_message";
        currentValue =
          currentSettings.vouchSuccessMessage ||
          "✅ Thank you for your vouch! It has been posted to our community channel.";
        placeholderValue = "Thank you for your vouch! It has been posted.";
        variableGuide = "No variables available in this message.";
        break;

      case "close":
        modalTitle = "Edit Closing Message";
        modalId = "edit_close_modal";
        inputId = "close_message";
        currentValue =
          currentSettings.closingMessage ||
          "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
        placeholderValue =
          "Thank you for contacting support. Your ticket is being closed.";
        variableGuide = "Use {name} to include the user's name.";
        break;

      default:
        throw new Error(`Unknown message type: ${messageType}`);
    }

    // First check if we already have a reply we can use
    try {
      await interaction.followUp({
        content: `**Editing ${modalTitle}**\n\n${variableGuide}\n\nA form will appear for you to edit the message.`,
        ephemeral: true,
      });
    } catch (followupError) {
      console.error(`Error sending followup: ${followupError.message}`);
    }

    // Create message editing modal
    const modal = new ModalBuilder().setCustomId(modalId).setTitle(modalTitle);

    // Create the text input for the message content
    const textInput = new TextInputBuilder()
      .setCustomId(inputId)
      .setLabel(modalTitle)
      .setStyle(TextInputStyle.Paragraph)
      .setValue(currentValue)
      .setPlaceholder(placeholderValue)
      .setRequired(true);

    // Add the input to the modal
    const actionRow = new ActionRowBuilder().addComponents(textInput);
    modal.addComponents(actionRow);

    // Wait a small amount of time before showing the modal
    setTimeout(async () => {
      try {
        // Show the modal
        await interaction.showModal(modal);
        console.log(`Modal ${modalId} shown to user ${interaction.user.tag}`);
      } catch (modalError) {
        console.error(`Error showing modal: ${modalError.message}`);

        // Try to send a followup if modal fails
        try {
          await interaction.followUp({
            content: `Error showing edit form: ${modalError.message}. Please try again.`,
            ephemeral: true,
          });
        } catch (followUpError) {
          console.error(`Error sending followup: ${followUpError.message}`);
        }
      }
    }, 500);
  } catch (error) {
    console.error(`Error showing message edit modal:`, error);

    // Handle errors
    try {
      await interaction.followUp({
        content: `❌ Error showing edit form: ${error.message}`,
        ephemeral: true,
      });
    } catch (replyError) {
      console.error(`Error sending error message: ${replyError.message}`);
    }
  }
}

// Handle edit message modal submissions
async function handleEditMessageModalSubmission(interaction) {
  try {
    // Get the type of message from the modal ID
    const modalId = interaction.customId;
    let messageType, inputId, settingsProperty;

    if (modalId.startsWith("edit_welcome_modal")) {
      messageType = "welcome";
      inputId = "welcome_message";
      settingsProperty = "welcomeMessage";
    } else if (modalId.startsWith("edit_intro_modal")) {
      messageType = "intro";
      inputId = "intro_message";
      settingsProperty = "introMessage";
    } else if (modalId.startsWith("edit_reopen_modal")) {
      messageType = "reopen";
      inputId = "reopen_message";
      settingsProperty = "reopenTicketMessage";
    } else if (modalId.startsWith("edit_vouch_modal")) {
      messageType = "vouch";
      inputId = "vouch_message";
      settingsProperty = "vouchMessage";
    } else if (modalId.startsWith("edit_vouch_success_modal")) {
      messageType = "vouch_success";
      inputId = "vouch_success_message";
      settingsProperty = "vouchSuccessMessage";
    } else if (modalId.startsWith("edit_close_modal")) {
      messageType = "close";
      inputId = "close_message";
      settingsProperty = "closingMessage";
    } else {
      await interaction.reply({
        content: "Unknown modal type. Please try again.",
        ephemeral: true,
      });
      return;
    }

    // Get the new message from the submission
    const newMessage = interaction.fields.getTextInputValue(inputId);

    // Get the server instance
    const instance = bridgeInstanceManager.getInstanceByGuildId(
      interaction.guildId
    );
    if (!instance) {
      await interaction.reply({
        content:
          "❌ Server instance not found. Please set up the WhatsApp bridge first.",
        ephemeral: true,
      });
      return;
    }

    // Get current settings
    if (!instance.customSettings) {
      instance.customSettings = {};
    }

    // Update the specific message type
    instance.customSettings[settingsProperty] = newMessage;

    // Apply changes to the relevant components
    switch (messageType) {
      case "welcome":
        if (instance.whatsAppHandler)
          instance.whatsAppHandler.welcomeMessage = newMessage;
        break;
      case "intro":
        if (instance.whatsAppHandler)
          instance.whatsAppHandler.introMessage = newMessage;
        break;
      case "reopen":
        if (instance.whatsAppHandler)
          instance.whatsAppHandler.reopenTicketMessage = newMessage;
        break;
      case "vouch":
        if (
          instance.vouchHandler &&
          typeof instance.vouchHandler.setCustomVouchMessage === "function"
        ) {
          instance.vouchHandler.setCustomVouchMessage(newMessage);
        }
        break;
      case "vouch_success":
        instance.customSettings.vouchSuccessMessage = newMessage;
        break;
      case "close":
        instance.customSettings.closingMessage = newMessage;
        if (
          instance.ticketManager &&
          typeof instance.ticketManager.setCustomCloseMessage === "function"
        ) {
          instance.ticketManager.setCustomCloseMessage(newMessage);
        }
        break;
    }

    // Save the settings
    await bridgeInstanceManager.saveInstanceSettings(
      instance.instanceId,
      instance.customSettings
    );

    // Show preview with variables replaced
    let previewMessage = newMessage;
    if (messageType !== "welcome" && messageType !== "vouch_success") {
      // Replace variables in preview
      previewMessage = previewMessage
        .replace(/{name}/g, "John Doe")
        .replace(/{phoneNumber}/g, "+1234567890");
    }

    // Display the message type in a readable format
    const readableMessageType = {
      welcome: "welcome",
      intro: "introduction",
      reopen: "ticket reopening",
      vouch: "vouch command",
      vouch_success: "vouch success",
      close: "closing",
    }[messageType];

    // Confirm successful update
    await interaction.reply({
      content: `✅ The ${readableMessageType} message has been updated!\n\n**New Message:**\n${previewMessage}`,
      ephemeral: true,
    });

    console.log(
      `[DiscordCommands] ${messageType} message updated successfully by ${interaction.user.tag}`
    );
  } catch (error) {
    console.error(`Error processing modal submission:`, error);

    // Handle errors
    await interaction.reply({
      content: `❌ Error updating message: ${error.message}`,
      ephemeral: true,
    });
  }
}

async function updateInstanceSettings(instance, settings) {
  try {
    // Save the settings to the instance
    instance.customSettings = settings;

    // Apply settings to the instance components
    if (instance.whatsAppHandler) {
      if (settings.welcomeMessage) {
        instance.whatsAppHandler.welcomeMessage = settings.welcomeMessage;
      }
      if (settings.introMessage) {
        instance.whatsAppHandler.introMessage = settings.introMessage;
      }
      if (settings.reopenTicketMessage) {
        instance.whatsAppHandler.reopenTicketMessage =
          settings.reopenTicketMessage;
      }
    }

    if (instance.vouchHandler) {
      if (
        typeof instance.vouchHandler.setCustomVouchMessage === "function" &&
        settings.vouchMessage
      ) {
        instance.vouchHandler.setCustomVouchMessage(settings.vouchMessage);
      }

      instance.vouchHandler.isDisabled = !settings.vouchEnabled;
    }

    if (instance.ticketManager) {
      if (
        typeof instance.ticketManager.setCustomCloseMessage === "function" &&
        settings.closingMessage
      ) {
        instance.ticketManager.setCustomCloseMessage(settings.closingMessage);
      }

      if (
        typeof instance.ticketManager.setCustomIntroMessage === "function" &&
        settings.newTicketMessage
      ) {
        instance.ticketManager.setCustomIntroMessage(settings.newTicketMessage);
      }
    }

    // Handle feature toggles
    if (instance.transcriptManager) {
      instance.transcriptManager.isDisabled = !settings.transcriptsEnabled;
    }

    // Make sure settings persist in bridge instance manager
    if (bridgeInstanceManager.saveInstanceSettings) {
      await bridgeInstanceManager.saveInstanceSettings(
        instance.instanceId,
        settings
      );
    }

    return true;
  } catch (error) {
    console.error("Error updating instance settings:", error);
    return false;
  }
}

// Handle status command
async function handleStatusCommand(interaction) {
  await interaction.deferReply();

  try {
    const instance = bridgeInstanceManager.getInstanceByGuildId(
      interaction.guild.id
    );

    if (!instance) {
      await interaction.editReply(
        "❌ No WhatsApp bridge is configured for this server. Use `/setup` to set one up."
      );
      return;
    }

    // Get instance status
    const status = instance.getStatus();

    // Create status embed
    const embed = new EmbedBuilder()
      .setColor(status.isConnected ? 0x00ff00 : 0xff0000)
      .setTitle("WhatsApp Bridge Status")
      .addFields(
        {
          name: "Status",
          value: status.isConnected ? "🟢 Connected" : "🔴 Disconnected",
        },
        { name: "Server", value: interaction.guild.name, inline: true },
        { name: "Instance ID", value: status.instanceId, inline: true },
        {
          name: "Category",
          value:
            interaction.guild.channels.cache.get(status.categoryId)?.name ||
            "Unknown Category",
        },
        {
          name: "Transcript Channel",
          value: status.transcriptChannel
            ? `<#${status.transcriptChannel}>`
            : "Not set",
        },
        {
          name: "Vouch Channel",
          value: status.vouchChannel ? `<#${status.vouchChannel}>` : "Not set",
        },
        { name: "Active Tickets", value: status.activeTickets.toString() },
        { name: "Registered Users", value: status.registeredUsers.toString() }
      )
      .setFooter({ text: "Last updated" })
      .setTimestamp();

    // Add reconnect button if disconnected
    const components = [];
    if (!status.isConnected) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("reconnect_status")
          .setLabel("Reconnect WhatsApp")
          .setStyle(ButtonStyle.Primary)
      );
      components.push(row);
    }

    await interaction.editReply({
      embeds: [embed],
      components: components,
    });
  } catch (error) {
    console.error("Error in status command:", error);
    await interaction.editReply(`❌ Error checking status: ${error.message}`);
  }
}

// Handle disconnect command
async function handleDisconnectCommand(interaction) {
  await interaction.deferReply();

  try {
    const guildId = interaction.guild.id;

    // Check if instance exists
    const instance = bridgeInstanceManager.getInstanceByGuildId(guildId);

    if (!instance) {
      await interaction.editReply(
        "❌ No WhatsApp bridge is configured for this server."
      );
      return;
    }

    // Confirm disconnection with buttons - UPDATED MESSAGE
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("confirm_disconnect")
        .setLabel("Yes, disconnect")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cancel_disconnect")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({
      content:
        "⚠️ Are you sure you want to disconnect the WhatsApp bridge? This will remove all configuration, delete authentication data, and require re-scanning the QR code to reconnect.",
      components: [row],
    });
  } catch (error) {
    console.error("Error in disconnect command:", error);
    await interaction.editReply(`❌ Error disconnecting: ${error.message}`);
  }
}

// Handle actual disconnection after confirmation
async function disconnectServer(interaction) {
  try {
    const guildId = interaction.guild.id;

    // Update message to show process is starting
    await interaction.update({
      content: "🔄 Disconnecting WhatsApp bridge and removing authentication data...",
      components: [],
    });

    // Get the instance first
    const instance = bridgeInstanceManager.getInstanceByGuildId(guildId);
    if (!instance || !instance.instanceId) {
      await interaction.editReply({
        content: "❌ Could not locate instance data. Cannot complete disconnection properly.",
        components: [],
      });
      return;
    }

    const instanceId = instance.instanceId;
    console.log(`Performing full cleanup for instance ${instanceId}`);

    // Call disconnect with full cleanup
    const disconnected = await bridgeInstanceManager.disconnectInstance(guildId, true);
    
    if (!disconnected) {
      await interaction.editReply({
        content: "⚠️ Basic disconnection completed but some cleanup steps may have failed.",
        components: [],
      });
      return;
    }

    // Additional cleanup: manually delete auth directories and files
    const instanceDir = path.join(__dirname, '..', 'instances', instanceId);
    const authDirs = [
      path.join(instanceDir, 'auth'),
      path.join(instanceDir, 'baileys_auth')
    ];

    // Delete auth directories and their contents
    authDirs.forEach(dir => {
      if (fs.existsSync(dir)) {
        try {
          // Delete all files in directory
          const files = fs.readdirSync(dir);
          for (const file of files) {
            fs.unlinkSync(path.join(dir, file));
            console.log(`Deleted auth file: ${path.join(dir, file)}`);
          }
          
          // Remove directory itself
          fs.rmdirSync(dir);
          console.log(`Removed auth directory: ${dir}`);
        } catch (e) {
          console.error(`Error cleaning up ${dir}:`, e);
        }
      }
    });

    // Delete specific auth files that might exist
    const credsFile = path.join(instanceDir, 'creds.json');
    if (fs.existsSync(credsFile)) {
      fs.unlinkSync(credsFile);
      console.log(`Deleted creds file: ${credsFile}`);
    }

    // Clear instance configs to ensure it's fully reset
    if (bridgeInstanceManager.configs && bridgeInstanceManager.configs[instanceId]) {
      delete bridgeInstanceManager.configs[instanceId];
      bridgeInstanceManager.saveConfigurations();
      console.log(`Removed instance ${instanceId} from configs`);
    }

    // Force remove from instances map
    if (bridgeInstanceManager.instances && bridgeInstanceManager.instances.has(instanceId)) {
      bridgeInstanceManager.instances.delete(instanceId);
      console.log(`Removed instance ${instanceId} from instances map`);
    }

    await interaction.editReply({
      content: "✅ WhatsApp bridge has been completely disconnected and all authentication data removed. Use `/setup` to reconnect with a new QR code scan.",
      components: [],
    });
  } catch (error) {
    console.error("Error disconnecting server:", error);
    await interaction.update({
      content: `❌ Error disconnecting WhatsApp bridge: ${error.message}`,
      components: [],
    });
  }
}

// Handle help command
async function handleHelpCommand(interaction) {
  // Create help embed
  const embed = new EmbedBuilder()
    .setColor(0x4287f5)
    .setTitle("WhatsApp Bridge Commands")
    .setDescription(
      "Here are the available commands for the WhatsApp-Discord Bridge:"
    )
    .addFields(
      {
        name: "/setup",
        value: "Set up a new WhatsApp connection for this server",
      },
      { name: "/status", value: "Check the status of your WhatsApp bridge" },
      {
        name: "/disconnect",
        value: "Disconnect and remove the WhatsApp bridge for this server",
      },
      { name: "/help", value: "Show this help message" },
      {
        name: "/edit-messages",
        value: "Edit all message templates used by the bot",
      },
      {
        name: "/edit-welcome",
        value: "Edit the welcome message for new users",
      },
      {
        name: "/edit-intro",
        value: "Edit the intro message after user provides name",
      },
      {
        name: "/edit-closing",
        value: "Edit the message sent when closing tickets",
      },
      {
        name: "!vouch",
        value:
          "Send vouch instructions to the WhatsApp user (in support tickets)",
      },
      {
        name: "!close",
        value:
          "Close a support ticket and save transcript (in support tickets)",
      }
    )
    .setFooter({
      text: "Admin permissions are required for setup and disconnect commands",
    });

  await interaction.reply({ embeds: [embed] });
}

// Generate and display QR code
async function displayQRCode(interaction, qrCode, guildId) {
  try {
    // Validate inputs
    if (
      !interaction ||
      !interaction.editReply ||
      typeof interaction.editReply !== "function"
    ) {
      throw new Error("Invalid interaction object");
    }

    if (!qrCode || typeof qrCode !== "string" || qrCode.trim() === "") {
      throw new Error("Invalid or empty QR code");
    }

    if (!guildId) {
      throw new Error("Missing guild ID");
    }

    // Let user know we're generating the QR code
    await interaction.editReply({
      content: "⌛ Generating QR code for WhatsApp connection...",
      components: [],
    });

    // Create directory for QR code if it doesn't exist
    const instancesDir = path.join(__dirname, "..", "instances");
    const guildDir = path.join(instancesDir, guildId);

    if (!fs.existsSync(guildDir)) {
      fs.mkdirSync(guildDir, { recursive: true });
    }

    const qrCodePath = path.join(guildDir, "qrcode.png");

    console.log(
      `Generating QR code image for guild ${guildId}, QR data length: ${qrCode.length}`
    );

    // Generate QR code image with larger size and better margins
    await qrcode.toFile(qrCodePath, qrCode, {
      scale: 12, // Larger scale for clearer image
      margin: 4,
      color: {
        dark: "#000000", // Pure black for better scanning
        light: "#FFFFFF",
      },
      errorCorrectionLevel: "H", // Highest error correction
    });

    console.log(`QR code image saved to ${qrCodePath}`);

    // Verify file was created
    if (!fs.existsSync(qrCodePath)) {
      throw new Error("QR code file was not created");
    }

    // Create modern embed with clearer instructions
    const embed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord blurple color
      .setTitle("📱 Connect WhatsApp")
      .setDescription(
        "**Scan this QR code with your WhatsApp to connect to your Discord server.**"
      )
      .addFields(
        {
          name: "📋 How to Connect",
          value:
            '1️⃣ Open WhatsApp on your phone\n2️⃣ Tap Menu (⋮) or Settings (⚙️)\n3️⃣ Select "WhatsApp Web/Desktop"\n4️⃣ Tap "Link a device"\n5️⃣ Point your camera at this QR code',
        },
        {
          name: "🔄 Connection Status",
          value:
            "`⌛ Waiting for scan...`\nThis message will update when your device connects.",
        },
        {
          name: "⏰ QR Code Expiration",
          value:
            'This QR code will expire after a few minutes. If it expires, use the "Refresh QR Code" button below to generate a fresh one.',
        }
      )
      .setFooter({ text: "WhatsApp-Discord Bridge • Scan to Connect" })
      .setTimestamp();

    // Create attachment from QR code image
    const attachment = new AttachmentBuilder(qrCodePath, {
      name: "qrcode.png",
    });
    embed.setImage("attachment://qrcode.png");

    // Create a button for refreshing the QR code if needed
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("refresh_qr")
        .setLabel("Refresh QR Code")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄")
    );

    // Update the reply with QR code and instructions
    const message = await interaction.editReply({
      content: "",
      embeds: [embed],
      files: [attachment],
      components: [row],
    });

    // Init global storage for QR code messages if needed
    if (!global.qrCodeMessages) {
      global.qrCodeMessages = new Map();
    }

    // Store the interaction data for updates when connection status changes
    global.qrCodeMessages.set(guildId, {
      interaction,
      message,
      embedData: embed.toJSON(),
    });

    // Set up a connection status updater for this instance
    const instance = bridgeInstanceManager.getInstanceByGuildId(guildId);
    if (instance) {
      // Set up onReady handler to update message
      instance.onReady(async () => {
        try {
          console.log(
            `WhatsApp connected for guild ${guildId}, updating QR code message`
          );

          // Get stored data
          const storedData = global.qrCodeMessages.get(guildId);
          if (!storedData) {
            console.log(
              `No stored QR code message data found for guild ${guildId}`
            );
            return;
          }

          // Create a success embed based on the original
          const successEmbed = new EmbedBuilder(storedData.embedData)
            .setColor(0x57f287) // Discord green for success
            .setTitle("📱 WhatsApp Connected Successfully!")
            .setDescription(
              "**Your WhatsApp account is now connected to this Discord server!**"
            )
            .spliceFields(1, 1, {
              name: "🔄 Connection Status",
              value:
                "`✅ Connected and ready!`\nYour WhatsApp messages will now appear in channels within the configured category.",
            });

          // Update the interaction reply
          await interaction.editReply({
            content: "",
            embeds: [successEmbed],
            files: [], // Remove QR code
            components: [], // Remove buttons
          });

          // Clean up the stored data
          global.qrCodeMessages.delete(guildId);

          console.log(
            `QR code message updated to show successful connection for guild ${guildId}`
          );
        } catch (updateError) {
          console.error(
            `Error updating QR code message on connection: ${updateError.message}`
          );
        }
      });
    }

    return true;
  } catch (error) {
    console.error("Error displaying QR code in Discord:", error);
    try {
      await interaction.editReply({
        content: `⚠️ Error displaying QR code: ${error.message}. Please try again.`,
        embeds: [],
        files: [],
      });
    } catch (replyError) {
      console.error(
        "Additional error trying to send error message:",
        replyError
      );
    }
    return false;
  }
}

async function handleModalSubmit(interaction) {
  // This is a single entry point for all modal submissions
  try {
    if (interaction.customId === "customize_messages_modal") {
      await handleCustomizeMessagesModalSubmission(interaction);
      return;
    }

    // For edit-messages modals
    if (
      interaction.customId.startsWith("edit_") &&
      interaction.customId.endsWith("_modal")
    ) {
      await handleEditMessageModalSubmission(interaction);
      return;
    }
  } catch (error) {
    console.error("Error handling modal submission:", error);
    try {
      if (!interaction.replied) {
        await interaction.reply({
          content: `Error processing your form: ${error.message}`,
          ephemeral: true,
        });
      }
    } catch (replyError) {
      console.error("Error replying to modal error:", replyError);
    }
  }
}

/**
 * Safely reply to an interaction regardless of its state
 * @param {Interaction} interaction - Discord interaction
 * @param {string|Object} content - Reply content
 * @param {boolean} [ephemeral=false] - Whether reply should be ephemeral
 */
async function safeReply(interaction, content, ephemeral = false) {
  try {
    const options =
      typeof content === "string"
        ? { content, ephemeral }
        : { ...content, ephemeral: content.ephemeral ?? ephemeral };

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(options);
    } else if (interaction.deferred && !interaction.replied) {
      // Can't set ephemeral after deferring
      const { ephemeral, ...rest } = options;
      await interaction.editReply(rest);
    } else {
      await interaction.followUp(options);
    }
  } catch (error) {
    console.error("Error in safeReply:", error);
  }
}

/**
 * Safely update an interaction response
 * @param {Interaction} interaction - Discord interaction
 * @param {string|Object} content - Update content
 */
async function safeUpdate(interaction, content) {
  try {
    const options = typeof content === "string" ? { content } : content;

    if (interaction.replied) {
      await interaction.editReply(options);
    } else if (interaction.deferred) {
      await interaction.editReply(options);
    } else {
      await interaction.update(options);
    }
  } catch (error) {
    console.error("Error in safeUpdate:", error);

    // Fallback to reply if update fails
    try {
      if (!interaction.replied) {
        await interaction.reply({ ...options, ephemeral: true });
      }
    } catch (fallbackError) {
      console.error("Error in safeUpdate fallback:", fallbackError);
    }
  }
}

/**
 * Safely send a followup message
 * @param {Interaction} interaction - Discord interaction
 * @param {string|Object} content - Followup content
 */
async function safeFollowUp(interaction, content) {
  try {
    const options = typeof content === "string" ? { content } : content;
    await interaction.followUp(options);
  } catch (error) {
    console.error("Error in safeFollowUp:", error);
  }
}

module.exports = {
  registerCommands,
  handleCommand,
  displayQRCode,
  handleEditMessageModalSubmission,
  handleCustomizationFlow,
  handleContinueSetupButton,
  handleCustomizeMessagesModalSubmission,
  showMessageEditModal,
  createMessageEditModal,
  getReadableMessageType,
  getVariableGuide,
  safeReply,
  safeUpdate,
  safeFollowUp,
  updateChannelSetting,
};

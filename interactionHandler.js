// interactionHandler.js - Fixed version with proper refreshing
const { ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');


const specialChannelCommands = require('./specialChannelCommands');

function getBridgeInstanceManager() {
  return require('./modules/BridgeInstanceManager');
}

function applySettingsToComponents(instance, propName, value) {
  try {
    // Apply to WhatsApp handler
    if (instance.whatsAppHandler) {
      if (propName === 'welcomeMessage') {
        instance.whatsAppHandler.welcomeMessage = value;
      } else if (propName === 'introMessage') {
        instance.whatsAppHandler.introMessage = value;
      } else if (propName === 'reopenTicketMessage') {
        instance.whatsAppHandler.reopenTicketMessage = value;
      }
    }
    
    // Apply to Vouch handler
    if (instance.vouchHandler && propName === 'vouchMessage' && 
        typeof instance.vouchHandler.setCustomVouchMessage === 'function') {
      instance.vouchHandler.setCustomVouchMessage(value);
    }
    
    // Apply to TicketManager
    if (instance.ticketManager) {
      if (propName === 'closingMessage' && typeof instance.ticketManager.setCustomCloseMessage === 'function') {
        instance.ticketManager.setCustomCloseMessage(value);
      }
    }
    
    // Apply to Discord handlers for closing message
    if (propName === 'closingMessage') {
      // Apply to any handlers that might use this
      if (instance.discordHandler) {
        instance.discordHandler.customCloseMessage = value;
      }
      if (instance.baileysDiscordHandler) {
        instance.baileysDiscordHandler.customCloseMessage = value;
      }
    }
  } catch (error) {
    console.error(`Error applying settings to components: ${error.message}`);
  }
}

/**
 * Handle edit message modal submissions with proper refreshing after edit
 */
async function handleEditMessageModalSubmit(interaction) {
  try {
    // Get the type of message from the modal ID
    const modalId = interaction.customId;
    let messageType, inputId, settingsProperty;
    
    if (modalId.startsWith('edit_welcome_modal')) {
      messageType = 'welcome';
      inputId = 'welcome_message';
      settingsProperty = 'welcomeMessage';
    } else if (modalId.startsWith('edit_intro_modal')) {
      messageType = 'intro';
      inputId = 'intro_message';
      settingsProperty = 'introMessage';
    } else if (modalId.startsWith('edit_reopen_modal')) {
      messageType = 'reopen';
      inputId = 'reopen_message';
      settingsProperty = 'reopenTicketMessage';
    } else if (modalId.startsWith('edit_vouch_modal')) {
      messageType = 'vouch';
      inputId = 'vouch_message';
      settingsProperty = 'vouchMessage';
    } else if (modalId.startsWith('edit_vouch_success_modal')) {
      messageType = 'vouch_success';
      inputId = 'vouch_success_message';
      settingsProperty = 'vouchSuccessMessage';
    } else if (modalId.startsWith('edit_close_modal')) {
      messageType = 'close';
      inputId = 'close_message';
      settingsProperty = 'closingMessage';
    } else {
      await interaction.reply({
        content: "Unknown modal type. Please try again.",
        ephemeral: true
      });
      return;
    }
    
    // Get the new message from the submission
    let newMessage;
    try {
      newMessage = interaction.fields.getTextInputValue(inputId);
    } catch (fieldError) {
      console.error(`Error getting field ${inputId}:`, fieldError);
      await interaction.reply({
        content: `Error retrieving your input. Please try again.`,
        ephemeral: true
      });
      return;
    }
    
    // Get the server instance
    const instance = getInstanceForInteraction(interaction);
    if (!instance) {
      await interaction.reply({
        content: "❌ Server instance not found. Please set up the WhatsApp bridge first.",
        ephemeral: true
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
      case 'welcome':
        if (instance.whatsAppHandler) instance.whatsAppHandler.welcomeMessage = newMessage;
        break;
      case 'intro':
        if (instance.whatsAppHandler) instance.whatsAppHandler.introMessage = newMessage;
        break;
      case 'reopen':
        if (instance.whatsAppHandler) instance.whatsAppHandler.reopenTicketMessage = newMessage;
        break;
      case 'vouch':
        if (instance.vouchHandler && typeof instance.vouchHandler.setCustomVouchMessage === 'function') {
          instance.vouchHandler.setCustomVouchMessage(newMessage);
        }
        break;
      case 'vouch_success':
        instance.customSettings.vouchSuccessMessage = newMessage;
        break;
      case 'close':
        instance.customSettings.closingMessage = newMessage;
        if (instance.ticketManager && typeof instance.ticketManager.setCustomCloseMessage === 'function') {
          instance.ticketManager.setCustomCloseMessage(newMessage);
        }
        break;
    }
    
    // Save the settings
    try {
      // First try using instance method if available
      if (typeof instance.saveSettingsToDisk === 'function') {
        await instance.saveSettingsToDisk({ [settingsProperty]: newMessage });
      }
      
      // Also try the bridge manager method
      const bridgeManager = getBridgeInstanceManager();
      if (bridgeManager && typeof bridgeManager.saveInstanceSettings === 'function') {
        await bridgeManager.saveInstanceSettings(instance.instanceId, instance.customSettings);
      }
    } catch (saveError) {
      console.error(`Error saving settings:`, saveError);
    }
    
    // Show preview with variables replaced
    let previewMessage = newMessage;
    if (messageType !== 'welcome' && messageType !== 'vouch_success') {
      // Replace variables in preview
      previewMessage = previewMessage
        .replace(/{name}/g, 'John Doe')
        .replace(/{phoneNumber}/g, '+1234567890');
    }
    
    // Display the message type in a readable format
    const readableMessageType = {
      'welcome': 'welcome',
      'intro': 'introduction',
      'reopen': 'ticket reopening',
      'vouch': 'vouch command',
      'vouch_success': 'vouch success',
      'close': 'closing'
    }[messageType];
    
    // Confirm successful update
    await interaction.reply({
      content: `✅ The ${readableMessageType} message has been updated!\n\n**New Message:**\n${previewMessage}`,
      ephemeral: true
    });
    
    console.log(`[DiscordCommands] ${messageType} message updated successfully by ${interaction.user.tag}`);
  } catch (error) {
    console.error(`Error processing modal submission:`, error);
    
    // Handle errors
    try {
      await interaction.reply({
        content: `❌ Error updating message: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error(`Error sending error message:`, replyError);
    }
  }
}

/**
 * Handle change transcript channel button click
 * @param {Interaction} interaction - The button interaction
 */
async function handleChangeTranscriptChannel(interaction) {
  try {
    await interaction.deferUpdate();
    
    // Get all text channels in the guild
    const textChannels = interaction.guild.channels.cache.filter(
      c => c.type === ChannelType.GuildText
    );
    
    if (textChannels.size === 0) {
      await interaction.followUp({
        content: "❌ No text channels found in this server.",
        ephemeral: true
      });
      return;
    }
    
    // Create select menu with text channels
    const channelOptions = textChannels
      .map(channel => ({
        label: channel.name,
        value: channel.id,
        description: "Channel for saving ticket transcripts"
      }))
      .slice(0, 25); // Discord limit
    
    // Create the select menu
    const row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('transcript_channel_select')
          .setPlaceholder('Select a channel for transcripts')
          .addOptions(channelOptions)
      );
    
    // Send the select menu
    await interaction.editReply({
      content: "Select a channel to use for transcript saving:",
      components: [row]
    });
  } catch (error) {
    console.error("Error showing transcript channel select:", error);
    await safeReply(interaction, `❌ Error: ${error.message}`, true);
  }
}

async function handleChangeVouchChannel(interaction) {
  try {
    await interaction.deferUpdate();
    
    // Get all text channels in the guild
    const textChannels = interaction.guild.channels.cache.filter(
      c => c.type === ChannelType.GuildText
    );
    
    if (textChannels.size === 0) {
      await interaction.followUp({
        content: "❌ No text channels found in this server.",
        ephemeral: true
      });
      return;
    }
    
    // Create select menu with text channels
    const channelOptions = textChannels
      .map(channel => ({
        label: channel.name,
        value: channel.id,
        description: "Channel for posting vouches"
      }))
      .slice(0, 25); // Discord limit
    
    // Create the select menu
    const row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('vouch_channel_select')
          .setPlaceholder('Select a channel for vouches')
          .addOptions(channelOptions)
      );
    
    // Send the select menu
    await interaction.editReply({
      content: "Select a channel to use for vouches:",
      components: [row]
    });
  } catch (error) {
    console.error("Error showing vouch channel select:", error);
    await safeReply(interaction, `❌ Error: ${error.message}`, true);
  }
}

async function handleChannelSelect(interaction) {
  try {
    await interaction.deferUpdate();
    
    // Get instance
    const instance = getInstanceForInteraction(interaction);
    
    if (!instance) {
      await interaction.editReply({
        content: '❌ Could not find WhatsApp configuration. Please run /setup first.',
        components: []
      });
      return;
    }
    
    // Get the selected channel ID
    const channelId = interaction.values[0];
    const channel = interaction.guild.channels.cache.get(channelId);
    
    if (!channel) {
      await interaction.editReply({
        content: '❌ Selected channel not found. Please try again.',
        components: []
      });
      return;
    }
    
    // Determine which type of channel we're setting
    const selectType = interaction.customId;
    let settingKey = '';
    let displayName = '';
    
    if (selectType === 'transcript_channel_select') {
      settingKey = 'transcriptChannelId';
      displayName = 'transcript';
    } else if (selectType === 'vouch_channel_select') {
      settingKey = 'vouchChannelId';
      displayName = 'vouch';
    } else {
      await interaction.editReply({
        content: `❌ Unknown selection type: ${selectType}`,
        components: []
      });
      return;
    }
    
    // CRITICAL FIX: Update both instance property AND customSettings
    instance[settingKey] = channelId;
    
    if (!instance.customSettings) {
      instance.customSettings = {};
    }
    instance.customSettings[settingKey] = channelId;
    
    // Update component-specific settings based on channel type
    if (settingKey === 'transcriptChannelId') {
      // Update the transcript manager if available
      if (instance.transcriptManager) {
        instance.transcriptManager.transcriptChannelId = channelId;
        instance.transcriptManager.localOnly = false; // Enable Discord sending
        
        // Enable transcripts if they were disabled
        instance.customSettings.transcriptsEnabled = true;
        instance.transcriptManager.isDisabled = false;
      }
    } else if (settingKey === 'vouchChannelId') {
      // Update the vouch handler if available
      if (instance.vouchHandler) {
        instance.vouchHandler.vouchChannelId = channelId;
        
        // Enable vouches if they were disabled
        instance.customSettings.vouchEnabled = true;
        instance.vouchHandler.isDisabled = false;
      }
    }
    
    // Save settings using BOTH methods to ensure persistence
    
    // 1. Update bridge manager config
    try {
      const bridgeInstanceManager = getBridgeInstanceManager();
      if (bridgeInstanceManager && typeof bridgeInstanceManager.saveInstanceSettings === 'function') {
        // Include both channel ID and related enabled flag
        const configUpdate = {
          [settingKey]: channelId
        };
        
        if (settingKey === 'transcriptChannelId') {
          configUpdate.transcriptsEnabled = true;
        } else if (settingKey === 'vouchChannelId') {
          configUpdate.vouchEnabled = true;
        }
        
        await bridgeInstanceManager.saveInstanceSettings(instance.instanceId, configUpdate);
      }
    } catch (saveError) {
      console.error(`Error saving channel settings to bridge manager:`, saveError);
    }
    
    // 2. Direct save to disk if available
    try {
      if (typeof instance.saveSettingsToDisk === 'function') {
        // Include both channel ID and related enabled flag
        const diskUpdate = {
          [settingKey]: channelId
        };
        
        if (settingKey === 'transcriptChannelId') {
          diskUpdate.transcriptsEnabled = true;
        } else if (settingKey === 'vouchChannelId') {
          diskUpdate.vouchEnabled = true;
        }
        
        await instance.saveSettingsToDisk(diskUpdate);
      }
    } catch (diskError) {
      console.error(`Error saving channel settings to disk:`, diskError);
    }
    
    // 3. Last resort: direct file update
    try {
      const fs = require('fs');
      const path = require('path');
      const instanceDir = path.join(__dirname, 'instances', instance.instanceId);
      const settingsPath = path.join(instanceDir, 'settings.json');
      
      if (!fs.existsSync(instanceDir)) {
        fs.mkdirSync(instanceDir, { recursive: true });
      }
      
      let settings = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (parseError) {
          console.error(`Error parsing settings file:`, parseError);
        }
      }
      
      // Update settings
      settings[settingKey] = channelId;
      if (settingKey === 'transcriptChannelId') {
        settings.transcriptsEnabled = true;
      } else if (settingKey === 'vouchChannelId') {
        settings.vouchEnabled = true;
      }
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch (fileError) {
      console.error(`Error with direct file update:`, fileError);
    }
    
    // Re-construct the feature toggle row with updated state
    const featureRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_transcripts')
          .setLabel(`Transcripts: ${instance.customSettings.transcriptsEnabled !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(instance.customSettings.transcriptsEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('toggle_vouches')
          .setLabel(`Vouches: ${instance.customSettings.vouchEnabled !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(instance.customSettings.vouchEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('toggle_closing_messages')
          .setLabel(`Closing Messages: ${instance.customSettings.sendClosingMessage !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(instance.customSettings.sendClosingMessage !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
      
    // Add channel configuration buttons
    const channelRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('change_transcript_channel')
          .setLabel('Change Transcript Channel')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('change_vouch_channel')
          .setLabel('Change Vouch Channel')
          .setStyle(ButtonStyle.Primary)
      );
    
    // Update the message with success notification and buttons
    await interaction.editReply({
      content: `✅ ${displayName} channel updated to <#${channelId}>!`,
      components: [featureRow, channelRow]
    });
    
  } catch (error) {
    console.error('Error handling channel selection:', error);
    
    try {
      await interaction.followUp({
        content: `❌ Error updating channel: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error('Error sending error message:', replyError);
    }
  }
}

async function handleCancelChannelSelect(interaction) {
  try {
    await interaction.deferUpdate();
    
    // Get instance
    const instance = getInstanceForInteraction(interaction);
    
    if (!instance) {
      await interaction.editReply({
        content: '❌ Could not find WhatsApp configuration. Please run /setup first.',
        components: []
      });
      return;
    }
    
    // Re-construct the feature toggle row with updated state
    const featureRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_transcripts')
          .setLabel(`Transcripts: ${instance.customSettings.transcriptsEnabled !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(instance.customSettings.transcriptsEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('toggle_vouches')
          .setLabel(`Vouches: ${instance.customSettings.vouchEnabled !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(instance.customSettings.vouchEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('toggle_closing_messages')
          .setLabel(`Closing Messages: ${instance.customSettings.sendClosingMessage !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(instance.customSettings.sendClosingMessage !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
      
    // Add channel configuration buttons
    const channelRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('change_transcript_channel')
          .setLabel('Change Transcript Channel')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('change_vouch_channel')
          .setLabel('Change Vouch Channel')
          .setStyle(ButtonStyle.Primary)
      );
    
    // Update the message
    await interaction.editReply({
      content: `Channel selection cancelled.`,
      components: [featureRow, channelRow]
    });
    
  } catch (error) {
    console.error('Error handling cancel button:', error);
    
    try {
      await interaction.followUp({
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error('Error sending error message:', replyError);
    }
  }
}


/**
 * Handle toggle features button with proper component refreshing
 */
async function handleToggleFeature(interaction) {
  try {
    await interaction.deferUpdate();
    
    // Get instance
    const instance = getInstanceForInteraction(interaction);
    
    if (!instance) {
      await interaction.editReply({
        content: '❌ Could not find WhatsApp configuration.',
        components: []
      });
      return;
    }
    
    // Initialize customSettings if needed
    if (!instance.customSettings) {
      instance.customSettings = {};
    }
    
    // Determine which feature is being toggled
    const featureType = interaction.customId;
    let settingKey = '';
    let displayName = '';
    
    // Declare currentValue at the function level scope
    let currentValue = false;
    
    switch (featureType) {
      case 'toggle_transcripts':
        settingKey = 'transcriptsEnabled';
        displayName = 'Transcripts';
        break;
      case 'toggle_vouches':
        settingKey = 'vouchEnabled';
        displayName = 'Vouches';
        break;
      case 'toggle_closing_messages':
        settingKey = 'sendClosingMessage';
        displayName = 'Closing Messages';
        break;
      default:
        return;
    }
    
    // Get current value
    currentValue = instance.customSettings[settingKey] !== false;
    
    // Toggle the value
    const newValue = !currentValue;
    
    // Update settings
    instance.customSettings[settingKey] = newValue;
    
    // Save settings
    await getBridgeInstanceManager().saveInstanceSettings(instance.instanceId, {
      [settingKey]: newValue
    });
    
    // IMPORTANT: Immediately apply settings to relevant components
    if (settingKey === 'transcriptsEnabled' && instance.transcriptManager) {
      instance.transcriptManager.isDisabled = !newValue;
      console.log(`Set transcriptManager.isDisabled to ${!newValue}`);
    } else if (settingKey === 'vouchEnabled' && instance.vouchHandler) {
      instance.vouchHandler.isDisabled = !newValue;
      console.log(`Set vouchHandler.isDisabled to ${!newValue}`);
    }
    
    // Recreate ALL buttons with current state
    const categoryRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('edit_welcome_category')
          .setLabel('Welcome Messages')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👋'),
        new ButtonBuilder()
          .setCustomId('edit_ticket_category')
          .setLabel('Ticket Messages')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📋'),
        new ButtonBuilder()
          .setCustomId('edit_vouch_category')
          .setLabel('Vouch Messages')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⭐')
      );
    
    // Create feature toggle row with CURRENT values
    const featureRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_transcripts')
          .setLabel(`Transcripts: ${instance.customSettings.transcriptsEnabled !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(instance.customSettings.transcriptsEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('toggle_vouches')
          .setLabel(`Vouches: ${instance.customSettings.vouchEnabled !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(instance.customSettings.vouchEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('toggle_closing_messages')
          .setLabel(`Closing Messages: ${instance.customSettings.sendClosingMessage !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(instance.customSettings.sendClosingMessage !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    
    // Completely reconstruct the message
    await interaction.editReply({
      content: '📝 **Edit WhatsApp Bot Messages**\n\nSelect a category of messages to edit or toggle features below.',
      components: [categoryRow, featureRow]
    });
    
  } catch (error) {
    console.error('Error handling toggle feature:', error);
    await interaction.followUp({
      content: `❌ Error: ${error.message}`,
      ephemeral: true
    });
  }
}

async function showEditModal(interaction, messageType) {
  try {
    // Get instance
    const instance = getInstanceForInteraction(interaction);
    
    if (!instance) {
      await interaction.reply({
        content: '❌ Could not find WhatsApp configuration. Please run /setup first.',
        ephemeral: true
      });
      return;
    }
    
    // Configure modal based on message type
    let modalId, modalTitle, inputId, currentValue, placeholderValue;
    
    switch (messageType) {
      case 'welcome':
        modalId = 'edit_welcome_modal';
        modalTitle = 'Edit Welcome Message';
        inputId = 'welcome_message';
        currentValue = instance.customSettings?.welcomeMessage || 
                      "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
        placeholderValue = "Welcome to Support! What's your name?";
        break;
        
      case 'intro':
        modalId = 'edit_intro_modal';
        modalTitle = 'Edit Introduction Message';
        inputId = 'intro_message';
        currentValue = instance.customSettings?.introMessage || 
                      "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
        placeholderValue = "Nice to meet you, {name}! Setting up your ticket now...";
        break;
        
      case 'reopen':
        modalId = 'edit_reopen_modal';
        modalTitle = 'Edit Reopen Message';
        inputId = 'reopen_message';
        currentValue = instance.customSettings?.reopenTicketMessage || 
                      "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
        placeholderValue = "Welcome back, {name}! Our team will assist you.";
        break;
        
      case 'vouch':
        modalId = 'edit_vouch_modal';
        modalTitle = 'Edit Vouch Message';
        inputId = 'vouch_message';
        currentValue = instance.customSettings?.vouchMessage || 
                      "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
        placeholderValue = "Hey {name}! Thanks for using our service! We'd love your feedback...";
        break;
        
      case 'vouch_success':
        modalId = 'edit_vouch_success_modal';
        modalTitle = 'Edit Vouch Success Message';
        inputId = 'vouch_success_message';
        currentValue = instance.customSettings?.vouchSuccessMessage || 
                      "✅ Thank you for your vouch! It has been posted to our community channel.";
        placeholderValue = "Thank you for your vouch! It has been posted.";
        break;
      
      case 'close':
        modalId = 'edit_close_modal';
        modalTitle = 'Edit Closing Message';
        inputId = 'close_message';
        currentValue = instance.customSettings?.closingMessage || 
                      "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
        placeholderValue = "Thank you for contacting support. Your ticket is being closed.";
        break;
        
      default:
        throw new Error(`Unknown message type: ${messageType}`);
    }
    
    // IMPORTANT: Ensure text values don't exceed Discord's limits
    if (currentValue.length > 3900) {
      currentValue = currentValue.substring(0, 3900);
    }
    
    if (placeholderValue.length > 100) {
      placeholderValue = placeholderValue.substring(0, 100);
    }
    
    // Create modal with simple title
    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(modalTitle);
    
    // Create text input with simplified label
    const textInput = new TextInputBuilder()
      .setCustomId(inputId)
      .setLabel("Edit message content")  // Simple fixed label
      .setStyle(TextInputStyle.Paragraph)
      .setValue(currentValue)
      .setPlaceholder(placeholderValue)
      .setRequired(true);
    
    // Add input to modal
    const actionRow = new ActionRowBuilder().addComponents(textInput);
    modal.addComponents(actionRow);
    
    // Show the modal
    await interaction.showModal(modal);
    
  } catch (error) {
    console.error(`Error showing edit modal for ${messageType}:`, error);
    console.error(error.stack);  // Log the full stack trace
    
    // Try to respond with an error message
    try {
      await interaction.reply({
        content: `❌ Error showing edit form: ${error.message}. Please try again.`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error('Error sending error message:', replyError);
    }
  }
}

async function handleEditWelcomeMessage(interaction) {
  await showEditModal(interaction, 'welcome');
}

async function handleEditIntroMessage(interaction) {
  await showEditModal(interaction, 'intro');
}

async function handleEditReopenMessage(interaction) {
  await showEditModal(interaction, 'reopen');
}

async function handleEditCloseMessage(interaction) {
  await showEditModal(interaction, 'close');
}

async function handleEditVouchMessage(interaction) {
  await showEditModal(interaction, 'vouch');
}

async function handleEditVouchSuccessMessage(interaction) {
  await showEditModal(interaction, 'vouch_success');
}


/**
 * Handle message type selection with improved error handling and fallbacks
 */
async function handleMessageTypeSelect(interaction) {
  try {
    // Extract the message type directly without deferring first
    const messageType = interaction.values[0];
    console.log(`Selected message type: ${messageType}`);
    
    // Get the instance
    const instance = getInstanceForInteraction(interaction);
    
    // Create different modals based on the message type without updating the message
    switch(messageType) {
      case 'welcome':
        await showEditModal('welcome', interaction, instance);
        break;
      case 'intro': 
        await showEditModal('intro', interaction, instance);
        break;
      case 'reopen':
        await showEditModal('reopen', interaction, instance);
        break;
      case 'vouch':
        await showEditModal('vouch', interaction, instance);
        break;
      case 'vouch_success':
        await showEditModal('vouch_success', interaction, instance);
        break;
      case 'close':
        await showEditModal('close', interaction, instance);
        break;
      default:
        // If we don't know the type, just update the message
        await interaction.update({
          content: "Unknown message type selected. Please try again.",
          components: buildEditMessageComponents(instance)
        });
    }
  } catch (error) {
    console.error(`Error in handleMessageTypeSelect: ${error.message}`);
    // Don't try to respond to the interaction here - it might already be handled
  }
}

/**
 * Create and show a modal for editing a specific message type
 */
async function createAndShowModal(interaction, messageType, instance) {
  // Set up modal configuration based on message type
  let modalId, modalTitle, inputId, defaultText;
  
  switch(messageType) {
    case 'welcome':
      modalId = 'edit_welcome_modal';
      modalTitle = 'Edit Welcome Message';
      inputId = 'welcome_message';
      defaultText = instance?.customSettings?.welcomeMessage || 
        "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
      break;
      
    case 'intro':
      modalId = 'edit_intro_modal';
      modalTitle = 'Edit Introduction Message';
      inputId = 'intro_message';
      defaultText = instance?.customSettings?.introMessage || 
        "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
      break;
      
    case 'reopen':
      modalId = 'edit_reopen_modal';
      modalTitle = 'Edit Reopen Message';
      inputId = 'reopen_message';
      defaultText = instance?.customSettings?.reopenTicketMessage || 
        "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
      break;
      
    case 'vouch':
      modalId = 'edit_vouch_modal';
      modalTitle = 'Edit Vouch Message';
      inputId = 'vouch_message';
      defaultText = instance?.customSettings?.vouchMessage || 
        "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
      break;
      
    case 'vouch_success':
      modalId = 'edit_vouch_success_modal';
      modalTitle = 'Edit Vouch Success Message';
      inputId = 'vouch_success_message';
      defaultText = instance?.customSettings?.vouchSuccessMessage || 
        "✅ Thank you for your vouch! It has been posted to our community channel.";
      break;
      
    case 'close':
      modalId = 'edit_close_modal';
      modalTitle = 'Edit Closing Message';
      inputId = 'close_message';
      defaultText = instance?.customSettings?.closingMessage || 
        "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
      break;
      
    default:
      throw new Error(`Unknown message type: ${messageType}`);
  }
  
  // Create a clean modal
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(modalTitle);
  
  // Add a single text input
  const textInput = new TextInputBuilder()
    .setCustomId(inputId)
    .setLabel("Message")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(defaultText)
    .setRequired(true);
  
  // Add input to modal
  modal.addComponents(new ActionRowBuilder().addComponents(textInput));
  
  // Show the modal
  await interaction.showModal(modal);
}

/**
 * Build the components for the edit message UI
 */
function buildEditMessageComponents(instance) {
  const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  
  // Create message type selection menu
  const selectRow = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('message_type_select')
        .setPlaceholder('Select message type to edit')
        .addOptions([
          {
            label: 'Welcome Message',
            description: 'First message to new users',
            value: 'welcome'
          },
          {
            label: 'Introduction Message',
            description: 'After user provides their name',
            value: 'intro'
          },
          {
            label: 'Reopen Ticket Message',
            description: 'When user contacts again',
            value: 'reopen'
          },
          {
            label: 'Vouch Command Message',
            description: 'Instructions when using !vouch',
            value: 'vouch'
          },
          {
            label: 'Vouch Success Message',
            description: 'After a successful vouch',
            value: 'vouch_success'
          },
          {
            label: 'Closing Message',
            description: 'Message when closing a ticket',
            value: 'close'
          }
        ])
    );
  
  // Create feature toggle buttons
  const featureRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_transcripts')
        .setLabel(`Transcripts: ${instance?.customSettings?.transcriptsEnabled !== false ? 'Enabled' : 'Disabled'}`)
        .setStyle(instance?.customSettings?.transcriptsEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('toggle_vouches')
        .setLabel(`Vouches: ${instance?.customSettings?.vouchEnabled !== false ? 'Enabled' : 'Disabled'}`)
        .setStyle(instance?.customSettings?.vouchEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('toggle_closing_messages')
        .setLabel(`Closing Messages: ${instance?.customSettings?.sendClosingMessage !== false ? 'Enabled' : 'Disabled'}`)
        .setStyle(instance?.customSettings?.sendClosingMessage !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
  
  return [selectRow, featureRow];
}


/**
 * Refresh the main edit message components
 * Used to ensure components stay fresh after interactions
 */
async function refreshMainEditComponents(message, instance) {
  // If message is an interaction, get the message from it
  const targetMessage = message.message || message;
  
  if (!targetMessage || !targetMessage.edit) {
    console.error('Invalid message object for refresh');
    return false;
  }
  
  try {
    // Build fresh components
    const components = buildEditMessageComponents(instance);
    
    // Edit the message with fresh components
    await targetMessage.edit({
      components: components
    });
    
    return true;
  } catch (error) {
    console.error('Error refreshing main edit components:', error);
    return false;
  }
}

/**
 * Helper function to get the instance responsible for this interaction
 */
function getInstanceForInteraction(interaction) {
  if (!interaction.guildId) return null;
  
  // IMPORTANT: Skip instance check for customize_messages_modal
  // This needs to be processed even without an instance
  if (interaction.isModalSubmit() && interaction.customId === "customize_messages_modal") {
    console.log("Skipping instance check for customize_messages_modal");
    return { customSettings: {}, isTemporary: true };
  }
  
  try {
    // Access bridgeInstanceManager
    const bridgeInstanceManager = getBridgeInstanceManager();
    
    // Check channel parent ID first for more specific matching
    if (interaction.channel && interaction.channel.parentId) {
      const categoryId = interaction.channel.parentId;
      
      // Check if Discord client has instance routes
      if (interaction.client._instanceRoutes && interaction.client._instanceRoutes.has(categoryId)) {
        const routeInfo = interaction.client._instanceRoutes.get(categoryId);
        return routeInfo.instance || bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
      }
    }
    
    // Fall back to guild ID matching
    return bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
  } catch (error) {
    console.error("Error getting instance for interaction:", error);
    return null;
  }
}


/**
 * Get readable name for a message type
 */
function getReadableMessageType(messageType) {
  const types = {
    'welcome': 'Welcome',
    'intro': 'Introduction',
    'reopen': 'Ticket Reopening',
    'vouch': 'Vouch Command',
    'vouch_success': 'Vouch Success',
    'close': 'Closing'
  };
  
  return types[messageType] || messageType;
}

async function handleWelcomeCategoryClick(interaction) {
  try {
    // Get instance
    const instance = getInstanceForInteraction(interaction);
    
    if (!instance) {
      await interaction.update({
        content: '❌ Could not find WhatsApp configuration. Please run /setup first.',
        components: []
      });
      return;
    }
    
    // Get current settings
    const currentSettings = {
      welcomeMessage: "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
      introMessage: "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
      ...instance.customSettings
    };
    
    // Create buttons for each message type in this category
    const messageButtonsRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('edit_welcome_message')
          .setLabel('First Welcome Message')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✉️'),
        new ButtonBuilder()
          .setCustomId('edit_intro_message')
          .setLabel('After-Name Message')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📝')
      );
    
    // Create back button
    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('edit_back_to_main')
          .setLabel('Back to Categories')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // Update with message options
    await interaction.update({
      content: '📝 **Edit Welcome Messages**\n\nChoose which welcome message to edit:',
      components: [messageButtonsRow, backRow]
    });
    
  } catch (error) {
    console.error('Error handling welcome category click:', error);
    await interaction.update({
      content: `❌ Error: ${error.message}`,
      components: []
    });
  }
}

// Ticket Messages Category Handler
async function handleTicketCategoryClick(interaction) {
  try {
    // Get instance
    const instance = getInstanceForInteraction(interaction);
    
    if (!instance) {
      await interaction.update({
        content: '❌ Could not find WhatsApp configuration. Please run /setup first.',
        components: []
      });
      return;
    }
    
    // Get current settings
    const currentSettings = {
      reopenTicketMessage: "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
      closingMessage: "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
      ...instance.customSettings
    };
    
    // Create buttons for each message type in this category
    const messageButtonsRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('edit_reopen_message')
          .setLabel('Reopen Ticket Message')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔄'),
        new ButtonBuilder()
          .setCustomId('edit_close_message')
          .setLabel('Closing Message')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔒')
      );
    
    // Create back button
    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('edit_back_to_main')
          .setLabel('Back to Categories')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // Update with message options
    await interaction.update({
      content: '📝 **Edit Ticket Messages**\n\nChoose which ticket message to edit:',
      components: [messageButtonsRow, backRow]
    });
    
  } catch (error) {
    console.error('Error handling ticket category click:', error);
    await interaction.update({
      content: `❌ Error: ${error.message}`,
      components: []
    });
  }
}

// Vouch Messages Category Handler
async function handleVouchCategoryClick(interaction) {
  try {
    // Get instance
    const instance = getInstanceForInteraction(interaction);
    
    if (!instance) {
      await interaction.update({
        content: '❌ Could not find WhatsApp configuration. Please run /setup first.',
        components: []
      });
      return;
    }
    
    // Get current settings
    const currentSettings = {
      vouchMessage: "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.",
      vouchSuccessMessage: "✅ Thank you for your vouch! It has been posted to our community channel.",
      ...instance.customSettings
    };
    
    // Create buttons for each message type in this category
    const messageButtonsRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('edit_vouch_message')
          .setLabel('Vouch Command Message')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📣'),
        new ButtonBuilder()
          .setCustomId('edit_vouch_success_message')
          .setLabel('Vouch Success Message')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✅')
      );
    
    // Create back button
    const backRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('edit_back_to_main')
          .setLabel('Back to Categories')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // Update with message options
    await interaction.update({
      content: '📝 **Edit Vouch Messages**\n\nChoose which vouch message to edit:',
      components: [messageButtonsRow, backRow]
    });
    
  } catch (error) {
    console.error('Error handling vouch category click:', error);
    await interaction.update({
      content: `❌ Error: ${error.message}`,
      components: []
    });
  }
}

// Back to main menu handler
async function handleBackToMainClick(interaction) {
  try {
    // Get instance
    const instance = getInstanceForInteraction(interaction);
    
    if (!instance) {
      await interaction.update({
        content: '❌ Could not find WhatsApp configuration. Please run /setup first.',
        components: []
      });
      return;
    }
    
    // Get current settings with proper defaults
    const currentSettings = {
      welcomeMessage: "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
      introMessage: "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
      reopenTicketMessage: "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
      newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
      closingMessage: "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
      vouchMessage: "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.",
      vouchSuccessMessage: "✅ Thank you for your vouch! It has been posted to our community channel.",
      sendClosingMessage: true,
      transcriptsEnabled: true,
      vouchEnabled: true,
      ...instance.customSettings // Override with actual instance settings
    };
    
    // Create category buttons for message editing
    const categoryRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('edit_welcome_category')
          .setLabel('Welcome Messages')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👋'),
        new ButtonBuilder()
          .setCustomId('edit_ticket_category')
          .setLabel('Ticket Messages')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📋'),
        new ButtonBuilder()
          .setCustomId('edit_vouch_category')
          .setLabel('Vouch Messages')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⭐')
      );
    
    // Create a row for feature toggles
    const featureRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_transcripts')
          .setLabel(`Transcripts: ${currentSettings.transcriptsEnabled !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(currentSettings.transcriptsEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('toggle_vouches')
          .setLabel(`Vouches: ${currentSettings.vouchEnabled !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(currentSettings.vouchEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('toggle_closing_messages')
          .setLabel(`Closing Messages: ${currentSettings.sendClosingMessage !== false ? 'Enabled' : 'Disabled'}`)
          .setStyle(currentSettings.sendClosingMessage !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    
    // Update with main menu
    await interaction.update({
      content: '📝 **Edit WhatsApp Bot Messages**\n\nSelect a category of messages to edit or toggle features below.',
      components: [categoryRow, featureRow]
    });
    
  } catch (error) {
    console.error('Error handling back button click:', error);
    await interaction.update({
      content: `❌ Error: ${error.message}`,
      components: []
    });
  }
}

/**
 * Master interaction handler for all Discord interactions
 * Properly handles interactions with proper sequencing to avoid modal/message conflicts
 */
async function handleInteraction(interaction) {
  try {
    // Log basic interaction info
    console.log(`Processing interaction: ${interaction.customId || 'No custom ID'}`);
    const discordCommands = require("./modules/discordCommands");

    // MODAL SUBMISSIONS
    if (interaction.isModalSubmit()) {
      console.log(`Modal submitted: ${interaction.customId}`);
      
      if (interaction.customId === "customize_messages_modal") {
        try {
          await discordCommands.handleCustomizeMessagesModalSubmission(interaction);
        } catch (modalError) {
          console.error(`Error handling customize_messages_modal:`, modalError);
          try {
            await interaction.reply({
              content: `Error processing settings: ${modalError.message}. Please try again or use default settings.`,
              ephemeral: true
            });
          } catch (replyError) {
            console.error(`Error replying to modal error:`, replyError);
          }
        }
        return;
      }
  
      
      if (interaction.customId.startsWith('special_channel_modal_')) {
        await specialChannelCommands.handleSpecialChannelModal(interaction);
        return;
      }
      
      if (interaction.customId.startsWith('edit_special_modal_')) {
        await specialChannelCommands.handleEditSpecialModal(interaction);
        return;
      }
      
      // Handle edit message modals
      if (interaction.customId.startsWith("edit_") && interaction.customId.endsWith("_modal")) {
        await handleEditMessageModalSubmit(interaction);
        return;
      }
      
      // Try instance handler for unknown modals
      const instance = getInstanceForInteraction(interaction);
      if (instance && instance.discordHandler) {
        await instance.discordHandler.handleInteraction(interaction);
      }
      return;
    }
    
    // SELECT MENUS
    if (interaction.isStringSelectMenu()) {
      console.log(`Select menu used: ${interaction.customId}`);
      
      // Handle our channel selection menus
      if (interaction.customId === 'transcript_channel_select' || 
          interaction.customId === 'vouch_channel_select') {
        await handleChannelSelect(interaction);
        return;
      }

      if (interaction.customId === 'special_channel_select') {
        await specialChannelCommands.handleSpecialChannelSelect(interaction);
        return;
      }
      
      // Inside the BUTTONS section:
      if (interaction.customId === 'add_special_channel_btn') {
        await specialChannelCommands.handleAddSpecialChannelButton(interaction);
        return;
      }
      
      if (interaction.customId.startsWith('edit_special_')) {
        await specialChannelCommands.handleEditSpecialChannel(interaction);
        return;
      }
      
      if (interaction.customId.startsWith('remove_special_')) {
        await specialChannelCommands.handleRemoveSpecialChannel(interaction);
        return;
      }
      
      if (interaction.customId.startsWith('confirm_remove_special_')) {
        await specialChannelCommands.handleConfirmRemoveSpecial(interaction);
        return;
      }
      
      if (interaction.customId === 'cancel_remove_special') {
        await specialChannelCommands.handleCancelRemoveSpecial(interaction);
        return;
      }
      
      // Inside the MODAL SUBMISSIONS section:
      if (interaction.customId.startsWith('special_channel_modal_')) {
        await specialChannelCommands.handleSpecialChannelModal(interaction);
        return;
      }
      
      if (interaction.customId.startsWith('edit_special_modal_')) {
        await specialChannelCommands.handleEditSpecialModal(interaction);
        return;
      }
      
      // Inside the COMMANDS section (or integrate with existing command handling):
      if (interaction.commandName === 'add-special-channel') {
        await specialChannelCommands.handleAddSpecialChannel(interaction);
        return;
      }
      
      if (interaction.commandName === 'manage-special-channels') {
        await specialChannelCommands.handleManageSpecialChannels(interaction);
        return;
      }
      
      // Forward to command handler for other select menus
      // FIX: Directly import the module to avoid circular dependencies
      await discordCommands.handleCommand(interaction);
      return;
    }
    
    // BUTTONS
    if (interaction.isButton()) {
      console.log(`Button clicked: ${interaction.customId}`);
      
      if (interaction.customId === 'add_special_channel_btn') {
        await specialChannelCommands.handleAddSpecialChannelButton(interaction);
        return;
      }
      
      if (interaction.customId.startsWith('edit_special_')) {
        await specialChannelCommands.handleEditSpecialChannel(interaction);
        return;
      }
      
      if (interaction.customId.startsWith('remove_special_')) {
        await specialChannelCommands.handleRemoveSpecialChannel(interaction);
        return;
      }
      
      if (interaction.customId.startsWith('confirm_remove_special_')) {
        await specialChannelCommands.handleConfirmRemoveSpecial(interaction);
        return;
      }
      
      if (interaction.customId === 'cancel_remove_special') {
        await specialChannelCommands.handleCancelRemoveSpecial(interaction);
        return;
      }

      // Handle toggle feature buttons
      if (interaction.customId === 'toggle_transcripts' || 
          interaction.customId === 'toggle_vouches' || 
          interaction.customId === 'toggle_closing_messages') {
        await handleToggleFeature(interaction);
        return;
      }
      
      // Handle channel change buttons
      if (interaction.customId === 'change_transcript_channel') {
        await discordCommands.andleChangeTranscriptChannel(interaction);
        return;
      }
      
      if (interaction.customId === 'change_vouch_channel') {
        await discordCommands.handleChangeVouchChannel(interaction);
        return;
      }
      
      if (interaction.customId === 'cancel_channel_select') {
        await discordCommands.handleCancelChannelSelect(interaction);
        return;
      }
      
      // Handle setup flow buttons
      if (interaction.customId === "customize_messages") {
        await discordCommands.handleCustomizationFlow(interaction);
        return;
      }
      
      if (interaction.customId === "continue_setup") {
        await discordCommands.handleContinueSetupButton(interaction);
        return;
      }
      
      // Handle category buttons
      if (interaction.customId === 'edit_welcome_category') {
        await handleWelcomeCategoryClick(interaction);
        return;
      }
      
      if (interaction.customId === 'edit_ticket_category') {
        await handleTicketCategoryClick(interaction);
        return;
      }
      
      if (interaction.customId === 'edit_vouch_category') {
        await handleVouchCategoryClick(interaction);
        return;
      }
      
      if (interaction.customId === 'edit_back_to_main') {
        await handleBackToMainClick(interaction);
        return;
      }
      
      // Handle individual message edit buttons 
      if (interaction.customId === 'edit_welcome_message') {
        await handleEditWelcomeMessage(interaction);
        return;
      }
      
      if (interaction.customId === 'edit_intro_message') {
        await handleEditIntroMessage(interaction);
        return;
      }
      
      if (interaction.customId === 'edit_reopen_message') {
        await handleEditReopenMessage(interaction);
        return;
      }
      
      if (interaction.customId === 'edit_close_message') {
        await handleEditCloseMessage(interaction);
        return;
      }
      
      if (interaction.customId === 'edit_vouch_message') {
        await handleEditVouchMessage(interaction);
        return;
      }
      
      if (interaction.customId === 'edit_vouch_success_message') {
        await handleEditVouchSuccessMessage(interaction);
        return;
      }
      
      // Handle instance-specific buttons
      if (interaction.customId.startsWith("edit-user-") || 
          interaction.customId.startsWith("close-ticket-")) {
        const instance = getInstanceForInteraction(interaction);
        if (instance && instance.discordHandler) {
          await instance.discordHandler.handleInteraction(interaction);
        } else {
          await interaction.reply({ 
            content: "Error: This button is no longer valid.",
            ephemeral: true
          });
        }
        return;
      }
      
      // FIX: Directly import the module to avoid circular dependencies
      
      await discordCommands.handleCommand(interaction);
      return;
    }
    
    // COMMANDS
    if (interaction.isCommand()) {
      await discordCommands.handleCommand(interaction);
      return;
    }
    
  } catch (error) {
    console.error("Error in interaction handler:", error);
    console.error(error.stack);
    
    // Try to send an error message if we can
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `An error occurred processing your request: ${error.message}`,
          ephemeral: true
        });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content: `An error occurred processing your request: ${error.message}`
        });
      } else {
        await interaction.followUp({
          content: `An error occurred processing your request: ${error.message}`,
          ephemeral: true
        });
      }
    } catch (responseError) {
      console.error("Error sending error response:", responseError);
    }
  }
}

module.exports = {
  handleInteraction,
  handleEditMessageModalSubmit,
  handleToggleFeature,
  handleMessageTypeSelect,
  refreshMainEditComponents,
  buildEditMessageComponents,
  getInstanceForInteraction,
  getReadableMessageType,
  handleChannelSelect
};
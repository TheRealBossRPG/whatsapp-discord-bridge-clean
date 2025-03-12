// specialChannelCommands.js - Complete implementation for managing special channels

const { 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// Get bridge instance manager
function getBridgeInstanceManager() {
  return require('./modules/BridgeInstanceManager');
}

// Register slash commands for special channels
function registerSpecialChannelCommands(commands) {
  commands.push(
    new SlashCommandBuilder()
      .setName("add-special-channel")
      .setDescription("Add a channel with a custom message when mentioned")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      
    new SlashCommandBuilder()
      .setName("manage-special-channels")
      .setDescription("List, edit or remove special channels")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  );
  
  return commands;
}

// Handle the add-special-channel command
async function handleAddSpecialChannel(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    // Get instance
    const bridgeInstanceManager = getBridgeInstanceManager();
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    
    if (!instance) {
      await interaction.editReply("❌ WhatsApp bridge is not set up for this server. Please use `/setup` first.");
      return;
    }
    
    // Get all text channels in the guild
    const textChannels = interaction.guild.channels.cache.filter(
      c => c.type === ChannelType.GuildText
    );
    
    if (textChannels.size === 0) {
      await interaction.editReply({
        content: "❌ No text channels found in this server."
      });
      return;
    }
    
    // Create select menu with text channels
    const channelOptions = textChannels
      .map(channel => ({
        label: channel.name,
        value: channel.id,
        description: `#${channel.name}`
      }))
      .slice(0, 25); // Discord limit
    
    // Create the select menu
    const row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('special_channel_select')
          .setPlaceholder('Select a channel to make special')
          .addOptions(channelOptions)
      );
    
    // Send the select menu
    await interaction.editReply({
      content: "Select a channel to add special handling for when mentioned:",
      components: [row]
    });
  } catch (error) {
    console.error("Error handling add-special-channel command:", error);
    await interaction.editReply(`❌ Error: ${error.message}`);
  }
}

// Handle the channel selection for special channel
async function handleSpecialChannelSelect(interaction) {
  try {
    
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
    
    // Create a modal for entering the special message
    const modal = new ModalBuilder()
      .setCustomId(`special_channel_modal_${channelId}`)
      .setTitle(`Special Message for #${channel.name}`);
    
    // Add text input for the message
    const messageInput = new TextInputBuilder()
      .setCustomId('special_message')
      .setLabel(`Message to show when #${channel.name} is mentioned`)
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Example: Click here to view our pricing information!')
      .setRequired(true)
      .setMaxLength(1000);
    
    // Add the input to the modal
    const actionRow = new ActionRowBuilder().addComponents(messageInput);
    modal.addComponents(actionRow);
    
    // Show the modal
    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error handling special channel selection:", error);
    
    try {
      await interaction.editReply({
        content: `❌ Error selecting channel: ${error.message}`,
        components: []
      });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}

// Handle the modal submission for adding a special channel
async function handleSpecialChannelModal(interaction) {
  try {
    // Get the channel ID from the modal ID
    const channelId = interaction.customId.replace('special_channel_modal_', '');
    const channel = interaction.guild.channels.cache.get(channelId);
    
    if (!channel) {
      await interaction.reply({
        content: '❌ Selected channel no longer exists.',
        ephemeral: true
      });
      return;
    }
    
    // Get the message from the modal
    const specialMessage = interaction.fields.getTextInputValue('special_message');
    
    // Get the instance
    const bridgeInstanceManager = getBridgeInstanceManager();
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    
    if (!instance) {
      await interaction.reply({
        content: "❌ WhatsApp bridge is not set up for this server. Please use `/setup` first.",
        ephemeral: true
      });
      return;
    }
    
    // Initialize customSettings.specialChannels if needed
    if (!instance.customSettings) {
      instance.customSettings = {};
    }
    
    if (!instance.customSettings.specialChannels) {
      instance.customSettings.specialChannels = {};
    }
    
    // Add the special channel
    instance.customSettings.specialChannels[channelId] = {
      message: specialMessage
    };
    
    // Save the settings to persist this change
    await bridgeInstanceManager.saveInstanceSettings(
      instance.instanceId,
      instance.customSettings
    );
    
    // Confirm to the user
    await interaction.reply({
      content: `✅ Special channel added! When <#${channelId}> is mentioned in messages, it will show:\n\n${specialMessage}`,
      ephemeral: true
    });
  } catch (error) {
    console.error("Error handling special channel modal:", error);
    
    try {
      await interaction.reply({
        content: `❌ Error adding special channel: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}

// Handle the manage-special-channels command
async function handleManageSpecialChannels(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    // Get instance
    const bridgeInstanceManager = getBridgeInstanceManager();
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    
    if (!instance) {
      await interaction.editReply("❌ WhatsApp bridge is not set up for this server. Please use `/setup` first.");
      return;
    }
    
    // Get special channels from instance settings
    const specialChannels = instance.customSettings?.specialChannels || {};
    const specialChannelIds = Object.keys(specialChannels);
    
    if (specialChannelIds.length === 0) {
      // No special channels configured
      const addRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('add_special_channel_btn')
            .setLabel('Add Special Channel')
            .setStyle(ButtonStyle.Primary)
        );
      
      await interaction.editReply({
        content: "📋 **Special Channels**\n\nNo special channels have been configured yet. Click the button below to add one.",
        components: [addRow]
      });
      return;
    }
    
    // Create an embed to list all special channels
    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle('Special Channels')
      .setDescription('These channels have custom messages when mentioned in WhatsApp messages:')
      .setTimestamp();
    
    // Add each special channel to the embed
    for (const channelId of specialChannelIds) {
      const channel = interaction.guild.channels.cache.get(channelId);
      const channelName = channel ? `#${channel.name}` : `Unknown Channel (${channelId})`;
      const message = specialChannels[channelId].message;
      
      embed.addFields({
        name: channelName,
        value: `Message: ${message}`
      });
    }
    
    // Create buttons for each special channel to edit or remove
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let buttonCount = 0;
    
    for (const channelId of specialChannelIds) {
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel) continue;
      
      // Add edit button for this channel
      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`edit_special_${channelId}`)
          .setLabel(`Edit #${channel.name}`)
          .setStyle(ButtonStyle.Primary)
      );
      
      // Add remove button for this channel
      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`remove_special_${channelId}`)
          .setLabel(`Remove #${channel.name}`)
          .setStyle(ButtonStyle.Danger)
      );
      
      buttonCount += 2;
      
      // Discord has a limit of 5 buttons per row
      if (buttonCount >= 4 || specialChannelIds.indexOf(channelId) === specialChannelIds.length - 1) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
        buttonCount = 0;
      }
    }
    
    // Add a row with an "Add New" button if we have room
    if (rows.length < 5) {
      const addRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('add_special_channel_btn')
            .setLabel('Add New Special Channel')
            .setStyle(ButtonStyle.Success)
        );
      
      rows.push(addRow);
    }
    
    // Send the embed with buttons
    await interaction.editReply({
      embeds: [embed],
      components: rows
    });
  } catch (error) {
    console.error("Error handling manage-special-channels command:", error);
    await interaction.editReply(`❌ Error: ${error.message}`);
  }
}

// Handle the add-special-channel button
async function handleAddSpecialChannelButton(interaction) {
  // Same as handleAddSpecialChannel, but this is for the button click
  await interaction.deferUpdate();
  
  try {
    // Get instance
    const bridgeInstanceManager = getBridgeInstanceManager();
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    
    if (!instance) {
      await interaction.editReply("❌ WhatsApp bridge is not set up for this server. Please use `/setup` first.");
      return;
    }
    
    // Get all text channels in the guild
    const textChannels = interaction.guild.channels.cache.filter(
      c => c.type === ChannelType.GuildText
    );
    
    if (textChannels.size === 0) {
      await interaction.editReply({
        content: "❌ No text channels found in this server."
      });
      return;
    }
    
    // Create select menu with text channels
    const channelOptions = textChannels
      .map(channel => ({
        label: channel.name,
        value: channel.id,
        description: `#${channel.name}`
      }))
      .slice(0, 25); // Discord limit
    
    // Create the select menu
    const row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('special_channel_select')
          .setPlaceholder('Select a channel to make special')
          .addOptions(channelOptions)
      );
    
    // Send the select menu
    await interaction.editReply({
      content: "Select a channel to add special handling for when mentioned:",
      components: [row],
      embeds: [] // Clear any embeds
    });
  } catch (error) {
    console.error("Error handling add special channel button:", error);
    await interaction.editReply(`❌ Error: ${error.message}`);
  }
}

// Handle the edit special channel button
async function handleEditSpecialChannel(interaction) {
  try {
    // Get the channel ID from the button ID
    const channelId = interaction.customId.replace('edit_special_', '');
    const channel = interaction.guild.channels.cache.get(channelId);
    
    if (!channel) {
      await interaction.reply({
        content: '❌ Selected channel no longer exists.',
        ephemeral: true
      });
      return;
    }
    
    // Get the instance
    const bridgeInstanceManager = getBridgeInstanceManager();
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    
    if (!instance) {
      await interaction.reply({
        content: "❌ WhatsApp bridge is not set up for this server.",
        ephemeral: true
      });
      return;
    }
    
    // Get the current message for this special channel
    const currentMessage = instance.customSettings?.specialChannels?.[channelId]?.message || '';
    
    // Create a modal for editing the special message
    const modal = new ModalBuilder()
      .setCustomId(`edit_special_modal_${channelId}`)
      .setTitle(`Edit Message for #${channel.name}`);
    
    // Add text input for the message
    const messageInput = new TextInputBuilder()
      .setCustomId('special_message')
      .setLabel(`Message for #${channel.name}`)
      .setStyle(TextInputStyle.Paragraph)
      .setValue(currentMessage)
      .setRequired(true)
      .setMaxLength(1000);
    
    // Add the input to the modal
    const actionRow = new ActionRowBuilder().addComponents(messageInput);
    modal.addComponents(actionRow);
    
    // Show the modal
    await interaction.showModal(modal);
  } catch (error) {
    console.error("Error handling edit special channel:", error);
    
    try {
      await interaction.reply({
        content: `❌ Error editing special channel: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}

// Handle edit special channel modal submission
async function handleEditSpecialModal(interaction) {
  try {
    // Get the channel ID from the modal ID
    const channelId = interaction.customId.replace('edit_special_modal_', '');
    const channel = interaction.guild.channels.cache.get(channelId);
    
    if (!channel) {
      await interaction.reply({
        content: '❌ Selected channel no longer exists.',
        ephemeral: true
      });
      return;
    }
    
    // Get the message from the modal
    const specialMessage = interaction.fields.getTextInputValue('special_message');
    
    // Get the instance
    const bridgeInstanceManager = getBridgeInstanceManager();
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    
    if (!instance) {
      await interaction.reply({
        content: "❌ WhatsApp bridge is not set up for this server.",
        ephemeral: true
      });
      return;
    }
    
    // Check if specialChannels is already initialized
    if (!instance.customSettings) instance.customSettings = {};
    if (!instance.customSettings.specialChannels) instance.customSettings.specialChannels = {};
    
    // Update the special channel
    instance.customSettings.specialChannels[channelId] = {
      message: specialMessage
    };
    
    // Save the settings
    await bridgeInstanceManager.saveInstanceSettings(
      instance.instanceId,
      instance.customSettings
    );
    
    // Confirm to the user
    await interaction.reply({
      content: `✅ Special message for <#${channelId}> updated! When mentioned, it will now show:\n\n${specialMessage}`,
      ephemeral: true
    });
  } catch (error) {
    console.error("Error handling edit special modal:", error);
    
    try {
      await interaction.reply({
        content: `❌ Error updating special channel: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}

// Handle the remove special channel button
async function handleRemoveSpecialChannel(interaction) {
  try {
    await interaction.deferUpdate();
    
    // Get the channel ID from the button ID
    const channelId = interaction.customId.replace('remove_special_', '');
    const channel = interaction.guild.channels.cache.get(channelId);
    
    // Get the instance
    const bridgeInstanceManager = getBridgeInstanceManager();
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    
    if (!instance) {
      await interaction.editReply({
        content: "❌ WhatsApp bridge is not set up for this server.",
        components: [],
        embeds: []
      });
      return;
    }
    
    // Check if specialChannels is already initialized
    if (!instance.customSettings?.specialChannels) {
      await interaction.editReply({
        content: "❌ No special channels configured.",
        components: [],
        embeds: []
      });
      return;
    }
    
    // Create a confirmation button
    const confirmRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_remove_special_${channelId}`)
          .setLabel(`Yes, Remove ${channel ? '#'+channel.name : 'this channel'}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_remove_special')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // Send confirmation message
    await interaction.editReply({
      content: `Are you sure you want to remove the special handling for ${channel ? `<#${channelId}>` : 'this channel'}?`,
      components: [confirmRow],
      embeds: []
    });
  } catch (error) {
    console.error("Error handling remove special channel:", error);
    
    try {
      await interaction.editReply({
        content: `❌ Error removing special channel: ${error.message}`,
        components: [],
        embeds: []
      });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}

// Handle confirmation of removal
async function handleConfirmRemoveSpecial(interaction) {
  try {
    await interaction.deferUpdate();
    
    // Get the channel ID from the button ID
    const channelId = interaction.customId.replace('confirm_remove_special_', '');
    
    // Get the instance
    const bridgeInstanceManager = getBridgeInstanceManager();
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    
    if (!instance || !instance.customSettings?.specialChannels) {
      await interaction.editReply({
        content: "❌ Cannot remove special channel: Configuration not found.",
        components: []
      });
      return;
    }
    
    // Remove the special channel
    delete instance.customSettings.specialChannels[channelId];
    
    // Save the settings
    await bridgeInstanceManager.saveInstanceSettings(
      instance.instanceId,
      instance.customSettings
    );
    
    // Refresh the list of special channels
    await handleManageSpecialChannels(interaction);
  } catch (error) {
    console.error("Error confirming removal of special channel:", error);
    
    try {
      await interaction.editReply({
        content: `❌ Error removing special channel: ${error.message}`,
        components: []
      });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}

// Handle cancellation of removal
async function handleCancelRemoveSpecial(interaction) {
  try {
    // Simply refresh the list of special channels
    await handleManageSpecialChannels(interaction);
  } catch (error) {
    console.error("Error cancelling removal of special channel:", error);
    
    try {
      await interaction.editReply({
        content: `❌ Error: ${error.message}`,
        components: []
      });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}

module.exports = {
  registerSpecialChannelCommands,
  handleAddSpecialChannel,
  handleSpecialChannelSelect,
  handleSpecialChannelModal,
  handleManageSpecialChannels,
  handleAddSpecialChannelButton,
  handleEditSpecialChannel,
  handleEditSpecialModal,
  handleRemoveSpecialChannel,
  handleConfirmRemoveSpecial,
  handleCancelRemoveSpecial
};
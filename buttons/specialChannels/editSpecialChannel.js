// buttons/specialChannels/editSpecialChannel.js
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../../templates/Button');

class EditSpecialChannelButton extends Button {
  constructor() {
    super({
      regex: /^edit_special_\d+/
    });
  }
  
  matches(customId) {
    return customId.startsWith('edit_special_');
  }
  
  async execute(interaction, instance) {
    try {
      // Extract channel ID from the custom ID
      const channelId = interaction.customId.replace('edit_special_', '');
      
      // Get the channel
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel) {
        await interaction.reply({
          content: '❌ Channel not found. It may have been deleted.',
          ephemeral: true
        });
        return;
      }
      
      // Get current message from instance settings
      if (!instance || !instance.customSettings || !instance.customSettings.specialChannels) {
        await interaction.reply({
          content: '❌ Special channel configuration not found.',
          ephemeral: true
        });
        return;
      }
      
      const specialChannel = instance.customSettings.specialChannels[channelId];
      if (!specialChannel) {
        await interaction.reply({
          content: '❌ Special message for this channel not found.',
          ephemeral: true
        });
        return;
      }
      
      // Create a modal for editing the special message
      const modal = new ModalBuilder()
        .setCustomId(`edit_special_modal_${channelId}`)
        .setTitle(`Edit Special Message for #${channel.name}`);
      
      // Add text input for the message, pre-filled with current message
      const messageInput = new TextInputBuilder()
        .setCustomId('special_message')
        .setLabel(`Message to show when #${channel.name} is mentioned`)
        .setStyle(TextInputStyle.Paragraph)
        .setValue(specialChannel.message)
        .setRequired(true)
        .setMaxLength(1000);
      
      // Add the input to the modal
      const actionRow = new ActionRowBuilder().addComponents(messageInput);
      modal.addComponents(actionRow);
      
      // Show the modal
      await interaction.showModal(modal);
    } catch (error) {
      console.error("Error handling edit special channel button:", error);
      
      try {
        await interaction.reply({
          content: `❌ Error: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new EditSpecialChannelButton();
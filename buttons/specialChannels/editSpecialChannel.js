const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../../templates/Button');

class EditSpecialChannelButton extends Button {
  constructor() {
    super({
      regex: /^edit_special_\d+$/
    });
  }
  
  matches(customId) {
    return customId.startsWith('edit_special_');
  }
  
  async execute(interaction, instance) {
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
}

module.exports = new EditSpecialChannelButton();
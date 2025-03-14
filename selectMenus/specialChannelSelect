const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');

class SpecialChannelSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'special_channel_select'
    });
  }
  
  async execute(interaction, instance) {
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
}

module.exports = new SpecialChannelSelectMenu();
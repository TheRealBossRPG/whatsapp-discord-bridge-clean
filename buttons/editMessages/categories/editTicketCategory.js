const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../../templates/Button');

class EditTicketCategoryButton extends Button {
  constructor() {
    super({
      customId: 'edit_ticket_category'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get instance
      if (!instance) {
        await interaction.update({
          content: '❌ Could not find WhatsApp configuration. Please run `/setup` first.',
          components: []
        });
        return;
      }
      
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
}

module.exports = new EditTicketCategoryButton();
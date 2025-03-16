const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../../templates/Button');

class EditWelcomeCategoryButton extends Button {
  constructor() {
    super({
      customId: 'edit_welcome_category'
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
}

module.exports = new EditWelcomeCategoryButton();
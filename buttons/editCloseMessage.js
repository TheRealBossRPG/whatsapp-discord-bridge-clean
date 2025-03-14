const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../templates/Button');

class EditCloseMessageButton extends Button {
  constructor() {
    super({
      customId: 'edit_close_message'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get instance
      if (!instance) {
        await interaction.reply({
          content: '❌ Could not find WhatsApp configuration. Please run `/setup` first.',
          ephemeral: true
        });
        return;
      }

      // Get current settings
      const currentSettings = instance.customSettings || {};
      
      // Current close message with default fallback
      const currentValue = currentSettings.closingMessage || 
        "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
      
      // Create modal
      const modal = new ModalBuilder()
        .setCustomId('edit_close_modal')
        .setTitle('Edit Closing Message');
      
      // Create text input with current value
      const textInput = new TextInputBuilder()
        .setCustomId('close_message')
        .setLabel('Closing Message (sent when ticket closes)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentValue)
        .setPlaceholder("Thank you for contacting support. Your ticket is being closed.")
        .setRequired(true);
      
      // Add input to modal
      const actionRow = new ActionRowBuilder().addComponents(textInput);
      modal.addComponents(actionRow);
      
      // Show the modal
      await interaction.showModal(modal);
    } catch (error) {
      console.error(`Error showing edit close modal:`, error);
      
      // Handle errors
      try {
        await interaction.reply({
          content: `❌ Error showing edit form: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error(`Error sending error message: ${replyError.message}`);
      }
    }
  }
}

module.exports = new EditCloseMessageButton();
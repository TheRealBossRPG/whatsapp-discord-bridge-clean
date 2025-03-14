const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../templates/Button');

class EditReopenMessageButton extends Button {
  constructor() {
    super({
      customId: 'edit_reopen_message'
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
      
      // Current reopen message with default fallback
      const currentValue = currentSettings.reopenTicketMessage || 
        "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
      
      // Create modal
      const modal = new ModalBuilder()
        .setCustomId('edit_reopen_modal')
        .setTitle('Edit Reopen Message');
      
      // Create text input with current value
      const textInput = new TextInputBuilder()
        .setCustomId('reopen_message')
        .setLabel('Reopen Message (when user contacts again)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentValue)
        .setPlaceholder("Welcome back, {name}! Our team will assist you.")
        .setRequired(true);
      
      // Add input to modal
      const actionRow = new ActionRowBuilder().addComponents(textInput);
      modal.addComponents(actionRow);
      
      // Show the modal
      await interaction.showModal(modal);
    } catch (error) {
      console.error(`Error showing edit reopen modal:`, error);
      
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

module.exports = new EditReopenMessageButton();
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('.../../../templates/Button');

class EditWelcomeMessageButton extends Button {
  constructor() {
    super({
      customId: 'edit_welcome_message'
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
      
      // Current welcome message with default fallback
      const currentValue = currentSettings.welcomeMessage || 
        "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
      
      // Create modal
      const modal = new ModalBuilder()
        .setCustomId('edit_welcome_modal')
        .setTitle('Edit Welcome Message');
      
      // Create text input with current value
      const textInput = new TextInputBuilder()
        .setCustomId('welcome_message')
        .setLabel('Welcome Message (first contact)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentValue)
        .setPlaceholder("Welcome to Support! What's your name?")
        .setRequired(true);
      
      // Add input to modal
      const actionRow = new ActionRowBuilder().addComponents(textInput);
      modal.addComponents(actionRow);
      
      // Show the modal
      await interaction.showModal(modal);
    } catch (error) {
      console.error(`Error showing edit welcome modal:`, error);
      
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

module.exports = new EditWelcomeMessageButton();
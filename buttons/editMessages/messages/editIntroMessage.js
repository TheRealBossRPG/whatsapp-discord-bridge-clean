const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../../../templates/Button');

class EditIntroMessageButton extends Button {
  constructor() {
    super({
      customId: 'edit_intro_message'
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
      
      // Current intro message with default fallback
      const currentValue = currentSettings.introMessage || 
        "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
      
      // Create modal
      const modal = new ModalBuilder()
        .setCustomId('edit_intro_modal')
        .setTitle('Edit Introduction Message');
      
      // Create text input with current value
      const textInput = new TextInputBuilder()
        .setCustomId('intro_message')
        .setLabel('Introduction (after user gives name)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentValue)
        .setPlaceholder("Nice to meet you, {name}! Setting up your ticket now...")
        .setRequired(true);
      
      // Add input to modal
      const actionRow = new ActionRowBuilder().addComponents(textInput);
      modal.addComponents(actionRow);
      
      // Show the modal
      await interaction.showModal(modal);
    } catch (error) {
      console.error(`Error showing edit intro modal:`, error);
      
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

module.exports = new EditIntroMessageButton();
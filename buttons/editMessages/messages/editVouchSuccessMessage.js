const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../../../templates/Button');

class EditVouchSuccessMessageButton extends Button {
  constructor() {
    super({
      customId: 'edit_vouch_success_message'
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
      
      // Current vouch success message with default fallback
      const currentValue = currentSettings.vouchSuccessMessage || 
        "✅ Thank you for your vouch! It has been posted to our community channel.";
      
      // Create modal
      const modal = new ModalBuilder()
        .setCustomId('edit_vouch_success_modal')
        .setTitle('Edit Vouch Success Message');
      
      // Create text input with current value
      const textInput = new TextInputBuilder()
        .setCustomId('vouch_success_message')
        .setLabel('Vouch Success Message')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentValue)
        .setPlaceholder("Thank you for your vouch! It has been posted.")
        .setRequired(true);
      
      // Add input to modal
      const actionRow = new ActionRowBuilder().addComponents(textInput);
      modal.addComponents(actionRow);
      
      // Show the modal
      await interaction.showModal(modal);
    } catch (error) {
      console.error(`Error showing edit vouch success modal:`, error);
      
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

module.exports = new EditVouchSuccessMessageButton();
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../templates/Button');

class EditVouchMessageButton extends Button {
  constructor() {
    super({
      customId: 'edit_vouch_message'
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
      
      // Current vouch message with default fallback
      const currentValue = currentSettings.vouchMessage || 
        "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
      
      // Create modal
      const modal = new ModalBuilder()
        .setCustomId('edit_vouch_modal')
        .setTitle('Edit Vouch Message');
      
      // Create text input with current value
      const textInput = new TextInputBuilder()
        .setCustomId('vouch_message')
        .setLabel('Vouch Command Message (for !vouch)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentValue)
        .setPlaceholder("Hey {name}! Thanks for using our service! We'd love your feedback...")
        .setRequired(true);
      
      // Add input to modal
      const actionRow = new ActionRowBuilder().addComponents(textInput);
      modal.addComponents(actionRow);
      
      // Show the modal
      await interaction.showModal(modal);
    } catch (error) {
      console.error(`Error showing edit vouch modal:`, error);
      
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

module.exports = new EditVouchMessageButton();
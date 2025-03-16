// modals/editIntroModal.js
const Modal = require('../../templates/Modal');

class EditIntroModal extends Modal {
  constructor() {
    super({
      customId: 'edit_intro_modal'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get intro message value
      const introMessage = interaction.fields.getTextInputValue('intro_message');
      
      // Get the instance
      if (!instance) {
        await interaction.reply({
          content: "❌ Server instance not found. Please set up the WhatsApp bridge first.",
          ephemeral: true
        });
        return;
      }
      
      // Get current settings
      if (!instance.customSettings) {
        instance.customSettings = {};
      }
      
      // Update intro message
      instance.customSettings.introMessage = introMessage;
      
      // Apply changes to WhatsApp handler
      if (instance.whatsAppHandler) {
        instance.whatsAppHandler.introMessage = introMessage;
      }
      
      // Save settings
      const InstanceManager = require('../../core/InstanceManager');
      await InstanceManager.saveInstanceSettings(
        instance.instanceId,
        instance.customSettings
      );
      
      // Show preview with variables replaced
      const previewMessage = introMessage
        .replace(/{name}/g, 'John Doe')
        .replace(/{phoneNumber}/g, '+1234567890');
      
      // Confirm to user
      await interaction.reply({
        content: `✅ Introduction message has been updated!\n\n**New Message:**\n${previewMessage}`,
        ephemeral: true
      });
      
      console.log(`[DiscordCommands] Introduction message updated successfully by ${interaction.user.tag}`);
    } catch (error) {
      console.error(`Error processing intro modal submission:`, error);
      
      // Handle errors
      await interaction.reply({
        content: `❌ Error updating introduction message: ${error.message}`,
        ephemeral: true
      });
    }
  }
}

module.exports = new EditIntroModal();
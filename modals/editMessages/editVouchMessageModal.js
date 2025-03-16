// modals/editVouchModal.js
const Modal = require('../../templates/Modal');

class EditVouchModal extends Modal {
  constructor() {
    super({
      customId: 'edit_vouch_modal'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get vouch message value
      const vouchMessage = interaction.fields.getTextInputValue('vouch_message');
      
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
      
      // Update vouch message
      instance.customSettings.vouchMessage = vouchMessage;
      
      // Apply changes to vouch handler
      if (instance.vouchHandler && typeof instance.vouchHandler.setCustomVouchMessage === 'function') {
        instance.vouchHandler.setCustomVouchMessage(vouchMessage);
      }
      
      // Save settings
      const bridgeInstanceManager = require('../modules/BridgeInstanceManager');
      await bridgeInstanceManager.saveInstanceSettings(
        instance.instanceId,
        instance.customSettings
      );
      
      // Show preview with variables replaced
      const previewMessage = vouchMessage
        .replace(/{name}/g, 'John Doe')
        .replace(/{phoneNumber}/g, '+1234567890');
      
      // Confirm to user
      await interaction.reply({
        content: `✅ Vouch command message has been updated!\n\n**New Message:**\n${previewMessage}`,
        ephemeral: true
      });
      
      console.log(`[DiscordCommands] Vouch message updated successfully by ${interaction.user.tag}`);
    } catch (error) {
      console.error(`Error processing vouch modal submission:`, error);
      
      // Handle errors
      await interaction.reply({
        content: `❌ Error updating vouch message: ${error.message}`,
        ephemeral: true
      });
    }
  }
}

module.exports = new EditVouchModal();
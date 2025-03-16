// modals/editVouchSuccessModal.js
const Modal = require('../../templates/Modal');

class EditVouchSuccessModal extends Modal {
  constructor() {
    super({
      customId: 'edit_vouch_success_modal'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get vouch success message value
      const vouchSuccessMessage = interaction.fields.getTextInputValue('vouch_success_message');
      
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
      
      // Update vouch success message
      instance.customSettings.vouchSuccessMessage = vouchSuccessMessage;
      
      // Apply changes directly to settings (no direct handler method for this)
      // The vouchHandler will read this from customSettings when needed
      
      // Save settings
      const bridgeInstanceManager = require('../modules/BridgeInstanceManager');
      await bridgeInstanceManager.saveInstanceSettings(
        instance.instanceId,
        instance.customSettings
      );
      
      // Confirm to user (no variable replacement for this message type)
      await interaction.reply({
        content: `✅ Vouch success message has been updated!\n\n**New Message:**\n${vouchSuccessMessage}`,
        ephemeral: true
      });
      
      console.log(`[DiscordCommands] Vouch success message updated successfully by ${interaction.user.tag}`);
    } catch (error) {
      console.error(`Error processing vouch success modal submission:`, error);
      
      // Handle errors
      await interaction.reply({
        content: `❌ Error updating vouch success message: ${error.message}`,
        ephemeral: true
      });
    }
  }
}

module.exports = new EditVouchSuccessModal();
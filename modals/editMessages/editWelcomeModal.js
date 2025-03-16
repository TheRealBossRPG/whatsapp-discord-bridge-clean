// modals/editWelcomeModal.js
const Modal = require('../templates/Modal');

class EditWelcomeModal extends Modal {
  constructor() {
    super({
      customId: 'edit_welcome_modal'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get welcome message value
      const welcomeMessage = interaction.fields.getTextInputValue('welcome_message');
      
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
      
      // Update welcome message
      instance.customSettings.welcomeMessage = welcomeMessage;
      
      // Apply changes to WhatsApp handler
      if (instance.whatsAppHandler) {
        instance.whatsAppHandler.welcomeMessage = welcomeMessage;
      }
      
      // Save settings
      const bridgeInstanceManager = require('../modules/BridgeInstanceManager');
      await bridgeInstanceManager.saveInstanceSettings(
        instance.instanceId,
        instance.customSettings
      );
      
      // Confirm to user
      await interaction.reply({
        content: `✅ Welcome message has been updated!\n\n**New Message:**\n${welcomeMessage}`,
        ephemeral: true
      });
      
      console.log(`[DiscordCommands] Welcome message updated successfully by ${interaction.user.tag}`);
    } catch (error) {
      console.error(`Error processing welcome modal submission:`, error);
      
      // Handle errors
      await interaction.reply({
        content: `❌ Error updating welcome message: ${error.message}`,
        ephemeral: true
      });
    }
  }
}

module.exports = new EditWelcomeModal();
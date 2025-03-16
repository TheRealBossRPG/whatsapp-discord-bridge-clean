// modals/editCloseModal.js
const Modal = require('../../templates/Modal');

class EditCloseModal extends Modal {
  constructor() {
    super({
      customId: 'edit_close_modal'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get close message value
      const closeMessage = interaction.fields.getTextInputValue('close_message');
      
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
      
      // Update close message
      instance.customSettings.closingMessage = closeMessage;
      
      // Apply changes to ticket manager
      if (
        instance.ticketManager && 
        typeof instance.ticketManager.setCustomCloseMessage === 'function'
      ) {
        instance.ticketManager.setCustomCloseMessage(closeMessage);
      }
      
      // Also update Discord handlers if they exist
      if (instance.discordHandler) {
        instance.discordHandler.customCloseMessage = closeMessage;
      }
      if (instance.baileysDiscordHandler) {
        instance.baileysDiscordHandler.customCloseMessage = closeMessage;
      }
      
      // Save settings
      const bridgeInstanceManager = require('../modules/BridgeInstanceManager');
      await bridgeInstanceManager.saveInstanceSettings(
        instance.instanceId,
        instance.customSettings
      );
      
      // Show preview with variables replaced
      const previewMessage = closeMessage
        .replace(/{name}/g, 'John Doe')
        .replace(/{phoneNumber}/g, '+1234567890');
      
      // Confirm to user
      await interaction.reply({
        content: `✅ Closing message has been updated!\n\n**New Message:**\n${previewMessage}`,
        ephemeral: true
      });
      
      console.log(`[DiscordCommands] Closing message updated successfully by ${interaction.user.tag}`);
    } catch (error) {
      console.error(`Error processing close modal submission:`, error);
      
      // Handle errors
      await interaction.reply({
        content: `❌ Error updating closing message: ${error.message}`,
        ephemeral: true
      });
    }
  }
}

module.exports = new EditCloseModal();
// modals/editReopenModal.js
const Modal = require('../templates/Modal');

class EditReopenModal extends Modal {
  constructor() {
    super({
      customId: 'edit_reopen_modal'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get reopen message value
      const reopenMessage = interaction.fields.getTextInputValue('reopen_message');
      
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
      
      // Update reopen message
      instance.customSettings.reopenTicketMessage = reopenMessage;
      
      // Apply changes to WhatsApp handler
      if (instance.whatsAppHandler) {
        instance.whatsAppHandler.reopenTicketMessage = reopenMessage;
      }
      
      // Save settings
      const bridgeInstanceManager = require('../modules/BridgeInstanceManager');
      await bridgeInstanceManager.saveInstanceSettings(
        instance.instanceId,
        instance.customSettings
      );
      
      // Show preview with variables replaced
      const previewMessage = reopenMessage
        .replace(/{name}/g, 'John Doe')
        .replace(/{phoneNumber}/g, '+1234567890');
      
      // Confirm to user
      await interaction.reply({
        content: `✅ Ticket reopening message has been updated!\n\n**New Message:**\n${previewMessage}`,
        ephemeral: true
      });
      
      console.log(`[DiscordCommands] Reopen message updated successfully by ${interaction.user.tag}`);
    } catch (error) {
      console.error(`Error processing reopen modal submission:`, error);
      
      // Handle errors
      await interaction.reply({
        content: `❌ Error updating reopening message: ${error.message}`,
        ephemeral: true
      });
    }
  }
}

module.exports = new EditReopenModal();
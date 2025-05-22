// buttons/disconnect/cancelDisconnectService.js
const Button = require('../../templates/Button');
const InteractionTracker = require('../../utils/InteractionTracker');

class CancelDisconnectServiceButton extends Button {
  constructor() {
    super({
      customId: 'cancel_disconnect_service'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Use InteractionTracker for more reliable handling
      await InteractionTracker.safeDefer(interaction, { ephemeral: true });
      
      await InteractionTracker.safeEdit(interaction, {
        content: "✅ Service disconnection cancelled. Your WhatsApp bridge service will remain active."
      });
      
      // Remove buttons from original message
      try {
        const originalMessage = await interaction.message.fetch();
        
        await originalMessage.edit({
          content: originalMessage.content,
          components: [] // Remove all components
        });
      } catch (editError) {
        console.error("Error updating original message:", editError);
      }
    } catch (error) {
      console.error("Error in cancelDisconnectService button:", error);
      
      try {
        await InteractionTracker.safeEdit(interaction, {
          content: `❌ Error: ${error.message}`
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new CancelDisconnectServiceButton();
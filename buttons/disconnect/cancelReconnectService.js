// buttons/disconnect/cancelReconnectService.js
const Button = require('../../templates/Button');
const InteractionTracker = require('../../utils/InteractionTracker');

class CancelReconnectServiceButton extends Button {
  constructor() {
    super({
      customId: 'cancel_reconnect_service'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Use InteractionTracker for more reliable handling
      await InteractionTracker.safeDefer(interaction, { ephemeral: true });
      
      await InteractionTracker.safeEdit(interaction, {
        content: "✅ Service reconnection cancelled. Your WhatsApp bridge service will remain inactive."
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
      console.error("Error in cancelReconnectService button:", error);
      
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

module.exports = new CancelReconnectServiceButton();
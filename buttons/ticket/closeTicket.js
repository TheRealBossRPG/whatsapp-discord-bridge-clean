const Button = require('../../templates/Button');
const InteractionTracker = require('../../utils/InteractionTracker');
const InstanceManager = require('../../core/InstanceManager');

class CloseTicketButton extends Button {
  constructor() {
    super({
      customId: 'close-ticket',
      regex: /^close-ticket-(.+)$/
    });
  }
  
  async execute(interaction, instance) {
    try {
      await InteractionTracker.safeDefer(interaction, { ephemeral: true });
      
      // IMPORTANT: Use the current channel ID instead of extracting from button ID
      // This is more reliable since we're closing the channel we're currently in
      const channelId = interaction.channelId;
      
      console.log(`[CloseTicketButton] Closing ticket for channel: ${channelId}`);
      
      // Get instance if not provided
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }
      
      if (!instance || !instance.ticketManager) {
        await InteractionTracker.safeEdit(interaction, {
          content: "❌ System error: Ticket manager not available.",
        });
        return false;
      }
      
      // Try to close the ticket - pass the current channel ID, not the extracted one
      const success = await instance.ticketManager.closeTicket(channelId, instance.customSettings?.sendClosingMessage !== false, interaction);
      
      if (!success) {
        await InteractionTracker.safeEdit(interaction, {
          content: '❌ Failed to close ticket. Please try again or check logs.',
        });
        return false;
      }
      
      await InteractionTracker.safeEdit(interaction, {
        content: '✅ Ticket closed successfully!',
      });
      return true;
    } catch (error) {
      console.error(`[CloseTicketButton] Error handling close ticket button:`, error);
      
      await InteractionTracker.safeReply(interaction, {
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
      
      return false;
    }
  }
}

module.exports = new CloseTicketButton();
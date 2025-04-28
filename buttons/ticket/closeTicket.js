// buttons/ticket/closeTicket.js

const Button = require('../../templates/Button');

/**
 * Button handler for closing tickets
 * FIXED: Removed direct InstanceManager import to prevent circular dependency
 */
class CloseTicketButton extends Button {
  constructor() {
    super({
      // The button will handle both formats of close button IDs
      customId: 'close',
      regex: /^(close|close-ticket|close-ticket-.+|close_ticket)$/
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[CloseTicketButton] Processing close ticket interaction: ${interaction.customId}`);
      
      // Defer reply immediately to prevent timeouts
      await interaction.deferReply({ ephemeral: true });
      
      // Get the current channel ID - we'll always close the current channel
      const channelId = interaction.channelId;
      console.log(`[CloseTicketButton] Closing ticket in channel: ${channelId}`);
      
      // Get instance if not provided - FIXED: Avoid circular dependency
      if (!instance) {
        console.log(`[CloseTicketButton] Instance not provided, will use instance from route map`);
        
        // Try to get instance from Discord client route map first
        if (interaction.client._instanceRoutes) {
          // Get the category ID for the current channel
          const categoryId = interaction.channel.parentId;
          if (categoryId && interaction.client._instanceRoutes.has(categoryId)) {
            instance = interaction.client._instanceRoutes.get(categoryId).instance;
            console.log(`[CloseTicketButton] Found instance from route map with ID: ${instance?.instanceId || 'unknown'}`);
          }
        }
        
        // If still no instance, send error
        if (!instance) {
          console.error(`[CloseTicketButton] Could not find instance for this channel`);
          await interaction.editReply({
            content: "❌ System error: Could not find WhatsApp bridge instance for this channel."
          });
          return false;
        }
      }
      
      // Find the ticketManager - check multiple locations
      let ticketManager = null;
      
      if (instance.ticketManager) {
        console.log(`[CloseTicketButton] Found ticketManager directly on instance`);
        ticketManager = instance.ticketManager;
      } else if (instance.managers && instance.managers.ticketManager) {
        console.log(`[CloseTicketButton] Found ticketManager in instance.managers`);
        ticketManager = instance.managers.ticketManager;
      } else {
        console.error(`[CloseTicketButton] Could not find ticketManager in instance`);
        await interaction.editReply({
          content: "❌ System error: Ticket manager not available."
        });
        return false;
      }
      
      // Verify ticketManager has the required method
      if (typeof ticketManager.closeTicket !== 'function') {
        console.error(`[CloseTicketButton] ticketManager does not have closeTicket method`);
        await interaction.editReply({
          content: "❌ System error: Ticket manager is invalid or corrupted."
        });
        return false;
      }
      
      // Close the ticket
      console.log(`[CloseTicketButton] Calling closeTicket method for channel ${channelId}`);
      const shouldSendClosingMessage = instance.customSettings?.sendClosingMessage !== false;
      const success = await ticketManager.closeTicket(channelId, shouldSendClosingMessage, interaction);
      
      // Handle the result
      if (!success) {
        console.error(`[CloseTicketButton] closeTicket returned false`);
        await interaction.editReply({
          content: "❌ Failed to close ticket. Please try again or check logs."
        });
        return false;
      }
      
      // Success! Note that the channel will be deleted so this message might not be seen
      console.log(`[CloseTicketButton] Ticket closed successfully`);
      try {
        await interaction.editReply({
          content: "✅ Ticket closed successfully!"
        });
      } catch (replyError) {
        console.log(`[CloseTicketButton] Could not send success message (channel likely deleted): ${replyError.message}`);
      }
      
      return true;
    } catch (error) {
      console.error(`[CloseTicketButton] Error handling close ticket:`, error);
      
      try {
        await interaction.editReply({
          content: `❌ Error closing ticket: ${error.message}`
        });
      } catch (replyError) {
        console.error(`[CloseTicketButton] Error sending error message:`, replyError);
      }
      
      return false;
    }
  }
}

module.exports = new CloseTicketButton();
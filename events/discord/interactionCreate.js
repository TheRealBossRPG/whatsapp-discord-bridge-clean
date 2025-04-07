// events/discord/interactionCreate.js - Fully revamped with central tracking
const EventHandler = require('../../templates/EventHandler');
const InteractionHandler = require('../../core/interactionHandler');
const InteractionTracker = require('../../utils/InteractionTracker');

/**
 * Handles Discord interaction creation events
 */
class InteractionCreateEvent extends EventHandler {
  constructor() {
    super({
      event: 'interactionCreate'
    });
  }
  
  /**
   * Process a Discord interaction
   * @param {Interaction} interaction - Discord interaction
   */
  async execute(interaction) {
    try {
      // Mark this interaction as received in the tracker
      // If it's not the first time we've seen it, ignore
      if (!InteractionTracker.markReceived(interaction)) {
        console.log(`Ignoring duplicate interaction: ${interaction.id}`);
        return;
      }

      // Commands should be deferred immediately to prevent timeouts
      // This is now handled centrally by the tracker
      if (interaction.isCommand() && !interaction.replied && !interaction.deferred) {
        await InteractionTracker.safeDefer(interaction);
      }
      
      // Use the centralized interaction handler for processing
      await InteractionHandler.handleInteraction(interaction);
      
      // Mark interaction as complete after handling
      InteractionTracker.markComplete(interaction);
    } catch (error) {
      console.error(`Error handling interaction:`, error);
      
      // Try to respond with an error message
      try {
        // Use the tracker's safe reply method
        await InteractionTracker.safeReply(interaction, { 
          content: `There was an error processing your request: ${error.message}`, 
          ephemeral: true 
        });
      } catch (replyError) {
        console.error("Error responding to interaction error:", replyError);
      }
    }
  }
}

module.exports = new InteractionCreateEvent();
const EventHandler = require('../../templates/EventHandler');
const InteractionHandler = require('../../core/interactionHandler');

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
      // Use the centralized interaction handler
      await InteractionHandler.handleInteraction(interaction);
    } catch (error) {
      console.error(`Error handling interaction:`, error);
      
      // Try to respond with an error message
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ 
            content: `There was an error with this interaction: ${error.message}`, 
            ephemeral: true 
          });
        } else if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ 
            content: `There was an error with this interaction: ${error.message}`
          });
        } else {
          await interaction.followUp({ 
            content: `There was an error with this interaction: ${error.message}`, 
            ephemeral: true 
          });
        }
      } catch (replyError) {
        console.error("Error responding to interaction error:", replyError);
      }
    }
  }
}

module.exports = new InteractionCreateEvent();
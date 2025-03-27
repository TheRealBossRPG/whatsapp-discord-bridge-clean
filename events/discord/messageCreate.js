const EventHandler = require('../../templates/EventHandler');
const InteractionHandler = require('../../core/interactionHandler');

/**
 * Handles Discord message creation events
 */
class MessageCreateEvent extends EventHandler {
  constructor() {
    super({
      event: 'messageCreate'
    });
  }
  
  /**
   * Process a new Discord message
   * @param {Message} message - Discord message
   */
  async execute(message) {
    try {
      // Skip bot messages and DMs
      if (message.author.bot || !message.guild) return;
      
      // Pass to the central interaction handler that routes messages
      await InteractionHandler.handleMessage(message);
    } catch (error) {
      console.error('Error handling Discord message:', error);
    }
  }
}

module.exports = new MessageCreateEvent();
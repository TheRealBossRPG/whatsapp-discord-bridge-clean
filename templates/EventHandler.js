// templates/EventHandler.js - Base template for event handlers
/**
 * Base class for creating event handlers
 */
class EventHandler {
  /**
   * Create a new event handler
   * @param {Object} options - Event options
   * @param {string} options.event - Event name
   */
  constructor(options) {
    this.event = options.event;
  }
  
  /**
   * Register the event handler with a client
   * @param {Object} client - Discord client
   * @param {Object} instance - Server instance
   */
  register(client, instance) {
    client.on(this.event, (...args) => this.execute(...args, instance));
  }
  
  /**
   * Execute the event handler
   * @param {...any} args - Event arguments
   * @param {Object} instance - Server instance
   */
  async execute(...args) {
    throw new Error('Method not implemented');
  }
}

module.exports = EventHandler;
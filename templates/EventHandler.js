// templates/EventHandler.js - Base template for event handlers
/**
 * Base class for creating event handlers
 */
class EventHandler {
  /**
   * Create a new event handler
   * @param {Object} options - Event options
   * @param {string} options.event - Event name
   * @param {boolean} [options.once=false] - Whether to handle the event only once
   */
  constructor(options) {
    this.event = options.event;
    this.once = options.once || false;
  }
  
  /**
   * Register the event handler with a client
   * @param {Object} client - Discord client
   * @param {Object} instance - Server instance
   */
  register(client, instance) {
    const method = this.once ? 'once' : 'on';
    client[method](this.event, (...args) => this.execute(...args, instance));
  }
  
  /**
   * Execute the event handler
   * @param {...any} args - Event arguments
   */
  async execute(...args) {
    throw new Error(`Method not implemented for event: ${this.event}`);
  }
}

module.exports = EventHandler;
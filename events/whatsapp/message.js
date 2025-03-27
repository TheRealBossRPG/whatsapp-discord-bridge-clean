const EventHandler = require('../../templates/EventHandler');

/**
 * Handles WhatsApp message events
 */
class MessageEvent extends EventHandler {
  constructor() {
    super({
      event: 'message'
    });
  }
  
  /**
   * Process WhatsApp message
   * @param {Object} instance - WhatsApp instance
   * @param {Object} message - WhatsApp message
   */
  async execute(instance, message) {
    try {
      if (!instance || !instance.handlers || !instance.handlers.whatsAppHandler) {
        console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] No WhatsApp handler available for instance`);
        return;
      }
      
      // Pass the message to the instance's handler
      await instance.handlers.whatsAppHandler.handleMessage(message);
    } catch (error) {
      console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Error handling WhatsApp message:`, error);
    }
  }
}

module.exports = new MessageEvent();
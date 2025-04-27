// events/whatsapp/connection_closed.js
const EventHandler = require('../../templates/EventHandler');

/**
 * Handles WhatsApp connection closed events
 */
class WhatsAppConnectionClosedEvent extends EventHandler {
  constructor() {
    super({
      event: 'connection.closed'
    });
  }
  
  /**
   * Process WhatsApp connection closed event
   * @param {Object} instance - Server instance
   * @param {Object} details - Closure details
   */
  async execute(instance, details) {
    try {
      console.log(`[WhatsAppConnectionClosedEvent:${instance.instanceId}] Connection closed.`);
      
      // Update instance connection state
      instance.connected = false;
      
      // Determine if this was a clean closure
      const isCleanClose = details?.reason === 'logout' || details?.isLogout === true;
      
      if (isCleanClose) {
        console.log(`[WhatsAppConnectionClosedEvent:${instance.instanceId}] Clean logout detected, not reconnecting`);
        
        // Emit disconnect event
        if (instance.events) {
          instance.events.emit('disconnect', 'logout');
        }
        
        return;
      }
      
      // Only attempt reconnect if not already reconnecting
      if (!instance.reconnecting) {
        console.log(`[WhatsAppConnectionClosedEvent:${instance.instanceId}] Connection closed unexpectedly, scheduling reconnect`);
        
        // Schedule reconnect with slight delay
        setTimeout(() => {
          instance.attemptReconnect().catch(error => {
            console.error(`[WhatsAppConnectionClosedEvent:${instance.instanceId}] Error starting reconnection:`, error);
          });
        }, 5000); // 5 second delay before first attempt
      }
    } catch (error) {
      console.error(`[WhatsAppConnectionClosedEvent] Error handling connection closed:`, error);
    }
  }
}

module.exports = new WhatsAppConnectionClosedEvent();
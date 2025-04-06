// modules/clients/baileys/BaileysEvents.js - Fixed for proper instance ID handling
const EventEmitter = require('events');

/**
 * Handles Baileys WhatsApp events
 */
class BaileysEvents {
  /**
   * Create a new events handler
   * @param {Object} options - Options
   * @param {string} options.instanceId - Instance ID
   */
  constructor(options) {
    this.instanceId = String(options.instanceId || 'default');
    this.emitter = new EventEmitter();
    this.handlers = new Map();

    console.log(`[BaileysEvents:${this.instanceId}] Initialized event handler`);
  }

  /**
   * Initialize event handler
   */
  initialize() {
    // Reset handlers to ensure clean state
    this.handlers.clear();
    console.log(`[BaileysEvents:${this.instanceId}] Event handler initialized`);
  }

  /**
   * Reset event handler
   */
  reset() {
    // Clear all listeners
    this.emitter.removeAllListeners();
    this.handlers.clear();
    console.log(`[BaileysEvents:${this.instanceId}] Event listeners reset`);
  }

  /**
   * Register event handler
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  on(event, handler) {
    // Store handler reference
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);

    // Register with emitter
    this.emitter.on(event, handler);
    console.log(`[BaileysEvents:${this.instanceId}] Registered handler for event: ${event}`);
  }

  /**
   * Remove event handler
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  off(event, handler) {
    // Remove from emitter
    this.emitter.off(event, handler);

    // Remove from handlers map
    if (this.handlers.has(event)) {
      const handlers = this.handlers.get(event);
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }

    console.log(`[BaileysEvents:${this.instanceId}] Removed handler for event: ${event}`);
  }

  /**
   * Emit event
   * @param {string} event - Event name
   * @param {...any} args - Event arguments
   */
  emit(event, ...args) {
    this.emitter.emit(event, ...args);
  }

  /**
   * Handle messages upsert event
   * @param {Object} messagesUpsert - Messages upsert event data
   * @param {Object} client - WhatsApp client
   */
  async handleMessagesUpsert(messagesUpsert, client) {
    try {
      const { messages, type } = messagesUpsert;

      // Skip if no messages or not a new message
      if (!messages || !messages.length || type !== 'notify') {
        return;
      }

      // Process each message
      for (const message of messages) {
        try {
          // Skip status messages
          if (message.key && message.key.remoteJid === 'status@broadcast') {
            continue;
          }

          // Skip messages from self unless specified
          const isFromMe = message.key.fromMe;
          if (isFromMe) {
            continue;
          }

          // Process message
          await this.processMessage(message, client);
        } catch (messageError) {
          console.error(`[BaileysEvents:${this.instanceId}] Error processing message:`, messageError);
        }
      }
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error handling messages upsert:`, error);
    }
  }

  /**
   * Process a received message
   * @param {Object} message - WhatsApp message
   * @param {Object} client - WhatsApp client
   */
  async processMessage(message, client) {
    try {
      // Skip if no message content
      if (!message.message) {
        return;
      }

      // Extract relevant details
      const sender = message.key.remoteJid;
      const content = this.extractMessageContent(message);
      
      // Skip empty messages
      if (!content) {
        return;
      }

      // Forward to message handler if available
      if (client.message && typeof client.message.handleIncomingMessage === 'function') {
        await client.message.handleIncomingMessage(message, content, sender);
      }

      // Emit message event for client to forward
      client.emit('message', message);
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error processing message:`, error);
    }
  }

  /**
   * Extract content from a message
   * @param {Object} message - WhatsApp message
   * @returns {string|null} - Message content or null
   */
  extractMessageContent(message) {
    try {
      const msgTypes = [
        'conversation',      // Text message
        'imageMessage',      // Image with caption
        'videoMessage',      // Video with caption
        'extendedTextMessage', // Extended text
        'documentMessage',   // Document with caption
        'stickerMessage',    // Sticker
        'audioMessage',      // Audio
        'locationMessage',   // Location
        'contactMessage',    // Contact
        'contactsArrayMessage', // Multiple contacts
        'buttonsMessage',    // Buttons
        'templateMessage',   // Template message
        'listMessage'        // List message
      ];

      // Iterate through message types to find content
      for (const type of msgTypes) {
        if (message.message[type]) {
          // For text-based messages
          if (type === 'conversation') {
            return message.message[type];
          }
          // For extended text messages
          else if (type === 'extendedTextMessage') {
            return message.message[type].text || '';
          }
          // For media with captions
          else if (['imageMessage', 'videoMessage', 'documentMessage'].includes(type)) {
            return message.message[type].caption || `[${type}]`;
          }
          // For other types, just identify the type
          else {
            return `[${type}]`;
          }
        }
      }

      // Message type not found
      return null;
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error extracting message content:`, error);
      return null;
    }
  }
}

module.exports = BaileysEvents;
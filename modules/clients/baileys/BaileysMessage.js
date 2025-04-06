// modules/clients/baileys/BaileysMessage.js - Fixed for proper instance ID handling
const { delay } = require('@whiskeysockets/baileys');

/**
 * Handles sending and receiving WhatsApp messages
 */
class BaileysMessage {
  /**
   * Create a message handler
   * @param {Object} options - Options
   * @param {string} options.instanceId - Instance ID
   */
  constructor(options) {
    this.instanceId = String(options.instanceId || 'default');
    this.socket = null;
    this.messageQueue = [];
    this.processingQueue = false;
    this.messageHandlers = [];

    console.log(`[BaileysMessage:${this.instanceId}] Message handler initialized`);
  }

  /**
   * Initialize message handler
   */
  initialize() {
    this.messageQueue = [];
    this.processingQueue = false;
    console.log(`[BaileysMessage:${this.instanceId}] Message handler initialized`);
  }

  /**
   * Set socket for sending messages
   * @param {Object} socket - WhatsApp socket
   */
  setSocket(socket) {
    this.socket = socket;

    // Process any queued messages
    if (this.messageQueue.length > 0 && !this.processingQueue) {
      this.processMessageQueue();
    }
  }

  /**
   * Register message handler
   * @param {Function} handler - Message handler function
   */
  addMessageHandler(handler) {
    if (typeof handler === 'function') {
      this.messageHandlers.push(handler);
      console.log(`[BaileysMessage:${this.instanceId}] Added message handler, total: ${this.messageHandlers.length}`);
    }
  }

  /**
   * Handle incoming message
   * @param {Object} message - WhatsApp message
   * @param {string} content - Extracted message content
   * @param {string} sender - Sender ID
   */
  async handleIncomingMessage(message, content, sender) {
    try {
      // Skip if no handlers
      if (this.messageHandlers.length === 0) {
        return;
      }

      // Call all handlers
      for (const handler of this.messageHandlers) {
        try {
          await handler(message, content, sender);
        } catch (handlerError) {
          console.error(`[BaileysMessage:${this.instanceId}] Error in message handler:`, handlerError);
        }
      }
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error handling incoming message:`, error);
    }
  }

  /**
   * Send a WhatsApp message
   * @param {string} to - Recipient JID
   * @param {string|Object} content - Message content
   * @returns {Promise<Object|null>} - Message info
   */
  async sendMessage(to, content) {
    // If no socket, queue the message
    if (!this.socket) {
      console.log(`[BaileysMessage:${this.instanceId}] No socket available, queueing message to ${to}`);
      this.messageQueue.push({ to, content });
      return null;
    }

    try {
      // Ensure JID has @s.whatsapp.net unless it's a group
      let jid = to;
      if (!jid.includes('@g.us') && !jid.includes('@s.whatsapp.net')) {
        jid = `${jid}@s.whatsapp.net`;
      }

      // Send the message
      console.log(`[BaileysMessage:${this.instanceId}] Sending message to ${jid}`);
      const sentMsg = await this.socket.sendMessage(jid, content);
      return sentMsg;
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error sending message to ${to}:`, error);
      
      // Queue for retry if appropriate
      if (error.output?.statusCode !== 403 && error.output?.statusCode !== 404) {
        this.messageQueue.push({ to, content });
        
        // Start processing queue if not already
        if (!this.processingQueue) {
          this.processMessageQueue();
        }
      }
      
      return null;
    }
  }

  /**
   * Process queued messages
   */
  async processMessageQueue() {
    // Exit if already processing or no queue
    if (this.processingQueue || this.messageQueue.length === 0) {
      return;
    }

    this.processingQueue = true;
    console.log(`[BaileysMessage:${this.instanceId}] Processing message queue: ${this.messageQueue.length} messages`);

    while (this.messageQueue.length > 0) {
      // If no socket, pause queue processing
      if (!this.socket) {
        this.processingQueue = false;
        return;
      }

      // Get next message
      const { to, content } = this.messageQueue.shift();

      try {
        // Send message
        await this.sendMessage(to, content);
        
        // Small delay to prevent rate limiting
        await delay(500);
      } catch (error) {
        console.error(`[BaileysMessage:${this.instanceId}] Error sending queued message:`, error);
      }
    }

    this.processingQueue = false;
    console.log(`[BaileysMessage:${this.instanceId}] Message queue processing completed`);
  }
}

module.exports = BaileysMessage;
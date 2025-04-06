// modules/clients/baileys/BaileysMessage.js
const { Browsers } = require('@whiskeysockets/baileys');
const EventBus = require('../../../core/EventBus');

/**
 * Handles WhatsApp message operations
 */
class BaileysMessage {
  /**
   * Create a new Baileys message handler
   * @param {string} instanceId - Instance ID 
   */
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.socket = null;
    this.events = new EventBus();
    this.messageQueue = [];
    this.processingQueue = false;
    this.messageTimeout = 30000; // 30 seconds timeout for sending messages
    
    console.log(`[BaileysMessage:${this.instanceId}] Message handler initialized`);
  }
  
  /**
   * Initialize the message handler
   * @param {Object} client - Baileys client instance
   */
  initialize(client) {
    this.client = client;
    console.log(`[BaileysMessage:${this.instanceId}] Message handler initialized`);
  }
  
  /**
   * Set the Baileys socket
   * @param {Object} socket - Baileys socket
   */
  setSocket(socket) {
    this.socket = socket;
  }
  
  /**
   * Register event handlers
   * @param {Object} socket - Baileys socket
   */
  registerHandlers(socket) {
    if (!socket) return;
    
    // Register message event handler
    socket.ev.on('messages.upsert', async (messageUpdate) => {
      try {
        if (messageUpdate.type !== 'notify') return;
        
        for (const message of messageUpdate.messages) {
          if (message.key.fromMe) continue;
          
          // Emit message event
          this.events.emit('message', message);
          
          // Forward to client
          if (this.client && this.client.events) {
            this.client.events.emit('message', message);
          }
        }
      } catch (error) {
        console.error(`[BaileysMessage:${this.instanceId}] Error handling incoming message:`, error);
      }
    });
  }
  
  /**
   * Process message queue
   */
  async processMessageQueue() {
    if (this.processingQueue || this.messageQueue.length === 0) return;
    
    this.processingQueue = true;
    console.log(`[BaileysMessage:${this.instanceId}] Processing message queue: ${this.messageQueue.length} messages`);
    
    while (this.messageQueue.length > 0) {
      const { to, content, options, resolve, reject, timeout } = this.messageQueue.shift();
      
      try {
        console.log(`[BaileysMessage:${this.instanceId}] Sending message to ${to}`);
        
        if (!this.socket) {
          throw new Error('Socket not initialized');
        }
        
        // Convert message content to proper format
        const formattedContent = this.formatMessageContent(content);
        
        // Send the message
        const result = await this.socket.sendMessage(to, formattedContent, { ...options });
        resolve(result);
      } catch (error) {
        console.error(`[BaileysMessage:${this.instanceId}] Error sending message to ${to}:`, error);
        reject(error);
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }
    
    this.processingQueue = false;
    console.log(`[BaileysMessage:${this.instanceId}] Message queue processing completed`);
  }
  
  /**
   * Format message content for sending
   * @param {string|Object} content - Message content
   * @returns {Object} - Formatted message content
   */
  formatMessageContent(content) {
    // If content is already an object, return it
    if (typeof content === 'object' && content !== null) {
      return content;
    }
    
    // If content is a string, convert it to a text message object
    if (typeof content === 'string') {
      return { text: content };
    }
    
    // Default empty message
    return { text: '' };
  }
  
  /**
   * Send a message to a WhatsApp user
   * @param {string} to - User's phone number or JID
   * @param {string|Object} content - Message content
   * @param {Object} options - Message options
   * @returns {Promise<Object>} - Send result
   */
  async sendMessage(to, content, options = {}) {
    // Format receiver
    const receiver = this.formatReceiver(to);
    
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        reject(new Error(`Message sending timed out for ${receiver}`));
      }, this.messageTimeout);
      
      // Add to queue
      this.messageQueue.push({
        to: receiver,
        content,
        options,
        resolve,
        reject,
        timeout
      });
      
      // Process queue
      this.processMessageQueue();
    });
  }
  
  /**
   * Format receiver phone number or JID
   * @param {string} receiver - Receiver phone number or JID
   * @returns {string} - Formatted receiver
   */
  formatReceiver(receiver) {
    if (!receiver) {
      throw new Error('Receiver is required');
    }
    
    // If already contains @, assume it's already formatted
    if (receiver.includes('@')) {
      return receiver;
    }
    
    // Strip any non-digit characters
    const cleaned = receiver.replace(/\D/g, '');
    
    // Add WhatsApp suffix
    return `${cleaned}@s.whatsapp.net`;
  }
  
  /**
   * Register a callback for message events
   * @param {function} callback - Message callback
   */
  onMessage(callback) {
    this.events.on('message', callback);
  }
  
  /**
   * Remove a message callback
   * @param {function} callback - Message callback to remove
   */
  offMessage(callback) {
    this.events.off('message', callback);
  }
}

module.exports = BaileysMessage;
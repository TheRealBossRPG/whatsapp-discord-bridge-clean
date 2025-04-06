// modules/clients/baileys/BaileysEvents.js
const { proto } = require('@whiskeysockets/baileys');

/**
 * Handles Baileys events and forwards them to the EventBus
 */
class BaileysEvents {
  /**
   * Create a new events handler
   * @param {EventBus} eventBus - Event bus to emit events on
   */
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.boundHandlers = {
      onMessage: this.onMessage.bind(this),
      onConnectionUpdate: this.onConnectionUpdate.bind(this),
      onCredentialsUpdate: this.onCredentialsUpdate.bind(this),
      onChats: this.onChats.bind(this),
      onContacts: this.onContacts.bind(this)
    };
    
    console.log(`[BaileysEvents:${eventBus?.instanceId || 'default'}] Initialized event handler`);
  }
  
  /**
   * Initialize event handler
   */
  initialize() {
    console.log(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Event handler initialized`);
  }
  
  /**
   * Register event listeners for Baileys socket
   * @param {Object} socket - Baileys socket
   */
  registerSocketEvents(socket) {
    if (!socket || !socket.ev) {
      console.error(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Cannot register events - invalid socket`);
      return;
    }
    
    // Register all event listeners
    socket.ev.on('messages.upsert', this.boundHandlers.onMessage);
    socket.ev.on('connection.update', this.boundHandlers.onConnectionUpdate);
    socket.ev.on('creds.update', this.boundHandlers.onCredentialsUpdate);
    socket.ev.on('chats.set', this.boundHandlers.onChats);
    socket.ev.on('contacts.update', this.boundHandlers.onContacts);
  }
  
  /**
   * Reset all event listeners
   */
  resetEventListeners() {
    console.log(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Event listeners reset`);
  }
  
  /**
   * Handle incoming messages
   * @param {Object} data - Message data
   */
  onMessage(data) {
    try {
      const { messages, type } = data;
      
      if (type !== 'notify') return;
      
      for (const message of messages) {
        // Skip status messages (receipts, typing, etc.)
        if (message.key && message.key.remoteJid === 'status@broadcast') continue;
        
        // Skip messages from self (outgoing)
        if (message.key && message.key.fromMe) continue;
        
        // Process only normal message types
        const normalMessage = this.extractNormalMessage(message);
        if (!normalMessage) continue;
        
        // Emit message event with normalized data
        this.eventBus.emit('message', normalMessage);
      }
    } catch (error) {
      console.error(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Error processing message:`, error);
    }
  }
  
  /**
   * Handle connection updates
   * @param {Object} update - Connection update
   */
  onConnectionUpdate(update) {
    try {
      const { connection, lastDisconnect, qr } = update;
      
      // Handle QR code
      if (qr) {
        this.eventBus.emit('qr', qr);
      }
      
      // Handle connection events
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || 'Unknown';
        
        this.eventBus.emit('disconnected', reason);
        
        // If logged out, emit special event
        if (statusCode === 401) {
          this.eventBus.emit('auth_failure', new Error('Session expired'));
        }
      } else if (connection === 'open') {
        this.eventBus.emit('ready');
      }
    } catch (error) {
      console.error(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Error processing connection update:`, error);
    }
  }
  
  /**
   * Handle credentials update
   * @param {Object} credentials - Updated credentials
   */
  onCredentialsUpdate(credentials) {
    try {
      this.eventBus.emit('credentials', credentials);
    } catch (error) {
      console.error(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Error processing credentials update:`, error);
    }
  }
  
  /**
   * Handle chats update
   * @param {Object} data - Chats data
   */
  onChats(data) {
    try {
      this.eventBus.emit('chats', data);
    } catch (error) {
      console.error(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Error processing chats:`, error);
    }
  }
  
  /**
   * Handle contacts update
   * @param {Object} contacts - Contacts data
   */
  onContacts(contacts) {
    try {
      this.eventBus.emit('contacts', contacts);
    } catch (error) {
      console.error(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Error processing contacts:`, error);
    }
  }
  
  /**
   * Extract normal message from Baileys message
   * @param {Object} message - Baileys message
   * @returns {Object|null} Normalized message or null
   */
  extractNormalMessage(message) {
    try {
      // Skip empty messages
      if (!message) return null;
      
      // Get the JID (phone number)
      const jid = message.key.remoteJid;
      if (!jid) return null;
      
      // Get message content
      const msg = message.message;
      if (!msg) return null;
      
      // Determine message type and content
      let type = 'text';
      let content = '';
      let media = null;
      
      if (msg.conversation) {
        content = msg.conversation;
      } else if (msg.extendedTextMessage) {
        content = msg.extendedTextMessage.text || '';
        
        // Check for quoted message
        if (msg.extendedTextMessage.contextInfo?.quotedMessage) {
          type = 'reply';
          media = msg.extendedTextMessage.contextInfo.quotedMessage;
        }
      } else if (msg.imageMessage) {
        type = 'image';
        content = msg.imageMessage.caption || '';
        media = message;
      } else if (msg.videoMessage) {
        type = 'video';
        content = msg.videoMessage.caption || '';
        media = message;
      } else if (msg.audioMessage) {
        type = 'audio';
        content = '';
        media = message;
      } else if (msg.documentMessage) {
        type = 'document';
        content = msg.documentMessage.title || '';
        media = message;
      } else if (msg.stickerMessage) {
        type = 'sticker';
        content = '';
        media = message;
      } else {
        // Debug unhandled message types
        console.log(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Unhandled message type:`, Object.keys(msg));
        return null;
      }
      
      // Clean the phone number (remove @s.whatsapp.net)
      const cleanJid = jid.replace(/@s\.whatsapp\.net$/, '');
      
      // Create normalized message
      return {
        jid: jid,
        from: cleanJid,
        type: type,
        content: content,
        media: media,
        messageObject: message,
        timestamp: message.messageTimestamp || Date.now() / 1000
      };
    } catch (error) {
      console.error(`[BaileysEvents:${this.eventBus?.instanceId || 'default'}] Error extracting message:`, error);
      return null;
    }
  }
}

module.exports = BaileysEvents;
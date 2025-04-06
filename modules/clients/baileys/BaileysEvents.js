// modules/clients/baileys/BaileysEvents.js - Fixed event handling
const EventEmitter = require('events');
const { DisconnectReason } = require('@whiskeysockets/baileys');

/**
 * Class to handle Baileys-specific events
 */
class BaileysEvents extends EventEmitter {
  /**
   * Create new event handler
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId = 'default') {
    super();
    this.instanceId = instanceId;
    this.boundHandlers = new Map();
    this.saveCreds = null;
    
    console.log(`[BaileysEvents:${this.instanceId}] Initialized event handler`);
  }
  
  /**
   * Register event handlers with Baileys socket
   * @param {Object} sock - Baileys socket
   * @param {Function} saveCreds - Credentials save function
   */
  registerEvents(sock, saveCreds) {
    try {
      if (!sock || !sock.ev) {
        throw new Error('Invalid socket provided for event registration');
      }
      
      this.saveCreds = saveCreds;
      this.sock = sock;
      
      // Store bound handlers so we can remove them later
      const createBoundHandler = (event, handler) => {
        const boundHandler = (...args) => handler.apply(this, args);
        this.boundHandlers.set(event, boundHandler);
        return boundHandler;
      };
      
      // Connection events
      sock.ev.on('connection.update', createBoundHandler('connection.update', this.handleConnectionUpdate));
      
      // Credentials update
      sock.ev.on('creds.update', createBoundHandler('creds.update', this.handleCredsUpdate));
      
      // Message events
      sock.ev.on('messages.upsert', createBoundHandler('messages.upsert', this.handleMessagesUpsert));
      
      // Status events
      sock.ev.on('presence.update', createBoundHandler('presence.update', this.handlePresenceUpdate));
      
      // Group events
      sock.ev.on('chats.update', createBoundHandler('chats.update', this.handleChatsUpdate));
      sock.ev.on('contacts.update', createBoundHandler('contacts.update', this.handleContactsUpdate));
      
      // Call events
      sock.ev.on('call', createBoundHandler('call', this.handleCall));
      
      console.log(`[BaileysEvents:${this.instanceId}] Event handler initialized`);
      
      return true;
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error registering events:`, error);
      return false;
    }
  }
  
  /**
   * Reset all event listeners
   */
  resetListeners() {
    try {
      if (this.sock && this.sock.ev) {
        // Remove all event listeners
        this.boundHandlers.forEach((handler, event) => {
          this.sock.ev.off(event, handler);
        });
      }
      
      // Clear the handler map
      this.boundHandlers.clear();
      this.sock = null;
      this.saveCreds = null;
      
      console.log(`[BaileysEvents:${this.instanceId}] Event listeners reset`);
      return true;
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error resetting event listeners:`, error);
      return false;
    }
  }
  
  /**
   * Handle connection update events
   * @param {Object} update - Connection update info
   */
  handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    
    // Handle QR code updates
    if (qr) {
      this.emit('qr', qr);
    }
    
    // Handle connection state changes
    if (connection === 'close') {
      // Get the disconnect reason
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = this.getDisconnectReason(statusCode);
      
      console.log(`[BaileysEvents:${this.instanceId}] Connection closed. Reason: ${reason}`);
      
      // Emit disconnected event
      this.emit('close', reason);
    } else if (connection === 'open') {
      console.log(`[BaileysEvents:${this.instanceId}] Connection opened!`);
      this.emit('open');
    } else if (connection === 'connecting') {
      console.log(`[BaileysEvents:${this.instanceId}] Connecting...`);
      this.emit('connecting');
    }
  }
  
  /**
   * Handle credential updates
   * @param {Object} creds - Credentials
   */
  handleCredsUpdate(creds) {
    if (!this.saveCreds) return;
    
    // Save credentials
    this.saveCreds(creds)
      .then(() => {
        console.log(`[BaileysEvents:${this.instanceId}] Credentials saved successfully`);
      })
      .catch(error => {
        console.error(`[BaileysEvents:${this.instanceId}] Error saving credentials:`, error);
      });
  }
  
  /**
   * Handle incoming messages
   * @param {Object} param - Message data
   */
  handleMessagesUpsert({ messages, type }) {
    try {
      if (type !== 'notify') return;
      
      for (const message of messages) {
        // Get relevant message info
        const { key, pushName, message: messageContent } = message;
        
        // Skip empty or invalid messages
        if (!messageContent) continue;
        
        // Check if it's a message from others (not from us)
        if (!key.fromMe) {
          // Extract the sender ID
          const senderId = key.remoteJid;
          if (!senderId) continue;
          
          // Extract message text or media caption
          let messageText = '';
          let messageType = 'unknown';
          
          if (messageContent.conversation) {
            messageText = messageContent.conversation;
            messageType = 'text';
          } else if (messageContent.extendedTextMessage?.text) {
            messageText = messageContent.extendedTextMessage.text;
            messageType = 'text';
          } else if (messageContent.imageMessage?.caption) {
            messageText = messageContent.imageMessage.caption;
            messageType = 'image';
          } else if (messageContent.videoMessage?.caption) {
            messageText = messageContent.videoMessage.caption;
            messageType = 'video';
          } else if (messageContent.documentMessage?.caption) {
            messageText = messageContent.documentMessage.caption;
            messageType = 'document';
          } else if (messageContent.locationMessage) {
            messageText = 'Location shared';
            messageType = 'location';
          } else if (messageContent.contactMessage) {
            messageText = 'Contact shared';
            messageType = 'contact';
          } else if (messageContent.audioMessage) {
            messageText = 'Audio message';
            messageType = 'audio';
          } else {
            // Try to determine the message type
            const possibleTypes = [
              'imageMessage', 'videoMessage', 'audioMessage', 
              'documentMessage', 'stickerMessage', 'contactMessage',
              'locationMessage'
            ];
            
            for (const type of possibleTypes) {
              if (messageContent[type]) {
                messageType = type.replace('Message', '');
                messageText = `${messageType} message`;
                break;
              }
            }
          }
          
          // Create a simplified message object
          const simpleMessage = {
            id: key.id,
            from: senderId,
            fromMe: key.fromMe,
            name: pushName || 'Unknown',
            timestamp: message.messageTimestamp,
            text: messageText,
            type: messageType,
            original: message
          };
          
          // Emit the message event
          this.emit('message', simpleMessage);
        }
      }
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error processing messages:`, error);
    }
  }
  
  /**
   * Handle presence updates
   * @param {Object} update - Presence data
   */
  handlePresenceUpdate(update) {
    // Currently not using presence updates
  }
  
  /**
   * Handle chat updates
   * @param {Array} updates - Chat updates
   */
  handleChatsUpdate(updates) {
    // Currently not using chat updates
  }
  
  /**
   * Handle contact updates
   * @param {Array} updates - Contact updates
   */
  handleContactsUpdate(updates) {
    // Currently not using contact updates
  }
  
  /**
   * Handle call events
   * @param {Array} calls - Call events
   */
  handleCall(calls) {
    // Currently not handling calls
  }
  
  /**
   * Get human-readable disconnect reason
   * @param {number} statusCode - Status code
   * @returns {string} - Disconnect reason
   */
  getDisconnectReason(statusCode) {
    let reason = 'Unknown Reason';
    
    switch (statusCode) {
      case DisconnectReason.connectionClosed:
        reason = 'Connection Closed';
        break;
      case DisconnectReason.connectionLost:
        reason = 'Connection Lost';
        break;
      case DisconnectReason.connectionReplaced:
        reason = 'Connection Replaced';
        break;
      case DisconnectReason.timedOut:
        reason = 'Connection Timed Out';
        break;
      case DisconnectReason.loggedOut:
        reason = 'Logged Out';
        break;
      case DisconnectReason.badSession:
        reason = 'Bad Session';
        break;
      case DisconnectReason.restartRequired:
        reason = 'Restart Required';
        break;
      case DisconnectReason.multideiceDeleted:
      case DisconnectReason.multideviceDeleted:
        reason = 'Multi-device Deleted';
        break;
    }
    
    return reason;
  }
}

module.exports = BaileysEvents;
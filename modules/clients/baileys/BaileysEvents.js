// modules/clients/baileys/BaileysEvents.js - Event handling
const { proto } = require('@whiskeysockets/baileys');

/**
 * Manages events for Baileys WhatsApp client
 */
class BaileysEvents {
  /**
   * Create a new BaileysEvents instance
   * @param {BaileysClient} client - Parent client
   */
  constructor(client) {
    this.client = client;
    this.instanceId = client.options.instanceId;
    this.socket = null;
    this.listenerCleanupFunctions = [];
  }
  
  /**
   * Initialize event handling
   * @param {Object} socket - Baileys socket connection
   */
  initialize(socket) {
    if (!socket) {
      console.error(`[BaileysEvents:${this.instanceId}] Cannot initialize events with null socket`);
      return;
    }
    
    this.socket = socket;
    
    // First remove any existing listeners to prevent duplicates
    this.reset();
    
    console.log(`[BaileysEvents:${this.instanceId}] Setting up event listeners...`);
    
    // 1. QR code event
    const onQR = (qr) => {
      console.log(`[BaileysEvents:${this.instanceId}] Received QR code`);
      this.client.emit('qr', qr);
    };
    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Handle QR code
      if (qr) {
        onQR(qr);
      }
      
      // Handle connection state changes
      if (connection === 'close') {
        const error = lastDisconnect?.error;
        const shouldReconnect = error?.output?.statusCode !== 401; // Don't reconnect if unauthorized
        
        console.log(`[BaileysEvents:${this.instanceId}] Connection closed, reconnect: ${shouldReconnect}`);
        
        if (shouldReconnect) {
          this.client.emit('connection_closed', error);
        } else {
          this.client.emit('auth_failure', error);
        }
      } else if (connection === 'open') {
        console.log(`[BaileysEvents:${this.instanceId}] Connection opened`);
        this.client.isReady = true;
        this.client.emit('ready');
      }
    });
    
    // Save cleanup function
    this.listenerCleanupFunctions.push(() => {
      socket.ev.off('connection.update');
    });
    
    // 2. Messages event
    socket.ev.on('messages.upsert', async (m) => {
      try {
        if (m.type !== 'notify') return;
        
        const msg = m.messages[0];
        if (!msg) return;
        
        // Ignore status updates
        if (msg.key && msg.key.remoteJid === 'status@broadcast') return;
        
        // Skip messages from self
        if (msg.key.fromMe) return;
        
        // Process message
        this.client.emit('message', msg);
      } catch (error) {
        console.error(`[BaileysEvents:${this.instanceId}] Error processing message:`, error);
      }
    });
    
    // Save cleanup function
    this.listenerCleanupFunctions.push(() => {
      socket.ev.off('messages.upsert');
    });
    
    // 3. Message status updates
    socket.ev.on('messages.update', (messages) => {
      for (const message of messages) {
        this.client.emit('message_update', message);
      }
    });
    
    // Save cleanup function
    this.listenerCleanupFunctions.push(() => {
      socket.ev.off('messages.update');
    });
    
    // 4. Message reaction events
    socket.ev.on('messages.reaction', (reactions) => {
      for (const reaction of reactions) {
        this.client.emit('message_reaction', reaction);
      }
    });
    
    // Save cleanup function
    this.listenerCleanupFunctions.push(() => {
      socket.ev.off('messages.reaction');
    });
    
    // 5. Group participants update
    socket.ev.on('group-participants.update', (participants) => {
      this.client.emit('group_update', participants);
    });
    
    // Save cleanup function
    this.listenerCleanupFunctions.push(() => {
      socket.ev.off('group-participants.update');
    });
    
    // 6. Contact updates
    socket.ev.on('contacts.update', (contacts) => {
      this.client.emit('contacts_update', contacts);
    });
    
    // Save cleanup function
    this.listenerCleanupFunctions.push(() => {
      socket.ev.off('contacts.update');
    });
    
    console.log(`[BaileysEvents:${this.instanceId}] Event listeners set up successfully`);
  }
  
  /**
   * Reset event listeners
   */
  reset() {
    // Remove all registered listeners
    for (const cleanup of this.listenerCleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        console.error(`[BaileysEvents:${this.instanceId}] Error cleaning up listener:`, error);
      }
    }
    
    // Clear the cleanup functions array
    this.listenerCleanupFunctions = [];
    
    // Reset the socket reference
    this.socket = null;
    
    console.log(`[BaileysEvents:${this.instanceId}] Event listeners reset`);
  }
  
  /**
   * Manually trigger a message event for testing
   * @param {Object} message - Message object
   */
  triggerMessageEvent(message) {
    console.log(`[BaileysEvents:${this.instanceId}] Manually triggering message event`);
    this.client.emit('message', message);
  }
}

module.exports = { BaileysEvents };
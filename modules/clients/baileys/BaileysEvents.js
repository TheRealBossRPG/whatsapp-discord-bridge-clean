// modules/clients/baileys/BaileysEvents.js
const { DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

class BaileysEvents {
  constructor(client) {
    this.client = client;
    this.qrCodeListeners = new Set();
  }
  
  // Set up event listeners for the WhatsApp socket
  async setupEvents(sock) {
    if (!sock) return;
    
    // Handle connection updates
    sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
    
    // Handle incoming messages
    sock.ev.on('messages.upsert', (data) => this.handleMessagesUpsert(data));
    
    console.log(`[BaileysEvents:${this.client.instanceId}] Event handlers initialized`);
  }
  
  // Handle connection updates
  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    
    if (connection === 'close') {
      const shouldReconnect = 
        (lastDisconnect?.error instanceof Boom) && 
        lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
      
      console.log(`Baileys connection closed due to ${lastDisconnect?.error?.message || 'unknown reason'}`);
      
      if (shouldReconnect) {
        console.log(`[BaileysEvents:${this.client.instanceId}] Reconnecting...`);
        this.client.isReady = false;
        this.client.isInitializing = false;
        await this.client.initialize();
      } else {
        console.log(`[BaileysEvents:${this.client.instanceId}] Connection closed, not reconnecting`);
        this.client.isReady = false;
        this.client.isInitializing = false;
        
        // Resolve any pending connection promises
        if (this.client.auth && this.client.auth.connectionPromises) {
          this.client.auth.connectionPromises.forEach(resolve => resolve(false));
          this.client.auth.connectionPromises = [];
        }
        
        // Emit disconnected event
        this.client.emit('disconnected', lastDisconnect?.error?.message || 'unknown reason');
      }
    } else if (connection === 'open') {
      console.log(`[BaileysEvents:${this.client.instanceId}] Connection established successfully!`);
      this.client.isReady = true;
      this.client.isInitializing = false;
      
      // Process any queued messages
      this.processMessageQueue();
      
      // Resolve pending connection promises
      if (this.client.auth && this.client.auth.connectionPromises) {
        this.client.auth.connectionPromises.forEach(resolve => resolve(true));
        this.client.auth.connectionPromises = [];
      }
      
      // Emit ready event
      this.client.emit('ready');
    }
    
    if (qr) {
      console.log(`[BaileysEvents:${this.client.instanceId}] QR code received, emitting event...`);
      // Emit QR code event
      this.client.emit('qr', qr);
    }
  }
  
  // Handle incoming messages
  handleMessagesUpsert(data) {
    const { messages, type } = data;
    
    if (type === 'notify') {
      for (const msg of messages) {
        // Save to message store
        this.client.message.storeMessage(msg);
        
        // Skip messages sent by us
        if (msg.key.fromMe) continue;
        
        // Skip system messages
        if (msg.key.remoteJid === 'status@broadcast') continue;
        
        // Skip group messages
        if (msg.key.remoteJid.endsWith('@g.us')) continue;
        
        // Format and emit message
        const formattedMsg = this.client.message.formatIncomingMessage(msg);
        this.client.emit('message', formattedMsg);
      }
    }
  }
  
  // Process message queue
  async processMessageQueue() {
    console.log(`[BaileysEvents:${this.client.instanceId}] Processing ${this.client.messageQueue.length} queued messages`);
    
    while (this.client.messageQueue.length > 0) {
      const { to, content, options } = this.client.messageQueue.shift();
      await this.client.sendMessage(to, content, options).catch(err => 
        console.error(`[BaileysEvents:${this.client.instanceId}] Error sending queued message:`, err)
      );
    }
  }
  
  // Register QR code listener
  onQRCode(callback) {
    this.qrCodeListeners.add(callback);
    
    // Set up event listener if not already done
    this.client.on('qr', (qr) => {
      for (const listener of this.qrCodeListeners) {
        try {
          listener(qr);
        } catch (error) {
          console.error(`[BaileysEvents:${this.client.instanceId}] Error in QR code listener:`, error);
        }
      }
    });
  }
  
  // Clean up all event listeners
  async removeAllListeners() {
    if (this.client.auth && this.client.auth.sock && this.client.auth.sock.ev) {
      this.client.auth.sock.ev.removeAllListeners('connection.update');
      this.client.auth.sock.ev.removeAllListeners('creds.update');
      this.client.auth.sock.ev.removeAllListeners('messages.upsert');
    }
    
    // Clear QR code listeners
    this.qrCodeListeners.clear();
    
    console.log(`[BaileysEvents:${this.client.instanceId}] All event listeners removed`);
  }
}

module.exports = BaileysEvents;
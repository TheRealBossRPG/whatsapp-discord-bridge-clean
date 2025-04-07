// modules/clients/BaileysClient.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

/**
 * BaileysClient - WhatsApp client based on Baileys
 */
class BaileysClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    this.maxRetries = options.maxRetries || 5;
    
    // Create required directories
    this.createDirectories();
    
    // Socket connection
    this.socket = null;
    this.isReady = false;
    this.reconnectCount = 0;
    this.showQrCode = true;
    
    console.log(`[BaileysClient:${this.instanceId}] Initialized. Will connect on initialize() call.`);
  }
  
  /**
   * Create required directories
   */
  createDirectories() {
    for (const dir of [this.authFolder, this.baileysAuthFolder, this.tempDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  /**
   * Set whether to show QR code
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${show}`);
  }
  
  /**
   * Initialize the WhatsApp connection
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Connection status
   */
  async initialize(showQrCode = false) {
    try {
      // Set QR code display flag
      if (showQrCode !== undefined) {
        this.setShowQrCode(showQrCode);
      }
      
      if (this.socket && this.isReady) {
        console.log(`[BaileysClient:${this.instanceId}] Already connected`);
        return true;
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${this.authFolder}`);
      
      // Get authentication state
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      
      // Get Baileys version
      const { version } = await fetchLatestBaileysVersion();
      console.log(`[BaileysClient:${this.instanceId}] Using WA v${version.join(',')}${version.isLatest ? ', isLatest: true' : ''}`);
      
      // Create socket connection
      this.socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        syncFullHistory: false, // Set to true if you want to sync message history
        getMessage: async () => undefined,
        logger: global.pinoCompatLogger || undefined
      });
      
      // Handle connection events
      this.socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Handle QR code
        if (qr && this.showQrCode) {
          this.emit('qr', qr);
        }
        
        // Handle connection state change
        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error instanceof Boom && 
            lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut);
          
          console.log(`[BaileysClient:${this.instanceId}] Connection closed. Reason: ${lastDisconnect?.error?.message || 'Unknown'}`);
          
          // Update state
          this.isReady = false;
          this.emit('disconnected', lastDisconnect?.error?.message || 'Unknown');
          
          // Try to reconnect if not logged out
          if (shouldReconnect) {
            this.attemptReconnect();
          }
        } else if (connection === 'open') {
          console.log(`[BaileysClient:${this.instanceId}] Connected to WhatsApp`);
          this.isReady = true;
          this.reconnectCount = 0;
          this.emit('ready');
        }
      });
      
      // Handle credentials update
      this.socket.ev.on('creds.update', saveCreds);
      
      // Handle messages
      this.socket.ev.on('messages.upsert', (messages) => {
        if (messages.type === 'notify') {
          for (const msg of messages.messages) {
            // Skip messages sent by us
            if (!msg.key.fromMe) {
              this.emit('message', msg);
            }
          }
        }
      });
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp:`, error);
      this.isReady = false;
      this.emit('auth_failure', error);
      return false;
    }
  }
  
  /**
   * Attempt to reconnect
   */
  async attemptReconnect() {
    try {
      this.reconnectCount++;
      
      if (this.reconnectCount > this.maxRetries) {
        console.error(`[BaileysClient:${this.instanceId}] Max reconnection attempts (${this.maxRetries}) reached`);
        return;
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Attempting to reconnect (${this.reconnectCount}/${this.maxRetries})...`);
      
      // Wait before reconnecting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Initialize again
      await this.initialize(this.showQrCode);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error reconnecting:`, error);
    }
  }
  
  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} - Authentication status
   */
  async isAuthenticated() {
    try {
      const authFiles = fs.readdirSync(this.authFolder);
      return authFiles.length > 0;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  /**
   * Send a message to WhatsApp
   * @param {string} jid - JID to send to
   * @param {Object} content - Message content
   * @returns {Promise<Object>} - Send result
   */
  async sendMessage(jid, content) {
    try {
      if (!this.socket || !this.isReady) {
        console.error(`[BaileysClient:${this.instanceId}] Cannot send message: Not connected`);
        return null;
      }
      
      // Make sure JID is in the correct format
      const cleanJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
      
      // Send the message
      const result = await this.socket.sendMessage(cleanJid, content);
      return result;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      return null;
    }
  }
  
  /**
   * Get contact by JID
   * @param {string} jid - JID to get contact for
   * @returns {Promise<Object>} - Contact information
   */
  async getContact(jid) {
    try {
      if (!this.socket || !this.isReady) {
        console.error(`[BaileysClient:${this.instanceId}] Cannot get contact: Not connected`);
        return null;
      }
      
      // Make sure JID is in the correct format
      const cleanJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
      
      // In Baileys, we need to use store to get contact
      const contact = await this.socket.getContact(cleanJid);
      return contact;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error getting contact:`, error);
      return null;
    }
  }
  
  /**
   * Download media from a message
   * @param {Object} message - Message with media
   * @returns {Promise<Buffer>} - Media buffer
   */
  async downloadMedia(message) {
    try {
      if (!this.socket || !this.isReady) {
        console.error(`[BaileysClient:${this.instanceId}] Cannot download media: Not connected`);
        return null;
      }
      
      // Get message content type
      const messageType = Object.keys(message.message).find(key => 
        ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(key)
      );
      
      if (!messageType) {
        console.error(`[BaileysClient:${this.instanceId}] Message does not contain downloadable media`);
        return null;
      }
      
      // Download media
      const buffer = await downloadMediaMessage(
        message,
        'buffer',
        {},
        { 
          logger: global.pinoCompatLogger || console,
          reuploadRequest: this.socket.updateMediaMessage
        }
      );
      
      return buffer;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error downloading media:`, error);
      return null;
    }
  }
  
  /**
   * Send a reaction to a message
   * @param {Object} message - Message to react to
   * @param {string} emoji - Emoji to use
   * @returns {Promise<boolean>} - Success status
   */
  async sendReaction(message, emoji) {
    try {
      if (!this.socket || !this.isReady) {
        console.error(`[BaileysClient:${this.instanceId}] Cannot send reaction: Not connected`);
        return false;
      }
      
      // Send reaction
      await this.socket.sendMessage(message.key.remoteJid, {
        react: {
          text: emoji,
          key: message.key
        }
      });
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending reaction:`, error);
      return false;
    }
  }
  
  /**
   * Disconnect from WhatsApp
   * @param {boolean} logout - Whether to log out completely
   * @returns {Promise<boolean>} - Success status
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      if (this.socket) {
        if (logout) {
          // Log out completely
          await this.socket.logout();
          console.log(`[BaileysClient:${this.instanceId}] Logged out of WhatsApp`);
        } else {
          // Just close the connection
          this.socket.end(new Error('User disconnected'));
          this.socket.ev.removeAllListeners();
          console.log(`[BaileysClient:${this.instanceId}] Socket closed`);
        }
      }
      
      // Update state
      this.isReady = false;
      this.socket = null;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      this.isReady = false;
      this.socket = null;
      return false;
    }
  }
  
  /**
   * Restore session
   * @returns {Promise<boolean>} - Success status
   */
  async restoreSession() {
    try {
      // Check if we have authentication files
      if (!await this.isAuthenticated()) {
        console.log(`[BaileysClient:${this.instanceId}] No authentication files found, cannot restore session`);
        return false;
      }
      
      // Initialize without showing QR code
      return await this.initialize(false);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
}

// Import these from @whiskeysockets/baileys but handle potential import errors
let fetchLatestBaileysVersion;
let downloadMediaMessage;

try {
  const baileys = require('@whiskeysockets/baileys');
  fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
  downloadMediaMessage = baileys.downloadMediaMessage;
} catch (error) {
  console.error('Error importing Baileys functions:', error);
  
  // Fallback implementations
  fetchLatestBaileysVersion = async () => ({ version: [2, 3000, 1020608496], isLatest: true });
  downloadMediaMessage = async () => { throw new Error('downloadMediaMessage not available'); };
}

module.exports = BaileysClient;
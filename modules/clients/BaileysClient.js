// modules/clients/BaileysClient.js
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const BaileysEvents = require('./baileys/BaileysEvents');
const EventBus = require('../../core/EventBus');

/**
 * WhatsApp client implementation using Baileys
 */
class BaileysClient {
  /**
   * Create a new Baileys WhatsApp client
   * @param {Object} options - Client options
   * @param {string} options.instanceId - Instance ID
   * @param {string} options.authFolder - Authentication folder path
   * @param {string} options.baileysAuthFolder - Baileys auth folder path
   * @param {string} options.tempDir - Temporary files directory
   * @param {number} options.maxRetries - Maximum connection retry attempts
   */
  constructor(options) {
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    this.maxRetries = options.maxRetries || 5;
    
    // Create event bus for this client
    this.events = new EventBus();
    
    // Initialize events handler
    this.eventsHandler = new BaileysEvents(this.events);
    
    // State tracking
    this.isReady = false;
    this.socket = null;
    this.socketError = null;
    this.reconnectAttempts = 0;
    this.showQrCode = false;
    
    console.log(`[BaileysClient:${this.instanceId}] Client initialized`);
  }
  
  /**
   * Set whether to show QR code on connection
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${show}`);
  }
  
  /**
   * Initialize the WhatsApp connection
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Connection success
   */
  async initialize(showQrCode = false) {
    try {
      // Set QR code flag
      this.setShowQrCode(showQrCode);
      
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      
      // Create auth folders if they don't exist
      if (!fs.existsSync(this.authFolder)) {
        fs.mkdirSync(this.authFolder, { recursive: true });
      }
      
      if (!fs.existsSync(this.baileysAuthFolder)) {
        fs.mkdirSync(this.baileysAuthFolder, { recursive: true });
      }
      
      // Initialize Baileys auth state
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${this.baileysAuthFolder}`);
      const { state, saveCreds } = await useMultiFileAuthState(this.baileysAuthFolder);
      
      // Get latest version of baileys (update from cached when possible)
      const { version } = await fetchLatestBaileysVersion();
      
      // Initialize event handler
      this.eventsHandler.initialize();
      
      // Create connection
      this.socket = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, console.log)
        },
        printQRInTerminal: false, // We'll handle QR display ourselves
        version: version,
        browser: ['WhatsApp Discord Bridge', 'Chrome', '10.0.0']
      });
      
      // Add auth credentials save on update
      this.socket.ev.on('creds.update', saveCreds);
      
      // Handle connection events
      this.socket.ev.on('connection.update', (update) => {
        this.handleConnectionUpdate(update);
      });
      
      // Forward events to the event manager
      this.eventsHandler.registerSocketEvents(this.socket);
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp client:`, error);
      this.socketError = error;
      return false;
    }
  }
  
  /**
   * Handle connection updates
   * @param {Object} update - Connection update
   * @private
   */
  handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    
    // Handle QR code if showing it
    if (qr && this.showQrCode) {
      this.events.emit('qr', qr);
    }
    
    // Handle connection state changes
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`[BaileysClient:${this.instanceId}] Connection closed. Reason: ${lastDisconnect?.error?.message || 'Unknown'}`);
      
      // If we should reconnect, attempt it
      if (shouldReconnect) {
        console.log(`[BaileysClient:${this.instanceId}] Attempting to reconnect...`);
        this.isReady = false;
      }
    } else if (connection === 'open') {
      console.log(`[BaileysClient:${this.instanceId}] Connection opened!`);
      this.isReady = true;
      this.reconnectAttempts = 0;
      this.events.emit('ready');
    }
  }
  
  /**
   * Check if the WhatsApp client is authenticated
   * @returns {Promise<boolean>} - Authentication status
   */
  async isAuthenticated() {
    try {
      // Check if Baileys stored credentials exist
      const credsPath = path.join(this.baileysAuthFolder, 'creds.json');
      
      if (fs.existsSync(credsPath)) {
        // Check file has some data
        const stats = fs.statSync(credsPath);
        if (stats.size > 10) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  /**
   * Attempt to restore session without QR code
   * @returns {Promise<boolean>} - Success
   */
  async restoreSession() {
    try {
      if (!this.isAuthenticated()) {
        return false;
      }
      
      // Set QR code flag to false
      this.setShowQrCode(false);
      
      // Initialize with QR disabled
      const success = await this.initialize(false);
      
      return success && this.isReady;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Disconnect the WhatsApp client
   * @param {boolean} logout - Whether to remove authentication
   * @returns {Promise<boolean>} - Success
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // Unbind event listeners
      this.eventsHandler.resetEventListeners();
      
      // Close the socket if it exists
      if (this.socket) {
        try {
          // If logout requested, clear credentials
          if (logout) {
            // Remove auth folder if logout requested
            this.clearAuthData();
          }
          
          // End the socket connection
          if (this.socket.ws) {
            this.socket.ws.close();
            console.log(`[BaileysClient:${this.instanceId}] Socket ended`);
          }
          
          // Nullify the socket reference
          this.socket = null;
        } catch (socketError) {
          console.error(`[BaileysClient:${this.instanceId}] Error closing socket:`, socketError);
        }
      }
      
      // Update state
      this.isReady = false;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Force update state on error
      this.isReady = false;
      
      return false;
    }
  }
  
  /**
   * Clear authentication data
   * @private
   */
  clearAuthData() {
    try {
      // Remove Baileys auth folder
      if (fs.existsSync(this.baileysAuthFolder)) {
        const files = fs.readdirSync(this.baileysAuthFolder);
        
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(this.baileysAuthFolder, file));
          } catch (fileError) {
            console.error(`[BaileysClient:${this.instanceId}] Error deleting file ${file}:`, fileError);
          }
        }
        
        console.log(`[BaileysClient:${this.instanceId}] Cleared Baileys auth folder`);
      }
      
      // Remove main auth folder
      if (fs.existsSync(this.authFolder)) {
        const files = fs.readdirSync(this.authFolder);
        
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(this.authFolder, file));
          } catch (fileError) {
            console.error(`[BaileysClient:${this.instanceId}] Error deleting file ${file}:`, fileError);
          }
        }
        
        console.log(`[BaileysClient:${this.instanceId}] Cleared main auth folder`);
      }
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error clearing auth data:`, error);
    }
  }
  
  /**
   * Send a WhatsApp message
   * @param {string} jid - JID (phone number with @s.whatsapp.net)
   * @param {string|Object} content - Message content
   * @param {Object} options - Message options
   * @returns {Promise<Object>} - Message info
   */
  async sendMessage(jid, content, options = {}) {
    try {
      if (!this.socket) {
        throw new Error('WhatsApp client is not initialized');
      }
      
      if (!this.isReady) {
        throw new Error('WhatsApp client is not connected');
      }
      
      // Format JID if it's a plain phone number
      const formattedJid = this.formatJid(jid);
      
      // Send message using Baileys
      const result = await this.socket.sendMessage(formattedJid, content, options);
      return result;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * Download media from WhatsApp
   * @param {Object} message - Message with media
   * @returns {Promise<Buffer>} - Media buffer
   */
  async downloadMedia(message) {
    try {
      if (!this.socket) {
        throw new Error('WhatsApp client is not initialized');
      }
      
      // Get message type and mimeType
      const messageType = Object.keys(message).find(key => {
        return (
          key !== 'conversation' && 
          key !== 'messageContextInfo' && 
          message[key] !== null && 
          typeof message[key] === 'object'
        );
      });
      
      if (!messageType) {
        throw new Error('No media found in message');
      }
      
      // Get the message content
      const content = message[messageType];
      
      // Download media
      let buffer;
      
      if (content.directPath) {
        buffer = await this.socket.downloadMediaMessage(message);
      } else {
        buffer = await this.socket.downloadMediaMessage(
          message,
          'buffer',
          {},
          { 
            logger: console,
            reuploadRequest: this.socket.updateMediaMessage 
          }
        );
      }
      
      return buffer;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error downloading media:`, error);
      throw error;
    }
  }
  
  /**
   * Format a phone number into a JID
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Formatted JID
   */
  formatJid(phoneNumber) {
    // If already a valid JID, return as is
    if (phoneNumber.includes('@')) {
      return phoneNumber;
    }
    
    // Clean the phone number - remove any non-digit characters
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    // Return formatted JID
    return `${cleanNumber}@s.whatsapp.net`;
  }
  
  /**
   * Get user's profile picture
   * @param {string} jid - JID (phone number with @s.whatsapp.net)
   * @returns {Promise<string|null>} - Profile picture URL
   */
  async getProfilePicture(jid) {
    try {
      if (!this.socket) {
        throw new Error('WhatsApp client is not initialized');
      }
      
      // Format JID if it's a plain phone number
      const formattedJid = this.formatJid(jid);
      
      // Get profile picture URL
      const ppUrl = await this.socket.profilePictureUrl(formattedJid);
      return ppUrl;
    } catch (error) {
      // If error is 404, user has no profile picture
      if (error.data && error.data.status === 404) {
        return null;
      }
      
      console.error(`[BaileysClient:${this.instanceId}] Error getting profile picture:`, error);
      return null;
    }
  }
  
  /**
   * Get connection status
   * @returns {boolean} - Whether client is connected
   */
  isConnected() {
    return this.isReady;
  }
}

module.exports = BaileysClient;
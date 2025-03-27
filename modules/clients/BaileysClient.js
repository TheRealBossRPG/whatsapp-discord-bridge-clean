// modules/clients/BaileysClient.js - Main client interface
const fs = require('fs');
const path = require('path');
const { BaileysAuth } = require('./baileys/BaileysAuth');
const { BaileysEvents } = require('./baileys/BaileysEvents');
const { BaileysMessage } = require('./baileys/BaileysMessage');
const { BaileysMedia } = require('./baileys/BaileysMedia');
const EventEmitter = require('events');

/**
 * BaileysClient class to handle WhatsApp Web communication
 */
class BaileysClient extends EventEmitter {
  /**
   * Create a new BaileysClient instance
   * @param {Object} options - Configuration options
   * @param {string} options.authFolder - Path to auth data folder
   * @param {string} options.baileysAuthFolder - Path to Baileys auth folder
   * @param {string} options.tempDir - Path to temp directory for media
   * @param {string} options.instanceId - Instance identifier
   * @param {number} options.maxRetries - Max reconnection attempts
   */
  constructor(options = {}) {
    super();
    
    // Set options with defaults
    this.options = {
      authFolder: options.authFolder || './auth',
      baileysAuthFolder: options.baileysAuthFolder || path.join(options.authFolder || './auth', 'baileys_auth'),
      tempDir: options.tempDir || './temp',
      instanceId: options.instanceId || 'default',
      maxRetries: options.maxRetries || 5,
      showQrCode: options.showQrCode !== false
    };
    
    // Ensure directories exist
    this.ensureDirectories();
    
    // Create components
    this.auth = new BaileysAuth(this.options);
    this.events = new BaileysEvents(this);
    this.message = new BaileysMessage(this);
    this.media = new BaileysMedia(this);
    
    // Internal state
    this.isReady = false;
    this.connection = null;
    this.socket = null;
    this._showQrCode = this.options.showQrCode;
    
    console.log(`[BaileysClient:${this.options.instanceId}] Client initialized`);
  }
  
  /**
   * Ensure required directories exist
   * @private
   */
  ensureDirectories() {
    const dirs = [this.options.authFolder, this.options.baileysAuthFolder, this.options.tempDir];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[BaileysClient:${this.options.instanceId}] Created directory: ${dir}`);
      }
    }
  }
  
  /**
   * Set QR code display flag
   * @param {boolean} show - Whether to force QR code display
   */
  setShowQrCode(show) {
    this._showQrCode = show;
  }
  
  /**
   * Initialize WhatsApp connection
   * @returns {Promise<boolean>} Connection success
   */
  async initialize() {
    try {
      console.log(`[BaileysClient:${this.options.instanceId}] Initializing WhatsApp connection...`);
      
      // Initialize auth system first
      await this.auth.initialize();
      
      // Connect to WhatsApp
      const connectionResult = await this.auth.connect(this._showQrCode);
      
      // If successful, set up connection components
      if (connectionResult && connectionResult.sock) {
        this.socket = connectionResult.sock;
        this.connection = connectionResult;
        
        // Initialize components with socket
        this.events.initialize(this.socket);
        this.message.initialize(this.socket);
        this.media.initialize(this.socket);
        
        console.log(`[BaileysClient:${this.options.instanceId}] WhatsApp initialized successfully`);
        return true;
      } else {
        console.log(`[BaileysClient:${this.options.instanceId}] WhatsApp initialization failed or awaiting QR scan`);
        return false;
      }
    } catch (error) {
      console.error(`[BaileysClient:${this.options.instanceId}] Error initializing WhatsApp:`, error);
      return false;
    }
  }
  
  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} Authentication status
   */
  async isAuthenticated() {
    return this.auth.isAuthenticated();
  }
  
  /**
   * Restore an existing session
   * @returns {Promise<boolean>} Restoration success
   */
  async restoreSession() {
    return this.auth.restoreSession();
  }
  
  /**
   * Disconnect from WhatsApp
   * @param {boolean} logout - Whether to remove auth data
   * @returns {Promise<boolean>} Disconnect success
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.options.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // Disconnect via auth component
      const success = await this.auth.disconnect(logout);
      
      // Clear socket and connection
      this.socket = null;
      this.connection = null;
      this.isReady = false;
      
      // Reset components
      this.events.reset();
      this.message.reset();
      this.media.reset();
      
      return success;
    } catch (error) {
      console.error(`[BaileysClient:${this.options.instanceId}] Error disconnecting:`, error);
      return false;
    }
  }
  
  /**
   * Send a message to a WhatsApp chat
   * @param {string} to - Recipient phone number
   * @param {string|Object} content - Message content
   * @returns {Promise<Object>} Message info
   */
  async sendMessage(to, content) {
    return this.message.sendMessage(to, content);
  }
  
  /**
   * Process and send media to WhatsApp
   * @param {string} to - Recipient phone number
   * @param {Buffer|string} media - Media content or path
   * @param {string} type - Media type (image, video, document)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Message info
   */
  async sendMedia(to, media, type, options = {}) {
    return this.media.sendMedia(to, media, type, options);
  }
  
  /**
   * Clean temporary files
   * @param {number} maxAge - Maximum age in milliseconds
   */
  async cleanTempFiles(maxAge = 3600000) {
    return this.media.cleanTempFiles(maxAge);
  }
  
  /**
   * Send typing indicator
   * @param {string} to - Recipient phone number
   * @param {boolean} isTyping - Whether user is typing
   */
  async sendTypingIndicator(to, isTyping = true) {
    return this.message.sendTypingIndicator(to, isTyping);
  }
  
  /**
   * Mark message as read
   * @param {string} jid - Chat JID
   * @param {Object} messageKey - Message key object
   */
  async markMessageAsRead(jid, messageKey) {
    return this.message.markMessageAsRead(jid, messageKey);
  }
  
  /**
   * React to a message
   * @param {string} jid - Chat JID
   * @param {Object} messageKey - Message key object
   * @param {string} emoji - Emoji reaction
   */
  async sendReaction(jid, messageKey, emoji) {
    return this.message.sendReaction(jid, messageKey, emoji);
  }
  
  /**
   * Download media from a message
   * @param {Object} message - WhatsApp message
   * @returns {Promise<Object>} Media information
   */
  async downloadMedia(message) {
    return this.media.downloadMedia(message);
  }
}

module.exports = BaileysClient;
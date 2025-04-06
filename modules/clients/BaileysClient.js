// modules/clients/BaileysClient.js
const path = require('path');
const fs = require('fs');
const events = require('events');
const pino = require('pino');

// Import Baileys modules
const BaileysAuth = require('./baileys/BaileysAuth');
const BaileysEvents = require('./baileys/BaileysEvents');
const BaileysMedia = require('./baileys/BaileysMedia');
const BaileysMessage = require('./baileys/BaileysMessage');

class BaileysClient extends events.EventEmitter {
  constructor(options = {}) {
    super();
    
    // Set instance ID for logging
    this.instanceId = options.instanceId || 'default';
    
    // Create required directories
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    
    if (!fs.existsSync(this.authFolder)) {
      fs.mkdirSync(this.authFolder, { recursive: true });
    }
    
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Create a logger with child() method for Baileys
    this.logger = pino({
      level: options.logLevel || 'warn',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true
        }
      }
    });
    
    // Initialize state
    this.isReady = false;
    this.isInitializing = false;
    this.showQrCode = false;
    
    // Initialize modules
    this.auth = new BaileysAuth(this);
    this.events = new BaileysEvents(this);
    this.media = new BaileysMedia(this);
    this.message = new BaileysMessage(this);
    
    // Message queue for sending when offline
    this.messageQueue = [];
    
    console.log(`[BaileysClient:${this.instanceId}] Initialized. Will connect on initialize() call.`);
  }
  
  // Set whether to show QR code
  setShowQrCode(show) {
    this.showQrCode = show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${show}`);
  }
  
  // Get the socket instance
  getSocket() {
    return this.auth.sock;
  }
  
  // Initialize the Baileys connection
  async initialize(showQrCode = false) {
    // Update QR code setting if provided
    if (showQrCode !== undefined) {
      this.setShowQrCode(showQrCode);
    }
    
    // Connect to WhatsApp
    return await this.auth.connect();
  }
  
  // Send a message
  async sendMessage(to, content, options = {}) {
    return await this.message.sendMessage(to, content, options);
  }
  
  // Send a GIF
  async sendGif(recipient, gifInput, caption = '') {
    return await this.media.sendGif(recipient, gifInput, caption);
  }
  
  // Send a video
  async sendVideo(recipient, videoPath, caption = '') {
    return await this.media.sendVideo(recipient, videoPath, caption);
  }
  
  // Send a document
  async sendDocument(recipient, documentPath, filename, caption = '') {
    return await this.media.sendDocument(recipient, documentPath, filename, caption);
  }
  
  // Download media from a message
  async downloadMedia(chatId, messageId, messageObj = null) {
    return await this.media.downloadMedia(chatId, messageId, messageObj);
  }
  
  // Create a media object from buffer
  createMediaFromBuffer(buffer, mimetype, filename) {
    return this.media.createMediaFromBuffer(buffer, mimetype, filename);
  }
  
  // Check if a number exists on WhatsApp
  async isRegisteredUser(number) {
    return await this.auth.isRegisteredUser(number);
  }
  
  // Check if authenticated
  async isAuthenticated() {
    return await this.auth.isAuthenticated();
  }
  
  // Try to restore session
  async restoreSession() {
    return await this.auth.restoreSession();
  }
  
  // Register QR code listener
  onQRCode(callback) {
    this.events.onQRCode(callback);
  }
  
  // Disconnect
  async disconnect(logOut = false) {
    return await this.auth.disconnect(logOut);
  }
}

module.exports = BaileysClient;
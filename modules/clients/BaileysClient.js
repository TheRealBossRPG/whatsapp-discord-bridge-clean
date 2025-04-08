// modules/clients/BaileysClient.js
const { makeWASocket, useMultiFileAuthState, isJidBroadcast, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { createWriteStream } = require('fs');

/**
 * WhatsApp client using Baileys
 */
class BaileysClient extends EventEmitter {
  constructor(options = {}) {
    super();
    // Set options
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.baileysAuthFolder || path.join(__dirname, '../../instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '../../instances', this.instanceId, 'temp');
    
    // Create required directories
    this.ensureDirectoriesExist();
    
    // Connection state
    this.sock = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = options.maxRetries || 5;
    this.showQrCode = false;
    
    // Event handlers
    this.eventEmitter = new EventEmitter();
    
    // Bind event handlers to this instance
    this.handleConnectionUpdate = this.handleConnectionUpdate.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    
    console.log(`[BaileysClient:${this.instanceId}] Initialized. Will connect on initialize() call.`);
  }
  
  /**
   * Create required directories
   */
  ensureDirectoriesExist() {
    const dirs = [this.authFolder, this.tempDir];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  /**
   * Set show QR code flag
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${show}`);
  }
  
  /**
   * Initialize the client
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Success
   */
  async initialize(showQrCode = false) {
    try {
      // If already initialized and connected, just return success
      if (this.isReady() && this.sock) {
        console.log(`[BaileysClient:${this.instanceId}] Already initialized and ready`);
        return true;
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${this.authFolder}`);
      
      // Set QR code flag
      this.showQrCode = showQrCode;
      
      // IMPORTANT: Check for existing auth
      const credentialsPath = path.join(this.authFolder, 'creds.json');
      const hasExistingAuth = fs.existsSync(credentialsPath);
      
      // Create auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      
      // Save the credentials save function
      this.saveCreds = saveCreds;
      
      // Initialize Baileys
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Don't print QR in terminal
        logger: global.pinoCompatLogger, // Use pino compatible logger
        browser: ['WhatsApp Bridge', 'Chrome', '108.0.5359.125'],
        syncFullHistory: false, // Don't sync full history to save bandwidth
        connectTimeoutMs: 30000, // Longer timeout
        defaultQueryTimeoutMs: 30000, // Longer query timeout
        retryRequestDelayMs: 250, // Faster retry
        patchMessageBeforeSending: false, // Don't patch messages
        mediaCache: makeCacheableSignalKeyStore(state.keys, global.pinoCompatLogger), // Use cacheable store
        generateHighQualityLinkPreview: true,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
        emitOwnEvents: true, // Emit events for own messages too
        fireInitQueries: true, // Fire initial queries
        markOnlineOnConnect: true // Mark as online on connect
      });
      
      // Register event handlers
      this.registerEvents();
      
      console.log(`[BaileysClient:${this.instanceId}] Event handlers registered`);
      
      // Wait for connection to be ready
      this.connectionAttempts++;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing:`, error);
      return false;
    }
  }
  
  /**
   * Register event handlers
   */
  registerEvents() {
    if (!this.sock) return;
    
    // Handle connection updates
    this.sock.ev.on('connection.update', this.handleConnectionUpdate);
    
    // Handle received messages
    this.sock.ev.on('messages.upsert', this.handleMessage);
    
    // Handle credentials update
    this.sock.ev.on('creds.update', this.saveCreds);
  }
  
  /**
   * Handle connection updates
   * @param {Object} update - Connection update
   */
  handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    
    // Handle QR code
    if (qr && this.showQrCode) {
      console.log(`[BaileysClient:${this.instanceId}] QR code received: ${qr.length} chars`);
      this.emit('qr', qr);
    }
    
    // Handle connection open
    if (connection === 'open') {
      console.log(`[BaileysClient:${this.instanceId}] Connected to WhatsApp`);
      this.isConnected = true;
      this.connectionAttempts = 0;
      this.emit('ready');
    }
    
    // Handle connection close
    if (connection === 'close') {
      this.isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || 'Unknown Reason';
      
      console.log(`[BaileysClient:${this.instanceId}] Connection closed. Reason: ${reason}`);
      
      // Check if logout or temporary issue
      if (statusCode === 401 || reason.includes('code: 401')) {
        // Unauthorized - logged out
        console.log(`[BaileysClient:${this.instanceId}] Session logged out`);
        this.emit('auth_failure', new Error('Session logged out'));
      } else if (statusCode === 403 || reason.includes('code: 403')) {
        // Forbidden - maybe banned?
        console.log(`[BaileysClient:${this.instanceId}] Account forbidden`);
        this.emit('auth_failure', new Error('Account forbidden'));
      } else if (statusCode === 409 || reason.includes('code: 409')) {
        // Conflict - session likely out of sync
        // Try to reconnect
        console.log(`[BaileysClient:${this.instanceId}] Session conflict`);
        this.emit('disconnected', 'Session Conflict');
      } else if (statusCode === 503 || reason.includes('code: 503')) {
        // Service unavailable - WhatsApp server issue
        console.log(`[BaileysClient:${this.instanceId}] Service unavailable`);
        this.emit('disconnected', 'Service Unavailable');
      } else if (reason.includes('Connection Closed') || reason.includes('Reconnecting')) {
        // Normal disconnect - can try to reconnect
        this.emit('disconnected', 'Connection Closed');
      } else {
        // Unknown error - try to reconnect
        const shouldReconnect = this.shouldAttemptReconnect();
        
        if (shouldReconnect) {
          const attempt = Math.min(this.connectionAttempts, this.maxRetries);
          console.log(`[BaileysClient:${this.instanceId}] Attempting to reconnect (${attempt}/${this.maxRetries})...`);
          this.connectionAttempts++;
          this.emit('disconnected', 'Reconnecting');
        } else {
          console.log(`[BaileysClient:${this.instanceId}] Not attempting to reconnect. Max attempts reached.`);
          this.emit('disconnected', reason);
        }
      }
    }
  }
  
  /**
   * Handle incoming message
   * @param {Object} param - Message param
   */
  handleMessage({ messages, type }) {
    if (type !== 'notify') return;
    
    for (const message of messages) {
      // Emit each message
      this.emit('message', message);
    }
  }
  
  /**
   * Check if client is ready
   * @returns {boolean} - Whether client is ready
   */
  isReady() {
    return this.isConnected && this.sock !== null;
  }
  
  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} - Authentication status
   */
  async isAuthenticated() {
    try {
      // Check if credentials exist
      const credentialsPath = path.join(this.authFolder, 'creds.json');
      if (!fs.existsSync(credentialsPath)) {
        return false;
      }
      
      // Advanced: Try to verify if credentials are valid
      try {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        // Check if required fields are present
        return !!credentials.me && !!credentials.me.id;
      } catch (parseError) {
        console.error(`[BaileysClient:${this.instanceId}] Error parsing credentials:`, parseError);
        return false;
      }
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  /**
   * Restore session
   * @returns {Promise<boolean>} - Success
   */
  async restoreSession() {
    try {
      if (this.isReady()) {
        console.log(`[BaileysClient:${this.instanceId}] Already connected, no need to restore`);
        return true;
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Attempting to restore session...`);
      
      // Check if credentials exist
      const credentialsPath = path.join(this.authFolder, 'creds.json');
      if (!fs.existsSync(credentialsPath)) {
        console.log(`[BaileysClient:${this.instanceId}] No credentials found to restore`);
        return false;
      }
      
      // Try to reconnect
      const success = await this.initialize(false);
      
      return success;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Determine if we should attempt to reconnect
   * @returns {boolean} - Whether to reconnect
   */
  shouldAttemptReconnect() {
    // Don't try to reconnect if we've exceeded max retries
    if (this.connectionAttempts >= this.maxRetries) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Send a message
   * @param {string} to - Recipient
   * @param {Object|string} content - Message content
   * @returns {Promise<Object>} - Message info
   */
  async sendMessage(to, content) {
    try {
      if (!this.isReady()) {
        throw new Error('Client not ready or connected');
      }
      
      // Ensure recipient has proper format
      if (!to.includes('@s.whatsapp.net') && !to.includes('@g.us')) {
        to = `${to}@s.whatsapp.net`;
      }
      
      // Format content if it's just a string
      const messageContent = typeof content === 'string'
        ? { text: content }
        : content;
      
      // Send the message
      const sentMessage = await this.sock.sendMessage(to, messageContent);
      
      return sentMessage;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * Send an image
   * @param {string} to - Recipient
   * @param {Buffer|string} image - Image buffer or path
   * @param {string} caption - Image caption
   * @returns {Promise<Object>} - Message info
   */
  async sendImage(to, image, caption = '') {
    try {
      if (!this.isReady()) {
        throw new Error('Client not ready or connected');
      }
      
      // Ensure recipient has proper format
      if (!to.includes('@s.whatsapp.net') && !to.includes('@g.us')) {
        to = `${to}@s.whatsapp.net`;
      }
      
      // Handle image as path or buffer
      let imageData;
      if (typeof image === 'string') {
        // It's a path, read the file
        imageData = fs.readFileSync(image);
      } else {
        // It's already a buffer
        imageData = image;
      }
      
      // Send the image
      const sentMessage = await this.sock.sendMessage(to, {
        image: imageData,
        caption: caption
      });
      
      return sentMessage;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending image:`, error);
      throw error;
    }
  }
  
  /**
   * Download media from a message
   * @param {Object} message - WhatsApp message
   * @returns {Promise<Buffer>} - Media buffer
   */
  async downloadMedia(message) {
    try {
      if (!this.isReady()) {
        throw new Error('Client not ready or connected');
      }
      
      if (!message) {
        throw new Error('No message provided');
      }
      
      // Get the message content
      let mediaMessage;
      
      if (message.message) {
        // It's a full message object
        mediaMessage = message.message;
      } else {
        // It's just the content
        mediaMessage = message;
      }
      
      // Find the media part
      let mediaType = null;
      let mediaContent = null;
      
      // Check for different media types
      if (mediaMessage.imageMessage) {
        mediaType = 'image';
        mediaContent = mediaMessage.imageMessage;
      } else if (mediaMessage.videoMessage) {
        mediaType = 'video';
        mediaContent = mediaMessage.videoMessage;
      } else if (mediaMessage.audioMessage) {
        mediaType = 'audio';
        mediaContent = mediaMessage.audioMessage;
      } else if (mediaMessage.documentMessage) {
        mediaType = 'document';
        mediaContent = mediaMessage.documentMessage;
      } else if (mediaMessage.stickerMessage) {
        mediaType = 'sticker';
        mediaContent = mediaMessage.stickerMessage;
      } else {
        throw new Error('No media found in message');
      }
      
      // Download the media
      const buffer = await this.sock.downloadMediaMessage(
        message,
        'buffer',
        {},
        { logger: global.pinoCompatLogger }
      );
      
      return buffer;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error downloading media:`, error);
      throw error;
    }
  }
  
  /**
   * Save media from a message to a file
   * @param {Object} message - WhatsApp message
   * @param {string} filePath - File path to save to
   * @returns {Promise<string>} - File path
   */
  async saveMedia(message, filePath) {
    try {
      // Download the media
      const buffer = await this.downloadMedia(message);
      
      // Create a write stream
      const writeStream = createWriteStream(filePath);
      
      // Return a promise that resolves when the file is written
      return new Promise((resolve, reject) => {
        writeStream.write(buffer);
        writeStream.end();
        writeStream.on('finish', () => resolve(filePath));
        writeStream.on('error', reject);
      });
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error saving media:`, error);
      throw error;
    }
  }
  
  /**
   * Disconnect the client
   * @param {boolean} logout - Whether to log out
   * @returns {Promise<boolean>} - Success
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // If not connected, nothing to disconnect
      if (!this.sock) {
        this.isConnected = false;
        return true;
      }
      
      // Remove all listeners
      this.sock.ev.removeAllListeners();
      
      // If logout requested, try to logout
      if (logout) {
        try {
          await this.sock.logout();
          console.log(`[BaileysClient:${this.instanceId}] Logged out successfully`);
          
          // Delete credentials
          const credsPath = path.join(this.authFolder, 'creds.json');
          if (fs.existsSync(credsPath)) {
            fs.unlinkSync(credsPath);
            console.log(`[BaileysClient:${this.instanceId}] Deleted credentials file`);
          }
        } catch (logoutError) {
          console.error(`[BaileysClient:${this.instanceId}] Error logging out:`, logoutError);
        }
      }
      
      // Close socket
      try {
        await this.sock.end();
        console.log(`[BaileysClient:${this.instanceId}] Socket closed`);
      } catch (endError) {
        console.error(`[BaileysClient:${this.instanceId}] Error closing socket:`, endError);
      }
      
      // Clear socket and set disconnected
      this.sock = null;
      this.isConnected = false;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Force clean state even on error
      this.sock = null;
      this.isConnected = false;
      
      return false;
    }
  }
}

module.exports = BaileysClient;
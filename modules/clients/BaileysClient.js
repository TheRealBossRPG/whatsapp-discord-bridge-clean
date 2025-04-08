// modules/clients/BaileysClient.js
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Import Baileys dependencies
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  isJidUser,
  extractMessageContent
} = require('@whiskeysockets/baileys');

/**
 * WhatsApp client using Baileys library
 */
class BaileysClient extends EventEmitter {
  /**
   * Create a new WhatsApp client
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    super();
    
    this.instanceId = options.instanceId || 'default';
    
    // CRITICAL FIX: Use baileys_auth as specified in logs to maintain consistency
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    this.maxRetries = options.maxRetries || 5;
    this.reconnectInterval = options.reconnectInterval || 3000;
    
    // Create needed directories
    if (!fs.existsSync(this.authFolder)) {
      fs.mkdirSync(this.authFolder, { recursive: true });
    }
    if (!fs.existsSync(this.baileysAuthFolder)) {
      fs.mkdirSync(this.baileysAuthFolder, { recursive: true });
    }
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Initialization state
    this.initialized = false;
    this.isReady = false;
    this.socket = null;
    this.retryCount = 0;
    this.showQrCode = false;
    
    console.log(`[BaileysClient:${this.instanceId}] Initialized. Will connect on initialize() call.`);
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
   * Initialize WhatsApp client
   * @param {boolean} showQrCode - Whether to show QR code if needed
   * @returns {Promise<boolean>} - Connection success
   */
  async initialize(showQrCode = false) {
    try {
      if (this.initialized && this.isReady && this.socket) {
        console.log(`[BaileysClient:${this.instanceId}] Already initialized and ready`);
        return true;
      }
      
      // Update QR code flag
      this.showQrCode = showQrCode;
      
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      
      // Create auth state
      // CRITICAL FIX: Use the baileysAuthFolder for consistency with the logs
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${this.baileysAuthFolder}`);
      const { state, saveCreds } = await useMultiFileAuthState(this.baileysAuthFolder);
      
      // Fetch the latest version
      const { version } = await fetchLatestBaileysVersion();
      console.log(`[BaileysClient:${this.instanceId}] Using WA ${version.join(',')}`);
      
      // Create socket connection
      this.socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // We handle QR ourselves
        logger: global.pinoCompatLogger, // Use the custom logger
        browser: ['WhatsApp-Discord Bridge', 'Chrome', '10.0.0'],
        syncFullHistory: false, // Save bandwidth
        markOnlineOnConnect: true,
        getMessage: async () => {
          return { conversation: 'Message not found in server' };
        }
      });
      
      // Register event handlers
      this.registerEventHandlers(saveCreds);
      console.log(`[BaileysClient:${this.instanceId}] Event handlers registered`);
      
      // Mark as initialized but not yet ready (wait for connection)
      this.initialized = true;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp client:`, error);
      this.initialized = false;
      this.isReady = false;
      return false;
    }
  }
  
  /**
   * Register Baileys event handlers
   * @param {Function} saveCreds - Function to save credentials
   */
  registerEventHandlers(saveCreds) {
    if (!this.socket) return;
    
    // Handle connection update
    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Handle connection state changes
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`[BaileysClient:${this.instanceId}] Connection closed. Reason: ${lastDisconnect?.error?.message || 'Unknown'}`);
        
        // Emit disconnected event
        this.emit('disconnected', lastDisconnect?.error?.message || 'Unknown');
        
        // Auto-reconnect if not logged out
        if (shouldReconnect && this.retryCount < this.maxRetries) {
          this.retryCount++;
          
          console.log(`[BaileysClient:${this.instanceId}] Attempting to reconnect (${this.retryCount}/${this.maxRetries})...`);
          
          setTimeout(() => {
            this.initialize(this.showQrCode).catch(err => {
              console.error(`[BaileysClient:${this.instanceId}] Reconnect error:`, err);
            });
          }, this.reconnectInterval);
        } else if (this.retryCount >= this.maxRetries) {
          console.log(`[BaileysClient:${this.instanceId}] Max reconnect attempts reached.`);
        }
        
        // Update state
        this.isReady = false;
      } else if (connection === 'open') {
        console.log(`[BaileysClient:${this.instanceId}] Connected to WhatsApp`);
        
        // Reset retry counter on successful connection
        this.retryCount = 0;
        
        // Update state
        this.isReady = true;
        
        // Emit ready event
        this.emit('ready');
      }
      
      // Handle QR code
      if (qr && this.showQrCode) {
        console.log(`[BaileysClient:${this.instanceId}] QR code received: ${qr.length} chars`);
        
        // Emit QR code event
        this.emit('qr', qr);
      }
    });
    
    // Handle credentials updates
    this.socket.ev.on('creds.update', saveCreds);
    
    // Handle messages
    this.socket.ev.on('messages.upsert', async (messageInfo) => {
      if (messageInfo.type !== 'notify') return;
      
      for (const message of messageInfo.messages) {
        // Ignore messages from us
        if (!message.key.fromMe) {
          // Emit message event
          this.emit('message', message);
        }
      }
    });
    
    // Socket closed
    this.socket.ev.on('ws-close', (info) => {
      console.log(`[BaileysClient:${this.instanceId}] Socket closed`);
    });
    
    // Other events we might want to handle
    this.socket.ev.on('chats.set', () => {
      // New chats set
    });
    
    this.socket.ev.on('contacts.update', () => {
      // Contacts updated
    });
  }
  
  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} - Whether client is authenticated
   */
  async isAuthenticated() {
    try {
      // Check if auth files exist
      const credsPath = path.join(this.baileysAuthFolder, 'creds.json');
      return fs.existsSync(credsPath);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking auth:`, error);
      return false;
    }
  }
  
  /**
   * Try to restore session
   * @returns {Promise<boolean>} - Whether session was restored
   */
  async restoreSession() {
    try {
      if (this.isReady) {
        console.log(`[BaileysClient:${this.instanceId}] Session already active`);
        return true;
      }
      
      // Check if we have auth data
      const isAuth = await this.isAuthenticated();
      if (!isAuth) {
        console.log(`[BaileysClient:${this.instanceId}] No stored auth data found`);
        return false;
      }
      
      // Try to initialize without QR code
      const success = await this.initialize(false);
      
      // If initialization worked but we're not connected, wait for connection
      if (success && !this.isReady) {
        console.log(`[BaileysClient:${this.instanceId}] Waiting for connection...`);
        
        // Wait for connection with timeout
        const connected = await new Promise((resolve) => {
          // Set timeout for connection
          const timeout = setTimeout(() => {
            this.off('ready', handleReady);
            resolve(false);
          }, 30000);
          
          // Handler for ready event
          const handleReady = () => {
            clearTimeout(timeout);
            resolve(true);
          };
          
          // Listen for ready event
          this.once('ready', handleReady);
          
          // If already ready, resolve immediately
          if (this.isReady) {
            clearTimeout(timeout);
            resolve(true);
          }
        });
        
        return connected;
      }
      
      return this.isReady;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Send a text message
   * @param {string} recipient - Recipient ID
   * @param {string} text - Message text
   * @returns {Promise<Object>} - Sent message info
   */
  async sendTextMessage(recipient, text) {
    try {
      // CRITICAL FIX: Make sure text is a string
      if (typeof text !== 'string') {
        console.error(`[BaileysClient:${this.instanceId}] Error sending message: text is not a string`);
        throw new TypeError('Text must be a string');
      }
      
      // Make sure client is ready
      if (!this.isReady || !this.socket) {
        throw new Error('Client not ready');
      }
      
      // Ensure recipient has proper format
      const jid = this.formatJid(recipient);
      
      // Send message
      const sentMsg = await this.socket.sendMessage(jid, { text: text });
      return sentMsg;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * Download media from a message
   * @param {Object} message - Message with media
   * @returns {Promise<Object>} - Media data
   */
  async downloadMedia(message) {
    try {
      if (!this.socket || !message) {
        throw new Error('Client not ready or no message provided');
      }
      
      // Extract content for processing
      let content;
      
      // Try multiple formats to get the media content
      if (message.message) {
        // Standard baileys message format
        content = message.message;
      } else if (message.data) {
        // Already processed message
        return message;
      } else {
        // Try to extract content from legacy format
        content = message;
      }
      
      // Determine media type and get stream
      let stream;
      let mimetype;
      let filename;
      
      // Image message
      if (content.imageMessage) {
        stream = await downloadContentFromMessage(content.imageMessage, 'image');
        mimetype = content.imageMessage.mimetype;
        filename = content.imageMessage.fileName || 'image.jpg';
      }
      // Video message
      else if (content.videoMessage) {
        stream = await downloadContentFromMessage(content.videoMessage, 'video');
        mimetype = content.videoMessage.mimetype;
        filename = content.videoMessage.fileName || 'video.mp4';
      }
      // Document message
      else if (content.documentMessage) {
        stream = await downloadContentFromMessage(content.documentMessage, 'document');
        mimetype = content.documentMessage.mimetype;
        filename = content.documentMessage.fileName || 'document.pdf';
      }
      // Audio message
      else if (content.audioMessage) {
        stream = await downloadContentFromMessage(content.audioMessage, 'audio');
        mimetype = content.audioMessage.mimetype;
        filename = content.audioMessage.fileName || 'audio.mp3';
      }
      // Sticker message
      else if (content.stickerMessage) {
        stream = await downloadContentFromMessage(content.stickerMessage, 'sticker');
        mimetype = content.stickerMessage.mimetype;
        filename = 'sticker.webp';
      }
      // Extended image message (for compatibility)
      else if (content.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
        const quotedMsg = content.extendedTextMessage.contextInfo.quotedMessage;
        stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
        mimetype = quotedMsg.imageMessage.mimetype;
        filename = quotedMsg.imageMessage.fileName || 'image.jpg';
      }
      // No supported media found
      else {
        throw new Error('No supported media found in message');
      }
      
      // Download the media
      const buffer = await this.streamToBuffer(stream);
      
      return {
        data: buffer,
        mimetype: mimetype,
        filename: filename
      };
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error downloading media:`, error);
      throw error;
    }
  }
  
  /**
   * Convert a stream to buffer
   * @param {Stream} stream - Data stream
   * @returns {Promise<Buffer>} - Data buffer
   */
  async streamToBuffer(stream) {
    const chunks = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      stream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      
      stream.on('error', (err) => {
        reject(err);
      });
    });
  }
  
  /**
   * Format JID (ensure it has @s.whatsapp.net suffix)
   * @param {string} jid - JID to format
   * @returns {string} - Formatted JID
   */
  formatJid(jid) {
    // If already a valid JID, return as is
    if (jid.includes('@')) {
      return jid;
    }
    
    // Clean up the JID
    const cleanJid = jid.replace(/[^\d]/g, '');
    
    // Add WhatsApp suffix if not already there
    return `${cleanJid}@s.whatsapp.net`;
  }
  
  /**
   * Disconnect client
   * @param {boolean} logout - Whether to logout (removes credentials)
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // Process logout if requested
      if (logout && this.socket?.authState?.creds) {
        // Mark as logged out
        this.socket.authState.creds.registered = false;
        
        // Save the updated credentials
        if (this.socket.updateCreds) {
          await this.socket.updateCreds(this.socket.authState.creds);
        }
      }
      
      // Close socket if it exists
      if (this.socket) {
        await this.socket.logout();
        this.socket.ev.removeAllListeners();
        this.socket = null;
      }
      
      // Reset state
      this.isReady = false;
      this.initialized = false;
      
      // If logout was requested, delete auth files
      if (logout) {
        const credsPath = path.join(this.baileysAuthFolder, 'creds.json');
        if (fs.existsSync(credsPath)) {
          fs.unlinkSync(credsPath);
        }
      }
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Force reset state on error
      this.isReady = false;
      this.initialized = false;
      this.socket = null;
      
      return false;
    }
  }
}

module.exports = BaileysClient;
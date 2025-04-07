// modules/clients/BaileysClient.js
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

/**
 * WhatsApp client implementation using Baileys library
 */
class BaileysClient extends EventEmitter {
  /**
   * Create a new Baileys client
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    super();
    
    // Client-specific settings
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(this.authFolder, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    this.maxRetries = options.maxRetries || 5;
    
    // Create required directories
    [this.authFolder, this.baileysAuthFolder, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Connection state
    this.socket = null;
    this.isReady = false;
    this.retryCount = 0;
    this.authState = null;
    this.saveCreds = null;
    
    // For showing QR code
    this.showQrCode = true;
    
    // Logger using the global pino instance for consistent formatting
    this.logger = typeof global.pinoCompatLogger !== 'undefined' 
      ? global.pinoCompatLogger.child({ module: `BaileysClient:${this.instanceId}` })
      : pino({ 
          level: process.env.LOG_LEVEL || 'warn',
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              ignore: 'hostname,pid'
            }
          }
        }).child({ module: `BaileysClient:${this.instanceId}` });
    
    console.log(`[BaileysClient:${this.instanceId}] Initialized. Will connect on initialize() call.`);
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
   * @returns {Promise<boolean>} - Success state
   */
  async initialize(showQrCode = false) {
    try {
      // Set QR code display flag
      this.setShowQrCode(showQrCode);
      
      // Check if already connected
      if (this.socket && this.isReady) {
        console.log(`[BaileysClient:${this.instanceId}] Already connected`);
        return true;
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      
      // Initialize authentication state
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${this.baileysAuthFolder}`);
      const { state, saveCreds } = await useMultiFileAuthState(this.baileysAuthFolder);
      this.authState = state;
      this.saveCreds = saveCreds;
      
      // Fetch the latest WA version
      const { version } = await fetchLatestBaileysVersion();
      console.log(`[BaileysClient:${this.instanceId}] Using WA v${version.join(',')}`);
      
      // Create the socket
      this.socket = makeWASocket({
        version,
        auth: this.authState,
        logger: this.logger,
        printQRInTerminal: true,
        emitOwnEvents: true,
        getMessage: async (key) => {
          // This function is needed for message quotes to work correctly
          return {
            conversation: ''
          };
        }
      });
      
      // Register the event handlers
      this.registerEventHandlers();
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing:`, error);
      this.socket = null;
      this.isReady = false;
      return false;
    }
  }
  
  /**
   * Register all Baileys event handlers
   */
  registerEventHandlers() {
    if (!this.socket) return;
    
    // Connection events
    this.socket.ev.on('connection.update', this.handleConnectionUpdate.bind(this));
    
    // Credentials events
    this.socket.ev.on('creds.update', this.handleCredsUpdate.bind(this));
    
    // Message events
    this.socket.ev.on('messages.upsert', this.handleMessageUpsert.bind(this));
    
    console.log(`[BaileysClient:${this.instanceId}] Event handlers registered`);
  }
  
  /**
   * Handle connection updates
   * @param {Object} update - Connection update
   */
  async handleConnectionUpdate(update) {
    try {
      const { connection, lastDisconnect, qr } = update;
      
      // Handle QR code if available
      if (qr && this.showQrCode) {
        this.emit('qr', qr);
      }
      
      // Handle connection state changes
      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        
        console.log(`[BaileysClient:${this.instanceId}] Connection closed. Reason: ${lastDisconnect?.error?.message || 'Unknown'}`);
        
        this.isReady = false;
        this.emit('disconnected', lastDisconnect?.error?.message || 'Unknown');
        
        // Handle reconnection if needed
        if (shouldReconnect && this.retryCount < this.maxRetries) {
          this.retryCount++;
          console.log(`[BaileysClient:${this.instanceId}] Attempting to reconnect (${this.retryCount}/${this.maxRetries})...`);
          
          setTimeout(async () => {
            await this.initialize(this.showQrCode);
          }, 2000);
        } else if (reason === DisconnectReason.loggedOut) {
          // Emit disconnected event with reason
          this.emit('auth_failure', new Error('Logged out'));
        }
      } else if (connection === 'open') {
        console.log(`[BaileysClient:${this.instanceId}] Connected to WhatsApp`);
        this.isReady = true;
        this.retryCount = 0;
        this.emit('ready');
      }
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error handling connection update:`, error);
    }
  }
  
  /**
   * Handle credentials updates
   * @param {Object} creds - Updated credentials
   */
  async handleCredsUpdate(creds) {
    try {
      if (this.saveCreds) {
        await this.saveCreds();
      }
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error saving credentials:`, error);
    }
  }
  
  /**
   * Handle new messages
   * @param {Object} data - Message data
   */
  async handleMessageUpsert(data) {
    try {
      if (data.type !== 'notify') return;
      
      for (const message of data.messages) {
        this.emit('message', message);
      }
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error handling message:`, error);
    }
  }
  
  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} - Authentication status
   */
  async isAuthenticated() {
    try {
      // Check if credentials exist
      const credsPath = path.join(this.baileysAuthFolder, 'creds.json');
      return fs.existsSync(credsPath);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  /**
   * Restore saved session
   * @returns {Promise<boolean>} - Success status
   */
  async restoreSession() {
    try {
      // Check if authenticated first
      const isAuth = await this.isAuthenticated();
      if (!isAuth) {
        console.log(`[BaileysClient:${this.instanceId}] No saved session found`);
        return false;
      }
      
      // Try to initialize without showing QR code
      const success = await this.initialize(false);
      return success && this.isReady;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Send a text message
   * @param {string} jid - Recipient JID
   * @param {Object} content - Message content (with text property)
   * @returns {Promise<Object>} - Sent message info
   */
  async sendMessage(jid, content) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error('Socket not ready');
      }
      
      return await this.socket.sendMessage(jid, content);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * Download media from a message
   * @param {Object} message - WhatsApp message
   * @param {string} filePath - Path to save the file
   * @returns {Promise<boolean>} - Success status
   */
  async downloadMedia(message, filePath) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error('Socket not ready');
      }
      
      if (!message || !message.message) {
        throw new Error('Invalid message');
      }
      
      let buffer = null;
      
      // Determine message type and download accordingly
      if (message.message.imageMessage) {
        buffer = await this.socket.downloadMediaMessage(message);
      } else if (message.message.videoMessage) {
        buffer = await this.socket.downloadMediaMessage(message);
      } else if (message.message.documentMessage) {
        buffer = await this.socket.downloadMediaMessage(message);
      } else if (message.message.audioMessage) {
        buffer = await this.socket.downloadMediaMessage(message);
      } else if (message.message.stickerMessage) {
        buffer = await this.socket.downloadMediaMessage(message);
      } else {
        throw new Error('Unsupported media type');
      }
      
      // Save the buffer to file
      if (buffer) {
        fs.writeFileSync(filePath, buffer);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error downloading media:`, error);
      throw error;
    }
  }
  
  /**
   * Disconnect the client
   * @param {boolean} logout - Whether to log out completely
   * @returns {Promise<boolean>} - Success status
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      if (this.socket) {
        if (logout) {
          // Log out completely (will require new QR scan)
          await this.socket.logout();
        }
        
        // Close the socket
        this.socket.ev.removeAllListeners();
        this.socket.end(undefined);
        console.log(`[BaileysClient:${this.instanceId}] Socket closed`);
      }
      
      // Reset state
      this.socket = null;
      this.isReady = false;
      this.retryCount = 0;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Force reset state even on error
      this.socket = null;
      this.isReady = false;
      
      return false;
    }
  }
}

module.exports = BaileysClient;
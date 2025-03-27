// modules/clients/BaileysClient.js
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const EventEmitter = require('events');
const qrcode = require('qrcode');

/**
 * WhatsApp client implementation using Baileys library
 */
class BaileysClient extends EventEmitter {
  /**
   * Create a new WhatsApp client
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    super();

    // Configuration
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(this.authFolder, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    this.logLevel = options.logLevel || 'error';
    this.maxRetries = options.maxRetries || 5;
    this.browser = options.browser || Browsers.ubuntu('Chrome');
    
    // Create directories if they don't exist
    [this.authFolder, this.baileysAuthFolder, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Client state
    this.socket = null;
    this.isReady = false;
    this.isInitializing = false;
    this.lastQRCode = null;
    this.showQrCode = false;
    this.qrTimeout = 60000; // 1 minute
    this.retryCount = 0;
    this.connectionRetryTimer = null;
    
    // Logger
    this.logger = pino({ 
      level: this.logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: true,
          ignore: 'hostname,pid'
        }
      }
    }).child({ module: `BaileysClient:${this.instanceId}` });

    // Create QR code folder if it doesn't exist
    const qrPath = path.join(this.tempDir, 'qr');
    if (!fs.existsSync(qrPath)) {
      fs.mkdirSync(qrPath, { recursive: true });
    }
  }

  /**
   * Set timeout for QR code generation
   * @param {number} timeout - Timeout in milliseconds
   */
  setQrTimeout(timeout) {
    if (timeout && typeof timeout === 'number' && timeout > 0) {
      this.qrTimeout = timeout;
      this.logger.info(`QR code timeout set to ${timeout}ms`);
    }
  }

  /**
   * Set showQrCode flag
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = show;
    this.logger.info(`Show QR code set to ${show}`);
  }

  /**
   * Save QR code to file
   * @param {string} qrCode - QR code data
   * @returns {Promise<string>} - Path to saved QR code image
   */
  async saveQRCodeToFile(qrCode) {
    try {
      const qrPath = path.join(this.tempDir, 'qrcode.png');
      await qrcode.toFile(qrPath, qrCode, {
        errorCorrectionLevel: 'H',
        margin: 1,
        scale: 8,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      return qrPath;
    } catch (error) {
      this.logger.error(`Error saving QR code to file: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} - Whether client is authenticated
   */
  async isAuthenticated() {
    try {
      // Check both auth folders for existing credentials
      const authPaths = [
        path.join(this.authFolder, 'creds.json'),
        path.join(this.baileysAuthFolder, 'creds.json')
      ];
      
      for (const authPath of authPaths) {
        if (fs.existsSync(authPath)) {
          try {
            const content = fs.readFileSync(authPath, 'utf8');
            const creds = JSON.parse(content);
            
            // Check if credentials contain auth data
            if (creds && creds.me && creds.me.id) {
              return true;
            }
          } catch (error) {
            this.logger.warn(`Error checking auth file ${authPath}: ${error.message}`);
          }
        }
      }
      
      return false;
    } catch (error) {
      this.logger.error(`Error checking authentication: ${error.message}`);
      return false;
    }
  }

  /**
   * Create a new socket connection
   * @returns {Promise<Object>} - Baileys socket
   */
  async createSocket() {
    try {
      // Fetch latest version of Baileys
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.logger.info(`Using Baileys version ${version}, isLatest: ${isLatest}`);
      
      // Get auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.baileysAuthFolder);
      
      // Create socket
      const socket = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger)
        },
        printQRInTerminal: false,
        logger: this.logger,
        browser: this.browser,
        version,
        syncFullHistory: false
      });
      
      // Set up save credentials handler
      socket.ev.on('creds.update', async () => {
        await saveCreds();
      });
      
      return { socket, saveCreds };
    } catch (error) {
      this.logger.error(`Error creating socket: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize WhatsApp client with improved error handling
   * @returns {Promise<boolean>} - Initialization success status
   */
  async initialize() {
    try {
      if (this.isInitializing) {
        this.logger.warn('Initialization already in progress, skipping');
        return false;
      }
      
      // Set initializing flag
      this.isInitializing = true;
      
      this.logger.info(`Initializing WhatsApp client (retry ${this.retryCount + 1}/${this.maxRetries})`);
      
      // Clean up existing connection if any
      if (this.socket) {
        try {
          this.logger.info('Cleaning up existing connection');
          this.socket.ev.removeAllListeners();
          await this.socket.logout();
          this.socket = null;
        } catch (cleanupError) {
          this.logger.error(`Error cleaning up existing connection: ${cleanupError.message}`);
        }
      }
      
      // Set up clean slate
      this.isReady = false;
      
      // Create a new socket connection
      const { socket, saveCreds } = await this.createSocket();
      this.socket = socket;
      
      // Store credentials for future use
      this.saveCreds = saveCreds;
      
      // Set up event handlers
      this.setupEventHandlers();
      
      // Start QR timeout if showing QR code
      if (this.showQrCode) {
        this.logger.info(`Starting QR code timeout of ${this.qrTimeout}ms`);
        setTimeout(() => {
          // Emit timeout event if not connected
          if (!this.isReady) {
            this.logger.warn('QR code timeout reached without connection');
            this.emit('qr_timeout');
          }
        }, this.qrTimeout);
      }
      
      // Reset retry count on successful initialization
      this.retryCount = 0;
      this.isInitializing = false;
      
      // If already authenticated and not forcing QR, mark as ready immediately
      const isAuth = await this.isAuthenticated();
      if (isAuth && !this.showQrCode) {
        this.logger.info('Already authenticated, marking as ready');
        this.isReady = true;
        this.emit('ready');
      }
      
      return true;
    } catch (error) {
      this.isInitializing = false;
      this.logger.error(`Error initializing WhatsApp client: ${error.message}`);
      
      // Increment retry count
      this.retryCount++;
      
      // If under max retries, try again
      if (this.retryCount < this.maxRetries) {
        this.logger.info(`Retry attempt ${this.retryCount + 1}/${this.maxRetries} in 5 seconds`);
        clearTimeout(this.connectionRetryTimer);
        this.connectionRetryTimer = setTimeout(() => {
          this.initialize().catch(retryError => {
            this.logger.error(`Error in retry attempt: ${retryError.message}`);
          });
        }, 5000);
        return false;
      }
      
      // Reset retry count
      this.retryCount = 0;
      return false;
    }
  }

  /**
   * Setup event handlers for the WhatsApp client
   */
  setupEventHandlers() {
    if (!this.socket) {
      this.logger.error('Cannot set up event handlers: Socket is null');
      return;
    }
    
    // Connection update event
    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Handle QR code
      if (qr) {
        this.logger.info(`Received QR code (${qr.length} chars)`);
        this.lastQRCode = qr;
        
        // Save QR code to file
        this.saveQRCodeToFile(qr).then(qrPath => {
          if (qrPath) {
            this.logger.info(`QR code saved to ${qrPath}`);
          }
        });
        
        // Emit QR code event
        this.emit('qr', qr);
      }
      
      // Handle connection state
      if (connection) {
        this.logger.info(`Connection state: ${connection}`);
        
        if (connection === 'open') {
          this.logger.info('Connection open, client is ready');
          this.isReady = true;
          this.emit('ready');
        } else if (connection === 'close') {
          this.isReady = false;
          
          // Get disconnect reason
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const reason = lastDisconnect?.error?.output?.payload?.error;
          
          this.logger.warn(`Connection closed (${statusCode}): ${reason || 'Unknown reason'}`);
          
          // Handle specific disconnect reasons
          if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
            this.logger.info('Client logged out, need to clear auth files and re-scan QR code');
            this.emit('logged_out');
          } else if (statusCode === DisconnectReason.restartRequired) {
            this.logger.info('Restart required, attempting to reconnect');
            this.reconnect();
          } else if (statusCode === DisconnectReason.connectionClosed) {
            this.logger.info('Connection closed, attempting to reconnect');
            this.reconnect();
          } else if (statusCode === DisconnectReason.connectionLost) {
            this.logger.info('Connection lost, attempting to reconnect');
            this.reconnect();
          } else if (statusCode === DisconnectReason.connectionReplaced) {
            this.logger.warn('Connection replaced, another client logged in');
            this.emit('connection_replaced');
          } else if (statusCode === DisconnectReason.timedOut) {
            this.logger.info('Connection timed out, attempting to reconnect');
            this.reconnect();
          } else {
            this.logger.info('Disconnected for unknown reason, attempting to reconnect');
            this.reconnect();
          }
          
          // Emit disconnect event
          this.emit('disconnected', reason || 'unknown');
        }
      }
    });
    
    // Messages event
    this.socket.ev.on('messages.upsert', (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          // Skip messages from self
          if (msg.key.fromMe) continue;
          
          // Emit message event
          this.emit('message', msg);
        }
      }
    });
  }

  /**
   * Attempt to reconnect gracefully
   */
  reconnect() {
    this.logger.info('Attempting to reconnect');
    
    // Clear any existing retry timer
    clearTimeout(this.connectionRetryTimer);
    
    // Use exponential backoff for reconnection
    const backoffTime = Math.min(5000 * Math.pow(2, this.retryCount), 30000);
    this.logger.info(`Reconnecting in ${backoffTime}ms (attempt ${this.retryCount + 1})`);
    
    this.connectionRetryTimer = setTimeout(async () => {
      try {
        // Perform initialization
        this.logger.info('Executing reconnection');
        await this.initialize();
      } catch (error) {
        this.logger.error(`Error during reconnection: ${error.message}`);
        
        // Increment retry counter
        this.retryCount++;
        
        // Try again if under max retries
        if (this.retryCount < this.maxRetries) {
          this.reconnect();
        } else {
          this.logger.error(`Maximum reconnection attempts (${this.maxRetries}) reached`);
          this.retryCount = 0;
          this.emit('connection_failed');
        }
      }
    }, backoffTime);
  }

  /**
   * Attempt to restore session manually
   * @returns {Promise<boolean>} - Success status
   */
  async restoreSession() {
    try {
      this.logger.info('Attempting to restore session');
      
      // Check if we're already connected
      if (this.isReady) {
        this.logger.info('Already connected, no need to restore');
        return true;
      }
      
      // Check if authenticated
      const isAuth = await this.isAuthenticated();
      if (!isAuth) {
        this.logger.info('No valid auth data found, cannot restore session');
        return false;
      }
      
      // Initialize with existing auth
      this.showQrCode = false;
      const success = await this.initialize();
      
      if (success && this.isReady) {
        this.logger.info('Session restored successfully');
        return true;
      }
      
      this.logger.warn('Session restore failed despite having auth data');
      return false;
    } catch (error) {
      this.logger.error(`Error restoring session: ${error.message}`);
      return false;
    }
  }

  /**
   * Send a WhatsApp message
   * @param {string} recipient - Recipient JID
   * @param {string|Object} message - Message content
   * @param {Object} options - Message options
   * @returns {Promise<Object>} - Message info
   */
  async sendMessage(recipient, message, options = {}) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error('Client not ready, cannot send message');
      }
      
      // Add @s.whatsapp.net suffix if not present and not a group
      if (recipient.includes('@g.us')) {
        // Group chat, leave as is
      } else if (!recipient.includes('@')) {
        recipient = `${recipient}@s.whatsapp.net`;
      }
      
      const result = await this.socket.sendMessage(recipient, 
        typeof message === 'string' ? { text: message } : message, 
        options
      );
      
      return result;
    } catch (error) {
      this.logger.error(`Error sending message to ${recipient}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download media from a message
   * @param {Object} message - Message containing media
   * @returns {Promise<Object>} - Downloaded media
   */
  async downloadMedia(message) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error('Client not ready, cannot download media');
      }
      
      // Handle different message types
      let mediaMessage;
      
      if (message.imageMessage) {
        mediaMessage = message.imageMessage;
      } else if (message.videoMessage) {
        mediaMessage = message.videoMessage;
      } else if (message.audioMessage) {
        mediaMessage = message.audioMessage;
      } else if (message.documentMessage) {
        mediaMessage = message.documentMessage;
      } else if (message.stickerMessage) {
        mediaMessage = message.stickerMessage;
      } else {
        throw new Error('Unsupported media type');
      }
      
      // Download the media
      const buffer = await this.socket.downloadMediaMessage(
        { key: { remoteJid: message.remoteJid, id: message.id }, message: { [message.mtype]: message } },
        'buffer'
      );
      
      // Return in base64 format
      return {
        data: buffer.toString('base64'),
        mimetype: mediaMessage.mimetype || 'application/octet-stream',
        filename: mediaMessage.fileName || 'file'
      };
    } catch (error) {
      this.logger.error(`Error downloading media: ${error.message}`);
      return null;
    }
  }

  /**
   * Disconnect the WhatsApp client
   * @param {boolean} logout - Whether to perform full logout
   * @returns {Promise<boolean>} - Success status
   */
  async disconnect(logout = false) {
    try {
      // Clear any reconnection timer
      clearTimeout(this.connectionRetryTimer);
      
      if (!this.socket) {
        this.logger.info('No active socket, already disconnected');
        this.isReady = false;
        return true;
      }
      
      this.logger.info(`Disconnecting WhatsApp client (logout=${logout})`);
      
      if (logout) {
        try {
          // Perform full logout
          await this.socket.logout();
          this.logger.info('Logged out successfully');
        } catch (logoutError) {
          this.logger.error(`Error logging out: ${logoutError.message}`);
        }
      } else {
        try {
          // Just close the connection
          await this.socket.end();
          this.logger.info('Connection closed');
        } catch (endError) {
          this.logger.error(`Error ending connection: ${endError.message}`);
        }
      }
      
      // Clean up event listeners
      try {
        this.socket.ev.removeAllListeners();
      } catch (cleanupError) {
        this.logger.error(`Error cleaning up listeners: ${cleanupError.message}`);
      }
      
      // Reset state
      this.socket = null;
      this.isReady = false;
      this.lastQRCode = null;
      
      return true;
    } catch (error) {
      this.logger.error(`Error disconnecting: ${error.message}`);
      
      // Reset state even on error
      this.socket = null;
      this.isReady = false;
      
      return false;
    }
  }
}

module.exports = BaileysClient;
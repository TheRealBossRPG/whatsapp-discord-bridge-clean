// modules/clients/BaileysClient.js - Fixed for better connection management & reduced logging
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const { EventEmitter } = require('events');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  proto
} = require('@whiskeysockets/baileys');

/**
 * WhatsApp client implementation using Baileys
 */
class BaileysClient extends EventEmitter {
  /**
   * Create a new Baileys client
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    super();
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '../../instances', this.instanceId, 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(this.authFolder, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '../../instances', this.instanceId, 'temp');
    
    // Create directories if they don't exist
    [this.authFolder, this.baileysAuthFolder, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Metrics
    this.messagesCount = 0;
    this.reconnectCount = 0;
    this.maxRetries = options.maxRetries || 5;
    
    // State
    this.socket = null;
    this.isReady = false;
    this.isInitializing = false;
    this.showQrCode = false;
    this.auth = null;
    this.store = null;
    this.contactCache = {};
    
    // Prevent multiple reconnect attempts
    this.reconnectTimer = null;
    this.reconnectInProgress = false;
    
    // Create message retrieval cache
    this.msgRetryCache = new NodeCache();
    
    // Automatic behavior flags
    this.autoReconnect = options.autoReconnect !== false;
    this.logLevel = options.logLevel || 'normal'; // 'minimal', 'normal', 'verbose'
    
    this.log('info', `Initialized. Will connect on initialize() call.`);
  }
  
  /**
   * Log message with appropriate level
   * @param {string} level - Log level (debug, info, warn, error)
   * @param {string} message - Message to log
   */
  log(level, message) {
    const prefix = `[BaileysClient:${this.instanceId}]`;
    
    // Honor logging level
    if (this.logLevel === 'minimal' && level !== 'error' && level !== 'warn') {
      return;
    }
    
    // Don't log debug messages unless verbose
    if (level === 'debug' && this.logLevel !== 'verbose') {
      return;
    }
    
    // Use appropriate console method
    switch (level) {
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      case 'debug':
        console.debug(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }
  
  /**
   * Initialize connection to WhatsApp
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Connection success
   */
  async initialize(showQrCode = false) {
    try {
      // Prevent multiple initializations
      if (this.isInitializing) {
        this.log('info', 'Initialization already in progress');
        return false;
      }
      
      this.isInitializing = true;
      this.showQrCode = showQrCode;
      
      // Set up authentication
      const result = await this._setupAuth();
      if (!result) {
        this.log('error', 'Failed to setup authentication');
        this.isInitializing = false;
        return false;
      }
      
      // Set up socket connection
      const success = await this._createSocket();
      
      this.isInitializing = false;
      return success;
    } catch (error) {
      this.log('error', `Error initializing: ${error.message}`);
      this.isInitializing = false;
      return false;
    }
  }
  
  /**
   * Setup authentication for Baileys
   * @private
   * @returns {Promise<boolean>} - Setup success
   */
  async _setupAuth() {
    try {
      // Get the latest Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.log('info', `Using WA v${version.join('.')}, isLatest: ${isLatest}`);
      
      this.log('info', `Initializing WhatsApp connection...`);
      this.log('info', `Using auth folder: ${this.baileysAuthFolder}`);
      
      // Setup authentication state
      const { state, saveCreds } = await useMultiFileAuthState(this.baileysAuthFolder);
      this.auth = { state, saveCreds };
      
      return true;
    } catch (error) {
      this.log('error', `Error setting up auth: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Create WhatsApp socket connection
   * @private
   * @returns {Promise<boolean>} - Connection success
   */
  async _createSocket() {
    try {
      // Clean up any existing connection
      if (this.socket) {
        try {
          this.socket.end(new Error('Reconnecting'));
        } catch (e) {
          // Ignore
        }
        this.socket = null;
      }
      
      // Create in-memory store
      this.store = makeInMemoryStore({});
      
      // Create socket with options
      this.socket = makeWASocket({
        version: [2, 2323, 4],
        auth: {
          creds: this.auth.state.creds,
          keys: makeCacheableSignalKeyStore(this.auth.state.keys, console)
        },
        printQRInTerminal: false, // We'll handle QR codes ourselves
        msgRetryCounterCache: this.msgRetryCache,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
          // This function is used when messages are quoted
          return { conversation: 'Message not loaded' };
        },
        // Reduce Baileys logging
        logger: {
          // Only log errors, reduce noise
          level: this.logLevel === 'verbose' ? 'info' : 'error',
          info: () => {},  // Silence info logs
          error: (msg) => console.error(`[BaileysError:${this.instanceId}] ${msg}`),
          debug: () => {}, // Silence debug logs
          warn: () => {}   // Silence warnings
        }
      });
      
      // Bind the store to the socket
      this.store.bind(this.socket.ev);
      
      // Set up event handlers
      await this._setupEventHandlers();
      
      return true;
    } catch (error) {
      this.log('error', `Error creating socket: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Set up event handlers for the socket
   * @private
   * @returns {Promise<void>}
   */
  async _setupEventHandlers() {
    try {
      this.log('info', `Event handlers initialized`);
      
      // Handle connection updates
      this.socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Handle QR code
        if (qr && this.showQrCode) {
          this.log('info', `Received QR code`);
          this.emit('qr', qr);
        }
        
        // Handle connection state changes
        if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error instanceof Boom ?
            lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
          
          if (shouldReconnect && this.autoReconnect) {
            // Emit disconnected event with reason
            this.isReady = false;
            const reason = lastDisconnect?.error?.message || 'Unknown reason';
            
            // CHANGE: Only log on first disconnect, not on every retry
            if (this.reconnectCount === 0) {
              this.log('info', `Connection closed, will attempt reconnect. Reason: ${reason}`);
            }
            
            this.emit('disconnected', reason);
            
            // Only attempt reconnect if not already reconnecting and under retry limit
            if (!this.reconnectInProgress && this.reconnectCount < this.maxRetries) {
              this.reconnectInProgress = true;
              this.reconnectCount++;
              
              // Clear any existing timer
              if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
              }
              
              // Exponential backoff for retries
              const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectCount - 1));
              
              this.log('debug', `Scheduling reconnect attempt ${this.reconnectCount} in ${delay}ms`);
              
              this.reconnectTimer = setTimeout(async () => {
                try {
                  await this.initialize(this.showQrCode);
                  this.reconnectInProgress = false;
                } catch (reconnectError) {
                  this.log('error', `Reconnect attempt failed: ${reconnectError.message}`);
                  this.reconnectInProgress = false;
                }
              }, delay);
            } else if (this.reconnectCount >= this.maxRetries) {
              this.log('error', `Max reconnection attempts (${this.maxRetries}) reached`);
              this.emit('auth_failure', new Error('Max reconnection attempts reached'));
              this.reconnectInProgress = false;
            }
          } else {
            this.log('info', `Connection closed, not reconnecting (${shouldReconnect ? 'auto-reconnect disabled' : 'logged out'})`);
            this.isReady = false;
            this.emit(shouldReconnect ? 'disconnected' : 'auth_failure', 
                     new Error(shouldReconnect ? 'Disconnected' : 'Logged out'));
          }
        } else if (connection === 'open') {
          this.log('info', `Connection established successfully!`);
          this.isReady = true;
          this.reconnectCount = 0;
          this.reconnectInProgress = false;
          
          // Process any pending messages
          // CHANGE: Don't log empty queue to reduce noise
          const queuedMessages = [];
          if (queuedMessages.length > 0) {
            this.log('info', `Processing ${queuedMessages.length} queued messages`);
          }
          
          // Emit ready event
          this.emit('ready');
        }
      });
      
      // Handle credential updates
      this.socket.ev.on('creds.update', this.auth.saveCreds);
      
      // Handle messages
      this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
          if (type !== 'notify') return;
          
          for (const message of messages) {
            // Ignore messages from self or status messages
            const isFromMe = message.key.fromMe;
            const isStatusMessage = message.key.remoteJid === 'status@broadcast';
            
            if (isFromMe || isStatusMessage) continue;
            
            // Increase message count
            this.messagesCount++;
            
            // Mark message as read
            try {
              const sendMessageOptions = { remoteJid: message.key.remoteJid };
              
              // Only mark a device-initiated messages as read
              if (message.key.id?.length && !message.key.id.includes('BAE5')) {
                await this.socket.readMessages([{
                  remoteJid: message.key.remoteJid,
                  id: message.key.id,
                  participant: message.key.participant
                }]);
              }
            } catch (readError) {
              this.log('error', `Error marking message as read: ${readError.message}`);
            }
            
            // Emit message event
            this.emit('message', message);
          }
        } catch (error) {
          this.log('error', `Error handling message: ${error.message}`);
        }
      });
    } catch (error) {
      this.log('error', `Error setting up event handlers: ${error.message}`);
    }
  }
  
  /**
   * Get contact name from phone number
   * @param {string} phoneNumber - Phone number or JID
   * @returns {string} - Contact name or phone number
   */
  getContactName(phoneNumber) {
    try {
      // Clean phone number if it's a JID
      const cleanedNumber = phoneNumber.includes('@') ?
        phoneNumber.split('@')[0] :
        phoneNumber;
      
      // Check if contact is cached
      if (this.contactCache[cleanedNumber]) {
        return this.contactCache[cleanedNumber];
      }
      
      // Return phone number as fallback
      return cleanedNumber;
    } catch (error) {
      this.log('error', `Error getting contact name: ${error.message}`);
      return phoneNumber;
    }
  }
  
  /**
   * Send message to a contact
   * @param {string} to - Recipient phone number
   * @param {string} content - Message content
   * @param {Object} options - Message options
   * @returns {Promise<Object>} - Message info
   */
  async sendMessage(to, content, options = {}) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error('WhatsApp client not connected');
      }
      
      // Format phone number if needed
      let recipient = to;
      if (!recipient.includes('@')) {
        recipient = `${recipient}@s.whatsapp.net`;
      }
      
      // Send the message
      const result = await this.socket.sendMessage(recipient, { text: content }, options);
      return result;
    } catch (error) {
      this.log('error', `Error sending message: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Download media from a message
   * @param {Object} message - WhatsApp message object
   * @returns {Promise<Buffer>} - Media buffer
   */
  async downloadMedia(message) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error('WhatsApp client not connected');
      }
      
      // Get message content
      const content = message.message;
      if (!content) {
        throw new Error('Message has no content');
      }
      
      // Check for different media types
      let mediaMessage = null;
      
      if (content.imageMessage) {
        mediaMessage = content.imageMessage;
      } else if (content.videoMessage) {
        mediaMessage = content.videoMessage;
      } else if (content.audioMessage) {
        mediaMessage = content.audioMessage;
      } else if (content.documentMessage) {
        mediaMessage = content.documentMessage;
      } else if (content.stickerMessage) {
        mediaMessage = content.stickerMessage;
      } else {
        throw new Error('Message does not contain media');
      }
      
      // Download the media
      const buffer = await this.socket.downloadMediaMessage(message);
      return buffer;
    } catch (error) {
      this.log('error', `Error downloading media: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} - Authentication status
   */
  async isAuthenticated() {
    try {
      if (!this.auth || !this.auth.state || !this.auth.state.creds) {
        return false;
      }
      
      // Check for critical credentials
      const { me, noiseKey, signedIdentityKey, signedPreKey } = this.auth.state.creds;
      
      return !!(me?.id && noiseKey && signedIdentityKey && signedPreKey);
    } catch (error) {
      this.log('error', `Error checking authentication: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Restore session from saved credentials
   * @returns {Promise<boolean>} - Success status
   */
  async restoreSession() {
    try {
      // Check if auth file exists
      const credsPath = path.join(this.baileysAuthFolder, 'creds.json');
      
      if (!fs.existsSync(credsPath)) {
        this.log('info', `No credentials file found at ${credsPath}`);
        return false;
      }
      
      // Try to initialize with existing credentials
      const isAuthed = await this.isAuthenticated();
      
      if (!isAuthed) {
        this.log('info', `Credentials exist but are invalid`);
        return false;
      }
      
      // Initialize without showing QR code
      const success = await this.initialize(false);
      return success && this.isReady;
    } catch (error) {
      this.log('error', `Error restoring session: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Disconnect from WhatsApp
   * @param {boolean} logout - Whether to log out (delete credentials)
   * @returns {Promise<boolean>} - Success status
   */
  async disconnect(logout = false) {
    try {
      this.log('info', `Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // If not connected, just return
      if (!this.socket) {
        return true;
      }
      
      // Stop any reconnect attempts
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectInProgress = false;
      }
      
      // Log out if requested
      if (logout) {
        try {
          await this.socket.logout();
        } catch (e) {
          this.log('warn', `Error during logout: ${e.message}`);
        }
      }
      
      // End the connection
      try {
        this.socket.end(new Error('User disconnected'));
      } catch (e) {
        this.log('warn', `Error ending socket: ${e.message}`);
      }
      
      // Clean up
      this.socket = null;
      this.isReady = false;
      
      // Remove all listeners
      this.removeAllListeners();
      this.log('info', `All event listeners removed`);
      
      return true;
    } catch (error) {
      this.log('error', `Error disconnecting: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Set whether to show QR code
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.log('info', `QR code display set to: ${show}`);
    this.showQrCode = show;
  }
  
  /**
   * Set whether to automatically reconnect
   * @param {boolean} auto - Whether to auto reconnect
   */
  setAutoReconnect(auto) {
    this.autoReconnect = auto;
    this.log('info', `Auto reconnect set to: ${auto}`);
  }
  
  /**
   * Set logging level
   * @param {string} level - Log level (minimal, normal, verbose)
   */
  setLogLevel(level) {
    if (['minimal', 'normal', 'verbose'].includes(level)) {
      this.logLevel = level;
      this.log('info', `Log level set to: ${level}`);
    } else {
      this.log('warn', `Invalid log level: ${level}. Using 'normal'.`);
      this.logLevel = 'normal';
    }
  }
}

module.exports = BaileysClient;
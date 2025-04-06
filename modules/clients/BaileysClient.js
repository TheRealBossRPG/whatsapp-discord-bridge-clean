// modules/clients/BaileysClient.js - Fixed event handling and logger
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { DisconnectReason } = require('@whiskeysockets/baileys');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, makeInMemoryStore } = require('@whiskeysockets/baileys');
const BaileysEvents = require('./baileys/BaileysEvents');
const BaileysAuth = require('./baileys/BaileysAuth');

/**
 * WhatsApp client implementation using Baileys
 */
class BaileysClient extends EventEmitter {
  /**
   * Create new Baileys WhatsApp client
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    super();
    
    // Set instance ID for client
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    
    // Max retry attempts for connecting
    this.maxRetries = options.maxRetries || 5;
    this.retryCount = 0;
    
    // Connection state tracking
    this.isReady = false;
    this.isClosing = false;
    this.showQrCode = true;
    this.qrStr = null;
    
    // Internal socket reference
    this.sock = null;
    
    // Initialize auth and events if needed
    this.baileysEvents = new BaileysEvents(this.instanceId);
    this.baileysAuth = new BaileysAuth(this.instanceId, this.authFolder, this.baileysAuthFolder);
    
    // Initialize store for message history
    this.initStore();
    
    // Create a custom logger that wraps our console logger
    this.logger = {
      info: (...args) => console.log(`[BaileysClient:${this.instanceId}]`, ...args),
      error: (...args) => console.error(`[BaileysClient:${this.instanceId}]`, ...args),
      warn: (...args) => console.warn(`[BaileysClient:${this.instanceId}]`, ...args),
      debug: (...args) => {
        if (process.env.DEBUG) {
          console.log(`[BaileysClient:${this.instanceId}] [DEBUG]`, ...args);
        }
      },
      // CRITICAL FIX: Add trace method that Baileys expects
      trace: (...args) => {
        if (process.env.TRACE) {
          console.log(`[BaileysClient:${this.instanceId}] [TRACE]`, ...args);
        }
      }
    };
    
    // Forward events from baileysEvents
    this.baileysEvents.on('connecting', () => this.emit('connecting'));
    this.baileysEvents.on('open', () => {
      this.isReady = true;
      this.retryCount = 0;
      this.emit('ready');
    });
    this.baileysEvents.on('close', (reason) => {
      this.isReady = false;
      this.emit('disconnected', reason);
    });
    this.baileysEvents.on('qr', (qr) => {
      this.qrStr = qr;
      if (this.showQrCode) {
        this.emit('qr', qr);
      }
    });
    this.baileysEvents.on('message', (msg) => this.emit('message', msg));
    this.baileysEvents.on('auth_failure', (error) => this.emit('auth_failure', error));
    
    console.log(`[BaileysClient:${this.instanceId}] Client initialized`);
  }
  
  /**
   * Initialize message store
   */
  initStore() {
    try {
      // Create store for caching
      this.store = makeInMemoryStore({});
      
      // Create store directory
      this.storeDir = path.join(this.tempDir, 'baileys_store');
      if (!fs.existsSync(this.storeDir)) {
        fs.mkdirSync(this.storeDir, { recursive: true });
      }
      
      // Set up store logging (disabled by default)
      this.store.readFromFile = () => {};
      this.store.writeToFile = () => {};
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing store:`, error);
      return false;
    }
  }
  
  /**
   * Set QR code display flag
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = show;
    if (show && this.qrStr) {
      // If we already have a QR code and the flag is being set to true, emit it immediately
      this.emit('qr', this.qrStr);
    }
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${show}`);
  }
  
  /**
   * Initialize and connect WhatsApp client
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Connection success
   */
  async initialize(showQrCode = true) {
    try {
      // Set QR code display flag
      this.setShowQrCode(showQrCode);
      
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      
      // Ensure auth directory exists
      const authDir = this.baileysAuthFolder;
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${authDir}`);
      
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }
      
      // Get auth state
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      
      // Create socket with Baileys
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We'll handle QR codes ourselves
        logger: this.logger, // Use our custom logger
        browser: ['WhatsApp Discord Bridge', 'Chrome', '103.0.5060.114'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        qrTimeout: 60000 // 1 minute QR timeout
      });
      
      // Bind credentials saving function
      this.saveCreds = saveCreds;
      
      // Bind store to socket
      this.store.bind(this.sock.ev);
      
      // Register event handlers
      this.baileysEvents.registerEvents(this.sock, this.saveCreds);
      
      console.log(`[BaileysEvents:${this.instanceId}] Event handler initialized`);
      
      // Return true on successful initialization
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp:`, error);
      return false;
    }
  }
  
  /**
   * Check if client has auth credentials
   * @returns {Promise<boolean>} - Authentication status
   */
  async isAuthenticated() {
    try {
      return await this.baileysAuth.checkAuth();
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking auth:`, error);
      return false;
    }
  }
  
  /**
   * Attempt to restore session without QR code
   * @returns {Promise<boolean>} - Restoration success
   */
  async restoreSession() {
    try {
      if (this.isReady) {
        console.log(`[BaileysClient:${this.instanceId}] Already connected, no restoration needed`);
        return true;
      }
      
      if (!await this.isAuthenticated()) {
        console.log(`[BaileysClient:${this.instanceId}] No auth data found, restoration not possible`);
        return false;
      }
      
      // Set QR code flag to false for restoration
      this.setShowQrCode(false);
      
      // Attempt to initialize without showing QR code
      const success = await this.initialize(false);
      
      if (success) {
        // Wait for a connection or timeout
        return new Promise((resolve) => {
          // Set timeout for connection
          const timeout = setTimeout(() => {
            this.removeListener('ready', handleReady);
            resolve(false);
          }, 10000);
          
          // Set success handler
          const handleReady = () => {
            clearTimeout(timeout);
            resolve(true);
          };
          
          // Already connected?
          if (this.isReady) {
            clearTimeout(timeout);
            resolve(true);
            return;
          }
          
          // Listen for connection
          this.once('ready', handleReady);
        });
      }
      
      return false;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Disconnect from WhatsApp
   * @param {boolean} logout - Whether to remove credentials
   * @returns {Promise<boolean>} - Disconnection success
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // Prevent reconnection attempts
      this.isClosing = true;
      
      // Reset event handlers
      this.baileysEvents.resetListeners();
      
      // Check if we have a socket to disconnect
      if (this.sock) {
        // If logout requested, remove credentials
        if (logout) {
          try {
            this.sock.logout();
            console.log(`[BaileysClient:${this.instanceId}] Logged out successfully`);
          } catch (logoutError) {
            console.error(`[BaileysClient:${this.instanceId}] Error during logout:`, logoutError);
          }
        }
        
        // End the socket
        try {
          this.sock.end();
          console.log(`[BaileysClient:${this.instanceId}] Socket ended`);
        } catch (endError) {
          console.error(`[BaileysClient:${this.instanceId}] Error ending socket:`, endError);
        }
        
        // Clear references
        this.sock = null;
      }
      
      // Reset state
      this.isReady = false;
      this.isClosing = false;
      this.qrStr = null;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Reset state even on error
      this.isReady = false;
      this.isClosing = false;
      
      return false;
    }
  }
  
  /**
   * Send a message
   * @param {string} to - Recipient phone number with country code
   * @param {string} message - Message text
   * @returns {Promise<Object|null>} - Message info or null on failure
   */
  async sendMessage(to, message) {
    try {
      if (!this.isReady || !this.sock) {
        throw new Error('Client not ready or connected');
      }
      
      // Ensure to has the correct format
      const jid = this.formatJid(to);
      
      // Send the message
      const result = await this.sock.sendMessage(jid, { text: message });
      return result;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      return null;
    }
  }
  
  /**
   * Get JID (Jabber ID) for a phone number
   * @param {string} phoneNumber - Phone number with country code
   * @returns {string} - Formatted JID
   */
  formatJid(phoneNumber) {
    // Remove any non-digit characters except the leading '+'
    let cleaned = phoneNumber.toString().trim();
    
    // Remove WhatsApp suffixes if present
    cleaned = cleaned.replace(/@s\.whatsapp\.net/g, '')
                    .replace(/@c\.us/g, '')
                    .replace(/@g\.us/g, '')
                    .replace(/@broadcast/g, '');
    
    // Keep only digits and optionally a leading +
    if (cleaned.startsWith('+')) {
      cleaned = '+' + cleaned.substring(1).replace(/\D/g, '');
    } else {
      cleaned = cleaned.replace(/\D/g, '');
    }
    
    // Add WhatsApp suffix
    return `${cleaned}@s.whatsapp.net`;
  }
}

module.exports = BaileysClient;
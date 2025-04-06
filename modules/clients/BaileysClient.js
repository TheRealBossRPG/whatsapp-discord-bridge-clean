// modules/clients/BaileysClient.js
const fs = require('fs');
const path = require('path');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState, makeInMemoryStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

/**
 * WhatsApp client implementation using Baileys
 */
class BaileysClient {
  /**
   * Create a new Baileys client
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    this.maxRetries = options.maxRetries || 5;
    
    // Create directories if they don't exist
    [this.authFolder, this.baileysAuthFolder, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Create a dedicated logger for Baileys
    this.logger = pino({ 
      level: 'silent'
    });
    
    // Create store for messages
    this.store = makeInMemoryStore({});
    
    // Setup event listeners
    this.eventListeners = new Map();
    
    this.socket = null;
    this.isReady = false;
    this.showQrCode = false;
    
    // Import the BaileysEvents module
    try {
      const BaileysEvents = require('./baileys/BaileysEvents');
      // Just store the reference, we'll handle events directly
      this.events = new BaileysEvents(this.instanceId);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error loading BaileysEvents:`, error);
      this.events = {
        initialize: () => console.log(`[BaileysEvents:${this.instanceId}] Event handler initialized`),
        reset: () => console.log(`[BaileysEvents:${this.instanceId}] Event listeners reset`)
      };
    }
    
    console.log(`[BaileysClient:${this.instanceId}] Client initialized`);
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
   * Initialize WhatsApp connection
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Success status
   */
  async initialize(showQrCode = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      
      // Update QR code display setting
      this.setShowQrCode(showQrCode);
      
      // Initialize event handler
      if (this.events && typeof this.events.initialize === 'function') {
        this.events.initialize();
      }
      
      // Get auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.baileysAuthFolder);
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${this.baileysAuthFolder}`);
      
      // Get latest version
      const { version } = await fetchLatestBaileysVersion();
      
      // Create socket with simplified options
      this.socket = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false,
        auth: state,
        browser: ['WhatsApp Discord Bridge', 'Chrome', '116.0.5845.96']
      });
      
      if (!this.socket) {
        throw new Error('Failed to create WhatsApp socket');
      }
      
      // Register event handlers directly within the client class
      if (this.socket.ev) {
        // Handle connection updates
        this.socket.ev.on('connection.update', (update) => {
          this.handleConnectionUpdate(update);
        });
        
        // Handle auth credential updates
        this.socket.ev.on('creds.update', saveCreds);
        
        // Handle incoming messages
        this.socket.ev.on('messages.upsert', (messages) => {
          this.handleMessagesUpsert(messages);
        });
      } else {
        throw new Error('Socket event emitter not available');
      }
      
      // Set up store for messages
      if (this.store) {
        this.store.bind(this.socket.ev);
      }
      
      // Connection is initially not ready until we get a successful connection
      this.isReady = false;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp client:`, error);
      return false;
    }
  }
  
  /**
   * Handle connection update events
   * @param {Object} update - Connection update event
   */
  handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    
    // Process QR code if needed
    if (qr && this.showQrCode) {
      // Emit QR code event
      this.emit('qr', qr);
    }
    
    // Handle connection state changes
    if (connection === 'close') {
      // Check if we should reconnect
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      
      console.log(`[BaileysClient:${this.instanceId}] Connection closed. Reason: ${lastDisconnect?.error?.message || 'Unknown'}`);
      
      if (shouldReconnect) {
        console.log(`[BaileysClient:${this.instanceId}] Attempting to reconnect...`);
        this.emit('disconnected', lastDisconnect?.error?.message || 'Unknown');
      } else {
        console.log(`[BaileysClient:${this.instanceId}] Logged out, not reconnecting.`);
        this.emit('auth_failure', new Error('Logged out'));
      }
      
      this.isReady = false;
    } else if (connection === 'open') {
      console.log(`[BaileysClient:${this.instanceId}] Connection opened!`);
      this.isReady = true;
      this.emit('ready');
    }
  }
  
  /**
   * Handle messages upsert events
   * @param {Object} messages - Messages upsert event
   */
  handleMessagesUpsert(messages) {
    if (messages.type === 'notify') {
      for (const msg of messages.messages) {
        this.emit('message', msg);
      }
    }
  }
  
  /**
   * Register event listener
   * @param {string} event - Event name
   * @param {Function} callback - Event callback
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    
    this.eventListeners.get(event).push(callback);
    return this;
  }
  
  /**
   * Emit event
   * @param {string} event - Event name
   * @param {...any} args - Event arguments
   */
  emit(event, ...args) {
    if (this.eventListeners.has(event)) {
      for (const callback of this.eventListeners.get(event)) {
        try {
          callback(...args);
        } catch (error) {
          console.error(`[BaileysClient:${this.instanceId}] Error in event listener for ${event}:`, error);
        }
      }
    }
  }
  
  /**
   * Check if client is connected
   * @returns {boolean} - Connected status
   */
  isConnected() {
    return this.isReady && this.socket?.user?.id;
  }
  
  /**
   * Check if authenticated
   * @returns {Promise<boolean>} - Authenticated status
   */
  async isAuthenticated() {
    try {
      // Check if auth files exist
      const credentialsPath = path.join(this.baileysAuthFolder, 'creds.json');
      return fs.existsSync(credentialsPath);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking auth status:`, error);
      return false;
    }
  }
  
  /**
   * Restore session
   * @returns {Promise<boolean>} - Success status
   */
  async restoreSession() {
    try {
      return await this.initialize(false);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Disconnect client
   * @param {boolean} logout - Whether to logout (delete auth)
   * @returns {Promise<boolean>} - Success status
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // Reset event listeners
      if (this.events && typeof this.events.reset === 'function') {
        this.events.reset();
      }
      
      // Close socket if exists
      if (this.socket) {
        // Use the appropriate method to disconnect
        if (typeof this.socket.logout === 'function' && logout) {
          try {
            await this.socket.logout();
            console.log(`[BaileysClient:${this.instanceId}] Logged out`);
          } catch (logoutError) {
            console.error(`[BaileysClient:${this.instanceId}] Error during logout:`, logoutError);
          }
        }
        
        if (typeof this.socket.end === 'function') {
          try {
            await this.socket.end();
            console.log(`[BaileysClient:${this.instanceId}] Socket ended`);
          } catch (endError) {
            console.error(`[BaileysClient:${this.instanceId}] Error ending socket:`, endError);
          }
        }
      }
      
      // Clean up credentials if requested
      if (logout) {
        try {
          const credentialsPath = path.join(this.baileysAuthFolder, 'creds.json');
          if (fs.existsSync(credentialsPath)) {
            fs.unlinkSync(credentialsPath);
            console.log(`[BaileysClient:${this.instanceId}] Deleted credentials file`);
          }
        } catch (authError) {
          console.error(`[BaileysClient:${this.instanceId}] Error cleaning auth:`, authError);
        }
      }
      
      // Reset state
      this.socket = null;
      this.isReady = false;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Force reset state
      this.socket = null;
      this.isReady = false;
      
      return false;
    }
  }
  
  /**
   * Send a text message
   * @param {string} to - Recipient
   * @param {string} text - Message text
   * @returns {Promise<Object>} - Message result
   */
  async sendTextMessage(to, text) {
    try {
      if (!this.isConnected()) {
        throw new Error('WhatsApp client is not connected');
      }
      
      // Ensure recipient format
      const recipient = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      
      // Send message
      const result = await this.socket.sendMessage(recipient, { text });
      
      return result;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending text message:`, error);
      throw error;
    }
  }
  
  /**
   * Get current WhatsApp user
   * @returns {Object} - User info
   */
  getUser() {
    if (!this.isConnected()) {
      return null;
    }
    
    return this.socket.user;
  }
}

module.exports = BaileysClient;
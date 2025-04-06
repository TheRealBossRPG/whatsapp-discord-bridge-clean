// modules/clients/BaileysClient.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const EventBus = require('../../core/EventBus');
const BaileysAuth = require('./baileys/BaileysAuth');
const BaileysEvents = require('./baileys/BaileysEvents');
const BaileysMessage = require('./baileys/BaileysMessage');
const BaileysMedia = require('./baileys/BaileysMedia');

/**
 * WhatsApp client using Baileys
 */
class BaileysClient {
  /**
   * Create a new Baileys client
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(this.authFolder, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    this.maxRetries = options.maxRetries || 5;
    this.showQrCode = options.showQrCode || false;
    
    // Create event bus for this client
    this.events = new EventBus();
    
    // Initialize Baileys components
    this.authHandler = new BaileysAuth({
      instanceId: this.instanceId,
      authFolder: this.authFolder,
      baileysAuthFolder: this.baileysAuthFolder
    });
    
    this.eventHandler = new BaileysEvents(this.instanceId);
    this.messageHandler = new BaileysMessage(this.instanceId);
    this.mediaHandler = new BaileysMedia({
      instanceId: this.instanceId,
      tempDir: this.tempDir
    });
    
    // Set up connection state
    this.socket = null;
    this.isReady = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.connectionClosed = false;
    
    console.log(`[BaileysClient:${this.instanceId}] Client initialized`);
  }
  
  /**
   * Set whether to show QR code
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = !!show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${this.showQrCode}`);
  }
  
  /**
   * Initialize the WhatsApp client
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async initialize(showQrCode = false) {
    try {
      if (showQrCode !== undefined) {
        this.setShowQrCode(showQrCode);
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      
      // Initialize event handler
      this.eventHandler.initialize(this);
      
      // Initialize message handler
      this.messageHandler.initialize(this);
      
      // Initialize media handler
      this.mediaHandler.initialize(this);
      
      // Create auth folder if it doesn't exist
      if (!fs.existsSync(this.baileysAuthFolder)) {
        fs.mkdirSync(this.baileysAuthFolder, { recursive: true });
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${this.baileysAuthFolder}`);
      
      // Fetch latest version of Baileys
      const { version } = await fetchLatestBaileysVersion();
      
      // Initialize auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.baileysAuthFolder);
      
      // Save credentials function
      this.saveCreds = saveCreds;
      this.authHandler.setSaveCredsFunction(saveCreds);
      
      // Create socket
      this.socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // We'll handle QR code display ourselves
        logger: {
          // Use custom logger with minimum level for better control
          level: 'warn',
          // Simple logging functions
          error: (msg) => console.error(`[Baileys:${this.instanceId}] ${msg}`),
          warn: (msg) => console.warn(`[Baileys:${this.instanceId}] ${msg}`),
          info: () => {}, // Disable info logging
          debug: () => {}, // Disable debug logging
          trace: () => {}, // Disable trace logging
        }
      });
      
      // Connect message handler
      this.messageHandler.setSocket(this.socket);
      
      // Connect media handler
      this.mediaHandler.setSocket(this.socket);
      
      // Set up handlers
      this.setupEvents();
      
      // Register handlers with components
      this.eventHandler.registerHandlers(this.socket);
      this.messageHandler.registerHandlers(this.socket);
      
      console.log(`[BaileysClient:${this.instanceId}] WhatsApp client initialized successfully`);
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp client:`, error);
      return false;
    }
  }
  
  /**
   * Set up event handlers
   */
  setupEvents() {
    // Connection events from Baileys
    this.socket.ev.on('connection.update', (update) => {
      try {
        const { connection, lastDisconnect, qr } = update;
        
        // Handle QR code
        if (qr && this.showQrCode) {
          this.events.emit('qr', qr);
        }
        
        // Handle connection
        if (connection === 'open') {
          // Connection successful
          this.isReady = true;
          this.reconnectAttempts = 0;
          this.connectionClosed = false;
          
          // Handle auth
          this.authHandler.handleConnectionUpdate(update);
          
          // Emit ready event
          this.events.emit('ready');
          console.log(`[BaileysClient:${this.instanceId}] Connection established`);
        } else if (connection === 'close') {
          // Connection closed
          this.isReady = false;
          this.connectionClosed = true;
          
          // Get disconnect reason
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          let reasonText = 'Unknown';
          
          // Determine if we should reconnect
          let shouldReconnect = true;
          
          if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession) {
            shouldReconnect = false;
            reasonText = 'Logged Out';
          } else if (statusCode === DisconnectReason.connectionClosed) {
            reasonText = 'Connection Closed';
          } else if (statusCode === DisconnectReason.connectionLost) {
            reasonText = 'Connection Lost';
          } else if (statusCode === DisconnectReason.connectionReplaced) {
            shouldReconnect = false;
            reasonText = 'Connection Replaced';
          } else if (statusCode === DisconnectReason.timedOut) {
            reasonText = 'Connection Timed Out';
          } else if (statusCode === DisconnectReason.multideviceMismatch) {
            shouldReconnect = false;
            reasonText = 'Multi-device Mismatch';
          } else if (statusCode === 440) {
            reasonText = 'Stream Errored (conflict)';
          } else if (statusCode === 515) {
            reasonText = 'Stream Errored (restart required)';
          } else if (statusCode === 428) {
            reasonText = 'Connection Terminated';
          } else {
            reasonText = `Code ${statusCode || 'unknown'}`;
          }
          
          console.log(`[BaileysClient:${this.instanceId}] Connection closed with status ${statusCode}, shouldReconnect: ${shouldReconnect}`);
          
          // Emit disconnected event
          this.events.emit('disconnected', reasonText);
          
          // Auto-reconnect if needed
          if (shouldReconnect) {
            this.attemptReconnect();
          }
        }
      } catch (error) {
        console.error(`[BaileysClient:${this.instanceId}] Error handling connection update:`, error);
      }
    });
    
    // Handle credential updates
    this.socket.ev.on('creds.update', this.saveCreds);
  }
  
  /**
   * Attempt to reconnect
   */
  attemptReconnect() {
    try {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
      
      this.reconnectAttempts++;
      
      if (this.reconnectAttempts > this.maxRetries) {
        console.warn(`[BaileysClient:${this.instanceId}] Maximum reconnection attempts (${this.maxRetries}) reached`);
        return;
      }
      
      // Calculate backoff time
      const backoffTime = Math.min(30000, 2000 * Math.pow(1.5, this.reconnectAttempts - 1));
      
      console.log(`[BaileysClient:${this.instanceId}] Reconnecting in ${backoffTime}ms (attempt ${this.reconnectAttempts}/${this.maxRetries})`);
      
      this.reconnectTimer = setTimeout(async () => {
        try {
          await this.initialize(false);
        } catch (error) {
          console.error(`[BaileysClient:${this.instanceId}] Error during reconnection:`, error);
        }
      }, backoffTime);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error scheduling reconnection:`, error);
    }
  }
  
  /**
   * Disconnect from WhatsApp
   * @param {boolean} logout - Whether to log out of the account
   * @returns {Promise<boolean>} - Whether disconnection was successful
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // Reset reconnection attempts
      this.reconnectAttempts = 0;
      
      // Clear reconnect timer if any
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      
      // Reset handlers
      this.eventHandler.reset();
      
      // If socket exists, disconnect
      if (this.socket) {
        try {
          if (logout) {
            await this.socket.logout();
          }
          
          // End connection
          await this.socket.end();
          this.socket = null;
        } catch (socketError) {
          console.error(`[BaileysClient:${this.instanceId}] Error disconnecting socket:`, socketError);
        }
      }
      
      this.isReady = false;
      this.connectionClosed = true;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      return false;
    }
  }
  
  /**
   * Register a handler for events
   * @param {string} event - Event name
   * @param {function} callback - Event callback
   */
  on(event, callback) {
    this.events.on(event, callback);
  }
  
  /**
   * Remove an event handler
   * @param {string} event - Event name
   * @param {function} callback - Event callback to remove
   */
  off(event, callback) {
    this.events.off(event, callback);
  }
  
  /**
   * Send a message to a WhatsApp user
   * @param {string} to - User's phone number or JID
   * @param {string|Object} content - Message content
   * @param {Object} options - Message options
   * @returns {Promise<Object>} - Send result
   */
  async sendMessage(to, content, options = {}) {
    return await this.messageHandler.sendMessage(to, content, options);
  }
  
  /**
   * Check if authenticated
   * @returns {Promise<boolean>} - Whether authenticated
   */
  async isAuthenticated() {
    return await this.authHandler.isAuthenticated();
  }
  
  /**
   * Restore session
   * @returns {Promise<boolean>} - Whether restoration was successful
   */
  async restoreSession() {
    try {
      if (this.isReady) {
        console.log(`[BaileysClient:${this.instanceId}] Session already active`);
        return true;
      }
      
      if (!await this.isAuthenticated()) {
        console.log(`[BaileysClient:${this.instanceId}] No session to restore`);
        return false;
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Attempting to restore session...`);
      
      // Initialize with no QR code showing (use existing auth)
      const result = await this.initialize(false);
      
      return result && this.isReady;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
}

module.exports = BaileysClient;
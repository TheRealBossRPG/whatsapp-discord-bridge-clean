// modules/clients/BaileysClient.js - Fixed for @whiskeysockets/baileys compatibility
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const BaileysAuth = require('./baileys/BaileysAuth');
const BaileysEvents = require('./baileys/BaileysEvents');
const BaileysMessage = require('./baileys/BaileysMessage');
const BaileysMedia = require('./baileys/BaileysMedia');

/**
 * Create a minimal mock logger that implements the required methods
 * @returns {Object} - Mock logger
 */
function createMockLogger() {
  // Create base logger with all required methods
  const baseLogger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: console.error,
    trace: () => {},
    fatal: console.error,
    child: () => baseLogger // Important: child returns a new logger with the same methods
  };
  
  return baseLogger;
}

/**
 * WhatsApp client implementation using Baileys
 */
class BaileysClient extends EventEmitter {
  /**
   * Create a new WhatsApp client
   * @param {Object} options - Client options
   * @param {string} options.instanceId - Instance ID
   * @param {string} options.authFolder - Authentication folder
   * @param {string} options.baileysAuthFolder - Baileys auth folder
   * @param {string} options.tempDir - Temporary directory
   */
  constructor(options) {
    super();
    
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', '..', 'instances', this.instanceId, 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(__dirname, '..', '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', '..', 'instances', this.instanceId, 'temp');
    
    // Initialize component modules
    this.auth = new BaileysAuth({
      instanceId: this.instanceId,
      authFolder: this.authFolder,
      baileysAuthFolder: this.baileysAuthFolder
    });
    
    this.events = new BaileysEvents({
      instanceId: this.instanceId.toString()
    });
    
    this.message = new BaileysMessage({
      instanceId: this.instanceId.toString()
    });
    
    this.media = new BaileysMedia({
      instanceId: this.instanceId.toString(),
      tempDir: this.tempDir
    });
    
    // Set default state
    this.socket = null;
    this.isReady = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxRetries || 5;
    this.reconnecting = false;
    this.shouldShowQrCode = false;
    
    console.log(`[BaileysClient:${this.instanceId}] Client initialized`);
  }
  
  /**
   * Initialize the WhatsApp connection
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Success
   */
  async initialize(showQrCode = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      
      // Initialize events module
      this.events.initialize();
      console.log(`[BaileysEvents:${this.instanceId}] Initialized event handler`);
      
      // Initialize message module
      this.message.initialize();
      console.log(`[BaileysMessage:${this.instanceId}] Message handler initialized`);
      
      // Initialize media module
      this.media.initialize();
      console.log(`[BaileysMedia:${this.instanceId}] Media handler initialized with temp dir: ${this.tempDir}`);
      
      // Set QR code display preference
      this.shouldShowQrCode = showQrCode;
      console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${showQrCode}`);
      
      // Ensure the baileys_auth folder exists
      if (!fs.existsSync(this.baileysAuthFolder)) {
        fs.mkdirSync(this.baileysAuthFolder, { recursive: true });
      }
      
      // Now using useMultiFileAuthState for proper auth state handling
      // Make sure we're passing a string
      const baileysFolderPath = this.baileysAuthFolder.toString();
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${baileysFolderPath}`);
      
      const { state: authState, saveCreds: saveState } = await useMultiFileAuthState(baileysFolderPath);
      
      // Create a mock logger that fulfills Baileys requirements
      const mockLogger = createMockLogger();
      
      // Configure socket options
      const socketConfig = {
        auth: authState,
        printQRInTerminal: false,
        logger: mockLogger, // Use our mock logger with the required methods
        markOnlineOnConnect: true,
        browser: ['WhatsApp Web', 'Chrome', '10.0'],
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
      };
      
      // Create the socket
      this.socket = makeWASocket(socketConfig);
      
      // Set up connection update handler
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // If we receive a QR code, emit it for UI display
        if (qr && this.shouldShowQrCode) {
          console.log(`[BaileysClient:${this.instanceId}] Received QR code, emitting event...`);
          this.emit('qr', qr);
        }
        
        // Handle connection state changes
        if (connection === 'open') {
          console.log(`[BaileysClient:${this.instanceId}] Connection established`);
          this.isReady = true;
          this.reconnectAttempts = 0;
          this.emit('ready');
        } else if (connection === 'close') {
          this.isReady = false;
          
          // Get status code and error
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`[BaileysClient:${this.instanceId}] Connection closed with status ${statusCode}, shouldReconnect: ${shouldReconnect}`);
          
          // Emit disconnected event with reason
          this.emit('disconnected', lastDisconnect?.error?.message || 'Unknown reason');
          
          // Auto-reconnect if appropriate
          if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts && !this.reconnecting) {
            this.reconnecting = true;
            this.reconnectAttempts++;
            
            const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts));
            console.log(`[BaileysClient:${this.instanceId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
              this.reconnecting = false;
              this.initialize(false).catch(error => {
                console.error(`[BaileysClient:${this.instanceId}] Reconnection attempt failed:`, error);
              });
            }, delay);
          }
        }
        
        // Forward connection update to auth handler for processing
        await this.auth.handleConnectionUpdate(update);
      });
      
      // Handle credentials update
      this.socket.ev.on('creds.update', saveState);
      
      // Set up message handler
      this.socket.ev.on('messages.upsert', messages => {
        this.events.handleMessagesUpsert(messages, this);
      });
      
      // Set up module references
      this.message.setSocket(this.socket);
      this.media.setSocket(this.socket);
      
      console.log(`[BaileysClient:${this.instanceId}] WhatsApp client initialized successfully`);
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp:`, error);
      return false;
    }
  }
  
  /**
   * Set whether to show QR code
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.shouldShowQrCode = show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${show}`);
  }
  
  /**
   * Register event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback
   */
  on(event, callback) {
    // Register the event handler
    super.on(event, callback);
    console.log(`[BaileysClient:${this.instanceId}] Registered callback for event: ${event}`);
  }
  
  /**
   * Disconnect client
   * @param {boolean} logout - Whether to log out
   * @returns {Promise<boolean>} - Success
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // Reset event listeners
      this.events.reset();
      
      // Close the socket if it exists
      if (this.socket) {
        try {
          // If logout requested, delete credentials 
          if (logout) {
            await this.logout();
          }
          
          // Force socket to close
          if (this.socket.ws && this.socket.ws.close) {
            this.socket.ws.close();
          }
          
          // Reset socket and state
          this.socket = null;
          
        } catch (socketError) {
          console.error(`[BaileysClient:${this.instanceId}] Error closing socket:`, socketError);
        }
      }
      
      // Update state
      this.isReady = false;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Force state update even on error
      this.isReady = false;
      this.socket = null;
      
      return true; // Return success anyway so caller doesn't get stuck
    }
  }
  
  /**
   * Log out and clear credentials
   * @returns {Promise<boolean>} - Success
   */
  async logout() {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Logging out...`);
      
      // Try to logout via socket
      if (this.socket && this.socket.logout) {
        try {
          await this.socket.logout();
        } catch (logoutError) {
          console.error(`[BaileysClient:${this.instanceId}] Error in logout method:`, logoutError);
        }
      }
      
      // Clear credentials regardless of socket logout success
      await this.auth.clearCredentials();
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error during logout:`, error);
      return false;
    }
  }
  
  /**
   * Get own user
   * @returns {Object|null} - User info
   */
  getUser() {
    try {
      if (!this.socket || !this.isReady) return null;
      return this.socket.user;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error getting user:`, error);
      return null;
    }
  }
  
  /**
   * Check if authenticated
   * @returns {Promise<boolean>} - Whether authenticated
   */
  async isAuthenticated() {
    return await this.auth.isAuthenticated();
  }
  
  /**
   * Restore session
   * @returns {Promise<boolean>} - Success
   */
  async restoreSession() {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Attempting to restore session...`);
      
      // Check if authenticated
      const authenticated = await this.isAuthenticated();
      if (!authenticated) {
        console.log(`[BaileysClient:${this.instanceId}] No valid session to restore`);
        return false;
      }
      
      // Initialize with QR code disabled
      const success = await this.initialize(false);
      
      // Wait for connection to establish
      if (success) {
        for (let i = 0; i < 10; i++) {
          if (this.isReady) {
            console.log(`[BaileysClient:${this.instanceId}] Session restored successfully`);
            return true;
          }
          
          // Wait 1 second between checks
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`[BaileysClient:${this.instanceId}] Session restoration timed out`);
      }
      
      return false;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Send message
   * @param {string} to - Recipient
   * @param {Object|string} content - Message content
   * @returns {Promise<Object|null>} - Message info
   */
  async sendMessage(to, content) {
    return await this.message.sendMessage(to, content);
  }
  
  /**
   * Send media message
   * @param {string} to - Recipient
   * @param {string} mediaPath - Path to media
   * @param {Object} options - Message options
   * @returns {Promise<Object|null>} - Message info
   */
  async sendMedia(to, mediaPath, options = {}) {
    return await this.media.sendMedia(to, mediaPath, options);
  }
}

module.exports = BaileysClient;
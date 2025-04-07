// modules/clients/BaileysClient.js - FIXED for Pino logger compatibility
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const { EventEmitter } = require('events');

/**
 * BaileysClient class for WhatsApp connection
 */
class BaileysClient extends EventEmitter {
  /**
   * Create a new BaileysClient
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    super();
    
    // Set instance ID
    this.instanceId = options.instanceId || 'default';
    
    // Set paths
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    
    // Create directories if they don't exist
    this.createDirectories();
    
    // Connection states
    this.socket = null;
    this.isReady = false;
    this.isConnecting = false;
    this.connectionAttempts = 0;
    this.maxRetries = options.maxRetries || 5;
    
    // Flag to determine if we should display QR code or restore session
    this.showQrCode = false;
    
    console.log(`[BaileysClient:${this.instanceId}] Initialized. Will connect on initialize() call.`);
  }
  
  /**
   * Create required directories
   */
  createDirectories() {
    [this.authFolder, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }
  
  /**
   * Set whether to show QR code for connection
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = !!show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${this.showQrCode}`);
  }
  
  /**
   * Initialize WhatsApp client
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Success status
   */
  async initialize(showQrCode = false) {
    try {
      // Set QR code display flag
      this.setShowQrCode(showQrCode);
      
      // Check if already connecting
      if (this.isConnecting) {
        console.log(`[BaileysClient:${this.instanceId}] Already connecting, please wait`);
        return false;
      }
      
      // Check if already connected
      if (this.isReady && this.socket) {
        console.log(`[BaileysClient:${this.instanceId}] Already connected`);
        return true;
      }
      
      // Set connecting flag
      this.isConnecting = true;
      
      // Get latest WA version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`[BaileysClient:${this.instanceId}] Using WA v${version}, isLatest: ${isLatest}`);
      
      // Initialize the connection
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${this.authFolder}`);
      
      // Get authentication state
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      
      // FIXED: Create a proper Pino logger that includes the child() method
      // Use the global pinoCompatLogger if available, otherwise create one
      let logger;
      if (global.pinoCompatLogger) {
        logger = global.pinoCompatLogger.child({ module: `baileys:${this.instanceId}` });
      } else {
        // Create a new Pino logger as fallback
        logger = pino({ 
          level: 'silent', // Don't log anything by default
          transport: {
            target: 'pino-pretty',
            options: { colorize: true }
          }
        }).child({ module: `baileys:${this.instanceId}` });
      }
      
      // Create socket with proper configuration
      this.socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: logger, // FIXED: Use the properly configured logger
        browser: ['WhatsApp-Discord Bridge', 'Chrome', '4.0.0'],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        markOnlineOnConnect: true,
        patchMessageBeforeSending: true,
      });
      
      // Set up event handlers
      this.setupSocketEvents(saveCreds);
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error creating socket: ${error.message}`);
      this.isConnecting = false;
      return false;
    }
  }
  
  /**
   * Set up socket event handlers
   * @param {Function} saveCreds - Function to save credentials
   */
  setupSocketEvents(saveCreds) {
    if (!this.socket) return;
    
    // Connection update handler
    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Emit QR code if available and QR display is enabled
      if (qr && this.showQrCode) {
        this.emit('qr', qr);
      }
      
      // Handle connection status changes
      if (connection === 'close') {
        // Handle connection close
        const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        console.log(`[BaileysClient:${this.instanceId}] Connection closed. Reason: ${lastDisconnect?.error?.message || 'Unknown'}`);
        
        // Clear states
        this.isReady = false;
        this.isConnecting = false;
        
        // Emit disconnected event
        this.emit('disconnected', lastDisconnect?.error?.message || 'Unknown');
        
        // Try to reconnect if appropriate
        if (shouldReconnect && this.connectionAttempts < this.maxRetries) {
          this.connectionAttempts++;
          console.log(`[BaileysClient:${this.instanceId}] Attempting to reconnect (${this.connectionAttempts}/${this.maxRetries})...`);
          
          // Wait a moment before reconnecting
          setTimeout(() => {
            this.initialize(this.showQrCode);
          }, 3000);
        } else if (this.connectionAttempts >= this.maxRetries) {
          console.log(`[BaileysClient:${this.instanceId}] Max reconnection attempts reached (${this.maxRetries})`);
          this.emit('auth_failure', new Error('Max reconnection attempts reached'));
        } else if (new Boom(lastDisconnect?.error)?.output?.statusCode === DisconnectReason.loggedOut) {
          console.log(`[BaileysClient:${this.instanceId}] Logged out from WhatsApp`);
          this.emit('auth_failure', new Error('Logged out from WhatsApp'));
        }
      } else if (connection === 'open') {
        // Connection successful
        console.log(`[BaileysClient:${this.instanceId}] Connected to WhatsApp`);
        this.isReady = true;
        this.isConnecting = false;
        this.connectionAttempts = 0;
        
        // Emit ready event
        this.emit('ready');
      }
    });
    
    // Credentials update handler
    this.socket.ev.on('creds.update', saveCreds);
    
    // Message handler
    this.socket.ev.on('messages.upsert', (m) => {
      if (m.type === 'notify') {
        m.messages.forEach((msg) => {
          if (!msg.key.fromMe) {
            this.emit('message', msg);
          }
        });
      }
    });
  }
  
  /**
   * Check if user is authenticated
   * @returns {Promise<boolean>} - Authentication status
   */
  async isAuthenticated() {
    try {
      const credentialsPath = path.join(this.authFolder, 'creds.json');
      return fs.existsSync(credentialsPath);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  /**
   * Restore session if possible
   * @returns {Promise<boolean>} - Success status
   */
  async restoreSession() {
    try {
      if (await this.isAuthenticated()) {
        console.log(`[BaileysClient:${this.instanceId}] Restoring existing session...`);
        
        // Set QR code display to false to prevent showing QR code
        this.setShowQrCode(false);
        
        // Initialize with QR code display turned off
        const success = await this.initialize(false);
        
        // Check if connection was successful
        if (success && this.isReady) {
          console.log(`[BaileysClient:${this.instanceId}] Session restored successfully`);
          return true;
        }
        
        console.log(`[BaileysClient:${this.instanceId}] Session restoration failed`);
        return false;
      }
      
      console.log(`[BaileysClient:${this.instanceId}] No existing session found`);
      return false;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Send a message to a phone number
   * @param {string} to - Phone number to send to
   * @param {string} text - Message text
   * @returns {Promise<Object|null>} - Message result or null on failure
   */
  async sendMessage(to, text) {
    try {
      if (!this.isReady || !this.socket) {
        console.error(`[BaileysClient:${this.instanceId}] Cannot send message: Not connected`);
        return null;
      }
      
      // Format phone number
      const recipient = this.formatPhoneNumber(to);
      
      // Send the message
      const result = await this.socket.sendMessage(recipient, { text });
      return result;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      return null;
    }
  }
  
  /**
   * Format phone number for WhatsApp
   * @param {string} phone - Phone number
   * @returns {string} - Formatted phone number
   */
  formatPhoneNumber(phone) {
    // Clean the phone number (remove spaces, dashes, etc.)
    let cleaned = String(phone).replace(/[^\d+]/g, '');
    
    // Remove any WhatsApp suffixes if present
    cleaned = cleaned.replace(/@s\.whatsapp\.net$/, '')
                    .replace(/@c\.us$/, '');
    
    // Ensure the number follows the format: <numbers>@s.whatsapp.net
    if (!cleaned.endsWith('@s.whatsapp.net') && !cleaned.endsWith('@c.us')) {
      cleaned = `${cleaned}@s.whatsapp.net`;
    }
    
    return cleaned;
  }
  
  /**
   * Disconnect from WhatsApp
   * @param {boolean} logOut - Whether to log out (delete auth)
   * @returns {Promise<boolean>} - Success status
   */
  async disconnect(logOut = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logOut ? '(with logout)' : ''}`);
      
      if (!this.socket) {
        console.log(`[BaileysClient:${this.instanceId}] No active socket to disconnect`);
        this.isReady = false;
        return true;
      }
      
      // Logout if requested
      if (logOut) {
        try {
          await this.socket.logout();
          console.log(`[BaileysClient:${this.instanceId}] Logged out from WhatsApp`);
        } catch (logoutError) {
          console.error(`[BaileysClient:${this.instanceId}] Error logging out:`, logoutError);
          // Continue with disconnect anyway
        }
        
        // Clean up auth files
        try {
          this.cleanAuthFiles();
        } catch (cleanError) {
          console.error(`[BaileysClient:${this.instanceId}] Error cleaning auth files:`, cleanError);
        }
      }
      
      // Close the socket
      try {
        this.socket.end(new Error('User disconnected'));
        console.log(`[BaileysClient:${this.instanceId}] Socket closed`);
      } catch (closeError) {
        console.error(`[BaileysClient:${this.instanceId}] Error closing socket:`, closeError);
      }
      
      // Clear connection state
      this.socket = null;
      this.isReady = false;
      this.isConnecting = false;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Force reset state on error
      this.socket = null;
      this.isReady = false;
      this.isConnecting = false;
      
      return false;
    }
  }
  
  /**
   * Clean authentication files
   */
  cleanAuthFiles() {
    try {
      if (!fs.existsSync(this.authFolder)) {
        return;
      }
      
      // Read all files in auth folder
      const files = fs.readdirSync(this.authFolder);
      
      // Delete each file
      for (const file of files) {
        const filePath = path.join(this.authFolder, file);
        
        try {
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
            console.log(`[BaileysClient:${this.instanceId}] Deleted auth file: ${file}`);
          }
        } catch (error) {
          console.error(`[BaileysClient:${this.instanceId}] Error deleting auth file ${file}:`, error);
        }
      }
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error cleaning auth files:`, error);
    }
  }
}

module.exports = BaileysClient;
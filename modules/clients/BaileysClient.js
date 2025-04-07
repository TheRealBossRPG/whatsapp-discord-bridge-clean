// modules/clients/BaileysClient.js - Fixed for proper dependency usage
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { 
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

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
    
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    this.maxRetries = options.maxRetries || 5;
    
    // Create required directories
    this.ensureDirectories();
    
    // State variables
    this.socket = null;
    this.retryCount = 0;
    this.isReady = false;
    this.shouldShowQr = true;
    this.justScanned = false;
    this.reconnecting = false;
    
    console.log(`[BaileysClient:${this.instanceId}] Initialized. Will connect on initialize() call.`);
  }
  
  /**
   * Ensure required directories exist
   */
  ensureDirectories() {
    try {
      const dirs = [this.authFolder, this.baileysAuthFolder, this.tempDir];
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error creating directories:`, error);
    }
  }
  
  /**
   * Set whether to show QR code on connection
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.shouldShowQr = show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${show}`);
  }
  
  /**
   * Initialize and connect to WhatsApp
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Connection success
   */
  async initialize(showQrCode = false) {
    try {
      // Update QR code display setting
      if (showQrCode !== undefined) {
        this.setShowQrCode(showQrCode);
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      
      // Force use of Baileys auth folder for consistent auth state
      console.log(`[BaileysClient:${this.instanceId}] Using auth folder: ${this.baileysAuthFolder}`);
      
      // Get auth state from folder
      const { state, saveCreds } = await useMultiFileAuthState(this.baileysAuthFolder);
      
      // Fetch the latest version
      const { version } = await fetchLatestBaileysVersion();
      console.log(`[BaileysClient:${this.instanceId}] Using WA v${version.join(',')}`);
      
      // Create socket
      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, global.pinoCompatLogger)
        },
        printQRInTerminal: this.shouldShowQr,
        logger: global.pinoCompatLogger,
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        qrTimeout: 40000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 1000
      });
      
      // Register event handlers
      this.setupEventHandlers(saveCreds);
      console.log(`[BaileysClient:${this.instanceId}] Event handlers registered`);
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing:`, error);
      return false;
    }
  }
  
  /**
   * Setup event handlers for the socket
   * @param {Function} saveCreds - Function to save credentials
   */
  setupEventHandlers(saveCreds) {
    if (!this.socket) return;
    
    // Connection events
    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Handle QR code
      if (qr && this.shouldShowQr) {
        this.emit('qr', qr);
      }
      
      // Handle connection state change
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) ? 
          lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
        
        const disconnectReason = lastDisconnect?.error?.output?.payload?.message || 'Unknown';
        console.log(`[BaileysClient:${this.instanceId}] Connection closed. Reason: ${disconnectReason}`);
        
        this.isReady = false;
        this.emit('disconnected', disconnectReason);
        
        // Reconnect if not logged out
        if (shouldReconnect && !this.reconnecting) {
          this.reconnecting = true;
          await this.attemptReconnect();
        } else if (!shouldReconnect) {
          console.log(`[BaileysClient:${this.instanceId}] Not reconnecting due to logout`);
          this.emit('auth_failure', new Error('Logged out from WhatsApp'));
        }
      } else if (connection === 'open') {
        console.log(`[BaileysClient:${this.instanceId}] Connected to WhatsApp`);
        this.isReady = true;
        this.retryCount = 0;
        this.reconnecting = false;
        this.emit('ready');
      }
    });
    
    // Credentials update
    this.socket.ev.on('creds.update', saveCreds);
    
    // Message events
    this.socket.ev.on('messages.upsert', (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          this.emit('message', msg);
        }
      }
    });
    
    // Connection handshake events for advanced connection tracking
    if (this.socket.ws) {
      this.socket.ws.on('open', () => {
        console.log(`[BaileysClient:${this.instanceId}] WebSocket connection opened`);
      });
      
      this.socket.ws.on('close', () => {
        console.log(`[BaileysClient:${this.instanceId}] WebSocket connection closed`);
      });
      
      this.socket.ws.on('error', (err) => {
        console.error(`[BaileysClient:${this.instanceId}] WebSocket error:`, err);
      });
    }
  }
  
  /**
   * Attempt to reconnect to WhatsApp
   */
  async attemptReconnect() {
    try {
      this.retryCount++;
      
      if (this.retryCount > this.maxRetries) {
        console.log(`[BaileysClient:${this.instanceId}] Max reconnection attempts reached (${this.maxRetries})`);
        this.reconnecting = false;
        this.emit('auth_failure', new Error('Max reconnection attempts reached'));
        return;
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Attempting to reconnect (${this.retryCount}/${this.maxRetries})...`);
      
      // Add exponential backoff delay
      const delay = Math.min(30000, 1000 * Math.pow(2, this.retryCount - 1));
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Try to initialize again
      await this.initialize(this.shouldShowQr);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error during reconnection:`, error);
      
      // Set reconnecting to false to allow future reconnection attempts
      this.reconnecting = false;
      
      // Trigger reconnection event so instance can try to reconnect
      this.emit('disconnected', 'Reconnection attempt failed');
    }
  }
  
  /**
   * Check if authenticated
   * @returns {Promise<boolean>} - Whether authenticated
   */
  async isAuthenticated() {
    try {
      // Check if auth creds exist
      const credsPath = path.join(this.baileysAuthFolder, 'creds.json');
      return fs.existsSync(credsPath);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  /**
   * Restore session if already authenticated
   * @returns {Promise<boolean>} - Whether session was restored
   */
  async restoreSession() {
    try {
      // Check if already authenticated
      const isAuth = await this.isAuthenticated();
      
      if (!isAuth) {
        console.log(`[BaileysClient:${this.instanceId}] No authentication data found to restore`);
        return false;
      }
      
      // If socket is already connected and ready, nothing to do
      if (this.socket && this.isReady) {
        console.log(`[BaileysClient:${this.instanceId}] Session already active, no need to restore`);
        return true;
      }
      
      // Initialize with QR code display off
      console.log(`[BaileysClient:${this.instanceId}] Restoring existing session...`);
      const oldShowQrSetting = this.shouldShowQr;
      this.shouldShowQr = false;
      
      const success = await this.initialize();
      
      // Restore original QR setting
      this.shouldShowQr = oldShowQrSetting;
      
      return success && this.isReady;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Send a message to a WhatsApp number
   * @param {string} to - Recipient phone number
   * @param {string} message - Message text
   * @returns {Promise<Object>} - Message info
   */
  async sendMessage(to, message) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error('WhatsApp client not connected');
      }
      
      // Format phone number
      const recipient = this.formatPhoneNumber(to);
      
      // Send message
      const msg = await this.socket.sendMessage(recipient, { text: message });
      return msg;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * Format a phone number for WhatsApp
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    // Clean phone number of non-digits
    let cleaned = phoneNumber.toString().replace(/\D/g, '');
    
    // Add suffix if not already present
    if (!cleaned.includes('@')) {
      cleaned = `${cleaned}@s.whatsapp.net`;
    }
    
    return cleaned;
  }
  
  /**
   * Disconnect from WhatsApp
   * @param {boolean} logout - Whether to also logout
   * @returns {Promise<boolean>} - Success
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      if (!this.socket) {
        console.log(`[BaileysClient:${this.instanceId}] No active connection to disconnect`);
        return true;
      }
      
      if (logout) {
        // Logout
        await this.socket.logout();
      }
      
      // Close socket
      if (this.socket.end) {
        await this.socket.end();
      }
      
      this.socket = null;
      this.isReady = false;
      console.log(`[BaileysClient:${this.instanceId}] Socket closed`);
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Make sure state is updated even on error
      this.socket = null;
      this.isReady = false;
      
      return false;
    }
  }
}

module.exports = BaileysClient;
'use strict';

const { Boom } = require('@hapi/boom');
const makeWASocket = require('@whiskeysockets/baileys').default;
const fs = require('fs');
const path = require('path');

/**
 * WhatsApp client using the Baileys library
 */
class BaileysClient {
  /**
   * Create a new Baileys client
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    // Essential properties
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'auth', this.instanceId);
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(__dirname, '..', '..', 'baileys_auth', this.instanceId);
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp', this.instanceId);
    
    // Create directories if they don't exist
    [this.authFolder, this.baileysAuthFolder, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Socket state
    this.socket = null;
    this.isReady = false;
    this.showQrCode = true;
    this.maxRetries = options.maxRetries || 5;
    this.currentRetry = 0;
    
    // Event callbacks
    this.eventCallbacks = new Map();
    
    // Explicitly bind methods to preserve 'this' context
    this.setShowQrCode = this.setShowQrCode.bind(this);
    this.initialize = this.initialize.bind(this);
    this.registerEventListeners = this.registerEventListeners.bind(this);
    this.on = this.on.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.disconnect = this.disconnect.bind(this);
    this.isAuthenticated = this.isAuthenticated.bind(this);
    this.restoreSession = this.restoreSession.bind(this);
    
    // Component initialization is delayed until initialize() is called
    this.auth = null;
    this.events = null;
    this.message = null;
    this.media = null;
    
    console.log(`[BaileysClient:${this.instanceId}] Client initialized`);
  }
  
  /**
   * Set whether to show QR code
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = !!show; // Convert to boolean
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${this.showQrCode}`);
  }
  
  /**
   * Initialize the WhatsApp client
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);

      // Import components lazily to avoid circular dependencies
      try {
        const BaileysAuth = require('./baileys/BaileysAuth');
        const BaileysEvents = require('./baileys/BaileysEvents');
        const BaileysMessage = require('./baileys/BaileysMessage');
        const BaileysMedia = require('./baileys/BaileysMedia');
        
        // Create component instances
        this.auth = new BaileysAuth(this.instanceId, this.baileysAuthFolder);
        this.events = new BaileysEvents(this.instanceId);
        this.message = new BaileysMessage(this.instanceId);
        this.media = new BaileysMedia(this.instanceId, this.tempDir);
      } catch (importError) {
        console.error(`[BaileysClient:${this.instanceId}] Error importing components:`, importError);
        return false;
      }

      // Initialize auth first
      await this.auth.initialize();
      
      // Get auth state from auth handler
      const authState = this.auth.getAuthState();
      
      if (!authState) {
        console.error(`[BaileysClient:${this.instanceId}] No auth state available`);
        return false;
      }
      
      // Create socket with auth state
      this.socket = makeWASocket({
        auth: authState,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        browser: ['Discord-WhatsApp-Bridge', 'Chrome', '10.0.0'],
      });
      
      if (!this.socket) {
        console.error(`[BaileysClient:${this.instanceId}] Failed to create socket`);
        return false;
      }
      
      // Set up event handlers
      this.events.setSocket(this.socket);
      this.events.setupListeners(this.message, this.media);
      
      // Set up message handler
      this.message.setSocket(this.socket);
      
      // Set up media handler
      this.media.setSocket(this.socket);
      
      // Register event listeners
      this.registerEventListeners();
      
      console.log(`[BaileysClient:${this.instanceId}] WhatsApp initialized successfully`);
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp:`, error);
      this.isReady = false;
      return false;
    }
  }
  
  /**
   * Register event listeners
   */
  registerEventListeners() {
    if (!this.events) {
      console.error(`[BaileysClient:${this.instanceId}] Events component not initialized`);
      return;
    }
    
    // QR code event
    this.events.on('qr', (qr) => {
      if (this.eventCallbacks.has('qr')) {
        this.eventCallbacks.get('qr').forEach(callback => {
          try {
            callback(qr);
          } catch (error) {
            console.error(`[BaileysClient:${this.instanceId}] Error in QR callback:`, error);
          }
        });
      }
    });
    
    // Ready event
    this.events.on('ready', () => {
      this.isReady = true;
      this.currentRetry = 0;
      
      if (this.eventCallbacks.has('ready')) {
        this.eventCallbacks.get('ready').forEach(callback => {
          try {
            callback();
          } catch (error) {
            console.error(`[BaileysClient:${this.instanceId}] Error in ready callback:`, error);
          }
        });
      }
    });
    
    // Auth failure event
    this.events.on('auth_failure', (error) => {
      this.isReady = false;
      
      if (this.eventCallbacks.has('auth_failure')) {
        this.eventCallbacks.get('auth_failure').forEach(callback => {
          try {
            callback(error);
          } catch (callbackError) {
            console.error(`[BaileysClient:${this.instanceId}] Error in auth_failure callback:`, callbackError);
          }
        });
      }
    });
    
    // Disconnected event
    this.events.on('disconnected', (reason) => {
      this.isReady = false;
      
      if (this.eventCallbacks.has('disconnected')) {
        this.eventCallbacks.get('disconnected').forEach(callback => {
          try {
            callback(reason);
          } catch (error) {
            console.error(`[BaileysClient:${this.instanceId}] Error in disconnected callback:`, error);
          }
        });
      }
    });
    
    // Message event
    this.events.on('message', (message) => {
      if (this.eventCallbacks.has('message')) {
        this.eventCallbacks.get('message').forEach(callback => {
          try {
            callback(message);
          } catch (error) {
            console.error(`[BaileysClient:${this.instanceId}] Error in message callback:`, error);
          }
        });
      }
    });
  }
  
  /**
   * Register callback for event
   * @param {string} event - Event name
   * @param {Function} callback - Event callback
   */
  on(event, callback) {
    if (typeof callback !== 'function') {
      console.error(`[BaileysClient:${this.instanceId}] Invalid callback for event ${event}`);
      return;
    }
    
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, new Set());
    }
    this.eventCallbacks.get(event).add(callback);
    console.log(`[BaileysClient:${this.instanceId}] Registered callback for event: ${event}`);
  }
  
  /**
   * Send a message to a WhatsApp contact
   * @param {string} to - Recipient phone number
   * @param {string|Object} content - Message content
   * @returns {Promise<Object>} Sent message
   */
  async sendMessage(to, content) {
    try {
      if (!this.socket) throw new Error('WhatsApp client not initialized');
      if (!this.isReady) throw new Error('WhatsApp client not ready');
      
      // Clean up phone number
      const recipient = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      
      // Send message
      return await this.socket.sendMessage(recipient, content);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * Disconnect the WhatsApp client
   * @param {boolean} logOut - Whether to log out (delete auth data)
   * @returns {Promise<boolean>} Success status
   */
  async disconnect(logOut = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logOut ? '(with logout)' : ''}`);
      
      // Clean up auth state if logging out
      if (logOut && this.auth) {
        try {
          await this.auth.logout();
        } catch (logoutError) {
          console.error(`[BaileysClient:${this.instanceId}] Error logging out:`, logoutError);
        }
      }
      
      // Clean up event listeners
      if (this.events) {
        try {
          this.events.cleanupListeners();
        } catch (cleanupError) {
          console.error(`[BaileysClient:${this.instanceId}] Error cleaning up listeners:`, cleanupError);
        }
      }
      
      // Close socket
      if (this.socket) {
        try {
          this.socket.end();
          console.log(`[BaileysClient:${this.instanceId}] Socket closed`);
        } catch (closeError) {
          console.error(`[BaileysClient:${this.instanceId}] Error closing socket:`, closeError);
        }
        this.socket = null;
      }
      
      // Reset state
      this.isReady = false;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      return false;
    }
  }
  
  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} Authentication status
   */
  async isAuthenticated() {
    try {
      if (!this.auth) {
        const BaileysAuth = require('./baileys/BaileysAuth');
        this.auth = new BaileysAuth(this.instanceId, this.baileysAuthFolder);
      }
      
      return await this.auth.isAuthenticated();
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking auth:`, error);
      return false;
    }
  }
  
  /**
   * Restore session without QR code
   * @returns {Promise<boolean>} Success status
   */
  async restoreSession() {
    try {
      if (this.isReady) return true;
      
      const isAuth = await this.isAuthenticated();
      if (!isAuth) return false;
      
      // Temporarily disable QR code
      const originalQrSetting = this.showQrCode;
      this.setShowQrCode(false);
      
      // Try to initialize
      this.currentRetry = 0;
      const success = await this.initialize();
      
      // Restore QR setting
      this.setShowQrCode(originalQrSetting);
      
      return success && this.isReady;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
}

module.exports = BaileysClient;
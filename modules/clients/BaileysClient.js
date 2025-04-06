// modules/clients/BaileysClient.js

// Track instances statically
const instances = new Map();

// Import related components with correct paths
let BaileysEvents;
let BaileysMessage;
let BaileysMedia;
let BaileysAuth;

// Try dynamic imports to avoid circular dependencies
try {
  BaileysEvents = require('./baileys/BaileysEvents');
  BaileysMessage = require('./baileys/BaileysMessage');
  BaileysMedia = require('./baileys/BaileysMedia');
  BaileysAuth = require('./baileys/BaileysAuth');
} catch (error) {
  console.warn('Some Baileys components failed to load, will try again when needed:', error.message);
}

const fs = require('fs');
const path = require('path');

/**
 * WhatsApp client using the Baileys library
 */
class BaileysClient {
  /**
   * Create a new BaileysClient instance
   * @param {Object} options - Client options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    this.maxRetries = options.maxRetries || 5;
    
    // Internal state
    this.socket = null;
    this.isReady = false;
    this.connected = false;
    this.showQrCode = false;  // CRITICAL: Default to false
    this.eventHandlers = {};
    
    // Store instance reference in the static map
    instances.set(this.instanceId, this);
    
    // Ensure our components are loaded
    this.ensureComponentsLoaded();
    
    console.log(`[BaileysClient:${this.instanceId}] Client initialized`);
  }
  
  /**
   * Ensure all client components are loaded
   * @private
   */
  ensureComponentsLoaded() {
    if (!BaileysEvents) {
      try {
        BaileysEvents = require('./baileys/BaileysEvents');
      } catch (error) {
        console.error(`[BaileysClient:${this.instanceId}] Failed to load BaileysEvents:`, error.message);
      }
    }
    
    if (!BaileysMessage) {
      try {
        BaileysMessage = require('./baileys/BaileysMessage');
      } catch (error) {
        console.error(`[BaileysClient:${this.instanceId}] Failed to load BaileysMessage:`, error.message);
      }
    }
    
    if (!BaileysMedia) {
      try {
        BaileysMedia = require('./baileys/BaileysMedia');
      } catch (error) {
        console.error(`[BaileysClient:${this.instanceId}] Failed to load BaileysMedia:`, error.message);
      }
    }
    
    if (!BaileysAuth) {
      try {
        BaileysAuth = require('./baileys/BaileysAuth');
      } catch (error) {
        console.error(`[BaileysClient:${this.instanceId}] Failed to load BaileysAuth:`, error.message);
      }
    }
  }
  
  /**
   * Get client instance by ID
   * @param {string} instanceId - Instance ID
   * @returns {BaileysClient} - Client instance
   */
  static getInstance(instanceId) {
    return instances.get(instanceId);
  }
  
  /**
   * Get all client instances
   * @returns {Map<string, BaileysClient>} - Map of instances
   */
  static getInstances() {
    return instances;
  }
  
  /**
   * Set QR code display flag
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = !!show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${this.showQrCode}`);
  }
  
  /**
   * Check if QR code should be displayed
   * @returns {boolean} - Whether to show QR code
   */
  shouldShowQrCode() {
    return this.showQrCode;
  }
  
  /**
   * Set ready state
   * @param {boolean} ready - Ready state
   */
  setReady(ready) {
    this.isReady = !!ready;
    this.connected = this.isReady;
    
    // If connected successfully, disable QR code display
    if (this.isReady) {
      this.showQrCode = false;
    }
  }
  
  /**
   * Register event handler
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  on(event, handler) {
    this.eventHandlers[event] = handler;
    console.log(`[BaileysClient:${this.instanceId}] Registered callback for event: ${event}`);
    
    // If events component is already initialized, register with it directly
    if (this.events) {
      this.events.registerHandler(event, handler);
    }
  }
  
  /**
   * Check if client is authenticated with saved credentials
   * @returns {Promise<boolean>} - Authentication status
   */
  async isAuthenticated() {
    try {
      // Ensure components are loaded
      this.ensureComponentsLoaded();
      
      // Create auth if not initialized
      if (!this.auth && BaileysAuth) {
        this.auth = new BaileysAuth(this.instanceId, this.baileysAuthFolder);
      }
      
      if (!this.auth) {
        console.error(`[BaileysClient:${this.instanceId}] Auth component not available`);
        return false;
      }
      
      // Check if auth files exist
      const authExists = await this.auth.checkAuthExists();
      console.log(`[BaileysAuth:${this.instanceId}] Authentication status: ${authExists}`);
      return authExists;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  /**
   * Restore previous session without QR code
   * @returns {Promise<boolean>} - Restore success
   */
  async restoreSession() {
    try {
      // Don't show QR code for session restore
      this.showQrCode = false;
      
      // Connect with existing auth
      const success = await this.initialize(false);
      console.log(`[BaileysClient:${this.instanceId}] Session restore ${success ? 'succeeded' : 'failed'}`);
      return success;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Initialize the WhatsApp client connection
   * @param {boolean} forceQr - Whether to force QR code generation
   * @returns {Promise<boolean>} - Success status
   */
  async initialize(forceQr = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`);
      
      // Ensure components are loaded
      this.ensureComponentsLoaded();
      
      // Check if we have all required components
      if (!BaileysEvents || !BaileysMessage || !BaileysMedia || !BaileysAuth) {
        throw new Error('Required Baileys components are not available');
      }
      
      // Initialize components
      this.events = new BaileysEvents(this.instanceId);
      this.message = new BaileysMessage(this.instanceId);
      this.media = new BaileysMedia(this.instanceId, this.tempDir);
      this.auth = new BaileysAuth(this.instanceId, this.baileysAuthFolder);
      
      // Initialize auth state
      await this.auth.initializeAuthState();
      
      // CRITICAL FIX: Check if already authenticated and we're not forcing QR code
      const isAuth = await this.isAuthenticated();
      if (isAuth && !forceQr && !this.showQrCode) {
        console.log(`[BaileysClient:${this.instanceId}] Already authenticated, attempting to restore session`);
        
        // Try to restore existing session without QR code
        try {
          // Create WhatsApp socket with auth state
          const { 
            default: makeWASocket, 
            useMultiFileAuthState,
            Browsers,
            DisconnectReason
          } = require('@whiskeysockets/baileys');
          
          // Get auth from state handlers
          const { state, saveCreds } = await this.auth.getAuthState();
          
          // Socket options - don't generate QR since we're restoring
          const socketOptions = {
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: true,
            retryRequestDelayMs: 250,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false,
            version: [2, 2403, 2]
          };
          
          // Create socket
          this.socket = makeWASocket(socketOptions);
          
          // Set socket in components
          this.events.setSocket(this.socket);
          this.message.setSocket(this.socket);
          this.media.setSocket(this.socket);
          
          // Set up credential saving
          this.socket.ev.on('creds.update', state.saveCreds);
          
          // Set up event handlers
          const connectSuccess = await this.events.setupEventListeners();
          
          // Add specific event handlers
          for (const event of Object.keys(this.eventHandlers)) {
            this.events.registerHandler(event, this.eventHandlers[event]);
          }
          
          // Wait for connection to stabilize
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Check if we're connected 
          if (connectSuccess && this.isConnected()) {
            console.log(`[BaileysClient:${this.instanceId}] Session restored successfully`);
            this.isReady = true;
            this.connected = true;
            return true;
          }
        } catch (restoreError) {
          console.error(`[BaileysClient:${this.instanceId}] Error restoring session:`, restoreError);
          // Fall through to normal initialization with QR code
        }
      }
      
      // Normal initialization with potential QR code
      console.log(`[BaileysClient:${this.instanceId}] Performing standard initialization ${this.showQrCode ? 'with' : 'without'} QR code`);
      
      // Create WhatsApp socket with auth state
      const { 
        default: makeWASocket, 
        useMultiFileAuthState,
        Browsers,
        DisconnectReason
      } = require('@whiskeysockets/baileys');
      
      // Get auth from state handlers
      const { state, saveCreds } = await this.auth.getAuthState();
      
      // Socket options
      const socketOptions = {
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: true,
        retryRequestDelayMs: 250,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        syncFullHistory: false,
        version: [2, 2403, 2]
      };
      
      // Create socket
      this.socket = makeWASocket(socketOptions);
      
      // Set socket in components
      this.events.setSocket(this.socket);
      this.message.setSocket(this.socket);
      this.media.setSocket(this.socket);
      
      // Set up credential saving
      this.socket.ev.on('creds.update', saveCreds);
      
      // Set up event handlers
      const connectSuccess = await this.events.setupEventListeners();
      
      // Add specific event handlers
      for (const event of Object.keys(this.eventHandlers)) {
        this.events.registerHandler(event, this.eventHandlers[event]);
      }
      
      console.log(`[BaileysClient:${this.instanceId}] WhatsApp initialized successfully`);
      return connectSuccess;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp:`, error);
      return false;
    }
  }
  
  /**
   * Check if client is connected and ready
   * @returns {boolean} - Connection status
   */
  isConnected() {
    return this.isReady && this.connected && this.socket !== null;
  }
  
  /**
   * Send a message to a WhatsApp contact
   * @param {string} to - Recipient phone number
   * @param {string|Object} content - Message content
   * @returns {Promise<Object>} - Send result
   */
  async sendMessage(to, content) {
    try {
      if (!this.socket || !this.isConnected()) {
        throw new Error('Client not connected');
      }
      
      // Use message handler to send
      return await this.message.sendMessage(to, content);
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * Disconnect the WhatsApp client
   * @param {boolean} logout - Whether to clear credentials
   * @returns {Promise<boolean>} - Disconnect success
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${logout ? '(with logout)' : ''}`);
      
      // Reset event listeners
      if (this.events) {
        this.events.resetListeners();
      }
      
      // Close socket if exists
      if (this.socket) {
        try {
          // Extract socket reference for closure below
          const socket = this.socket;
          
          // Clear the socket reference first
          this.socket = null;
          
          // Make logout specific to the logout parameter
          if (logout) {
            await socket.logout();
            console.log(`[BaileysClient:${this.instanceId}] Logged out successfully`);
          }
          
          // Always try to close the connection
          await socket.end();
          socket.ev.removeAllListeners();
          
          console.log(`[BaileysClient:${this.instanceId}] Socket closed`);
        } catch (socketError) {
          console.error(`[BaileysClient:${this.instanceId}] Error closing socket:`, socketError);
        }
      }
      
      // If logging out, clear auth files
      if (logout && this.auth) {
        await this.auth.clearAuth();
      }
      
      // Reset state
      this.isReady = false;
      this.connected = false;
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Force reset state
      this.isReady = false;
      this.connected = false;
      this.socket = null;
      
      return false;
    }
  }
}

// Expose instances map
BaileysClient.instances = instances;

module.exports = BaileysClient;
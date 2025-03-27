// modules/clients/baileys/BaileysAuth.js - Authentication handling
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

/**
 * Manages authentication for Baileys WhatsApp client
 */
class BaileysAuth {
  /**
   * Create a new BaileysAuth instance
   * @param {Object} options - Configuration options
   */
  constructor(options) {
    this.options = options;
    this.instanceId = options.instanceId;
    this.authFolder = options.baileysAuthFolder;
    this.authState = null;
    this.saveCreds = null;
    this.socket = null;
    this.logger = pino({ 
      level: 'error',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: true,
          ignore: 'hostname,pid'
        }
      }
    });
  }
  
  /**
   * Initialize auth system and load credentials
   */
  async initialize() {
    try {
      // Create auth folder if it doesn't exist
      if (!fs.existsSync(this.authFolder)) {
        fs.mkdirSync(this.authFolder, { recursive: true });
      }
      
      // Load auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      this.authState = state;
      this.saveCreds = saveCreds;
      
      console.log(`[BaileysAuth:${this.instanceId}] Auth state loaded from ${this.authFolder}`);
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error initializing auth:`, error);
      return false;
    }
  }
  
  /**
   * Connect to WhatsApp
   * @param {boolean} showQrCode - Whether to force QR code display
   * @returns {Promise<Object>} Connection result
   */
  async connect(showQrCode = false) {
    try {
      // Make sure auth state is initialized
      if (!this.authState) {
        await this.initialize();
      }
      
      console.log(`[BaileysAuth:${this.instanceId}] Creating WhatsApp socket connection...`);
      
      // Initialize socket with auth state
      const sock = makeWASocket({
        auth: this.authState,
        printQRInTerminal: false, // We handle QR display ourselves
        logger: this.logger,
        markOnlineOnConnect: false, // Avoid showing as "online" all the time
        defaultQueryTimeoutMs: 60000, // 60 seconds timeout for queries
        patchMessageBeforeSending: true,
        browser: ['WhatsApp Bridge', 'Chrome', '10.0.0'], // Less identifiable
      });
      
      // Save credentials on change
      sock.ev.on('creds.update', async () => {
        await this.saveCreds();
        console.log(`[BaileysAuth:${this.instanceId}] Credentials updated`);
      });
      
      // Store socket reference
      this.socket = sock;
      
      console.log(`[BaileysAuth:${this.instanceId}] Socket created successfully`);
      
      return { sock, auth: this.authState };
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error connecting:`, error);
      return null;
    }
  }
  
  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} Authentication status
   */
  async isAuthenticated() {
    try {
      if (!this.authState) {
        await this.initialize();
      }
      
      // Check if credentials file exists
      const credsPath = path.join(this.authFolder, 'creds.json');
      if (!fs.existsSync(credsPath)) {
        return false;
      }
      
      // Read and parse credentials
      const credsContent = fs.readFileSync(credsPath, 'utf8');
      const creds = JSON.parse(credsContent);
      
      // Check for minimal required credentials
      return !!(creds && creds.me && creds.me.id && creds.noiseKey);
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  /**
   * Restore an existing session
   * @returns {Promise<boolean>} Restoration success
   */
  async restoreSession() {
    try {
      // Check if we're already authenticated
      const isAuth = await this.isAuthenticated();
      if (!isAuth) {
        console.log(`[BaileysAuth:${this.instanceId}] No authentication data found to restore`);
        return false;
      }
      
      // Try to connect without showing QR
      const connection = await this.connect(false);
      if (!connection || !connection.sock) {
        console.log(`[BaileysAuth:${this.instanceId}] Failed to restore session`);
        return false;
      }
      
      // Connection successful
      console.log(`[BaileysAuth:${this.instanceId}] Session restored successfully`);
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  /**
   * Disconnect from WhatsApp
   * @param {boolean} logout - Whether to remove auth data
   * @returns {Promise<boolean>} Disconnect success
   */
  async disconnect(logout = false) {
    try {
      console.log(`[BaileysAuth:${this.instanceId}] Disconnecting... ${logout ? '(with logout)' : ''}`);
      
      if (this.socket) {
        // First try proper logout if requested
        if (logout) {
          try {
            await this.socket.logout();
            console.log(`[BaileysAuth:${this.instanceId}] Logged out successfully`);
          } catch (logoutError) {
            console.error(`[BaileysAuth:${this.instanceId}] Error during logout:`, logoutError);
          }
        }
        
        // Close the socket
        this.socket.end();
        this.socket = null;
        console.log(`[BaileysAuth:${this.instanceId}] Socket closed`);
        
        // Remove auth files if logout requested
        if (logout) {
          await this.clearAuthFiles();
        }
      } else {
        console.log(`[BaileysAuth:${this.instanceId}] No socket to disconnect`);
        
        // Still remove auth files if requested
        if (logout) {
          await this.clearAuthFiles();
        }
      }
      
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error disconnecting:`, error);
      
      // Try to force cleanup even on error
      if (logout) {
        try {
          await this.clearAuthFiles();
        } catch (cleanupError) {
          console.error(`[BaileysAuth:${this.instanceId}] Error clearing auth files:`, cleanupError);
        }
      }
      
      return false;
    }
  }
  
  /**
   * Clear authentication files
   * @private
   * @returns {Promise<boolean>} Cleanup success
   */
  async clearAuthFiles() {
    try {
      if (fs.existsSync(this.authFolder)) {
        const files = fs.readdirSync(this.authFolder);
        
        for (const file of files) {
          const filePath = path.join(this.authFolder, file);
          
          try {
            if (fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
              console.log(`[BaileysAuth:${this.instanceId}] Deleted auth file: ${file}`);
            }
          } catch (fileError) {
            console.error(`[BaileysAuth:${this.instanceId}] Error deleting file ${file}:`, fileError);
          }
        }
      }
      
      // Also check for creds.json in parent folders
      const parentCreds = path.join(path.dirname(this.authFolder), 'creds.json');
      if (fs.existsSync(parentCreds)) {
        fs.unlinkSync(parentCreds);
        console.log(`[BaileysAuth:${this.instanceId}] Deleted parent creds.json`);
      }
      
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error clearing auth files:`, error);
      return false;
    }
  }
}

module.exports = { BaileysAuth };
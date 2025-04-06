// modules/clients/baileys/BaileysAuth.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');

class BaileysAuth {
  constructor(client) {
    this.client = client;
    this.sock = null;
    this.connectionPromises = [];
  }
  
  // Connect to WhatsApp
  async connect() {
    try {
      if (this.client.isReady) return true;
      if (this.client.isInitializing) {
        return new Promise((resolve) => {
          this.connectionPromises.push(resolve);
        });
      }
      
      this.client.isInitializing = true;
      
      console.log(`[BaileysAuth:${this.client.instanceId}] Initializing WhatsApp connection...`);
      console.log(`[BaileysAuth:${this.client.instanceId}] Using auth folder: ${this.client.authFolder}`);
      
      // Get authentication state
      const { state, saveCreds } = await useMultiFileAuthState(this.client.authFolder);
      
      // Fetch the latest version to ensure compatibility
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);
      
      // Create socket with extended timeouts
      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: this.client.showQrCode,
        logger: this.client.logger, // Pass the proper Pino logger
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        browser: ['WhatsApp-Discord-Bridge', 'Chrome', '10.0'],
        markOnlineOnConnect: true,
        retryRequestDelayMs: 500
      });
      
      // Save credentials when updated
      this.sock.ev.on('creds.update', saveCreds);
      
      // Set up event handlers
      await this.client.events.setupEvents(this.sock);
      
      // Wait for connection or timeout
      const result = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (!this.client.isReady) {
            console.log('Baileys connection timed out after 60 seconds');
            this.client.isInitializing = false;
            resolve(false);
          }
        }, 60000); // 60 second timeout
        
        this.connectionPromises.push((success) => {
          clearTimeout(timeout);
          resolve(success);
        });
      });
      
      return result;
    } catch (error) {
      console.error(`[BaileysAuth:${this.client.instanceId}] Error initializing WhatsApp:`, error);
      this.client.isInitializing = false;
      return false;
    }
  }
  
  // Check if authenticated
  async isAuthenticated() {
    try {
      // Check if auth files exist
      const credsPath = path.join(this.client.authFolder, 'creds.json');
      return fs.existsSync(credsPath);
    } catch (error) {
      console.error(`[BaileysAuth:${this.client.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  // Restore session if credentials exist
  async restoreSession() {
    try {
      // Check if auth files exist
      const authenticated = await this.isAuthenticated();
      if (!authenticated) {
        console.log(`[BaileysAuth:${this.client.instanceId}] No authentication credentials found`);
        return false;
      }
      
      // Try to initialize (which will use existing credentials)
      return await this.client.initialize(false);
    } catch (error) {
      console.error(`[BaileysAuth:${this.client.instanceId}] Error restoring session:`, error);
      return false;
    }
  }
  
  // Check if a number exists on WhatsApp
  async isRegisteredUser(number) {
    try {
      if (!this.sock) return false;
      
      const jid = this.client.message.formatJid(number);
      const [result] = await this.sock.onWhatsApp(jid.split('@')[0]);
      return result ? result.exists : false;
    } catch (error) {
      console.error(`[BaileysAuth:${this.client.instanceId}] Error checking user registration:`, error);
      return false;
    }
  }
  
  // Disconnect the client
  async disconnect(logOut = false) {
    try {
      console.log(`[BaileysAuth:${this.client.instanceId}] Disconnecting WhatsApp... ${logOut ? '(with logout)' : ''}`);
      
      if (!this.sock) {
        console.log(`[BaileysAuth:${this.client.instanceId}] No active socket to disconnect`);
        return;
      }
      
      // Reset client state
      this.client.isReady = false;
      this.client.isInitializing = false;
      
      // Resolve any pending promises
      this.connectionPromises.forEach(resolve => resolve(false));
      this.connectionPromises = [];
      
      // Clean up event listeners
      await this.client.events.removeAllListeners();
      
      // Handle logout if requested
      if (logOut) {
        // Delete auth files
        try {
          const credsPath = path.join(this.client.authFolder, 'creds.json');
          if (fs.existsSync(credsPath)) {
            fs.unlinkSync(credsPath);
            console.log(`Removed authentication credentials: ${credsPath}`);
          }
          
          // Also clear the entire baileys auth folder
          if (fs.existsSync(this.client.authFolder)) {
            const files = fs.readdirSync(this.client.authFolder);
            for (const file of files) {
              try {
                fs.unlinkSync(path.join(this.client.authFolder, file));
              } catch (error) {
                console.warn(`Could not delete auth file ${file}: ${error.message}`);
              }
            }
            console.log(`Cleared authentication folder: ${this.client.authFolder}`);
          }
        } catch (error) {
          console.error(`Error removing auth files: ${error.message}`);
        }
      }
      
      // Clear the socket reference
      this.sock = null;
      
      // Emit disconnected event
      this.client.emit('disconnected', logOut ? 'logout' : 'user_disconnected');
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.client.instanceId}] Error disconnecting:`, error);
      
      // Ensure client state is reset even on error
      this.client.isReady = false;
      this.client.isInitializing = false;
      this.sock = null;
      
      // Emit event with error
      this.client.emit('disconnected', `error: ${error.message}`);
      return false;
    }
  }
}

module.exports = BaileysAuth;
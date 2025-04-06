// modules/clients/baileys/BaileysAuth.js - Fixed for @whiskeysockets/baileys compatibility
const { proto } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');

/**
 * Handles authentication for Baileys WhatsApp client
 */
class BaileysAuth {
  /**
   * Create an authentication handler
   * @param {Object} options - Options
   * @param {string} options.instanceId - Instance ID
   * @param {string} options.authFolder - Authentication folder
   * @param {string} options.baileysAuthFolder - Baileys auth folder
   */
  constructor(options) {
    this.instanceId = options.instanceId.toString();
    this.authFolder = options.authFolder.toString();
    this.baileysAuthFolder = options.baileysAuthFolder.toString();
    this.state = {};
    this.saveCreds = null;
    
    console.log(`[BaileysAuth:${this.instanceId}] Auth handler initialized with auth folder: ${this.authFolder}, baileys folder: ${this.baileysAuthFolder}`);
    
    // Create auth folders if they don't exist
    this.createAuthFolders();
  }
  
  /**
   * Create authentication folders
   */
  createAuthFolders() {
    [this.authFolder, this.baileysAuthFolder].forEach(folder => {
      if (!fs.existsSync(folder)) {
        try {
          fs.mkdirSync(folder, { recursive: true });
          console.log(`[BaileysAuth:${this.instanceId}] Created folder: ${folder}`);
        } catch (error) {
          console.error(`[BaileysAuth:${this.instanceId}] Error creating folder ${folder}:`, error);
        }
      }
    });
  }
  
  /**
   * Get credentials path
   * @returns {string} - Credentials path
   */
  getCredsPath() {
    return path.join(this.baileysAuthFolder, 'creds.json');
  }
  
  /**
   * Check if credentials exist
   * @returns {boolean} - Whether credentials exist
   */
  async credentialsExist() {
    try {
      const credsPath = this.getCredsPath();
      return fs.existsSync(credsPath);
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error checking credentials:`, error);
      return false;
    }
  }
  
  /**
   * Initialize authentication
   * @returns {Object} - Authentication state and handlers
   */
  async initialize() {
    try {
      console.log(`[BaileysAuth:${this.instanceId}] Initializing authentication...`);
      
      const credsPath = this.getCredsPath();
      
      // Check if creds file exists
      const credentialsExist = await this.credentialsExist();
      console.log(`[BaileysAuth:${this.instanceId}] Credentials file exists: ${credentialsExist}`);
      
      let creds = null;
      if (credentialsExist) {
        try {
          // Read credentials
          const rawCreds = fs.readFileSync(credsPath, { encoding: 'utf8' });
          creds = JSON.parse(rawCreds);
          console.log(`[BaileysAuth:${this.instanceId}] Successfully loaded credentials from ${credsPath}`);
        } catch (error) {
          console.error(`[BaileysAuth:${this.instanceId}] Error loading credentials:`, error);
          
          // On error loading creds, we'll start fresh
          creds = null;
        }
      }
      
      // If no creds or error loading them, initialize a basic object
      if (!creds) {
        // Initialize with empty creds structure that Baileys expects
        creds = {
          creds: {
            noiseKey: null,
            signedIdentityKey: null,
            signedPreKey: null,
            registrationId: 0,
            advSecretKey: null,
            nextPreKeyId: 0,
            firstUnuploadedPreKeyId: 0,
            serverHasPreKeys: false,
            account: null,
            me: null,
            signalIdentities: [],
            lastAccountSyncTimestamp: 0,
            myAppStateKeyId: null
          },
          keys: {}
        };
      }
      
      // Define function to save credentials
      const saveCreds = async () => {
        if (this.state?.creds) {
          try {
            // Create auth folder if it doesn't exist
            if (!fs.existsSync(this.baileysAuthFolder)) {
              fs.mkdirSync(this.baileysAuthFolder, { recursive: true });
            }
            
            // Save creds to file
            fs.writeFileSync(
              credsPath,
              JSON.stringify(this.state.creds, null, 2),
              { encoding: 'utf8' }
            );
            
            console.log(`[BaileysAuth:${this.instanceId}] Saved credentials to ${credsPath}`);
          } catch (error) {
            console.error(`[BaileysAuth:${this.instanceId}] Error saving credentials:`, error);
          }
        } else {
          console.warn(`[BaileysAuth:${this.instanceId}] No state.creds to save!`);
        }
      };
      
      // Set instance state and saveCreds function
      this.state = creds;
      this.saveCreds = saveCreds;
      
      return {
        state: this.state,
        saveCreds: this.saveCreds
      };
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error initializing auth:`, error);
      throw error;
    }
  }
  
  /**
   * Get current authentication state
   * @returns {Object} - Authentication state
   */
  async getState() {
    return this.state;
  }
  
  /**
   * Handle connection update
   * @param {Object} update - Connection update
   */
  async handleConnectionUpdate(update) {
    try {
      const { connection, lastDisconnect } = update;
      
      // Save credentials on successful connection
      if (connection === 'open') {
        console.log(`[BaileysAuth:${this.instanceId}] Connection opened, saving credentials`);
        await this.saveCreds();
      }
      
      // Handle disconnections
      if (connection === 'close') {
        // Get status code
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        
        // Logout if the status code indicates logout
        if (statusCode === 401 || statusCode === 410) {
          console.log(`[BaileysAuth:${this.instanceId}] User logged out or credentials revoked, clearing auth data`);
          await this.clearCredentials();
        }
      }
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error handling connection update:`, error);
    }
  }
  
  /**
   * Check if authenticated
   * @returns {boolean} - Whether authenticated
   */
  async isAuthenticated() {
    try {
      // Check if credentials file exists
      const credsExist = await this.credentialsExist();
      if (!credsExist) return false;
      
      // Read and parse credentials to check for necessary properties
      const credsPath = this.getCredsPath();
      const rawCreds = fs.readFileSync(credsPath, { encoding: 'utf8' });
      const creds = JSON.parse(rawCreds);
      
      // Simple validation - check if the basic required properties exist
      const hasKeys = Boolean(creds?.creds?.noiseKey && 
                             creds?.creds?.signedIdentityKey && 
                             creds?.creds?.signedPreKey);
      
      return hasKeys;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error checking authentication:`, error);
      return false;
    }
  }
  
  /**
   * Clear credentials
   * @returns {Promise<boolean>} - Success status
   */
  async clearCredentials() {
    try {
      console.log(`[BaileysAuth:${this.instanceId}] Clearing credentials`);
      
      // Get credentials path
      const credsPath = this.getCredsPath();
      
      // Check if file exists
      if (fs.existsSync(credsPath)) {
        try {
          // Delete the file
          fs.unlinkSync(credsPath);
          console.log(`[BaileysAuth:${this.instanceId}] Deleted credentials file: ${credsPath}`);
        } catch (unlinkError) {
          console.error(`[BaileysAuth:${this.instanceId}] Error deleting credentials file:`, unlinkError);
          
          // As fallback, try to truncate the file
          try {
            fs.truncateSync(credsPath, 0);
            console.log(`[BaileysAuth:${this.instanceId}] Truncated credentials file: ${credsPath}`);
          } catch (truncateError) {
            console.error(`[BaileysAuth:${this.instanceId}] Error truncating credentials file:`, truncateError);
            return false;
          }
        }
      }
      
      // Reset state
      this.state = {
        creds: {
          noiseKey: null,
          signedIdentityKey: null,
          signedPreKey: null,
          registrationId: 0,
          advSecretKey: null,
          nextPreKeyId: 0,
          firstUnuploadedPreKeyId: 0,
          serverHasPreKeys: false,
          account: null,
          me: null,
          signalIdentities: [],
          lastAccountSyncTimestamp: 0,
          myAppStateKeyId: null
        },
        keys: {}
      };
      
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error clearing credentials:`, error);
      return false;
    }
  }
}

module.exports = BaileysAuth;
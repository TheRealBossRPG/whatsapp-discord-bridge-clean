'use strict';

const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

/**
 * Handles WhatsApp authentication state
 */
class BaileysAuth {
  /**
   * Create a new authentication handler
   * @param {string} instanceId - Instance ID
   * @param {string} authFolder - Auth folder path
   */
  constructor(instanceId, authFolder) {
    // Basic properties
    this.instanceId = instanceId || 'default';
    this.authFolder = authFolder || path.join(__dirname, '..', '..', '..', 'baileys_auth', this.instanceId);
    this.authState = null;
    this.saveCreds = null;
    
    // Create auth folder if it doesn't exist
    if (!fs.existsSync(this.authFolder)) {
      try {
        fs.mkdirSync(this.authFolder, { recursive: true });
      } catch (mkdirError) {
        console.error(`[BaileysAuth:${this.instanceId}] Error creating auth folder:`, mkdirError);
      }
    }
    
    // Bind methods to ensure 'this' context
    this.initialize = this.initialize.bind(this);
    this.getAuthState = this.getAuthState.bind(this);
    this.saveCredentials = this.saveCredentials.bind(this);
    this.isAuthenticated = this.isAuthenticated.bind(this);
    this.logout = this.logout.bind(this);
  }
  
  /**
   * Initialize auth state
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    try {
      console.log(`[BaileysAuth:${this.instanceId}] Initializing auth state from ${this.authFolder}`);
      
      // Use Baileys multi-file auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      
      if (!state) {
        console.error(`[BaileysAuth:${this.instanceId}] Failed to initialize auth state`);
        return false;
      }
      
      this.authState = state;
      this.saveCreds = saveCreds;
      
      console.log(`[BaileysAuth:${this.instanceId}] Auth state loaded successfully`);
      
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error initializing auth:`, error);
      return false;
    }
  }
  
  /**
   * Get auth state
   * @returns {Object} Auth state
   */
  getAuthState() {
    return this.authState;
  }
  
  /**
   * Save auth credentials
   * @param {Object} creds - Auth credentials
   * @returns {Promise<boolean>} Success status
   */
  async saveCredentials(creds) {
    try {
      if (!creds) {
        console.error(`[BaileysAuth:${this.instanceId}] No credentials to save`);
        return false;
      }
      
      if (!this.saveCreds || typeof this.saveCreds !== 'function') {
        console.error(`[BaileysAuth:${this.instanceId}] Save credentials function not available`);
        return false;
      }
      
      await this.saveCreds(creds);
      console.log(`[BaileysAuth:${this.instanceId}] Credentials saved successfully`);
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error saving credentials:`, error);
      return false;
    }
  }
  
  /**
   * Check if authenticated
   * @returns {Promise<boolean>} Authentication status
   */
  async isAuthenticated() {
    try {
      // Check if auth state exists
      if (!this.authState) {
        await this.initialize();
      }
      
      // Check if auth state has credentials
      if (!this.authState || !this.authState.creds) {
        return false;
      }
      
      // Check if there's a key ID and registration
      const isAuth = !!(
        this.authState.creds.me && 
        this.authState.creds.me.id &&
        this.authState.creds.registered
      );
      
      console.log(`[BaileysAuth:${this.instanceId}] Authentication status: ${isAuth}`);
      return isAuth;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error checking auth:`, error);
      return false;
    }
  }
  
  /**
   * Logout and clear auth data
   * @returns {Promise<boolean>} Success status
   */
  async logout() {
    try {
      const authDir = this.authFolder;
      
      // Check if auth directory exists
      if (fs.existsSync(authDir)) {
        // Delete all files in the directory
        const files = fs.readdirSync(authDir);
        
        for (const file of files) {
          const filePath = path.join(authDir, file);
          
          // Check if it's a file
          if (fs.statSync(filePath).isFile()) {
            try {
              fs.unlinkSync(filePath);
              console.log(`[BaileysAuth:${this.instanceId}] Deleted auth file: ${file}`);
            } catch (unlinkError) {
              console.error(`[BaileysAuth:${this.instanceId}] Error deleting file ${file}:`, unlinkError);
            }
          }
        }
      }
      
      console.log(`[BaileysAuth:${this.instanceId}] Logged out and cleared auth data`);
      
      // Reset auth state
      this.authState = null;
      this.saveCreds = null;
      
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error during logout:`, error);
      return false;
    }
  }
}

module.exports = BaileysAuth;
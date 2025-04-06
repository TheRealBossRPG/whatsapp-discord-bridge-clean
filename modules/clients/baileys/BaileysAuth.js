// modules/clients/baileys/BaileysAuth.js - Authentication helper
const fs = require('fs');
const path = require('path');

/**
 * Helper for Baileys authentication
 */
class BaileysAuth {
  /**
   * Create new auth helper
   * @param {string} instanceId - Instance ID
   * @param {string} authFolder - Auth folder path
   * @param {string} baileysAuthFolder - Baileys-specific auth folder
   */
  constructor(instanceId, authFolder, baileysAuthFolder) {
    this.instanceId = instanceId;
    this.authFolder = authFolder;
    this.baileysAuthFolder = baileysAuthFolder;
    
    // Ensure folders exist
    this.ensureFolders();
  }
  
  /**
   * Ensure auth folders exist
   */
  ensureFolders() {
    try {
      // Create auth folder if it doesn't exist
      if (!fs.existsSync(this.authFolder)) {
        fs.mkdirSync(this.authFolder, { recursive: true });
      }
      
      // Create Baileys auth folder if it doesn't exist
      if (!fs.existsSync(this.baileysAuthFolder)) {
        fs.mkdirSync(this.baileysAuthFolder, { recursive: true });
      }
      
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error creating auth folders:`, error);
      return false;
    }
  }
  
  /**
   * Check if auth credentials exist
   * @returns {Promise<boolean>} - Whether credentials exist
   */
  async checkAuth() {
    try {
      // Check for creds.json in Baileys auth folder
      const credsPath = path.join(this.baileysAuthFolder, 'creds.json');
      if (fs.existsSync(credsPath)) {
        try {
          // Try to read and parse creds.json
          const credsData = fs.readFileSync(credsPath, 'utf8');
          const creds = JSON.parse(credsData);
          
          // Check if creds contains the me object
          if (creds && creds.me && creds.me.id) {
            return true;
          }
        } catch (readError) {
          console.error(`[BaileysAuth:${this.instanceId}] Error reading creds.json:`, readError);
        }
      }
      
      // Check for auth_info.json in old auth folder
      const authInfoPath = path.join(this.authFolder, 'auth_info.json');
      if (fs.existsSync(authInfoPath)) {
        try {
          // Try to read and parse auth_info.json
          const authInfoData = fs.readFileSync(authInfoPath, 'utf8');
          const authInfo = JSON.parse(authInfoData);
          
          if (authInfo && authInfo.credentials) {
            return true;
          }
        } catch (readError) {
          console.error(`[BaileysAuth:${this.instanceId}] Error reading auth_info.json:`, readError);
        }
      }
      
      // Check for auth files in the Baileys auth folder
      const files = fs.readdirSync(this.baileysAuthFolder);
      // For multi-file auth, there should be multiple files
      if (files.length > 1) {
        // Look for key files that should exist in a valid auth state
        const hasAuthFiles = files.some(file => 
          file === 'creds.json' || file.endsWith('.key') || file.includes('app-state')
        );
        
        if (hasAuthFiles) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error checking auth:`, error);
      return false;
    }
  }
  
  /**
   * Clear auth credentials
   * @returns {Promise<boolean>} - Whether clearing was successful
   */
  async clearAuth() {
    try {
      // Clean Baileys auth folder
      if (fs.existsSync(this.baileysAuthFolder)) {
        const files = fs.readdirSync(this.baileysAuthFolder);
        for (const file of files) {
          fs.unlinkSync(path.join(this.baileysAuthFolder, file));
        }
      }
      
      // Clean old auth folder
      if (fs.existsSync(this.authFolder)) {
        const files = fs.readdirSync(this.authFolder);
        for (const file of files) {
          fs.unlinkSync(path.join(this.authFolder, file));
        }
      }
      
      console.log(`[BaileysAuth:${this.instanceId}] Auth data cleared successfully`);
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error clearing auth:`, error);
      return false;
    }
  }
}

module.exports = BaileysAuth;
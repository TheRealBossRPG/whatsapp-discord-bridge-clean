// modules/clients/baileys/BaileysAuth.js
const fs = require('fs');
const path = require('path');

/**
 * Handles WhatsApp authentication
 */
class BaileysAuth {
  /**
   * Create a new Baileys auth handler
   * @param {Object} options - Auth options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', '..', 'auth');
    this.baileysAuthFolder = options.baileysAuthFolder || path.join(this.authFolder, 'baileys_auth');
    
    // Create auth folders if they don't exist
    this.ensureAuthFolders();
    
    // Will be set from BaileysClient
    this.saveCreds = null;
    
    console.log(`[BaileysAuth:${this.instanceId}] Auth handler initialized with auth folder: ${this.authFolder}, baileys folder: ${this.baileysAuthFolder}`);
  }
  
  /**
   * Ensure auth folders exist
   */
  ensureAuthFolders() {
    // Create auth folder if it doesn't exist
    if (!fs.existsSync(this.authFolder)) {
      fs.mkdirSync(this.authFolder, { recursive: true });
    }
    
    // Create Baileys auth folder if it doesn't exist
    if (!fs.existsSync(this.baileysAuthFolder)) {
      fs.mkdirSync(this.baileysAuthFolder, { recursive: true });
    }
  }
  
  /**
   * Set the save credentials function
   * @param {function} saveCredsFunction - Function to save credentials
   */
  setSaveCredsFunction(saveCredsFunction) {
    this.saveCreds = saveCredsFunction;
  }
  
  /**
   * Handle connection update
   * @param {Object} update - Connection update
   */
  handleConnectionUpdate(update) {
    try {
      const { connection } = update;
      
      if (connection === 'open') {
        console.log(`[BaileysAuth:${this.instanceId}] Connection opened, saving credentials`);
        
        // Save success marker
        this.saveAuthSuccess();
      }
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error handling connection update: ${error.message}`);
    }
  }
  
  /**
   * Save authentication success marker
   */
  saveAuthSuccess() {
    try {
      const successFile = path.join(this.authFolder, 'auth_success');
      
      // Save timestamp
      const timestamp = new Date().toISOString();
      fs.writeFileSync(successFile, timestamp);
      
      console.log(`[BaileysAuth:${this.instanceId}] Auth success marker saved: ${timestamp}`);
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error saving auth success marker: ${error.message}`);
    }
  }
  
  /**
   * Check if authenticated
   * @returns {Promise<boolean>} - Whether authenticated
   */
  async isAuthenticated() {
    try {
      // Check if auth_success file exists
      const successFile = path.join(this.authFolder, 'auth_success');
      
      if (fs.existsSync(successFile)) {
        return true;
      }
      
      // Check if Baileys auth folder has files
      try {
        const files = fs.readdirSync(this.baileysAuthFolder);
        
        if (files.length > 0) {
          return true;
        }
      } catch (error) {
        console.error(`[BaileysAuth:${this.instanceId}] Error checking baileys auth folder: ${error.message}`);
      }
      
      return false;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error checking auth status: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Delete all auth files
   * @returns {Promise<boolean>} - Whether deletion was successful
   */
  async deleteAuthFiles() {
    try {
      console.log(`[BaileysAuth:${this.instanceId}] Deleting auth files...`);
      
      // Delete auth_success file
      const successFile = path.join(this.authFolder, 'auth_success');
      if (fs.existsSync(successFile)) {
        fs.unlinkSync(successFile);
      }
      
      // Delete Baileys auth folder contents
      if (fs.existsSync(this.baileysAuthFolder)) {
        const files = fs.readdirSync(this.baileysAuthFolder);
        
        for (const file of files) {
          const filePath = path.join(this.baileysAuthFolder, file);
          
          if (fs.lstatSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        }
      }
      
      console.log(`[BaileysAuth:${this.instanceId}] Auth files deleted successfully`);
      return true;
    } catch (error) {
      console.error(`[BaileysAuth:${this.instanceId}] Error deleting auth files: ${error.message}`);
      return false;
    }
  }
}

module.exports = BaileysAuth;
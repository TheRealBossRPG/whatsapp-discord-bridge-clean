// utils/setupStorage.js - Storage for setup parameters
const fs = require('fs');
const path = require('path');

/**
 * Initialize setup storage functions
 */
function initializeSetupStorage() {
  // Create storage directory if it doesn't exist
  const storageDir = path.join(__dirname, '..', 'setup_storage');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  
  // Add setup storage functions to global scope for easy access
  global.setupStorage = {
    /**
     * Save setup parameters
     * @param {string} guildId - Guild ID
     * @param {Object} params - Setup parameters
     * @returns {boolean} Success
     */
    saveSetupParams: function(guildId, params) {
      try {
        const filePath = path.join(storageDir, `${guildId}_setup.json`);
        
        // Ensure we aren't overwriting existing parameters if only partial update
        let existingParams = {};
        if (fs.existsSync(filePath)) {
          try {
            existingParams = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          } catch (e) {
            console.error(`Error reading existing setup parameters for guild ${guildId}:`, e);
          }
        }
        
        // Merge existing with new parameters
        const mergedParams = { ...existingParams, ...params };
        
        fs.writeFileSync(filePath, JSON.stringify(mergedParams, null, 2), 'utf8');
        console.log(`Saved setup parameters for guild ${guildId}`);
        
        return true;
      } catch (error) {
        console.error(`Error saving setup parameters for guild ${guildId}:`, error);
        return false;
      }
    },
    
    /**
     * Get setup parameters
     * @param {string} guildId - Guild ID
     * @returns {Object|null} Setup parameters
     */
    getSetupParams: function(guildId) {
      const filePath = path.join(storageDir, `${guildId}_setup.json`);
      if (fs.existsSync(filePath)) {
        try {
          const params = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          console.log(`Retrieved setup parameters for guild ${guildId}`);
          return params;
        } catch (error) {
          console.error(`Error reading setup parameters for guild ${guildId}:`, error);
          return null;
        }
      }
      return null;
    },
    
    /**
     * Clean up setup parameters
     * @param {string} guildId - Guild ID
     * @returns {boolean} Success
     */
    cleanupSetupParams: function(guildId) {
      const filePath = path.join(storageDir, `${guildId}_setup.json`);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`Cleaned up setup parameters for guild ${guildId}`);
          return true;
        } catch (error) {
          console.error(`Error cleaning up setup parameters for guild ${guildId}:`, error);
          return false;
        }
      }
      return true; // Already clean
    },
    
    /**
     * Update a specific setup parameter
     * @param {string} guildId - Guild ID
     * @param {string} key - Parameter key
     * @param {any} value - Parameter value
     * @returns {boolean} Success
     */
    updateSetupParams: function(guildId, key, value) {
      try {
        const params = this.getSetupParams(guildId) || {};
        params[key] = value;
        return this.saveSetupParams(guildId, params);
      } catch (error) {
        console.error(`Error updating setup parameter ${key} for guild ${guildId}:`, error);
        return false;
      }
    },
    
    /**
     * List all setup parameters for all guilds
     * @returns {Object} Map of guild IDs to parameters
     */
    listAllSetupParams: function() {
      try {
        const files = fs.readdirSync(storageDir)
          .filter(file => file.endsWith('_setup.json'));
        
        const allParams = {};
        
        for (const file of files) {
          try {
            const guildId = file.replace('_setup.json', '');
            const params = JSON.parse(fs.readFileSync(path.join(storageDir, file), 'utf8'));
            allParams[guildId] = params;
          } catch (error) {
            console.error(`Error reading setup file ${file}:`, error);
          }
        }
        
        return allParams;
      } catch (error) {
        console.error('Error listing setup parameters:', error);
        return {};
      }
    }
  };
  
  // Initialize global variable for custom settings
  global.lastCustomSettings = null;
  
  console.log('Setup storage initialized');
  
  return global.setupStorage;
}

module.exports = initializeSetupStorage;
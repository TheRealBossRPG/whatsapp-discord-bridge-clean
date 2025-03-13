// modules/channelManager.js - FIXED VERSION
const fs = require('fs');
const path = require('path');

class ChannelManager {
  constructor(instanceId) {
    this.instanceId = instanceId || 'default';
    this.channelMap = new Map();
    
    // FIXED: Use more reliable path calculation
    const baseDir = instanceId 
      ? path.join(__dirname, '..', 'instances', instanceId)
      : path.join(__dirname, '..');
    
    // Instance-specific file path
    this.filePath = path.join(baseDir, 'channel_map.json');
    
    // Ensure the directory exists
    const dirPath = path.dirname(this.filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Log initialization
    console.log(`[ChannelManager] Initialized with instance ID: ${this.instanceId}`);
    console.log(`[ChannelManager] Using file path: ${this.filePath}`);
    
    this.loadChannelMap();
  }
  
  // Save channel mappings to file
  saveChannelMap() {
    try {
      // Convert Map to an object for serialization
      const mapObj = {};
      this.channelMap.forEach((channelId, number) => {
        mapObj[number] = channelId;
      });
      
      fs.writeFileSync(this.filePath, JSON.stringify(mapObj, null, 2), 'utf8');
      console.log(`[ChannelManager] Saved ${this.channelMap.size} channel mappings to ${this.filePath}`);
    } catch (error) {
      console.error(`[ChannelManager] Error saving channel map: ${error.message}`);
      // Try to create backup of the channel map in case of file write errors
      try {
        const backupPath = `${this.filePath}.backup`;
        const mapObj = {};
        this.channelMap.forEach((channelId, number) => {
          mapObj[number] = channelId;
        });
        fs.writeFileSync(backupPath, JSON.stringify(mapObj, null, 2), 'utf8');
        console.log(`[ChannelManager] Created backup of channel map at ${backupPath}`);
      } catch (backupError) {
        console.error(`[ChannelManager] Error creating backup: ${backupError.message}`);
      }
    }
  }
  
  // Load channel mappings from file
  loadChannelMap() {
    try {
      // First try to load the regular file
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.channelMap = new Map();
        
        // Convert object to Map
        Object.entries(data).forEach(([number, channelId]) => {
          this.channelMap.set(this.normalizePhoneNumber(number), channelId);
        });
        
        console.log(`[ChannelManager] Loaded ${this.channelMap.size} channel mappings from ${this.filePath}`);
      } 
      // If regular file doesn't exist, try to load backup
      else if (fs.existsSync(`${this.filePath}.backup`)) {
        console.log(`[ChannelManager] Main file not found, trying to load from backup`);
        const data = JSON.parse(fs.readFileSync(`${this.filePath}.backup`, 'utf8'));
        this.channelMap = new Map();
        
        // Convert object to Map
        Object.entries(data).forEach(([number, channelId]) => {
          this.channelMap.set(this.normalizePhoneNumber(number), channelId);
        });
        
        console.log(`[ChannelManager] Loaded ${this.channelMap.size} channel mappings from backup`);
        
        // Save the recovered data to the main file
        this.saveChannelMap();
      }
      // No file exists, create new empty one
      else {
        console.log(`[ChannelManager] No channel map file found at ${this.filePath}, starting with empty map`);
        this.channelMap = new Map();
        // Create empty file
        fs.writeFileSync(this.filePath, '{}', 'utf8');
        console.log(`[ChannelManager] Created empty channel map file at ${this.filePath}`);
      }
    } catch (error) {
      console.error(`[ChannelManager] Error loading channel map: ${error.message}`);
      this.channelMap = new Map();
      
      // Create empty file if it doesn't exist
      if (!fs.existsSync(this.filePath)) {
        try {
          fs.writeFileSync(this.filePath, '{}', 'utf8');
          console.log(`[ChannelManager] Created empty channel map file at ${this.filePath}`);
        } catch (writeError) {
          console.error(`[ChannelManager] Error creating empty channel map file: ${writeError.message}`);
        }
      }
    }
  }
  
  // FIXED: Helper method to normalize phone numbers
  normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return 'unknown';
    
    // Remove WhatsApp extensions if present
    let normalized = String(phoneNumber).replace(/@.*$/, '');
    
    // Ensure it's a string
    normalized = String(normalized);
    
    // Clean up any other formatting issues
    normalized = normalized.trim();
    
    return normalized;
  }
  
  getWhatsAppNumberByChannelId(channelId) {
    if (!channelId) {
      console.error(`[ChannelManager] getWhatsAppNumberByChannelId called with empty channelId`);
      return null;
    }
    
    for (const [number, id] of this.channelMap.entries()) {
      if (id === channelId) {
        console.log(`[ChannelManager] Found WhatsApp number ${number} for channel ID: ${channelId}`);
        return number;
      }
    }
    
    console.log(`[ChannelManager] No WhatsApp number found for channel ID: ${channelId}`);
    return null;
  }
  
  getChannelIdByPhoneNumber(phoneNumber) {
    // Normalize the phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    
    // Check if we have a mapping
    const channelId = this.channelMap.get(phoneNumber);
    
    if (channelId) {
      console.log(`[ChannelManager] Found channel ID ${channelId} for phone: ${phoneNumber}`);
    } else {
      console.log(`[ChannelManager] No channel found for phone: ${phoneNumber}`);
    }
    
    return channelId;
  }
  
  setChannelMapping(phoneNumber, channelId) {
    // Validate inputs
    if (!phoneNumber) {
      console.error(`[ChannelManager] setChannelMapping called with empty phoneNumber`);
      return;
    }
    
    if (!channelId) {
      console.error(`[ChannelManager] setChannelMapping called with empty channelId`);
      return;
    }
    
    // Normalize the phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    
    this.channelMap.set(phoneNumber, channelId);
    this.saveChannelMap();
    console.log(`[ChannelManager] Set mapping: ${phoneNumber} -> ${channelId}`);
  }
  
  removeChannelMapping(phoneNumber) {
    // Normalize the phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    
    if (this.channelMap.has(phoneNumber)) {
      const channelId = this.channelMap.get(phoneNumber);
      this.channelMap.delete(phoneNumber);
      this.saveChannelMap();
      console.log(`[ChannelManager] Removed mapping for: ${phoneNumber} (was ${channelId})`);
      return true;
    }
    
    console.log(`[ChannelManager] No mapping found for: ${phoneNumber}`);
    return false;
  }
  
  getChannelMapSize() {
    return this.channelMap.size;
  }
  
  /**
   * Get all channel mappings
   * @returns {Array} - Array of {phoneNumber, channelId} objects
   */
  getAllMappings() {
    const mappings = [];
    for (const [phoneNumber, channelId] of this.channelMap.entries()) {
      mappings.push({ phoneNumber, channelId });
    }
    return mappings;
  }
  
  /**
   * Check if a channel is mapped to any phone number
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} - True if channel is mapped
   */
  isChannelMapped(channelId) {
    for (const id of this.channelMap.values()) {
      if (id === channelId) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Remove mapping by channel ID
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} - Success status
   */
  removeChannelMappingByChannelId(channelId) {
    for (const [phoneNumber, id] of this.channelMap.entries()) {
      if (id === channelId) {
        this.channelMap.delete(phoneNumber);
        this.saveChannelMap();
        console.log(`[ChannelManager] Removed mapping for channel: ${channelId} (was mapped to ${phoneNumber})`);
        return true;
      }
    }
    console.log(`[ChannelManager] No mapping found for channel: ${channelId}`);
    return false;
  }
  
  /**
   * Clear all channel mappings
   * @returns {number} - Number of mappings cleared
   */
  clearAllMappings() {
    const count = this.channelMap.size;
    this.channelMap.clear();
    this.saveChannelMap();
    console.log(`[ChannelManager] Cleared all ${count} channel mappings`);
    return count;
  }
}

module.exports = ChannelManager;
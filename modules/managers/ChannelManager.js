// modules/managers/ChannelManager.js
const fs = require('fs');
const path = require('path');

/**
 * ChannelManager - Handles mapping between WhatsApp users and Discord channels
 */
class ChannelManager {
  /**
   * Create a new channel manager
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId = 'default') {
    this.instanceId = instanceId;
    this.channelMap = new Map();
    this.whatsAppClient = null;
    this.specialChannels = {};
    
    // Set storage paths
    this.baseDir = path.join(__dirname, '..', '..', 'instances', instanceId);
    this.channelMapPath = path.join(this.baseDir, 'channel_map.json');
    
    // Ensure directory exists
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    
    // Load channel map from disk
    this.loadChannelMap();
    
    console.log(`[ChannelManager:${instanceId}] Initialized with ${this.channelMap.size} channels`);
  }
  
  /**
   * Set WhatsApp client
   * @param {Object} client - WhatsApp client
   */
  setWhatsAppClient(client) {
    this.whatsAppClient = client;
  }
  
  /**
   * Get WhatsApp client
   * @returns {Object} - WhatsApp client
   */
  getWhatsAppClient() {
    return this.whatsAppClient;
  }
  
  /**
   * Set special channels map
   * @param {Object} specialChannels - Special channels map
   */
  setSpecialChannels(specialChannels) {
    this.specialChannels = specialChannels || {};
  }
  
  /**
   * Get special channels map
   * @returns {Object} - Special channels map
   */
  getSpecialChannels() {
    return this.specialChannels;
  }
  
  /**
   * Clean phone number for consistent storage
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} - Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return 'unknown';
    
    // Convert to string first
    let clean = String(phoneNumber);
    
    // Remove WhatsApp extensions (be thorough)
    clean = clean.replace(/@s\.whatsapp\.net/g, '')
                .replace(/@c\.us/g, '')
                .replace(/@g\.us/g, '')
                .replace(/@broadcast/g, '')
                .replace(/@.*$/, '');
    
    // Remove any non-digit characters except possibly leading '+' sign
    if (clean.startsWith('+')) {
      clean = '+' + clean.substring(1).replace(/[^0-9]/g, '');
    } else {
      clean = clean.replace(/[^0-9]/g, '');
    }
    
    return clean;
  }
  
  /**
   * Format phone number consistently
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    const clean = this.cleanPhoneNumber(phoneNumber);
    
    // Make sure it has the WhatsApp suffix if not already present
    if (!phoneNumber.includes('@')) {
      return `${clean}@s.whatsapp.net`;
    }
    
    return phoneNumber;
  }
  
  /**
   * Load channel map from disk
   */
  loadChannelMap() {
    try {
      if (fs.existsSync(this.channelMapPath)) {
        const mapData = JSON.parse(fs.readFileSync(this.channelMapPath, 'utf8'));
        
        // Convert to Map object
        Object.entries(mapData).forEach(([phone, channelId]) => {
          this.channelMap.set(this.formatPhoneNumber(phone), channelId);
        });
        
        console.log(`[ChannelManager:${this.instanceId}] Loaded ${this.channelMap.size} channels from ${this.channelMapPath}`);
      } else {
        console.log(`[ChannelManager:${this.instanceId}] No channel map file found at ${this.channelMapPath}`);
      }
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error loading channel map:`, error);
    }
  }
  
  /**
   * Save channel map to disk
   */
  saveChannelMap() {
    try {
      // Convert Map to regular object for JSON serialization
      const mapData = {};
      this.channelMap.forEach((channelId, phone) => {
        mapData[phone] = channelId;
      });
      
      // Ensure directory exists
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      
      // Write to file
      fs.writeFileSync(this.channelMapPath, JSON.stringify(mapData, null, 2), 'utf8');
      
      console.log(`[ChannelManager:${this.instanceId}] Saved ${this.channelMap.size} channels to ${this.channelMapPath}`);
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error saving channel map:`, error);
    }
  }

  /**
 * Synchronize channel data with WhatsApp
 */
syncWithWhatsApp() {
  try {
    console.log(`[ChannelManager:${this.instanceId}] Synchronizing channels with WhatsApp client`);
    
    // This is a stub function to prevent errors
    // Implement with actual synchronization logic if needed
    
    // Basic implementation: just load existing channel map
    this.loadChannelMap();
    
    console.log(`[ChannelManager:${this.instanceId}] Channel synchronization complete`);
    return true;
  } catch (error) {
    console.error(`[ChannelManager:${this.instanceId}] Error synchronizing with WhatsApp:`, error);
    return false;
  }
}
  
  /**
   * Set channel for phone number
   * @param {string} phoneNumber - Phone number
   * @param {string} channelId - Discord channel ID
   */
  setChannel(phoneNumber, channelId) {
    // Format phone number
    const phone = this.formatPhoneNumber(phoneNumber);
    
    // Update map
    this.channelMap.set(phone, channelId);
    
    // Save to disk
    this.saveChannelMap();
    
    console.log(`[ChannelManager:${this.instanceId}] Set channel ${channelId} for ${phone}`);
  }
  
  /**
   * Get channel ID for phone number
   * @param {string} phoneNumber - Phone number
   * @returns {string|null} - Discord channel ID or null if not found
   */
  getChannelId(phoneNumber) {
    // Format phone number
    const phone = this.formatPhoneNumber(phoneNumber);
    
    // Get from map
    return this.channelMap.get(phone) || null;
  }
  
  /**
   * Check if channel exists for phone number
   * @param {string} phoneNumber - Phone number
   * @returns {boolean} - Whether channel exists
   */
  channelExists(phoneNumber) {
    // Format phone number
    const phone = this.formatPhoneNumber(phoneNumber);
    
    // Check if in map
    return this.channelMap.has(phone);
  }
  
  /**
   * Get phone number from channel ID
   * @param {string} channelId - Discord channel ID
   * @returns {string|null} - Phone number or null if not found
   */
  getPhoneNumber(channelId) {
    // Iterate through map to find matching channel ID
    for (const [phone, id] of this.channelMap.entries()) {
      if (id === channelId) {
        return phone;
      }
    }
    
    return null;
  }
  
  /**
   * Remove channel for phone number
   * @param {string} phoneNumber - Phone number
   */
  removeChannel(phoneNumber) {
    // Format phone number
    const phone = this.formatPhoneNumber(phoneNumber);
    
    // Remove from map
    this.channelMap.delete(phone);
    
    // Save to disk
    this.saveChannelMap();
    
    console.log(`[ChannelManager:${this.instanceId}] Removed channel for ${phone}`);
  }
  
  /**
   * Get channel map size
   * @returns {number} - Number of mapped channels
   */
  getChannelMapSize() {
    return this.channelMap.size;
  }
  
  /**
   * Clear all channels
   */
  clearAllChannels() {
    // Clear map
    this.channelMap.clear();
    
    // Save to disk
    this.saveChannelMap();
    
    console.log(`[ChannelManager:${this.instanceId}] Cleared all channels`);
  }
  
  /**
   * Get all channels
   * @returns {Map} - Map of phone numbers to channel IDs
   */
  getAllChannels() {
    return new Map(this.channelMap);
  }
}

module.exports = ChannelManager;
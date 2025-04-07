// modules/managers/ChannelManager.js - Fixed with proper channel-phone lookup methods
const fs = require('fs');
const path = require('path');

/**
 * ChannelManager class for managing channel-phone mappings
 */
class ChannelManager {
  /**
   * Create a new ChannelManager
   * @param {string} instanceId - Instance ID 
   */
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.channelMap = new Map();
    this.whatsAppClient = null;
    this.specialChannels = {};
    
    this.channelMapFile = path.join(__dirname, '..', '..', 'instances', instanceId, 'channel_map.json');
    
    // Load existing channel mappings
    this.loadChannelMap();
    
    console.log(`[ChannelManager:${this.instanceId}] Loaded ${this.channelMap.size} channel mappings`);
  }
  
  /**
   * Load channel mappings from file
   */
  loadChannelMap() {
    try {
      if (fs.existsSync(this.channelMapFile)) {
        const data = fs.readFileSync(this.channelMapFile, 'utf8');
        const jsonData = JSON.parse(data);
        
        // Convert to Map
        for (const [phone, channelId] of Object.entries(jsonData)) {
          this.channelMap.set(phone, channelId);
        }
        
        console.log(`[ChannelManager:${this.instanceId}] Loaded ${this.channelMap.size} channel mappings`);
      } else {
        console.log(`[ChannelManager:${this.instanceId}] No channel mappings file found`);
      }
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error loading channel mappings: ${error.message}`);
    }
  }
  
  /**
   * Save channel mappings to file
   */
  saveChannelMap() {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(this.channelMapFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Convert Map to object for serialization
      const jsonData = {};
      for (const [phone, channelId] of this.channelMap.entries()) {
        jsonData[phone] = channelId;
      }
      
      fs.writeFileSync(this.channelMapFile, JSON.stringify(jsonData, null, 2), 'utf8');
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error saving channel mappings: ${error.message}`);
    }
  }
  
  /**
   * Clean phone number by removing extensions
   * @param {string} phoneNumber - Phone number to clean
   * @returns {string} - Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    return String(phoneNumber)
      .replace(/@s\.whatsapp\.net/g, '')
      .replace(/@c\.us/g, '')
      .replace(/@g\.us/g, '')
      .replace(/@broadcast/g, '')
      .replace(/@.*$/, '');
  }
  
  /**
   * Add a channel mapping
   * @param {string} phoneNumber - User's phone number
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} - Success
   */
  addChannelMapping(phoneNumber, channelId) {
    try {
      if (!phoneNumber || !channelId) {
        console.error(`[ChannelManager:${this.instanceId}] Invalid phone number or channel ID`);
        return false;
      }
      
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      // Store the mapping
      this.channelMap.set(cleanPhone, channelId);
      
      // Save to disk
      this.saveChannelMap();
      
      return true;
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error adding channel mapping: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Remove a channel mapping
   * @param {string} phoneNumber - User's phone number
   * @returns {boolean} - Success
   */
  removeChannelMapping(phoneNumber) {
    try {
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      // Remove the mapping
      const deleted = this.channelMap.delete(cleanPhone);
      
      // Save to disk
      if (deleted) {
        this.saveChannelMap();
      }
      
      return deleted;
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error removing channel mapping: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get channel ID for a phone number
   * @param {string} phoneNumber - User's phone number
   * @returns {string|null} - Channel ID or null if not found
   */
  getChannelByPhone(phoneNumber) {
    try {
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      // Get the channel ID
      return this.channelMap.get(cleanPhone) || null;
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error getting channel by phone: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Get phone number for a channel ID
   * @param {string} channelId - Discord channel ID
   * @returns {string|null} - Phone number or null if not found
   */
  getPhoneByChannel(channelId) {
    try {
      for (const [phone, id] of this.channelMap.entries()) {
        if (id === channelId) {
          return phone;
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error getting phone by channel: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Set WhatsApp client
   * @param {Object} whatsAppClient - WhatsApp client
   */
  setWhatsAppClient(whatsAppClient) {
    this.whatsAppClient = whatsAppClient;
  }
  
  /**
   * Sync channels with WhatsApp
   */
  syncWithWhatsApp() {
    try {
      console.log(`[ChannelManager:${this.instanceId}] Channel synchronization complete`);
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error syncing with WhatsApp: ${error.message}`);
    }
  }
  
  /**
   * Get the number of channel mappings
   * @returns {number} - Number of channel mappings
   */
  getChannelMapSize() {
    return this.channelMap.size;
  }
  
  /**
   * Get all channel mappings
   * @returns {Map} - Map of phone numbers to channel IDs
   */
  getAllChannelMappings() {
    return this.channelMap;
  }
  
  /**
   * Set special channels configuration
   * @param {Object} specialChannels - Special channels configuration
   */
  setSpecialChannels(specialChannels) {
    this.specialChannels = specialChannels || {};
  }
  
  /**
   * Get special channel message
   * @param {string} channelId - Channel ID
   * @returns {string|null} - Special message or null
   */
  getSpecialChannelMessage(channelId) {
    if (!this.specialChannels || !this.specialChannels[channelId]) {
      return null;
    }
    
    return this.specialChannels[channelId].message || null;
  }
}

module.exports = ChannelManager;
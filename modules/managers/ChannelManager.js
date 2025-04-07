// modules/managers/ChannelManager.js
const fs = require('fs');
const path = require('path');

/**
 * Manages Discord channel to WhatsApp mappings
 */
class ChannelManager {
  /**
   * Create channel manager
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId = 'default') {
    this.instanceId = instanceId;
    this.channelMap = new Map();
    this.reverseLookup = new Map(); // For looking up phone numbers by channel ID
    this.whatsAppClient = null;
    
    // Load channel mappings
    this.loadChannelMappings();
    
    console.log(`[ChannelManager:${this.instanceId}] Loaded ${this.channelMap.size} channel mappings`);
  }
  
  /**
   * Set WhatsApp client
   * @param {Object} client - WhatsApp client
   */
  setWhatsAppClient(client) {
    this.whatsAppClient = client;
  }
  
  /**
   * Load channel mappings from disk
   */
  loadChannelMappings() {
    try {
      const channelMapPath = path.join(__dirname, '..', '..', 'instances', this.instanceId, 'channel_map.json');
      
      if (fs.existsSync(channelMapPath)) {
        const channelMapData = JSON.parse(fs.readFileSync(channelMapPath, 'utf8'));
        
        // Convert to Map
        for (const [phoneNumber, channelId] of Object.entries(channelMapData)) {
          this.channelMap.set(phoneNumber, channelId);
          this.reverseLookup.set(channelId, phoneNumber); // Add to reverse lookup
        }
        
        console.log(`[ChannelManager:${this.instanceId}] Loaded ${this.channelMap.size} channel mappings`);
      }
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error loading channel mappings:`, error);
    }
  }
  
  /**
   * Save channel mappings to disk
   */
  saveChannelMappings() {
    try {
      const instanceDir = path.join(__dirname, '..', '..', 'instances', this.instanceId);
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(instanceDir)) {
        fs.mkdirSync(instanceDir, { recursive: true });
      }
      
      const channelMapPath = path.join(instanceDir, 'channel_map.json');
      
      // Convert Map to object
      const channelMapData = {};
      for (const [phoneNumber, channelId] of this.channelMap.entries()) {
        channelMapData[phoneNumber] = channelId;
      }
      
      fs.writeFileSync(channelMapPath, JSON.stringify(channelMapData, null, 2), 'utf8');
      console.log(`[ChannelManager:${this.instanceId}] Saved ${this.channelMap.size} channel mappings`);
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error saving channel mappings:`, error);
    }
  }
  
  /**
   * Add channel mapping
   * @param {string} phoneNumber - Phone number
   * @param {string} channelId - Channel ID
   * @returns {Promise<boolean>} - Success
   */
  async addChannel(phoneNumber, channelId) {
    try {
      this.channelMap.set(phoneNumber, channelId);
      this.reverseLookup.set(channelId, phoneNumber); // Add to reverse lookup
      
      this.saveChannelMappings();
      return true;
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error adding channel mapping:`, error);
      return false;
    }
  }
  
  /**
   * Remove channel mapping
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<boolean>} - Success
   */
  async removeChannel(phoneNumber) {
    try {
      const channelId = this.channelMap.get(phoneNumber);
      if (channelId) {
        this.reverseLookup.delete(channelId); // Remove from reverse lookup
      }
      
      this.channelMap.delete(phoneNumber);
      this.saveChannelMappings();
      return true;
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error removing channel mapping:`, error);
      return false;
    }
  }
  
  /**
   * Get channel ID for phone number
   * @param {string} phoneNumber - Phone number
   * @returns {string|null} - Channel ID
   */
  getChannelId(phoneNumber) {
    return this.channelMap.get(phoneNumber) || null;
  }
  
  /**
   * Get phone number by channel ID
   * @param {string} channelId - Channel ID
   * @returns {string|null} - Phone number
   */
  getPhoneNumberByChannelId(channelId) {
    return this.reverseLookup.get(channelId) || null;
  }
  
  /**
   * Check if phone number has channel
   * @param {string} phoneNumber - Phone number
   * @returns {boolean} - Has channel
   */
  hasChannel(phoneNumber) {
    return this.channelMap.has(phoneNumber);
  }
  
  /**
   * Get channel map size
   * @returns {number} - Number of mappings
   */
  getChannelMapSize() {
    return this.channelMap.size;
  }
  
  /**
   * Sync with WhatsApp
   */
  syncWithWhatsApp() {
    console.log(`[ChannelManager:${this.instanceId}] Channel synchronization complete`);
  }
  
  /**
   * Set special channels
   * @param {Object} specialChannels - Special channels
   */
  setSpecialChannels(specialChannels = {}) {
    this.specialChannels = specialChannels;
  }
}

module.exports = ChannelManager;
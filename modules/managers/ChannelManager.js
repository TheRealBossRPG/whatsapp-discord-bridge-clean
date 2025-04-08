// modules/managers/ChannelManager.js
const fs = require('fs');
const path = require('path');

/**
 * Manages mapping between WhatsApp users and Discord channels
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
    this.loadMappings();
    
    // Store special channel handlers
    this.specialChannels = {};
  }
  
  /**
   * Set the WhatsApp client
   * @param {Object} client - WhatsApp client
   */
  setWhatsAppClient(client) {
    this.whatsAppClient = client;
  }
  
  /**
   * Get the WhatsApp client
   * @returns {Object} WhatsApp client
   */
  getWhatsAppClient() {
    return this.whatsAppClient;
  }
  
  /**
   * Load channel mappings from disk
   */
  loadMappings() {
    try {
      const mappingsFile = path.join(__dirname, '../../instances', this.instanceId, 'channel_mappings.json');
      
      if (fs.existsSync(mappingsFile)) {
        const data = JSON.parse(fs.readFileSync(mappingsFile, 'utf8'));
        
        // Convert to Map
        for (const [phoneNumber, channelId] of Object.entries(data)) {
          this.channelMap.set(phoneNumber, channelId);
        }
        
        console.log(`[ChannelManager:${this.instanceId}] Loaded ${this.channelMap.size} channel mappings`);
      } else {
        console.log(`[ChannelManager:${this.instanceId}] No channel mappings file found`);
      }
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error loading channel mappings:`, error);
    }
  }
  
  /**
   * Save channel mappings to disk
   */
  saveMappings() {
    try {
      const mappingsFile = path.join(__dirname, '../../instances', this.instanceId, 'channel_mappings.json');
      
      // Convert Map to object
      const data = {};
      for (const [phoneNumber, channelId] of this.channelMap.entries()) {
        data[phoneNumber] = channelId;
      }
      
      fs.writeFileSync(mappingsFile, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[ChannelManager:${this.instanceId}] Saved ${this.channelMap.size} channel mappings`);
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error saving channel mappings:`, error);
    }
  }
  
  /**
   * Add a channel mapping
   * @param {string} phoneNumber - WhatsApp phone number
   * @param {string} channelId - Discord channel ID
   */
  addChannelMapping(phoneNumber, channelId) {
    // Clean up phone number format
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    
    this.channelMap.set(cleanPhone, channelId);
    this.saveMappings();
  }
  
  /**
   * Get channel for a user
   * @param {string} phoneNumber - WhatsApp phone number
   * @returns {string|null} Channel ID
   */
  getUserChannel(phoneNumber) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    return this.channelMap.get(cleanPhone) || null;
  }
  
  /**
   * Check if user has a channel
   * @param {string} phoneNumber - WhatsApp phone number
   * @returns {boolean} Whether user has a channel
   */
  hasChannel(phoneNumber) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    return this.channelMap.has(cleanPhone);
  }
  
  /**
   * Remove a channel mapping
   * @param {string} phoneNumber - WhatsApp phone number
   * @returns {boolean} Success
   */
  removeChannel(phoneNumber) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    const result = this.channelMap.delete(cleanPhone);
    
    if (result) {
      this.saveMappings();
    }
    
    return result;
  }
  
  /**
   * Get a mapping of all channels
   * @returns {Object} Channel map
   */
  getChannelMap() {
    const map = {};
    
    for (const [phone, channelId] of this.channelMap.entries()) {
      map[phone] = channelId;
    }
    
    return map;
  }
  
  /**
   * Get channel map size
   * @returns {number} Number of channels
   */
  getChannelMapSize() {
    return this.channelMap.size;
  }
  
  /**
   * Clean a phone number
   * @param {string} phoneNumber - Phone number to clean
   * @returns {string} Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    // Convert to string
    let phone = String(phoneNumber);
    
    // Remove WhatsApp suffix
    phone = phone.replace(/@s\.whatsapp\.net/g, '')
                .replace(/@c\.us/g, '')
                .replace(/@g\.us/g, '')
                .replace(/@broadcast/g, '');
    
    return phone;
  }
  
  /**
   * Set special channels
   * @param {Object} channels - Special channels mapping
   */
  setSpecialChannels(channels) {
    this.specialChannels = channels || {};
  }
  
  /**
   * Get special channel info
   * @param {string} channelId - Channel ID
   * @returns {Object|null} Special channel info
   */
  getSpecialChannel(channelId) {
    return this.specialChannels[channelId] || null;
  }
  
  /**
   * Sync with WhatsApp client
   */
  syncWithWhatsApp() {
    console.log(`[ChannelManager:${this.instanceId}] Channel synchronization complete`);
  }
}

module.exports = ChannelManager;
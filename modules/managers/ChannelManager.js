// modules/managers/ChannelManager.js - Fixed channel management
const fs = require('fs');
const path = require('path');

/**
 * Manages channel mappings between WhatsApp and Discord
 */
class ChannelManager {
  /**
   * Create a new channel manager
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId = 'default') {
    this.instanceId = instanceId;
    this.baseDir = path.join(__dirname, '../../instances', instanceId);
    this.channelMapPath = path.join(this.baseDir, 'channel_map.json');
    this.phoneToChannel = new Map();
    this.channelToPhone = new Map();
    this.whatsAppClient = null;
    this.specialChannels = {};
    
    // Create base directory if it doesn't exist
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    
    // Load channel mappings
    this.loadChannelMap();
  }
  
  /**
   * Set WhatsApp client
   * @param {Object} whatsAppClient - WhatsApp client
   */
  setWhatsAppClient(whatsAppClient) {
    this.whatsAppClient = whatsAppClient;
  }
  
  /**
   * Set special channels configuration
   * @param {Object} specialChannels - Special channels object
   */
  setSpecialChannels(specialChannels) {
    this.specialChannels = specialChannels || {};
  }
  
  /**
   * Load channel mappings from file
   */
  loadChannelMap() {
    try {
      if (fs.existsSync(this.channelMapPath)) {
        const data = fs.readFileSync(this.channelMapPath, 'utf8');
        const mappings = JSON.parse(data);
        
        // Clear existing maps
        this.phoneToChannel.clear();
        this.channelToPhone.clear();
        
        // Load mappings into maps
        for (const [phoneNumber, channelId] of Object.entries(mappings)) {
          // Clean phone number (remove @s.whatsapp.net if present)
          const cleanPhone = this.cleanPhoneNumber(phoneNumber);
          
          this.phoneToChannel.set(cleanPhone, channelId);
          this.channelToPhone.set(channelId, cleanPhone);
        }
        
        console.log(`[ChannelManager:${this.instanceId}] Loaded ${this.phoneToChannel.size} channel mappings`);
      } else {
        console.log(`[ChannelManager:${this.instanceId}] No channel map file found at ${this.channelMapPath}`);
      }
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error loading channel map:`, error);
    }
  }
  
  /**
   * Save channel mappings to file
   */
  saveChannelMap() {
    try {
      const mappings = {};
      
      // Convert map to object
      for (const [phoneNumber, channelId] of this.phoneToChannel.entries()) {
        mappings[phoneNumber] = channelId;
      }
      
      // Save to file
      fs.writeFileSync(this.channelMapPath, JSON.stringify(mappings, null, 2), 'utf8');
      console.log(`[ChannelManager:${this.instanceId}] Saved ${this.phoneToChannel.size} channel mappings`);
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error saving channel map:`, error);
    }
  }
  
  /**
   * Clean phone number (remove @s.whatsapp.net)
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    // Remove WhatsApp suffix if present
    return phoneNumber.replace('@s.whatsapp.net', '');
  }
  
  /**
   * Get Discord channel ID for a phone number
   * @param {string} phoneNumber - WhatsApp phone number
   * @returns {string|null} - Discord channel ID
   */
  getChannelId(phoneNumber) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    return this.phoneToChannel.get(cleanPhone) || null;
  }
  
  /**
   * Get phone number for a Discord channel
   * @param {string} channelId - Discord channel ID
   * @returns {string|null} - WhatsApp phone number
   */
  getPhoneNumberByChannel(channelId) {
    return this.channelToPhone.get(channelId) || null;
  }
  
  /**
   * Set channel mapping
   * @param {string} phoneNumber - WhatsApp phone number
   * @param {string} channelId - Discord channel ID
   */
  setChannel(phoneNumber, channelId) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    
    // Add to maps
    this.phoneToChannel.set(cleanPhone, channelId);
    this.channelToPhone.set(channelId, cleanPhone);
    
    // Save changes
    this.saveChannelMap();
    
    console.log(`[ChannelManager:${this.instanceId}] Set channel ${channelId} for ${cleanPhone}`);
  }
  
  /**
   * Remove channel mapping
   * @param {string} phoneNumber - WhatsApp phone number
   */
  removeChannel(phoneNumber) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    const channelId = this.phoneToChannel.get(cleanPhone);
    
    if (channelId) {
      // Remove from both maps
      this.phoneToChannel.delete(cleanPhone);
      this.channelToPhone.delete(channelId);
      
      // Save changes
      this.saveChannelMap();
      
      console.log(`[ChannelManager:${this.instanceId}] Removed channel mapping for ${cleanPhone}`);
    }
  }
  
  /**
   * Remove channel mapping by channel ID
   * @param {string} channelId - Discord channel ID
   */
  removeChannelById(channelId) {
    const phoneNumber = this.channelToPhone.get(channelId);
    
    if (phoneNumber) {
      // Remove from both maps
      this.channelToPhone.delete(channelId);
      this.phoneToChannel.delete(phoneNumber);
      
      // Save changes
      this.saveChannelMap();
      
      console.log(`[ChannelManager:${this.instanceId}] Removed channel mapping for ${channelId}`);
    }
  }
  
  /**
   * Get the number of mapped channels
   * @returns {number} - Number of channel mappings
   */
  getChannelMapSize() {
    return this.phoneToChannel.size;
  }
  
  /**
   * Synchronize with WhatsApp client
   * This should be called when WhatsApp client connects
   */
  syncWithWhatsApp() {
    console.log(`[ChannelManager:${this.instanceId}] Synchronizing channels with WhatsApp client`);
    
    // Reload channel map from disk
    this.loadChannelMap();
    
    console.log(`[ChannelManager:${this.instanceId}] Channel synchronization complete`);
  }
  
  /**
   * Check if a Discord channel mentioned references a special channel
   * @param {string} messageText - Message text to check for channel mentions
   * @returns {Array} - Array of special channel mentions
   */
  checkForSpecialChannelMentions(messageText) {
    if (!messageText || !this.specialChannels || Object.keys(this.specialChannels).length === 0) {
      return [];
    }
    
    try {
      const mentions = [];
      
      // Parse mentions (<#channelId>) from message
      const mentionRegex = /<#(\d+)>/g;
      let match;
      
      while ((match = mentionRegex.exec(messageText)) !== null) {
        const channelId = match[1];
        
        // Check if this is a special channel
        if (this.specialChannels[channelId]) {
          mentions.push({
            channelId,
            message: this.specialChannels[channelId].message,
            index: match.index,
            length: match[0].length
          });
        }
      }
      
      return mentions;
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error checking for special channels:`, error);
      return [];
    }
  }
  
  /**
   * Get all channel mappings
   * @returns {Array} - Array of {phoneNumber, channelId} objects
   */
  getAllChannels() {
    const channels = [];
    
    for (const [phoneNumber, channelId] of this.phoneToChannel.entries()) {
      channels.push({ phoneNumber, channelId });
    }
    
    return channels;
  }
}

module.exports = ChannelManager;
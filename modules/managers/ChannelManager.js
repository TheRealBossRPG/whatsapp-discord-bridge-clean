// modules/managers/ChannelManager.js
const fs = require('fs');
const path = require('path');

/**
 * Manages channel mapping between WhatsApp and Discord
 */
class ChannelManager {
  /**
   * Create a new channel manager
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.channelMap = new Map();
    this.whatsAppClient = null;
    
    // Path to channel map storage
    this.filePath = path.join(__dirname, '..', '..', 'instances', this.instanceId, 'channel_map.json');
    
    // Special channels with custom messages
    this.specialChannels = {};
    
    // Load stored channel map
    this.loadChannelMap();
  }
  
  /**
   * Set WhatsApp client reference
   * @param {Object} client - WhatsApp client
   */
  setWhatsAppClient(client) {
    this.whatsAppClient = client;
  }
  
  /**
   * Set special channels with custom messages
   * @param {Object} specialChannels - Special channels configuration
   */
  setSpecialChannels(specialChannels) {
    this.specialChannels = specialChannels || {};
  }
  
  /**
   * Load channel map from storage
   */
  loadChannelMap() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(data);
        
        // Convert to Map
        for (const [jid, channelId] of Object.entries(parsed)) {
          this.channelMap.set(jid, channelId);
        }
        
        console.log(`[ChannelManager:${this.instanceId}] Loaded ${this.channelMap.size} channel mappings`);
      } else {
        console.log(`[ChannelManager:${this.instanceId}] No channel map file found at ${this.filePath}`);
        this.channelMap = new Map();
      }
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error loading channel map:`, error);
      this.channelMap = new Map();
    }
  }
  
  /**
   * Save channel map to storage
   */
  saveChannelMap() {
    try {
      // Create directory if it doesn't exist
      const directory = path.dirname(this.filePath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }
      
      // Convert Map to object
      const data = {};
      for (const [jid, channelId] of this.channelMap.entries()) {
        data[jid] = channelId;
      }
      
      // Write to file
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error saving channel map:`, error);
    }
  }
  
  /**
   * Add a channel mapping
   * @param {string} jid - JID to map channel to
   * @param {string} channelId - Channel ID
   */
  addChannel(jid, channelId) {
    const cleanJid = this.cleanJid(jid);
    this.channelMap.set(cleanJid, channelId);
    this.saveChannelMap();
  }
  
  /**
   * Remove a channel mapping
   * @param {string} jid - JID to remove mapping for
   * @returns {boolean} - Whether removal was successful
   */
  removeChannel(jid) {
    const cleanJid = this.cleanJid(jid);
    const result = this.channelMap.delete(cleanJid);
    
    if (result) {
      this.saveChannelMap();
    }
    
    return result;
  }
  
  /**
   * Get channel ID for a JID
   * @param {string} jid - JID to get channel for
   * @returns {string|null} - Channel ID or null
   */
  getChannelIdForJid(jid) {
    const cleanJid = this.cleanJid(jid);
    return this.channelMap.get(cleanJid) || null;
  }
  
  /**
   * Get JID for a channel ID
   * @param {string} channelId - Channel ID to get JID for
   * @returns {string|null} - JID or null
   */
  getJidForChannelId(channelId) {
    for (const [jid, chId] of this.channelMap.entries()) {
      if (chId === channelId) {
        return jid;
      }
    }
    
    return null;
  }
  
  /**
   * Get size of the channel map
   * @returns {number} - Number of channel mappings
   */
  getChannelMapSize() {
    return this.channelMap.size;
  }
  
  /**
   * Check if a channel ID is mapped
   * @param {string} channelId - Channel ID to check
   * @returns {boolean} - Whether channel is mapped
   */
  isChannelMapped(channelId) {
    return Array.from(this.channelMap.values()).includes(channelId);
  }
  
  /**
   * Clean a JID for storage
   * @param {string} jid - JID to clean
   * @returns {string} - Cleaned JID
   */
  cleanJid(jid) {
    if (!jid) {
      return '';
    }
    
    // Remove WhatsApp domain
    return jid.split('@')[0];
  }
  
  /**
   * Format a JID for WhatsApp
   * @param {string} jid - JID to format
   * @returns {string} - Formatted JID
   */
  formatJid(jid) {
    if (!jid) {
      return '';
    }
    
    // Ensure JID has WhatsApp domain
    return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
  }
  
  /**
   * Synchronize channels with WhatsApp client
   */
  syncWithWhatsApp() {
    try {
      if (!this.whatsAppClient) {
        console.error(`[ChannelManager:${this.instanceId}] Cannot sync: WhatsApp client not set`);
        return;
      }
      
      // Load channel map again
      this.loadChannelMap();
      
      console.log(`[ChannelManager:${this.instanceId}] Channel synchronization complete`);
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error synchronizing channels:`, error);
    }
  }
  
  /**
   * Get custom message for a special channel
   * @param {string} channelId - Channel ID to check
   * @returns {string|null} - Custom message or null
   */
  getSpecialChannelMessage(channelId) {
    try {
      if (!this.specialChannels || !channelId) {
        return null;
      }
      
      // Check if this channel is in the special channels
      if (this.specialChannels[channelId] && this.specialChannels[channelId].message) {
        return this.specialChannels[channelId].message;
      }
      
      return null;
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error getting special channel message:`, error);
      return null;
    }
  }
  
  /**
   * Check if a channel mention in a message is a special channel
   * @param {string} content - Message content
   * @returns {Object|null} - Special channel info or null
   */
  getSpecialChannelFromContent(content) {
    try {
      if (!content || !this.specialChannels) {
        return null;
      }
      
      // Look for channel mentions in the form <#channelId>
      const channelMentionRegex = /<#(\d+)>/g;
      const mentions = content.match(channelMentionRegex);
      
      if (!mentions) {
        return null;
      }
      
      // Check each mentioned channel
      for (const mention of mentions) {
        // Extract channel ID from mention
        const channelId = mention.replace(/<#(\d+)>/, '$1');
        
        // Check if it's a special channel
        const message = this.getSpecialChannelMessage(channelId);
        
        if (message) {
          return {
            channelId,
            message
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[ChannelManager:${this.instanceId}] Error checking for special channel:`, error);
      return null;
    }
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    this.saveChannelMap();
  }
}

module.exports = ChannelManager;
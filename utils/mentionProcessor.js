// utils/MentionProcessor.js
const fs = require('fs');
const path = require('path');

/**
 * Utility for processing channel and user mentions in messages
 */
class MentionProcessor {
  /**
   * Create a new MentionProcessor
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || 'default';
    this.discordClient = options.discordClient;
    this.guildId = options.guildId;
    this.instance = options.instance;
    
    // Store the special channels map
    this.specialChannels = {};
    
    // Load special channels from instance if available
    this.loadSpecialChannels();
    
    console.log(`[MentionProcessor:${this.instanceId}] Initialized`);
  }
  
  /**
   * Load special channels from instance
   */
  loadSpecialChannels() {
    try {
      if (this.instance && this.instance.customSettings && this.instance.customSettings.specialChannels) {
        this.specialChannels = this.instance.customSettings.specialChannels;
        console.log(`[MentionProcessor:${this.instanceId}] Loaded ${Object.keys(this.specialChannels).length} special channels`);
        
        // Log each special channel for debugging
        for (const [channelId, config] of Object.entries(this.specialChannels)) {
          console.log(`[MentionProcessor:${this.instanceId}] Special channel: ${channelId} (${config.channelName}) - "${config.message}"`);
        }
      } else {
        console.log(`[MentionProcessor:${this.instanceId}] No special channels found in instance settings`);
      }
    } catch (error) {
      console.error(`[MentionProcessor:${this.instanceId}] Error loading special channels:`, error);
    }
  }
  
  /**
   * Process WhatsApp message for sending to Discord
   * @param {string} text - Message text from WhatsApp
   * @returns {string} - Processed text with Discord mentions
   */
  processWhatsAppMessage(text) {
    if (!text) return text;
    
    let processedText = text;
    
    try {
      // First check for hashtag mentions (#channelname)
      const channelMatches = this.extractHashtagMentions(text);
      
      for (const match of channelMatches) {
        const channelName = match.name;
        const originalText = match.originalText;
        
        // Try to find the channel
        if (this.discordClient && this.guildId) {
          const guild = this.discordClient.guilds.cache.get(this.guildId);
          if (guild) {
            const channel = guild.channels.cache.find(c => 
              c.name.toLowerCase() === channelName.toLowerCase() || 
              c.name.toLowerCase().replace(/-/g, '') === channelName.toLowerCase()
            );
            
            if (channel) {
              // Check if this is a special channel
              if (this.specialChannels[channel.id]) {
                const specialMessage = this.specialChannels[channel.id].message;
                processedText = processedText.replace(originalText, specialMessage);
                console.log(`[MentionProcessor:${this.instanceId}] Replaced special channel mention: ${originalText} -> ${specialMessage}`);
              } else {
                // Regular channel mention
                processedText = processedText.replace(originalText, `<#${channel.id}>`);
                console.log(`[MentionProcessor:${this.instanceId}] Replaced channel mention: ${originalText} -> <#${channel.id}>`);
              }
            }
          }
        }
      }
      
      // Then check for @ mentions (@username)
      const userMatches = this.extractUserMentions(text);
      
      for (const match of userMatches) {
        const username = match.name;
        const originalText = match.originalText;
        
        // Try to find the user
        if (this.discordClient && this.guildId) {
          const guild = this.discordClient.guilds.cache.get(this.guildId);
          if (guild) {
            const member = guild.members.cache.find(m => 
              m.user.username.toLowerCase() === username.toLowerCase() || 
              (m.nickname && m.nickname.toLowerCase() === username.toLowerCase())
            );
            
            if (member) {
              processedText = processedText.replace(originalText, `<@${member.id}>`);
              console.log(`[MentionProcessor:${this.instanceId}] Replaced user mention: ${originalText} -> <@${member.id}>`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[MentionProcessor:${this.instanceId}] Error processing WhatsApp message:`, error);
    }
    
    return processedText;
  }
  
  /**
   * Convert Discord mentions to readable text (for sending to WhatsApp)
   * @param {string} text - Message text with Discord mentions
   * @returns {string} - Human-readable text
   */
  convertDiscordMentionsToText(text) {
    if (!text) return text;
    
    let processedText = text;
    
    try {
      // Process Discord channel mentions (<#123456789>)
      const channelMentionRegex = /<#(\d+)>/g;
      const channelMatches = [...text.matchAll(channelMentionRegex)];
      
      for (const match of channelMatches) {
        const channelId = match[1];
        
        // Check if this is a special channel
        if (this.specialChannels && this.specialChannels[channelId]) {
          // Replace with special channel message
          const specialMessage = this.specialChannels[channelId].message;
          processedText = processedText.replace(match[0], specialMessage);
          console.log(`[MentionProcessor:${this.instanceId}] Replaced special channel ID with message: ${match[0]} -> ${specialMessage}`);
        } else if (this.discordClient) {
          // Get the actual channel name
          const guild = this.discordClient.guilds.cache.get(this.guildId);
          if (guild) {
            const channel = guild.channels.cache.get(channelId);
            if (channel) {
              processedText = processedText.replace(match[0], `#${channel.name}`);
              console.log(`[MentionProcessor:${this.instanceId}] Replaced channel mention: ${match[0]} -> #${channel.name}`);
            }
          }
        }
      }
      
      // Process Discord user mentions (<@123456789> or <@!123456789>)
      const userMentionRegex = /<@!?(\d+)>/g;
      const userMatches = [...text.matchAll(userMentionRegex)];
      
      for (const match of userMatches) {
        const userId = match[1];
        
        if (this.discordClient) {
          const guild = this.discordClient.guilds.cache.get(this.guildId);
          if (guild) {
            const member = guild.members.cache.get(userId);
            if (member) {
              const displayName = member.nickname || member.user.username;
              processedText = processedText.replace(match[0], `@${displayName}`);
              console.log(`[MentionProcessor:${this.instanceId}] Replaced user mention: ${match[0]} -> @${displayName}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[MentionProcessor:${this.instanceId}] Error converting Discord mentions to text:`, error);
    }
    
    return processedText;
  }
  
  /**
   * Extract hashtag mentions from text
   * @param {string} text - Text to process
   * @returns {Array} - Array of matches with name and originalText
   */
  extractHashtagMentions(text) {
    const matches = [];
    
    try {
      // Match hashtags that look like channel names
      const channelHashtagRegex = /#(\w+)/g;
      let match;
      
      while ((match = channelHashtagRegex.exec(text)) !== null) {
        matches.push({
          name: match[1],
          originalText: match[0]
        });
      }
    } catch (error) {
      console.error(`[MentionProcessor:${this.instanceId}] Error extracting hashtag mentions:`, error);
    }
    
    return matches;
  }
  
  /**
   * Extract user mentions from text
   * @param {string} text - Text to process
   * @returns {Array} - Array of matches with name and originalText
   */
  extractUserMentions(text) {
    const matches = [];
    
    try {
      // Match @username mentions
      const userMentionRegex = /@(\w+)/g;
      let match;
      
      while ((match = userMentionRegex.exec(text)) !== null) {
        matches.push({
          name: match[1],
          originalText: match[0]
        });
      }
    } catch (error) {
      console.error(`[MentionProcessor:${this.instanceId}] Error extracting user mentions:`, error);
    }
    
    return matches;
  }
  
  /**
   * Reload special channels configuration
   * Useful when configuration changes
   */
  reloadSpecialChannels() {
    this.loadSpecialChannels();
  }
}

module.exports = MentionProcessor;
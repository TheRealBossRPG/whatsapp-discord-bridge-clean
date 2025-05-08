// utils/mentionProcessor.js
const fs = require('fs');
const path = require('path');

/**
 * Utility for processing channel and user mentions in messages
 */
class MentionProcessor {
  /**
   * Process WhatsApp message for sending to Discord
   * @param {string} text - Message text from WhatsApp
   * @param {Object} discordClient - Discord client
   * @param {string} guildId - Guild ID
   * @param {Object} specialChannels - Special channels map
   * @returns {string} - Processed text with Discord mentions
   */
  static processWhatsAppMessage(text, discordClient, guildId, specialChannels = {}) {
    if (!text) return text;
    
    let processedText = text;
    
    try {
      // First check for hashtag mentions (#channelname)
      const channelMatches = this.extractHashtagMentions(text);
      
      for (const match of channelMatches) {
        const channelName = match.name;
        const originalText = match.originalText;
        
        // Try to find the channel
        if (discordClient && guildId) {
          const guild = discordClient.guilds.cache.get(guildId);
          if (guild) {
            const channel = guild.channels.cache.find(c => 
              c.name.toLowerCase() === channelName.toLowerCase() || 
              c.name.toLowerCase().replace(/-/g, '') === channelName.toLowerCase()
            );
            
            if (channel) {
              // Check if this is a special channel
              if (specialChannels[channel.id]) {
                const specialMessage = specialChannels[channel.id].message;
                processedText = processedText.replace(originalText, specialMessage);
                console.log(`[MentionProcessor] Replaced special channel mention: ${originalText} -> ${specialMessage}`);
              } else {
                // Regular channel mention
                processedText = processedText.replace(originalText, `<#${channel.id}>`);
                console.log(`[MentionProcessor] Replaced channel mention: ${originalText} -> <#${channel.id}>`);
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
        if (discordClient && guildId) {
          const guild = discordClient.guilds.cache.get(guildId);
          if (guild) {
            const member = guild.members.cache.find(m => 
              m.user.username.toLowerCase() === username.toLowerCase() || 
              (m.nickname && m.nickname.toLowerCase() === username.toLowerCase())
            );
            
            if (member) {
              processedText = processedText.replace(originalText, `<@${member.id}>`);
              console.log(`[MentionProcessor] Replaced user mention: ${originalText} -> <@${member.id}>`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[MentionProcessor] Error processing WhatsApp message:`, error);
    }
    
    return processedText;
  }
  
  /**
   * Convert Discord mentions to readable text (for sending to WhatsApp)
   * @param {string} text - Message text with Discord mentions
   * @param {Object} discordClient - Discord client
   * @param {string} guildId - Guild ID
   * @param {Object} specialChannels - Special channels map
   * @returns {string} - Human-readable text
   */
  static convertDiscordMentionsToText(text, discordClient, guildId, specialChannels = {}) {
    if (!text) return text;
    
    let processedText = text;
    
    try {
      // Process Discord channel mentions (<#123456789>)
      const channelMentionRegex = /<#(\d+)>/g;
      const channelMatches = [...text.matchAll(channelMentionRegex)];
      
      for (const match of channelMatches) {
        const channelId = match[1];
        
        // Check if this is a special channel
        if (specialChannels && specialChannels[channelId]) {
          // Replace with special channel message
          const specialMessage = specialChannels[channelId].message;
          processedText = processedText.replace(match[0], specialMessage);
          console.log(`[MentionProcessor] Replaced special channel ID with message: ${match[0]} -> ${specialMessage}`);
        } else if (discordClient) {
          // Get the actual channel name
          const guild = discordClient.guilds.cache.get(guildId);
          if (guild) {
            const channel = guild.channels.cache.get(channelId);
            if (channel) {
              processedText = processedText.replace(match[0], `#${channel.name}`);
              console.log(`[MentionProcessor] Replaced channel mention: ${match[0]} -> #${channel.name}`);
            }
          }
        }
      }
      
      // Process Discord user mentions (<@123456789> or <@!123456789>)
      const userMentionRegex = /<@!?(\d+)>/g;
      const userMatches = [...text.matchAll(userMentionRegex)];
      
      for (const match of userMatches) {
        const userId = match[1];
        
        if (discordClient) {
          const guild = discordClient.guilds.cache.get(guildId);
          if (guild) {
            const member = guild.members.cache.get(userId);
            if (member) {
              const displayName = member.nickname || member.user.username;
              processedText = processedText.replace(match[0], `@${displayName}`);
              console.log(`[MentionProcessor] Replaced user mention: ${match[0]} -> @${displayName}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[MentionProcessor] Error converting Discord mentions to text:`, error);
    }
    
    return processedText;
  }
  
  /**
   * Extract hashtag mentions from text
   * @param {string} text - Text to process
   * @returns {Array} - Array of matches with name and originalText
   */
  static extractHashtagMentions(text) {
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
      console.error(`[MentionProcessor] Error extracting hashtag mentions:`, error);
    }
    
    return matches;
  }
  
  /**
   * Extract user mentions from text
   * @param {string} text - Text to process
   * @returns {Array} - Array of matches with name and originalText
   */
  static extractUserMentions(text) {
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
      console.error(`[MentionProcessor] Error extracting user mentions:`, error);
    }
    
    return matches;
  }
  
  /**
   * Process channel and user mentions in messages
   * @param {string} text - Message text
   * @param {Object} discordClient - Discord client
   * @param {string} guildId - Guild ID
   * @param {Object} specialChannels - Special channels map
   * @returns {string} - Processed text
   */
  static processChannelAndUserMentions(text, discordClient, guildId, specialChannels = {}) {
    // This is a convenience method that combines both mention processing functions
    return this.convertDiscordMentionsToText(text, discordClient, guildId, specialChannels);
  }
}

module.exports = MentionProcessor;
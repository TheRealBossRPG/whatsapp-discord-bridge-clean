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
              if (specialChannels && specialChannels[channel.id]) {
                const specialMessage = specialChannels[channel.id].message;
                processedText = processedText.replace(originalText, specialMessage);
              } else {
                // Regular channel mention
                processedText = processedText.replace(originalText, `<#${channel.id}>`);
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
      // CRITICAL: Make sure we have special channels
      if (!specialChannels || typeof specialChannels !== 'object') {
        specialChannels = {};
      }
      
      // If we have a guildId, try to load special channels from settings
      if (guildId) {
        try {
          // Try to load settings directly
          const instancesDir = path.join(process.cwd(), 'instances');
          const settingsPath = path.join(instancesDir, guildId, 'settings.json');
          
          console.log(`[MentionProcessor] Checking for settings at: ${settingsPath}`);
          
          if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (settings && settings.specialChannels) {
              console.log(`[MentionProcessor] Loaded specialChannels from ${settingsPath}`);
              specialChannels = settings.specialChannels;
            }
          }
        } catch (loadError) {
          console.error(`[MentionProcessor] Error loading special channels:`, loadError);
        }
      }
      
      // CRITICAL: Debug output
      console.log(`[MentionProcessor] === Special Channels Debug Info ===`);
      console.log(`[MentionProcessor] Text to process: "${text}"`);
      console.log(`[MentionProcessor] Number of special channels: ${Object.keys(specialChannels).length}`);
      
      if (Object.keys(specialChannels).length > 0) {
        for (const [channelId, info] of Object.entries(specialChannels)) {
          console.log(`[MentionProcessor] Special channel: ${channelId}, Message: "${info.message}", Name: ${info.channelName || 'unknown'}`);
        }
      }
      
      // SIMPLIFIED: First handle proper Discord channel mentions
      const channelMentionRegex = /<#(\d+)>/g;
      const channelMatches = [...text.matchAll(channelMentionRegex)];
      
      if (channelMatches.length > 0) {
        console.log(`[MentionProcessor] Found ${channelMatches.length} channel mentions`);
      }
      
      for (const match of channelMatches) {
        const channelId = match[1]; // The raw channel ID (without < # >)
        const fullMention = match[0]; // The entire <#123456> mention
        
        console.log(`[MentionProcessor] Processing channel ID: ${channelId}`);
        
        // Check if this exact channel ID exists in special channels
        if (specialChannels[channelId]) {
          // This is a special channel - replace with its message
          const specialMessage = specialChannels[channelId].message;
          console.log(`[MentionProcessor] Found special channel! ID: ${channelId}, replacing with message: "${specialMessage}"`);
          
          // Replace the mention with the special message
          processedText = processedText.replace(fullMention, specialMessage);
        } else {
          // Not a special channel - convert to regular #name format
          console.log(`[MentionProcessor] Not a special channel (no match found for ID: ${channelId})`);
          
          if (discordClient) {
            const guild = discordClient.guilds.cache.get(guildId);
            if (guild) {
              const channel = guild.channels.cache.get(channelId);
              if (channel) {
                processedText = processedText.replace(fullMention, `#${channel.name}`);
                console.log(`[MentionProcessor] Regular channel, converting to: #${channel.name}`);
              } else {
                console.log(`[MentionProcessor] Could not find channel with ID: ${channelId} in guild`);
              }
            }
          }
        }
      }
      
      // Now handle text hashtags (#name)
      const textHashtagRegex = /#(\w+)/g;
      const hashtagMatches = [...text.matchAll(textHashtagRegex)];
      
      if (hashtagMatches.length > 0) {
        console.log(`[MentionProcessor] Found ${hashtagMatches.length} text hashtags`);
      }
      
      for (const match of hashtagMatches) {
        const hashtag = match[0]; // Full hashtag with #
        const channelName = match[1]; // Just the name without #
        
        console.log(`[MentionProcessor] Processing text hashtag: ${hashtag} (name: ${channelName})`);
        
        // Try to find a matching special channel by name
        let found = false;
        
        // Skip if it's a numeric ID (which we already handled)
        if (!isNaN(channelName)) {
          console.log(`[MentionProcessor] Skipping numeric hashtag: ${hashtag}`);
          continue;
        }
        
        // Look for a matching channel name in specialChannels
        for (const [channelId, info] of Object.entries(specialChannels)) {
          if (info.channelName && info.channelName.toLowerCase() === channelName.toLowerCase()) {
            // Found a match by name
            console.log(`[MentionProcessor] Found matching special channel by name: ${info.channelName}`);
            processedText = processedText.replace(hashtag, info.message);
            found = true;
            break;
          } else if (info.channelName && info.channelName.toLowerCase().replace(/-/g, '') === channelName.toLowerCase()) {
            // Found a match by name (without hyphens)
            console.log(`[MentionProcessor] Found matching special channel by name (without hyphens): ${info.channelName}`);
            processedText = processedText.replace(hashtag, info.message);
            found = true;
            break;
          }
        }
        
        // If no match by name, try lookup through Discord
        if (!found && discordClient) {
          console.log(`[MentionProcessor] Trying Discord lookup for channel name: ${channelName}`);
          const guild = discordClient.guilds.cache.get(guildId);
          if (guild) {
            const channel = guild.channels.cache.find(c => 
              c.name.toLowerCase() === channelName.toLowerCase() ||
              c.name.toLowerCase().replace(/-/g, '') === channelName.toLowerCase()
            );
            
            if (channel && specialChannels[channel.id]) {
              console.log(`[MentionProcessor] Found matching special channel via Discord lookup: ${channel.name} (${channel.id})`);
              processedText = processedText.replace(hashtag, specialChannels[channel.id].message);
              found = true;
            }
          }
        }
        
        if (!found) {
          console.log(`[MentionProcessor] No special channel match found for "${hashtag}"`);
        }
      }
      
      // Process Discord user mentions
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
            }
          }
        }
      }
      
      console.log(`[MentionProcessor] Final processed text: "${processedText}"`);
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
    // CRITICAL: Explicitly try to load special channels from disk
    if (guildId) {
      try {
        const instancesDir = path.join(process.cwd(), 'instances');
        const settingsPath = path.join(instancesDir, guildId, 'settings.json');
        
        console.log(`[MentionProcessor] Trying to load settings from: ${settingsPath}`);
        
        if (fs.existsSync(settingsPath)) {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          if (settings && settings.specialChannels) {
            specialChannels = settings.specialChannels;
            console.log(`[MentionProcessor] Loaded ${Object.keys(specialChannels).length} special channels from file`);
          }
        }
      } catch (error) {
        console.error(`[MentionProcessor] Error loading special channels:`, error);
      }
    }
    
    return this.convertDiscordMentionsToText(text, discordClient, guildId, specialChannels);
  }
}

module.exports = MentionProcessor;
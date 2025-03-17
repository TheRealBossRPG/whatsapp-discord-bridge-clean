// modules/managers/TranscriptManager.js
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

/**
 * Manages ticket transcripts
 */
class TranscriptManager {
  /**
   * Create a new transcript manager
   * @param {Object} options - Manager options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || 'default';
    this.transcriptChannelId = options.transcriptChannelId || null;
    this.discordClient = options.discordClient || null;
    this.guildId = options.guildId || null;
    
    // Set base directory for transcripts
    this.baseDir = options.baseDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'transcripts');
    
    // Flag for disabled transcripts
    this.isDisabled = false;
    
    // Ensure directory exists
    this.ensureDirectories();
    
    console.log(`[TranscriptManager:${this.instanceId}] Initialized${this.transcriptChannelId ? ` with channel ${this.transcriptChannelId}` : ''}`);
  }
  
  /**
   * Ensure required directories exist
   */
  ensureDirectories() {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error creating directories:`, error);
    }
  }
  
  /**
   * Set transcript channel ID
   * @param {string} channelId - Discord channel ID 
   */
  setTranscriptChannel(channelId) {
    this.transcriptChannelId = channelId;
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
   * Format directory name from user name
   * @param {string} name - User name
   * @returns {string} - Formatted directory name
   */
  formatDirectoryName(name) {
    if (!name) return 'unknown-user';
    
    // Make filesystem safe: lowercase, replace spaces with hyphens, remove special chars
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }
  
  /**
   * Get user directory path
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   * @returns {string} - Path to user directory
   */
  getUserDir(phoneNumber, name) {
    // Clean phone number
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    
    // Format directory name
    const dirName = this.formatDirectoryName(name || 'unknown');
    
    // Create path with phone number included
    return path.join(this.baseDir, `${dirName}(${cleanPhone})`);
  }
  
  /**
   * Create a transcript from a channel
   * @param {Object} channel - Discord channel
   * @param {string} phoneNumber - User's phone number
   * @param {string} userName - User's name (optional)
   * @returns {Promise<string|null>} - Path to transcript or null if failed
   */
  async createTranscript(channel, phoneNumber, userName = null) {
    try {
      // Check if transcripts are disabled
      if (this.isDisabled) {
        console.log(`[TranscriptManager:${this.instanceId}] Transcripts are disabled, skipping`);
        return null;
      }
      
      console.log(`[TranscriptManager:${this.instanceId}] Creating transcript for ${phoneNumber} from channel ${channel.id}`);
      
      // Try to get username from channel name if not provided
      if (!userName && channel.name) {
        userName = channel.name.replace(/-/g, ' ');
      }
      
      // Get user directory
      const userDir = this.getUserDir(phoneNumber, userName);
      
      // Ensure directory exists
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      
      // Fetch messages from channel (up to 500)
      const messages = await this.fetchMessages(channel);
      
      if (messages.length === 0) {
        console.log(`[TranscriptManager:${this.instanceId}] No messages found in channel ${channel.id}`);
        return null;
      }
      
      // Format transcript
      const transcript = this.formatTranscript(messages, phoneNumber, userName, channel.name);
      
      // Generate filename with timestamp
      const timestamp = Date.now();
      const filename = `transcript-${timestamp}.md`;
      const filePath = path.join(userDir, filename);
      
      // Write to file
      fs.writeFileSync(filePath, transcript, 'utf8');
      
      console.log(`[TranscriptManager:${this.instanceId}] Saved transcript to ${filePath}`);
      
      // Post to transcript channel if configured
      if (this.transcriptChannelId && this.discordClient) {
        await this.postTranscriptToChannel(filePath, phoneNumber, userName, channel.name);
      }
      
      return filePath;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error creating transcript:`, error);
      return null;
    }
  }
  
  /**
   * Fetch messages from a channel
   * @param {Object} channel - Discord channel
   * @param {number} limit - Maximum number of messages
   * @returns {Promise<Array>} - Array of messages
   */
  async fetchMessages(channel, limit = 500) {
    try {
      const messages = [];
      let lastId = null;
      let fetched;
      
      // Fetch in batches of 100 (Discord API limit)
      do {
        const options = { limit: 100 };
        if (lastId) {
          options.before = lastId;
        }
        
        fetched = await channel.messages.fetch(options);
        
        if (fetched.size > 0) {
          lastId = fetched.last().id;
          messages.push(...fetched.values());
        }
      } while (fetched.size > 0 && messages.length < limit);
      
      // Sort messages by timestamp (oldest first)
      return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error fetching messages:`, error);
      return [];
    }
  }
  
  /**
   * Format transcript from messages
   * @param {Array} messages - Array of Discord messages
   * @param {string} phoneNumber - User's phone number
   * @param {string} userName - User's name
   * @param {string} channelName - Channel name
   * @returns {string} - Formatted transcript
   */
  formatTranscript(messages, phoneNumber, userName, channelName) {
    try {
      const lines = [
        `# Transcript: ${userName || 'Unknown User'}`,
        `Channel: #${channelName}`,
        `WhatsApp: ${this.cleanPhoneNumber(phoneNumber)}`,
        `Instance: ${this.instanceId}`,
        `Date: ${new Date().toISOString()}`,
        '',
        '---',
        ''
      ];
      
      // Process each message
      for (const message of messages) {
        // Skip system messages
        if (message.system) continue;
        
        // Format timestamp
        const timestamp = new Date(message.createdTimestamp).toISOString();
        
        // Format author
        const author = message.author.bot 
          ? `[BOT] ${message.author.username}`
          : message.author.username;
        
        // Add message header
        lines.push(`## ${author} (${timestamp})`);
        
        // Add content if any
        if (message.content) {
          lines.push(message.content);
          lines.push('');
        }
        
        // Add embeds if any
        if (message.embeds && message.embeds.length > 0) {
          for (const embed of message.embeds) {
            // Add embed title
            if (embed.title) {
              lines.push(`### ${embed.title}`);
            }
            
            // Add embed description
            if (embed.description) {
              lines.push(embed.description);
              lines.push('');
            }
            
            // Add fields
            if (embed.fields && embed.fields.length > 0) {
              for (const field of embed.fields) {
                lines.push(`**${field.name}**: ${field.value}`);
              }
              lines.push('');
            }
          }
        }
        
        // Add attachments if any
        if (message.attachments && message.attachments.size > 0) {
          lines.push('**Attachments:**');
          message.attachments.forEach(attachment => {
            lines.push(`- ${attachment.name}: ${attachment.url}`);
          });
          lines.push('');
        }
        
        // Add separator
        lines.push('---');
        lines.push('');
      }
      
      // Join lines into a single string
      return lines.join('\n');
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error formatting transcript:`, error);
      return `Error creating transcript: ${error.message}`;
    }
  }
  
  /**
   * Post transcript to Discord channel
   * @param {string} filePath - Path to transcript file
   * @param {string} phoneNumber - User's phone number
   * @param {string} userName - User's name
   * @param {string} channelName - Channel name
   * @returns {Promise<boolean>} - Success status
   */
  async postTranscriptToChannel(filePath, phoneNumber, userName, channelName) {
    try {
      // Check if transcript channel is configured
      if (!this.transcriptChannelId || !this.discordClient) {
        console.log(`[TranscriptManager:${this.instanceId}] No transcript channel configured`);
        return false;
      }
      
      console.log(`[TranscriptManager:${this.instanceId}] Posting transcript to channel ${this.transcriptChannelId}`);
      
      // Get guild
      const guild = await this.discordClient.guilds.fetch(this.guildId);
      if (!guild) {
        console.error(`[TranscriptManager:${this.instanceId}] Guild not found: ${this.guildId}`);
        return false;
      }
      
      // Get transcript channel
      let transcriptChannel;
      try {
        transcriptChannel = await guild.channels.fetch(this.transcriptChannelId);
      } catch (channelError) {
        console.error(`[TranscriptManager:${this.instanceId}] Transcript channel not found: ${this.transcriptChannelId}`, channelError);
        return false;
      }
      
      if (!transcriptChannel) {
        console.error(`[TranscriptManager:${this.instanceId}] Transcript channel not found: ${this.transcriptChannelId}`);
        return false;
      }
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error(`[TranscriptManager:${this.instanceId}] Transcript file not found: ${filePath}`);
        return false;
      }
      
      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0x4CAF50)
        .setTitle(`Transcript: ${userName || 'Unknown User'}`)
        .setDescription(`WhatsApp conversation transcript from #${channelName}`)
        .addFields(
          { name: 'User', value: userName || 'Unknown User', inline: true },
          { name: 'WhatsApp', value: this.cleanPhoneNumber(phoneNumber), inline: true },
          { name: 'Date', value: new Date().toISOString(), inline: true }
        )
        .setTimestamp();
      
      // Create attachment
      const attachment = new AttachmentBuilder(filePath, { name: path.basename(filePath) });
      
      // Send to channel
      await transcriptChannel.send({
        embeds: [embed],
        files: [attachment]
      });
      
      console.log(`[TranscriptManager:${this.instanceId}] Transcript posted to channel ${this.transcriptChannelId}`);
      return true;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error posting transcript:`, error);
      return false;
    }
  }
  
  /**
   * Save a transcript directly
   * @param {string} phoneNumber - User's phone number
   * @param {string} userName - User's name
   * @param {string} content - Transcript content
   * @param {string} channelName - Channel name
   * @returns {Promise<string|null>} - Path to transcript or null if failed
   */
  async saveTranscript(phoneNumber, userName, content, channelName = 'unknown-channel') {
    try {
      // Check if transcripts are disabled
      if (this.isDisabled) {
        console.log(`[TranscriptManager:${this.instanceId}] Transcripts are disabled, skipping`);
        return null;
      }
      
      console.log(`[TranscriptManager:${this.instanceId}] Saving transcript for ${phoneNumber} (${userName})`);
      
      // Get user directory
      const userDir = this.getUserDir(phoneNumber, userName);
      
      // Ensure directory exists
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      
      // Generate filename with timestamp
      const timestamp = Date.now();
      const filename = `transcript-${timestamp}.md`;
      const filePath = path.join(userDir, filename);
      
      // Ensure the content has headers
      let finalContent = content;
      
      // Add headers if not present
      if (!content.startsWith('# Transcript')) {
        // Check if we already have content
        const header = [
          `# Transcript: ${userName || 'Unknown User'}`,
          `Channel: #${channelName}`,
          `WhatsApp: ${this.cleanPhoneNumber(phoneNumber)}`,
          `Instance: ${this.instanceId}`,
          `Date: ${new Date().toISOString()}`,
          '',
          '---',
          ''
        ].join('\n');
        
        finalContent = header + '\n' + content;
      }
      
      // Write to file
      fs.writeFileSync(filePath, finalContent, 'utf8');
      
      console.log(`[TranscriptManager:${this.instanceId}] Saved transcript to ${filePath}`);
      
      // Post to transcript channel if configured
      if (this.transcriptChannelId && this.discordClient) {
        await this.postTranscriptToChannel(filePath, phoneNumber, userName, channelName);
      }
      
      return filePath;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error saving transcript:`, error);
      return null;
    }
  }
}

module.exports = TranscriptManager;
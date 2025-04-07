// modules/managers/TranscriptManager.js
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

/**
 * Manages conversation transcripts
 */
class TranscriptManager {
  /**
   * Create a new transcript manager
   * @param {Object} options - Transcript options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || 'default';
    this.transcriptChannelId = options.transcriptChannelId || null;
    this.discordClient = options.discordClient || null;
    this.guildId = options.guildId || null;
    this.baseDir = options.baseDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'transcripts');
    
    // Flag to disable transcripts
    this.isDisabled = false;
    
    // Create base directory if it doesn't exist
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    
    console.log(`[TranscriptManager:${this.instanceId}] Initialized`);
  }
  
  /**
   * Create a transcript from a Discord channel
   * @param {Object} channel - Discord channel
   * @param {string} phoneNumber - User phone number
   * @param {string} name - User name
   * @returns {Promise<string>} - Path to transcript
   */
  async createTranscript(channel, phoneNumber, name) {
    try {
      // Skip if disabled
      if (this.isDisabled) {
        console.log(`[TranscriptManager:${this.instanceId}] Transcripts are disabled, skipping`);
        return null;
      }
      
      // Check if channel exists
      if (!channel) {
        console.error(`[TranscriptManager:${this.instanceId}] Cannot create transcript: Channel is null`);
        return null;
      }
      
      console.log(`[TranscriptManager:${this.instanceId}] Creating transcript for ${name} (${phoneNumber})`);
      
      // Create user directory
      const userDir = this.getUserDirectory(phoneNumber, name);
      
      // Generate transcript filename
      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
      const filename = `transcript-${timestamp}.html`;
      const filePath = path.join(userDir, filename);
      
      // Create master transcript path
      const masterPath = path.join(userDir, 'transcript-master.html');
      
      // Fetch channel messages
      const messages = await this.fetchChannelMessages(channel);
      
      // Generate HTML content
      const htmlContent = this.generateTranscriptHtml(channel, messages, phoneNumber, name);
      
      // Write to file
      fs.writeFileSync(filePath, htmlContent, 'utf8');
      fs.writeFileSync(masterPath, htmlContent, 'utf8');
      
      console.log(`[TranscriptManager:${this.instanceId}] Saved transcript to ${filePath}`);
      
      // Post to transcript channel if enabled
      if (this.transcriptChannelId) {
        await this.postTranscriptToChannel(filePath, channel.name, phoneNumber, name);
      }
      
      return filePath;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error creating transcript:`, error);
      return null;
    }
  }
  
  /**
   * Fetch all messages from a channel
   * @param {Object} channel - Discord channel
   * @returns {Promise<Array>} - Array of messages
   */
  async fetchChannelMessages(channel) {
    try {
      const messages = [];
      let lastId = null;
      let fetched;
      
      // Fetch messages in batches of 100
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
      } while (fetched.size === 100);
      
      // Sort messages by timestamp
      messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      
      return messages;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error fetching channel messages:`, error);
      return [];
    }
  }
  
  /**
   * Generate HTML transcript
   * @param {Object} channel - Discord channel
   * @param {Array} messages - Channel messages
   * @param {string} phoneNumber - User phone number
   * @param {string} name - User name
   * @returns {string} - HTML content
   */
  generateTranscriptHtml(channel, messages, phoneNumber, name) {
    try {
      // Generate header
      let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Transcript - ${name}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background-color: #075e54;
      color: white;
      padding: 10px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .message {
      margin-bottom: 15px;
      padding: 10px;
      border-radius: 5px;
    }
    .user-message {
      background-color: #dcf8c6;
      margin-left: 40px;
    }
    .discord-message {
      background-color: #f2f2f2;
      margin-right: 40px;
    }
    .system-message {
      background-color: #ffeecc;
    }
    .timestamp {
      font-size: 0.8em;
      color: #888;
      text-align: right;
    }
    .author {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .attachment {
      margin-top: 5px;
      max-width: 100%;
    }
    .attachment img {
      max-width: 300px;
      max-height: 200px;
      border-radius: 5px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>WhatsApp Conversation Transcript</h1>
    <p>User: ${name}</p>
    <p>WhatsApp: ${phoneNumber}</p>
    <p>Channel: ${channel.name}</p>
    <p>Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
    <p>Instance: ${this.instanceId}</p>
  </div>
  <div class="messages">`;
      
      // Process each message
      for (const message of messages) {
        // Skip system messages or bot messages that aren't from our bot
        if (message.system || (message.author.bot && message.author.id !== this.discordClient?.user?.id)) {
          continue;
        }
        
        const timestamp = new Date(message.createdTimestamp).toLocaleString();
        let messageClass = 'discord-message';
        let authorName = message.author.username;
        
        // Check for WhatsApp messages (has specific format)
        if (message.content.startsWith('**')) {
          const match = message.content.match(/^\*\*(.*?)\*\*: /);
          if (match) {
            authorName = match[1];
            messageClass = 'user-message';
          }
        }
        
        // Check for system messages
        if (message.content.includes('Ticket closed by') || 
            message.content.includes('saved transcript') ||
            message.content.includes('New Support Ticket')) {
          messageClass = 'system-message';
        }
        
        // Format message content
        let content = message.content
          .replace(/\n/g, '<br>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/`(.*?)`/g, '<code>$1</code>');
        
        // Add message to HTML
        html += `
    <div class="message ${messageClass}">
      <div class="author">${authorName}</div>
      <div class="content">${content}</div>`;
        
        // Add attachments if any
        if (message.attachments.size > 0) {
          html += `<div class="attachments">`;
          
          message.attachments.forEach(attachment => {
            // Check if it's an image
            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
              html += `<div class="attachment">
          <img src="${attachment.url}" alt="Image">
        </div>`;
            } else {
              html += `<div class="attachment">
          <a href="${attachment.url}" target="_blank">${attachment.name}</a>
        </div>`;
            }
          });
          
          html += `</div>`;
        }
        
        // Add timestamp
        html += `<div class="timestamp">${timestamp}</div>
    </div>`;
      }
      
      // Close HTML
      html += `
  </div>
</body>
</html>`;
      
      return html;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error generating transcript HTML:`, error);
      return `<html><body><h1>Error generating transcript</h1><p>${error.message}</p></body></html>`;
    }
  }
  
  /**
   * Post transcript to designated channel
   * @param {string} transcriptPath - Path to transcript file
   * @param {string} channelName - Channel name
   * @param {string} phoneNumber - User phone number
   * @param {string} name - User name
   */
  async postTranscriptToChannel(transcriptPath, channelName, phoneNumber, name) {
    try {
      // Skip if no transcript channel or disabled
      if (!this.transcriptChannelId || this.isDisabled) {
        return;
      }
      
      // Get guild and channel
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[TranscriptManager:${this.instanceId}] Guild not found: ${this.guildId}`);
        return;
      }
      
      const transcriptChannel = guild.channels.cache.get(this.transcriptChannelId);
      if (!transcriptChannel) {
        console.error(`[TranscriptManager:${this.instanceId}] Transcript channel not found: ${this.transcriptChannelId}`);
        return;
      }
      
      // Create attachment
      const attachment = new AttachmentBuilder(transcriptPath, { name: `transcript-${phoneNumber}.html` });
      
      // Send to channel
      await transcriptChannel.send({
        content: `📄 Transcript saved for **${name}** (${phoneNumber}) from channel **${channelName}**`,
        files: [attachment]
      });
      
      console.log(`[TranscriptManager:${this.instanceId}] Posted transcript to channel ${this.transcriptChannelId}`);
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error posting transcript to channel:`, error);
    }
  }
  
  /**
   * Get user directory
   * @param {string} phoneNumber - User phone number
   * @param {string} name - User name
   * @returns {string} - Directory path
   */
  getUserDirectory(phoneNumber, name) {
    // Clean the name for filesystem
    const cleanName = (name || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-');
    
    // Create directory path with phone number appended
    const dirPath = path.join(this.baseDir, `${cleanName}(${phoneNumber})`);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    return dirPath;
  }
  
  /**
   * Get latest transcript for a user
   * @param {string} phoneNumber - User phone number
   * @param {string} name - User name
   * @returns {string|null} - Transcript content or null
   */
  getLatestTranscript(phoneNumber, name) {
    try {
      // Skip if disabled
      if (this.isDisabled) {
        return null;
      }
      
      // Get user directory
      const userDir = this.getUserDirectory(phoneNumber, name);
      
      // Check for master transcript
      const masterPath = path.join(userDir, 'transcript-master.html');
      if (fs.existsSync(masterPath)) {
        return fs.readFileSync(masterPath, 'utf8');
      }
      
      // If no master, look for latest transcript
      const files = fs.readdirSync(userDir).filter(file => file.startsWith('transcript-') && file.endsWith('.html'));
      
      if (files.length === 0) {
        return null;
      }
      
      // Sort by modification time (newest first)
      files.sort((a, b) => {
        const aTime = fs.statSync(path.join(userDir, a)).mtime.getTime();
        const bTime = fs.statSync(path.join(userDir, b)).mtime.getTime();
        return bTime - aTime;
      });
      
      // Get latest transcript
      const latestPath = path.join(userDir, files[0]);
      return fs.readFileSync(latestPath, 'utf8');
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error getting latest transcript:`, error);
      return null;
    }
  }
  
  /**
   * Save markdown transcript
   * @param {string} phoneNumber - User phone number
   * @param {string} name - User name
   * @param {string} content - Transcript content
   * @returns {string|null} - Path to saved transcript
   */
  saveMarkdownTranscript(phoneNumber, name, content) {
    try {
      // Skip if disabled
      if (this.isDisabled) {
        return null;
      }
      
      // Get user directory
      const userDir = this.getUserDirectory(phoneNumber, name);
      
      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
      const filename = `transcript-${timestamp}.md`;
      const filePath = path.join(userDir, filename);
      
      // Create master transcript path
      const masterPath = path.join(userDir, 'transcript-master.md');
      
      // Write to file
      fs.writeFileSync(filePath, content, 'utf8');
      fs.writeFileSync(masterPath, content, 'utf8');
      
      console.log(`[TranscriptManager:${this.instanceId}] Saved markdown transcript to ${filePath}`);
      
      return filePath;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error saving markdown transcript:`, error);
      return null;
    }
  }
}

module.exports = TranscriptManager;
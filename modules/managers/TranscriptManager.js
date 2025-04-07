// modules/managers/TranscriptManager.js
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const MediaManager = require('../../utils/MediaManager');

/**
 * Manages chat transcripts
 */
class TranscriptManager {
  /**
   * Create transcript manager
   * @param {Object} options - Options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || 'default';
    this.transcriptChannelId = options.transcriptChannelId || null;
    this.discordClient = options.discordClient || null;
    this.guildId = options.guildId || null;
    this.isDisabled = false;
    
    // Set up media manager
    this.baseDir = options.baseDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'transcripts');
    this.mediaManager = new MediaManager({
      instanceId: this.instanceId,
      baseDir: this.baseDir
    });
    
    console.log(`[TranscriptManager:${this.instanceId}] Initialized`);
  }
  
  /**
   * Set custom base directory
   * @param {string} dir - Base directory
   */
  setBaseDir(dir) {
    this.baseDir = dir;
    this.mediaManager.baseDir = dir;
  }
  
  /**
   * Create and save transcript
   * @param {Object} channel - Discord channel
   * @param {string} username - Username
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<string>} - Path to transcript
   */
  async createAndSaveTranscript(channel, username, phoneNumber) {
    try {
      // Check if disabled
      if (this.isDisabled) {
        console.log(`[TranscriptManager:${this.instanceId}] Transcript creation disabled`);
        return null;
      }
      
      // Get user directory
      const userDir = this.getUserDir(phoneNumber, username);
      
      // Ensure directory exists
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      
      // Create filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `transcript-${timestamp}.html`;
      const filepath = path.join(userDir, filename);
      
      // Fetch messages from the channel (up to 100)
      const messages = await channel.messages.fetch({ limit: 100 });
      
      // Sort messages by timestamp (oldest first)
      const sortedMessages = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      
      // Start building HTML
      let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ticket Transcript: ${username}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    .header {
      background-color: #5865F2;
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .info {
      background-color: #f9f9f9;
      border-left: 5px solid #5865F2;
      padding: 10px 20px;
      margin-bottom: 20px;
    }
    .message {
      padding: 10px;
      border-bottom: 1px solid #eee;
      display: flex;
    }
    .message:nth-child(odd) {
      background-color: #f9f9f9;
    }
    .message .author {
      font-weight: bold;
      margin-right: 10px;
      min-width: 120px;
    }
    .message .content {
      flex: 1;
    }
    .message .time {
      color: #777;
      font-size: 0.8em;
    }
    .attachment {
      margin-top: 5px;
      background-color: #f1f1f1;
      padding: 5px;
      border-radius: 5px;
    }
    .embed {
      border-left: 4px solid #5865F2;
      padding: 8px;
      margin: 5px 0;
      background-color: #f1f1f1;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Support Ticket Transcript</h1>
  </div>
  <div class="info">
    <p><strong>User:</strong> ${username}</p>
    <p><strong>WhatsApp:</strong> ${phoneNumber}</p>
    <p><strong>Instance:</strong> ${this.instanceId}</p>
    <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
  </div>
  <h2>Messages</h2>
`;
      
      // Add each message to the transcript
      for (const message of sortedMessages) {
        const author = message.member?.nickname || message.author.username;
        const isBot = message.author.bot;
        const botPrefix = isBot ? '[BOT] ' : '';
        
        html += `
  <div class="message">
    <div class="author">${botPrefix}${author}</div>
    <div class="content">
      <div class="time">${message.createdAt.toLocaleString()}</div>
      <div class="text">${message.content || ''}</div>`;
        
        // Add attachments
        if (message.attachments.size > 0) {
          for (const [id, attachment] of message.attachments) {
            html += `
      <div class="attachment">
        <a href="${attachment.url}" target="_blank">${attachment.name}</a>
        ${attachment.contentType?.startsWith('image/') 
          ? `<br><img src="${attachment.url}" alt="${attachment.name}" style="max-width:400px; max-height:300px;">` 
          : ''}
      </div>`;
          }
        }
        
        // Add embeds
        if (message.embeds.length > 0) {
          for (const embed of message.embeds) {
            html += `
      <div class="embed">
        ${embed.title ? `<div><strong>${embed.title}</strong></div>` : ''}
        ${embed.description ? `<div>${embed.description}</div>` : ''}`;
            
            if (embed.fields.length > 0) {
              for (const field of embed.fields) {
                html += `
        <div><strong>${field.name}:</strong> ${field.value}</div>`;
              }
            }
            
            html += `
      </div>`;
          }
        }
        
        html += `
    </div>
  </div>`;
      }
      
      // Close HTML
      html += `
</body>
</html>`;
      
      // Write file
      fs.writeFileSync(filepath, html, 'utf8');
      console.log(`[TranscriptManager:${this.instanceId}] Saved transcript to ${filepath}`);
      
      // Send to transcript channel if available
      if (this.transcriptChannelId && this.discordClient && this.guildId) {
        await this.sendTranscriptToChannel(filepath, username, phoneNumber);
      }
      
      return filepath;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error creating transcript:`, error);
      throw error;
    }
  }
  
  /**
   * Send transcript to channel
   * @param {string} filepath - Path to transcript
   * @param {string} username - Username
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<boolean>} - Success
   */
  async sendTranscriptToChannel(filepath, username, phoneNumber) {
    try {
      // Check if we have what we need
      if (!this.transcriptChannelId || !this.discordClient || !this.guildId) {
        console.log(`[TranscriptManager:${this.instanceId}] Missing information to send transcript to channel`);
        return false;
      }
      
      // Get guild
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[TranscriptManager:${this.instanceId}] Guild not found: ${this.guildId}`);
        return false;
      }
      
      // Get channel
      const channel = guild.channels.cache.get(this.transcriptChannelId);
      if (!channel) {
        console.error(`[TranscriptManager:${this.instanceId}] Channel not found: ${this.transcriptChannelId}`);
        return false;
      }
      
      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Ticket Transcript')
        .setDescription(`Support ticket transcript for ${username}`)
        .addFields(
          { name: 'User', value: username, inline: true },
          { name: 'WhatsApp', value: phoneNumber.replace(/@.*$/, ''), inline: true },
          { name: 'Date', value: new Date().toLocaleString(), inline: true }
        )
        .setTimestamp();
      
      // Create attachment
      const attachment = new AttachmentBuilder(filepath, {
        name: `transcript-${username.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}.html`
      });
      
      // Send to channel
      await channel.send({ embeds: [embed], files: [attachment] });
      console.log(`[TranscriptManager:${this.instanceId}] Sent transcript to channel ${this.transcriptChannelId}`);
      
      return true;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error sending transcript to channel:`, error);
      return false;
    }
  }
  
  /**
   * Get user directory
   * @param {string} phoneNumber - Phone number
   * @param {string} username - Username
   * @returns {string} - Directory path
   */
  getUserDir(phoneNumber, username) {
    return this.mediaManager.getUserDir(phoneNumber, username);
  }
  
  /**
   * Get transcripts directory
   * @param {string} phoneNumber - Phone number
   * @param {string} username - Username
   * @returns {string} - Directory path
   */
  getTranscriptsDir(phoneNumber, username) {
    return this.mediaManager.getTranscriptsDir(phoneNumber, username);
  }
}

module.exports = TranscriptManager;
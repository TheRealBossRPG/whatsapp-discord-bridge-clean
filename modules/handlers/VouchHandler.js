// modules/handlers/VouchHandler.js - Complete rewrite with consolidated MediaManager
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

// Import MediaManager from utils (single source of truth)
const MediaManager = require('../../utils/MediaManager');

/**
 * Handler for WhatsApp vouch messages
 * Processes vouches and posts them to a Discord channel
 */
class VouchHandler {
  /**
   * Create a new vouch handler
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} discordClient - Discord client
   * @param {string} guildId - Discord guild ID
   * @param {string} vouchChannelId - Discord channel ID for vouches
   * @param {Object} userCardManager - User card manager
   * @param {Object} options - Additional options
   */
  constructor(whatsAppClient, discordClient, guildId, vouchChannelId, userCardManager, options = {}) {
    this.whatsAppClient = whatsAppClient;
    this.discordClient = discordClient;
    this.guildId = guildId;
    this.vouchChannelId = vouchChannelId;
    this.userCardManager = userCardManager;
    this.channelManager = null;
    
    // Get options with defaults
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    this.assetsDir = options.assetsDir || path.join(__dirname, '..', '..', 'assets');
    
    // Create directory for media files if it doesn't exist
    const vouchMediaDir = path.join(this.tempDir, 'vouch_media');
    if (!fs.existsSync(vouchMediaDir)) {
      fs.mkdirSync(vouchMediaDir, { recursive: true });
    }
    
    // Initialize MediaManager for handling media files
    this.mediaManager = new MediaManager({
      instanceId: this.instanceId,
      baseDir: path.join(__dirname, '..', '..', 'instances', this.instanceId, 'transcripts')
    });
    
    // Custom messages
    this.vouchMessage = "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
    this.vouchSuccessMessage = "✅ Thank you for your vouch! It has been posted to our community channel.";
    
    // Disabled flag
    this.isDisabled = false;
    
    console.log(`[VouchHandler:${this.instanceId}] Initialized for guild ${guildId}, channel ${vouchChannelId}`);
  }
  
  /**
   * Set channel manager
   * @param {Object} channelManager - Channel manager
   */
  setChannelManager(channelManager) {
    this.channelManager = channelManager;
  }
  
  /**
   * Set custom vouch message template
   * @param {string} message - Custom vouch message
   */
  setCustomVouchMessage(message) {
    if (message && typeof message === 'string') {
      this.vouchMessage = message;
      console.log(`[VouchHandler:${this.instanceId}] Set custom vouch message`);
    }
  }
  
  /**
   * Set custom vouch success message template
   * @param {string} message - Custom vouch success message
   */
  setCustomVouchSuccessMessage(message) {
    if (message && typeof message === 'string') {
      this.vouchSuccessMessage = message;
      console.log(`[VouchHandler:${this.instanceId}] Set custom vouch success message`);
    }
  }
  
  /**
   * Process a message to check if it's a vouch
   * @param {Object} message - Message to process
   * @returns {Promise<boolean>} - Whether the message was a vouch
   */
  async processMessage(message) {
    try {
      // Skip if handler is disabled
      if (this.isDisabled) {
        return false;
      }
      
      // Get message content
      const content = message.body || message.content || '';
      
      // Check if message is a vouch (starts with "vouch" or "Vouch")
      if (content.trim().toLowerCase().startsWith('vouch')) {
        await this.handleVouch(message);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error processing message:`, error);
      return false;
    }
  }
  
  /**
   * Handle a vouch command from Discord
   * @param {Object} interaction - Discord interaction
   * @param {string} phoneNumber - User's phone number
   * @returns {Promise<boolean>} - Success status
   */
  async handleVouchCommand(interaction, phoneNumber) {
    try {
      // Skip if handler is disabled
      if (this.isDisabled) {
        await interaction.reply({
          content: "⚠️ Vouch system is currently disabled.",
          ephemeral: true
        });
        return false;
      }
      
      // Get user info
      const userCard = this.userCardManager.getUserCard(phoneNumber);
      if (!userCard || !userCard.phoneNumber) {
        await interaction.reply({
          content: "❌ Could not find user information.",
          ephemeral: true
        });
        return false;
      }
      
      // Format vouch message
      let message = this.vouchMessage;
      message = message.replace(/{name}/g, userCard.name || 'User');
      message = message.replace(/{phoneNumber}/g, userCard.phoneNumber);
      
      // Send vouch message to user
      await this.whatsAppClient.sendMessage(userCard.phoneNumber, message);
      
      // Confirm to Discord
      await interaction.reply({
        content: `✅ Sent vouch instructions to ${userCard.name || 'user'}.`,
        ephemeral: true
      });
      
      return true;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error handling vouch command:`, error);
      
      // Try to reply with error
      try {
        await interaction.reply({
          content: `❌ Error sending vouch instructions: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error(`[VouchHandler:${this.instanceId}] Error sending error message:`, replyError);
      }
      
      return false;
    }
  }
  
  /**
   * Process a vouch message
   * @param {Object} message - Vouch message
   * @returns {Promise<boolean>} - Success status
   */
  async handleVouch(message) {
    try {
      // Skip if handler is disabled
      if (this.isDisabled) {
        return false;
      }
      
      // Verify channel is configured
      if (!this.vouchChannelId) {
        console.warn(`[VouchHandler:${this.instanceId}] No vouch channel configured`);
        return false;
      }
      
      // Get user info
      const phoneNumber = message.from || message.key?.remoteJid;
      const formattedPhone = this.mediaManager.cleanPhoneNumber(phoneNumber);
      let username = this.mediaManager.getUsernameFromPhone(formattedPhone);
      
      if (!username) {
        // Try to get from userCardManager
        const userCard = this.userCardManager.getUserCard(formattedPhone);
        if (userCard && userCard.name) {
          username = userCard.name;
          // Save to MediaManager for future use
          this.mediaManager.setPhoneToUsername(formattedPhone, username);
        } else {
          username = 'Unknown User';
        }
      }
      
      // Get message content (remove "vouch" prefix)
      const content = message.body || message.content || '';
      const vouchContent = content.trim().replace(/^vouch[!:. ]*/i, '').trim();
      
      if (!vouchContent) {
        // If empty vouch, ask for more info
        await this.whatsAppClient.sendMessage(phoneNumber, "Please provide some feedback with your vouch. For example: \"Vouch! Great service, very responsive!\"");
        return false;
      }
      
      // Create embed for Discord
      const embed = new EmbedBuilder()
        .setColor(0x00BFFF)
        .setTitle(`⭐ New Vouch from ${username}`)
        .setDescription(vouchContent)
        .setTimestamp()
        .setFooter({ text: `WhatsApp: ${formattedPhone}` });
      
      // Process media if present
      const attachments = [];
      if (message.hasMedia && typeof message.downloadMedia === 'function') {
        try {
          // Download media
          const media = await message.downloadMedia();
          
          if (media && media.data) {
            // Create temp file for media
            const fileExt = this.getFileExtensionFromMimetype(media.mimetype);
            const filePath = path.join(this.tempDir, 'vouch_media', `vouch_${Date.now()}.${fileExt}`);
            
            // Convert base64 to file
            const buffer = Buffer.from(media.data, 'base64');
            fs.writeFileSync(filePath, buffer);
            
            // Create attachment for Discord
            const attachment = new AttachmentBuilder(filePath, {
              name: `vouch_media.${fileExt}`,
              description: 'Vouch media attachment'
            });
            
            attachments.push(attachment);
            
            // Add image URL to embed if it's an image
            if (media.mimetype.startsWith('image/')) {
              embed.setImage(`attachment://vouch_media.${fileExt}`);
            }
          }
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error downloading media:`, mediaError);
        }
      }
      
      // Get Discord channel and send vouch
      const channel = await this.discordClient.channels.fetch(this.vouchChannelId);
      if (!channel) {
        console.error(`[VouchHandler:${this.instanceId}] Could not find vouch channel ${this.vouchChannelId}`);
        return false;
      }
      
      // Send embed to Discord
      await channel.send({
        embeds: [embed],
        files: attachments
      });
      
      // Send confirmation to user
      await this.whatsAppClient.sendMessage(phoneNumber, this.vouchSuccessMessage);
      
      console.log(`[VouchHandler:${this.instanceId}] Posted vouch from ${username} (${formattedPhone})`);
      
      // Clean up temp files
      for (const attachment of attachments) {
        try {
          if (fs.existsSync(attachment.attachment)) {
            fs.unlinkSync(attachment.attachment);
          }
        } catch (unlinkError) {
          console.error(`[VouchHandler:${this.instanceId}] Error removing temp file:`, unlinkError);
        }
      }
      
      return true;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error handling vouch:`, error);
      
      // Try to notify user of error
      try {
        if (message.from || message.key?.remoteJid) {
          await this.whatsAppClient.sendMessage(
            message.from || message.key.remoteJid,
            "❌ Sorry, there was an error posting your vouch. Please try again later."
          );
        }
      } catch (notifyError) {
        console.error(`[VouchHandler:${this.instanceId}] Error notifying user:`, notifyError);
      }
      
      return false;
    }
  }
  
  /**
   * Get file extension from mimetype
   * @param {string} mimetype - Mimetype
   * @returns {string} - File extension
   */
  getFileExtensionFromMimetype(mimetype) {
    const mimetypeMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'application/pdf': 'pdf'
    };
    
    return mimetypeMap[mimetype] || 'bin';
  }
}

module.exports = VouchHandler;
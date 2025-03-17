// modules/handlers/VouchHandler.js (Updated for New Message Format)
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

/**
 * Handler for vouches from WhatsApp users
 */
class VouchHandler {
  /**
   * Create a new vouch handler
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} discordClient - Discord client
   * @param {string} guildId - Guild ID
   * @param {string} vouchChannelId - Vouch channel ID
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
    
    // Instance ID
    this.instanceId = options.instanceId || 'default';
    
    // Set paths
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    this.assetsDir = options.assetsDir || path.join(__dirname, '..', '..', 'assets');
    
    // Custom messages
    this.vouchMessage = "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
    this.vouchSuccessMessage = "✅ Thank you for your vouch! It has been posted to our community channel.";
    
    // Flag for disabled status
    this.isDisabled = false;
    
    console.log(`[VouchHandler:${this.instanceId}] Initialized for vouch channel ${vouchChannelId}`);
  }
  
  /**
   * Set channel manager
   * @param {Object} channelManager - Channel manager
   */
  setChannelManager(channelManager) {
    this.channelManager = channelManager;
  }
  
  /**
   * Set custom vouch message
   * @param {string} message - Custom vouch message
   */
  setCustomVouchMessage(message) {
    this.vouchMessage = message;
  }
  
  /**
   * Set custom vouch success message
   * @param {string} message - Custom vouch success message
   */
  setCustomVouchSuccessMessage(message) {
    this.vouchSuccessMessage = message;
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
   * Format phone number consistently
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    const clean = this.cleanPhoneNumber(phoneNumber);
    
    // Make sure it has the WhatsApp suffix if not already present
    if (!phoneNumber.includes('@')) {
      return `${clean}@s.whatsapp.net`;
    }
    
    return phoneNumber;
  }
  
  /**
   * Send vouch request to user
   * @param {string} phoneNumber - User's phone number
   * @returns {Promise<boolean>} - Success status
   */
  async sendVouchRequest(phoneNumber) {
    try {
      // Check if vouch system is disabled
      if (this.isDisabled) {
        console.log(`[VouchHandler:${this.instanceId}] Vouch system is disabled`);
        return false;
      }
      
      console.log(`[VouchHandler:${this.instanceId}] Sending vouch request to ${phoneNumber}`);
      
      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      // Check if WhatsApp client is available
      if (!this.whatsAppClient) {
        console.error(`[VouchHandler:${this.instanceId}] WhatsApp client not available`);
        return false;
      }
      
      // Get username from user card
      let userName = 'Customer';
      
      if (this.userCardManager) {
        const userCard = await this.userCardManager.getUserCard(formattedPhone);
        if (userCard && userCard.name) {
          userName = userCard.name;
        }
      }
      
      // Format message
      const message = this.vouchMessage.replace(/{name}/g, userName);
      
      // Send message
      await this.whatsAppClient.sendTextMessage(formattedPhone, message);
      
      console.log(`[VouchHandler:${this.instanceId}] Vouch request sent to ${formattedPhone}`);
      return true;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error sending vouch request:`, error);
      return false;
    }
  }
  
  /**
   * Handle vouch message - UPDATED for new message format
   * @param {Object} message - Simplified WhatsApp message
   * @returns {Promise<boolean>} - Success status
   */
  async handleVouch(message) {
    try {
      // Check if vouch system is disabled
      if (this.isDisabled) {
        console.log(`[VouchHandler:${this.instanceId}] Vouch system is disabled, ignoring vouch`);
        return false;
      }
      
      // Extract phone number
      const jid = message.jid;
      if (!jid) {
        console.error(`[VouchHandler:${this.instanceId}] No JID in message`);
        return false;
      }
      
      // Extract text content - already done in the simplified message format
      let vouchText = message.content || '';
      
      // Remove the "Vouch!" prefix for cleaner display
      vouchText = vouchText.replace(/^Vouch!\s*/i, '').trim();
      
      if (!vouchText) {
        console.log(`[VouchHandler:${this.instanceId}] Empty vouch text from ${jid}`);
        
        // Send a message asking for more detail
        await this.whatsAppClient.sendTextMessage(
          jid,
          "Please include some feedback with your vouch. Just send another message starting with 'Vouch!' followed by your feedback."
        );
        
        return false;
      }
      
      console.log(`[VouchHandler:${this.instanceId}] Processing vouch from ${jid}: ${vouchText.substring(0, 50)}${vouchText.length > 50 ? '...' : ''}`);
      
      // Get user info
      let userName = 'Customer';
      let profilePicUrl = null;
      
      if (this.userCardManager) {
        const userCard = await this.userCardManager.getUserCard(jid);
        if (userCard) {
          userName = userCard.name;
          profilePicUrl = userCard.profilePicUrl;
        }
      }
      
      // Check for media
      let mediaPath = null;
      let mediaType = null;
      
      if (message.type === 'image' || message.type === 'video' || message.type === 'document') {
        mediaPath = await this.downloadMedia(message);
        mediaType = message.type;
      }
      
      // Post vouch to Discord
      const success = await this.postVouchToDiscord(userName, jid, vouchText, mediaPath, mediaType, profilePicUrl);
      
      // Clean up media file if it exists
      if (mediaPath && fs.existsSync(mediaPath)) {
        try {
          fs.unlinkSync(mediaPath);
        } catch (unlinkError) {
          console.error(`[VouchHandler:${this.instanceId}] Error deleting temp file:`, unlinkError);
        }
      }
      
      // Send confirmation to user
      if (success) {
        await this.whatsAppClient.sendTextMessage(jid, this.vouchSuccessMessage);
      } else {
        await this.whatsAppClient.sendTextMessage(
          jid,
          "Sorry, there was an error posting your vouch. Please try again later or contact support."
        );
      }
      
      return success;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error handling vouch:`, error);
      return false;
    }
  }
  
  /**
   * Download media from message - UPDATED for new message format
   * @param {Object} message - Simplified WhatsApp message
   * @returns {Promise<string|null>} - Path to media file or null
   */
  async downloadMedia(message) {
    try {
      if (!this.whatsAppClient || typeof this.whatsAppClient.downloadMedia !== 'function') {
        console.error(`[VouchHandler:${this.instanceId}] WhatsApp client has no downloadMedia method`);
        return null;
      }
      
      // Generate file path
      const timestamp = Date.now();
      const randomNum = Math.floor(Math.random() * 10000);
      
      let extension = '.bin';
      switch (message.type) {
        case 'image': extension = '.jpg'; break;
        case 'video': extension = '.mp4'; break;
        case 'document': extension = '.pdf'; break;
        default: extension = '.bin'; break;
      }
      
      const filename = `vouch_media_${timestamp}_${randomNum}${extension}`;
      const mediaPath = path.join(this.tempDir, filename);
      
      // Make sure temp directory exists
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }
      
      // Download media
      const buffer = await this.whatsAppClient.downloadMedia(message);
      
      // Save to file
      fs.writeFileSync(mediaPath, buffer);
      
      console.log(`[VouchHandler:${this.instanceId}] Downloaded media to ${mediaPath}`);
      return mediaPath;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error downloading media:`, error);
      return null;
    }
  }
  
  /**
   * Post vouch to Discord
   * @param {string} userName - User name
   * @param {string} phoneNumber - Phone number
   * @param {string} vouchText - Vouch text
   * @param {string} mediaPath - Path to media file (if any)
   * @param {string} mediaType - Type of media
   * @param {string} profilePicUrl - URL to profile picture
   * @returns {Promise<boolean>} - Success status
   */
  async postVouchToDiscord(userName, phoneNumber, vouchText, mediaPath = null, mediaType = null, profilePicUrl = null) {
    try {
      console.log(`[VouchHandler:${this.instanceId}] Posting vouch to Discord for ${userName} (${phoneNumber})`);
      
      // Get guild
      const guild = await this.discordClient.guilds.fetch(this.guildId);
      if (!guild) {
        console.error(`[VouchHandler:${this.instanceId}] Guild not found: ${this.guildId}`);
        return false;
      }
      
      // Get vouch channel
      let vouchChannel;
      try {
        vouchChannel = await guild.channels.fetch(this.vouchChannelId);
      } catch (channelError) {
        console.error(`[VouchHandler:${this.instanceId}] Vouch channel not found: ${this.vouchChannelId}`, channelError);
        return false;
      }
      
      if (!vouchChannel) {
        console.error(`[VouchHandler:${this.instanceId}] Vouch channel not found: ${this.vouchChannelId}`);
        return false;
      }
      
      // Create embed for vouch
      const vouchEmbed = new EmbedBuilder()
        .setColor(0xFFD700) // Gold
        .setTitle(`⭐ Vouch from ${userName}`)
        .setDescription(vouchText)
        .setTimestamp()
        .setFooter({ text: 'Sent via WhatsApp' });
      
      // Add profile picture if available
      if (profilePicUrl) {
        vouchEmbed.setThumbnail(profilePicUrl);
      }
      
      // Handle media
      if (mediaPath && fs.existsSync(mediaPath)) {
        // Create attachment
        const attachment = new AttachmentBuilder(mediaPath);
        const filename = path.basename(mediaPath);
        
        // Add image to embed if it's an image
        if (mediaType === 'image') {
          vouchEmbed.setImage(`attachment://${filename}`);
          
          // Send with attachment
          await vouchChannel.send({
            embeds: [vouchEmbed],
            files: [attachment]
          });
        } else {
          // For other media types, we'll have to send separately
          await vouchChannel.send({
            embeds: [vouchEmbed]
          });
          
          await vouchChannel.send({
            content: `📎 Media attachment from ${userName}:`,
            files: [attachment]
          });
        }
      } else {
        // No media, just send the embed
        await vouchChannel.send({
          embeds: [vouchEmbed]
        });
      }
      
      console.log(`[VouchHandler:${this.instanceId}] Vouch posted to channel ${this.vouchChannelId}`);
      return true;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error posting vouch to Discord:`, error);
      return false;
    }
  }
}

module.exports = VouchHandler;
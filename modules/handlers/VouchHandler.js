// modules/handlers/VouchHandler.js
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * Handles vouch commands and processing
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
    
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    this.assetsDir = options.assetsDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'assets');
    
    // Channel manager for checking special channels
    this.channelManager = null;
    
    // Flag to disable vouches
    this.isDisabled = false;
    
    // Custom vouch message
    this.vouchMessage = "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
    
    // Custom vouch success message
    this.vouchSuccessMessage = "✅ Thank you for your vouch! It has been posted to our community channel.";
    
    // Create directories if they don't exist
    for (const dir of [this.tempDir, this.assetsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  /**
   * Set channel manager reference
   * @param {Object} channelManager - Channel manager
   */
  setChannelManager(channelManager) {
    this.channelManager = channelManager;
  }
  
  /**
   * Set custom vouch message
   * @param {string} message - Message template
   */
  setCustomVouchMessage(message) {
    if (message) {
      this.vouchMessage = message;
    }
  }
  
  /**
   * Set custom vouch success message
   * @param {string} message - Message template
   */
  setCustomVouchSuccessMessage(message) {
    if (message) {
      this.vouchSuccessMessage = message;
    }
  }
  
  /**
   * Send vouch instructions to a user
   * @param {string} phoneNumber - Phone number to send to
   * @param {Object} userCard - User card
   * @returns {Promise<boolean>} - Success status
   */
  async sendVouchInstructions(phoneNumber, userCard) {
    try {
      // Skip if disabled
      if (this.isDisabled) {
        console.log(`[VouchHandler:${this.instanceId}] Vouches are disabled, skipping`);
        return false;
      }
      
      // Check if WhatsApp client is available
      if (!this.whatsAppClient) {
        console.error(`[VouchHandler:${this.instanceId}] WhatsApp client not available`);
        return false;
      }
      
      // Get user name
      const name = userCard?.name || 'there';
      
      // Format message
      const message = this.vouchMessage
        .replace(/{name}/g, name)
        .replace(/{phoneNumber}/g, phoneNumber);
      
      // Send message
      await this.whatsAppClient.sendMessage(
        `${phoneNumber}@s.whatsapp.net`,
        { text: message }
      );
      
      console.log(`[VouchHandler:${this.instanceId}] Sent vouch instructions to ${name} (${phoneNumber})`);
      return true;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error sending vouch instructions:`, error);
      return false;
    }
  }
  
  /**
   * Handle a vouch message
   * @param {string} phoneNumber - Phone number
   * @param {Object} messageContent - Message content
   * @param {Object} userCard - User card
   * @param {Object} originalMessage - Original WhatsApp message
   * @returns {Promise<boolean>} - Success status
   */
  async handleVouch(phoneNumber, messageContent, userCard, originalMessage) {
    try {
      // Skip if disabled
      if (this.isDisabled) {
        console.log(`[VouchHandler:${this.instanceId}] Vouches are disabled, skipping`);
        return false;
      }
      
      // Check if vouch channel is set
      if (!this.vouchChannelId) {
        console.error(`[VouchHandler:${this.instanceId}] Vouch channel not set`);
        return false;
      }
      
      // Get user info
      const name = userCard?.name || 'Unknown User';
      
      // Extract vouch text
      const vouchText = messageContent.text.replace(/^vouch!/i, '').trim();
      
      if (vouchText.length < 2) {
        // Vouch text too short - ask for more detail
        await this.whatsAppClient.sendMessage(
          `${phoneNumber}@s.whatsapp.net`,
          { text: "Please provide more details with your vouch! Just add your feedback after 'Vouch!'" }
        );
        return false;
      }
      
      // Process media if present
      let mediaBuffer = null;
      let mediaType = null;
      let mediaFileName = null;
      
      if (messageContent.type && messageContent.type !== 'text') {
        // Download media
        mediaBuffer = await this.whatsAppClient.downloadMedia(originalMessage);
        mediaType = messageContent.type;
        mediaFileName = messageContent.fileName;
      }
      
      // Post vouch to Discord
      const success = await this.postVouchToDiscord(name, phoneNumber, vouchText, mediaBuffer, mediaType, mediaFileName);
      
      if (success) {
        // Send success message
        await this.whatsAppClient.sendMessage(
          `${phoneNumber}@s.whatsapp.net`,
          { text: this.vouchSuccessMessage }
        );
      }
      
      return success;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error handling vouch:`, error);
      return false;
    }
  }
  
  /**
   * Post vouch to Discord channel
   * @param {string} name - User name
   * @param {string} phoneNumber - Phone number
   * @param {string} vouchText - Vouch text
   * @param {Buffer} mediaBuffer - Media buffer (optional)
   * @param {string} mediaType - Media type (optional)
   * @param {string} mediaFileName - Media filename (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async postVouchToDiscord(name, phoneNumber, vouchText, mediaBuffer = null, mediaType = null, mediaFileName = null) {
    try {
      // Get guild and channel
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[VouchHandler:${this.instanceId}] Guild not found: ${this.guildId}`);
        return false;
      }
      
      const vouchChannel = guild.channels.cache.get(this.vouchChannelId);
      if (!vouchChannel) {
        console.error(`[VouchHandler:${this.instanceId}] Vouch channel not found: ${this.vouchChannelId}`);
        return false;
      }
      
      // Create embed for vouch
      const embed = new EmbedBuilder()
        .setColor('#25D366') // WhatsApp green
        .setTitle('📝 New Vouch')
        .setDescription(vouchText)
        .addFields(
          { name: 'From', value: name, inline: true },
          { name: 'Date', value: new Date().toLocaleDateString(), inline: true }
        )
        .setFooter({ text: `WhatsApp: ${phoneNumber}` })
        .setTimestamp();
      
      // Add media if available
      let files = [];
      
      if (mediaBuffer && mediaFileName) {
        // Save to temp file
        const mediaPath = path.join(this.tempDir, mediaFileName);
        fs.writeFileSync(mediaPath, mediaBuffer);
        
        // Add file to message
        files.push(new AttachmentBuilder(mediaPath, { name: mediaFileName }));
        
        // Add image to embed if it's an image
        if (mediaType && mediaType.includes('image')) {
          embed.setImage(`attachment://${mediaFileName}`);
        }
      }
      
      // Send to channel
      await vouchChannel.send({
        embeds: [embed],
        files
      });
      
      console.log(`[VouchHandler:${this.instanceId}] Posted vouch from ${name} (${phoneNumber}) to channel ${this.vouchChannelId}`);
      return true;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error posting vouch to Discord:`, error);
      return false;
    }
  }
}

module.exports = VouchHandler;
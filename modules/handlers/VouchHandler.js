// modules/handlers/VouchHandler.js - Completely Fixed Version
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
    
    console.log(`[VouchHandler:${this.instanceId}] Initialized with vouch channel ID: ${this.vouchChannelId}`);
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
   * Check if a Discord message mentions the vouch channel
   * @param {Object} message - Discord message
   * @returns {boolean} - Whether the message mentions the vouch channel
   */
  async checkForVouchChannelMention(message) {
    try {
      // Skip if disabled
      if (this.isDisabled) return false;
      if (!this.vouchChannelId) return false;
      
      // Get the channel mentions
      const mentionedChannels = message.mentions.channels;
      if (!mentionedChannels.size) return false;
      
      // Check if vouch channel is mentioned
      if (mentionedChannels.has(this.vouchChannelId)) {
        // Get user from the channel if it's tied to a WhatsApp user
        const phoneNumber = await this.channelManager.getPhoneNumberByChannelId(message.channel.id);
        if (!phoneNumber) return false;
        
        // Get user card
        const userCard = this.userCardManager ? 
          await this.userCardManager.getUserInfo(phoneNumber) : null;
          
        // Extract channel name
        const vouchChannel = this.discordClient.channels.cache.get(this.vouchChannelId);
        const channelName = vouchChannel ? vouchChannel.name : 'vouch channel';
        
        // Send a message with the channel name and instructions
        try {
          await message.channel.send({
            content: `**Vouch Channel: #${channelName}**\n\n${message.content.replace(/<#\d+>/g, '')}`,
          });
          
          // Send vouch instructions
          await this.sendVouchInstructions(phoneNumber, userCard);
          
          return true;
        } catch (sendError) {
          console.error(`[VouchHandler:${this.instanceId}] Error sending channel mention response:`, sendError);
          return false;
        }
      }
      
      return false;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error checking for vouch channel mention:`, error);
      return false;
    }
  }
  
  /**
   * Process !vouch command from Discord
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success status
   */
  async processVouchCommand(message) {
    try {
      // Skip if disabled
      if (this.isDisabled) {
        console.log(`[VouchHandler:${this.instanceId}] Vouches are disabled, skipping !vouch command`);
        return false;
      }
      
      // Get phone number from channel
      const phoneNumber = await this.channelManager.getPhoneNumberByChannelId(message.channel.id);
      if (!phoneNumber) {
        console.log(`[VouchHandler:${this.instanceId}] No phone number found for channel ${message.channel.id}`);
        
        await message.reply({
          content: "❌ This command can only be used in WhatsApp ticket channels."
        });
        
        return false;
      }
      
      // Get user card
      const userCard = this.userCardManager ? 
        await this.userCardManager.getUserInfo(phoneNumber) : null;
      
      // Look for media to attach (gif/video from assets)
      const mediaPath = await this.findVouchMediaInAssets();
      
      // Send the instructions
      await message.reply({
        content: "✅ Sending vouch instructions to the user..."
      });
      
      // Send vouch instructions to WhatsApp user
      const success = await this.sendVouchInstructions(phoneNumber, userCard, mediaPath);
      
      if (!success) {
        await message.reply({
          content: "❌ Failed to send vouch instructions. Please check the logs for more details."
        });
        return false;
      }
      
      return true;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error processing vouch command:`, error);
      
      try {
        await message.reply({
          content: `❌ Error sending vouch instructions: ${error.message}`
        });
      } catch (replyError) {
        console.error(`[VouchHandler:${this.instanceId}] Error sending error reply:`, replyError);
      }
      
      return false;
    }
  }
  
  /**
   * Find vouch media (gif/video) in assets directory
   * @returns {Promise<string|null>} - Path to media or null if not found
   */
  async findVouchMediaInAssets() {
    try {
      if (!fs.existsSync(this.assetsDir)) {
        return null;
      }
      
      // Look for vouch-specific media in assets folder
      const files = fs.readdirSync(this.assetsDir);
      
      // Check for vouch media in specific order of preference
      const mediaNames = [
        'vouch.gif',
        'vouch.mp4',
        'vouch-instruction.gif',
        'vouch-instruction.mp4',
        'vouch-instructions.gif',
        'vouch-instructions.mp4'
      ];
      
      for (const mediaName of mediaNames) {
        if (files.includes(mediaName)) {
          return path.join(this.assetsDir, mediaName);
        }
      }
      
      // If no specific vouch media, look for any gif/mp4
      for (const file of files) {
        if (file.endsWith('.gif') || file.endsWith('.mp4')) {
          return path.join(this.assetsDir, file);
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error finding vouch media:`, error);
      return null;
    }
  }
  
  /**
   * Send vouch instructions to a user
   * @param {string} phoneNumber - Phone number to send to
   * @param {Object} userCard - User card
   * @param {string} mediaPath - Optional path to media file to attach
   * @returns {Promise<boolean>} - Success status
   */
  async sendVouchInstructions(phoneNumber, userCard, mediaPath = null) {
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
      const messageText = this.vouchMessage
        .replace(/{name}/g, name)
        .replace(/{phoneNumber}/g, phoneNumber);
      
      // Ensure the phoneNumber is in the correct format for WhatsApp
      const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
      const recipientJid = `${cleanPhone}@s.whatsapp.net`;
      
      // Check if we need to send with media
      if (mediaPath && fs.existsSync(mediaPath)) {
        try {
          // Read the media file
          const mediaBuffer = fs.readFileSync(mediaPath);
          const mediaType = mediaPath.endsWith('.gif') ? 'image/gif' : 'video/mp4';
          const mediaFilename = path.basename(mediaPath);
          
          // Send message with media
          if (mediaType.startsWith('image/')) {
            // Send as image
            await this.whatsAppClient.sendMessage(recipientJid, {
              image: mediaBuffer,
              caption: messageText,
              mimetype: mediaType
            });
          } else {
            // Send as video
            await this.whatsAppClient.sendMessage(recipientJid, {
              video: mediaBuffer,
              caption: messageText,
              mimetype: mediaType
            });
          }
          
          console.log(`[VouchHandler:${this.instanceId}] Sent vouch instructions with media to ${name} (${phoneNumber})`);
          return true;
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error sending with media, falling back to text:`, mediaError);
          // Continue to text-only if media fails
        }
      }
      
      // Send as text-only message
      await this.whatsAppClient.sendMessage(recipientJid, {
        text: messageText
      });
      
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
        const recipientJid = `${phoneNumber.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        await this.whatsAppClient.sendMessage(
          recipientJid,
          { text: "Please provide more details with your vouch! Just add your feedback after 'Vouch!'" }
        );
        return false;
      }
      
      // Process media if present
      let mediaBuffer = null;
      let mediaType = null;
      let mediaFileName = null;
      
      if (messageContent.type && messageContent.type !== 'text') {
        try {
          // Download media
          console.log(`[VouchHandler:${this.instanceId}] Processing media type: ${messageContent.type}`);
          
          // Ensure proper media download with Baileys
          if (typeof this.whatsAppClient.downloadMedia === 'function') {
            mediaBuffer = await this.whatsAppClient.downloadMedia(originalMessage);
          } else if (typeof this.whatsAppClient.downloadMediaMessage === 'function') {
            mediaBuffer = await this.whatsAppClient.downloadMediaMessage(originalMessage);
          } else {
            console.error(`[VouchHandler:${this.instanceId}] No media download function available`);
          }
          
          mediaType = messageContent.type;
          mediaFileName = messageContent.fileName || `vouch-media-${Date.now()}.${mediaType.split('/')[1] || 'bin'}`;
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error downloading media:`, mediaError);
          // Continue without media
        }
      }
      
      // Post vouch to Discord
      const success = await this.postVouchToDiscord(name, phoneNumber, vouchText, mediaBuffer, mediaType, mediaFileName);
      
      if (success) {
        // Send success message back to user
        const recipientJid = `${phoneNumber.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        await this.whatsAppClient.sendMessage(
          recipientJid,
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
        try {
          // Save to temp file
          const mediaPath = path.join(this.tempDir, mediaFileName);
          fs.writeFileSync(mediaPath, mediaBuffer);
          
          // Add file to message
          files.push(new AttachmentBuilder(mediaPath, { name: mediaFileName }));
          
          // Add image to embed if it's an image
          if (mediaType && mediaType.includes('image')) {
            embed.setImage(`attachment://${mediaFileName}`);
          }
          
          console.log(`[VouchHandler:${this.instanceId}] Added media to vouch: ${mediaFileName}`);
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error attaching media:`, mediaError);
          // Continue without media
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
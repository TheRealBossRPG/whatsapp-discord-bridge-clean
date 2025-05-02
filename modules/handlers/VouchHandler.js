// modules/handlers/VouchHandler.js - Fixed for @whiskeysockets/baileys compatibility
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
   * @returns {Promise<boolean>} - Whether the message mentions the vouch channel
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
        const phoneNumber = await this.channelManager?.getPhoneNumberByChannelId(message.channel.id);
        if (!phoneNumber) return false;
        
        // Get user card
        const userCard = this.userCardManager ? 
          await this.userCardManager.getUserInfo(phoneNumber) : null;
          
        // Extract channel name
        const vouchChannel = this.discordClient.channels.cache.get(this.vouchChannelId);
        const channelName = vouchChannel ? vouchChannel.name : 'vouch channel';
        
        // Send a message with the channel name and instructions
        try {
          // Replace all channel mentions with just the channel name
          const modifiedContent = message.content.replace(/<#(\d+)>/g, (match, channelId) => {
            if (channelId === this.vouchChannelId) {
              return `#${channelName}`;
            }
            return match;
          });
          
          await message.channel.send({
            content: modifiedContent,
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
      const phoneNumber = await this.channelManager?.getPhoneNumberByChannelId(message.channel.id);
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
      
      // Get user name - try multiple methods to extract it
      let name = 'there';
      if (userCard) {
        if (typeof userCard === 'string') {
          name = userCard;
        } else if (userCard.name) {
          name = userCard.name;
        } else if (userCard.username) {
          name = userCard.username;
        }
      }
      
      // Format message
      const messageText = this.vouchMessage
        .replace(/{name}/g, name)
        .replace(/{phoneNumber}/g, phoneNumber);
      
      // Ensure the phoneNumber is in the correct format for WhatsApp
      // Convert to string first in case it's a number
      let cleanPhone = String(phoneNumber).replace(/\D/g, '');
      // If it starts with '+', remove it
      cleanPhone = cleanPhone.replace(/^\+/, '');
      
      const recipientJid = `${cleanPhone}@s.whatsapp.net`;
      
      // Check if we need to send with media
      if (mediaPath && fs.existsSync(mediaPath)) {
        try {
          // Read the media file
          const mediaBuffer = fs.readFileSync(mediaPath);
          const mediaType = mediaPath.endsWith('.gif') ? 'image/gif' : 'video/mp4';
          
          // Send with correct media type
          if (mediaPath.endsWith('.gif')) {
            // Send as image with @whiskeysockets/baileys
            await this.whatsAppClient.sendMessage(recipientJid, {
              image: mediaBuffer,
              caption: messageText,
              mimetype: mediaType
            });
          } else {
            // Send as video with @whiskeysockets/baileys
            await this.whatsAppClient.sendMessage(recipientJid, {
              video: mediaBuffer,
              caption: messageText,
              mimetype: mediaType
            });
          }
          
          console.log(`[VouchHandler:${this.instanceId}] Sent vouch instructions with media to ${name} (${phoneNumber})`);
          return true;
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error sending with media:`, mediaError);
          console.error(`[VouchHandler:${this.instanceId}] Full error:`, mediaError.stack || mediaError);
          // Continue to text-only if media fails
        }
      }
      
      // Send as text-only message with @whiskeysockets/baileys
      try {
        await this.whatsAppClient.sendMessage(recipientJid, { text: messageText });
        console.log(`[VouchHandler:${this.instanceId}] Sent vouch instructions to ${name} (${phoneNumber})`);
        return true;
      } catch (textError) {
        console.error(`[VouchHandler:${this.instanceId}] Error sending text message:`, textError);
        console.error(`[VouchHandler:${this.instanceId}] Full error stack:`, textError.stack || textError);
        throw textError; // Re-throw for proper error handling
      }
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error sending vouch instructions:`, error);
      console.error(`[VouchHandler:${this.instanceId}] Error details:`, error.stack || error);
      return false;
    }
  }
  
  /**
   * Extract text from WhatsApp message
   * @param {Object} message - WhatsApp message
   * @returns {string|null} - Message text or null if not found
   */
  extractMessageText(message) {
    if (!message || !message.message) return null;
    
    // Check different message types
    if (message.message.conversation) {
      return message.message.conversation;
    } else if (message.message.extendedTextMessage && message.message.extendedTextMessage.text) {
      return message.message.extendedTextMessage.text;
    } else if (message.message.imageMessage && message.message.imageMessage.caption) {
      return message.message.imageMessage.caption;
    } else if (message.message.videoMessage && message.message.videoMessage.caption) {
      return message.message.videoMessage.caption;
    } else if (message.message.documentMessage && message.message.documentMessage.caption) {
      return message.message.documentMessage.caption;
    }
    
    return null;
  }
  
  /**
   * Download media from WhatsApp message
   * @param {Object} message - WhatsApp message
   * @returns {Promise<Buffer|null>} - Media buffer or null if download failed
   */
  async downloadMedia(message) {
    try {
      if (!message || !message.message) {
        console.log(`[VouchHandler:${this.instanceId}] No message to download media from`);
        return null;
      }
      
      // Try multiple methods to download media based on the WhatsApp client
      try {
        // Method 1: Try downloadMediaMessage (most common)
        if (typeof this.whatsAppClient.downloadMediaMessage === 'function') {
          return await this.whatsAppClient.downloadMediaMessage(message);
        }
        
        // Method 2: Try downloadMedia
        if (typeof this.whatsAppClient.downloadMedia === 'function') {
          return await this.whatsAppClient.downloadMedia(message);
        }
        
        // Method 3: Try download (older versions)
        if (typeof this.whatsAppClient.download === 'function') {
          return await this.whatsAppClient.download(message);
        }
        
        console.error(`[VouchHandler:${this.instanceId}] No download method available`);
        return null;
      } catch (downloadError) {
        console.error(`[VouchHandler:${this.instanceId}] Error downloading media:`, downloadError);
        return null;
      }
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error in downloadMedia:`, error);
      return null;
    }
  }
  
  /**
   * Handle a vouch from WhatsApp
   * IMPORTANT: This is the original method name that's being called
   * @param {string} phoneNumber - Sender's phone number
   * @param {Object} messageContent - Content of the message
   * @param {Object} userCard - User card from manager
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
      
      console.log(`[VouchHandler:${this.instanceId}] Processing vouch from ${phoneNumber}`);
      
      // Extract message text
      let vouchText = '';
      
      // Make sure messageContent is properly processed
      if (typeof messageContent === 'string') {
        vouchText = messageContent.replace(/^vouch!/i, '').trim();
      } else if (messageContent && messageContent.text) {
        vouchText = messageContent.text.replace(/^vouch!/i, '').trim();
      } else if (originalMessage) {
        // Try to extract text from the original message
        const extractedText = this.extractMessageText(originalMessage);
        if (extractedText) {
          vouchText = extractedText.replace(/^vouch!/i, '').trim();
        }
      }
      
      // Check if vouch text is substantial enough
      if (vouchText.length < 2) {
        // Vouch text too short - ask for more detail
        const cleanPhone = String(phoneNumber).replace(/\D/g, '').replace(/^\+/, '');
        const recipientJid = `${cleanPhone}@s.whatsapp.net`;
        
        await this.whatsAppClient.sendMessage(
          recipientJid,
          { text: "Please provide more details with your vouch! Just add your feedback after 'Vouch!'" }
        );
        
        console.log(`[VouchHandler:${this.instanceId}] Vouch text too short, requested more details`);
        return false;
      }
      
      // Get user name
      let name = 'Unknown User';
      if (userCard) {
        if (typeof userCard === 'string') {
          name = userCard;
        } else if (userCard.name) {
          name = userCard.name;
        } else if (userCard.username) {
          name = userCard.username;
        }
      }
      
      console.log(`[VouchHandler:${this.instanceId}] Processing vouch from ${name} (${phoneNumber}): "${vouchText.substring(0, 30)}..."`);
      
      // Handle media if present
      let mediaBuffer = null;
      let mediaType = null;
      let mediaFileName = null;
      
      if (originalMessage) {
        try {
          if (originalMessage.message?.imageMessage) {
            mediaBuffer = await this.downloadMedia(originalMessage);
            mediaType = 'image';
            mediaFileName = `vouch-image-${Date.now()}.jpg`;
          } else if (originalMessage.message?.videoMessage) {
            mediaBuffer = await this.downloadMedia(originalMessage);
            mediaType = 'video';
            mediaFileName = `vouch-video-${Date.now()}.mp4`;
          } else if (originalMessage.message?.documentMessage) {
            mediaBuffer = await this.downloadMedia(originalMessage);
            mediaType = 'document';
            mediaFileName = originalMessage.message.documentMessage.fileName || `vouch-doc-${Date.now()}.bin`;
          }
          
          if (mediaBuffer) {
            console.log(`[VouchHandler:${this.instanceId}] Vouch includes media of type: ${mediaType}`);
          }
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error processing media:`, mediaError);
          // Continue without media
        }
      } else if (messageContent && messageContent.media) {
        // Handle case where media is provided directly in messageContent
        try {
          mediaBuffer = messageContent.media;
          mediaType = messageContent.mediaType || 'image';
          mediaFileName = messageContent.fileName || `vouch-media-${Date.now()}.bin`;
        } catch (error) {
          console.error(`[VouchHandler:${this.instanceId}] Error with provided media:`, error);
          // Continue without media
        }
      }
      
      // Post to Discord
      const success = await this.postVouchToDiscord(name, phoneNumber, vouchText, mediaBuffer, mediaType, mediaFileName);
      
      // Send confirmation message
      if (success) {
        const cleanPhone = String(phoneNumber).replace(/\D/g, '').replace(/^\+/, '');
        const recipientJid = `${cleanPhone}@s.whatsapp.net`;
        
        await this.whatsAppClient.sendMessage(
          recipientJid,
          { text: this.vouchSuccessMessage }
        );
        
        console.log(`[VouchHandler:${this.instanceId}] Sent vouch success message to ${phoneNumber}`);
      }
      
      return success;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error handling vouch:`, error);
      console.error(error.stack);
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
  
  /**
   * Process incoming WhatsApp message to check if it's a vouch
   * @param {Object} message - WhatsApp message
   * @returns {Promise<boolean>} - Whether message was processed as vouch
   */
  async processWhatsAppVouch(message) {
    try {
      // Skip if disabled or no message
      if (this.isDisabled || !message) return false;
      
      // Extract text from message
      const messageText = this.extractMessageText(message);
      if (!messageText) return false;
      
      // Check if it's a vouch message
      if (!messageText.trim().toLowerCase().startsWith('vouch!')) {
        return false;
      }
      
      // Extract phone number from the message
      const sender = message.key.remoteJid;
      if (!sender) return false;
      
      const phoneNumber = sender.split('@')[0];
      
      // Get user info
      const userCard = this.userCardManager ? 
        await this.userCardManager.getUserInfo(phoneNumber) : null;
      
      // Process the vouch
      return await this.handleVouch(
        phoneNumber,
        { text: messageText },
        userCard,
        message
      );
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error processing WhatsApp vouch:`, error);
      return false;
    }
  }
}

module.exports = VouchHandler;
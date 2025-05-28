// modules/handlers/VouchHandler.js - Complete rewrite for proper vouch handling
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
    
    // Error message for empty vouch
    this.emptyVouchMessage = "Please provide feedback with your vouch! Just add your message after 'Vouch!'";
    
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
   * Process !vouch command from Discord
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success status
   */
  async processVouchCommand(message) {
    try {
      // Skip if disabled
      if (this.isDisabled) {
        console.log(`[VouchHandler:${this.instanceId}] Vouches are disabled, skipping !vouch command`);
        // Don't even acknowledge the command if disabled
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
      
      // Send feedback
      await message.reply({
        content: "✅ Sending vouch instructions to the user..."
      });
      
      // Send vouch instructions to WhatsApp user
      const success = await this.sendVouchInstructions(phoneNumber, userCard, mediaPath);
      
      if (!success) {
        await message.followUp({
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
        'vouch.webm',
        'vouch.png',
        'vouch.jpg',
        'vouch.jpeg',
        'vouch.webp'
      ];
      
      for (const mediaName of mediaNames) {
        if (files.includes(mediaName)) {
          return path.join(this.assetsDir, mediaName);
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
      // Skip if disabled (shouldn't reach here if properly checked)
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
      
      // Clean phone number
      let cleanPhone = String(phoneNumber).replace(/\D/g, '');
      cleanPhone = cleanPhone.replace(/^\+/, '');
      const recipientJid = `${cleanPhone}@s.whatsapp.net`;
      
      // Check if we need to send with media
      if (mediaPath && fs.existsSync(mediaPath)) {
        try {
          // Read the media file
          const mediaBuffer = fs.readFileSync(mediaPath);
          const ext = path.extname(mediaPath).toLowerCase();
          
          // Determine media type and send appropriately
          if (ext === '.gif' || ext === '.webp') {
            await this.sendMediaMessage(recipientJid, {
              image: mediaBuffer,
              caption: messageText,
              mimetype: ext === '.gif' ? 'image/gif' : 'image/webp'
            });
          } else if (['.mp4', '.webm'].includes(ext)) {
            await this.sendMediaMessage(recipientJid, {
              video: mediaBuffer,
              caption: messageText,
              mimetype: ext === '.mp4' ? 'video/mp4' : 'video/webm'
            });
          } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
            await this.sendMediaMessage(recipientJid, {
              image: mediaBuffer,
              caption: messageText,
              mimetype: `image/${ext.substring(1)}`
            });
          }
          
          console.log(`[VouchHandler:${this.instanceId}] Sent vouch instructions with media to ${name} (${phoneNumber})`);
          return true;
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error sending with media:`, mediaError);
          // Continue to text-only if media fails
        }
      }
      
      // Send as text-only message
      try {
        await this.sendTextMessage(recipientJid, messageText);
        console.log(`[VouchHandler:${this.instanceId}] Sent vouch instructions to ${name} (${phoneNumber})`);
        return true;
      } catch (textError) {
        console.error(`[VouchHandler:${this.instanceId}] Error sending text message:`, textError);
        throw textError;
      }
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error sending vouch instructions:`, error);
      return false;
    }
  }
  
  /**
   * Process WhatsApp message to check if it's a vouch
   * @param {Object} message - WhatsApp message
   * @returns {Promise<boolean>} - Whether message was processed as vouch
   */
  async processWhatsAppVouch(message) {
    try {
      // Skip if disabled
      if (this.isDisabled) {
        return false;
      }
      
      // Extract text from message
      const messageText = this.extractMessageText(message);
      
      // Check if it starts with "Vouch!"
      if (!messageText || !messageText.trim().toLowerCase().startsWith('vouch!')) {
        return false;
      }
      
      console.log(`[VouchHandler:${this.instanceId}] Vouch message detected`);
      
      // Extract phone number from message
      const sender = message.key?.remoteJid;
      if (!sender) {
        console.error(`[VouchHandler:${this.instanceId}] Could not find sender JID in message`);
        return false;
      }
      
      const phoneNumber = sender.split('@')[0];
      
      // Get user info
      const userCard = this.userCardManager ? 
        await this.userCardManager.getUserInfo(phoneNumber) : null;
      
      // Process the vouch
      return await this.handleVouch(phoneNumber, { text: messageText }, userCard, message);
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error processing WhatsApp vouch:`, error);
      return false;
    }
  }
  
  /**
   * Handle a vouch from WhatsApp
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
        return false;
      }
      
      // Check if vouch channel is set
      if (!this.vouchChannelId) {
        console.error(`[VouchHandler:${this.instanceId}] Vouch channel not set`);
        return false;
      }
      
      console.log(`[VouchHandler:${this.instanceId}] Processing vouch from ${phoneNumber}`);
      
      // Extract vouch text (remove "Vouch!" prefix)
      let vouchText = '';
      if (typeof messageContent === 'string') {
        vouchText = messageContent.replace(/^vouch!/i, '').trim();
      } else if (messageContent && messageContent.text) {
        vouchText = messageContent.text.replace(/^vouch!/i, '').trim();
      } else if (originalMessage) {
        const extractedText = this.extractMessageText(originalMessage);
        if (extractedText) {
          vouchText = extractedText.replace(/^vouch!/i, '').trim();
        }
      }
      
      // Clean phone number for response
      let cleanPhone = String(phoneNumber).replace(/\D/g, '');
      cleanPhone = cleanPhone.replace(/^\+/, '');
      const recipientJid = `${cleanPhone}@s.whatsapp.net`;
      
      // Check if vouch text is empty
      if (!vouchText || vouchText.length < 3) {
        console.log(`[VouchHandler:${this.instanceId}] Empty vouch detected, sending error message`);
        
        try {
          await this.sendTextMessage(recipientJid, this.emptyVouchMessage);
        } catch (sendError) {
          console.error(`[VouchHandler:${this.instanceId}] Error sending empty vouch error:`, sendError);
        }
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
      
      // Handle media if present
      let mediaBuffer = null;
      let mediaType = null;
      let mediaFileName = null;
      
      if (originalMessage && this.hasMedia(originalMessage)) {
        try {
          mediaBuffer = await this.downloadMedia(originalMessage);
          
          if (originalMessage.message?.imageMessage) {
            mediaType = 'image';
            mediaFileName = `vouch-image-${Date.now()}.jpg`;
          } else if (originalMessage.message?.videoMessage) {
            mediaType = 'video';
            mediaFileName = `vouch-video-${Date.now()}.mp4`;
          } else if (originalMessage.message?.documentMessage) {
            mediaType = 'document';
            mediaFileName = originalMessage.message.documentMessage.fileName || `vouch-doc-${Date.now()}.bin`;
          }
          
          if (mediaBuffer) {
            console.log(`[VouchHandler:${this.instanceId}] Downloaded media for vouch`);
          }
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error processing media:`, mediaError);
        }
      }
      
      // Find channel and helpers
      let helpers = ["Support Team"];
      try {
        if (this.channelManager) {
          const channelId = this.channelManager.getUserChannel(phoneNumber);
          if (channelId) {
            const channel = this.discordClient.channels.cache.get(channelId);
            if (channel) {
              helpers = await this.findTicketHelpers(channel);
            }
          }
        }
      } catch (helpersError) {
        console.error(`[VouchHandler:${this.instanceId}] Error finding helpers:`, helpersError);
      }
      
      // Post to Discord
      const success = await this.postVouchToDiscord(name, phoneNumber, vouchText, helpers, mediaBuffer, mediaType, mediaFileName);
      
      // Send confirmation message
      if (success) {
        try {
          await this.sendTextMessage(recipientJid, this.vouchSuccessMessage);
          console.log(`[VouchHandler:${this.instanceId}] Sent vouch success message`);
        } catch (sendError) {
          console.error(`[VouchHandler:${this.instanceId}] Error sending success message:`, sendError);
        }
      } else {
        try {
          await this.sendTextMessage(recipientJid, "❌ Sorry, there was an error posting your vouch. Please try again later.");
        } catch (sendError) {
          console.error(`[VouchHandler:${this.instanceId}] Error sending error message:`, sendError);
        }
      }
      
      return success;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error handling vouch:`, error);
      return false;
    }
  }
  
  /**
   * Find all helpers in a ticket channel
   * @param {Object} channel - Discord channel
   * @returns {Promise<Array>} - Array of helper usernames
   */
  async findTicketHelpers(channel) {
    try {
      const helpers = new Set();
      
      if (!channel) return ["Support Team"];
      
      // Get recent messages
      const messages = await channel.messages.fetch({ limit: 100 });
      
      // Find unique authors who aren't bots
      for (const [_, message] of messages) {
        if (!message.author.bot && message.member) {
          const authorName = message.member.displayName || message.author.username;
          helpers.add(authorName);
        }
      }
      
      return [...helpers].filter(h => h); // Filter out any empty names
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error finding ticket helpers:`, error);
      return ["Support Team"];
    }
  }
  
  /**
   * Post vouch to Discord channel with proper formatting
   * @param {string} name - User name
   * @param {string} phoneNumber - Phone number
   * @param {string} vouchText - Vouch text
   * @param {Array} helpers - Array of helpers' names
   * @param {Buffer} mediaBuffer - Media buffer (optional)
   * @param {string} mediaType - Media type (optional)
   * @param {string} mediaFileName - Media filename (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async postVouchToDiscord(name, phoneNumber, vouchText, helpers = ["Support Team"], mediaBuffer = null, mediaType = null, mediaFileName = null) {
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
      
      // Format helpers list
      let helpersText = helpers.length > 0 ? helpers.join(', ') : 'Support Team';
      
      // Create embed for better formatting
      const embed = new EmbedBuilder()
        .setColor(0x00ff00) // Green color
        .setTitle('📢 New Vouch!')
        .setDescription(`**${vouchText}**`)
        .addFields(
          { name: '👤 From', value: name, inline: true },
          { name: '🏷️ To', value: helpersText, inline: true },
          { name: '📱 WhatsApp', value: phoneNumber, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'WhatsApp Bridge Vouch System' });
      
      // Prepare files array if media is present
      let files = [];
      if (mediaBuffer && mediaFileName) {
        try {
          // Save to temp file
          const mediaPath = path.join(this.tempDir, mediaFileName);
          fs.writeFileSync(mediaPath, mediaBuffer);
          
          // Add file
          files.push(new AttachmentBuilder(mediaPath, { name: mediaFileName }));
          
          // Add media indicator to embed
          if (mediaType === 'image') {
            embed.setImage(`attachment://${mediaFileName}`);
          } else if (mediaType === 'video') {
            embed.addFields({ name: '📹 Attachment', value: 'Video attached', inline: false });
          } else if (mediaType === 'document') {
            embed.addFields({ name: '📄 Attachment', value: 'Document attached', inline: false });
          }
          
          console.log(`[VouchHandler:${this.instanceId}] Added media to vouch: ${mediaFileName}`);
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error attaching media:`, mediaError);
        }
      }
      
      // Send the vouch
      await vouchChannel.send({
        embeds: [embed],
        files
      });
      
      console.log(`[VouchHandler:${this.instanceId}] Posted vouch from ${name} (${phoneNumber})`);
      
      // Clean up temp files
      if (files.length > 0) {
        setTimeout(() => {
          try {
            for (const file of files) {
              if (file.attachment && typeof file.attachment === 'string' && fs.existsSync(file.attachment)) {
                fs.unlinkSync(file.attachment);
              }
            }
          } catch (cleanupError) {
            console.error(`[VouchHandler:${this.instanceId}] Error cleaning up temp files:`, cleanupError);
          }
        }, 5000);
      }
      
      return true;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error posting vouch to Discord:`, error);
      return false;
    }
  }
  
  /**
   * Send text message helper
   */
  async sendTextMessage(jid, text) {
    try {
      if (this.whatsAppClient.sock && typeof this.whatsAppClient.sock.sendMessage === 'function') {
        await this.whatsAppClient.sock.sendMessage(jid, { text });
        return true;
      } else if (typeof this.whatsAppClient.sendMessage === 'function') {
        await this.whatsAppClient.sendMessage(jid, { text });
        return true;
      }
      
      throw new Error("No suitable send method found");
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error sending text message:`, error);
      throw error;
    }
  }
  
  /**
   * Send media message helper
   */
  async sendMediaMessage(jid, content) {
    try {
      if (this.whatsAppClient.sock && typeof this.whatsAppClient.sock.sendMessage === 'function') {
        await this.whatsAppClient.sock.sendMessage(jid, content);
        return true;
      } else if (typeof this.whatsAppClient.sendMessage === 'function') {
        await this.whatsAppClient.sendMessage(jid, content);
        return true;
      }
      
      throw new Error("No suitable send method found");
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error sending media message:`, error);
      throw error;
    }
  }
  
  /**
   * Extract text from WhatsApp message
   */
  extractMessageText(message) {
    if (!message) return null;
    
    try {
      if (typeof message === 'string') return message;
      if (message.text) return message.text;
      if (message.caption) return message.caption;
      if (message.content) return message.content;
      
      if (message.message) {
        if (message.message.conversation) return message.message.conversation;
        if (message.message.extendedTextMessage?.text) return message.message.extendedTextMessage.text;
        if (message.message.imageMessage?.caption) return message.message.imageMessage.caption;
        if (message.message.videoMessage?.caption) return message.message.videoMessage.caption;
        if (message.message.documentMessage?.caption) return message.message.documentMessage.caption;
      }
      
      return null;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error extracting message text:`, error);
      return null;
    }
  }
  
  /**
   * Check if message has media
   */
  hasMedia(message) {
    if (!message || !message.message) return false;
    
    return !!(
      message.message.imageMessage ||
      message.message.videoMessage ||
      message.message.documentMessage ||
      message.message.stickerMessage ||
      message.message.audioMessage
    );
  }
  
  /**
   * Download media from message
   */
  async downloadMedia(message) {
    try {
      if (!message || !message.message) return null;
      
      console.log(`[VouchHandler:${this.instanceId}] Attempting to download media`);
      
      // Try different methods based on client type
      if (this.whatsAppClient.sock && typeof this.whatsAppClient.sock.downloadMediaMessage === 'function') {
        const buffer = await this.whatsAppClient.sock.downloadMediaMessage(message);
        if (buffer) return buffer;
      }
      
      if (typeof this.whatsAppClient.downloadMediaMessage === 'function') {
        const buffer = await this.whatsAppClient.downloadMediaMessage(message);
        if (buffer) return buffer;
      }
      
      if (typeof this.whatsAppClient.downloadMedia === 'function') {
        const buffer = await this.whatsAppClient.downloadMedia(message);
        if (buffer) return buffer;
      }
      
      console.error(`[VouchHandler:${this.instanceId}] No suitable download method found`);
      return null;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error downloading media:`, error);
      return null;
    }
  }
}

module.exports = VouchHandler;
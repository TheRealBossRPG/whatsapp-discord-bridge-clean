// modules/handlers/VouchHandler.js - Fixed media detection and proper embed formatting
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * Handles vouch commands and processing
 */
class VouchHandler {
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
    
    // FIXED: Load custom messages from instance settings
    this.loadInstanceSettings();
    
    // Create directories if they don't exist
    for (const dir of [this.tempDir, this.assetsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    console.log(`[VouchHandler:${this.instanceId}] Initialized with vouch channel ID: ${this.vouchChannelId}`);
  }
  
  /**
   * Load instance-specific settings
   */
  loadInstanceSettings() {
    try {
      const settingsPath = path.join(__dirname, '..', '..', 'instances', this.instanceId, 'settings.json');
      
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        
        // Use instance-specific messages or defaults
        this.vouchMessage = settings.vouchMessage || 
          "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
        
        this.vouchSuccessMessage = settings.vouchSuccessMessage || 
          "✅ Thank you for your vouch! It has been posted to our community channel.";
        
        console.log(`[VouchHandler:${this.instanceId}] Loaded instance-specific vouch messages`);
      } else {
        // Set defaults
        this.vouchMessage = "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
        this.vouchSuccessMessage = "✅ Thank you for your vouch! It has been posted to our community channel.";
      }
      
      this.emptyVouchMessage = "Please provide feedback with your vouch! Just add your message after 'Vouch!'";
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error loading instance settings:`, error);
      // Use defaults
      this.vouchMessage = "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.";
      this.vouchSuccessMessage = "✅ Thank you for your vouch! It has been posted to our community channel.";
      this.emptyVouchMessage = "Please provide feedback with your vouch! Just add your message after 'Vouch!'";
    }
  }
  
  /**
   * Set channel manager reference
   */
  setChannelManager(channelManager) {
    this.channelManager = channelManager;
  }
  
  /**
   * Set custom vouch message
   */
  setCustomVouchMessage(message) {
    if (message) {
      this.vouchMessage = message;
    }
  }
  
  /**
   * Set custom vouch success message
   */
  setCustomVouchSuccessMessage(message) {
    if (message) {
      this.vouchSuccessMessage = message;
    }
  }
  
  /**
   * Process !vouch command from Discord - FIXED to include vouch media
   */
  async processVouchCommand(message) {
    try {
      if (this.isDisabled) {
        console.log(`[VouchHandler:${this.instanceId}] Vouches are disabled, skipping !vouch command`);
        return false;
      }
      
      const phoneNumber = this.channelManager?.getPhoneNumberByChannelId(message.channel.id);
      if (!phoneNumber) {
        console.log(`[VouchHandler:${this.instanceId}] No phone number found for channel ${message.channel.id}`);
        await message.reply({
          content: "❌ This command can only be used in WhatsApp ticket channels."
        });
        return false;
      }
      
      const userCard = this.userCardManager ? 
        await this.userCardManager.getUserInfo(phoneNumber) : null;
      
      await message.reply({
        content: "✅ Sending vouch instructions to the user..."
      });
      
      // FIXED: Always check for and include vouch media
      const mediaPath = await this.findVouchMediaInAssets();
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
   * Find vouch media - FIXED to find any vouch.* file
   */
  async findVouchMediaInAssets() {
    try {
      if (!fs.existsSync(this.assetsDir)) {
        return null;
      }
      
      const files = fs.readdirSync(this.assetsDir);
      
      // Look for any file starting with "vouch."
      const vouchFile = files.find(file => file.startsWith('vouch.'));
      
      if (vouchFile) {
        const fullPath = path.join(this.assetsDir, vouchFile);
        console.log(`[VouchHandler:${this.instanceId}] Found vouch media: ${vouchFile}`);
        return fullPath;
      }
      
      return null;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error finding vouch media:`, error);
      return null;
    }
  }
  
  /**
   * Send vouch instructions with media support
   */
  async sendVouchInstructions(phoneNumber, userCard, mediaPath = null) {
    try {
      if (this.isDisabled) {
        console.log(`[VouchHandler:${this.instanceId}] Vouches are disabled, skipping`);
        return false;
      }
      
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
      
      // Format message using instance-specific template
      const messageText = this.vouchMessage
        .replace(/{name}/g, name)
        .replace(/{phoneNumber}/g, phoneNumber);
      
      // Clean phone number
      let cleanPhone = String(phoneNumber).replace(/\D/g, '');
      cleanPhone = cleanPhone.replace(/^\+/, '');
      const recipientJid = `${cleanPhone}@s.whatsapp.net`;
      
      // FIXED: Send with media if available
      if (mediaPath && fs.existsSync(mediaPath)) {
        try {
          const mediaBuffer = fs.readFileSync(mediaPath);
          const ext = path.extname(mediaPath).toLowerCase();
          
          console.log(`[VouchHandler:${this.instanceId}] Sending vouch instructions with media: ${ext}`);
          
          // Determine media type and send appropriately
          if (ext === '.gif') {
            await this.sendMediaMessage(recipientJid, {
              image: mediaBuffer,
              caption: messageText,
              mimetype: 'image/gif'
            });
          } else if (ext === '.webp') {
            await this.sendMediaMessage(recipientJid, {
              image: mediaBuffer,
              caption: messageText,
              mimetype: 'image/webp'
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
          // Fall back to text-only
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
   * MAIN METHOD: Check if a WhatsApp message is a vouch and process it - FIXED media handling
   */
  async handleVouch(phoneNumber, message, userCard) {
    try {
      if (this.isDisabled) {
        return false;
      }
      
      // Extract text from message
      const messageText = this.extractMessageText(message);
      
      // Check if it starts with "Vouch!" (case insensitive)
      if (!messageText || !messageText.trim().toLowerCase().startsWith('vouch!')) {
        return false;
      }
      
      console.log(`[VouchHandler:${this.instanceId}] Vouch message detected from ${phoneNumber}`);
      
      if (!this.vouchChannelId) {
        console.error(`[VouchHandler:${this.instanceId}] Vouch channel not set`);
        return false;
      }
      
      // Extract vouch text (remove "Vouch!" prefix)
      let vouchText = messageText.replace(/^vouch!/i, '').trim();
      
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
        return true; // Return true because we handled the vouch attempt
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
      
      // FIXED: Handle media if present in the vouch message
      let mediaBuffer = null;
      let mediaType = null;
      let mediaFileName = null;
      
      if (this.hasMedia(message)) {
        try {
          console.log(`[VouchHandler:${this.instanceId}] Vouch contains media, downloading...`);
          const mediaData = await this.downloadMedia(message);
          
          if (mediaData && mediaData.buffer) {
            mediaBuffer = mediaData.buffer;
            
            if (message.message?.imageMessage) {
              mediaType = 'image';
              const isGif = message.message.imageMessage.mimetype === 'image/gif';
              mediaFileName = `vouch-${Date.now()}.${isGif ? 'gif' : 'jpg'}`;
            } else if (message.message?.videoMessage) {
              mediaType = 'video';
              mediaFileName = `vouch-${Date.now()}.mp4`;
            } else if (message.message?.documentMessage) {
              mediaType = 'document';
              mediaFileName = message.message.documentMessage.fileName || `vouch-${Date.now()}.bin`;
            }
            
            console.log(`[VouchHandler:${this.instanceId}] Downloaded vouch media: ${mediaFileName}`);
          }
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error processing vouch media:`, mediaError);
        }
      }
      
      // Find helpers from the ticket channel
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
      
      // Post to Discord with FIXED embed formatting
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
      
      return true; // Always return true for vouch attempts (handled)
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error handling vouch:`, error);
      return false;
    }
  }
  
  /**
   * Find all helpers in a ticket channel
   */
  async findTicketHelpers(channel) {
    try {
      const helpers = new Set();
      
      if (!channel) return ["Support Team"];
      
      const messages = await channel.messages.fetch({ limit: 100 });
      
      for (const [_, message] of messages) {
        if (!message.author.bot && message.member && message.content.trim().length > 0) {
          const authorName = message.member.displayName || message.author.username;
          helpers.add(authorName);
        }
      }
      
      const helpersList = [...helpers].filter(h => h && h !== 'Unknown User');
      return helpersList.length > 0 ? helpersList : ["Support Team"];
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error finding ticket helpers:`, error);
      return ["Support Team"];
    }
  }
  
  /**
   * FIXED: Post vouch to Discord with proper embed formatting like the screenshot
   */
  async postVouchToDiscord(name, phoneNumber, vouchText, helpers = ["Support Team"], mediaBuffer = null, mediaType = null, mediaFileName = null) {
    try {
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
      
      // Get first helper or "Support Team"
      let helperText = helpers.length > 0 ? helpers[0] : 'Support Team';
      
      // Format timestamp
      const now = new Date();
      const timestamp = now.toLocaleDateString('en-US', { 
        month: 'numeric', 
        day: 'numeric', 
        year: 'numeric'
      }) + ' ' + now.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      });
      
      // FIXED: Create embed matching the screenshot exactly
      const embed = new EmbedBuilder()
        .setColor(0x00D4FF) // Bright blue/cyan color like in screenshot
        .setTitle(`🗨️ Vouch from ${name} to ${helperText}`)
        .setDescription(`**${vouchText}**`) // Make vouch text bigger with bold
        .setFooter({ text: `Sent via WhatsApp • ${timestamp}` })
        .setTimestamp();
      
      // Prepare files array if media is present
      let files = [];
      if (mediaBuffer && mediaFileName) {
        try {
          // Save to temp file
          const mediaPath = path.join(this.tempDir, mediaFileName);
          fs.writeFileSync(mediaPath, mediaBuffer);
          
          // Add file
          files.push(new AttachmentBuilder(mediaPath, { name: mediaFileName }));
          
          // Add image to embed if it's an image
          if (mediaType === 'image') {
            embed.setImage(`attachment://${mediaFileName}`);
          }
          
          console.log(`[VouchHandler:${this.instanceId}] Added media to vouch: ${mediaFileName}`);
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error attaching media:`, mediaError);
        }
      }
      
      // Send the vouch with the embed formatting
      await vouchChannel.send({
        embeds: [embed],
        files
      });
      
      console.log(`[VouchHandler:${this.instanceId}] Posted vouch from ${name} (${phoneNumber}) to ${helperText}`);
      
      // Clean up temp files after delay
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
        }, 30000); // 30 seconds delay
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
      } else if (typeof this.whatsAppClient.sendTextMessage === 'function') {
        await this.whatsAppClient.sendTextMessage(jid, text);
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
      
      // Use the WhatsApp client's download method
      if (typeof this.whatsAppClient.downloadMedia === 'function') {
        const mediaData = await this.whatsAppClient.downloadMedia(message);
        if (mediaData && mediaData.buffer) {
          return mediaData;
        }
      }
      
      // Try direct sock method
      if (this.whatsAppClient.sock && typeof this.whatsAppClient.sock.downloadMediaMessage === 'function') {
        const buffer = await this.whatsAppClient.sock.downloadMediaMessage(message);
        if (buffer) {
          return { buffer };
        }
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
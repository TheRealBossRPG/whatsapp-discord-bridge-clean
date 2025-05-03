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
    
    // Error message for empty vouch
    this.emptyVouchMessage = "Please provide more details with your vouch! Just add your feedback after 'Vouch!'";
    
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
   * Find all helpers in a ticket channel
   * @param {Object} channel - Discord channel
   * @returns {Promise<Array>} - Array of helper usernames
   */
  async findTicketHelpers(channel) {
    try {
      // Default value in case no helpers are found
      const helpers = new Set();
      
      // Skip if the channel is not available
      if (!channel) return ["Support Team"];
      
      // Get the most recent messages (up to 100)
      const messages = await channel.messages.fetch({ limit: 100 });
      
      // Process messages to find unique authors who aren't bots
      for (const [_, message] of messages) {
        if (!message.author.bot && message.member) {
          // Use displayName (nickname) if available, otherwise username
          const authorName = message.member.displayName || message.author.username;
          helpers.add(authorName);
        }
      }
      
      // Convert set to array
      return [...helpers];
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error finding ticket helpers:`, error);
      return ["Support Team"];
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
            await this.sendMediaMessage(recipientJid, {
              image: mediaBuffer,
              caption: messageText,
              mimetype: mediaType
            });
          } else {
            await this.sendMediaMessage(recipientJid, {
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
      
      // Send as text-only message
      try {
        await this.sendTextMessage(recipientJid, messageText);
        
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
   * Unified method to send text messages via WhatsApp
   * @param {string} jid - Recipient JID
   * @param {string} text - Message text
   * @returns {Promise<boolean>} - Success status
   */
  async sendTextMessage(jid, text) {
    try {
      // Ensure the message is directly passed as text
      const messageContent = { text };
      
      // Log the sending attempt with complete jid
      console.log(`[VouchHandler:${this.instanceId}] Attempting to send text message to ${jid}: ${text.substring(0, 30)}...`);
      
      // Try multiple methods to send the message
      
      // Method 1: Check for socket direct access (most common in @whiskeysockets/baileys)
      if (this.whatsAppClient.sock && typeof this.whatsAppClient.sock.sendMessage === 'function') {
        await this.whatsAppClient.sock.sendMessage(jid, messageContent);
        console.log(`[VouchHandler:${this.instanceId}] Message sent via sock.sendMessage`);
        return true;
      }
      
      // Method 2: Check for sendMessage on client (direct method)
      if (typeof this.whatsAppClient.sendMessage === 'function') {
        await this.whatsAppClient.sendMessage(jid, messageContent);
        console.log(`[VouchHandler:${this.instanceId}] Message sent via client.sendMessage`);
        return true;
      }
      
      // Method 3: Check for specific text send method
      if (this.whatsAppClient.send && typeof this.whatsAppClient.send.text === 'function') {
        await this.whatsAppClient.send.text(jid, text);
        console.log(`[VouchHandler:${this.instanceId}] Message sent via client.send.text`);
        return true;
      }
      
      // Method 4: Try to access _events.message if it's a function (sometimes used by baileys)
      if (this.whatsAppClient._events && typeof this.whatsAppClient._events.message === 'function') {
        await this.whatsAppClient._events.message(jid, messageContent);
        console.log(`[VouchHandler:${this.instanceId}] Message sent via _events.message`);
        return true;
      }
      
      // Method 5: Look for any dynamic sendMessage function anywhere in the client
      const sendMethod = this.findSendMethod(this.whatsAppClient);
      if (sendMethod) {
        await sendMethod(jid, messageContent);
        console.log(`[VouchHandler:${this.instanceId}] Message sent via discovered sendMethod`);
        return true;
      }
      
      // Log all available methods for debugging
      this.logAvailableMethods();
      
      throw new Error("Could not find suitable send method on WhatsApp client");
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error in sendTextMessage to ${jid}:`, error);
      throw error;
    }
  }
  
  /**
   * Log available methods on the WhatsApp client for debugging
   */
  logAvailableMethods() {
    try {
      console.log(`[VouchHandler:${this.instanceId}] Client properties:`, Object.keys(this.whatsAppClient));
      
      if (this.whatsAppClient.sock) {
        console.log(`[VouchHandler:${this.instanceId}] Client.sock properties:`, Object.keys(this.whatsAppClient.sock));
      }
      
      if (this.whatsAppClient.send) {
        console.log(`[VouchHandler:${this.instanceId}] Client.send properties:`, Object.keys(this.whatsAppClient.send));
      }
      
      if (this.whatsAppClient._events) {
        console.log(`[VouchHandler:${this.instanceId}] Client._events properties:`, Object.keys(this.whatsAppClient._events));
      }
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error logging methods:`, error);
    }
  }
  
  /**
   * Unified method to send media messages via WhatsApp
   * @param {string} jid - Recipient JID
   * @param {Object} content - Media content object
   * @returns {Promise<boolean>} - Success status
   */
  async sendMediaMessage(jid, content) {
    try {
      console.log(`[VouchHandler:${this.instanceId}] Attempting to send media message to ${jid}`);
      
      // Check for socket direct access
      if (this.whatsAppClient.sock && typeof this.whatsAppClient.sock.sendMessage === 'function') {
        await this.whatsAppClient.sock.sendMessage(jid, content);
        console.log(`[VouchHandler:${this.instanceId}] Media sent via sock.sendMessage`);
        return true;
      }
      
      // Check for sendMessage method
      if (typeof this.whatsAppClient.sendMessage === 'function') {
        await this.whatsAppClient.sendMessage(jid, content);
        console.log(`[VouchHandler:${this.instanceId}] Media sent via client.sendMessage`);
        return true;
      }
      
      // Check for specific media send methods
      if (this.whatsAppClient.send) {
        if (content.image && typeof this.whatsAppClient.send.image === 'function') {
          await this.whatsAppClient.send.image(jid, content.image, content.caption);
          console.log(`[VouchHandler:${this.instanceId}] Media sent via client.send.image`);
          return true;
        }
        if (content.video && typeof this.whatsAppClient.send.video === 'function') {
          await this.whatsAppClient.send.video(jid, content.video, content.caption);
          console.log(`[VouchHandler:${this.instanceId}] Media sent via client.send.video`);
          return true;
        }
      }
      
      // Try to find any sendMessage method in the client
      const sendMethod = this.findSendMethod(this.whatsAppClient);
      if (sendMethod) {
        await sendMethod(jid, content);
        console.log(`[VouchHandler:${this.instanceId}] Media sent via discovered sendMethod`);
        return true;
      }
      
      // Log all available methods for debugging
      this.logAvailableMethods();
      
      throw new Error("Could not find suitable send method on WhatsApp client");
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error in sendMediaMessage:`, error);
      throw error;
    }
  }
  
  /**
   * Find an appropriate send method on the WhatsApp client
   * @param {Object} client - WhatsApp client
   * @returns {Function|null} - Send method or null if not found
   */
  findSendMethod(client) {
    // Common method paths to check
    const paths = [
      'sendMessage',
      'sock.sendMessage',
      'waSocket.sendMessage', 
      'wa.sendMessage',
      'whatsapp.sendMessage',
      'baileys.sendMessage',
      '_events.message',
      'client.sendMessage',
      'api.sendMessage'
    ];
    
    // Check each path
    for (const path of paths) {
      const parts = path.split('.');
      let obj = client;
      
      for (const part of parts) {
        if (obj && typeof obj[part] !== 'undefined') {
          obj = obj[part];
        } else {
          obj = null;
          break;
        }
      }
      
      if (typeof obj === 'function') {
        console.log(`[VouchHandler:${this.instanceId}] Found send method at path: ${path}`);
        return obj.bind(client); // Important to bind to retain context
      }
    }
    
    // Search deeply for any potential send methods
    try {
      console.log(`[VouchHandler:${this.instanceId}] Looking for any send method...`);
      
      // Check for any method that might be a send function
      for (const key of Object.keys(client)) {
        // Skip internal or private properties
        if (key.startsWith('_') && key !== '_events') continue;
        
        if (typeof client[key] === 'function' && 
            (key.includes('send') || key.includes('message') || key.includes('chat'))) {
          console.log(`[VouchHandler:${this.instanceId}] Found potential send method: ${key}`);
          return client[key].bind(client);
        }
        
        // Check one level deeper for objects
        if (client[key] && typeof client[key] === 'object') {
          for (const subKey of Object.keys(client[key])) {
            // Skip internal properties
            if (subKey.startsWith('_') && subKey !== '_events') continue;
            
            if (typeof client[key][subKey] === 'function' && 
                (subKey.includes('send') || subKey.includes('message') || subKey.includes('chat'))) {
              console.log(`[VouchHandler:${this.instanceId}] Found potential nested send method: ${key}.${subKey}`);
              return client[key][subKey].bind(client[key]);
            }
            
            // Check one more level deeper
            if (client[key][subKey] && typeof client[key][subKey] === 'object') {
              for (const deepKey of Object.keys(client[key][subKey])) {
                if (typeof client[key][subKey][deepKey] === 'function' && 
                    (deepKey.includes('send') || deepKey.includes('message'))) {
                  console.log(`[VouchHandler:${this.instanceId}] Found deep nested send method: ${key}.${subKey}.${deepKey}`);
                  return client[key][subKey][deepKey].bind(client[key][subKey]);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error searching for send methods:`, error);
    }
    
    return null;
  }
  
  /**
   * Extract text from WhatsApp message
   * @param {Object} message - WhatsApp message
   * @returns {string|null} - Message text or null if not found
   */
  extractMessageText(message) {
    // First do a sanity check on the message
    if (!message) {
      console.log(`[VouchHandler:${this.instanceId}] Message is null or undefined`);
      return null;
    }
    
    try {
      // Handle direct string or text property
      if (typeof message === 'string') {
        return message;
      }
      
      if (message.text) {
        return message.text;
      }
      
      if (message.caption) {
        return message.caption;
      }
      
      if (message.content) {
        return message.content;
      }
      
      // Handle @whiskeysockets/baileys message structure
      if (message.message) {
        // Standard text types
        if (message.message.conversation) {
          return message.message.conversation;
        }
        
        if (message.message.extendedTextMessage && message.message.extendedTextMessage.text) {
          return message.message.extendedTextMessage.text;
        }
        
        // Media with captions
        if (message.message.imageMessage && message.message.imageMessage.caption) {
          return message.message.imageMessage.caption;
        }
        
        if (message.message.videoMessage && message.message.videoMessage.caption) {
          return message.message.videoMessage.caption;
        }
        
        if (message.message.documentMessage && message.message.documentMessage.caption) {
          return message.message.documentMessage.caption;
        }
        
        // Button responses
        if (message.message.buttonsResponseMessage && message.message.buttonsResponseMessage.selectedDisplayText) {
          return message.message.buttonsResponseMessage.selectedDisplayText;
        }
        
        if (message.message.listResponseMessage && message.message.listResponseMessage.title) {
          return message.message.listResponseMessage.title;
        }
        
        if (message.message.templateButtonReplyMessage) {
          return message.message.templateButtonReplyMessage.selectedDisplayText || 
                 message.message.templateButtonReplyMessage.selectedId;
        }
      }
      
      // Log message structure for debugging
      console.log(`[VouchHandler:${this.instanceId}] Message structure for debugging:`, 
                 JSON.stringify(message, null, 2).substring(0, 500) + '...');
      
      return null;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error extracting message text:`, error);
      return null;
    }
  }
  
  /**
   * Check if message contains an image or other media
   * @param {Object} message - WhatsApp message 
   * @returns {boolean} - Whether the message contains media
   */
  hasMedia(message) {
    if (!message || !message.message) return false;
    
    return !!(
      message.message.imageMessage ||
      message.message.videoMessage ||
      message.message.documentMessage ||
      message.message.stickerMessage ||
      message.message.audioMessage ||
      // Also check for any keys that might contain media
      Object.keys(message.message).some(key => 
        key.includes('image') || 
        key.includes('video') || 
        key.includes('media') || 
        key.includes('document') ||
        key.includes('sticker')
      )
    );
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
      
      console.log(`[VouchHandler:${this.instanceId}] Attempting to download media from message`);
      
      // Try multiple methods to download media based on the WhatsApp client
      
      // Method 1: Try sock.downloadMediaMessage (most common in @whiskeysockets/baileys)
      if (this.whatsAppClient.sock && typeof this.whatsAppClient.sock.downloadMediaMessage === 'function') {
        console.log(`[VouchHandler:${this.instanceId}] Trying sock.downloadMediaMessage`);
        const buffer = await this.whatsAppClient.sock.downloadMediaMessage(message);
        if (buffer) return buffer;
      }
      
      // Method 2: Try downloadMediaMessage on the client
      if (typeof this.whatsAppClient.downloadMediaMessage === 'function') {
        console.log(`[VouchHandler:${this.instanceId}] Trying client.downloadMediaMessage`);
        const buffer = await this.whatsAppClient.downloadMediaMessage(message);
        if (buffer) return buffer;
      }
      
      // Method 3: Try downloadMedia
      if (typeof this.whatsAppClient.downloadMedia === 'function') {
        console.log(`[VouchHandler:${this.instanceId}] Trying client.downloadMedia`);
        const buffer = await this.whatsAppClient.downloadMedia(message);
        if (buffer) return buffer;
      }
      
      // Method 4: Try download (older versions)
      if (typeof this.whatsAppClient.download === 'function') {
        console.log(`[VouchHandler:${this.instanceId}] Trying client.download`);
        const buffer = await this.whatsAppClient.download(message);
        if (buffer) return buffer;
      }
      
      // Method 5: Check for additional methods specific to @whiskeysockets/baileys
      if (this.whatsAppClient.downloadAndSaveMediaMessage) {
        console.log(`[VouchHandler:${this.instanceId}] Trying client.downloadAndSaveMediaMessage`);
        // Generate a temporary path
        const tempPath = path.join(this.tempDir, `temp-media-${Date.now()}`);
        await this.whatsAppClient.downloadAndSaveMediaMessage(message, tempPath);
        if (fs.existsSync(tempPath)) {
          const buffer = fs.readFileSync(tempPath);
          // Clean up temp file
          fs.unlinkSync(tempPath);
          return buffer;
        }
      }
      
      console.error(`[VouchHandler:${this.instanceId}] No suitable download method found`);
      return null;
    } catch (error) {
      console.error(`[VouchHandler:${this.instanceId}] Error in downloadMedia:`, error);
      return null;
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
      
      // Ensure the phoneNumber is in the correct format for responses
      let cleanPhone = String(phoneNumber).replace(/\D/g, '');
      cleanPhone = cleanPhone.replace(/^\+/, '');
      const recipientJid = `${cleanPhone}@s.whatsapp.net`;
      
      // Check if vouch text is substantial enough
      if (vouchText.length < 3) {
        // Vouch text too short - ask for more detail
        console.log(`[VouchHandler:${this.instanceId}] Empty vouch detected ("${vouchText}"), sending error message`);
        
        try {
          await this.sendTextMessage(recipientJid, this.emptyVouchMessage);
          console.log(`[VouchHandler:${this.instanceId}] Sent empty vouch error message to ${phoneNumber}`);
        } catch (sendError) {
          console.error(`[VouchHandler:${this.instanceId}] Error sending empty vouch error message:`, sendError);
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
      
      console.log(`[VouchHandler:${this.instanceId}] Processing vouch from ${name} (${phoneNumber}): "${vouchText.substring(0, 30)}..."`);
      
      // Handle media if present
      let mediaBuffer = null;
      let mediaType = null;
      let mediaFileName = null;
      let hasMediaMessage = false;
      
      // Check if message has media directly
      if (originalMessage) {
        hasMediaMessage = this.hasMedia(originalMessage);
        console.log(`[VouchHandler:${this.instanceId}] Message has media: ${hasMediaMessage}`);
        
        if (hasMediaMessage) {
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
            } else {
              // Generic fallback for any media - try to detect type
              mediaBuffer = await this.downloadMedia(originalMessage);
              if (mediaBuffer) {
                mediaType = 'image'; // Default to image if unknown
                mediaFileName = `vouch-media-${Date.now()}.jpg`;
              }
            }
            
            if (mediaBuffer) {
              console.log(`[VouchHandler:${this.instanceId}] Downloaded media of type: ${mediaType}`);
            } else {
              console.log(`[VouchHandler:${this.instanceId}] Failed to download media`);
            }
          } catch (mediaError) {
            console.error(`[VouchHandler:${this.instanceId}] Error processing media:`, mediaError);
            // Continue without media
          }
        }
      } else if (messageContent && messageContent.media) {
        // Handle case where media is provided directly in messageContent
        try {
          mediaBuffer = messageContent.media;
          mediaType = messageContent.mediaType || 'image';
          mediaFileName = messageContent.fileName || `vouch-media-${Date.now()}.bin`;
          hasMediaMessage = true;
        } catch (error) {
          console.error(`[VouchHandler:${this.instanceId}] Error with provided media:`, error);
          // Continue without media
        }
      }
      
      // Find channel by phone number to get ticket helpers
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
        // Continue with default helpers
      }
      
      // Post to Discord
      const success = await this.postVouchToDiscord(name, phoneNumber, vouchText, helpers, mediaBuffer, mediaType, mediaFileName);
      
      // Send confirmation message
      if (success) {
        try {
          // Different success message if media was included
          const successMessage = hasMediaMessage 
            ? `${this.vouchSuccessMessage} We've also included your media attachment.`
            : this.vouchSuccessMessage;
            
          await this.sendTextMessage(recipientJid, successMessage);
          console.log(`[VouchHandler:${this.instanceId}] Sent vouch success message to ${phoneNumber}`);
        } catch (sendError) {
          console.error(`[VouchHandler:${this.instanceId}] Error sending vouch success message:`, sendError);
        }
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
      
      // Format the recipient string - "Vouch from X to Y"
      let recipientString;
      if (helpers.length > 0) {
        // Join multiple helpers with commas for more than 2, or with "and" for 2
        const helpersFormatted = helpers.length === 1 
          ? helpers[0] 
          : helpers.length === 2 
            ? `${helpers[0]} and ${helpers[1]}` 
            : `${helpers.slice(0, -1).join(', ')} and ${helpers[helpers.length - 1]}`;
        
        recipientString = `${name} to ${helpersFormatted}`;
      } else {
        recipientString = name;
      }
      
      // Format date as shown in the screenshots (MM/DD/YYYY)
      const today = new Date();
      const dateString = `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}/${today.getFullYear()}`;
      
      // Format time as shown in the screenshots (HH:MM AM/PM)
      const hours = today.getHours();
      const minutes = today.getMinutes().toString().padStart(2, '0');
      const timeString = `${hours % 12 || 12}:${minutes} ${hours >= 12 ? 'PM' : 'AM'}`;
      
      // Create files array for attachments
      let files = [];
      
      // Add media if available
      if (mediaBuffer && mediaFileName) {
        try {
          // Save to temp file
          const mediaPath = path.join(this.tempDir, mediaFileName);
          fs.writeFileSync(mediaPath, mediaBuffer);
          
          // Add file to message
          files.push(new AttachmentBuilder(mediaPath, { name: mediaFileName }));
          console.log(`[VouchHandler:${this.instanceId}] Added media to vouch: ${mediaFileName}`);
        } catch (mediaError) {
          console.error(`[VouchHandler:${this.instanceId}] Error attaching media:`, mediaError);
          // Continue without media
        }
      }
      
      // Format message exactly like the screenshots
      // Using the megaphone emoji and specific format
      const messageContent = `📢 Vouch from ${recipientString}\n${vouchText}\nDate\n${dateString}\nWhatsApp: ${phoneNumber} • Today at ${timeString}`;
      
      // Send to channel with the exact format from the screenshots
      await vouchChannel.send({
        content: messageContent,
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
      
      // Log full message for debugging
      console.log(`[VouchHandler:${this.instanceId}] Processing message for vouch detection:`, 
                 JSON.stringify(message, (key, value) => {
                   // Omit binary data and circular references
                   if (key === 'data' && typeof value === 'string' && value.length > 100) {
                     return '[BINARY DATA]';
                   }
                   return value;
                 }, 2).substring(0, 500) + '...');
      
      // Extract text from message
      const messageText = this.extractMessageText(message);
      console.log(`[VouchHandler:${this.instanceId}] Extracted message text: "${messageText}"`);
      
      if (!messageText) {
        console.log(`[VouchHandler:${this.instanceId}] No text found in message, checking if it's a media message`);
        
        // If no text but has media, check message key for "Vouch!" in client display
        if (this.hasMedia(message) && message.key && message.key.fromMe === false) {
          // Extract message ID or other identifier
          const messageId = message.key.id;
          console.log(`[VouchHandler:${this.instanceId}] Media message detected with ID: ${messageId}`);
          
          // Try to find "Vouch!" in any context property
          let isVouch = false;
          
          // Check various properties where "Vouch!" might be indicated
          if (message.message && message.message.imageMessage && message.message.imageMessage.caption) {
            isVouch = message.message.imageMessage.caption.trim().toLowerCase().startsWith('vouch!');
          } else if (message.message && message.message.videoMessage && message.message.videoMessage.caption) {
            isVouch = message.message.videoMessage.caption.trim().toLowerCase().startsWith('vouch!');
          } else if (message.message && message.message.documentMessage && message.message.documentMessage.caption) {
            isVouch = message.message.documentMessage.caption.trim().toLowerCase().startsWith('vouch!');
          }
          
          if (isVouch) {
            console.log(`[VouchHandler:${this.instanceId}] Media message with "Vouch!" caption detected`);
            
            // Extract sender JID
            const sender = message.key.remoteJid;
            if (!sender) {
              console.log(`[VouchHandler:${this.instanceId}] No sender JID found in media message`);
              return false;
            }
            
            const phoneNumber = sender.split('@')[0];
            
            // Get user info
            const userCard = this.userCardManager ? 
              await this.userCardManager.getUserInfo(phoneNumber) : null;
            
            // Extract caption as the vouch text
            let vouchText = '';
            if (message.message.imageMessage && message.message.imageMessage.caption) {
              vouchText = message.message.imageMessage.caption.replace(/^vouch!/i, '').trim();
            } else if (message.message.videoMessage && message.message.videoMessage.caption) {
              vouchText = message.message.videoMessage.caption.replace(/^vouch!/i, '').trim();
            } else if (message.message.documentMessage && message.message.documentMessage.caption) {
              vouchText = message.message.documentMessage.caption.replace(/^vouch!/i, '').trim();
            }
            
            // If no valid text, use a placeholder
            if (!vouchText || vouchText.length < 2) {
              vouchText = "Shared media content";
            }
            
            // Process the media vouch
            return await this.handleVouch(
              phoneNumber,
              { text: vouchText },
              userCard,
              message
            );
          }
        }
        
        return false;
      }
      
      // Check if it's a vouch message by looking for "Vouch!" at the beginning
      if (!messageText.trim().toLowerCase().startsWith('vouch!')) {
        console.log(`[VouchHandler:${this.instanceId}] Message is not a vouch`);
        return false;
      }
      
      console.log(`[VouchHandler:${this.instanceId}] Vouch message detected: "${messageText}"`);
      
      // Extract phone number from the message
      const sender = message.key?.remoteJid;
      if (!sender) {
        console.error(`[VouchHandler:${this.instanceId}] Could not find sender JID in message`);
        return false;
      }
      
      const phoneNumber = sender.split('@')[0];
      console.log(`[VouchHandler:${this.instanceId}] Extracted phone number: ${phoneNumber}`);
      
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
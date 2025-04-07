// modules/handlers/WhatsAppHandler.js
const fs = require('fs');
const path = require('path');

/**
 * Handler for WhatsApp messages
 */
class WhatsAppHandler {
  /**
   * Create a new WhatsApp handler
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} userCardManager - User card manager
   * @param {Object} channelManager - Channel manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} vouchHandler - Vouch handler (optional)
   * @param {Object} options - Handler options
   */
  constructor(whatsAppClient, userCardManager, channelManager, ticketManager, transcriptManager, vouchHandler, options = {}) {
    this.whatsAppClient = whatsAppClient;
    this.userCardManager = userCardManager;
    this.channelManager = channelManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.vouchHandler = vouchHandler;
    
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    
    // Ensure temp dir exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Message templates
    this.welcomeMessage = "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage = "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage = "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
    
    // Make sure the discord client is available
    this.discordClient = options.discordClient;
    
    console.log(`[WhatsAppHandler:${this.instanceId}] Initialized`);
  }
  
  /**
   * Handle an incoming WhatsApp message
   * @param {Object} message - WhatsApp message
   */
  async handleMessage(message) {
    try {
      // Ignore status messages
      if (message.key.remoteJid === 'status@broadcast') return;
      
      // Get sender information
      const sender = message.key.remoteJid;
      const messageContent = this.extractMessageContent(message);
      console.log(`[WhatsAppHandler:${this.instanceId}] Message received from ${sender}: ${messageContent.substring(0, 50)}${messageContent.length > 50 ? '...' : ''}`);
      
      // Skip if no sender or it's a group message
      if (!sender || sender.includes('g.us')) return;
      
      // Get or create channel for this user
      let channel;
      
      // Implementation that's compatible with various channel manager interfaces
      if (this.channelManager) {
        // First try using the expected method
        if (typeof this.channelManager.getChannelByPhone === 'function') {
          channel = this.channelManager.getChannelByPhone(sender);
        } 
        // Then try other potential methods that might exist
        else if (typeof this.channelManager.getChannelForPhone === 'function') {
          channel = this.channelManager.getChannelForPhone(sender);
        }
        // Implement lookup directly if needed
        else {
          // Extract clean phone number
          const cleanPhone = this.cleanPhoneNumber(sender);
          
          // Try to find the channel in the channel map
          // First check if channelMap is a Map
          if (this.channelManager.channelMap instanceof Map) {
            for (const [channelId, mapping] of this.channelManager.channelMap.entries()) {
              if (mapping.phoneNumber === cleanPhone) {
                channel = { channelId, ...mapping };
                break;
              }
            }
          }
          // If not a Map, try as an Object
          else if (typeof this.channelManager.channelMap === 'object') {
            for (const channelId in this.channelManager.channelMap) {
              const mapping = this.channelManager.channelMap[channelId];
              if (mapping.phoneNumber === cleanPhone) {
                channel = { channelId, ...mapping };
                break;
              }
            }
          }
        }
      }
      
      // Get user card
      const userCard = this.userCardManager.getUserCard(sender);
      
      // Check if this is a vouch message
      if (this.vouchHandler && messageContent.toLowerCase().startsWith('vouch!')) {
        await this.handleVouchMessage(message, userCard);
        return;
      }
      
      // If we don't have a channel yet and don't have a name, this is first contact
      if (!channel && (!userCard || !userCard.name)) {
        await this.handleFirstContact(sender, messageContent);
        return;
      }
      
      // If we have a userCard but no channel, this is name collection
      if (!channel && userCard && !userCard.channelId) {
        await this.handleNameCollection(sender, messageContent, userCard);
        return;
      }
      
      // Handle command if present (starts with !)
      if (messageContent.startsWith('!')) {
        const command = messageContent.split(' ')[0].substring(1).toLowerCase();
        await this.handleCommand(command, message, userCard);
        return;
      }
      
      // Normal message handling - forward to Discord
      await this.forwardMessageToDiscord(message, channel, userCard);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling WhatsApp message:`, error);
    }
  }
  
  /**
   * Clean phone number by removing WhatsApp extensions
   * @param {string} phoneNumber - Phone number to clean
   * @returns {string} - Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    // Convert to string
    const phone = String(phoneNumber);
    
    // Remove WhatsApp extensions
    return phone.replace(/@s\.whatsapp\.net/g, '')
              .replace(/@c\.us/g, '')
              .replace(/@g\.us/g, '')
              .replace(/@broadcast/g, '')
              .replace(/@.*$/, '');
  }
  
  /**
   * Extract message content from a WhatsApp message
   * @param {Object} message - WhatsApp message
   * @returns {string} - Message content
   */
  extractMessageContent(message) {
    if (!message || !message.message) return '';
    
    try {
      // Handle different message types
      const msg = message.message;
      
      if (msg.conversation) {
        return msg.conversation;
      }
      
      if (msg.extendedTextMessage && msg.extendedTextMessage.text) {
        return msg.extendedTextMessage.text;
      }
      
      if (msg.imageMessage && msg.imageMessage.caption) {
        return msg.imageMessage.caption;
      }
      
      if (msg.videoMessage && msg.videoMessage.caption) {
        return msg.videoMessage.caption;
      }
      
      if (msg.documentMessage && msg.documentMessage.caption) {
        return msg.documentMessage.caption;
      }
      
      // Handle other message types as needed
      
      return '';
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error extracting message content:`, error);
      return '';
    }
  }
  
  /**
   * Handle first contact with a new user
   * @param {string} sender - Sender's phone number
   * @param {string} messageContent - Message content
   */
  async handleFirstContact(sender, messageContent) {
    try {
      // Save phone number to user card
      this.userCardManager.createUserCard(sender);
      
      // Send welcome message
      await this.whatsAppClient.sendMessage(sender, { text: this.welcomeMessage });
      
      console.log(`[WhatsAppHandler:${this.instanceId}] Sent welcome message to new user: ${sender}`);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling first contact:`, error);
    }
  }
  
  /**
   * Handle name collection from a new user
   * @param {string} sender - Sender's phone number
   * @param {string} messageContent - Message content (the name)
   * @param {Object} userCard - User card
   */
  async handleNameCollection(sender, messageContent, userCard) {
    try {
      // Store the name
      const name = messageContent.trim();
      this.userCardManager.updateUserCard(sender, { name });
      
      // Create a channel for this user
      await this.ticketManager.createTicket(sender, name);
      
      // Send intro message
      const introMsg = this.introMessage.replace(/{name}/g, name);
      await this.whatsAppClient.sendMessage(sender, { text: introMsg });
      
      console.log(`[WhatsAppHandler:${this.instanceId}] Created ticket for ${name} (${sender})`);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling name collection:`, error);
    }
  }
  
  /**
   * Handle WhatsApp commands
   * @param {string} command - Command name
   * @param {Object} message - WhatsApp message
   * @param {Object} userCard - User card
   */
  async handleCommand(command, message, userCard) {
    try {
      const sender = message.key.remoteJid;
      
      switch (command.toLowerCase()) {
        case 'vouch':
          if (this.vouchHandler && !this.vouchHandler.isDisabled) {
            await this.vouchHandler.sendVouchInstructions(sender, userCard?.name);
          } else {
            await this.whatsAppClient.sendMessage(sender, {
              text: "Sorry, the vouch system is currently disabled."
            });
          }
          break;
          
        default:
          await this.whatsAppClient.sendMessage(sender, {
            text: `Sorry, I don't recognize the command !${command}.`
          });
          break;
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling command ${command}:`, error);
    }
  }
  
  /**
   * Handle a vouch message
   * @param {Object} message - WhatsApp message
   * @param {Object} userCard - User card
   */
  async handleVouchMessage(message, userCard) {
    try {
      if (!this.vouchHandler || this.vouchHandler.isDisabled) {
        await this.whatsAppClient.sendMessage(message.key.remoteJid, {
          text: "Sorry, the vouch system is currently disabled."
        });
        return;
      }
      
      await this.vouchHandler.processVouch(message, userCard);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling vouch message:`, error);
    }
  }
  
  /**
   * Forward a WhatsApp message to Discord
   * @param {Object} message - WhatsApp message
   * @param {Object} channel - Channel info
   * @param {Object} userCard - User card
   */
  async forwardMessageToDiscord(message, channel, userCard) {
    try {
      if (!channel || !channel.channelId) {
        console.log(`[WhatsAppHandler:${this.instanceId}] No channel found for ${message.key.remoteJid}`);
        return;
      }
      
      // Get Discord channel
      const discordChannel = await this.getDiscordChannel(channel.channelId);
      if (!discordChannel) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Discord channel not found: ${channel.channelId}`);
        return;
      }
      
      // Get message content
      const messageContent = this.extractMessageContent(message);
      
      // Handle media messages
      const msg = message.message;
      if (msg.imageMessage || msg.videoMessage || msg.documentMessage || msg.audioMessage || msg.stickerMessage) {
        await this.forwardMediaToDiscord(message, discordChannel, userCard);
        return;
      }
      
      // Handle text messages
      if (messageContent) {
        const displayName = userCard?.name || 'Unknown User';
        
        // Handle long messages
        if (messageContent.length > 1900) {
          const chunks = this.chunkText(messageContent, 1900);
          for (const chunk of chunks) {
            await discordChannel.send(`**${displayName}:** ${chunk}`);
          }
        } else {
          await discordChannel.send(`**${displayName}:** ${messageContent}`);
        }
      }
      
      // Add to transcript 
      if (this.transcriptManager && !this.transcriptManager.isDisabled) {
        this.transcriptManager.addUserMessage(channel.channelId, userCard?.name || 'User', messageContent);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error forwarding message to Discord:`, error);
    }
  }
  
  /**
   * Forward media from WhatsApp to Discord
   * @param {Object} message - WhatsApp message
   * @param {Object} discordChannel - Discord channel
   * @param {Object} userCard - User card
   */
  async forwardMediaToDiscord(message, discordChannel, userCard) {
    try {
      const displayName = userCard?.name || 'Unknown User';
      const msg = message.message;
      
      // Extract media content
      const mediaData = await this.extractMediaContent(message);
      if (!mediaData) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Failed to extract media content`);
        return;
      }
      
      const { buffer, filename, caption, mimetype } = mediaData;
      
      // Save to temp file
      const tempPath = path.join(this.tempDir, filename);
      fs.writeFileSync(tempPath, buffer);
      
      // Send file with caption
      await discordChannel.send({
        content: `**${displayName}:** ${caption || ''}`,
        files: [{
          attachment: tempPath,
          name: filename
        }]
      });
      
      // Add to transcript if enabled
      if (this.transcriptManager && !this.transcriptManager.isDisabled) {
        const contentType = mimetype?.split('/')[0] || 'media';
        const transcriptMsg = caption 
          ? `[${contentType.toUpperCase()}] ${caption}`
          : `[${contentType.toUpperCase()}]`;
        
        this.transcriptManager.addUserMessage(discordChannel.id, displayName, transcriptMsg);
      }
      
      // Clean up
      try {
        fs.unlinkSync(tempPath);
      } catch (unlinkError) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Error removing temp file: ${unlinkError.message}`);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error forwarding media to Discord:`, error);
      
      // Try to send an error message
      const displayName = userCard?.name || 'Unknown User';
      await discordChannel.send(`**${displayName}:** [Media could not be processed]`);
    }
  }
  
  /**
   * Extract media content from a WhatsApp message
   * @param {Object} message - WhatsApp message
   * @returns {Object|null} - Media info with buffer, filename, mimetype, and caption
   */
  async extractMediaContent(message) {
    try {
      if (!message.message) return null;
      
      const msg = message.message;
      let mediaMessage = null;
      let stream = null;
      let caption = '';
      let mimetype = '';
      let filename = '';
      
      // Image message
      if (msg.imageMessage) {
        mediaMessage = msg.imageMessage;
        caption = mediaMessage.caption || '';
        mimetype = mediaMessage.mimetype || 'image/jpeg';
        filename = `image_${Date.now()}.${this.getExtensionFromMimeType(mimetype)}`;
      }
      // Video message
      else if (msg.videoMessage) {
        mediaMessage = msg.videoMessage;
        caption = mediaMessage.caption || '';
        mimetype = mediaMessage.mimetype || 'video/mp4';
        filename = `video_${Date.now()}.${this.getExtensionFromMimeType(mimetype)}`;
      }
      // Document message
      else if (msg.documentMessage) {
        mediaMessage = msg.documentMessage;
        caption = mediaMessage.caption || '';
        mimetype = mediaMessage.mimetype || 'application/octet-stream';
        filename = mediaMessage.fileName || `document_${Date.now()}.${this.getExtensionFromMimeType(mimetype)}`;
      }
      // Audio message
      else if (msg.audioMessage) {
        mediaMessage = msg.audioMessage;
        mimetype = mediaMessage.mimetype || 'audio/ogg';
        filename = `audio_${Date.now()}.${this.getExtensionFromMimeType(mimetype)}`;
      }
      // Sticker message
      else if (msg.stickerMessage) {
        mediaMessage = msg.stickerMessage;
        mimetype = mediaMessage.mimetype || 'image/webp';
        filename = `sticker_${Date.now()}.${this.getExtensionFromMimeType(mimetype)}`;
      }
      else {
        return null;
      }
      
      // Get the stream using the appropriate method
      if (this.whatsAppClient) {
        // Use the WhatsApp client to get the media
        const buffer = await this.whatsAppClient.downloadMedia(message);
        
        return {
          buffer,
          filename,
          mimetype,
          caption
        };
      }
      
      return null;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error extracting media content:`, error);
      return null;
    }
  }
  
  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} - File extension without dot
   */
  getExtensionFromMimeType(mimeType) {
    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/mpeg': 'mpeg',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'application/pdf': 'pdf',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
    };
    
    return mimeToExt[mimeType] || 'bin';
  }
  
  /**
   * Split text into chunks
   * @param {string} text - Text to split
   * @param {number} maxLength - Maximum chunk length
   * @returns {Array<string>} - Array of text chunks
   */
  chunkText(text, maxLength = 1900) {
    const chunks = [];
    
    while (text.length > 0) {
      const chunk = text.substring(0, maxLength);
      chunks.push(chunk);
      text = text.substring(maxLength);
    }
    
    return chunks;
  }
  
  /**
   * Get a Discord channel by ID
   * @param {string} channelId - Discord channel ID
   * @returns {Object|null} - Discord channel or null if not found
   */
  async getDiscordChannel(channelId) {
    try {
      if (!this.discordClient) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Discord client not available`);
        return null;
      }
      
      return await this.discordClient.channels.fetch(channelId);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error fetching Discord channel ${channelId}:`, error);
      return null;
    }
  }
}

module.exports = WhatsAppHandler;
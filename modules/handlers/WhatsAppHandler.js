// modules/handlers/WhatsAppHandler.js
const fs = require('fs');
const path = require('path');

/**
 * Handles WhatsApp messages and events
 */
class WhatsAppHandler {
  /**
   * Create WhatsApp handler
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} userCardManager - User card manager
   * @param {Object} channelManager - Channel manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} vouchHandler - Vouch handler
   * @param {Object} options - Options
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
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Default messages
    this.welcomeMessage = "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage = "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage = "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
    
    // Track pending tickets for users who just sent their name
    this.pendingTickets = new Map();
    this.pendingMessages = new Map();
    
    console.log(`[WhatsAppHandler:${this.instanceId}] Initialized`);
  }
  
  /**
   * Send WhatsApp message
   * @param {string} phoneNumber - Phone number
   * @param {string} message - Message
   * @returns {Promise<boolean>} - Success
   */
  async sendWhatsAppMessage(phoneNumber, message) {
    try {
      if (!this.whatsAppClient) {
        console.error(`[WhatsAppHandler:${this.instanceId}] No WhatsApp client available`);
        return false;
      }
      
      await this.whatsAppClient.sendTextMessage(phoneNumber, message);
      return true;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending WhatsApp message:`, error);
      return false;
    }
  }
  
  /**
   * Handle incoming WhatsApp message
   * @param {Object} message - WhatsApp message
   * @returns {Promise<boolean>} - Success
   */
  async handleMessage(message) {
    try {
      if (!message || !message.key || !message.key.remoteJid) {
        console.warn(`[WhatsAppHandler:${this.instanceId}] Received invalid message`);
        return false;
      }
      
      // Check if this is from a group - ignore group messages
      if (message.key.remoteJid.endsWith('@g.us')) {
        return false;
      }
      
      // Get phone number and message content
      const phoneNumber = message.key.remoteJid.split('@')[0];
      
      // Extract message content based on type
      const messageContent = this.extractMessageContent(message);
      
      if (messageContent === null) {
        console.log(`[WhatsAppHandler:${this.instanceId}] Skipping non-content message from ${phoneNumber}`);
        return false;
      }
      
      // Check for vouch message
      if (this.vouchHandler && !this.vouchHandler.isDisabled && messageContent.startsWith('Vouch!')) {
        return await this.vouchHandler.handleVouchMessage(phoneNumber, messageContent, message);
      }
      
      // Check if this phone number has an existing channel
      const channelId = this.channelManager.getChannelId(phoneNumber);
      
      if (channelId) {
        // Channel exists, forward message to Discord
        return await this.forwardMessageToDiscord(phoneNumber, message, channelId);
      } else {
        // No channel exists, start ticket creation process
        return await this.handleTicketCreation(phoneNumber, messageContent, message);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling message:`, error);
      return false;
    }
  }
  
  /**
   * Extract message content based on type
   * @param {Object} message - WhatsApp message
   * @returns {string|null} - Message content
   */
  extractMessageContent(message) {
    if (message.message) {
      if (message.message.conversation) {
        return message.message.conversation;
      }
      
      if (message.message.extendedTextMessage && message.message.extendedTextMessage.text) {
        return message.message.extendedTextMessage.text;
      }
      
      if (message.message.imageMessage && message.message.imageMessage.caption) {
        return message.message.imageMessage.caption;
      }
      
      if (message.message.videoMessage && message.message.videoMessage.caption) {
        return message.message.videoMessage.caption;
      }
      
      if (message.message.documentMessage && message.message.documentMessage.caption) {
        return message.message.documentMessage.caption;
      }
      
      // Media without caption
      if (message.message.imageMessage) {
        return '[Image]';
      }
      
      if (message.message.videoMessage) {
        return '[Video]';
      }
      
      if (message.message.audioMessage) {
        return '[Audio]';
      }
      
      if (message.message.documentMessage) {
        return '[Document]';
      }
      
      if (message.message.stickerMessage) {
        return '[Sticker]';
      }
    }
    
    return null;
  }
  
  /**
   * Forward message to Discord
   * @param {string} phoneNumber - Phone number
   * @param {Object} message - WhatsApp message
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<boolean>} - Success
   */
  async forwardMessageToDiscord(phoneNumber, message, channelId) {
    try {
      // Get user information
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      const username = userCard ? userCard.name : phoneNumber;
      
      // Get Discord client and channel
      const discordClient = this.ticketManager ? this.ticketManager.discordClient : null;
      if (!discordClient) {
        console.error(`[WhatsAppHandler:${this.instanceId}] No Discord client available`);
        return false;
      }
      
      const channel = discordClient.channels.cache.get(channelId);
      if (!channel) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Channel not found: ${channelId}`);
        return false;
      }
      
      // Extract message content based on type
      let content = this.extractMessageContent(message);
      
      // If there's no content, but there's media
      if (!content || content.startsWith('[')) {
        const mediaType = content || 'Media';
        
        // Send the message with only the username
        await channel.send(`**${username}:** ${mediaType}`);
      } else {
        // Send the message with content
        await channel.send(`**${username}:** ${content}`);
      }
      
      // Handle media files
      await this.sendMediaToDiscord(message, channel, username);
      
      return true;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error forwarding message to Discord:`, error);
      return false;
    }
  }
  
  /**
   * Send media to Discord
   * @param {Object} message - WhatsApp message
   * @param {Object} channel - Discord channel
   * @param {string} username - Username
   * @returns {Promise<boolean>} - Success
   */
  async sendMediaToDiscord(message, channel, username) {
    try {
      if (!message.message) return false;
      
      const messageTypes = [
        {
          type: 'imageMessage',
          accessor: message.message.imageMessage,
          label: 'Image'
        },
        {
          type: 'videoMessage',
          accessor: message.message.videoMessage,
          label: 'Video'
        },
        {
          type: 'audioMessage',
          accessor: message.message.audioMessage,
          label: 'Audio'
        },
        {
          type: 'documentMessage',
          accessor: message.message.documentMessage,
          label: 'Document'
        },
        {
          type: 'stickerMessage',
          accessor: message.message.stickerMessage,
          label: 'Sticker'
        }
      ];
      
      for (const { type, accessor, label } of messageTypes) {
        if (accessor) {
          if (!this.whatsAppClient) {
            console.error(`[WhatsAppHandler:${this.instanceId}] No WhatsApp client for media download`);
            return false;
          }
          
          const mediaBuffer = await this.whatsAppClient.downloadMedia(message, type);
          if (!mediaBuffer) {
            console.error(`[WhatsAppHandler:${this.instanceId}] Failed to download ${label.toLowerCase()}`);
            continue;
          }
          
          // Get filename and mime type
          let filename = `${label.toLowerCase()}_${Date.now()}`;
          let mimeType = accessor.mimetype || '';
          
          // Add extension based on mime type
          if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
            filename += '.jpg';
          } else if (mimeType.includes('png')) {
            filename += '.png';
          } else if (mimeType.includes('webp')) {
            filename += '.webp';
          } else if (mimeType.includes('gif')) {
            filename += '.gif';
          } else if (mimeType.includes('mp4')) {
            filename += '.mp4';
          } else if (mimeType.includes('mp3') || mimeType.includes('audio')) {
            filename += '.mp3';
          } else if (mimeType.includes('pdf')) {
            filename += '.pdf';
          } else if (accessor.fileName) {
            filename = accessor.fileName;
          }
          
          // Save media to temp directory
          const mediaPath = path.join(this.tempDir, filename);
          fs.writeFileSync(mediaPath, mediaBuffer);
          
          // Send media to Discord
          await channel.send({
            files: [mediaPath]
          });
          
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending media to Discord:`, error);
      return false;
    }
  }
  
  /**
   * Handle ticket creation process
   * @param {string} phoneNumber - Phone number
   * @param {string} content - Message content
   * @param {Object} message - WhatsApp message
   * @returns {Promise<boolean>} - Success
   */
  async handleTicketCreation(phoneNumber, content, message) {
    try {
      // Look up user in userCardManager
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      
      if (userCard) {
        // User exists, reopen ticket
        const username = userCard.name;
        
        // Check for any pending messages
        if (!this.pendingMessages.has(phoneNumber)) {
          this.pendingMessages.set(phoneNumber, []);
        }
        
        // Add this message to pending
        this.pendingMessages.get(phoneNumber).push(message);
        
        // Create a new ticket channel
        const ticketChannel = await this.ticketManager.createTicket(phoneNumber, username);
        
        if (!ticketChannel) {
          console.error(`[WhatsAppHandler:${this.instanceId}] Failed to create ticket for ${username} (${phoneNumber})`);
          return false;
        }
        
        // Send reopen message to user
        let reopenMessage = this.reopenTicketMessage.replace(/{name}/g, username);
        await this.sendWhatsAppMessage(phoneNumber, reopenMessage);
        
        // Process pending messages
        await this.processPendingMessages(phoneNumber);
        
        console.log(`[WhatsAppHandler:${this.instanceId}] Created ticket ${ticketChannel.id} for ${username} (${phoneNumber})`);
        return true;
      } else {
        // New user, ask for name if this is first message
        if (!this.pendingTickets.has(phoneNumber)) {
          // Send welcome message
          await this.sendWhatsAppMessage(phoneNumber, this.welcomeMessage);
          
          // Mark as pending
          this.pendingTickets.set(phoneNumber, true);
          
          // Store this message
          if (!this.pendingMessages.has(phoneNumber)) {
            this.pendingMessages.set(phoneNumber, []);
          }
          this.pendingMessages.get(phoneNumber).push(message);
          
          return true;
        } else {
          // This should be their name, create user card
          const username = content.trim();
          
          // Create user card
          await this.userCardManager.createUserCard(phoneNumber, { name: username });
          
          // Store this message
          if (!this.pendingMessages.has(phoneNumber)) {
            this.pendingMessages.set(phoneNumber, []);
          }
          this.pendingMessages.get(phoneNumber).push(message);
          
          // Create a ticket
          const ticketChannel = await this.ticketManager.createTicket(phoneNumber, username);
          
          if (!ticketChannel) {
            console.error(`[WhatsAppHandler:${this.instanceId}] Failed to create ticket for ${username} (${phoneNumber})`);
            return false;
          }
          
          // Send intro message
          let introMsg = this.introMessage.replace(/{name}/g, username);
          await this.sendWhatsAppMessage(phoneNumber, introMsg);
          
          // Process pending messages
          await this.processPendingMessages(phoneNumber);
          
          // Clear pending state
          this.pendingTickets.delete(phoneNumber);
          
          console.log(`[WhatsAppHandler:${this.instanceId}] Created ticket ${ticketChannel.id} for ${username} (${phoneNumber})`);
          return true;
        }
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling ticket creation:`, error);
      return false;
    }
  }
  
  /**
   * Process pending messages
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<boolean>} - Success
   */
  async processPendingMessages(phoneNumber) {
    try {
      // Get channel ID
      const channelId = this.channelManager.getChannelId(phoneNumber);
      if (!channelId) {
        console.error(`[WhatsAppHandler:${this.instanceId}] No channel found for ${phoneNumber}`);
        return false;
      }
      
      // Get pending messages
      const pendingMessages = this.pendingMessages.get(phoneNumber) || [];
      
      // Process each message
      for (const message of pendingMessages) {
        await this.forwardMessageToDiscord(phoneNumber, message, channelId);
      }
      
      // Clear pending messages
      this.pendingMessages.delete(phoneNumber);
      
      return true;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error processing pending messages:`, error);
      return false;
    }
  }
}

module.exports = WhatsAppHandler;
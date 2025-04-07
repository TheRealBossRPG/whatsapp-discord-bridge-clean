// modules/handlers/WhatsAppHandler.js - Fixed for proper message handling

/**
 * WhatsAppHandler class for handling WhatsApp messages
 */
class WhatsAppHandler {
  /**
   * Create a new WhatsAppHandler
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} userCardManager - User card manager
   * @param {Object} channelManager - Channel manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} vouchHandler - Vouch handler
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
    this.tempDir = options.tempDir || null;
    
    // Default messages
    this.welcomeMessage = "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage = "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage = "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
    
    console.log(`[WhatsAppHandler:${this.instanceId}] Initialized`);
  }
  
  /**
   * Handle a WhatsApp message
   * @param {Object} message - WhatsApp message
   */
  async handleMessage(message) {
    try {
      // Validate message
      if (!message || !message.key) {
        console.log(`[WhatsAppHandler:${this.instanceId}] Invalid message received:`, message);
        return;
      }
      
      // Skip messages sent by us
      if (message.key.fromMe) {
        return;
      }
      
      // Skip broadcast messages
      if (message.key.remoteJid.includes('@broadcast') || message.broadcast) {
        return;
      }
      
      // Skip status messages
      if (message.key.remoteJid === 'status@broadcast') {
        return;
      }
      
      // Extract the sender's phone number
      const senderPhone = message.key.remoteJid;
      
      // Get message content
      const messageContent = this.extractMessageContent(message);
      if (!messageContent) {
        console.log(`[WhatsAppHandler:${this.instanceId}] Empty message received from ${senderPhone}`);
        return;
      }
      
      console.log(`[WhatsAppHandler:${this.instanceId}] Message received from ${senderPhone}: ${messageContent.substring(0, 50)}${messageContent.length > 50 ? '...' : ''}`);
      
      // Check if this is a vouch message
      if (this.vouchHandler && messageContent.toLowerCase().startsWith('vouch!')) {
        return await this.vouchHandler.handleVouchMessage(message);
      }
      
      // Check if there is an existing channel for this user
      const existingChannel = this.channelManager.getChannelByPhone(senderPhone);
      
      if (existingChannel) {
        // Forward message to existing channel
        return await this.handleExistingUserMessage(message, existingChannel, senderPhone);
      } else {
        // New conversation
        return await this.handleNewUserMessage(message, senderPhone);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling WhatsApp message:`, error);
    }
  }
  
  /**
   * Extract message content from WhatsApp message
   * @param {Object} message - WhatsApp message
   * @returns {string|null} - Message content or null
   */
  extractMessageContent(message) {
    if (!message) return null;
    
    try {
      // Text message
      if (message.message?.conversation) {
        return message.message.conversation;
      }
      
      // Extended text message
      if (message.message?.extendedTextMessage?.text) {
        return message.message.extendedTextMessage.text;
      }
      
      // Button response
      if (message.message?.buttonResponseMessage?.selectedDisplayText) {
        return message.message.buttonResponseMessage.selectedDisplayText;
      }
      
      // List response
      if (message.message?.listResponseMessage?.title) {
        return message.message.listResponseMessage.title;
      }
      
      // Template button reply
      if (message.message?.templateButtonReplyMessage?.selectedDisplayText) {
        return message.message.templateButtonReplyMessage.selectedDisplayText;
      }
      
      // Image with caption
      if (message.message?.imageMessage?.caption) {
        return message.message.imageMessage.caption;
      }
      
      // Video with caption
      if (message.message?.videoMessage?.caption) {
        return message.message.videoMessage.caption;
      }
      
      // Audio (no content, but we'll return a placeholder)
      if (message.message?.audioMessage) {
        return '[Audio message]';
      }
      
      // Document with filename
      if (message.message?.documentMessage?.fileName) {
        return `[Document: ${message.message.documentMessage.fileName}]`;
      }
      
      // Sticker (no content, but we'll return a placeholder)
      if (message.message?.stickerMessage) {
        return '[Sticker]';
      }
      
      // Location
      if (message.message?.locationMessage) {
        const loc = message.message.locationMessage;
        if (loc.name) {
          return `[Location: ${loc.name} - Lat: ${loc.degreesLatitude}, Long: ${loc.degreesLongitude}]`;
        }
        return `[Location - Lat: ${loc.degreesLatitude}, Long: ${loc.degreesLongitude}]`;
      }
      
      // Contact
      if (message.message?.contactMessage || message.message?.contactsArrayMessage) {
        return '[Contact shared]';
      }
      
      return null;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error extracting message content:`, error);
      return null;
    }
  }
  
  /**
   * Handle message from a new user
   * @param {Object} message - WhatsApp message
   * @param {string} senderPhone - Sender's phone number
   */
  async handleNewUserMessage(message, senderPhone) {
    try {
      // Check if this user has a card
      const userCard = this.userCardManager.getUserCardByPhone(senderPhone);
      
      if (userCard && userCard.name) {
        // User exists but doesn't have a channel - reopen a ticket
        const userData = {
          name: userCard.name,
          phoneNumber: senderPhone
        };
        
        // Create a new channel
        const channel = await this.ticketManager.createTicketChannel(userData);
        
        if (channel) {
          // Store the mapping
          this.channelManager.addChannelMapping(senderPhone, channel.id);
          
          // Send reopen message
          await this.sendWhatsAppMessage(
            senderPhone, 
            this.reopenTicketMessage.replace('{name}', userCard.name)
          );
          
          // Forward the message to the new channel
          const messageContent = this.extractMessageContent(message);
          await this.forwardMessageToDiscord(channel.id, userCard.name, messageContent, message);
        }
      } else {
        // Brand new user - start name-gathering process
        await this.sendWhatsAppMessage(senderPhone, this.welcomeMessage);
        
        // Store temporary user data
        const tempData = {
          phoneNumber: senderPhone,
          awaitingName: true,
          firstMessage: this.extractMessageContent(message)
        };
        
        // Create a user card
        this.userCardManager.createUserCard(tempData);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling new user message:`, error);
    }
  }
  
  /**
   * Handle message from an existing user
   * @param {Object} message - WhatsApp message
   * @param {string} channelId - Discord channel ID
   * @param {string} senderPhone - Sender's phone number
   */
  async handleExistingUserMessage(message, channelId, senderPhone) {
    try {
      // Get user info
      const userCard = this.userCardManager.getUserCardByPhone(senderPhone);
      
      if (!userCard) {
        console.log(`[WhatsAppHandler:${this.instanceId}] No user card found for ${senderPhone}`);
        return;
      }
      
      // Check if this user is still in name-gathering process
      if (userCard.awaitingName) {
        // User has provided their name
        const name = this.extractMessageContent(message);
        
        // Update user card
        this.userCardManager.updateUserCard(userCard.id || userCard._id, {
          name,
          awaitingName: false
        });
        
        // Send intro message
        await this.sendWhatsAppMessage(
          senderPhone, 
          this.introMessage.replace('{name}', name)
        );
        
        // Create a ticket in Discord
        const userData = {
          name,
          phoneNumber: senderPhone,
          firstMessage: userCard.firstMessage
        };
        
        const channel = await this.ticketManager.createTicketChannel(userData);
        
        if (channel) {
          // Store the mapping
          this.channelManager.addChannelMapping(senderPhone, channel.id);
          
          // If there was a first message, forward it
          if (userCard.firstMessage) {
            await this.forwardMessageToDiscord(channel.id, name, userCard.firstMessage);
          }
        }
      } else {
        // Regular message from existing user - forward to Discord
        const messageContent = this.extractMessageContent(message);
        await this.forwardMessageToDiscord(channelId, userCard.name, messageContent, message);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling existing user message:`, error);
    }
  }
  
  /**
   * Forward a message to Discord
   * @param {string} channelId - Discord channel ID
   * @param {string} username - User's name
   * @param {string} content - Message content
   * @param {Object} originalMessage - Original WhatsApp message
   */
  async forwardMessageToDiscord(channelId, username, content, originalMessage = null) {
    try {
      if (!this.ticketManager || !channelId) return;
      
      // Forward the message
      await this.ticketManager.forwardMessageToDiscord(channelId, username, content, originalMessage);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error forwarding message to Discord:`, error);
    }
  }
  
  /**
   * Send a WhatsApp message
   * @param {string} to - Recipient phone number
   * @param {string} message - Message text
   */
  async sendWhatsAppMessage(to, message) {
    try {
      if (!this.whatsAppClient) {
        console.error(`[WhatsAppHandler:${this.instanceId}] WhatsApp client not available`);
        return;
      }
      
      // Send message
      await this.whatsAppClient.sendMessage(to, message);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending WhatsApp message:`, error);
    }
  }
}

module.exports = WhatsAppHandler;
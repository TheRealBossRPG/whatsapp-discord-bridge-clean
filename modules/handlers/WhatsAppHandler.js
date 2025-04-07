// modules/handlers/WhatsAppHandler.js
const fs = require('fs');
const path = require('path');

/**
 * Handler for WhatsApp messages and interactions
 */
class WhatsAppHandler {
  /**
   * Create a new WhatsApp handler
   * @param {Object} whatsAppClient - WhatsApp client instance
   * @param {Object} userCardManager - User card manager
   * @param {Object} channelManager - Channel manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} vouchHandler - Vouch handler (optional)
   * @param {Object} options - Additional options
   */
  constructor(whatsAppClient, userCardManager, channelManager, ticketManager, transcriptManager, vouchHandler, options = {}) {
    this.whatsAppClient = whatsAppClient;
    this.userCardManager = userCardManager;
    this.channelManager = channelManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.vouchHandler = vouchHandler;
    
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    
    // Welcome message template
    this.welcomeMessage = "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    
    // Introduction message template (after name is provided)
    this.introMessage = "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    
    // Message when reopening a ticket
    this.reopenTicketMessage = "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`[WhatsAppHandler:${this.instanceId}] Initialized`);
  }
  
  /**
   * Handle an incoming WhatsApp message
   * @param {Object} message - WhatsApp message
   */
  async handleMessage(message) {
    try {
      // Basic message validation
      if (!message || !message.key || !message.key.remoteJid) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Invalid message format`);
        return;
      }

      // Extract key information
      const { remoteJid } = message.key;
      
      // Skip non-private chats and status messages
      if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) {
        return;
      }
      
      // Extract message content
      const messageContent = this.extractMessageContent(message);
      if (!messageContent) return;
      
      // Get the phone number and user data
      const phoneNumber = remoteJid.split('@')[0];
      let userCard = this.userCardManager.getUserCard(phoneNumber);
      
      // Check if we need to create a new user or if this is an existing conversation
      if (!userCard) {
        // New user - ask for name
        await this.handleNewUser(phoneNumber, messageContent, message);
      } else if (!userCard.name || userCard.name === 'Unknown') {
        // User exists but no name - this might be the response to our name request
        await this.handleNameResponse(phoneNumber, messageContent, userCard, message);
      } else {
        // Existing user with name - normal message handling
        await this.handleExistingUser(phoneNumber, messageContent, userCard, message);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error processing message:`, error);
    }
  }
  
  /**
   * Handle a message from a new user
   * @param {string} phoneNumber - User's phone number
   * @param {Object} messageContent - Extracted message content
   * @param {Object} originalMessage - Original WhatsApp message
   */
  async handleNewUser(phoneNumber, messageContent, originalMessage) {
    try {
      // Create a new user card with unknown name
      const userCard = this.userCardManager.createUserCard(phoneNumber);
      
      // Send welcome message asking for name
      await this.whatsAppClient.sendMessage(
        `${phoneNumber}@s.whatsapp.net`,
        { text: this.welcomeMessage }
      );
      
      // Save the first message to show when ticket is created
      userCard.queuedMessages = [this.formatMessage(phoneNumber, 'incoming', messageContent, originalMessage)];
      this.userCardManager.saveUserCards();
      
      console.log(`[WhatsAppHandler:${this.instanceId}] New user ${phoneNumber} greeted and asked for name`);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling new user:`, error);
    }
  }
  
  /**
   * Handle a name response from a user
   * @param {string} phoneNumber - User's phone number
   * @param {Object} messageContent - Extracted message content
   * @param {Object} userCard - User's card
   * @param {Object} originalMessage - Original WhatsApp message
   */
  async handleNameResponse(phoneNumber, messageContent, userCard, originalMessage) {
    try {
      // Set the name from user response
      const name = messageContent.text ? messageContent.text.trim() : "Unknown User";
      
      // Validate the name - must be at least 2 characters and not too long
      if (name.length < 2 || name.length > 50) {
        await this.whatsAppClient.sendMessage(
          `${phoneNumber}@s.whatsapp.net`,
          { text: "Please provide a valid name (between 2-50 characters)." }
        );
        return;
      }
      
      // Update the user card with the name
      userCard.name = name;
      
      // Initialize queued messages if not existing
      if (!userCard.queuedMessages) {
        userCard.queuedMessages = [];
      }
      
      // Save the user card
      this.userCardManager.saveUserCards();
      
      // Get clean JID
      const jid = `${phoneNumber}@s.whatsapp.net`;
      
      // Send intro message
      const introMsg = this.introMessage.replace(/{name}/g, name).replace(/{phoneNumber}/g, phoneNumber);
      await this.whatsAppClient.sendMessage(jid, { text: introMsg });
      
      // Add this message to the queue
      userCard.queuedMessages.push(this.formatMessage(phoneNumber, 'incoming', messageContent, originalMessage));
      this.userCardManager.saveUserCards();
      
      // Create discord ticket for this user
      await this.createDiscordTicket(phoneNumber, name, userCard);
      
      console.log(`[WhatsAppHandler:${this.instanceId}] User ${phoneNumber} provided name: ${name}, ticket created`);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling name response:`, error);
    }
  }
  
  /**
   * Handle messages from existing users
   * @param {string} phoneNumber - User's phone number
   * @param {Object} messageContent - Extracted message content
   * @param {Object} userCard - User's card
   * @param {Object} originalMessage - Original WhatsApp message
   */
  async handleExistingUser(phoneNumber, messageContent, userCard, originalMessage) {
    try {
      // Check if we have a channel for this user
      const channelId = this.channelManager.getChannelIdForJid(phoneNumber);
      
      // Format the message for forwarding
      const formattedMessage = this.formatMessage(phoneNumber, 'incoming', messageContent, originalMessage);
      
      if (!channelId) {
        // No channel yet - perhaps old user reconnecting
        // Queue the message
        userCard.queuedMessages = userCard.queuedMessages || [];
        userCard.queuedMessages.push(formattedMessage);
        this.userCardManager.saveUserCards();
        
        // Send reopen message
        const reopenMsg = this.reopenTicketMessage.replace(/{name}/g, userCard.name).replace(/{phoneNumber}/g, phoneNumber);
        await this.whatsAppClient.sendMessage(
          `${phoneNumber}@s.whatsapp.net`,
          { text: reopenMsg }
        );
        
        // Create a new ticket
        await this.createDiscordTicket(phoneNumber, userCard.name, userCard);
      } else {
        // We have a channel - forward the message directly
        await this.sendMessageToDiscord(channelId, formattedMessage, userCard);
        
        // Check for vouch command if enabled
        if (messageContent.text && 
            messageContent.text.toLowerCase().startsWith('vouch!') && 
            this.vouchHandler && 
            !this.vouchHandler.isDisabled) {
          await this.vouchHandler.handleVouch(phoneNumber, messageContent, userCard, originalMessage);
        }
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling existing user message:`, error);
    }
  }
  
  /**
   * Get contact name for a JID
   * @param {string} jid - JID to get name for
   * @returns {Promise<string>} - Contact name
   */
  async getContactName(jid) {
    try {
      // Remove any suffix from the JID
      const cleanJid = jid.split('@')[0];
      
      // Try to get from user card manager first
      if (this.userCardManager) {
        const userCard = this.userCardManager.getUserCard(cleanJid);
        if (userCard && userCard.name && userCard.name !== 'Unknown') {
          return userCard.name;
        }
      }
      
      // Fall back to just using the phone number
      return cleanJid;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error getting contact name:`, error);
      return jid.split('@')[0];
    }
  }
  
  /**
   * Create a Discord ticket for a user
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   * @param {Object} userCard - User's card
   * @returns {Promise<Object>} - Created channel
   */
  async createDiscordTicket(phoneNumber, name, userCard) {
    try {
      // Create the ticket using ticket manager
      const channel = await this.ticketManager.createTicket(name, phoneNumber);
      
      if (!channel) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Failed to create ticket for ${name} (${phoneNumber})`);
        return null;
      }
      
      // Register the channel in channel manager
      this.channelManager.addChannel(phoneNumber, channel.id);
      this.channelManager.saveChannelMap();
      
      // Process any queued messages
      if (userCard.queuedMessages && userCard.queuedMessages.length > 0) {
        for (const message of userCard.queuedMessages) {
          await this.sendMessageToDiscord(channel.id, message, userCard);
        }
        
        // Clear the queue
        userCard.queuedMessages = [];
        this.userCardManager.saveUserCards();
      }
      
      console.log(`[WhatsAppHandler:${this.instanceId}] Created ticket ${channel.id} for ${name} (${phoneNumber})`);
      return channel;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error creating Discord ticket:`, error);
      return null;
    }
  }
  
  /**
   * Send a message to Discord
   * @param {string} channelId - Channel ID to send to
   * @param {Object} message - Formatted message
   * @param {Object} userCard - User's card
   */
  async sendMessageToDiscord(channelId, message, userCard) {
    try {
      // Make sure the ticket manager has the sendWhatsAppMessage method
      if (!this.ticketManager || typeof this.ticketManager.sendWhatsAppMessage !== 'function') {
        console.error(`[WhatsAppHandler:${this.instanceId}] Ticket manager missing or lacking sendWhatsAppMessage method`);
        return;
      }
      
      // Extract info from message
      const { phoneNumber, content } = message;
      
      // Get display name
      const displayName = userCard && userCard.name ? userCard.name : await this.getContactName(phoneNumber);
      
      // Process media if present
      let mediaUrl = null;
      if (content.type && content.type !== 'text') {
        // Download media
        const mediaBuffer = await this.downloadMedia(message.originalMessage);
        
        if (mediaBuffer) {
          // Save to temp dir
          const mediaPath = path.join(this.tempDir, content.fileName || `media_${Date.now()}`);
          fs.writeFileSync(mediaPath, mediaBuffer);
          mediaUrl = mediaPath;
        }
      }
      
      // Send to Discord
      await this.ticketManager.sendWhatsAppMessage(
        channelId, 
        content.text || '', 
        displayName, 
        phoneNumber,
        mediaUrl
      );
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending message to Discord:`, error);
    }
  }
  
  /**
   * Download media from a message
   * @param {Object} message - WhatsApp message with media
   * @returns {Promise<Buffer>} - Media buffer
   */
  async downloadMedia(message) {
    try {
      if (!this.whatsAppClient || typeof this.whatsAppClient.downloadMedia !== 'function') {
        console.error(`[WhatsAppHandler:${this.instanceId}] WhatsApp client missing or lacking downloadMedia method`);
        return null;
      }
      
      return await this.whatsAppClient.downloadMedia(message);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error downloading media:`, error);
      return null;
    }
  }
  
  /**
   * Send a message from Discord to WhatsApp
   * @param {string} phoneNumber - Phone number to send to
   * @param {string} message - Message to send
   * @param {string} attachment - Attachment path (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async sendMessageToWhatsApp(phoneNumber, message, attachment = null) {
    try {
      if (!this.whatsAppClient) {
        console.error(`[WhatsAppHandler:${this.instanceId}] WhatsApp client not initialized`);
        return false;
      }
      
      // Format the JID
      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
      
      // Send text or media message
      if (attachment) {
        // Read the attachment
        const buffer = fs.readFileSync(attachment);
        const mimetype = this.getMimeType(attachment);
        
        // Send as media message
        await this.whatsAppClient.sendMessage(jid, {
          caption: message,
          mimetype,
          buffer
        });
      } else {
        // Send as text message
        await this.whatsAppClient.sendMessage(jid, { text: message });
      }
      
      return true;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending message to WhatsApp:`, error);
      return false;
    }
  }
  
  /**
   * Extract message content from WhatsApp message
   * @param {Object} message - WhatsApp message
   * @returns {Object|null} - Extracted content or null
   */
  extractMessageContent(message) {
    try {
      // Check if message is valid
      if (!message.message) {
        return null;
      }
      
      // Check for text message types
      if (message.message.conversation) {
        return {
          type: 'text',
          text: message.message.conversation
        };
      }
      
      if (message.message.extendedTextMessage) {
        return {
          type: 'text',
          text: message.message.extendedTextMessage.text
        };
      }
      
      // Check for media types
      const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
      
      for (const type of mediaTypes) {
        if (message.message[type]) {
          return {
            type,
            text: message.message[type].caption || '',
            fileName: message.message[type].fileName || `${type.replace('Message', '')}.${this.getExtensionFromMimetype(message.message[type].mimetype)}`,
            mimetype: message.message[type].mimetype
          };
        }
      }
      
      // Return null if no supported content found
      return null;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error extracting message content:`, error);
      return null;
    }
  }
  
  /**
   * Format a message for forwarding
   * @param {string} phoneNumber - Phone number
   * @param {string} direction - Message direction (incoming/outgoing)
   * @param {Object} content - Message content
   * @param {Object} originalMessage - Original WhatsApp message
   * @returns {Object} - Formatted message
   */
  formatMessage(phoneNumber, direction, content, originalMessage) {
    return {
      phoneNumber,
      direction,
      content,
      timestamp: new Date().toISOString(),
      originalMessage
    };
  }
  
  /**
   * Get file extension from MIME type
   * @param {string} mimetype - MIME type
   * @returns {string} - File extension
   */
  getExtensionFromMimetype(mimetype) {
    if (!mimetype) return 'bin';
    
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'application/pdf': 'pdf'
    };
    
    return mimeMap[mimetype] || 'bin';
  }
  
  /**
   * Get MIME type from file path
   * @param {string} filePath - File path
   * @returns {string} - MIME type
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    
    const mimeMap = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'mp4': 'video/mp4',
      'mp3': 'audio/mpeg',
      'ogg': 'audio/ogg',
      'pdf': 'application/pdf'
    };
    
    return mimeMap[ext] || 'application/octet-stream';
  }
}

module.exports = WhatsAppHandler;
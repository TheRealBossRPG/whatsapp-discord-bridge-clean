// modules/handlers/WhatsAppHandler.js
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

/**
 * Handler for incoming WhatsApp messages
 */
class WhatsAppHandler {
  /**
   * Create a new WhatsApp handler
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
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    
    // Custom messages
    this.welcomeMessage = options.welcomeMessage || "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage = options.introMessage || "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage = options.reopenTicketMessage || "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`[WhatsAppHandler:${this.instanceId}] Initialized`);
  }
  
  /**
   * Handle incoming WhatsApp message
   * @param {Object} message - Incoming message
   */
  async handleMessage(message) {
    try {
      // Log the incoming message
      console.log(`[WhatsAppHandler:${this.instanceId}] Message from ${message.from}: ${message.content}`);
      
      // Check for commands
      if (message.content.startsWith('!') || message.content.startsWith('/')) {
        await this.handleCommand(message);
        return;
      }
      
      // Check for vouch messages
      if (message.content.toLowerCase().startsWith('vouch!') || message.content.toLowerCase().startsWith('vouch:')) {
        await this.handleVouch(message);
        return;
      }
      
      // Check if we have an existing channel for this user
      const channel = this.channelManager.getChannelByPhone(message.from);
      
      if (channel) {
        // Existing conversation - forward message to Discord
        await this.forwardToDiscord(message, channel);
      } else {
        // New conversation - start onboarding process
        await this.handleNewConversation(message);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling message:`, error);
    }
  }
  
  /**
   * Handle a new conversation with a user
   * @param {Object} message - First message
   */
  async handleNewConversation(message) {
    try {
      console.log(`[WhatsAppHandler:${this.instanceId}] New conversation with ${message.from}`);
      
      // Send welcome message
      await this.whatsAppClient.sendMessage(message.jid, { text: this.welcomeMessage });
      
      // Get or create user card
      let userCard = this.userCardManager.getUserCardByPhone(message.from);
      
      if (!userCard) {
        // Create a new user card
        userCard = this.userCardManager.createUserCard(message.from, message.content);
      }
      
      // Check if name was provided in message
      if (message.content && message.content.length > 1) {
        // Assume first message has the name
        userCard.name = message.content.trim();
        this.userCardManager.updateUserCard(userCard);
        
        // Get personalized intro message
        const personalizedIntro = this.introMessage.replace(/{name}/g, userCard.name);
        
        // Send intro message
        await this.whatsAppClient.sendMessage(message.jid, { text: personalizedIntro });
        
        // Create ticket/channel
        await this.createTicket(userCard, message);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error in new conversation:`, error);
    }
  }
  
  /**
   * Create a new ticket for a user
   * @param {Object} userCard - User card
   * @param {Object} message - Initial message
   * @returns {Object} - Created channel information
   */
  async createTicket(userCard, message) {
    try {
      // Generate a ticket UUID
      const ticketId = randomUUID().substring(0, 8);
      
      // Create ticket details
      const ticketDetails = {
        id: ticketId,
        phoneNumber: userCard.phoneNumber,
        name: userCard.name || 'Unknown',
        message: message.content,
        timestamp: Date.now(),
        instanceId: this.instanceId
      };
      
      // Create Discord channel
      const channel = await this.ticketManager.createTicket(
        ticketDetails.name,
        ticketDetails.phoneNumber,
        ticketDetails
      );
      
      if (!channel) {
        throw new Error('Failed to create Discord channel');
      }
      
      // Register channel in manager
      this.channelManager.registerChannel(
        ticketDetails.phoneNumber,
        channel.id,
        {
          ...ticketDetails,
          channelId: channel.id,
          type: 'ticket'
        }
      );
      
      return channel;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error creating ticket:`, error);
      
      // Try to notify user of error
      try {
        const errorMessage = "Sorry, I couldn't create a support ticket at this time. Please try again later.";
        await this.whatsAppClient.sendMessage(
          this.whatsAppClient.formatJid(userCard.phoneNumber),
          { text: errorMessage }
        );
      } catch (notifyError) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Error sending error notification:`, notifyError);
      }
      
      return null;
    }
  }
  
  /**
   * Forward message to Discord
   * @param {Object} message - WhatsApp message
   * @param {Object} channel - Discord channel info
   */
  async forwardToDiscord(message, channel) {
    try {
      // Get user card
      const userCard = this.userCardManager.getUserCardByPhone(message.from);
      
      // If no user card, create one
      if (!userCard) {
        this.userCardManager.createUserCard(message.from, '');
      }
      
      // Get Discord channel
      if (!channel.channelId) {
        throw new Error('No channel ID for forwarding');
      }
      
      if (message.media) {
        // Handle media messages
        await this.forwardMediaToDiscord(message, channel);
      } else {
        // Handle text messages
        await this.ticketManager.sendMessage(
          channel.channelId,
          message.content,
          `**${userCard?.name || 'Customer'}:**`
        );
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error forwarding to Discord:`, error);
    }
  }
  
  /**
   * Forward media message to Discord
   * @param {Object} message - WhatsApp message
   * @param {Object} channel - Discord channel info
   */
  async forwardMediaToDiscord(message, channel) {
    try {
      // Get user card
      const userCard = this.userCardManager.getUserCardByPhone(message.from);
      
      // Download media
      const buffer = await this.whatsAppClient.downloadMedia(message.messageObject);
      
      if (!buffer) {
        throw new Error('Failed to download media');
      }
      
      // Determine file extension
      let fileExtension = '.bin';
      let fileName = `media_${Date.now()}`;
      
      // Try to get mimetype from message
      const msg = message.messageObject.message;
      let mimeType = null;
      
      if (msg.imageMessage) {
        mimeType = msg.imageMessage.mimetype;
        fileExtension = mimeType ? `.${mimeType.split('/')[1]}` : '.jpg';
        fileName = `image_${Date.now()}${fileExtension}`;
      } else if (msg.videoMessage) {
        mimeType = msg.videoMessage.mimetype;
        fileExtension = mimeType ? `.${mimeType.split('/')[1]}` : '.mp4';
        fileName = `video_${Date.now()}${fileExtension}`;
      } else if (msg.audioMessage) {
        mimeType = msg.audioMessage.mimetype;
        fileExtension = mimeType ? `.${mimeType.split('/')[1]}` : '.ogg';
        fileName = `audio_${Date.now()}${fileExtension}`;
      } else if (msg.documentMessage) {
        fileExtension = path.extname(msg.documentMessage.fileName || '');
        fileName = msg.documentMessage.fileName || `document_${Date.now()}${fileExtension}`;
      } else if (msg.stickerMessage) {
        mimeType = msg.stickerMessage.mimetype;
        fileExtension = mimeType ? `.${mimeType.split('/')[1]}` : '.webp';
        fileName = `sticker_${Date.now()}${fileExtension}`;
      }
      
      // Save media to temp file
      const filePath = path.join(this.tempDir, fileName);
      fs.writeFileSync(filePath, buffer);
      
      // Send caption if any
      if (message.content && message.content.trim() !== '') {
        await this.ticketManager.sendMessage(
          channel.channelId,
          message.content,
          `**${userCard?.name || 'Customer'}:**`
        );
      }
      
      // Send file to Discord
      await this.ticketManager.sendFile(
        channel.channelId,
        filePath,
        `**${userCard?.name || 'Customer'}** sent a file:`,
        fileName
      );
      
      // Clean up temp file after a short delay
      setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (unlinkError) {
          console.error(`[WhatsAppHandler:${this.instanceId}] Error deleting temp file:`, unlinkError);
        }
      }, 5000);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error forwarding media:`, error);
      
      // Try to send error message to Discord
      try {
        await this.ticketManager.sendMessage(
          channel.channelId,
          `Error: Could not process media from WhatsApp: ${error.message}`,
          'Media Error'
        );
      } catch (notifyError) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Error sending error message:`, notifyError);
      }
    }
  }
  
  /**
   * Handle WhatsApp command
   * @param {Object} message - Command message
   */
  async handleCommand(message) {
    try {
      // Parse command
      const commandParts = message.content.trim().split(' ');
      const command = commandParts[0].toLowerCase();
      const args = commandParts.slice(1);
      
      // Get user card
      const userCard = this.userCardManager.getUserCardByPhone(message.from);
      
      if (!userCard) {
        // Send error message
        await this.whatsAppClient.sendMessage(message.jid, {
          text: "Sorry, I don't recognize your account. Please start a new conversation."
        });
        return;
      }
      
      // Handle supported commands
      if (command === '!help' || command === '/help') {
        await this.handleHelpCommand(message, userCard);
      } else if (command === '!vouch' || command === '/vouch') {
        await this.handleVouchCommand(message, userCard);
      } else {
        // Unknown command
        await this.whatsAppClient.sendMessage(message.jid, {
          text: `Unknown command: ${command}. Type !help for available commands.`
        });
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling command:`, error);
    }
  }
  
  /**
   * Handle help command
   * @param {Object} message - Command message
   * @param {Object} userCard - User card
   */
  async handleHelpCommand(message, userCard) {
    try {
      const helpMessage = `*Available Commands:*\n\n` +
                          `!help - Show this help message\n` +
                          `!vouch - Leave a review for our service\n\n` +
                          `Type a message anytime to contact support.`;
      
      await this.whatsAppClient.sendMessage(message.jid, { text: helpMessage });
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling help command:`, error);
    }
  }
  
  /**
   * Handle vouch command
   * @param {Object} message - Command message
   * @param {Object} userCard - User card
   */
  async handleVouchCommand(message, userCard) {
    try {
      // If no vouch handler, return
      if (!this.vouchHandler) {
        await this.whatsAppClient.sendMessage(message.jid, { 
          text: "Sorry, the vouch system is not configured. Please contact support for assistance."
        });
        return;
      }
      
      // Check if vouch handler is disabled
      if (this.vouchHandler.isDisabled) {
        await this.whatsAppClient.sendMessage(message.jid, { 
          text: "Sorry, the vouch system is currently disabled."
        });
        return;
      }
      
      // Get vouch message
      const vouchMessage = this.vouchHandler.getVouchMessage(userCard);
      
      // Send vouch instructions
      await this.whatsAppClient.sendMessage(message.jid, { text: vouchMessage });
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling vouch command:`, error);
    }
  }
  
  /**
   * Handle vouch message
   * @param {Object} message - Vouch message
   */
  async handleVouch(message) {
    try {
      // If no vouch handler, return
      if (!this.vouchHandler) {
        await this.whatsAppClient.sendMessage(message.jid, { 
          text: "Sorry, the vouch system is not configured. Please contact support for assistance."
        });
        return;
      }
      
      // Check if vouch handler is disabled
      if (this.vouchHandler.isDisabled) {
        await this.whatsAppClient.sendMessage(message.jid, {
          text: "Sorry, the vouch system is currently disabled."
        });
        return;
      }
      
      // Get user card
      const userCard = this.userCardManager.getUserCardByPhone(message.from);
      
      if (!userCard) {
        await this.whatsAppClient.sendMessage(message.jid, {
          text: "Sorry, I don't recognize your account. Please start a new conversation."
        });
        return;
      }
      
      // Process vouch
      const vouchText = message.content.replace(/^vouch[!:]/i, '').trim();
      
      if (!vouchText) {
        await this.whatsAppClient.sendMessage(message.jid, {
          text: "Please include a message with your vouch. For example: 'Vouch! Great service!'"
        });
        return;
      }
      
      // Get media if any
      let mediaPath = null;
      
      if (message.media) {
        try {
          // Download media
          const buffer = await this.whatsAppClient.downloadMedia(message.messageObject);
          
          if (buffer) {
            // Determine file extension
            let fileExtension = '.jpg';
            const msg = message.messageObject.message;
            
            if (msg.imageMessage) {
              const mimeType = msg.imageMessage.mimetype;
              fileExtension = mimeType ? `.${mimeType.split('/')[1]}` : '.jpg';
            } else if (msg.videoMessage) {
              const mimeType = msg.videoMessage.mimetype;
              fileExtension = mimeType ? `.${mimeType.split('/')[1]}` : '.mp4';
            }
            
            // Save media to temp file
            const fileName = `vouch_${Date.now()}${fileExtension}`;
            mediaPath = path.join(this.tempDir, fileName);
            fs.writeFileSync(mediaPath, buffer);
          }
        } catch (mediaError) {
          console.error(`[WhatsAppHandler:${this.instanceId}] Error processing vouch media:`, mediaError);
        }
      }
      
      // Submit the vouch
      const success = await this.vouchHandler.submitVouch(userCard, vouchText, mediaPath);
      
      if (success) {
        // Send success message
        const successMessage = this.vouchHandler.getVouchSuccessMessage();
        await this.whatsAppClient.sendMessage(message.jid, { text: successMessage });
      } else {
        // Send error message
        await this.whatsAppClient.sendMessage(message.jid, {
          text: "Sorry, I couldn't submit your vouch. Please try again later."
        });
      }
      
      // Clean up temp file if any
      if (mediaPath && fs.existsSync(mediaPath)) {
        setTimeout(() => {
          try {
            fs.unlinkSync(mediaPath);
          } catch (unlinkError) {
            console.error(`[WhatsAppHandler:${this.instanceId}] Error deleting vouch media file:`, unlinkError);
          }
        }, 5000);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling vouch:`, error);
    }
  }
  
  /**
   * Handle message from Discord to WhatsApp
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} message - Message text
   * @param {Object} files - Optional file paths to send
   * @returns {Promise<boolean>} - Success status
   */
  async sendMessage(phoneNumber, message, files = []) {
    try {
      if (!this.whatsAppClient || !phoneNumber) {
        return false;
      }
      
      // Clean phone number
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      
      // Format JID
      const jid = this.whatsAppClient.formatJid(cleanPhone);
      
      // Send text message
      if (message && message.trim() !== '') {
        await this.whatsAppClient.sendMessage(jid, { text: message });
      }
      
      // Send files if any
      for (const filePath of files) {
        if (fs.existsSync(filePath)) {
          // Get file buffer
          const buffer = fs.readFileSync(filePath);
          
          // Determine file type
          const ext = path.extname(filePath).toLowerCase();
          const fileName = path.basename(filePath);
          
          if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
            // Send as image
            await this.whatsAppClient.sendMessage(jid, {
              image: buffer,
              caption: fileName
            });
          } else if (['.mp4', '.mov', '.avi', '.webm'].includes(ext)) {
            // Send as video
            await this.whatsAppClient.sendMessage(jid, {
              video: buffer,
              caption: fileName
            });
          } else if (['.mp3', '.ogg', '.wav'].includes(ext)) {
            // Send as audio
            await this.whatsAppClient.sendMessage(jid, {
              audio: buffer,
              mimetype: 'audio/mp4'
            });
          } else {
            // Send as document
            await this.whatsAppClient.sendMessage(jid, {
              document: buffer,
              mimetype: 'application/octet-stream',
              fileName: fileName
            });
          }
        }
      }
      
      return true;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending message to WhatsApp:`, error);
      return false;
    }
  }
}

module.exports = WhatsAppHandler;
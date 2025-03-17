// modules/handlers/WhatsAppHandler.js (Fixed for New Message Format)
const fs = require('fs');
const path = require('path');

/**
 * Handler for WhatsApp messages
 */
class WhatsAppHandler {
  /**
   * Create a new WhatsApp handler
   * @param {Object} whatsAppClient - The WhatsApp client
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
    
    // Options
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    
    // Custom messages - with defaults
    this.welcomeMessage = "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage = "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage = "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
    
    // User state tracking
    this.userStates = new Map();
    
    // Bind methods to preserve 'this' context
    this.handleMessage = this.handleMessage.bind(this);
    this.processTextMessage = this.processTextMessage.bind(this);
    this.processMediaMessage = this.processMediaMessage.bind(this);
    this.createOrReopenTicket = this.createOrReopenTicket.bind(this);
    
    // Configure handler
    this.configureHandler();
    
    console.log(`[WhatsAppHandler:${this.instanceId}] Initialized`);
  }
  
  /**
   * Configure the handler
   */
  configureHandler() {
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Subscribe to WhatsApp client events
    if (this.whatsAppClient) {
      // Remove any existing listeners
      this.whatsAppClient.removeAllListeners('message');
      
      // Add our message handler
      this.whatsAppClient.on('message', this.handleMessage);
      
      console.log(`[WhatsAppHandler:${this.instanceId}] Subscribed to WhatsApp client message events`);
    } else {
      console.warn(`[WhatsAppHandler:${this.instanceId}] WhatsApp client not available, cannot subscribe to events`);
    }
  }
  
  /**
   * Get vouch handler
   * @returns {Object} - Vouch handler
   */
  getVouchHandler() {
    return this.vouchHandler;
  }
  
  /**
   * Set vouch handler
   * @param {Object} vouchHandler - Vouch handler
   */
  setVouchHandler(vouchHandler) {
    this.vouchHandler = vouchHandler;
  }
  
  /**
   * Handle incoming WhatsApp message - COMPLETELY REWRITTEN to handle simplified message format
   * @param {Object} message - Simplified WhatsApp message from BaileysClient
   */
  async handleMessage(message) {
    try {
      console.log(`[WhatsAppHandler:${this.instanceId}] Handling message from ${message.jid}`);
      
      // Extract sender's phone number
      const phoneNumber = message.jid;
      
      if (!phoneNumber) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Invalid JID in message`);
        return;
      }
      
      // Skip group messages
      if (phoneNumber.includes('@g.us') || phoneNumber.includes('@broadcast')) {
        console.log(`[WhatsAppHandler:${this.instanceId}] Skipping group/broadcast message from ${phoneNumber}`);
        return;
      }
      
      // Check for vouch message first
      if (this.vouchHandler && message.type === 'text' && message.content.startsWith('Vouch!')) {
        try {
          await this.vouchHandler.handleVouch(message);
        } catch (vouchError) {
          console.error(`[WhatsAppHandler:${this.instanceId}] Error handling vouch message:`, vouchError);
        }
        return;
      }
      
      // Process based on message type
      if (message.type === 'text') {
        // Text message
        await this.processTextMessage(message, phoneNumber);
      } else if (['image', 'video', 'document', 'audio', 'sticker'].includes(message.type)) {
        // Media message
        await this.processMediaMessage(message, phoneNumber);
      } else {
        // Unknown message type - try to handle it anyway
        console.log(`[WhatsAppHandler:${this.instanceId}] Unknown message type from ${phoneNumber}: ${message.type}`);
        
        // Try to extract content from raw message
        let fallbackContent = "Unknown message type";
        
        try {
          if (message.rawMessage && message.rawMessage.message) {
            // Log message keys for debugging
            console.log(`[WhatsAppHandler:${this.instanceId}] Message keys:`, Object.keys(message.rawMessage.message));
            
            // Try to find any text content
            const msgTypes = Object.keys(message.rawMessage.message);
            for (const type of msgTypes) {
              const typeObj = message.rawMessage.message[type];
              
              if (typeObj && typeof typeObj === 'object') {
                if (typeObj.caption) {
                  fallbackContent = typeObj.caption;
                  break;
                } else if (typeObj.text) {
                  fallbackContent = typeObj.text;
                  break;
                } else if (typeObj.content) {
                  fallbackContent = "Media content";
                  break;
                }
              } else if (typeof typeObj === 'string') {
                fallbackContent = typeObj;
                break;
              }
            }
          }
        } catch (extractError) {
          console.error(`[WhatsAppHandler:${this.instanceId}] Error extracting content from unknown message:`, extractError);
        }
        
        await this.createOrReopenTicket(phoneNumber, null, null, fallbackContent || "Unknown message type");
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling message:`, error);
    }
  }
  
  /**
   * Process text message
   * @param {Object} message - WhatsApp message
   * @param {string} phoneNumber - Sender's phone number
   */
  async processTextMessage(message, phoneNumber) {
    try {
      // Extract message text
      const text = message.content || '';
      console.log(`[WhatsAppHandler:${this.instanceId}] Processing text message from ${phoneNumber}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
      
      // Get user state
      const userState = this.userStates.get(phoneNumber) || 'new';
      
      // Check if user exists in userCardManager
      const userExists = await this.userCardManager.userExists(phoneNumber);
      
      if (!userExists && userState === 'new') {
        // First message from new user - ask for their name
        await this.whatsAppClient.sendTextMessage(phoneNumber, this.welcomeMessage);
        this.userStates.set(phoneNumber, 'awaiting_name');
        return;
      } else if (!userExists && userState === 'awaiting_name') {
        // User is providing their name
        const name = text.trim();
        
        // Basic validation
        if (!name || name.length < 2) {
          await this.whatsAppClient.sendTextMessage(phoneNumber, "Please provide a valid name so I can connect you with our support team.");
          return;
        }
        
        // Create user card
        await this.userCardManager.createUserCard(phoneNumber, name);
        
        // Send intro message with name
        const personalizedIntro = this.introMessage.replace(/{name}/g, name);
        await this.whatsAppClient.sendTextMessage(phoneNumber, personalizedIntro);
        
        // Update state
        this.userStates.set(phoneNumber, 'registered');
        
        // Create ticket
        await this.createOrReopenTicket(phoneNumber, name, null, text);
      } else {
        // Existing user sending a message
        const userCard = await this.userCardManager.getUserCard(phoneNumber);
        const name = userCard ? userCard.name : "Customer";
        
        // Create or update ticket
        await this.createOrReopenTicket(phoneNumber, name, null, text);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error processing text message:`, error);
    }
  }
  
  /**
   * Process media message
   * @param {Object} message - WhatsApp message
   * @param {string} phoneNumber - Sender's phone number
   */
  async processMediaMessage(message, phoneNumber) {
    try {
      console.log(`[WhatsAppHandler:${this.instanceId}] Processing media message from ${phoneNumber}: ${message.type}`);
      
      // Extract caption from message
      const caption = message.content || '';
      const mediaType = message.type;
      
      // Get user state
      const userState = this.userStates.get(phoneNumber) || 'new';
      
      // Check if user exists in userCardManager
      const userExists = await this.userCardManager.userExists(phoneNumber);
      
      if (!userExists && userState === 'new') {
        // First message from new user - ask for their name
        await this.whatsAppClient.sendTextMessage(phoneNumber, this.welcomeMessage);
        this.userStates.set(phoneNumber, 'awaiting_name');
        return;
      } else if (!userExists && userState === 'awaiting_name') {
        // User is sending media before providing name
        // We'll use caption as name if available
        let name = caption.trim();
        
        // If no caption, generate a generic name
        if (!name || name.length < 2) {
          name = `User ${phoneNumber.split('@')[0].substring(phoneNumber.length - 4)}`;
        }
        
        // Create user card
        await this.userCardManager.createUserCard(phoneNumber, name);
        
        // Send intro message with name
        const personalizedIntro = this.introMessage.replace(/{name}/g, name);
        await this.whatsAppClient.sendTextMessage(phoneNumber, personalizedIntro);
        
        // Update state
        this.userStates.set(phoneNumber, 'registered');
        
        // Download media and create ticket
        try {
          const mediaPath = await this.downloadMedia(message);
          await this.createOrReopenTicket(phoneNumber, name, mediaPath, caption, mediaType);
        } catch (mediaError) {
          console.error(`[WhatsAppHandler:${this.instanceId}] Error downloading media:`, mediaError);
          await this.createOrReopenTicket(phoneNumber, name, null, `${caption}\n\n[Media download failed: ${mediaType}]`);
        }
      } else {
        // Existing user sending a message
        const userCard = await this.userCardManager.getUserCard(phoneNumber);
        const name = userCard ? userCard.name : "Customer";
        
        // Download media and update ticket
        try {
          const mediaPath = await this.downloadMedia(message);
          await this.createOrReopenTicket(phoneNumber, name, mediaPath, caption, mediaType);
        } catch (mediaError) {
          console.error(`[WhatsAppHandler:${this.instanceId}] Error downloading media:`, mediaError);
          await this.createOrReopenTicket(phoneNumber, name, null, `${caption}\n\n[Media download failed: ${mediaType}]`);
        }
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error processing media message:`, error);
    }
  }
  
  /**
   * Download media from message
   * @param {Object} message - WhatsApp message
   * @returns {Promise<string|null>} - Path to downloaded media or null
   */
  async downloadMedia(message) {
    try {
      if (!this.whatsAppClient || typeof this.whatsAppClient.downloadMedia !== 'function') {
        console.error(`[WhatsAppHandler:${this.instanceId}] WhatsApp client has no downloadMedia method`);
        return null;
      }
      
      // Get media type for extension
      const mediaType = message.type;
      let extension = '.bin';
      
      switch (mediaType) {
        case 'image':
          extension = '.jpg';
          break;
        case 'video':
          extension = '.mp4';
          break;
        case 'audio':
          extension = '.ogg';
          break;
        case 'document':
          // Try to get extension from filename if available
          try {
            if (message.rawMessage?.message?.documentMessage?.fileName) {
              const origExt = path.extname(message.rawMessage.message.documentMessage.fileName);
              if (origExt) extension = origExt;
            }
          } catch (e) {
            // Keep default extension
          }
          break;
        case 'sticker':
          extension = '.webp';
          break;
      }
      
      // Generate temp file path
      const timestamp = Date.now();
      const randomNum = Math.floor(Math.random() * 10000);
      const filename = `${timestamp}_${randomNum}${extension}`;
      const mediaPath = path.join(this.tempDir, filename);
      
      // Ensure temp directory exists
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }
      
      // Download media using the client's method
      const buffer = await this.whatsAppClient.downloadMedia(message);
      
      // Save buffer to file
      fs.writeFileSync(mediaPath, buffer);
      
      console.log(`[WhatsAppHandler:${this.instanceId}] Media saved to ${mediaPath}`);
      return mediaPath;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error downloading media:`, error);
      return null;
    }
  }
  
  /**
   * Create or reopen a ticket for a user
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   * @param {string} mediaPath - Path to media file (if any)
   * @param {string} caption - Message caption or text
   * @param {string} mediaType - Type of media
   * @returns {Promise<Object>} - Ticket object
   */
  async createOrReopenTicket(phoneNumber, name, mediaPath = null, caption = '', mediaType = 'image') {
    try {
      console.log(`[WhatsAppHandler:${this.instanceId}] Creating or reopening ticket for ${phoneNumber} (${name || 'unknown'})`);
      
      // If name not provided, try to get it from user card
      if (!name) {
        try {
          const userCard = await this.userCardManager.getUserCard(phoneNumber);
          if (userCard) name = userCard.name;
        } catch (error) {
          console.error(`[WhatsAppHandler:${this.instanceId}] Error getting user card:`, error);
        }
      }
      
      // Fallback name
      if (!name) name = "Customer";
      
      // Check if channel exists for this phone number
      const channelExists = this.channelManager.channelExists(phoneNumber);
      
      if (channelExists) {
        // Channel exists - get it and send message
        const channelId = this.channelManager.getChannelId(phoneNumber);
        
        if (!channelId) {
          // Channel mapping exists but channel ID is missing - recreate
          console.log(`[WhatsAppHandler:${this.instanceId}] Channel mapping exists but ID is missing, recreating ticket`);
          return this.ticketManager.createTicket(phoneNumber, name, caption, mediaPath, mediaType);
        }
        
        // Send message to channel
        if (mediaPath && fs.existsSync(mediaPath)) {
          // Send media with caption
          await this.ticketManager.sendMediaToTicket(phoneNumber, mediaPath, caption, mediaType);
        } else if (caption) {
          // Send text message
          await this.ticketManager.sendMessageToTicket(phoneNumber, caption);
        }
        
        // Return existing ticket info
        return {
          channelId,
          isNew: false,
          phoneNumber,
          name
        };
      } else {
        // No channel exists - create new ticket
        console.log(`[WhatsAppHandler:${this.instanceId}] Creating new ticket for ${phoneNumber} (${name})`);
        return this.ticketManager.createTicket(phoneNumber, name, caption, mediaPath, mediaType);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error creating/reopening ticket:`, error);
      throw error;
    }
  }
  
  /**
   * Send vouch request to user
   * @param {string} phoneNumber - User's phone number 
   * @returns {Promise<boolean>} - Success status
   */
  async sendVouchRequest(phoneNumber) {
    try {
      if (!this.vouchHandler) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Vouch handler not configured`);
        return false;
      }
      
      return await this.vouchHandler.sendVouchRequest(phoneNumber);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending vouch request:`, error);
      return false;
    }
  }
}

module.exports = WhatsAppHandler;
// modules/handlers/WhatsAppHandler.js
const fs = require('fs');
const path = require('path');

/**
 * Handles WhatsApp message processing and routing
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
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    
    // Custom messages
    this.welcomeMessage = "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage = "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage = "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Initialize names processing
    this.namesBeingProcessed = new Map();
    this.nameTimeouts = new Map();
    
    console.log(`[WhatsAppHandler:${this.instanceId}] Initialized`);
  }

  /**
   * Handle an incoming WhatsApp message
   * @param {Object} message - WhatsApp message
   */
  async handleMessage(message) {
    try {
      if (!message) {
        console.warn(`[WhatsAppHandler:${this.instanceId}] Received empty message`);
        return;
      }
      
      // Get the basic message info
      const remoteJid = message.key.remoteJid;
      
      // Skip messages from ourselves
      if (message.key.fromMe) {
        return;
      }
      
      // Skip broadcast messages and non-user messages
      if (remoteJid.endsWith('@broadcast') || !remoteJid.includes('@s.whatsapp.net')) {
        return;
      }
      
      const sender = message.key.participant || remoteJid;
      const senderNumber = this.extractPhoneNumber(sender);
      
      // Get the message content
      const messageContent = this.extractMessageContent(message);
      if (!messageContent) {
        console.log(`[WhatsAppHandler:${this.instanceId}] Skipping message with no content from ${senderNumber}`);
        return;
      }
      
      // Check if user already has a card
      let userCard = this.userCardManager.getUserCardByPhone(senderNumber);
      
      // Handle vouches if enabled and message looks like a vouch
      if (this.vouchHandler && !this.vouchHandler.isDisabled && 
          messageContent.toLowerCase().startsWith('vouch!')) {
        await this.handleVouch(message, senderNumber, userCard);
        return;
      }
      
      // Process based on whether a user card exists
      if (userCard) {
        await this.handleExistingUser(message, userCard, messageContent);
      } else {
        await this.handleNewUser(message, senderNumber, messageContent);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling WhatsApp message:`, error);
    }
  }
  
  /**
   * Handle message from a new user
   * @param {Object} message - WhatsApp message
   * @param {string} senderNumber - Sender's phone number
   * @param {string} messageContent - Message content
   */
  async handleNewUser(message, senderNumber, messageContent) {
    try {
      const remoteJid = message.key.remoteJid;
      
      // Check if we're already processing a name for this user
      if (this.namesBeingProcessed.has(senderNumber)) {
        const name = messageContent.trim();
        
        // Clear timeout since we got a response
        if (this.nameTimeouts.has(senderNumber)) {
          clearTimeout(this.nameTimeouts.get(senderNumber));
          this.nameTimeouts.delete(senderNumber);
        }
        
        // Process the name response
        await this.processNameResponse(message, senderNumber, name);
        return;
      }
      
      // Send the welcome message
      try {
        await this.sendMessage(remoteJid, this.welcomeMessage);
        
        // Mark that we're now processing a name for this user
        this.namesBeingProcessed.set(senderNumber, true);
        
        // Set a timeout to clear the name processing state after 5 minutes
        const timeout = setTimeout(() => {
          this.namesBeingProcessed.delete(senderNumber);
          this.nameTimeouts.delete(senderNumber);
        }, 5 * 60 * 1000);
        
        this.nameTimeouts.set(senderNumber, timeout);
      } catch (error) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Error sending welcome message:`, error);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling new user:`, error);
    }
  }
  
  /**
   * Process a name response from a new user
   * @param {Object} message - WhatsApp message
   * @param {string} senderNumber - Sender's phone number
   * @param {string} name - User's name
   */
  async processNameResponse(message, senderNumber, name) {
    try {
      const remoteJid = message.key.remoteJid;
      
      // Clean up processing state
      this.namesBeingProcessed.delete(senderNumber);
      
      // Create user card
      const userCard = this.userCardManager.createUserCard(senderNumber, name);
      
      // Send intro message
      const introMessage = this.introMessage.replace(/{name}/g, name);
      await this.sendMessage(remoteJid, introMessage);
      
      // Create ticket
      const discordChannelId = await this.ticketManager.createTicket(userCard);
      
      // Link to channel manager
      if (discordChannelId) {
        this.channelManager.setChannelMapping(senderNumber, discordChannelId);
      }
      
      // Forward initial message to ticket if not just the name
      if (name.toLowerCase() !== message.body.toLowerCase() && discordChannelId) {
        await this.ticketManager.forwardUserMessage(
          discordChannelId,
          userCard,
          message.body,
          []
        );
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error processing name response:`, error);
    }
  }
  
  /**
   * Handle message from an existing user
   * @param {Object} message - WhatsApp message
   * @param {Object} userCard - User's card
   * @param {string} messageContent - Message content
   */
  async handleExistingUser(message, userCard, messageContent) {
    try {
      // Get the Discord channel for this user
      const discordChannelId = this.channelManager.getChannelId(userCard.phoneNumber);
      
      if (!discordChannelId) {
        // No channel exists, create a new ticket
        const newChannelId = await this.ticketManager.createTicket(userCard);
        
        if (newChannelId) {
          // Set the new mapping
          this.channelManager.setChannelMapping(userCard.phoneNumber, newChannelId);
          
          // Send reopen message
          const reopenMessage = this.reopenTicketMessage.replace(/{name}/g, userCard.name);
          await this.sendMessage(message.key.remoteJid, reopenMessage);
          
          // Forward the message that triggered the ticket
          await this.ticketManager.forwardUserMessage(
            newChannelId,
            userCard,
            messageContent,
            await this.processMediaMessage(message)
          );
        }
      } else {
        // Forward the message to the existing channel
        await this.ticketManager.forwardUserMessage(
          discordChannelId,
          userCard,
          messageContent,
          await this.processMediaMessage(message)
        );
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling existing user:`, error);
    }
  }
  
  /**
   * Handle a vouch message
   * @param {Object} message - WhatsApp message
   * @param {string} senderNumber - Sender's phone number
   * @param {Object} userCard - User's card
   */
  async handleVouch(message, senderNumber, userCard) {
    try {
      if (!this.vouchHandler) return;
      
      // We need a user card to handle vouches
      if (!userCard) {
        await this.sendMessage(
          message.key.remoteJid,
          "Sorry, we need to know who you are before you can leave a vouch. What's your name?"
        );
        
        // Start the name collection process
        this.namesBeingProcessed.set(senderNumber, true);
        return;
      }
      
      // Extract media attachments if any
      const mediaAttachments = await this.processMediaMessage(message);
      
      // Forward to vouch handler
      await this.vouchHandler.handleVouchMessage(message, userCard, mediaAttachments);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling vouch:`, error);
    }
  }
  
  /**
   * Extract phone number from JID
   * @param {string} jid - WhatsApp JID
   * @returns {string} - Phone number
   */
  extractPhoneNumber(jid) {
    if (!jid) return '';
    
    // Remove WhatsApp suffixes
    return jid.replace('@s.whatsapp.net', '')
      .replace('@c.us', '')
      .replace('@g.us', '')
      .replace(':15', ''); // Some numbers have this suffix
  }
  
  /**
   * Extract message content
   * @param {Object} message - WhatsApp message
   * @returns {string} - Message content
   */
  extractMessageContent(message) {
    if (!message) return '';
    
    // First try standard message types
    if (message.message) {
      // Text message
      if (message.message.conversation) {
        return message.message.conversation;
      }
      
      // Extended text message
      if (message.message.extendedTextMessage && message.message.extendedTextMessage.text) {
        return message.message.extendedTextMessage.text;
      }
      
      // Image with caption
      if (message.message.imageMessage && message.message.imageMessage.caption) {
        return message.message.imageMessage.caption;
      }
      
      // Video with caption
      if (message.message.videoMessage && message.message.videoMessage.caption) {
        return message.message.videoMessage.caption;
      }
      
      // Document with caption
      if (message.message.documentMessage && message.message.documentMessage.caption) {
        return message.message.documentMessage.caption;
      }
    }
    
    // Check for other message types or return empty string
    return '';
  }
  
  /**
   * Process media in a message
   * @param {Object} message - WhatsApp message
   * @returns {Promise<Array>} - Array of media file paths
   */
  async processMediaMessage(message) {
    try {
      if (!message || !message.message) return [];
      
      const mediaFiles = [];
      const msg = message.message;
      
      // Check for image
      if (msg.imageMessage) {
        const imagePath = await this.downloadMedia(
          message,
          'image',
          msg.imageMessage.mimetype
        );
        if (imagePath) mediaFiles.push(imagePath);
      }
      
      // Check for video
      if (msg.videoMessage) {
        const videoPath = await this.downloadMedia(
          message,
          'video',
          msg.videoMessage.mimetype
        );
        if (videoPath) mediaFiles.push(videoPath);
      }
      
      // Check for document
      if (msg.documentMessage) {
        const docPath = await this.downloadMedia(
          message,
          'document',
          msg.documentMessage.mimetype
        );
        if (docPath) mediaFiles.push(docPath);
      }
      
      // Check for audio
      if (msg.audioMessage) {
        const audioPath = await this.downloadMedia(
          message,
          'audio',
          msg.audioMessage.mimetype
        );
        if (audioPath) mediaFiles.push(audioPath);
      }
      
      // Check for sticker
      if (msg.stickerMessage) {
        const stickerPath = await this.downloadMedia(
          message,
          'sticker',
          msg.stickerMessage.mimetype
        );
        if (stickerPath) mediaFiles.push(stickerPath);
      }
      
      return mediaFiles;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error processing media:`, error);
      return [];
    }
  }
  
  /**
   * Download media from a message
   * @param {Object} message - WhatsApp message
   * @param {string} type - Media type
   * @param {string} mimetype - MIME type
   * @returns {Promise<string|null>} - Path to downloaded file or null
   */
  async downloadMedia(message, type, mimetype) {
    try {
      if (!this.whatsAppClient || !message) return null;
      
      // Get extension from mimetype
      const ext = this.getExtensionFromMimetype(mimetype);
      
      // Create a unique filename
      const timestamp = Date.now();
      const filename = `${type}_${timestamp}.${ext}`;
      const filePath = path.join(this.tempDir, filename);
      
      // Download the media
      await this.whatsAppClient.downloadMedia(message, filePath);
      
      return filePath;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error downloading media:`, error);
      return null;
    }
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
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/webm': 'webm',
      'application/pdf': 'pdf',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'text/plain': 'txt'
    };
    
    return mimeMap[mimetype] || 'bin';
  }
  
  /**
   * Send a message to a WhatsApp user
   * @param {string} jid - WhatsApp JID
   * @param {string} content - Message content
   * @returns {Promise<Object>} - Send result
   */
  async sendMessage(jid, content) {
    try {
      if (!this.whatsAppClient) {
        throw new Error('WhatsApp client not available');
      }
      
      // Use the correct function for the Baileys client
      // The function should be sendMessage (not sendTextMessage)
      return await this.whatsAppClient.sendMessage(jid, { text: content });
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending WhatsApp message:`, error);
      throw error;
    }
  }
  
  /**
   * Send a media message to a WhatsApp user
   * @param {string} jid - WhatsApp JID
   * @param {string} filePath - Path to media file
   * @param {string} caption - Message caption
   * @returns {Promise<Object>} - Send result
   */
  async sendMediaMessage(jid, filePath, caption = '') {
    try {
      if (!this.whatsAppClient) {
        throw new Error('WhatsApp client not available');
      }
      
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      // Get file mime type from extension
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const mimeType = this.getMimetypeFromExtension(ext);
      
      // Read file as buffer
      const media = fs.readFileSync(filePath);
      
      // Determine message type based on mime
      if (mimeType.startsWith('image/')) {
        return await this.whatsAppClient.sendMessage(jid, {
          image: media,
          caption: caption
        });
      } else if (mimeType.startsWith('video/')) {
        return await this.whatsAppClient.sendMessage(jid, {
          video: media,
          caption: caption
        });
      } else if (mimeType.startsWith('audio/')) {
        return await this.whatsAppClient.sendMessage(jid, {
          audio: media,
          mimetype: mimeType
        });
      } else {
        // Send as document for other types
        return await this.whatsAppClient.sendMessage(jid, {
          document: media,
          mimetype: mimeType,
          fileName: path.basename(filePath),
          caption: caption
        });
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending media message:`, error);
      throw error;
    }
  }
  
  /**
   * Get MIME type from file extension
   * @param {string} ext - File extension
   * @returns {string} - MIME type
   */
  getMimetypeFromExtension(ext) {
    if (!ext) return 'application/octet-stream';
    
    const extMap = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mp3': 'audio/mpeg',
      'ogg': 'audio/ogg',
      'wav': 'audio/wav',
      'pdf': 'application/pdf',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain'
    };
    
    return extMap[ext.toLowerCase()] || 'application/octet-stream';
  }
}

module.exports = WhatsAppHandler;
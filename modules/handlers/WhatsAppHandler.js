// modules/handlers/WhatsAppHandler.js - Comprehensive enhancement with robust message handling
const fs = require('fs');
const path = require('path');
const util = require('util');

/**
 * Handles incoming WhatsApp messages and routes them to Discord
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
  constructor(
    whatsAppClient,
    userCardManager,
    channelManager,
    ticketManager,
    transcriptManager,
    vouchHandler = null,
    options = {}
  ) {
    this.whatsAppClient = whatsAppClient;
    this.userCardManager = userCardManager;
    this.channelManager = channelManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.vouchHandler = vouchHandler;

    // Set options with defaults
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '../../temp');
    this.logLevel = options.logLevel || 'normal'; // 'minimal', 'normal', 'verbose'
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Default messages
    this.welcomeMessage = "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage = "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage = "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";

    // Process queue
    this.processingQueue = new Map();
    this.messageQueue = [];
    this.isProcessing = false;

    // Media extensions mapping
    this.mimeToExt = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'application/pdf': 'pdf',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/zip': 'zip'
    };

    this.log('info', `Initialized`);
  }

  /**
   * Log message with appropriate level
   * @param {string} level - Log level (debug, info, warn, error)
   * @param {string} message - Message to log
   */
  log(level, message) {
    const prefix = `[WhatsAppHandler:${this.instanceId}]`;
    
    // Honor logging level
    if (this.logLevel === 'minimal' && level !== 'error' && level !== 'warn') {
      return;
    }
    
    // Don't log debug messages unless verbose
    if (level === 'debug' && this.logLevel !== 'verbose') {
      return;
    }
    
    // Use appropriate console method
    switch (level) {
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      case 'debug':
        console.debug(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }

  /**
   * Handle an incoming WhatsApp message
   * @param {Object} message - WhatsApp message object
   */
  async handleMessage(message) {
    try {
      // Add to queue for processing
      this.messageQueue.push(message);
      
      // Start processing if not already
      if (!this.isProcessing) {
        await this.processMessageQueue();
      }
    } catch (error) {
      this.log('error', `Error queuing message: ${error.message}`);
    }
  }

  /**
   * Process message queue to prevent race conditions
   */
  async processMessageQueue() {
    if (this.isProcessing || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        await this.processMessage(message);
      }
    } catch (error) {
      this.log('error', `Error processing message queue: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single WhatsApp message
   * @param {Object} message - WhatsApp message object
   */
  async processMessage(message) {
    try {
      // CRITICAL FIX: Properly extract message details with null checks
      // Get the phone number (jid) of the sender
      const jid = message?.key?.remoteJid;
      if (!jid) {
        this.log('error', `Message has no remoteJid`);
        return;
      }

      // Skip messages from groups or status broadcasts
      if (jid.includes('@g.us') || jid.includes('status@broadcast')) {
        return;
      }

      // Extract message content - Baileys wraps it in different objects based on type
      const messageContent = message?.message;
      
      // Debug verbose logging only when needed (log to file)
      if (this.logLevel === 'verbose') {
        this.log('debug', `Raw message: ${JSON.stringify(message, null, 2).substring(0, 500)}...`);
      }
      
      // Skip processing if message is empty (typing notifications, etc.)
      if (!messageContent) {
        return;
      }

      // Get the message text content with fallbacks for different message types
      const messageData = this.extractMessageData(message);
      const { messageText, hasMedia, mediaType, mediaInfo } = messageData;

      // Get sender information
      const senderName = this.whatsAppClient.getContactName(jid);
      const phoneNumber = jid.split('@')[0];
      
      // Log message in a standardized format
      if (messageText && messageText.length > 0) {
        // Truncate long messages in logs
        const truncatedText = messageText.length > 50 
          ? `${messageText.substring(0, 50)}...` 
          : messageText;
        
        this.log('info', `Message from ${phoneNumber}: ${truncatedText}`);
      } else if (hasMedia) {
        this.log('info', `Media message (${mediaType}) from ${phoneNumber}`);
      }

      // Step 1: Check if the user has a channel
      const channelId = this.channelManager.getChannelId(phoneNumber);
      
      // Download media if present
      let fileBuffer = null;
      if (hasMedia) {
        try {
          fileBuffer = await this.whatsAppClient.downloadMedia(message);
          
          if (!fileBuffer) {
            this.log('warn', `Could not download media from ${phoneNumber}`);
          } else {
            this.log('debug', `Downloaded ${mediaType} media, size: ${fileBuffer.length} bytes`);
          }
        } catch (mediaError) {
          this.log('error', `Error downloading media: ${mediaError.message}`);
        }
      }

      // Step 2: Process based on channel existence
      if (channelId) {
        // User already has a channel, forward the message
        await this.processExistingUser(phoneNumber, senderName, messageText, channelId, {
          hasMedia,
          mediaType,
          fileBuffer,
          ...mediaInfo
        });
      } else {
        // New user flow
        await this.processNewUser(phoneNumber, senderName, messageText);
      }
    } catch (error) {
      this.log('error', `Error processing message: ${error.message}`);
    }
  }

  /**
   * Extract message data from different message types
   * @param {Object} message - WhatsApp message
   * @returns {Object} - Extracted message data
   */
  extractMessageData(message) {
    try {
      const messageContent = message.message;
      
      // Default values
      let messageText = '';
      let hasMedia = false;
      let mediaType = '';
      let mediaInfo = {};
      
      // Handle different message types
      if (messageContent.conversation) {
        // Simple text message
        messageText = messageContent.conversation;
      } 
      else if (messageContent.extendedTextMessage) {
        // Extended text (often with formatting or links)
        messageText = messageContent.extendedTextMessage.text || '';
        
        // Check for contextInfo which may have quoted messages
        if (messageContent.extendedTextMessage.contextInfo?.quotedMessage) {
          mediaInfo.quotedMessage = messageContent.extendedTextMessage.contextInfo.quotedMessage;
        }
      } 
      else if (messageContent.imageMessage) {
        // Image with optional caption
        hasMedia = true;
        mediaType = 'image';
        messageText = messageContent.imageMessage.caption || '';
        mediaInfo = {
          caption: messageText,
          mimetype: messageContent.imageMessage.mimetype || 'image/jpeg',
          fileName: `image-${Date.now()}.${this.getExtensionFromMime(messageContent.imageMessage.mimetype)}`
        };
      } 
      else if (messageContent.videoMessage) {
        // Video with optional caption
        hasMedia = true;
        mediaType = 'video';
        messageText = messageContent.videoMessage.caption || '';
        mediaInfo = {
          caption: messageText,
          mimetype: messageContent.videoMessage.mimetype || 'video/mp4',
          fileName: `video-${Date.now()}.mp4`
        };
      } 
      else if (messageContent.audioMessage) {
        // Audio message or voice note
        hasMedia = true;
        mediaType = 'audio';
        const isVoiceNote = messageContent.audioMessage.ptt || false;
        messageText = isVoiceNote ? '[Voice Note]' : '[Audio]';
        mediaInfo = {
          isVoiceNote,
          mimetype: messageContent.audioMessage.mimetype || 'audio/mp4',
          fileName: `audio-${Date.now()}.${isVoiceNote ? 'ogg' : 'mp3'}`
        };
      } 
      else if (messageContent.documentMessage) {
        // Document/file
        hasMedia = true;
        mediaType = 'document';
        const fileName = messageContent.documentMessage.fileName || `document-${Date.now()}`;
        messageText = `[Document: ${fileName}]`;
        mediaInfo = {
          fileName,
          mimetype: messageContent.documentMessage.mimetype || 'application/octet-stream'
        };
      } 
      else if (messageContent.stickerMessage) {
        // Sticker
        hasMedia = true;
        mediaType = 'sticker';
        messageText = '[Sticker]';
        mediaInfo = {
          mimetype: messageContent.stickerMessage.mimetype || 'image/webp',
          fileName: `sticker-${Date.now()}.webp`
        };
      } 
      else if (messageContent.contactMessage) {
        // Contact card
        messageText = `[Contact: ${messageContent.contactMessage.displayName || 'Unknown'}]`;
        mediaInfo = {
          contactName: messageContent.contactMessage.displayName || 'Unknown',
          contactVCard: messageContent.contactMessage.vcard || ''
        };
      } 
      else if (messageContent.locationMessage) {
        // Location
        const lat = messageContent.locationMessage.degreesLatitude;
        const lng = messageContent.locationMessage.degreesLongitude;
        messageText = `[Location: ${lat},${lng}]`;
        mediaInfo = {
          latitude: lat,
          longitude: lng,
          locationName: messageContent.locationMessage.name || ''
        };
      } 
      else if (messageContent.buttonsResponseMessage) {
        // Button response
        messageText = messageContent.buttonsResponseMessage.selectedDisplayText || 
                     `[Button: ${messageContent.buttonsResponseMessage.selectedButtonId || 'Unknown'}]`;
      } 
      else if (messageContent.listResponseMessage) {
        // List response
        messageText = messageContent.listResponseMessage.title || 
                     messageContent.listResponseMessage.selectedDisplayText || 
                     `[List Selection: ${messageContent.listResponseMessage.singleSelectReply?.selectedRowId || 'Unknown'}]`;
      } 
      else if (messageContent.reactionMessage) {
        // Reaction to a message - we can ignore these
        messageText = '';
      } 
      else {
        // Check several possible container types
        const textContainers = [
          messageContent.buttonsMessage?.contentText,
          messageContent.listMessage?.description,
          messageContent.templateMessage?.hydratedTemplate?.hydratedContentText
        ];
        
        for (const container of textContainers) {
          if (container) {
            messageText = container;
            break;
          }
        }
        
        // If we still don't have a message, log the content types for debugging
        if (!messageText) {
          const contentTypes = Object.keys(messageContent);
          this.log('debug', `Unknown message type with keys: ${contentTypes.join(', ')}`);
          messageText = '[Unknown Message Type]';
        }
      }
      
      return {
        messageText,
        hasMedia,
        mediaType,
        mediaInfo
      };
    } catch (error) {
      this.log('error', `Error extracting message data: ${error.message}`);
      return {
        messageText: '[Error Processing Message]',
        hasMedia: false,
        mediaType: '',
        mediaInfo: {}
      };
    }
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimetype - MIME type
   * @returns {string} - File extension
   */
  getExtensionFromMime(mimetype) {
    return this.mimeToExt[mimetype] || 'bin';
  }

  /**
   * Process message from an existing user
   * @param {string} phoneNumber - User's phone number
   * @param {string} senderName - Sender's name
   * @param {string} messageText - Message text
   * @param {string} channelId - Discord channel ID
   * @param {Object} mediaInfo - Media information
   */
  async processExistingUser(phoneNumber, senderName, messageText, channelId, mediaInfo) {
    try {
      // Get user card to check status
      const userCard = this.userCardManager.getUserCard(phoneNumber);
      
      if (!userCard) {
        this.log('info', `No user card found for ${phoneNumber} despite having channel ${channelId}`);
        
        // Create user card
        const newUserCard = {
          phoneNumber,
          name: senderName || phoneNumber,
          status: 'active',
          channelId,
          created: Date.now(),
          lastActivity: Date.now()
        };
        
        this.userCardManager.setUserCard(phoneNumber, newUserCard);
        this.log('info', `Created new user card for ${phoneNumber}`);
      } else {
        // Update last activity
        userCard.lastActivity = Date.now();
        this.userCardManager.updateUserCard(phoneNumber, userCard);
      }
      
      // Check if channel exists
      this.ticketManager.checkChannelExists(channelId, async (exists) => {
        if (!exists) {
          this.log('info', `Channel ${channelId} for ${phoneNumber} no longer exists`);
          
          // Clear channel mapping
          this.channelManager.removeChannel(phoneNumber);
          
          // Create new ticket
          await this.createNewTicket(phoneNumber, senderName, messageText, mediaInfo);
          return;
        }
        
        // Process message normally
        this.continueProcessingMessage(phoneNumber, senderName, messageText, channelId, mediaInfo);
      });
    } catch (error) {
      this.log('error', `Error processing existing user: ${error.message}`);
    }
  }

  /**
   * Continue processing message after channel check
   * @param {string} phoneNumber - User's phone number
   * @param {string} senderName - Sender's name
   * @param {string} messageText - Message text
   * @param {string} channelId - Discord channel ID
   * @param {Object} mediaInfo - Media information
   */
  async continueProcessingMessage(phoneNumber, senderName, messageText, channelId, mediaInfo) {
    try {
      // Process vouch command
      if (this.vouchHandler && !this.vouchHandler.isDisabled && 
          messageText && messageText.toLowerCase().startsWith('vouch!')) {
        await this.vouchHandler.processVouch(phoneNumber, senderName, messageText, mediaInfo);
        return;
      }
      
      // Special channel detection
      const specialChannelMentions = this.channelManager.checkForSpecialChannelMentions(messageText);
      
      // Handle special channel mentions
      if (specialChannelMentions.length > 0) {
        this.log('info', `Detected ${specialChannelMentions.length} special channel mentions`);
        
        // Send special channel messages
        for (const mention of specialChannelMentions) {
          try {
            await this.whatsAppClient.sendMessage(
              phoneNumber, 
              mention.message || 'Here is the channel you asked about.'
            );
          } catch (mentionError) {
            this.log('error', `Error sending special channel mention: ${mentionError.message}`);
          }
        }
      }
      
      // Forward message to Discord
      await this.ticketManager.sendMessageToChannel(channelId, phoneNumber, senderName, messageText, mediaInfo);
    } catch (error) {
      this.log('error', `Error forwarding message: ${error.message}`);
    }
  }

  /**
   * Process message from a new user
   * @param {string} phoneNumber - User's phone number
   * @param {string} senderName - Sender's name
   * @param {string} messageText - Message text
   */
  async processNewUser(phoneNumber, senderName, messageText) {
    try {
      // Get or create user card
      let userCard = this.userCardManager.getUserCard(phoneNumber);
      
      // If user doesn't have a card, send welcome message
      if (!userCard) {
        // Send welcome message
        await this.whatsAppClient.sendMessage(phoneNumber, this.welcomeMessage);
        
        // Create user card
        userCard = {
          phoneNumber,
          name: '',
          status: 'new',
          created: Date.now(),
          lastActivity: Date.now()
        };
        
        this.userCardManager.setUserCard(phoneNumber, userCard);
        this.log('info', `Sent welcome message to new user ${phoneNumber}`);
        return;
      }
      
      // If user is in 'new' status, treat their message as their name
      if (userCard.status === 'new') {
        // Save their name
        userCard.name = messageText.trim();
        userCard.status = 'active';
        this.userCardManager.updateUserCard(phoneNumber, userCard);
        
        // Send intro message with name
        const customIntro = this.introMessage.replace(/{name}/g, userCard.name);
        await this.whatsAppClient.sendMessage(phoneNumber, customIntro);
        
        // Create ticket
        await this.createNewTicket(phoneNumber, userCard.name, '', null, true);
        
        this.log('info', `Created ticket for ${userCard.name} (${phoneNumber})`);
        return;
      }
      
      // If we reach here, the user was in active status but had no channel
      // Create a new ticket for them
      await this.createNewTicket(phoneNumber, userCard.name || senderName, messageText);
    } catch (error) {
      this.log('error', `Error processing new user: ${error.message}`);
    }
  }

  /**
   * Create a new ticket for a user
   * @param {string} phoneNumber - User's phone number
   * @param {string} userName - User's name
   * @param {string} message - Initial message
   * @param {Object} mediaInfo - Media information (optional)
   * @param {boolean} isNewUser - Whether this is a new user
   */
  async createNewTicket(phoneNumber, userName, message, mediaInfo = null, isNewUser = false) {
    try {
      // Create ticket
      const channel = await this.ticketManager.createTicket(phoneNumber, userName);
      
      if (!channel) {
        this.log('error', `Failed to create ticket for ${phoneNumber}`);
        return;
      }
      
      // Save channel ID
      this.channelManager.setChannel(phoneNumber, channel.id);
      
      // Update user card
      const userCard = this.userCardManager.getUserCard(phoneNumber) || {
        phoneNumber,
        name: userName,
        status: 'active',
        created: Date.now(),
        lastActivity: Date.now()
      };
      
      userCard.channelId = channel.id;
      userCard.status = 'active';
      userCard.lastActivity = Date.now();
      this.userCardManager.updateUserCard(phoneNumber, userCard);
      
      // Save the channel to the mediaManager for transcripts
      if (this.transcriptManager && !this.transcriptManager.isDisabled) {
        this.transcriptManager.setPhoneToUsername(phoneNumber, userName);
      }
      
      // If this is a reopened ticket, send reopening message
      if (!isNewUser) {
        const reopenMessage = this.reopenTicketMessage.replace(/{name}/g, userName);
        await this.whatsAppClient.sendMessage(phoneNumber, reopenMessage);
      }
      
      // If initial message exists, forward it
      if (message && message.trim() !== '') {
        await this.ticketManager.sendMessageToChannel(channel.id, phoneNumber, userName, message, mediaInfo);
      }
      
      this.log('info', `Created ${isNewUser ? 'new' : 'reopened'} ticket for ${userName} (${phoneNumber})`);
      return channel;
    } catch (error) {
      this.log('error', `Error creating ticket: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Set logging level
   * @param {string} level - Log level (minimal, normal, verbose)
   */
  setLogLevel(level) {
    if (['minimal', 'normal', 'verbose'].includes(level)) {
      this.logLevel = level;
      this.log('info', `Log level set to: ${level}`);
    } else {
      this.log('warn', `Invalid log level: ${level}. Using 'normal'.`);
      this.logLevel = 'normal';
    }
  }
}

module.exports = WhatsAppHandler;
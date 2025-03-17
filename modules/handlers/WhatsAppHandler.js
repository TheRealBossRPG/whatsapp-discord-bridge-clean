// modules/handlers/WhatsAppHandler.js - FIXED VERSION

const fs = require('fs');
const path = require('path');
const os = require('os');
const { MessageMedia } = require('whatsapp-web.js');
const MediaManager = require('../../utils/MediaManager');

/**
 * WhatsApp message handler with improved message format compatibility
 * CRITICAL FIX: Proper message format handling for Baileys
 */
class WhatsAppHandler {
  constructor(whatsAppClient, userCardManager, channelManager, ticketManager, transcriptManager, vouchHandler, options = {}) {
    this.whatsAppClient = whatsAppClient;
    this.userCardManager = userCardManager;
    this.channelManager = channelManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.vouchHandler = vouchHandler;
    
    // Set instance ID for isolation
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || os.tmpdir();
    
    // Make sure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Create media manager
    this.mediaManager = new MediaManager({ 
      instanceId: this.instanceId
    });
    
    // Clean temp directory on startup
    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Cleaning temp directory on startup...`);
    this.cleanTempDir();
    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Cleaned up ${this.deletedTempFiles || 0} temp entries on startup`);
    
    // Flag to track if permanent media saving is enabled
    this.permanentMediaEnabled = options.permanentMediaEnabled || false;
    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Permanent media saving is ${this.permanentMediaEnabled ? 'enabled' : 'disabled'}`);
    
    // Validate all required managers are present
    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Validated managers:
      - userCardManager: ${this.userCardManager ? 'Available' : 'Missing'} 
      - channelManager: ${this.channelManager ? 'Available' : 'Missing'}
      - ticketManager: ${this.ticketManager ? 'Available' : 'Missing'}
      - mediaManager: ${this.mediaManager ? 'Available' : 'Missing'}`);
    
    // Set up message event listeners
    if (this.whatsAppClient) {
      this.whatsAppClient.on('message', this.handleMessage.bind(this));
      console.log(`[BaileysWhatsAppHandler:${this.instanceId}] WhatsApp message event listeners configured`);
    }
    
    // Default messages
    this.welcomeMessage = "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage = "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage = "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
    
    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Initialized with all managers`);
  }
  
  /**
   * Clean temp directory
   * @returns {number} - Number of files deleted
   */
  cleanTempDir() {
    try {
      let deleted = 0;
      
      // Get all files in temp directory
      const files = fs.readdirSync(this.tempDir);
      
      // Delete each file
      for (const file of files) {
        // Only delete files with our prefix
        if (file.startsWith(`whatsapp-temp-${this.instanceId}`)) {
          const filePath = path.join(this.tempDir, file);
          fs.unlinkSync(filePath);
          deleted++;
        }
      }
      
      this.deletedTempFiles = deleted;
      return deleted;
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error cleaning temp directory:`, error);
      this.deletedTempFiles = 0;
      return 0;
    }
  }
  
  /**
   * CRITICAL FIX: Handle WhatsApp message with proper format detection
   * @param {Object} rawMessage - Message from WhatsApp
   */
  async handleMessage(rawMessage) {
    try {
      console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Message received: ${rawMessage?.key?.remoteJid}`);
      
      // CRITICAL FIX: Extract sender from correct location in Baileys message format
      let from;
      
      // Try multiple possible locations for the sender ID
      if (rawMessage?.key?.remoteJid) {
        from = rawMessage.key.remoteJid;
      } else if (rawMessage?.from) {
        from = rawMessage.from;
      } else if (rawMessage?.participant) {
        from = rawMessage.participant;
      } else if (typeof rawMessage === 'string' && rawMessage.includes('@')) {
        // Last resort: try to extract from string if it looks like a JID
        from = rawMessage;
      }
      
      if (!from) {
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Invalid message received: missing 'from' property`);
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Message structure: ${JSON.stringify(rawMessage, null, 2)}`);
        return;
      }
      
      // Extract the message content (text)
      let messageText = '';
      
      // CRITICAL FIX: Handle different message formats for content extraction
      if (rawMessage.message?.conversation) {
        messageText = rawMessage.message.conversation;
      } else if (rawMessage.message?.extendedTextMessage?.text) {
        messageText = rawMessage.message.extendedTextMessage.text;
      } else if (rawMessage.body) {
        messageText = rawMessage.body;
      } else if (typeof rawMessage.text === 'function') {
        messageText = rawMessage.text();
      } else if (rawMessage.message) {
        // Attempt to extract text from various message types as fallback
        const msgTypes = [
          'conversation', 
          'imageMessage.caption', 
          'videoMessage.caption',
          'documentMessage.caption'
        ];
        
        for (const type of msgTypes) {
          const props = type.split('.');
          let value = rawMessage.message;
          
          for (const prop of props) {
            value = value?.[prop];
            if (!value) break;
          }
          
          if (value) {
            messageText = value;
            break;
          }
        }
      }
      
      // Check for media content
      let hasMedia = false;
      let mediaType = null;
      let mediaData = null;
      
      // CRITICAL FIX: Handle different media formats
      if (
        rawMessage.message?.imageMessage || 
        rawMessage.message?.videoMessage || 
        rawMessage.message?.documentMessage || 
        rawMessage.message?.audioMessage ||
        rawMessage.hasMedia
      ) {
        hasMedia = true;
        
        // Determine media type
        if (rawMessage.message?.imageMessage) {
          mediaType = 'image';
        } else if (rawMessage.message?.videoMessage) {
          mediaType = 'video';
        } else if (rawMessage.message?.documentMessage) {
          mediaType = 'document';
        } else if (rawMessage.message?.audioMessage) {
          mediaType = 'audio';
        } else if (rawMessage.hasMedia) {
          // Use WhatsApp Web.js media handling if available
          try {
            const media = await rawMessage.downloadMedia();
            if (media) {
              mediaType = media.mimetype.split('/')[0];
              mediaData = media;
            }
          } catch (mediaError) {
            console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error downloading media:`, mediaError);
          }
        }
      }
      
      // Clean phone number for consistent lookup
      const phoneNumber = this.mediaManager.cleanPhoneNumber(from);
      
      // Format message for processing
      const message = {
        from,
        phoneNumber,
        body: messageText,
        hasMedia,
        mediaType,
        mediaData,
        timestamp: new Date(),
        raw: rawMessage
      };
      
      // Process the message
      await this.processMessage(message);
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error handling message:`, error);
    }
  }
  
  /**
   * Process the message
   * @param {Object} message - Formatted message
   */
  async processMessage(message) {
    try {
      // Check if message is from a group
      if (message.from.endsWith('@g.us')) {
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Skipping group message: ${message.from}`);
        return;
      }
      
      // Get user card if exists
      let userCard = this.userCardManager.getUserCardByPhone(message.phoneNumber);
      
      // Check if message is a vouch
      const isVouchRequest = message.body?.toLowerCase().startsWith('vouch') || message.body?.toLowerCase().includes('!vouch');
      
      // Handle vouch request
      if (
        isVouchRequest && 
        this.vouchHandler && 
        userCard && 
        !this.vouchHandler.isDisabled
      ) {
        await this.vouchHandler.handleVouchMessage(message, userCard);
        return;
      }
      
      // Check if a conversation already exists for this user
      const existingChannel = this.channelManager.getChannelByPhone(message.phoneNumber);
      
      if (existingChannel) {
        // Existing conversation
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Found existing channel for ${message.phoneNumber}: ${existingChannel.id}`);
        
        // Get user card - it should exist
        if (!userCard) {
          // If somehow we have a channel but no user card, create one
          userCard = this.userCardManager.createUserCard(message.phoneNumber, `Unknown (${message.phoneNumber})`);
          console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Created user card for existing channel: ${userCard.name}`);
        }
        
        // Forward message to Discord
        await this.forwardMessageToDiscord(message, existingChannel.id, userCard);
        
        return;
      }
      
      // New conversation or username collection
      if (!userCard) {
        // First contact - send welcome message
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] New user ${message.phoneNumber} - sending welcome message`);
        await this.sendWelcomeMessage(message.from);
        
        // Create user card with phone number as temporary name
        userCard = this.userCardManager.createUserCard(
          message.phoneNumber,
          `Unknown (${message.phoneNumber})`
        );
        
        // Store the first message as potential name
        userCard.pendingName = message.body.trim();
        this.userCardManager.saveUserCard(userCard);
        
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Created temporary user card: ${userCard.name}`);
      } else if (userCard.name.startsWith('Unknown') && userCard.pendingName) {
        // Need to confirm name and create channel
        const name = userCard.pendingName;
        userCard.name = name;
        userCard.pendingName = null;
        this.userCardManager.saveUserCard(userCard);
        
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Updated user name to: ${name}`);
        
        // Set phone-to-username mapping
        this.mediaManager.setPhoneToUsername(message.phoneNumber, name);
        
        // Send intro message
        const introMessage = this.introMessage.replace('{name}', name);
        await this.sendTextMessage(message.from, introMessage);
        
        // Create Discord ticket
        const channelId = await this.ticketManager.createTicket(
          userCard, 
          message.phoneNumber
        );
        
        // Store channel mapping
        if (channelId) {
          this.channelManager.setChannelForPhone(message.phoneNumber, channelId);
          console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Created new ticket channel ${channelId} for ${name} (${message.phoneNumber})`);
          
          // Forward original message to new channel
          await this.forwardMessageToDiscord(message, channelId, userCard);
        } else {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Failed to create ticket for ${name}`);
          await this.sendTextMessage(message.from, "I'm sorry, there was an error creating your support ticket. Please try again later.");
        }
      } else if (userCard.name.startsWith('Unknown')) {
        // We have a user card but no name set and no pending name
        // This might be after a restart - treat next message as name
        userCard.pendingName = message.body.trim();
        this.userCardManager.saveUserCard(userCard);
        
        // Send welcome message again
        await this.sendWelcomeMessage(message.from);
        
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Set pending name for existing user card: ${message.body.trim()}`);
      } else {
        // User exists but no active channel - reopen ticket
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Reopening ticket for ${userCard.name} (${message.phoneNumber})`);
        
        // Send reopen message
        const reopenMessage = this.reopenTicketMessage.replace('{name}', userCard.name);
        await this.sendTextMessage(message.from, reopenMessage);
        
        // Create or reopen Discord ticket
        const channelId = await this.ticketManager.createTicket(
          userCard, 
          message.phoneNumber, 
          true // isReopen
        );
        
        // Store channel mapping
        if (channelId) {
          this.channelManager.setChannelForPhone(message.phoneNumber, channelId);
          console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Reopened ticket channel ${channelId} for ${userCard.name}`);
          
          // Forward message to reopened channel
          await this.forwardMessageToDiscord(message, channelId, userCard);
        } else {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Failed to reopen ticket for ${userCard.name}`);
          await this.sendTextMessage(message.from, "I'm sorry, there was an error reopening your support ticket. Please try again later.");
        }
      }
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error processing message:`, error);
    }
  }
  
  /**
   * Forward WhatsApp message to Discord
   * @param {Object} message - Message object
   * @param {string} channelId - Discord channel ID
   * @param {Object} userCard - User card
   * @returns {Promise<void>}
   */
  async forwardMessageToDiscord(message, channelId, userCard) {
    try {
      // Get Discord channel
      const channel = await this.ticketManager.getDiscordChannel(channelId);
      
      if (!channel) {
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Channel not found: ${channelId}`);
        return;
      }
      
      // Handle media messages
      if (message.hasMedia) {
        await this.handleMediaMessage(message, channel, userCard);
        return;
      }
      
      // Handle text message
      if (message.body && message.body.trim() !== '') {
        // Format username for display
        const displayName = userCard.name || `Unknown (${message.phoneNumber})`;
        
        // Send message to Discord
        await channel.send(`**${displayName}:** ${message.body}`);
        
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Forwarded text message to channel ${channelId}`);
      }
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error forwarding message to Discord:`, error);
    }
  }
  
  /**
   * Handle media message (image, video, document, etc.)
   * @param {Object} message - Message object with media
   * @param {Object} channel - Discord channel
   * @param {Object} userCard - User card
   * @returns {Promise<void>}
   */
  async handleMediaMessage(message, channel, userCard) {
    try {
      // Get media data
      let media = message.mediaData;
      
      // If media not already downloaded, try to download it
      if (!media && message.raw) {
        try {
          // For Baileys message format
          if (message.raw.downloadMedia) {
            media = await message.raw.downloadMedia();
          } else if (this.whatsAppClient.downloadMedia) {
            media = await this.whatsAppClient.downloadMedia(message.raw);
          }
        } catch (downloadError) {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error downloading media:`, downloadError);
        }
      }
      
      if (!media || !media.data) {
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] No media data available`);
        
        // Send text message instead
        if (message.body && message.body.trim() !== '') {
          const displayName = userCard.name || `Unknown (${message.phoneNumber})`;
          await channel.send(`**${displayName} sent media** (unavailable): ${message.body}`);
        } else {
          const displayName = userCard.name || `Unknown (${message.phoneNumber})`;
          await channel.send(`**${displayName} sent media** (unavailable)`);
        }
        return;
      }
      
      // Create temp file for Discord upload
      const extension = this.getFileExtension(media.mimetype);
      const tempFilePath = path.join(
        this.tempDir,
        `whatsapp-temp-${this.instanceId}-${Date.now()}.${extension}`
      );
      
      // Save media to temp file
      const buffer = Buffer.from(media.data, 'base64');
      fs.writeFileSync(tempFilePath, buffer);
      
      // Get display name
      const displayName = userCard.name || `Unknown (${message.phoneNumber})`;
      
      // Send to Discord with caption
      const caption = message.body ? `**${displayName}:** ${message.body}` : `**${displayName}:**`;
      await channel.send({
        content: caption,
        files: [tempFilePath]
      });
      
      console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Forwarded media message to channel ${channel.id}`);
      
      // Clean up temp file - not required for permanent storage
      if (!this.permanentMediaEnabled) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error handling media message:`, error);
      
      // Try to send a text message
      try {
        const displayName = userCard.name || `Unknown (${message.phoneNumber})`;
        await channel.send(`**${displayName} sent media** (failed to process): ${message.body || ''}`);
      } catch (sendError) {
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error sending fallback message:`, sendError);
      }
    }
  }
  
  /**
   * Get file extension from MIME type
   * @param {string} mimetype - MIME type
   * @returns {string} - File extension
   */
  getFileExtension(mimetype) {
    if (!mimetype) return 'bin';
    
    const mapping = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'text/plain': 'txt'
    };
    
    return mapping[mimetype] || mimetype.split('/')[1] || 'bin';
  }
  
  /**
   * Send welcome message to user
   * @param {string} to - Recipient
   */
  async sendWelcomeMessage(to) {
    return this.sendTextMessage(to, this.welcomeMessage);
  }
  
  /**
   * Send text message
   * @param {string} to - Recipient
   * @param {string} text - Message text
   */
  async sendTextMessage(to, text) {
    try {
      if (!this.whatsAppClient) {
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] WhatsApp client not available`);
        return false;
      }
      
      console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Sending message to ${to}: ${text.substring(0, 50)}...`);
      
      // Use sendMessage for Baileys
      if (typeof this.whatsAppClient.sendMessage === 'function') {
        await this.whatsAppClient.sendMessage(to, { text });
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error sending message:`, error);
      return false;
    }
  }
}

module.exports = WhatsAppHandler;
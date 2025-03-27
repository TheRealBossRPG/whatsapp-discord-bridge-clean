// modules/handlers/WhatsAppHandler.js - FIXED VERSION
const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const MediaManager = require('../../utils/MediaManager');

/**
 * Handler for WhatsApp messages
 */
class WhatsAppHandler {
  /**
   * Create a new WhatsApp handler
   * @param {Object} whatsAppClient - WhatsApp client instance
   * @param {Object} userCardManager - User card manager
   * @param {Object} channelManager - Channel manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} vouchHandler - Vouch handler
   * @param {Object} options - Additional options
   */
  constructor(whatsAppClient, userCardManager, channelManager, ticketManager, transcriptManager, vouchHandler, options = {}) {
    this.whatsAppClient = whatsAppClient;
    this.userCardManager = userCardManager;
    this.channelManager = channelManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.vouchHandler = vouchHandler;
    
    // Store options
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    
    // Media manager
    this.mediaManager = new MediaManager({ instanceId: this.instanceId });
    
    // User name collection state
    this.askingForName = new Map();
    
    // Message queue for each user to prevent race conditions
    this.messageQueue = new Map();
    
    // Customizable messages
    this.welcomeMessage = "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage = "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage = "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`[WhatsAppHandler:${this.instanceId}] Initialized`);
  }
  
  /**
   * Extract JID from a message
   * @param {Object} message - WhatsApp message
   * @returns {string|null} - JID or null if invalid
   */
  extractJid(message) {
    try {
      if (!message || !message.key || !message.key.remoteJid) {
        return null;
      }
      
      // Validate JID format
      const jid = message.key.remoteJid;
      
      // Skip status broadcast messages
      if (jid === 'status@broadcast') {
        return null;
      }
      
      // Skip group chats for now (could be customized later)
      if (jid.includes('@g.us')) {
        return null;
      }
      
      return jid;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error extracting JID:`, error);
      return null;
    }
  }
  
  /**
   * Get clean phone number from JID
   * @param {string} jid - WhatsApp JID
   * @returns {string} - Clean phone number
   */
  getPhoneFromJid(jid) {
    if (!jid) return '';
    
    // Extract phone number from JID
    const phone = jid.split('@')[0];
    
    // Return just the digits/plus sign
    return phone;
  }
  
  /**
   * Process a message through the queue to prevent race conditions
   * @param {string} jid - Sender JID
   * @param {Function} processFunction - Function to process the message
   */
  async queueMessageProcessing(jid, processFunction) {
    // Create a queue for this user if it doesn't exist
    if (!this.messageQueue.has(jid)) {
      this.messageQueue.set(jid, Promise.resolve());
    }
    
    // Add this message processing to the queue
    const queuePromise = this.messageQueue.get(jid).then(async () => {
      try {
        await processFunction();
      } catch (error) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Error in message processing:`, error);
      }
    });
    
    // Update the queue
    this.messageQueue.set(jid, queuePromise);
    
    // Return the promise
    return queuePromise;
  }
  
  /**
   * Handle an incoming WhatsApp message
   * @param {Object} message - WhatsApp message object
   */
  async handleMessage(message) {
    try {
      // FIXED: Better validation for message JID
      if (!message || !message.key || !message.key.remoteJid) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Received invalid message without proper JID`);
        return;
      }
      
      const jid = this.extractJid(message);
      if (!jid) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Invalid JID in message`);
        return;
      }
      
      // Skip messages from status broadcast
      if (jid === 'status@broadcast') {
        return;
      }
      
      // Skip messages from groups for now
      if (jid.includes('@g.us')) {
        return;
      }
      
      // Process message in the queue to prevent race conditions
      await this.queueMessageProcessing(jid, async () => {
        // Extract phone number
        const phoneNumber = this.getPhoneFromJid(jid);
        
        // Get message content
        const messageContent = message.message?.conversation || 
                              message.message?.extendedTextMessage?.text || 
                              message.message?.buttonsResponseMessage?.selectedDisplayText || 
                              message.message?.listResponseMessage?.title || 
                              '';
        
        // Only process messages with content (skip media-only, etc.)
        if (messageContent || message.message?.imageMessage || message.message?.documentMessage || message.message?.audioMessage || message.message?.videoMessage) {
          console.log(`[WhatsAppHandler:${this.instanceId}] Message from ${phoneNumber}: ${messageContent.substring(0, 50)}${messageContent.length > 50 ? '...' : ''}`);
          
          // Process vouch message
          if (this.vouchHandler && messageContent.toLowerCase().startsWith('vouch!')) {
            await this.vouchHandler.handleVouchMessage(message, phoneNumber);
            return;
          }
          
          // Check if we are waiting for a name from this user
          if (this.askingForName.has(jid)) {
            // User is providing their name, create ticket
            await this.handleNameResponse(jid, messageContent, message);
          } else {
            // Check if ticket exists for this user
            const channelId = this.channelManager.getChannelId(phoneNumber);
            
            if (channelId) {
              // Ticket exists, forward message to Discord
              await this.handleExistingTicket(phoneNumber, channelId, message);
            } else {
              // No ticket exists, ask for name
              await this.handleNewConversation(jid, phoneNumber);
            }
          }
        }
      });
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling message:`, error);
    }
  }
  
  /**
   * Handle first contact with a user by asking for their name
   * @param {string} jid - User's JID
   * @param {string} phoneNumber - User's phone number
   */
  async handleNewConversation(jid, phoneNumber) {
    try {
      console.log(`[WhatsAppHandler:${this.instanceId}] New conversation with ${phoneNumber}`);
      
      // Set flag to indicate we're waiting for a name
      this.askingForName.set(jid, true);
      
      // Send welcome message
      const message = this.welcomeMessage;
      await this.whatsAppClient.sendMessage(jid, message);
      
      console.log(`[WhatsAppHandler:${this.instanceId}] Asked ${phoneNumber} for their name`);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error in new conversation:`, error);
      this.askingForName.delete(jid);
    }
  }
  
  /**
   * Handle response when user provides their name
   * @param {string} jid - User's JID
   * @param {string} nameResponse - User's response (their name)
   * @param {Object} originalMessage - Original message object
   */
  async handleNameResponse(jid, nameResponse, originalMessage) {
    try {
      // Clear asking for name flag
      this.askingForName.delete(jid);
      
      // Basic validation for name
      let name = nameResponse ? nameResponse.trim() : 'Unknown';
      
      // FIXED: Better name validation
      if (!name || name.length < 1 || name.length > 100) {
        name = 'Unknown User';
      }
      
      const phoneNumber = this.getPhoneFromJid(jid);
      console.log(`[WhatsAppHandler:${this.instanceId}] ${phoneNumber} provided name: ${name}`);
      
      // Store user card with name and phone number
      const userCard = await this.userCardManager.createUserCard(phoneNumber, name);
      
      // Save phone-to-username mapping in media manager for transcripts
      this.mediaManager.setPhoneToUsername(phoneNumber, name);
      
      // Send introduction message to user
      const introMessage = this.introMessage.replace('{name}', name);
      await this.whatsAppClient.sendMessage(jid, introMessage);
      
      // Create a ticket in Discord
      await this.createTicket(phoneNumber, name, originalMessage);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling name response:`, error);
      
      // Try to recover by clearing state
      const phoneNumber = this.getPhoneFromJid(jid);
      this.askingForName.delete(jid);
      
      // Apologize to the user
      try {
        await this.whatsAppClient.sendMessage(jid, "I'm sorry, there was an error setting up your ticket. Let's try again. What's your name?");
        this.askingForName.set(jid, true);
      } catch (sendError) {
        console.error(`[WhatsAppHandler:${this.instanceId}] Error sending error message:`, sendError);
      }
    }
  }
  
  /**
   * Create a new ticket for a user
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   * @param {Object} originalMessage - Original message that triggered ticket creation
   */
  async createTicket(phoneNumber, name, originalMessage) {
    try {
      console.log(`[WhatsAppHandler:${this.instanceId}] Creating ticket for ${name} (${phoneNumber})`);
      
      // Create channel in Discord
      const channelInfo = await this.ticketManager.createTicket(phoneNumber, name);
      
      if (!channelInfo || !channelInfo.channelId) {
        throw new Error('Failed to create ticket channel');
      }
      
      // Register the channel with the channel manager
      this.channelManager.registerChannel(phoneNumber, channelInfo.channelId);
      
      console.log(`[WhatsAppHandler:${this.instanceId}] Created ticket channel ${channelInfo.channelId} for ${name}`);
      
      // Forward the name message
      if (originalMessage) {
        await this.forwardMessageToDiscord(originalMessage, channelInfo.channelId);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error creating ticket:`, error);
      throw error;
    }
  }
  
  /**
   * Handle message for existing ticket
   * @param {string} phoneNumber - User's phone number
   * @param {string} channelId - Discord channel ID
   * @param {Object} message - WhatsApp message object
   */
  async handleExistingTicket(phoneNumber, channelId, message) {
    try {
      // Get user info
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      
      // If reopening a ticket, send reopening message
      const isReopening = await this.ticketManager.isTicketReopening(channelId);
      
      if (isReopening && userCard && userCard.name) {
        // Get JID
        const jid = message.key.remoteJid;
        
        // Send reopening message to user
        const reopenMessage = this.reopenTicketMessage.replace('{name}', userCard.name);
        await this.whatsAppClient.sendMessage(jid, reopenMessage);
        
        // Reopen ticket in Discord
        await this.ticketManager.reopenTicket(channelId, phoneNumber, userCard.name);
      }
      
      // Forward the message to Discord
      await this.forwardMessageToDiscord(message, channelId);
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error handling existing ticket:`, error);
    }
  }
  
  /**
   * Forward a WhatsApp message to Discord
   * @param {Object} message - WhatsApp message object
   * @param {string} channelId - Discord channel ID
   */
  async forwardMessageToDiscord(message, channelId) {
    try {
      // Get message content
      const jid = message.key.remoteJid;
      const phoneNumber = this.getPhoneFromJid(jid);
      
      // Get user data
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      const name = userCard ? userCard.name : 'Unknown';
      
      // Extract text message content
      const messageContent = message.message?.conversation || 
                            message.message?.extendedTextMessage?.text || 
                            message.message?.buttonsResponseMessage?.selectedDisplayText || 
                            message.message?.listResponseMessage?.title || 
                            '';
                            
      // Skip empty messages
      if (!messageContent && !message.message?.imageMessage && !message.message?.documentMessage && !message.message?.audioMessage && !message.message?.videoMessage) {
        return;
      }
      
      // Default to empty string for text message portion
      let textMessage = messageContent;
      
      // Format the Discord message
      const discordPrefix = `**${name}**: `;
      
      // Check media types
      if (message.message?.imageMessage) {
        // Handle image
        const caption = message.message.imageMessage.caption || '';
        
        // Download image
        const media = await this.downloadMedia(message);
        
        // Forward to Discord
        if (media) {
          await this.ticketManager.sendImageToChannel(
            channelId, 
            media.data,
            discordPrefix + (caption || textMessage || 'Sent an image'),
            media.filename || 'image.jpg',
            media.mimetype
          );
        } else {
          await this.ticketManager.sendMessageToChannel(channelId, `${discordPrefix}Sent an image (could not download)`);
        }
      } else if (message.message?.documentMessage) {
        // Handle document
        const caption = message.message.documentMessage.caption || '';
        
        // Download file
        const media = await this.downloadMedia(message);
        
        // Forward to Discord
        if (media) {
          await this.ticketManager.sendFileToChannel(
            channelId, 
            media.data, 
            discordPrefix + (caption || textMessage || `Sent a file: ${message.message.documentMessage.fileName || 'document'}`),
            media.filename || message.message.documentMessage.fileName || 'document',
            media.mimetype
          );
        } else {
          await this.ticketManager.sendMessageToChannel(
            channelId, 
            `${discordPrefix}Sent a file: ${message.message.documentMessage.fileName || 'document'} (could not download)`
          );
        }
      } else if (message.message?.videoMessage) {
        // Handle video
        const caption = message.message.videoMessage.caption || '';
        
        // Download video
        const media = await this.downloadMedia(message);
        
        // Forward to Discord
        if (media) {
          await this.ticketManager.sendFileToChannel(
            channelId, 
            media.data, 
            discordPrefix + (caption || textMessage || 'Sent a video'),
            media.filename || 'video.mp4',
            media.mimetype
          );
        } else {
          await this.ticketManager.sendMessageToChannel(channelId, `${discordPrefix}Sent a video (could not download)`);
        }
      } else if (message.message?.audioMessage) {
        // Handle audio
        // Download audio
        const media = await this.downloadMedia(message);
        
        // Forward to Discord
        if (media) {
          await this.ticketManager.sendFileToChannel(
            channelId, 
            media.data, 
            `${discordPrefix}Sent an audio message`,
            media.filename || 'audio.ogg',
            media.mimetype
          );
        } else {
          await this.ticketManager.sendMessageToChannel(channelId, `${discordPrefix}Sent an audio message (could not download)`);
        }
      } else if (textMessage) {
        // Regular text message
        await this.ticketManager.sendMessageToChannel(channelId, discordPrefix + textMessage);
      }
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error forwarding message to Discord:`, error);
    }
  }
  
  /**
   * Download media from WhatsApp message
   * @param {Object} message - WhatsApp message object
   * @returns {Object|null} - Media object or null if download failed
   */
  async downloadMedia(message) {
    try {
      if (!message || !message.message) {
        return null;
      }
      
      if (message.message.imageMessage) {
        // Download image
        const media = await this.whatsAppClient.downloadMedia(message.message.imageMessage);
        if (media) {
          return {
            data: media.data,
            filename: 'image.jpg',
            mimetype: message.message.imageMessage.mimetype || 'image/jpeg'
          };
        }
      } else if (message.message.documentMessage) {
        // Download document
        const media = await this.whatsAppClient.downloadMedia(message.message.documentMessage);
        if (media) {
          return {
            data: media.data,
            filename: message.message.documentMessage.fileName || 'document',
            mimetype: message.message.documentMessage.mimetype || 'application/octet-stream'
          };
        }
      } else if (message.message.videoMessage) {
        // Download video
        const media = await this.whatsAppClient.downloadMedia(message.message.videoMessage);
        if (media) {
          return {
            data: media.data,
            filename: 'video.mp4',
            mimetype: message.message.videoMessage.mimetype || 'video/mp4'
          };
        }
      } else if (message.message.audioMessage) {
        // Download audio
        const media = await this.whatsAppClient.downloadMedia(message.message.audioMessage);
        if (media) {
          return {
            data: media.data,
            filename: 'audio.ogg',
            mimetype: message.message.audioMessage.mimetype || 'audio/ogg'
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error downloading media:`, error);
      return null;
    }
  }
  
  /**
   * Send a text message to a WhatsApp user
   * @param {string} phoneNumber - Phone number to send to
   * @param {string} message - Message text
   */
  async sendMessage(phoneNumber, message) {
    try {
      // Ensure phone number is clean and has proper format
      const cleanPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
      
      // Format number with WhatsApp suffix
      const recipient = `${cleanPhone.replace(/\D/g, '')}@s.whatsapp.net`;
      
      // Send message
      await this.whatsAppClient.sendMessage(recipient, message);
      
      return true;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending message to ${phoneNumber}:`, error);
      return false;
    }
  }
  
  /**
   * Send a media message to WhatsApp
   * @param {string} phoneNumber - User's phone number
   * @param {string} mediaPath - Path to media file
   * @param {string} caption - Optional caption
   */
  async sendMedia(phoneNumber, mediaPath, caption = '') {
    try {
      // Ensure the media file exists
      if (!fs.existsSync(mediaPath)) {
        throw new Error(`Media file not found: ${mediaPath}`);
      }
      
      // Get media type from file extension
      const ext = path.extname(mediaPath).toLowerCase();
      let mimeType = 'application/octet-stream';
      
      // Set common mime types
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        mimeType = `image/${ext.substring(1)}`;
      } else if (['.mp4', '.mov'].includes(ext)) {
        mimeType = `video/${ext.substring(1)}`;
      } else if (['.mp3', '.ogg', '.wav'].includes(ext)) {
        mimeType = `audio/${ext.substring(1)}`;
      } else if (ext === '.pdf') {
        mimeType = 'application/pdf';
      }
      
      // Clean & format phone number
      const cleanPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
      const recipient = `${cleanPhone.replace(/\D/g, '')}@s.whatsapp.net`;
      
      // Create MessageMedia
      const media = MessageMedia.fromFilePath(mediaPath);
      media.mimetype = mimeType;
      media.filename = path.basename(mediaPath);
      
      // Send media
      await this.whatsAppClient.sendMessage(recipient, media, { caption });
      
      return true;
    } catch (error) {
      console.error(`[WhatsAppHandler:${this.instanceId}] Error sending media to ${phoneNumber}:`, error);
      return false;
    }
  }
}

module.exports = WhatsAppHandler;
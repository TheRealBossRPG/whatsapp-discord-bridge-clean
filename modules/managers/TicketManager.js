// modules/managers/TicketManager.js - Fixed ticket management
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

/**
 * Manages support tickets
 */
class TicketManager {
  /**
   * Create a new ticket manager
   * @param {Object} channelManager - Channel manager
   * @param {Object} discordClient - Discord client
   * @param {string} guildId - Discord guild ID
   * @param {string} categoryId - Discord category ID
   * @param {Object} options - Additional options
   */
  constructor(channelManager, discordClient, guildId, categoryId, options = {}) {
    this.channelManager = channelManager;
    this.discordClient = discordClient;
    this.guildId = guildId;
    this.categoryId = categoryId;
    this.userCardManager = null;
    this.transcriptManager = null;
    
    // Options
    this.instanceId = options.instanceId || 'default';
    this.customNewTicketMessage = options.customNewTicketMessage || null;
    this.customCloseMessage = options.customCloseMessage || null;
    this.customIntroMessages = options.customIntroMessages || null;
    
    console.log(`[TicketManager:${this.instanceId}] Initialized with category ID: ${categoryId}`);
  }
  
  /**
   * Set user card manager
   * @param {Object} userCardManager - User card manager
   */
  setUserCardManager(userCardManager) {
    this.userCardManager = userCardManager;
  }
  
  /**
   * Set transcript manager
   * @param {Object} transcriptManager - Transcript manager
   */
  setTranscriptManager(transcriptManager) {
    this.transcriptManager = transcriptManager;
  }
  
  /**
   * Set custom close message
   * @param {string} message - Custom close message
   */
  setCustomCloseMessage(message) {
    this.customCloseMessage = message;
  }
  
  /**
   * Set custom new ticket message
   * @param {string} message - Custom new ticket message
   */
  setCustomIntroMessage(message) {
    this.customNewTicketMessage = message;
  }
  
  /**
   * Create a ticket for a user
   * @param {string} phoneNumber - User's phone number
   * @param {string} userName - User's name
   * @returns {Promise<Object>} - Created channel
   */
  async createTicket(phoneNumber, userName) {
    try {
      // Validate inputs
      if (!phoneNumber) {
        console.error(`[TicketManager:${this.instanceId}] Cannot create ticket: Missing phone number`);
        return null;
      }
      
      if (!userName) {
        userName = phoneNumber;
      }
      
      console.log(`[TicketManager:${this.instanceId}] Creating ticket for ${userName} (${phoneNumber})`);
      
      // Format channel name
      const channelName = this.formatChannelName(userName, phoneNumber);
      
      // Get the Discord guild
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[TicketManager:${this.instanceId}] Cannot create ticket: Guild not found`);
        return null;
      }
      
      // Get the category
      const category = guild.channels.cache.get(this.categoryId);
      if (!category) {
        console.error(`[TicketManager:${this.instanceId}] Cannot create ticket: Category not found`);
        return null;
      }
      
      // Create the channel
      const channel = await guild.channels.create({
        name: channelName,
        type: 0, // Text channel
        parent: this.categoryId,
        topic: `WhatsApp: ${phoneNumber} | Name: ${userName}`,
        reason: `WhatsApp ticket for ${userName} (${phoneNumber})`
      });
      
      console.log(`[TicketManager:${this.instanceId}] Created channel ${channel.name} (${channel.id}) for ${userName}`);
      
      // Send the intro message
      try {
        await this.sendIntroMessage(channel, userName, phoneNumber);
      } catch (introError) {
        console.error(`[TicketManager:${this.instanceId}] Error sending intro message:`, introError);
      }
      
      return channel;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error creating ticket:`, error);
      return null;
    }
  }
  
  /**
   * Send introduction message to a ticket channel
   * @param {Object} channel - Discord channel
   * @param {string} userName - User's name
   * @param {string} phoneNumber - User's phone number
   * @returns {Promise<Object>} - Sent message
   */
  async sendIntroMessage(channel, userName, phoneNumber) {
    try {
      // Define default intro message
      let introMessage = "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.";
      
      // Use custom message if provided
      if (this.customNewTicketMessage) {
        introMessage = this.customNewTicketMessage;
      }
      
      // Replace placeholders
      introMessage = introMessage
        .replace(/{name}/g, userName)
        .replace(/{phoneNumber}/g, phoneNumber);
      
      // Send the message
      const message = await channel.send({
        content: introMessage,
        allowedMentions: { roles: [], users: [] }
      });
      
      return message;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error sending intro message:`, error);
      return null;
    }
  }
  
  /**
   * Send a message from WhatsApp to a Discord channel
   * @param {string} channelId - Discord channel ID
   * @param {string} phoneNumber - Sender's phone number
   * @param {string} senderName - Sender's name
   * @param {string} messageText - Message text
   * @param {Object} mediaInfo - Media information
   * @returns {Promise<Object>} - Sent message
   */
  async sendMessageToChannel(channelId, phoneNumber, senderName, messageText, mediaInfo = null) {
    try {
      // Get the channel
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[TicketManager:${this.instanceId}] Guild not found: ${this.guildId}`);
        return null;
      }
      
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        console.error(`[TicketManager:${this.instanceId}] Channel not found: ${channelId}`);
        return null;
      }
      
      // Create the message content
      let content = this.formatUserMessage(senderName, messageText);
      
      // Prepare message options
      const messageOptions = {
        content,
        allowedMentions: { parse: [] }
      };
      
      // Handle media if present
      if (mediaInfo && mediaInfo.hasMedia && mediaInfo.fileBuffer) {
        try {
          // Creating an attachment
          let filename = `${Date.now()}-media`;
          
          // Add appropriate extension
          if (mediaInfo.mediaType === 'image') {
            filename += mediaInfo.fileBuffer[0] === 0xFF && mediaInfo.fileBuffer[1] === 0xD8 ? '.jpg' : '.png';
          } else if (mediaInfo.mediaType === 'video') {
            filename += '.mp4';
          } else if (mediaInfo.mediaType === 'audio') {
            filename += mediaInfo.isVoiceNote ? '.ogg' : '.mp3';
          } else if (mediaInfo.mediaType === 'document' && mediaInfo.fileName) {
            // Use original filename for documents
            filename = mediaInfo.fileName;
          } else if (mediaInfo.mediaType === 'sticker') {
            filename += '.webp';
          }
          
          // Create attachment
          const attachment = new AttachmentBuilder(mediaInfo.fileBuffer, { name: filename });
          messageOptions.files = [attachment];
          
          // Add caption as separate content if it exists and differs from the message text
          if (mediaInfo.caption && mediaInfo.caption !== messageText) {
            messageOptions.content += `\n\n**Caption:** ${mediaInfo.caption}`;
          }
        } catch (mediaError) {
          console.error(`[TicketManager:${this.instanceId}] Error processing media:`, mediaError);
          messageOptions.content += '\n\n*[Media attachment could not be processed]*';
        }
      }
      
      // Send the message
      const message = await channel.send(messageOptions);
      
      // Update transcript if enabled
      if (this.transcriptManager && !this.transcriptManager.isDisabled) {
        this.transcriptManager.addMessage(channelId, {
          fromUser: true,
          content: messageText,
          username: senderName,
          phoneNumber,
          timestamp: Date.now(),
          hasMedia: mediaInfo?.hasMedia || false,
          mediaType: mediaInfo?.mediaType || null
        });
      }
      
      return message;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error sending message to channel:`, error);
      return null;
    }
  }
  
  /**
   * Format user message with sender info
   * @param {string} senderName - Sender's name
   * @param {string} messageText - Message text
   * @returns {string} - Formatted message
   */
  formatUserMessage(senderName, messageText) {
    return `**${senderName}:** ${messageText}`;
  }
  
  /**
   * Format channel name for Discord
   * @param {string} userName - User's name
   * @param {string} phoneNumber - User's phone number
   * @returns {string} - Formatted channel name
   */
  formatChannelName(userName, phoneNumber) {
    try {
      // Clean the name
      let cleanName = userName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-') // Replace non-alphanumeric with hyphens
        .replace(/--+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
      
      // If name is empty, use 'user'
      if (!cleanName) {
        cleanName = 'user';
      }
      
      // Get last 4 digits of phone number
      const last4 = phoneNumber.slice(-4);
      
      // Combine name and phone digits
      return `${cleanName}-${last4}`;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error formatting channel name:`, error);
      // Fallback
      return `ticket-${Date.now().toString().slice(-4)}`;
    }
  }
  
  /**
   * Close a ticket
   * @param {string} channelId - Discord channel ID
   * @param {string} reason - Close reason
   * @param {Object} moderator - Moderator who closed the ticket
   * @returns {Promise<boolean>} - Success status
   */
  async closeTicket(channelId, reason = '', moderator = null) {
    try {
      // Get the channel
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        return false;
      }
      
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        return false;
      }
      
      // Get the phone number associated with this channel
      const phoneNumber = this.channelManager.getPhoneNumberByChannel(channelId);
      if (!phoneNumber) {
        console.log(`[TicketManager:${this.instanceId}] Could not find phone number for channel ${channelId}`);
      }
      
      // Get user name
      let userName = phoneNumber || 'user';
      if (this.userCardManager) {
        const userCard = this.userCardManager.getUserCard(phoneNumber);
        if (userCard && userCard.name) {
          userName = userCard.name;
        }
      }
      
      // Save transcript first
      if (this.transcriptManager && !this.transcriptManager.isDisabled) {
        const transcriptPath = await this.transcriptManager.saveChannelTranscript(
          channelId,
          userName,
          phoneNumber,
          reason,
          moderator
        );
        
        if (transcriptPath) {
          console.log(`[TicketManager:${this.instanceId}] Saved transcript for ${userName} (${phoneNumber}) to ${transcriptPath}`);
        }
      }
      
      // Send closing message to user
      if (phoneNumber && this.whatsAppClient) {
        try {
          let closingMessage = "Thank you for contacting support. Your ticket is now being closed.";
          
          if (this.customCloseMessage) {
            closingMessage = this.customCloseMessage.replace(/{name}/g, userName);
          }
          
          await this.whatsAppClient.sendMessage(phoneNumber, closingMessage);
          console.log(`[TicketManager:${this.instanceId}] Sent closing message to ${userName} (${phoneNumber})`);
        } catch (messageError) {
          console.error(`[TicketManager:${this.instanceId}] Error sending closing message:`, messageError);
        }
      }
      
      // Remove channel mapping
      if (phoneNumber) {
        this.channelManager.removeChannel(phoneNumber);
      }
      
      // Delete the channel
      try {
        await channel.delete(`Ticket closed by ${moderator ? moderator.tag : 'system'}: ${reason}`);
        console.log(`[TicketManager:${this.instanceId}] Deleted channel ${channelId}`);
        return true;
      } catch (deleteError) {
        console.error(`[TicketManager:${this.instanceId}] Error deleting channel:`, deleteError);
        return false;
      }
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error closing ticket:`, error);
      return false;
    }
  }
  
  /**
   * Check if a channel exists
   * @param {string} channelId - Discord channel ID
   * @param {Function} callback - Callback function
   */
  checkChannelExists(channelId, callback) {
    try {
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        callback(false);
        return;
      }
      
      // Cache hit
      if (guild.channels.cache.has(channelId)) {
        callback(true);
        return;
      }
      
      // Fetch from API
      guild.channels.fetch(channelId)
        .then(() => callback(true))
        .catch(() => callback(false));
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error checking channel existence:`, error);
      callback(false);
    }
  }
}

module.exports = TicketManager;
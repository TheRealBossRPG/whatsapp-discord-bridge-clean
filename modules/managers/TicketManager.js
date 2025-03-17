// modules/managers/TicketManager.js
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');

/**
 * Manages WhatsApp support tickets in Discord
 */
class TicketManager {
  /**
   * Create a new ticket manager
   * @param {Object} channelManager - Channel manager instance
   * @param {Object} discordClient - Discord client
   * @param {string} guildId - Guild ID
   * @param {string} categoryId - Category ID for ticket channels
   * @param {Object} options - Additional options
   */
  constructor(channelManager, discordClient, guildId, categoryId, options = {}) {
    this.channelManager = channelManager;
    this.discordClient = discordClient;
    this.guildId = guildId;
    this.categoryId = categoryId;
    
    // Optional components
    this.userCardManager = null;
    this.transcriptManager = null;
    
    // Instance ID
    this.instanceId = options.instanceId || 'default';
    
    // Custom messages
    this.customIntroMessage = options.customIntroMessages || null;
    this.customCloseMessage = options.customCloseMessages || null;
    
    // Default messages
    this.defaultIntroMessage = "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.";
    this.defaultCloseMessage = "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
    
    // Active tickets count
    this.activeTickets = 0;
    
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
   * Format channel name from user name
   * @param {string} name - User name
   * @returns {string} - Formatted channel name
   */
  formatChannelName(name) {
    // Remove non-alphanumeric characters, replace spaces with hyphens, lowercase
    let channelName = name.toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 20);  // Discord channel name max length
    
    // Ensure it starts with a letter or number
    if (!/^[a-z0-9]/.test(channelName)) {
      channelName = `t-${channelName}`;
    }
    
    // Remove leading/trailing hyphens
    channelName = channelName.replace(/^-+|-+$/g, '');
    
    // If empty after formatting, use a default
    if (!channelName) {
      channelName = 'support-ticket';
    }
    
    return channelName;
  }
  
  /**
   * Set custom intro message for new tickets
   * @param {string} message - Custom message
   */
  setCustomIntroMessage(message) {
    this.customIntroMessage = message;
  }
  
  /**
   * Set custom close message for tickets
   * @param {string} message - Custom message
   */
  setCustomCloseMessage(message) {
    this.customCloseMessage = message;
  }
  
  /**
   * Get guild by ID
   * @returns {Object} - Discord guild
   */
  async getGuild() {
    try {
      const guild = await this.discordClient.guilds.fetch(this.guildId);
      return guild;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error fetching guild:`, error);
      return null;
    }
  }
  
  /**
   * Get category channel
   * @returns {Object} - Category channel
   */
  async getCategory() {
    try {
      const guild = await this.getGuild();
      if (!guild) return null;
      
      const category = await guild.channels.fetch(this.categoryId);
      return category;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error fetching category:`, error);
      return null;
    }
  }
  
  /**
   * Create a new ticket for a WhatsApp user
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   * @param {string} initialMessage - Initial message
   * @param {string} mediaPath - Path to media file (if any)
   * @param {string} mediaType - Type of media
   * @returns {Promise<Object>} - Ticket info
   */
  async createTicket(phoneNumber, name, initialMessage = null, mediaPath = null, mediaType = 'image') {
    try {
      console.log(`[TicketManager:${this.instanceId}] Creating ticket for ${phoneNumber} (${name})`);
      
      // Get guild and category
      const guild = await this.getGuild();
      const category = await this.getCategory();
      
      if (!guild || !category) {
        throw new Error('Guild or category not found');
      }
      
      // Format channel name
      const channelName = this.formatChannelName(name);
      
      // Check if channel already exists for this phone number
      if (this.channelManager.channelExists(phoneNumber)) {
        // Channel exists - get ID
        const existingChannelId = this.channelManager.getChannelId(phoneNumber);
        
        if (existingChannelId) {
          console.log(`[TicketManager:${this.instanceId}] Channel already exists for ${phoneNumber}: ${existingChannelId}`);
          
          try {
            // Try to fetch the channel
            const channel = await guild.channels.fetch(existingChannelId);
            
            // Send reopen message
            const embed = new EmbedBuilder()
              .setColor(0x3498DB)
              .setTitle('🔄 Ticket Reopened')
              .setDescription(`**${name}** has sent a new message.`)
              .setTimestamp();
            
            await channel.send({ embeds: [embed] });
            
            // Send the actual message
            if (mediaPath && fs.existsSync(mediaPath)) {
              await this.sendMediaToTicket(phoneNumber, mediaPath, initialMessage, mediaType);
            } else if (initialMessage) {
              await this.sendMessageToTicket(phoneNumber, initialMessage);
            }
            
            // Return existing ticket info
            return {
              channelId: existingChannelId,
              isNew: false,
              phoneNumber,
              name
            };
          } catch (error) {
            console.error(`[TicketManager:${this.instanceId}] Error fetching existing channel: ${error.message}`);
            console.log(`[TicketManager:${this.instanceId}] Channel ${existingChannelId} might have been deleted, creating new one`);
            // Continue with creating a new channel
          }
        }
      }
      
      // Create a new channel
      const createdChannel = await guild.channels.create({
        name: channelName,
        type: 0, // Text channel
        parent: category,
        topic: `WhatsApp Support Ticket for ${name} | ${phoneNumber}`,
        reason: `WhatsApp support ticket for ${phoneNumber}`
      });
      
      console.log(`[TicketManager:${this.instanceId}] Created channel ${createdChannel.id} for ${phoneNumber}`);
      
      // Store channel in manager
      this.channelManager.setChannel(phoneNumber, createdChannel.id);
      
      // Increment active tickets
      this.activeTickets++;
      
      // Send intro message
      let introMessage = this.customIntroMessage || this.defaultIntroMessage;
      introMessage = introMessage
        .replace(/{name}/g, name)
        .replace(/{phoneNumber}/g, phoneNumber.replace('@s.whatsapp.net', ''));
      
      await createdChannel.send(introMessage);
      
      // If we have user info, post it
      if (this.userCardManager) {
        const userCard = await this.userCardManager.getUserCard(phoneNumber);
        
        if (userCard) {
          // Create user info embed
          const userEmbed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('User Information')
            .addFields(
              { name: 'Name', value: userCard.name, inline: true },
              { name: 'Phone', value: phoneNumber.replace('@s.whatsapp.net', ''), inline: true },
              { name: 'First Contact', value: new Date(userCard.firstContact).toLocaleString(), inline: true }
            )
            .setFooter({ text: `User ID: ${userCard.id || phoneNumber}` });
          
          // If user has a profile pic, add it
          if (userCard.profilePicUrl) {
            userEmbed.setThumbnail(userCard.profilePicUrl);
          }
          
          await createdChannel.send({ embeds: [userEmbed] });
        }
      }
      
      // Send initial message if provided
      if (mediaPath && fs.existsSync(mediaPath)) {
        await this.sendMediaToTicket(phoneNumber, mediaPath, initialMessage, mediaType);
      } else if (initialMessage) {
        await this.sendMessageToTicket(phoneNumber, initialMessage);
      }
      
      // Return new ticket info
      return {
        channelId: createdChannel.id,
        isNew: true,
        phoneNumber,
        name
      };
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error creating ticket:`, error);
      throw error;
    }
  }
  
  /**
   * Close a ticket
   * @param {string} phoneNumber - User's phone number
   * @param {string} closedBy - Who closed the ticket
   * @param {boolean} sendMessage - Whether to send a closing message
   * @returns {Promise<boolean>} - Success status
   */
  async closeTicket(phoneNumber, closedBy = 'Discord', sendMessage = true) {
    try {
      console.log(`[TicketManager:${this.instanceId}] Closing ticket for ${phoneNumber}`);
      
      // Check if channel exists
      if (!this.channelManager.channelExists(phoneNumber)) {
        console.log(`[TicketManager:${this.instanceId}] No channel found for ${phoneNumber}`);
        return false;
      }
      
      // Get channel ID
      const channelId = this.channelManager.getChannelId(phoneNumber);
      
      // Get guild
      const guild = await this.getGuild();
      if (!guild) {
        console.error(`[TicketManager:${this.instanceId}] Guild not found`);
        return false;
      }
      
      try {
        // Fetch channel
        const channel = await guild.channels.fetch(channelId);
        
        // Send closing message to WhatsApp if requested
        if (sendMessage) {
          // Get user name
          let userName = "Customer";
          
          if (this.userCardManager) {
            const userCard = await this.userCardManager.getUserCard(phoneNumber);
            if (userCard) {
              userName = userCard.name;
            }
          }
          
          // Get closing message
          let closeMessage = this.customCloseMessage || this.defaultCloseMessage;
          closeMessage = closeMessage
            .replace(/{name}/g, userName)
            .replace(/{phoneNumber}/g, phoneNumber.replace('@s.whatsapp.net', ''));
          
          // Send to WhatsApp
          const whatsappClient = this.channelManager.getWhatsAppClient();
          if (whatsappClient) {
            await whatsappClient.sendTextMessage(phoneNumber, closeMessage);
          }
        }
        
        // Create transcript if manager available
        if (this.transcriptManager) {
          await this.transcriptManager.createTranscript(channel, phoneNumber);
        }
        
        // Send closing message to Discord
        const closingEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('🔒 Ticket Closed')
          .setDescription(`This ticket has been closed by ${closedBy}.`)
          .setTimestamp();
        
        await channel.send({ embeds: [closingEmbed] });
        
        // Delete channel
        await channel.delete(`Ticket closed by ${closedBy}`);
        
        // Remove from channel manager
        this.channelManager.removeChannel(phoneNumber);
        
        // Decrement active tickets
        if (this.activeTickets > 0) {
          this.activeTickets--;
        }
        
        return true;
      } catch (error) {
        console.error(`[TicketManager:${this.instanceId}] Error closing ticket:`, error);
        
        // If channel not found (already deleted), still remove from manager
        if (error.code === 10003) {
          this.channelManager.removeChannel(phoneNumber);
          return true;
        }
        
        return false;
      }
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error closing ticket:`, error);
      return false;
    }
  }
  
  /**
   * Send a message to a ticket channel
   * @param {string} phoneNumber - User's phone number
   * @param {string} message - Message content
   * @returns {Promise<boolean>} - Success status
   */
  async sendMessageToTicket(phoneNumber, message) {
    try {
      if (!message || message.trim() === '') {
        console.log(`[TicketManager:${this.instanceId}] Empty message for ${phoneNumber}, skipping`);
        return false;
      }
      
      console.log(`[TicketManager:${this.instanceId}] Sending message to ticket for ${phoneNumber}`);
      
      // Check if channel exists
      if (!this.channelManager.channelExists(phoneNumber)) {
        console.log(`[TicketManager:${this.instanceId}] No channel found for ${phoneNumber}`);
        return false;
      }
      
      // Get channel ID
      const channelId = this.channelManager.getChannelId(phoneNumber);
      
      // Get guild
      const guild = await this.getGuild();
      if (!guild) {
        console.error(`[TicketManager:${this.instanceId}] Guild not found`);
        return false;
      }
      
      try {
        // Fetch channel
        const channel = await guild.channels.fetch(channelId);
        
        // Get username from user card manager if available
        let userName = "Customer";
        
        if (this.userCardManager) {
          const userCard = await this.userCardManager.getUserCard(phoneNumber);
          if (userCard) {
            userName = userCard.name;
          }
        }
        
        // Format message with special channel mentions
        let formattedMessage = message;
        
        // Check for special channel mentions in the message
        const specialChannels = this.channelManager.getSpecialChannels();
        if (specialChannels && Object.keys(specialChannels).length > 0) {
          // Get all text channels in the guild
          const textChannels = await guild.channels.fetch();
          
          // Iterate through special channels
          for (const [channelId, channelInfo] of Object.entries(specialChannels)) {
            // Find the channel in the guild
            const specialChannel = textChannels.get(channelId);
            
            if (specialChannel) {
              // Check if the channel name is mentioned in the message
              const channelNamePattern = new RegExp(`#${specialChannel.name}`, 'gi');
              
              if (channelNamePattern.test(formattedMessage)) {
                // Replace with the special message
                const specialMessage = channelInfo.message || `Click here to view <#${channelId}>`;
                formattedMessage = formattedMessage.replace(channelNamePattern, `<#${channelId}> (${specialMessage})`);
              }
            }
          }
        }
        
        // Create user message embed
        const userEmbed = new EmbedBuilder()
          .setColor(0x00AE86)
          .setAuthor({ name: `${userName} (WhatsApp)` })
          .setDescription(formattedMessage)
          .setTimestamp();
        
        // Send message
        await channel.send({ embeds: [userEmbed] });
        
        return true;
      } catch (error) {
        console.error(`[TicketManager:${this.instanceId}] Error sending message to ticket:`, error);
        return false;
      }
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error sending message to ticket:`, error);
      return false;
    }
  }
  
  /**
   * Send media to a ticket channel
   * @param {string} phoneNumber - User's phone number
   * @param {string} mediaPath - Path to media file
   * @param {string} caption - Caption for media
   * @param {string} mediaType - Type of media
   * @returns {Promise<boolean>} - Success status
   */
  async sendMediaToTicket(phoneNumber, mediaPath, caption = '', mediaType = 'image') {
    try {
      console.log(`[TicketManager:${this.instanceId}] Sending media to ticket for ${phoneNumber}: ${mediaPath}`);
      
      // Check if file exists
      if (!mediaPath || !fs.existsSync(mediaPath)) {
        console.error(`[TicketManager:${this.instanceId}] Media file not found: ${mediaPath}`);
        
        // Still send caption as a regular message if provided
        if (caption && caption.trim() !== '') {
          return this.sendMessageToTicket(phoneNumber, caption);
        }
        
        return false;
      }
      
      // Check if channel exists
      if (!this.channelManager.channelExists(phoneNumber)) {
        console.log(`[TicketManager:${this.instanceId}] No channel found for ${phoneNumber}`);
        return false;
      }
      
      // Get channel ID
      const channelId = this.channelManager.getChannelId(phoneNumber);
      
      // Get guild
      const guild = await this.getGuild();
      if (!guild) {
        console.error(`[TicketManager:${this.instanceId}] Guild not found`);
        return false;
      }
      
      try {
        // Fetch channel
        const channel = await guild.channels.fetch(channelId);
        
        // Get username from user card manager if available
        let userName = "Customer";
        
        if (this.userCardManager) {
          const userCard = await this.userCardManager.getUserCard(phoneNumber);
          if (userCard) {
            userName = userCard.name;
          }
        }
        
        // Create attachment
        const attachment = new AttachmentBuilder(mediaPath);
        
        // Get filename
        const filename = path.basename(mediaPath);
        
        // Create embed with media
        const mediaEmbed = new EmbedBuilder()
          .setColor(0x00AE86)
          .setAuthor({ name: `${userName} (WhatsApp)` })
          .setTimestamp();
        
        // Add caption if provided
        if (caption && caption.trim() !== '') {
          mediaEmbed.setDescription(caption);
        }
        
        // Add media based on type
        if (mediaType === 'image') {
          mediaEmbed.setImage(`attachment://${filename}`);
        } else if (mediaType === 'video') {
          // Can't embed videos, so just mention it
          mediaEmbed.setDescription(`${caption ? caption + '\n\n' : ''}*Sent a video*`);
        } else if (mediaType === 'document') {
          // Can't embed documents, so just mention it
          mediaEmbed.setDescription(`${caption ? caption + '\n\n' : ''}*Sent a document*`);
        } else if (mediaType === 'audio') {
          // Can't embed audio, so just mention it
          mediaEmbed.setDescription(`${caption ? caption + '\n\n' : ''}*Sent an audio message*`);
        }
        
        // Send message with attachment
        await channel.send({
          embeds: [mediaEmbed],
          files: [attachment]
        });
        
        return true;
      } catch (error) {
        console.error(`[TicketManager:${this.instanceId}] Error sending media to ticket:`, error);
        
        // If the error is about file size, try sending without embed
        if (error.message.includes('file exceeds maximum size') || error.code === 40005) {
          try {
            // Get channel
            const channel = await guild.channels.fetch(channelId);
            
            // Send message about the media
            const mediaTypeMessage = mediaType === 'image' ? 'an image' :
                                   mediaType === 'video' ? 'a video' :
                                   mediaType === 'document' ? 'a document' :
                                   mediaType === 'audio' ? 'an audio message' : 'a file';
            
            // Create user message embed
            const userEmbed = new EmbedBuilder()
              .setColor(0x00AE86)
              .setAuthor({ name: `${userName} (WhatsApp)` })
              .setDescription(`${caption ? caption + '\n\n' : ''}*Sent ${mediaTypeMessage} (too large to upload)*`)
              .setTimestamp();
            
            // Send message
            await channel.send({ embeds: [userEmbed] });
            
            return true;
          } catch (secondError) {
            console.error(`[TicketManager:${this.instanceId}] Error sending fallback message:`, secondError);
          }
        }
        
        return false;
      }
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error sending media to ticket:`, error);
      return false;
    }
  }
  
  /**
   * Send a reply from Discord to WhatsApp
   * @param {string} phoneNumber - User's phone number
   * @param {string} message - Message content
   * @param {string} senderName - Discord sender's name
   * @returns {Promise<boolean>} - Success status
   */
  async sendReplyToWhatsApp(phoneNumber, message, senderName) {
    try {
      console.log(`[TicketManager:${this.instanceId}] Sending reply to WhatsApp for ${phoneNumber} from ${senderName}`);
      
      // Get WhatsApp client
      const whatsappClient = this.channelManager.getWhatsAppClient();
      
      if (!whatsappClient) {
        console.error(`[TicketManager:${this.instanceId}] WhatsApp client not found`);
        return false;
      }
      
      // Format message
      let formattedMessage = `*${senderName}:* ${message}`;
      
      // Send message
      await whatsappClient.sendTextMessage(phoneNumber, formattedMessage);
      
      return true;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error sending reply to WhatsApp:`, error);
      return false;
    }
  }
  
  /**
   * Send media from Discord to WhatsApp
   * @param {string} phoneNumber - User's phone number
   * @param {string} mediaUrl - Media URL
   * @param {string} caption - Caption for media
   * @param {string} senderName - Discord sender's name
   * @returns {Promise<boolean>} - Success status
   */
  async sendMediaToWhatsApp(phoneNumber, mediaUrl, caption, senderName) {
    try {
      console.log(`[TicketManager:${this.instanceId}] Sending media to WhatsApp for ${phoneNumber} from ${senderName}`);
      
      // Get WhatsApp client
      const whatsappClient = this.channelManager.getWhatsAppClient();
      
      if (!whatsappClient) {
        console.error(`[TicketManager:${this.instanceId}] WhatsApp client not found`);
        return false;
      }
      
      // Format caption
      let formattedCaption = `*${senderName}:* ${caption || ''}`;
      
      // Download media to temp file
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(mediaUrl);
      const buffer = await response.buffer();
      
      // Create temp file
      const tempDir = path.join(__dirname, '..', '..', 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const filename = `discord_media_${Date.now()}${path.extname(mediaUrl) || '.jpg'}`;
      const mediaPath = path.join(tempDir, filename);
      
      // Save file
      fs.writeFileSync(mediaPath, buffer);
      
      // Determine media type
      const extension = path.extname(mediaUrl).toLowerCase();
      let mediaType = 'image';
      
      if (['.mp4', '.mov', '.avi', '.webm'].includes(extension)) {
        mediaType = 'video';
      } else if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip'].includes(extension)) {
        mediaType = 'document';
      } else if (['.mp3', '.ogg', '.wav', '.m4a'].includes(extension)) {
        mediaType = 'audio';
      }
      
      // Send media
      await whatsappClient.sendMediaMessage(phoneNumber, mediaPath, formattedCaption, mediaType);
      
      // Clean up temp file
      try {
        fs.unlinkSync(mediaPath);
      } catch (cleanupError) {
        console.error(`[TicketManager:${this.instanceId}] Error cleaning up temp file:`, cleanupError);
      }
      
      return true;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error sending media to WhatsApp:`, error);
      return false;
    }
  }
  
  /**
   * Get active tickets count
   * @returns {number} - Number of active tickets
   */
  getActiveTicketsCount() {
    return this.activeTickets;
  }
}

module.exports = TicketManager;
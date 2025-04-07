// modules/managers/TicketManager.js
const { 
  ChannelType, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * Manages Discord ticket channels for WhatsApp conversations
 */
class TicketManager {
  /**
   * Create a new ticket manager
   * @param {Object} channelManager - Channel manager
   * @param {Object} discordClient - Discord client
   * @param {string} guildId - Guild ID
   * @param {string} categoryId - Category ID for tickets
   * @param {Object} options - Additional options
   */
  constructor(channelManager, discordClient, guildId, categoryId, options = {}) {
    this.channelManager = channelManager;
    this.discordClient = discordClient;
    this.guildId = guildId;
    this.categoryId = categoryId;
    this.instanceId = options.instanceId || 'default';
    
    // Set default message templates
    this.customIntroMessages = options.customIntroMessages || "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.";
    this.customCloseMessages = options.customCloseMessages || "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
    
    // Optional managers
    this.userCardManager = null;
    this.transcriptManager = null;
    
    console.log(`[TicketManager:${this.instanceId}] Initialized with category ID: ${this.categoryId}`);
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
   * Set custom intro message template
   * @param {string} message - Message template
   */
  setCustomIntroMessage(message) {
    if (message) {
      this.customIntroMessages = message;
    }
  }
  
  /**
   * Set custom close message template
   * @param {string} message - Message template
   */
  setCustomCloseMessage(message) {
    if (message) {
      this.customCloseMessages = message;
    }
  }
  
  /**
   * Create a new ticket channel
   * @param {string} name - User name
   * @param {string} phoneNumber - User phone number
   * @returns {Promise<Object>} - Created channel
   */
  async createTicket(name, phoneNumber) {
    try {
      // Get guild
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[TicketManager:${this.instanceId}] Guild not found: ${this.guildId}`);
        return null;
      }
      
      // Get category
      const category = guild.channels.cache.get(this.categoryId);
      if (!category) {
        console.error(`[TicketManager:${this.instanceId}] Category not found: ${this.categoryId}`);
        return null;
      }
      
      // Create channel name
      const cleanName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      const channelName = `${cleanName}-${phoneNumber.substring(phoneNumber.length - 4)}`;
      
      // Create channel
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: this.categoryId,
        topic: `Support ticket for ${name} | WhatsApp: ${phoneNumber}`
      });
      
      console.log(`[TicketManager:${this.instanceId}] Created ticket channel: ${channel.id} for ${name} (${phoneNumber})`);
      
      // Get previous transcript if available
      let transcriptContent = null;
      if (this.transcriptManager) {
        transcriptContent = this.transcriptManager.getLatestTranscript(phoneNumber, name);
      }
      
      // Create intro message with welcome and control buttons
      await this.sendIntroMessage(channel, name, phoneNumber, transcriptContent);
      
      return channel;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error creating ticket:`, error);
      return null;
    }
  }
  
  /**
   * Send intro message with ticket information
   * @param {Object} channel - Discord channel
   * @param {string} name - User name
   * @param {string} phoneNumber - User phone number
   * @param {string} transcriptContent - Previous transcript content (optional)
   */
  async sendIntroMessage(channel, name, phoneNumber, transcriptContent) {
    try {
      // Format intro message
      const introMessage = this.customIntroMessages
        .replace(/{name}/g, name)
        .replace(/{phoneNumber}/g, phoneNumber);
      
      // Create control buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`close_ticket_${phoneNumber}`)
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`vouch_${phoneNumber}`)
            .setLabel('Send Vouch Instructions')
            .setStyle(ButtonStyle.Success)
        );
      
      // Create message content
      let content = introMessage;
      
      // Add transcript if available
      let files = [];
      if (transcriptContent) {
        // Create transcript file
        const transcriptPath = path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp', `transcript-${phoneNumber}.html`);
        fs.writeFileSync(transcriptPath, transcriptContent, 'utf8');
        
        // Add file to message
        files.push(new AttachmentBuilder(transcriptPath, { name: 'previous-transcript.html' }));
        
        // Add note about previous conversation
        content += '\n\n**Previous conversation transcript attached.**';
      }
      
      // Send message
      await channel.send({ 
        content, 
        components: [row],
        files
      });
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error sending intro message:`, error);
    }
  }
  
  /**
   * Close a ticket
   * @param {string} channelId - Channel ID to close
   * @param {string} closedBy - User who closed the ticket
   * @returns {Promise<boolean>} - Success status
   */
  async closeTicket(channelId, closedBy) {
    try {
      // Get guild and channel
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[TicketManager:${this.instanceId}] Guild not found: ${this.guildId}`);
        return false;
      }
      
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        console.error(`[TicketManager:${this.instanceId}] Channel not found: ${channelId}`);
        return false;
      }
      
      // Get phone number from channel manager
      const phoneNumber = this.channelManager.getJidForChannelId(channelId);
      if (!phoneNumber) {
        console.error(`[TicketManager:${this.instanceId}] No phone number found for channel: ${channelId}`);
        return false;
      }
      
      // Get user name
      let name = 'User';
      if (this.userCardManager) {
        const userCard = this.userCardManager.getUserCard(phoneNumber);
        if (userCard && userCard.name) {
          name = userCard.name;
        }
      }
      
      // Create closure notification for Discord
      await channel.send({
        content: `Ticket closed by ${closedBy}. Saving transcript and notifying user...`
      });
      
      // Create WhatsApp closure notification
      if (phoneNumber) {
        // Format close message
        const closeMessage = this.customCloseMessages
          .replace(/{name}/g, name)
          .replace(/{phoneNumber}/g, phoneNumber);
        
        // Send close message to WhatsApp
        const whatsappHandler = this.getWhatsAppHandler();
        if (whatsappHandler) {
          await whatsappHandler.sendMessageToWhatsApp(phoneNumber, closeMessage);
        }
      }
      
      // Create transcript if manager available
      if (this.transcriptManager && !this.transcriptManager.isDisabled) {
        await this.transcriptManager.createTranscript(channel, phoneNumber, name);
      }
      
      // Remove channel mapping
      this.channelManager.removeChannel(phoneNumber);
      
      // Archive the channel
      await channel.setArchived(true, 'Ticket closed');
      
      console.log(`[TicketManager:${this.instanceId}] Closed ticket channel: ${channelId} for ${name} (${phoneNumber})`);
      return true;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error closing ticket:`, error);
      return false;
    }
  }
  
  /**
   * Send a WhatsApp message from Discord
   * @param {string} channelId - Channel ID message is from
   * @param {string} content - Message content
   * @param {Object} author - Message author
   * @param {Array} attachments - Message attachments
   * @returns {Promise<boolean>} - Success status
   */
  async sendWhatsAppMessageFromDiscord(channelId, content, author, attachments) {
    try {
      // Get phone number from channel manager
      const phoneNumber = this.channelManager.getJidForChannelId(channelId);
      if (!phoneNumber) {
        console.error(`[TicketManager:${this.instanceId}] No phone number found for channel: ${channelId}`);
        return false;
      }
      
      // Get WhatsApp handler
      const whatsappHandler = this.getWhatsAppHandler();
      if (!whatsappHandler) {
        console.error(`[TicketManager:${this.instanceId}] No WhatsApp handler available`);
        return false;
      }
      
      // Format message with author name
      const formattedMessage = `*${author.displayName || author.username}:* ${content}`;
      
      // Check if there are attachments
      if (attachments && attachments.size > 0) {
        // Process the first attachment
        const attachment = attachments.first();
        
        // Download the attachment
        const response = await fetch(attachment.url);
        const buffer = await response.arrayBuffer();
        
        // Save to temp file
        const tempDir = path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempFilePath = path.join(tempDir, attachment.name);
        fs.writeFileSync(tempFilePath, Buffer.from(buffer));
        
        // Send with attachment
        await whatsappHandler.sendMessageToWhatsApp(phoneNumber, formattedMessage, tempFilePath);
      } else {
        // Send text only
        await whatsappHandler.sendMessageToWhatsApp(phoneNumber, formattedMessage);
      }
      
      return true;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error sending WhatsApp message from Discord:`, error);
      return false;
    }
  }
  
  /**
   * Send a WhatsApp message to Discord
   * @param {string} channelId - Channel ID to send to
   * @param {string} content - Message content
   * @param {string} displayName - User display name
   * @param {string} phoneNumber - User phone number
   * @param {string} mediaUrl - Media URL (optional)
   * @returns {Promise<Object>} - Sent message
   */
  async sendWhatsAppMessage(channelId, content, displayName, phoneNumber, mediaUrl = null) {
    try {
      // Get guild and channel
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
      
      // Create message content
      const formattedContent = `**${displayName || 'User'}**: ${content}`;
      
      // Check if there's media
      if (mediaUrl) {
        // Send with attachment
        return await channel.send({ 
          content: formattedContent,
          files: [mediaUrl]
        });
      } else {
        // Send text only
        return await channel.send({ content: formattedContent });
      }
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error sending WhatsApp message to Discord:`, error);
      return null;
    }
  }
  
  /**
   * Get WhatsApp handler from channel manager
   * @returns {Object|null} - WhatsApp handler or null
   */
  getWhatsAppHandler() {
    try {
      // Try to get handler from channel manager or instance
      if (this.channelManager && this.channelManager.whatsAppClient) {
        return this.channelManager.whatsAppHandler;
      }
      
      // Try global instance manager
      const InstanceManager = require('../../core/InstanceManager');
      const instance = InstanceManager.getInstanceByGuildId(this.guildId);
      
      if (instance && instance.handlers && instance.handlers.whatsAppHandler) {
        return instance.handlers.whatsAppHandler;
      }
      
      return null;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error getting WhatsApp handler:`, error);
      return null;
    }
  }
}

module.exports = TicketManager;
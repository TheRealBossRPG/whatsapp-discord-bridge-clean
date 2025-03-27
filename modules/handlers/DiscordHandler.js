// modules/handlers/DiscordHandler.js - FIXED VERSION
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Handler for Discord messages and interactions
 */
class DiscordHandler {
  /**
   * Create a new Discord handler
   * @param {Object} discordClient - Discord client
   * @param {string} categoryId - Category ID for tickets
   * @param {Object} channelManager - Channel manager
   * @param {Object} userCardManager - User card manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} options - Additional options
   */
  constructor(
    discordClient,
    categoryId,
    channelManager,
    userCardManager,
    ticketManager,
    transcriptManager,
    whatsAppClient,
    options = {}
  ) {
    this.discordClient = discordClient;
    this.categoryId = categoryId;
    this.channelManager = channelManager;
    this.userCardManager = userCardManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.whatsAppClient = whatsAppClient;
    
    // Store options
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    this.assetsDir = options.assetsDir || path.join(__dirname, '..', '..', 'assets');
    
    // Message queue to prevent race conditions
    this.messageQueue = new Map();
    
    // Optional vouch handler
    this.vouchHandler = null;
    
    // Custom messages
    this.customCloseMessage = null;
    
    // Create directories if they don't exist
    [this.tempDir, this.assetsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    console.log(`[DiscordHandler:${this.instanceId}] Initialized for category ${categoryId}`);
  }
  
  /**
   * Process a message through the queue to prevent race conditions
   * @param {string} channelId - Channel ID
   * @param {Function} processFunction - Function to process the message
   */
  async queueMessageProcessing(channelId, processFunction) {
    // Create queue for this channel if it doesn't exist
    if (!this.messageQueue.has(channelId)) {
      this.messageQueue.set(channelId, Promise.resolve());
    }
    
    // Add this message processing to the queue
    const queuePromise = this.messageQueue.get(channelId).then(async () => {
      try {
        await processFunction();
      } catch (error) {
        console.error(`[DiscordHandler:${this.instanceId}] Error in message processing:`, error);
      }
    });
    
    // Update the queue
    this.messageQueue.set(channelId, queuePromise);
    
    // Return the promise
    return queuePromise;
  }
  
  /**
   * Handle Discord message
   * @param {Object} message - Discord message
   */
  async handleDiscordMessage(message) {
    try {
      // Skip messages from bots or outside managed channels
      if (message.author.bot) return;
      
      // Check if the channel is a WhatsApp ticket channel
      const channelId = message.channel.id;
      const phoneNumber = this.channelManager.getPhoneNumber(channelId);
      
      if (!phoneNumber) {
        // Not a WhatsApp ticket channel
        return;
      }
      
      // Process message in the queue to prevent race conditions
      await this.queueMessageProcessing(channelId, async () => {
        // Skip commands that start with !
        if (message.content.startsWith('!')) {
          await this.handleCommand(message, phoneNumber, channelId);
          return;
        }
        
        // Get user card
        const userCard = await this.userCardManager.getUserCard(phoneNumber);
        
        if (!userCard) {
          console.warn(`[DiscordHandler:${this.instanceId}] No user card found for ${phoneNumber}`);
          await message.reply('⚠️ Error: Could not find user information for this ticket.');
          return;
        }
        
        // Prepare recipient
        let recipient = phoneNumber;
        if (!recipient.includes('@')) {
          recipient = `${recipient.replace(/[^0-9+]/g, '')}@s.whatsapp.net`;
        }
        
        // Forward message content
        if (message.content) {
          try {
            await this.whatsAppClient.sendMessage(recipient, message.content);
          } catch (error) {
            console.error(`[DiscordHandler:${this.instanceId}] Error sending message to WhatsApp:`, error);
            await message.reply('⚠️ Error sending message to WhatsApp. Please try again.');
            return;
          }
        }
        
        // Forward attachments
        for (const attachment of message.attachments.values()) {
          try {
            // Download attachment to temp directory
            const tempFilePath = await this.downloadAttachment(attachment);
            
            // Send attachment to WhatsApp
            if (tempFilePath) {
              await this.sendAttachmentToWhatsApp(
                recipient,
                tempFilePath,
                message.content || ''
              );
              
              // Delete temp file
              try {
                fs.unlinkSync(tempFilePath);
              } catch (unlinkError) {
                console.warn(`[DiscordHandler:${this.instanceId}] Error deleting temp file:`, unlinkError);
              }
            }
          } catch (attachmentError) {
            console.error(`[DiscordHandler:${this.instanceId}] Error sending attachment to WhatsApp:`, attachmentError);
            await message.reply('⚠️ Error sending attachment to WhatsApp.');
          }
        }
        
        // React to confirm the message was sent
        try {
          await message.react('✅');
        } catch (reactError) {
          console.warn(`[DiscordHandler:${this.instanceId}] Error adding reaction to message:`, reactError);
        }
      });
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling Discord message:`, error);
    }
  }
  
  /**
   * Handle Discord command
   * @param {Object} message - Discord message
   * @param {string} phoneNumber - Phone number
   * @param {string} channelId - Channel ID
   */
  async handleCommand(message, phoneNumber, channelId) {
    try {
      const command = message.content.trim().toLowerCase();
      
      if (command === '!close') {
        await this.handleCloseCommand(message, phoneNumber, channelId);
      } else if (command === '!vouch') {
        await this.handleVouchCommand(message, phoneNumber, channelId);
      } else if (command === '!rename') {
        await this.handleRenameCommand(message, phoneNumber, channelId);
      } else if (command === '!status') {
        await this.handleStatusCommand(message, phoneNumber, channelId);
      } else if (command === '!help') {
        await this.handleHelpCommand(message);
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling command:`, error);
      await message.reply('⚠️ Error processing command. Please try again.');
    }
  }
  
  /**
   * Handle !close command
   * @param {Object} message - Discord message
   * @param {string} phoneNumber - Phone number
   * @param {string} channelId - Channel ID
   */
  async handleCloseCommand(message, phoneNumber, channelId) {
    try {
      // Get user card
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      
      if (!userCard) {
        await message.reply('⚠️ Error: Could not find user information for this ticket.');
        return;
      }
      
      // Send closing message to WhatsApp if enabled
      if (this.customCloseMessage) {
        // Prepare recipient
        let recipient = phoneNumber;
        if (!recipient.includes('@')) {
          recipient = `${recipient.replace(/[^0-9+]/g, '')}@s.whatsapp.net`;
        }
        
        // Format closing message
        let closingMessage = this.customCloseMessage;
        if (userCard.name) {
          closingMessage = closingMessage.replace(/{name}/g, userCard.name);
        }
        closingMessage = closingMessage.replace(/{phoneNumber}/g, phoneNumber);
        
        // Send message
        try {
          await this.whatsAppClient.sendMessage(recipient, closingMessage);
        } catch (sendError) {
          console.error(`[DiscordHandler:${this.instanceId}] Error sending closing message:`, sendError);
        }
      }
      
      // First reply to the command message
      await message.reply('Closing this ticket and saving transcript...');
      
      // Then close the ticket
      const closeResult = await this.ticketManager.closeTicket(channelId, phoneNumber, userCard.name);
      
      if (!closeResult) {
        await message.reply('⚠️ Error closing ticket. Please try again or contact an administrator.');
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling close command:`, error);
      await message.reply('⚠️ Error closing ticket. Please try again.');
    }
  }
  
  /**
   * Handle !vouch command
   * @param {Object} message - Discord message
   * @param {string} phoneNumber - Phone number
   * @param {string} channelId - Channel ID
   */
  async handleVouchCommand(message, phoneNumber, channelId) {
    try {
      // Check if vouch handler exists
      if (!this.vouchHandler) {
        await message.reply('❌ Vouch system is not enabled for this server.');
        return;
      }
      
      // Get user card
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      
      if (!userCard) {
        await message.reply('⚠️ Error: Could not find user information for this ticket.');
        return;
      }
      
      // Send vouch instructions to WhatsApp
      const success = await this.vouchHandler.sendVouchInstructions(phoneNumber, userCard.name);
      
      if (success) {
        await message.reply('✅ Vouch instructions sent to WhatsApp user.');
      } else {
        await message.reply('⚠️ Error sending vouch instructions. Please try again.');
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling vouch command:`, error);
      await message.reply('⚠️ Error sending vouch instructions. Please try again.');
    }
  }
  
  /**
   * Handle !rename command
   * @param {Object} message - Discord message
   * @param {string} phoneNumber - Phone number
   * @param {string} channelId - Channel ID
   */
  async handleRenameCommand(message, phoneNumber, channelId) {
    try {
      // Extract new name from message
      const parts = message.content.split(' ');
      
      // Check if new name is provided
      if (parts.length < 2) {
        await message.reply('⚠️ Please provide a new name. Usage: `!rename New Name`');
        return;
      }
      
      // Get new name
      const newName = parts.slice(1).join(' ').trim();
      
      if (!newName || newName.length < 2) {
        await message.reply('⚠️ Please provide a valid name (at least 2 characters).');
        return;
      }
      
      // Update user card
      const success = await this.userCardManager.updateUserCard(phoneNumber, { name: newName });
      
      if (success) {
        await message.reply(`✅ User renamed to "${newName}"`);
      } else {
        await message.reply('⚠️ Error updating user name. Please try again.');
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling rename command:`, error);
      await message.reply('⚠️ Error updating user name. Please try again.');
    }
  }
  
  /**
   * Handle !status command
   * @param {Object} message - Discord message
   * @param {string} phoneNumber - Phone number
   * @param {string} channelId - Channel ID
   */
  async handleStatusCommand(message, phoneNumber, channelId) {
    try {
      // Get user card
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      
      if (!userCard) {
        await message.reply('⚠️ Error: Could not find user information for this ticket.');
        return;
      }
      
      // Get WhatsApp client status
      const whatsAppStatus = this.whatsAppClient && this.whatsAppClient.isReady 
        ? '🟢 Connected' 
        : '🔴 Disconnected';
      
      // Create status message
      let statusMessage = `**Ticket Status**\n\n`;
      statusMessage += `📱 User: ${userCard.name || 'Unknown'}\n`;
      statusMessage += `☎️ Phone: ${phoneNumber}\n`;
      statusMessage += `🔄 WhatsApp Status: ${whatsAppStatus}\n`;
      statusMessage += `📂 Ticket Channel: <#${channelId}>\n`;
      
      // Add vouch info if available
      if (this.vouchHandler) {
        const vouchEnabled = !this.vouchHandler.isDisabled;
        statusMessage += `⭐ Vouch System: ${vouchEnabled ? 'Enabled' : 'Disabled'}\n`;
      }
      
      // Send status message
      await message.reply(statusMessage);
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling status command:`, error);
      await message.reply('⚠️ Error getting status information.');
    }
  }
  
  /**
   * Handle !help command
   * @param {Object} message - Discord message
   */
  async handleHelpCommand(message) {
    try {
      // Create help message
      let helpMessage = `**Available Commands**\n\n`;
      helpMessage += `• \`!close\` - Close this ticket and save transcript\n`;
      helpMessage += `• \`!vouch\` - Send vouch instructions to WhatsApp user\n`;
      helpMessage += `• \`!rename [name]\` - Change the user's name\n`;
      helpMessage += `• \`!status\` - Show ticket status\n`;
      helpMessage += `• \`!help\` - Show this help message\n\n`;
      helpMessage += `Simply type a message to send it to the WhatsApp user.`;
      
      // Send help message
      await message.reply({
        content: helpMessage,
        allowedMentions: { repliedUser: false }
      });
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling help command:`, error);
      await message.reply('⚠️ Error displaying help information.');
    }
  }
  
  /**
   * Download a Discord attachment to temp directory
   * @param {Object} attachment - Discord attachment
   * @returns {Promise<string|null>} - Path to downloaded file or null if failed
   */
  async downloadAttachment(attachment) {
    try {
      // Make sure temp directory exists
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }
      
      // Get file info
      const url = attachment.url;
      const filename = attachment.name || `file-${Date.now()}`;
      const filePath = path.join(this.tempDir, filename);
      
      // Fetch file
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch attachment: ${response.status} ${response.statusText}`);
      }
      
      // Save file
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(buffer));
      
      return filePath;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error downloading attachment:`, error);
      return null;
    }
  }
  
  /**
   * Send attachment to WhatsApp
   * @param {string} recipient - Recipient JID
   * @param {string} filePath - Path to file
   * @param {string} caption - Optional caption
   * @returns {Promise<boolean>} - Success status
   */
  async sendAttachmentToWhatsApp(recipient, filePath, caption = '') {
    try {
      // Get file info
      const fileStats = fs.statSync(filePath);
      const fileSize = fileStats.size;
      
      // Check file size (WhatsApp limit is ~64MB but we'll use 60MB to be safe)
      const MAX_FILE_SIZE = 60 * 1024 * 1024; // 60MB
      
      if (fileSize > MAX_FILE_SIZE) {
        console.warn(`[DiscordHandler:${this.instanceId}] File too large (${fileSize} bytes) for WhatsApp`);
        throw new Error('File too large for WhatsApp (max 60MB)');
      }
      
      // Import MessageMedia
      const { MessageMedia } = require('whatsapp-web.js');
      
      // Create message media
      const media = MessageMedia.fromFilePath(filePath);
      
      // Send media message
      await this.whatsAppClient.sendMessage(recipient, media, { caption });
      
      return true;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error sending attachment to WhatsApp:`, error);
      throw error;
    }
  }
  
  /**
   * Handle Discord interaction
   * @param {Object} interaction - Discord interaction
   */
  async handleInteraction(interaction) {
    try {
      // Check interaction type
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalInteraction(interaction);
      } else if (interaction.isSelectMenu()) {
        await this.handleSelectMenuInteraction(interaction);
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling interaction:`, error);
      
      // Try to reply with error
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `Error: ${error.message}`,
            ephemeral: true
          });
        } else if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({
            content: `Error: ${error.message}`
          });
        } else {
          await interaction.followUp({
            content: `Error: ${error.message}`,
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error sending error message:`, replyError);
      }
    }
  }
  
  /**
   * Handle button interaction
   * @param {Object} interaction - Discord interaction
   */
  async handleButtonInteraction(interaction) {
    try {
      const customId = interaction.customId;
      
      // Add button handlers here based on customId
      if (customId.startsWith('close_ticket_')) {
        await this.handleCloseTicketButton(interaction);
      } else if (customId.startsWith('refresh_connection_')) {
        await this.handleRefreshConnectionButton(interaction);
      } else {
        console.log(`[DiscordHandler:${this.instanceId}] Unhandled button interaction: ${customId}`);
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling button interaction:`, error);
      throw error;
    }
  }
  
  /**
   * Handle close ticket button
   * @param {Object} interaction - Discord interaction
   */
  async handleCloseTicketButton(interaction) {
    try {
      await interaction.deferUpdate();
      
      // Get channel ID from button ID
      const channelId = interaction.customId.replace('close_ticket_', '');
      const channel = interaction.guild.channels.cache.get(channelId);
      
      if (!channel) {
        await interaction.followUp({
          content: '❌ Channel not found. It may have been deleted.',
          ephemeral: true
        });
        return;
      }
      
      // Get phone number for this channel
      const phoneNumber = this.channelManager.getPhoneNumber(channelId);
      
      if (!phoneNumber) {
        await interaction.followUp({
          content: '❌ Error: Could not find phone number for this ticket.',
          ephemeral: true
        });
        return;
      }
      
      // Get user card
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      
      if (!userCard) {
        await interaction.followUp({
          content: '❌ Error: Could not find user information for this ticket.',
          ephemeral: true
        });
        return;
      }
      
      // Send closing message to WhatsApp if enabled
      if (this.customCloseMessage) {
        // Prepare recipient
        let recipient = phoneNumber;
        if (!recipient.includes('@')) {
          recipient = `${recipient.replace(/[^0-9+]/g, '')}@s.whatsapp.net`;
        }
        
        // Format closing message
        let closingMessage = this.customCloseMessage;
        if (userCard.name) {
          closingMessage = closingMessage.replace(/{name}/g, userCard.name);
        }
        closingMessage = closingMessage.replace(/{phoneNumber}/g, phoneNumber);
        
        // Send message
        try {
          await this.whatsAppClient.sendMessage(recipient, closingMessage);
        } catch (sendError) {
          console.error(`[DiscordHandler:${this.instanceId}] Error sending closing message:`, sendError);
        }
      }
      
      // Close ticket
      const closeResult = await this.ticketManager.closeTicket(channelId, phoneNumber, userCard.name);
      
      if (!closeResult) {
        await interaction.followUp({
          content: '❌ Error closing ticket. Please try again or use the !close command.',
          ephemeral: true
        });
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling close ticket button:`, error);
      throw error;
    }
  }
  
  /**
   * Handle refresh connection button
   * @param {Object} interaction - Discord interaction
   */
  async handleRefreshConnectionButton(interaction) {
    try {
      await interaction.deferUpdate();
      
      // Get channel ID from button ID
      const channelId = interaction.customId.replace('refresh_connection_', '');
      
      // Notify about refresh attempt
      await interaction.editReply({
        content: '🔄 Attempting to refresh WhatsApp connection...',
        components: []
      });
      
      // Check if WhatsApp is connected
      if (!this.whatsAppClient) {
        await interaction.editReply({
          content: '❌ WhatsApp client not initialized.',
          components: []
        });
        return;
      }
      
      // Try to reconnect
      let success = false;
      
      // If client has a restore method, try that first
      if (typeof this.whatsAppClient.restoreSession === 'function') {
        success = await this.whatsAppClient.restoreSession();
      }
      
      // If restore failed or not available, try normal reconnect
      if (!success && !this.whatsAppClient.isReady) {
        const InstanceManager = require('../../core/InstanceManager');
        const instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
        
        if (instance) {
          success = await instance.connect(false);
        }
      }
      
      // Check result
      if (success && this.whatsAppClient.isReady) {
        await interaction.editReply({
          content: '✅ WhatsApp connection refreshed successfully!',
          components: []
        });
      } else {
        // Create refresh button
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('reconnect')
              .setLabel('Reconnect with QR Code')
              .setStyle(ButtonStyle.Primary)
          );
        
        await interaction.editReply({
          content: '❌ Could not refresh connection automatically. You may need to scan a QR code again.',
          components: [row]
        });
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling refresh connection button:`, error);
      throw error;
    }
  }
  
  /**
   * Handle modal interaction
   * @param {Object} interaction - Discord interaction
   */
  async handleModalInteraction(interaction) {
    try {
      const customId = interaction.customId;
      
      // Add modal handlers here based on customId
      console.log(`[DiscordHandler:${this.instanceId}] Unhandled modal interaction: ${customId}`);
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling modal interaction:`, error);
      throw error;
    }
  }
  
  /**
   * Handle select menu interaction
   * @param {Object} interaction - Discord interaction
   */
  async handleSelectMenuInteraction(interaction) {
    try {
      const customId = interaction.customId;
      
      // Add select menu handlers here based on customId
      console.log(`[DiscordHandler:${this.instanceId}] Unhandled select menu interaction: ${customId}`);
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling select menu interaction:`, error);
      throw error;
    }
  }
}

module.exports = DiscordHandler;
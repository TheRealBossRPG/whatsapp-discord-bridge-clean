// modules/handlers/DiscordHandler.js
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');

/**
 * Handler for Discord messages and interactions
 */
class DiscordHandler {
  /**
   * Create a new Discord handler
   * @param {Object} discordClient - Discord client
   * @param {string} categoryId - Category ID
   * @param {Object} channelManager - Channel manager
   * @param {Object} userCardManager - User card manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} options - Additional options
   */
  constructor(discordClient, categoryId, channelManager, userCardManager, ticketManager, transcriptManager, whatsAppClient, options = {}) {
    this.discordClient = discordClient;
    this.categoryId = categoryId;
    this.channelManager = channelManager;
    this.userCardManager = userCardManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.whatsAppClient = whatsAppClient;
    
    // Optional components
    this.vouchHandler = null;
    
    // Set instance ID
    this.instanceId = options.instanceId || 'default';
    
    // Set paths
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    this.assetsDir = options.assetsDir || path.join(__dirname, '..', '..', 'assets');
    
    // Command prefixes
    this.prefixes = ['!', '/'];
    
    // Custom messages
    this.customCloseMessage = null;
    
    // Setup route in Discord client
    this.setupRoutes();
    
    console.log(`[DiscordHandler:${this.instanceId}] Initialized for category ${categoryId}`);
  }
  
  /**
   * Set up Discord client routes
   */
  setupRoutes() {
    try {
      // Initialize routes if needed
      if (!this.discordClient._instanceRoutes) {
        this.discordClient._instanceRoutes = new Map();
      }
      
      // Add this handler to the routes
      this.discordClient._instanceRoutes.set(this.categoryId, {
        handler: this,
        instance: { 
          instanceId: this.instanceId,
          categoryId: this.categoryId,
          discordHandler: this
        }
      });
      
      console.log(`[DiscordHandler:${this.instanceId}] Route set up for category ${this.categoryId}`);
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error setting up routes:`, error);
    }
  }
  
  /**
   * Handle Discord message
   * @param {Object} message - Discord message
   */
  async handleDiscordMessage(message) {
    try {
      // Skip bot messages
      if (message.author.bot) return;
      
      // Skip DMs
      if (!message.guild) return;
      
      // Check if the channel is in the right category
      if (message.channel.parentId !== this.categoryId) return;
      
      // Get phone number from channel
      const phoneNumber = this.channelManager.getPhoneNumber(message.channel.id);
      
      if (!phoneNumber) {
        console.log(`[DiscordHandler:${this.instanceId}] No phone number found for channel ${message.channel.id}`);
        return;
      }
      
      // Check for commands
      if (this.isCommand(message.content)) {
        await this.handleCommand(message, phoneNumber);
        return;
      }
      
      // Regular message - forward to WhatsApp
      await this.forwardMessageToWhatsApp(message, phoneNumber);
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling Discord message:`, error);
    }
  }
  
  /**
   * Handle Discord interaction
   * @param {Object} interaction - Discord interaction
   */
  async handleInteraction(interaction) {
    try {
      // Only handle ticket-related interactions in the target category
      if (interaction.channel && interaction.channel.parentId !== this.categoryId) return;
      
      // Handle by type
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      } else if (interaction.isSelectMenu()) {
        await this.handleSelectMenuInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalSubmit(interaction);
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling Discord interaction:`, error);
    }
  }
  
  /**
   * Handle button interaction
   * @param {Object} interaction - Button interaction
   */
  async handleButtonInteraction(interaction) {
    try {
      // Get custom ID
      const customId = interaction.customId;
      
      // Handle ticket closing
      if (customId === 'close_ticket') {
        await this.handleCloseTicket(interaction);
      } else if (customId === 'cancel_close') {
        await this.handleCancelClose(interaction);
      } else if (customId === 'confirm_close') {
        await this.handleConfirmClose(interaction);
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling button interaction:`, error);
    }
  }
  
  /**
   * Handle select menu interaction
   * @param {Object} interaction - Select menu interaction
   */
  async handleSelectMenuInteraction(interaction) {
    try {
      // Not implemented
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling select menu interaction:`, error);
    }
  }
  
  /**
   * Handle modal submit
   * @param {Object} interaction - Modal submit interaction
   */
  async handleModalSubmit(interaction) {
    try {
      // Not implemented
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling modal submit:`, error);
    }
  }
  
  /**
   * Forward Discord message to WhatsApp
   * @param {Object} message - Discord message
   * @param {string} phoneNumber - Recipient phone number
   */
  async forwardMessageToWhatsApp(message, phoneNumber) {
    try {
      // Check if we have a WhatsApp client
      if (!this.whatsAppClient) {
        console.error(`[DiscordHandler:${this.instanceId}] No WhatsApp client available`);
        return;
      }
      
      // Get sender name
      const senderName = message.member?.nickname || message.author.username;
      
      // Get message content
      const content = message.content.trim();
      
      // Check if empty
      if (!content && message.attachments.size === 0) {
        console.log(`[DiscordHandler:${this.instanceId}] Empty message, not forwarding`);
        return;
      }
      
      // Handle attachments
      if (message.attachments.size > 0) {
        // Get the first attachment
        const attachment = message.attachments.first();
        
        // Forward media
        await this.ticketManager.sendMediaToWhatsApp(
          phoneNumber,
          attachment.url,
          content,
          senderName
        );
        
        // React to indicate success
        await message.react('✅');
        return;
      }
      
      // Forward text message
      await this.ticketManager.sendReplyToWhatsApp(
        phoneNumber,
        content,
        senderName
      );
      
      // React to indicate success
      await message.react('✅');
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error forwarding message to WhatsApp:`, error);
      
      // React to indicate failure
      try {
        await message.react('❌');
      } catch (reactError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error adding reaction:`, reactError);
      }
    }
  }
  
  /**
   * Check if message is a command
   * @param {string} content - Message content
   * @returns {boolean} - Whether message is a command
   */
  isCommand(content) {
    if (!content) return false;
    
    // Check for prefixes
    for (const prefix of this.prefixes) {
      if (content.startsWith(prefix)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Handle command
   * @param {Object} message - Discord message
   * @param {string} phoneNumber - Phone number
   */
  async handleCommand(message, phoneNumber) {
    try {
      // Get command parts
      const parts = message.content.split(' ');
      const commandWithPrefix = parts[0].toLowerCase();
      const command = commandWithPrefix.substring(1);
      
      console.log(`[DiscordHandler:${this.instanceId}] Processing command: ${command}`);
      
      // Handle based on command
      switch (command) {
        case 'close':
          await this.showCloseConfirmation(message, phoneNumber);
          break;
        case 'vouch':
          await this.sendVouchRequest(message, phoneNumber);
          break;
        case 'help':
          await this.showHelp(message);
          break;
        default:
          // Unknown command
          await message.reply(`Unknown command: ${command}. Use \`!help\` for available commands.`);
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling command:`, error);
      
      try {
        await message.reply(`Error executing command: ${error.message}`);
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error replying:`, replyError);
      }
    }
  }
  
  /**
   * Show ticket close confirmation
   * @param {Object} message - Discord message
   * @param {string} phoneNumber - Phone number
   */
  async showCloseConfirmation(message, phoneNumber) {
    try {
      // Create confirmation buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('confirm_close')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('cancel_close')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0xF44336)
        .setTitle('Close Ticket')
        .setDescription('Are you sure you want to close this ticket? This will:')
        .addFields(
          { name: 'Send Message', value: 'A goodbye message will be sent to the user' },
          { name: 'Save Transcript', value: 'A transcript of this conversation will be saved' },
          { name: 'Delete Channel', value: 'This channel will be deleted' }
        );
      
      // Send confirmation message
      await message.reply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error showing close confirmation:`, error);
      
      try {
        await message.reply(`Error showing confirmation: ${error.message}`);
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error replying:`, replyError);
      }
    }
  }
  
  /**
   * Handle close ticket button
   * @param {Object} interaction - Button interaction
   */
  async handleCloseTicket(interaction) {
    try {
      await interaction.deferUpdate();
      
      // Show confirmation dialog
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('confirm_close')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('cancel_close')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0xF44336)
        .setTitle('Close Ticket')
        .setDescription('Are you sure you want to close this ticket? This will:')
        .addFields(
          { name: 'Send Message', value: 'A goodbye message will be sent to the user' },
          { name: 'Save Transcript', value: 'A transcript of this conversation will be saved' },
          { name: 'Delete Channel', value: 'This channel will be deleted' }
        );
      
      // Send confirmation message
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling close ticket:`, error);
      
      try {
        await interaction.editReply(`Error showing confirmation: ${error.message}`);
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error replying:`, replyError);
      }
    }
  }
  
  /**
   * Handle cancel close button
   * @param {Object} interaction - Button interaction
   */
  async handleCancelClose(interaction) {
    try {
      await interaction.update({
        content: 'Ticket closing cancelled.',
        embeds: [],
        components: []
      });
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling cancel close:`, error);
    }
  }
  
  /**
   * Handle confirm close button
   * @param {Object} interaction - Button interaction
   */
  async handleConfirmClose(interaction) {
    try {
      await interaction.deferUpdate();
      
      // Update message
      await interaction.editReply({
        content: 'Closing ticket...',
        embeds: [],
        components: []
      });
      
      // Get phone number from channel
      const phoneNumber = this.channelManager.getPhoneNumber(interaction.channel.id);
      
      if (!phoneNumber) {
        await interaction.editReply('Error: Could not find associated phone number for this channel.');
        return;
      }
      
      // Close the ticket
      const success = await this.ticketManager.closeTicket(
        phoneNumber,
        interaction.user.username,
        true  // Send closing message
      );
      
      if (!success) {
        await interaction.editReply('Error closing ticket. Please try again.');
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling confirm close:`, error);
      
      try {
        await interaction.editReply(`Error closing ticket: ${error.message}`);
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error replying:`, replyError);
      }
    }
  }
  
  /**
   * Send vouch request
   * @param {Object} message - Discord message
   * @param {string} phoneNumber - Phone number
   */
  async sendVouchRequest(message, phoneNumber) {
    try {
      if (!this.vouchHandler) {
        await message.reply('Vouch system is not configured.');
        return;
      }
      
      // Get user name
      let userName = "Customer";
      
      if (this.userCardManager) {
        const userCard = await this.userCardManager.getUserCard(phoneNumber);
        if (userCard) {
          userName = userCard.name;
        }
      }
      
      // Send vouch request
      const success = await this.vouchHandler.sendVouchRequest(phoneNumber);
      
      if (success) {
        await message.reply(`✅ Vouch request sent to ${userName}!`);
      } else {
        await message.reply(`❌ Failed to send vouch request to ${userName}. Is WhatsApp connected?`);
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error sending vouch request:`, error);
      
      try {
        await message.reply(`Error sending vouch request: ${error.message}`);
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error replying:`, replyError);
      }
    }
  }
  
  /**
   * Show help message
   * @param {Object} message - Discord message
   */
  async showHelp(message) {
    try {
      const embed = new EmbedBuilder()
        .setColor(0x4CAF50)
        .setTitle('Available Commands')
        .setDescription('Here are the commands you can use in this ticket channel:')
        .addFields(
          { name: '!close', value: 'Close this ticket and save transcript' },
          { name: '!vouch', value: 'Send a request to the customer to leave a vouch' },
          { name: '!help', value: 'Show this help message' }
        )
        .setFooter({ text: 'Just type a message to reply to the customer' });
      
      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error showing help:`, error);
      
      try {
        await message.reply(`Error showing help: ${error.message}`);
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error replying:`, replyError);
      }
    }
  }
}

module.exports = DiscordHandler;
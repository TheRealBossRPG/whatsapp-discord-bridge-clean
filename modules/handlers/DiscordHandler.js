// modules/handlers/DiscordHandler.js
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Handles Discord interactions and messages
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
  constructor(discordClient, categoryId, channelManager, userCardManager, ticketManager, transcriptManager, whatsAppClient, options = {}) {
    this.discordClient = discordClient;
    this.categoryId = categoryId;
    this.channelManager = channelManager;
    this.userCardManager = userCardManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.whatsAppClient = whatsAppClient;
    
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    this.assetsDir = options.assetsDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'assets');
    
    // Optional vouch handler reference
    this.vouchHandler = null;
    
    // Custom close message
    this.customCloseMessage = "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
    
    // Create directories if they don't exist
    for (const dir of [this.tempDir, this.assetsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    console.log(`[DiscordHandler:${this.instanceId}] Initialized for category ${this.categoryId}`);
  }
  
  /**
   * Handle Discord interaction
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success status
   */
  async handleInteraction(interaction) {
    try {
      // Handle button interactions
      if (interaction.isButton()) {
        return await this.handleButtonInteraction(interaction);
      }
      
      // Handle modal submissions
      if (interaction.isModalSubmit()) {
        return await this.handleModalSubmit(interaction);
      }
      
      // Handle command interactions
      if (interaction.isCommand()) {
        return await this.handleCommandInteraction(interaction);
      }
      
      return false;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling interaction:`, error);
      
      // Try to reply with error
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `Error processing interaction: ${error.message}`,
            ephemeral: true
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: `Error processing interaction: ${error.message}`
          });
        } else {
          await interaction.followUp({
            content: `Error processing interaction: ${error.message}`,
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error sending error reply:`, replyError);
      }
      
      return false;
    }
  }
  
  /**
   * Handle button interactions
   * @param {Object} interaction - Button interaction
   * @returns {Promise<boolean>} - Success status
   */
  async handleButtonInteraction(interaction) {
    try {
      const { customId } = interaction;
      
      // Handle close ticket buttons
      if (customId.startsWith('close_ticket_')) {
        // Extract phone number from custom ID
        const phoneNumber = customId.replace('close_ticket_', '');
        
        // Acknowledge interaction
        await interaction.deferUpdate();
        
        // Close the ticket
        await this.ticketManager.closeTicket(
          interaction.channelId,
          interaction.user.username
        );
        
        return true;
      }
      
      // Handle vouch buttons
      if (customId.startsWith('vouch_')) {
        // Extract phone number from custom ID
        const phoneNumber = customId.replace('vouch_', '');
        
        // Acknowledge interaction
        await interaction.deferUpdate();
        
        // Use the vouch handler if available
        if (this.vouchHandler) {
          // Get user info
          const userCard = this.userCardManager.getUserCard(phoneNumber);
          
          // Try to send vouch instructions
          await this.vouchHandler.sendVouchInstructions(phoneNumber, userCard);
          
          // Notify discord
          await interaction.channel.send({
            content: `✅ Vouch instructions sent to ${userCard?.name || 'user'}`
          });
        } else {
          await interaction.channel.send({
            content: `❌ Vouch handler not available`
          });
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling button interaction:`, error);
      return false;
    }
  }
  
  /**
   * Handle modal submissions
   * @param {Object} interaction - Modal interaction
   * @returns {Promise<boolean>} - Success status
   */
  async handleModalSubmit(interaction) {
    try {
      // Implement any modal handling here if needed
      return false;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling modal submit:`, error);
      return false;
    }
  }
  
  /**
   * Handle command interactions
   * @param {Object} interaction - Command interaction
   * @returns {Promise<boolean>} - Success status
   */
  async handleCommandInteraction(interaction) {
    try {
      const { commandName } = interaction;
      
      // Handle close command
      if (commandName === 'close') {
        // Defer reply
        await interaction.deferReply();
        
        // Check if this is a ticket channel
        if (!this.channelManager.isChannelMapped(interaction.channelId)) {
          await interaction.editReply({
            content: '❌ This is not a WhatsApp ticket channel'
          });
          return true;
        }
        
        // Close the ticket
        await this.ticketManager.closeTicket(
          interaction.channelId,
          interaction.user.username
        );
        
        await interaction.editReply({
          content: '✅ Ticket closed and user notified'
        });
        
        return true;
      }
      
      // Handle vouch command
      if (commandName === 'vouch') {
        // Defer reply
        await interaction.deferReply();
        
        // Check if this is a ticket channel
        if (!this.channelManager.isChannelMapped(interaction.channelId)) {
          await interaction.editReply({
            content: '❌ This is not a WhatsApp ticket channel'
          });
          return true;
        }
        
        // Get phone number from channel
        const phoneNumber = this.channelManager.getJidForChannelId(interaction.channelId);
        
        // Use the vouch handler if available
        if (this.vouchHandler) {
          // Get user info
          const userCard = this.userCardManager.getUserCard(phoneNumber);
          
          // Try to send vouch instructions
          await this.vouchHandler.sendVouchInstructions(phoneNumber, userCard);
          
          await interaction.editReply({
            content: `✅ Vouch instructions sent to ${userCard?.name || 'user'}`
          });
        } else {
          await interaction.editReply({
            content: `❌ Vouch handler not available`
          });
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling command interaction:`, error);
      return false;
    }
  }
  
  /**
   * Handle Discord message
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success status
   */
  async handleDiscordMessage(message) {
    try {
      // Skip if not in a ticket channel or from a bot (except our own for commands)
      if (message.author.bot && message.author.id !== this.discordClient.user.id) {
        return false;
      }
      
      // Check if this is a category channel
      if (message.channel.parentId !== this.categoryId) {
        return false;
      }
      
      // Handle bot commands
      if (message.content.startsWith('!') && message.author.id !== this.discordClient.user.id) {
        return await this.handleBotCommand(message);
      }
      
      // Skip system messages
      if (message.system) {
        return false;
      }
      
      // Skip messages from our bot
      if (message.author.id === this.discordClient.user.id) {
        return false;
      }
      
      // Check if this channel is mapped to a WhatsApp chat
      if (!this.channelManager.isChannelMapped(message.channelId)) {
        return false;
      }
      
      // Forward message to WhatsApp
      return await this.ticketManager.sendWhatsAppMessageFromDiscord(
        message.channelId,
        message.content,
        message.author,
        message.attachments
      );
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling Discord message:`, error);
      return false;
    }
  }
  
  /**
   * Handle bot commands
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success status
   */
  async handleBotCommand(message) {
    try {
      const command = message.content.split(' ')[0].substring(1).toLowerCase();
      
      // Handle close command
      if (command === 'close') {
        // Check if this is a ticket channel
        if (!this.channelManager.isChannelMapped(message.channelId)) {
          await message.reply({
            content: '❌ This is not a WhatsApp ticket channel'
          });
          return true;
        }
        
        // Close the ticket
        await this.ticketManager.closeTicket(
          message.channelId,
          message.author.username
        );
        
        return true;
      }
      
      // Handle vouch command
      if (command === 'vouch') {
        // Check if this is a ticket channel
        if (!this.channelManager.isChannelMapped(message.channelId)) {
          await message.reply({
            content: '❌ This is not a WhatsApp ticket channel'
          });
          return true;
        }
        
        // Get phone number from channel
        const phoneNumber = this.channelManager.getJidForChannelId(message.channelId);
        
        // Use the vouch handler if available
        if (this.vouchHandler) {
          // Get user info
          const userCard = this.userCardManager.getUserCard(phoneNumber);
          
          // Try to send vouch instructions
          await this.vouchHandler.sendVouchInstructions(phoneNumber, userCard);
          
          await message.reply({
            content: `✅ Vouch instructions sent to ${userCard?.name || 'user'}`
          });
        } else {
          await message.reply({
            content: `❌ Vouch handler not available`
          });
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling bot command:`, error);
      return false;
    }
  }
}

module.exports = DiscordHandler;
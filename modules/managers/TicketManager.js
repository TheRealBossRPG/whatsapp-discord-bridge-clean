// modules/managers/TicketManager.js
const { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const fs = require('fs');

/**
 * Manages Discord support tickets
 */
class TicketManager {
  /**
   * Create ticket manager
   * @param {Object} channelManager - Channel manager
   * @param {Object} discordClient - Discord client
   * @param {string} guildId - Guild ID
   * @param {string} categoryId - Category ID
   * @param {Object} options - Options
   */
  constructor(channelManager, discordClient, guildId, categoryId, options = {}) {
    this.channelManager = channelManager;
    this.discordClient = discordClient;
    this.guildId = guildId;
    this.categoryId = categoryId;
    this.userCardManager = null;
    this.transcriptManager = null;
    this.instanceId = options.instanceId || 'default';
    this.customIntroMessage = options.customIntroMessages || null;
    this.customCloseMessage = options.customCloseMessages || null;
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
   * Set custom intro message
   * @param {string} message - Custom intro message
   */
  setCustomIntroMessage(message) {
    this.customIntroMessage = message;
  }
  
  /**
   * Set custom close message
   * @param {string} message - Custom close message
   */
  setCustomCloseMessage(message) {
    this.customCloseMessage = message;
  }
  
  /**
   * Get current intro message
   * @returns {string} - Intro message
   */
  getIntroMessage() {
    return this.customIntroMessage || 
      "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.";
  }
  
  /**
   * Get current close message
   * @returns {string} - Close message
   */
  getCloseMessage() {
    return this.customCloseMessage || 
      "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
  }
  
  /**
   * Create a new ticket
   * @param {string} phoneNumber - Phone number
   * @param {string} username - Username
   * @returns {Promise<Object>} - Created channel
   */
  async createTicket(phoneNumber, username) {
    try {
      // Check if inputs are valid
      if (!phoneNumber || !username) {
        console.error(`[TicketManager:${this.instanceId}] Invalid phone number or username: ${phoneNumber}, ${username}`);
        return null;
      }

      // Get the guild by ID
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[TicketManager:${this.instanceId}] Guild not found: ${this.guildId}`);
        return null;
      }

      // Get the category by ID
      const category = guild.channels.cache.get(this.categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        console.error(`[TicketManager:${this.instanceId}] Category not found or invalid: ${this.categoryId}`);
        return null;
      }

      // Clean phone number and format username for channel name
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const formattedUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 25);
      
      // Create channel name with clipboard emoji and username
      const channelName = `📋-${formattedUsername}`;

      // Create channel
      console.log(`[TicketManager:${this.instanceId}] Creating ticket channel: ${channelName}`);
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          // Default permissions for everyone
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          // Bot permissions
          {
            id: guild.members.me.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageMessages,
              PermissionsBitField.Flags.EmbedLinks,
              PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.AddReactions,
              PermissionsBitField.Flags.UseExternalEmojis,
              PermissionsBitField.Flags.ManageChannels,
            ],
          }
        ],
      });

      // Map channel to phone number in channel manager
      await this.channelManager.addChannelMapping(cleanPhone, channel.id);

      // Get intro message template
      let introMessage = this.getIntroMessage();
      
      // Replace placeholders
      introMessage = introMessage
        .replace(/{name}/g, username)
        .replace(/{phoneNumber}/g, phoneNumber);

      // Check for previous transcripts
      let previousTranscript = null;
      if (this.transcriptManager) {
        previousTranscript = await this.getLatestTranscript(username, phoneNumber);
      }

      // Create ticket info embed
      const ticketInfoEmbed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle('Ticket Information')
        .setDescription('```\nUsername        Phone Number\n' + 
                      `${username.padEnd(15)} ${phoneNumber.replace(/@.*$/, '')}\n\n` +
                      'Notes\n' +
                      'No notes provided yet. Use the Edit button to add details.\n' +
                      `Opened Ticket • Today at ${new Date().toLocaleTimeString()}\n` +
                      '```')
        .setTimestamp();

      // Edit buttons
      const editRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`edit_ticket_info_${cleanPhone}`)
          .setLabel('Edit')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Close')
          .setStyle(ButtonStyle.Danger)
      );

      // Send messages to the new channel
      await channel.send({ content: introMessage });

      // If there's a previous transcript, send it
      if (previousTranscript) {
        const transcriptEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Previous Conversation')
          .setDescription('This transcript contains the previous conversation history:');

        await channel.send({ embeds: [transcriptEmbed], files: [previousTranscript] });
      }

      // Send the transcript message
      await channel.send({ 
        content: '📝 Transcript',
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setDescription('All messages in this channel will be included in the ticket transcript.')
        ]
      });

      // Send the ticket info embed
      await channel.send({ 
        embeds: [ticketInfoEmbed], 
        components: [editRow] 
      });

      console.log(`[TicketManager:${this.instanceId}] Ticket channel created successfully: ${channel.id}`);
      return channel;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error creating ticket:`, error);
      return null;
    }
  }
  
  /**
   * Get latest transcript for a user if it exists
   * @param {string} username - Username
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<string|null>} - Path to transcript or null
   */
  async getLatestTranscript(username, phoneNumber) {
    try {
      if (!this.transcriptManager) {
        console.warn(`[TicketManager:${this.instanceId}] No transcript manager available`);
        return null;
      }
      
      // Get the user directory path
      const userDir = this.transcriptManager.getUserDir(phoneNumber, username);
      if (!fs.existsSync(userDir)) {
        return null;
      }
      
      // Look for HTML transcripts
      const files = fs.readdirSync(userDir)
        .filter(file => file.endsWith('.html') && file.startsWith('transcript-'))
        .sort((a, b) => {
          // Sort by creation time descending (newest first)
          return fs.statSync(path.join(userDir, b)).mtime.getTime() - 
                 fs.statSync(path.join(userDir, a)).mtime.getTime();
        });
      
      if (files.length === 0) {
        return null;
      }
      
      // Return the path to the most recent transcript
      return path.join(userDir, files[0]);
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error getting latest transcript:`, error);
      return null;
    }
  }
  
  /**
   * Close a ticket
   * @param {string} channelId - Channel ID
   * @param {boolean} sendMessage - Whether to send closing message
   * @returns {Promise<boolean>} - Success
   */
  async closeTicket(channelId, sendMessage = true) {
    try {
      // Get the guild by ID
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[TicketManager:${this.instanceId}] Guild not found: ${this.guildId}`);
        return false;
      }

      // Get the channel by ID
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        console.error(`[TicketManager:${this.instanceId}] Channel not found: ${channelId}`);
        return false;
      }

      // Get phone number from channel manager
      const phoneNumber = await this.channelManager.getPhoneNumberByChannelId(channelId);
      if (!phoneNumber) {
        console.error(`[TicketManager:${this.instanceId}] No phone number found for channel: ${channelId}`);
        return false;
      }

      // Get user info from manager if available
      let username = 'Unknown User';
      if (this.userCardManager) {
        const userCard = await this.userCardManager.getUserCard(phoneNumber);
        if (userCard && userCard.name) {
          username = userCard.name;
        }
      }

      // Create transcript if manager available
      if (this.transcriptManager && !this.transcriptManager.isDisabled) {
        try {
          console.log(`[TranscriptManager:${this.instanceId}] Creating transcript for ${username} (${phoneNumber})`);
          await this.transcriptManager.createAndSaveTranscript(channel, username, phoneNumber);
        } catch (transcriptError) {
          console.error(`[TicketManager:${this.instanceId}] Error creating transcript:`, transcriptError);
        }
      } else {
        console.log(`[TicketManager:${this.instanceId}] Transcript creation skipped (disabled or no manager)`);
      }

      // Send closing message if requested
      if (sendMessage) {
        // Get closing message
        let closeMessage = this.getCloseMessage();
        
        // Replace placeholders
        closeMessage = closeMessage
          .replace(/{name}/g, username)
          .replace(/{phoneNumber}/g, phoneNumber);
        
        // Send message to WhatsApp
        if (this.channelManager && this.channelManager.whatsAppClient) {
          try {
            await this.channelManager.whatsAppClient.sendTextMessage(phoneNumber, closeMessage);
          } catch (whatsappError) {
            console.error(`[TicketManager:${this.instanceId}] Error sending closing message to WhatsApp:`, whatsappError);
          }
        } else {
          console.error(`[TicketManager:${this.instanceId}] No WhatsApp handler available`);
        }
      }

      // Delete the channel
      await channel.delete(`Ticket closed by support agent`);
      console.log(`[TicketManager:${this.instanceId}] Ticket channel deleted: ${channelId}`);

      // Remove from channel manager
      await this.channelManager.removeChannel(phoneNumber);

      return true;
    } catch (error) {
      console.error(`[TicketManager:${this.instanceId}] Error closing ticket:`, error);
      return false;
    }
  }
}

module.exports = TicketManager;
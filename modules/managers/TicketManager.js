// modules/managers/TicketManager.js
const {
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const path = require("path");
const fs = require("fs");
const glob = require('glob');

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
  constructor(
    channelManager,
    discordClient,
    guildId,
    categoryId,
    options = {}
  ) {
    this.channelManager = channelManager;
    this.discordClient = discordClient;
    this.guildId = guildId;
    this.categoryId = categoryId;
    this.userCardManager = null;
    this.transcriptManager = null;
    this.instanceId = options.instanceId || "default";
    this.customIntroMessage = options.customIntroMessages || null;
    this.customCloseMessage = options.customCloseMessages || null;

    // Store the complete custom settings
    this.customSettings = options.customSettings || null;

    console.log(
      `[TicketManager:${this.instanceId}] Initialized with category ID: ${this.categoryId}`
    );
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
    return (
      this.customIntroMessage ||
      "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible."
    );
  }

  /**
   * Get current close message
   * @returns {string} - Close message
   */
  getCloseMessage() {
    return (
      this.customCloseMessage ||
      "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved."
    );
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
        console.error(
          `[TicketManager:${this.instanceId}] Invalid phone number or username: ${phoneNumber}, ${username}`
        );
        return null;
      }

      // Get latest username from user card manager if available
      let updatedUsername = username;
      if (this.userCardManager) {
        try {
          const userInfo = await this.userCardManager.getUserInfo(phoneNumber);
          if (userInfo) {
            if (typeof userInfo === "string") {
              updatedUsername = userInfo;
            } else if (userInfo.username) {
              updatedUsername = userInfo.username;
            } else if (userInfo.name) {
              updatedUsername = userInfo.name;
            }
            console.log(
              `[TicketManager:${this.instanceId}] Found updated username in user card: ${updatedUsername}`
            );
          }
        } catch (userCardError) {
          console.error(
            `[TicketManager:${this.instanceId}] Error getting user info:`,
            userCardError
          );
          // Continue with provided username on error
        }
      }

      const existingChannelId = this.channelManager.getUserChannel(phoneNumber);
      if (existingChannelId) {
        console.log(
          `[TicketManager:${this.instanceId}] User ${updatedUsername} (${phoneNumber}) already has channel ${existingChannelId}`
        );

        // Get the existing channel
        const guild = this.discordClient.guilds.cache.get(this.guildId);
        if (guild) {
          const existingChannel = guild.channels.cache.get(existingChannelId);
          if (existingChannel) {
            console.log(
              `[TicketManager:${this.instanceId}] Using existing channel: ${existingChannel.name}`
            );
            return existingChannel;
          }

          // Channel doesn't exist despite mapping - will create new one
          console.log(
            `[TicketManager:${this.instanceId}] Channel mapping exists but channel not found, will create new one`
          );
        }
      }

      // Get the guild by ID
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(
          `[TicketManager:${this.instanceId}] Guild not found: ${this.guildId}`
        );
        return null;
      }

      // Get the category by ID
      const category = guild.channels.cache.get(this.categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        console.error(
          `[TicketManager:${this.instanceId}] Category not found or invalid: ${this.categoryId}`
        );
        return null;
      }

      // Clean phone number and format username for channel name
      const cleanPhone = phoneNumber.replace(/\D/g, "");
      const formattedUsername = updatedUsername
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .substring(0, 25);

      // Create channel name with clipboard emoji and username
      const channelName = `📋-${formattedUsername}`;

      // Create channel
      console.log(
        `[TicketManager:${this.instanceId}] Creating ticket channel: ${channelName}`
      );
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
          },
        ],
      });

      // Map channel to phone number in channel manager
      await this.channelManager.addChannelMapping(cleanPhone, channel.id);

      // Get intro message template
      let introMessage = this.getIntroMessage();

      // Replace placeholders
      introMessage = introMessage
        .replace(/{name}/g, updatedUsername)
        .replace(/{phoneNumber}/g, phoneNumber);

      // Check for previous transcripts
      let previousTranscript = null;
      if (this.transcriptManager) {
        previousTranscript = await this.getLatestTranscript(
          updatedUsername,
          phoneNumber
        );
      }

      // Create ticket info embed with the exact format specified
      const embed = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle(`Ticket Tool`)
        .setDescription(
          `\`\`\`${updatedUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``
        )
        .addFields(
          {
            name: "Opened Ticket",
            value: `${new Date().toLocaleString()}`,
            inline: false,
          },
          // Add Notes field (instead of Description)
          {
            name: "Notes",
            value:
              "```No notes provided yet. Use the Edit button to add details.```",
            inline: false,
          }
        )
        .setTimestamp();

      // Create button row with edit and close buttons with specific IDs
      // IMPORTANT: Use consistent and simplified button IDs
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`edit-user-${phoneNumber}`)
          .setLabel("Edit")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`close`) // Changed to just 'close' for simplicity
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger)
      );

      // Send messages to the new channel
      await channel.send({ content: introMessage });

      // If there's a previous transcript, send it
      if (previousTranscript) {
        const transcriptEmbed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Previous Conversation")
          .setDescription(
            "This transcript contains the previous conversation history:"
          );

        await channel.send({
          embeds: [transcriptEmbed],
          files: [previousTranscript],
        });
      }

      // Send the transcript message
      await channel.send({
        content: "📝 Transcript",
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setDescription(
              "All messages in this channel will be included in the ticket transcript."
            ),
        ],
      });

      // Send the ticket info embed and pin it
      const embedMsg = await channel.send({
        embeds: [embed],
        components: [row],
      });
      await embedMsg.pin();

      // Store the ticket info message ID in the channel
      try {
        // Save message ID to channel for easier retrieval later
        await this.channelManager.saveInstanceSettings(this.instanceId, {
          ticketInfoMessages: {
            ...(this.customSettings?.ticketInfoMessages || {}),
            [channel.id]: embedMsg.id,
          },
        });
      } catch (saveError) {
        console.error(
          `[TicketManager:${this.instanceId}] Error saving message ID:`,
          saveError
        );
      }

      console.log(
        `[TicketManager:${this.instanceId}] Ticket channel created successfully: ${channel.id}`
      );
      return channel;
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error creating ticket:`,
        error
      );
      return null;
    }
  }

  /**
   * Get a Discord channel by ID
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<Channel|null>} - Discord.js channel object or null if not found
   */
  async getDiscordChannel(channelId) {
    try {
      if (!channelId) {
        console.error(
          `[TicketManager:${this.instanceId}] Cannot get channel: missing channelId`
        );
        return null;
      }

      if (!this.discordClient) {
        console.error(
          `[TicketManager:${this.instanceId}] Cannot get channel: no Discord client available`
        );
        return null;
      }

      // Try to get from cache first for better performance
      let channel = this.discordClient.channels.cache.get(channelId);

      // If not in cache, try to fetch
      if (!channel) {
        try {
          channel = await this.discordClient.channels.fetch(channelId);
        } catch (fetchError) {
          console.error(
            `[TicketManager:${this.instanceId}] Error fetching channel ${channelId}:`,
            fetchError
          );
          return null;
        }
      }

      if (!channel) {
        console.error(
          `[TicketManager:${this.instanceId}] Channel not found: ${channelId}`
        );
        return null;
      }

      // Check if it's a text-based channel
      if (!channel.isTextBased()) {
        console.error(
          `[TicketManager:${this.instanceId}] Channel ${channelId} is not a text channel`
        );
        return null;
      }

      return channel;
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error getting Discord channel ${channelId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Forward a user message to their Discord ticket channel
   * @param {string} userId - User ID or phone number
   * @param {Object|string} message - Message data or text
   * @param {boolean} [isMedia=false] - Whether message contains media
   * @returns {Promise<boolean|string>} - Success status or message ID
   */
  async forwardUserMessage(userId, message, isMedia = false) {
    try {
      if (!userId) {
        console.error(`[TicketManager:${this.instanceId}] Missing userId`);
        return false;
      }

      // Get the channel for this user
      const channelId = this.channelManager.getChannelId(userId);
      if (!channelId) {
        console.log(
          `[TicketManager:${this.instanceId}] No channel found for user ${userId}`
        );
        return false;
      }

      // Get the Discord channel
      const channel = await this.getDiscordChannel(channelId);
      if (!channel) {
        console.error(
          `[TicketManager:${this.instanceId}] Cannot find Discord channel ${channelId}`
        );
        return false;
      }

      // Get username directly from userCardManager
      let username = "Unknown User";
      if (this.userCardManager) {
        const userInfo = this.userCardManager.getUserInfo(userId);
        if (userInfo && userInfo.username) {
          username = userInfo.username;
          console.log(
            `[TicketManager:${this.instanceId}] Using username "${username}" for message from ${userId}`
          );
        }
      }

      let content = "";
      let files = [];

      if (isMedia) {
        // Handle media message
        if (typeof message === "object") {
          // If message is an object with content and files properties
          content = message.content || "";
          files = message.files || [];

          // Add username if not already added and content doesn't already include it
          if (
            content &&
            !content.startsWith(`**${username}**`) &&
            !content.includes(`**${username}**:`)
          ) {
            content = `**${username}**: ${content}`;
          }
        } else {
          // If message is just a string
          content = `**${username}**: ${message}`;
        }
      } else {
        // Handle text message
        if (typeof message === "string") {
          // Simple string content
          if (!message.includes(`**${username}**`)) {
            content = `**${username}**: ${message}`;
          } else {
            content = message;
          }
        } else {
          // Object with properties
          content = message.content || message.body || "";

          // Make sure username is included
          if (!content.includes(`**${username}**`)) {
            content = `**${username}**: ${content}`;
          }
        }
      }

      // Send to Discord channel
      try {
        const sentMessage = await channel.send({
          content: content,
          files: files,
          allowedMentions: { parse: [] }, // Don't ping anyone
        });

        // Return the message ID for reference (useful for updating/editing)
        return sentMessage.id;
      } catch (sendError) {
        console.error(
          `[TicketManager:${this.instanceId}] Error sending message to Discord:`,
          sendError
        );

        // If we failed to send files, try just sending the text
        if (files.length > 0) {
          try {
            const fallbackMessage = await channel.send({
              content: `${content}\n\n❌ *Failed to send media attachments.*`,
              allowedMentions: { parse: [] },
            });
            return fallbackMessage.id;
          } catch (textError) {
            console.error(
              `[TicketManager:${this.instanceId}] Error sending fallback text message:`,
              textError
            );
          }
        }
        return false;
      }
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error forwarding message:`,
        error
      );
      return false;
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
        console.warn(
          `[TicketManager:${this.instanceId}] No transcript manager available`
        );
        return null;
      }

      // Try multiple approaches to find the transcript folder
      let userDir = null;
      const possibleDirs = [
        // New format
        this.transcriptManager.getUserDir(phoneNumber, username),
        // Phone number only
        path.join(this.transcriptManager.baseDir, phoneNumber),
        // Variations with parentheses
        path.join(
          this.transcriptManager.baseDir,
          `${username} (${phoneNumber})`
        ),
        path.join(
          this.transcriptManager.baseDir,
          `${phoneNumber} (${username})`
        ),
      ];

      // Try each possible directory format
      for (const dir of possibleDirs) {
        if (fs.existsSync(dir)) {
          userDir = dir;
          console.log(
            `[TicketManager:${this.instanceId}] Found transcript directory: ${dir}`
          );
          break;
        }
      }

      // If direct path not found, search for folders containing the phone number
      if (!userDir && this.transcriptManager.findExistingFolderByPhone) {
        userDir = this.transcriptManager.findExistingFolderByPhone(phoneNumber);
        if (userDir) {
          console.log(
            `[TicketManager:${this.instanceId}] Found directory by phone search: ${userDir}`
          );
        }
      }

      // If still no directory, search all subdirectories for matching phone number
      if (!userDir && fs.existsSync(this.transcriptManager.baseDir)) {
        const dirs = fs
          .readdirSync(this.transcriptManager.baseDir, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name);

        for (const dir of dirs) {
          if (dir.includes(phoneNumber)) {
            userDir = path.join(this.transcriptManager.baseDir, dir);
            console.log(
              `[TicketManager:${this.instanceId}] Found directory containing phone number: ${userDir}`
            );
            break;
          }
        }
      }

      // Check if directory exists
      if (!userDir || !fs.existsSync(userDir)) {
        console.log(
          `[TicketManager:${this.instanceId}] No transcript directory found for ${username} (${phoneNumber})`
        );
        return null;
      }

      // Search for transcript files in various formats
      const filePatterns = [
        // Try different naming patterns
        "transcript-master.html",
        `${username.replace(/[^a-zA-Z0-9]/g, "-")}-transcript-master.html`,
        "transcript-*.html", // Any transcript HTML file
        "*.html", // Any HTML file as last resort
      ];

      for (const pattern of filePatterns) {
        const files = glob.sync(path.join(userDir, pattern));
        if (files.length > 0) {
          // Sort by modified time (newest first)
          files.sort(
            (a, b) =>
              fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime()
          );

          console.log(
            `[TicketManager:${this.instanceId}] Found transcript: ${files[0]}`
          );
          return files[0];
        }
      }

      // If pattern matching didn't work, try direct file listing
      const files = fs
        .readdirSync(userDir)
        .filter(
          (file) =>
            (file.endsWith(".html") && file.includes("transcript")) ||
            (file.endsWith(".md") && file.includes("transcript"))
        )
        .sort((a, b) => {
          // Sort by creation time descending (newest first)
          return (
            fs.statSync(path.join(userDir, b)).mtime.getTime() -
            fs.statSync(path.join(userDir, a)).mtime.getTime()
          );
        });

      if (files.length > 0) {
        const newestFile = files[0];
        const filePath = path.join(userDir, newestFile);
        console.log(
          `[TicketManager:${this.instanceId}] Found latest transcript: ${filePath}`
        );
        return filePath;
      }

      console.log(
        `[TicketManager:${this.instanceId}] No transcript found for ${username} (${phoneNumber})`
      );
      return null;
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error getting latest transcript:`,
        error
      );
      return null;
    }
  }

  /**
   * Close a ticket
   * @param {string} channelId - Channel ID
   * @param {boolean} sendMessage - Whether to send closing message
   * @param {Object} [interaction] - Optional interaction for updating
   * @returns {Promise<boolean>} - Success
   */
  async closeTicket(channelId, sendMessage = true, interaction = null) {
    try {
      console.log(
        `[TicketManager:${this.instanceId}] Closing ticket, channel: ${channelId}`
      );

      // Get the guild by ID
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(
          `[TicketManager:${this.instanceId}] Guild not found: ${this.guildId}`
        );
        return false;
      }

      // Get the channel by ID
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        console.error(
          `[TicketManager:${this.instanceId}] Channel not found: ${channelId}`
        );
        return false;
      }

      // Get phone number from channel
      const phoneNumber = await this.channelManager.getPhoneNumberByChannelId(
        channelId
      );
      if (!phoneNumber) {
        console.error(
          `[TicketManager:${this.instanceId}] No phone number found for channel: ${channelId}`
        );
        return false;
      }

      // Get user info from manager if available
      let username = "Unknown User";
      if (this.userCardManager) {
        const userCard = await this.userCardManager.getUserInfo(phoneNumber);
        if (userCard && userCard.username) {
          username = userCard.username;
        }
      }

      // ADDED: Reply to the interaction first if one was provided
      let interactionReplied = false;
      try {
        if (interaction && typeof interaction.editReply === "function") {
          await interaction.editReply({
            content:
              "✅ Ticket will be closed in 5 seconds. Creating transcript...",
          });
          interactionReplied = true;
        }
      } catch (interactionError) {
        console.error(
          `[TicketManager:${this.instanceId}] Error replying to interaction:`,
          interactionError
        );
      }

      // Send a warning message with 5 second countdown
      await channel.send({
        content: "⚠️ This ticket will be closed in 5 seconds...",
      });

      // Wait 5 seconds
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Create transcript if manager available
      let transcriptPath = null;
      if (this.transcriptManager && !this.transcriptManager.isDisabled) {
        try {
          console.log(
            `[TicketManager:${this.instanceId}] Creating transcript for ${username} (${phoneNumber})`
          );
          transcriptPath = await this.transcriptManager.createAndSaveTranscript(
            channel,
            username,
            phoneNumber
          );
        } catch (transcriptError) {
          console.error(
            `[TicketManager:${this.instanceId}] Error creating transcript:`,
            transcriptError
          );
        }
      }

      // Check settings before sending closing message
      // First check instance settings, then parameter
      const shouldSendMessage =
        this.customSettings?.sendClosingMessage !== false &&
        sendMessage !== false;

      // Send closing message to WhatsApp if enabled
      if (shouldSendMessage) {
        // Get closing message
        let closeMessage = this.getCloseMessage();

        // Replace placeholders
        closeMessage = closeMessage
          .replace(/{name}/g, username)
          .replace(/{phoneNumber}/g, phoneNumber);

        // Send message to WhatsApp
        if (this.channelManager && this.channelManager.whatsAppClient) {
          try {
            await this.channelManager.whatsAppClient.sendTextMessage(
              phoneNumber,
              closeMessage
            );
            console.log(
              `[TicketManager:${this.instanceId}] Sent closing message to ${phoneNumber}`
            );
          } catch (whatsappError) {
            console.error(
              `[TicketManager:${this.instanceId}] Error sending closing message:`,
              whatsappError
            );
          }
        }
      } else {
        console.log(
          `[TicketManager:${this.instanceId}] Closing message skipped (disabled in settings)`
        );
      }

      // IMPORTANT: Remove from channel manager BEFORE deleting the channel
      await this.channelManager.removeChannel(phoneNumber);

      // Delete the channel
      try {
        await channel.delete(`Ticket closed by support agent`);
        console.log(
          `[TicketManager:${this.instanceId}] Ticket channel deleted: ${channelId}`
        );
      } catch (deleteError) {
        console.error(
          `[TicketManager:${this.instanceId}] Error deleting channel:`,
          deleteError
        );
      }

      // ADDED: Update interaction reply if we replied earlier
      if (interactionReplied) {
        try {
          await interaction
            .editReply({
              content: "✅ Ticket closed successfully!",
            })
            .catch((err) => {
              // Silent catch - this is just a bonus notification
              console.log(
                `[TicketManager:${this.instanceId}] Couldn't update final interaction: ${err.message}`
              );
            });
        } catch (finalUpdateError) {
          // This is just a bonus, so we'll silently catch errors
        }
      }

      return true;
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error closing ticket:`,
        error
      );
      return false;
    }
  }
}

module.exports = TicketManager;

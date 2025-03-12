// modules/ticketManager.js - FIXED FOR USERNAME HANDLING
const fs = require("fs");
const path = require("path");
const MediaManager = require("./MediaManager");
const { formatDisplayName, formatDirectoryName, cleanPhoneNumber } =
  MediaManager.formatFunctions;
const {
  ChannelType,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
} = require("discord.js");

class TicketManager {
  constructor(
    channelManager,
    discordClient,
    guildId,
    categoryId,
    options = {}
  ) {
    // Store instance ID
    this.instanceId =
      options.instanceId || channelManager?.instanceId || "default";

    // Log critical initialization info
    console.log(`[TicketManager:${
      this.instanceId
    }] Initializing TicketManager with:
      - channelManager: ${channelManager ? "Available" : "Missing"}
      - discordClient: ${discordClient ? "Available" : "Missing"}
      - guildId: ${guildId}
      - categoryId: ${categoryId}`);

    // Check for Discord client very early
    if (!discordClient) {
      console.error(
        `[TicketManager:${this.instanceId}] CRITICAL ERROR: Discord client is null in constructor!`
      );
      throw new Error("Discord client is required for TicketManager");
    }

    this.channelManager = channelManager;
    this.discordClient = discordClient;
    this.guildId = guildId;
    this.categoryId = categoryId;

    // Create MediaManager instance for proper name formatting
    try {
      this.mediaManager = new MediaManager({
        instanceId: this.instanceId,
        baseDir: path.join(
          __dirname,
          "..",
          "instances",
          this.instanceId,
          "transcripts"
        ),
      });
    } catch (e) {
      console.error(
        `[TicketManager:${this.instanceId}] Error creating MediaManager: ${e.message}`
      );
      // Fallback - use the static format functions
    }

    // Add a property to track which tickets are currently being closed
    this.closingTickets = new Set();

    // Add a property to track transcript generation to prevent duplicates
    this.generatingTranscripts = new Set();

    // Ticket status tracking (for keeping track of closed tickets)
    this.ticketStatus = new Map();

    // Message queue system for transcript restoration
    this.messageQueue = new Map(); // Maps channelId to array of queued messages
    this.restoringChannels = new Set(); // Tracks which channels are currently restoring messages
    this.queueOrder = new Map(); // Maps channelId to message sequence number

    // ADDED: Custom intro message options
    this.customIntroMessages = options.customIntroMessages;
    this.customCloseMessages = options.customCloseMessages;

    // Create temp directory if it doesn't exist
    this.tempDir =
      options.tempDir ||
      path.join(__dirname, "..", "instances", this.instanceId, "temp");
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Configure storage file
    this.statusFilePath =
      options.statusFilePath ||
      path.join(
        __dirname,
        "..",
        "instances",
        this.instanceId,
        "ticket_status.json"
      );

    // VALIDATE: Verify client immediately
    this.verifyDiscordClient();

    // Load saved ticket status
    this.loadTicketStatus();
  }

  /**
   * Get formatted intro message with variables replaced
   * @param {string} username - Username to insert
   * @param {string} phoneNumber - Phone number to insert
   * @returns {string} - Formatted message
   */
  getFormattedIntroMessage(username, phoneNumber) {
    // Use custom message if available, otherwise use default
    let message =
      this.customIntroMessages ||
      "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.";

    // Replace template variables
    return message
      .replace(/{name}/g, username)
      .replace(/{username}/g, username)
      .replace(/{phoneNumber}/g, phoneNumber);
  }

  /**
   * Get formatted closing message with variables replaced
   * @param {string} username - Username to insert
   * @param {string} phoneNumber - Phone number to insert
   * @returns {string} - Formatted message
   */
  getFormattedCloseMessage(username, phoneNumber) {
    // Use custom message if available, otherwise use default
    let message =
      this.customCloseMessages ||
      "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";

    // Replace template variables
    return message
      .replace(/{name}/g, username)
      .replace(/{username}/g, username)
      .replace(/{phoneNumber}/g, phoneNumber);
  }

  // Set custom introduction message template
  setCustomIntroMessage(template) {
    this.customIntroMessages = template;
    console.log(
      `[TicketManager:${this.instanceId}] Set custom intro message template`
    );
  }

  /**
   * Set custom closing message for tickets
   * @param {string} template - Template message
   */
  setCustomCloseMessage(template) {
    this.customCloseMessages = template;
    console.log(
      `[TicketManager:${this.instanceId}] Set custom close message template`
    );
  }

  verifyDiscordClient() {
    try {
      if (!this.discordClient) {
        console.error(
          `[TicketManager:${this.instanceId}] CRITICAL ERROR: Discord client is null or undefined`
        );
        return false;
      }

      // Check if the discord client is an object and has the expected properties
      if (typeof this.discordClient !== "object") {
        console.error(
          `[TicketManager:${this.instanceId}] CRITICAL ERROR: Discord client is not an object`
        );
        return false;
      }

      if (!this.discordClient.guilds) {
        console.error(
          `[TicketManager:${this.instanceId}] CRITICAL ERROR: Discord client guilds collection is null or undefined`
        );
        return false;
      }

      // Check if we can access the guilds cache
      if (!this.discordClient.guilds.cache) {
        console.error(
          `[TicketManager:${this.instanceId}] CRITICAL ERROR: Discord client guilds cache is missing`
        );
        return false;
      }

      // Try to get the guild
      try {
        const guild = this.discordClient.guilds.cache.get(this.guildId);
        if (!guild) {
          // Try to fetch it directly as a fallback
          console.warn(
            `[TicketManager:${this.instanceId}] Guild with ID ${this.guildId} not found in cache, attempting to fetch`
          );
          this.discordClient.guilds
            .fetch(this.guildId)
            .then((g) => {
              if (g) {
                console.log(
                  `[TicketManager:${this.instanceId}] Successfully fetched guild: ${g.name}`
                );
              } else {
                console.error(
                  `[TicketManager:${this.instanceId}] Guild with ID ${this.guildId} could not be fetched`
                );
              }
            })
            .catch((e) => {
              console.error(
                `[TicketManager:${this.instanceId}] Error fetching guild: ${e.message}`
              );
            });
          return false;
        }

        // Check category
        const category = guild.channels.cache.get(this.categoryId);
        if (!category) {
          console.error(
            `[TicketManager:${this.instanceId}] Could not find category with ID ${this.categoryId}`
          );
          return false;
        }

        console.log(
          `[TicketManager:${this.instanceId}] Verified Discord client connection to guild ${guild.name}, category: ${category.name}`
        );
        return true;
      } catch (error) {
        console.error(
          `[TicketManager:${this.instanceId}] Error getting guild from Discord client:`,
          error
        );
        return false;
      }
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error verifying Discord client:`,
        error
      );
      return false;
    }
  }

  // Helper function to force cleanup a file
  forceCleanupFile(filePath) {
    if (!filePath) return false;

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(
          `[TicketManager:${this.instanceId}] 🗑️ DELETED: ${filePath}`
        );

        // Double-check it's really gone
        if (fs.existsSync(filePath)) {
          console.error(
            `[TicketManager:${this.instanceId}] ⚠️ File still exists after deletion attempt: ${filePath}`
          );
          // Try one more time
          fs.unlinkSync(filePath);
          console.log(
            `[TicketManager:${this.instanceId}] 🗑️ Second deletion attempt for: ${filePath}`
          );
          return !fs.existsSync(filePath);
        }
        return true;
      } else {
        return true; // Consider it a success if the file doesn't exist
      }
    } catch (e) {
      console.error(
        `[TicketManager:${this.instanceId}] Error deleting ${filePath}: ${e.message}`
      );
      return false;
    }
  }

  // Ticket status management
  loadTicketStatus() {
    try {
      if (fs.existsSync(this.statusFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.statusFilePath, "utf8"));
        this.ticketStatus = new Map(Object.entries(data));
        console.log(
          `[TicketManager:${this.instanceId}] Loaded ${this.ticketStatus.size} ticket statuses from file`
        );
      } else {
        console.log(
          `[TicketManager:${this.instanceId}] No ticket status file found, starting with empty map`
        );
        this.ticketStatus = new Map();
        // Create empty file
        fs.writeFileSync(this.statusFilePath, "{}", "utf8");
        console.log(
          `[TicketManager:${this.instanceId}] Created empty ticket status file`
        );
      }
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error loading ticket status:`,
        error
      );
      this.ticketStatus = new Map();

      // Create empty file if it doesn't exist
      if (!fs.existsSync(this.statusFilePath)) {
        fs.writeFileSync(this.statusFilePath, "{}", "utf8");
        console.log(
          `[TicketManager:${this.instanceId}] Created empty ticket status file`
        );
      }
    }
  }

  saveTicketStatus() {
    try {
      const statusObj = Object.fromEntries(this.ticketStatus);
      fs.writeFileSync(
        this.statusFilePath,
        JSON.stringify(statusObj, null, 2),
        "utf8"
      );
      console.log(
        `[TicketManager:${this.instanceId}] Saved ${this.ticketStatus.size} ticket statuses to file`
      );
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error saving ticket status:`,
        error
      );
    }
  }

  // CRITICAL FIX: Format username for channel name with proper phone number handling
  // This should use the clean name without phone numbers
  formatUsernameForChannel(username) {
    if (!username) {
      return "unknown-user";
    }

    // CRITICAL: Use MediaManager's clean format functions
    const cleanName = formatDisplayName(username);

    // Create sanitized username for channel
    let channelName = cleanName.replace(/\s+/g, "-").toLowerCase();

    // Remove any non-alphanumeric characters except hyphens
    channelName = channelName.replace(/[^a-z0-9-]/g, "");

    // Ensure it's not too long
    if (channelName.length > 25) {
      channelName = channelName.substring(0, 25);
    }

    return channelName;
  }

  // Set a reference to the userCardManager if not set in constructor
  setUserCardManager(manager) {
    this.userCardManager = manager;
    console.log(
      `[TicketManager:${this.instanceId}] Set userCardManager: ${
        manager ? "Successful" : "Failed (null)"
      }`
    );
  }

  // Set a reference to the transcriptManager if not set in constructor
  setTranscriptManager(manager) {
    this.transcriptManager = manager;
    console.log(
      `[TicketManager:${this.instanceId}] Set transcriptManager: ${
        manager ? "Successful" : "Failed (null)"
      }`
    );
  }

  // Check for existing ticket
  async getExistingTicket(phoneNumber) {
    try {
      if (
        !this.channelManager ||
        typeof this.channelManager.getChannelIdByPhoneNumber !== "function"
      ) {
        console.error(
          `[TicketManager:${this.instanceId}] channelManager is not available or method is missing`
        );
        return null;
      }

      const channelId =
        this.channelManager.getChannelIdByPhoneNumber(phoneNumber);
      if (!channelId) {
        console.log(
          `[TicketManager:${this.instanceId}] No channel ID found for ${phoneNumber}`
        );
        return null;
      }

      // Check if ticket is marked as closed
      if (this.isTicketClosed(channelId)) {
        console.log(
          `[TicketManager:${this.instanceId}] Ticket for ${phoneNumber} is closed`
        );
        return null;
      }

      // Get Discord guild
      if (!this.discordClient) {
        console.error(
          `[TicketManager:${this.instanceId}] Discord client is not available`
        );
        return null;
      }

      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(
          `[TicketManager:${this.instanceId}] Guild ${this.guildId} not found`
        );
        return null;
      }

      // Try to fetch the channel
      try {
        const channel = await guild.channels.fetch(channelId);
        if (channel) {
          console.log(
            `[TicketManager:${this.instanceId}] Found existing ticket channel: ${channel.name} (${channelId})`
          );
          return channel;
        }
      } catch (fetchError) {
        console.error(
          `[TicketManager:${this.instanceId}] Error fetching channel ${channelId}:`,
          fetchError
        );
        // Remove from channel map if channel doesn't exist anymore
        if (fetchError.code === 10003) {
          // Unknown Channel error
          this.channelManager.removeChannelMapping(phoneNumber);
        }
      }

      return null;
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error in getExistingTicket:`,
        error
      );
      return null;
    }
  }

  async addPreviousTranscript(channel, phoneNumber, username) {
    try {
      // Skip if transcript manager is not available
      if (
        !this.transcriptManager ||
        typeof this.transcriptManager.findUserTranscript !== "function"
      ) {
        console.log(
          `[TicketManager:${this.instanceId}] Cannot load previous transcript: transcriptManager not available`
        );
        return false;
      }

      // Try to find previous transcript
      const transcript = await this.transcriptManager.findUserTranscript(
        username,
        phoneNumber
      );
      if (!transcript) {
        console.log(
          `[TicketManager:${this.instanceId}] No previous transcript found for ${username} (${phoneNumber})`
        );
        return false;
      }

      console.log(
        `[TicketManager:${this.instanceId}] Found previous transcript at ${transcript.path}`
      );

      // Get HTML transcript file path if available
      const htmlTranscriptPath = transcript.path.replace(".md", ".html");
      const htmlExists = fs.existsSync(htmlTranscriptPath);

      // Send previous conversation message with HTML file if available
      if (htmlExists) {
        await channel.send({
          content: `📄 **Previous Conversation**\nThis transcript contains the previous conversation history:`,
          files: [
            {
              attachment: htmlTranscriptPath,
              name: `previous-transcript-${Date.now()}.html`,
            },
          ],
        });
        console.log(
          `[TicketManager:${this.instanceId}] Sent HTML transcript file from ${htmlTranscriptPath}`
        );
      } else {
        // Just send a simple message if no HTML file
        await channel.send(
          `📄 **Previous Conversation**\nThis user has previous conversation history.`
        );
      }

      return true;
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error adding previous transcript: ${error.message}`
      );
      return false;
    }
  }

  async createTicket(phoneNumber, username) {
    // Declare channel variable outside try/catch for cleanup in finally block
    let channel;

    try {
      // CRITICAL FIX: Clean the username to not include phone
      const cleanUsername = formatDisplayName(username);

      console.log(
        `[TicketManager:${this.instanceId}] Creating new ticket for ${cleanUsername} (${phoneNumber})`
      );

      // Validate required parameters
      if (!phoneNumber) {
        console.error(
          `[TicketManager:${this.instanceId}] Error: phoneNumber is required to create a ticket`
        );
        throw new Error("Phone number is required");
      }

      if (!cleanUsername) {
        console.error(
          `[TicketManager:${this.instanceId}] Error: username is required to create a ticket`
        );
        throw new Error("Username is required");
      }

      // Validate Discord client is available
      if (!this.discordClient) {
        console.error(
          `[TicketManager:${this.instanceId}] ERROR: discordClient is null in TicketManager for instance`
        );
        throw new Error(
          "Discord client is not available. Ticket creation failed."
        );
      }

      // Store the phone-username mapping for consistency - using CLEAN username
      if (
        this.mediaManager &&
        typeof this.mediaManager.setPhoneToUsername === "function"
      ) {
        this.mediaManager.setPhoneToUsername(phoneNumber, cleanUsername);
      } else {
        console.warn(
          `[TicketManager:${this.instanceId}] No mediaManager set, unable to store phone-username mapping`
        );
      }

      // Get guild reference
      let guild;
      try {
        guild = this.discordClient.guilds.cache.get(this.guildId);
        if (!guild) {
          console.log(
            `[TicketManager:${this.instanceId}] Guild ${this.guildId} not in cache, trying to fetch...`
          );
          guild = await this.discordClient.guilds.fetch(this.guildId);
        }
      } catch (fetchError) {
        console.error(
          `[TicketManager:${this.instanceId}] ERROR: Could not fetch guild with ID ${this.guildId}: ${fetchError.message}`
        );
        throw new Error(`Discord guild not found: ${this.guildId}`);
      }

      if (!guild) {
        console.error(
          `[TicketManager:${this.instanceId}] ERROR: Could not find guild with ID ${this.guildId}`
        );
        console.error(
          `[TicketManager:${
            this.instanceId
          }] Available guilds in cache: ${Array.from(
            this.discordClient.guilds.cache.keys()
          ).join(", ")}`
        );
        throw new Error(
          `Discord guild ${this.guildId} not found in available guilds`
        );
      }

      console.log(
        `[TicketManager:${this.instanceId}] Found guild: ${guild.name} (${guild.id})`
      );

      // Verify we can access the category
      let category;
      try {
        category = guild.channels.cache.get(this.categoryId);
        if (!category) {
          console.log(
            `[TicketManager:${this.instanceId}] Category ${this.categoryId} not in cache, trying to fetch...`
          );
          category = await guild.channels.fetch(this.categoryId);
        }
      } catch (categoryError) {
        console.error(
          `[TicketManager:${this.instanceId}] ERROR: Could not fetch category with ID ${this.categoryId}: ${categoryError.message}`
        );
        throw new Error(`Category not found: ${this.categoryId}`);
      }

      if (!category) {
        console.error(
          `[TicketManager:${this.instanceId}] ERROR: Could not find category with ID ${this.categoryId}`
        );
        console.error(
          `[TicketManager:${
            this.instanceId
          }] Available categories: ${Array.from(
            guild.channels.cache
              .filter((c) => c.type === ChannelType.GuildCategory)
              .map((c) => `${c.name} (${c.id})`)
          ).join(", ")}`
        );
        throw new Error(
          `Category ${this.categoryId} not found in available categories`
        );
      }

      console.log(
        `[TicketManager:${this.instanceId}] Found category: ${category.name} (${category.id})`
      );

      // CRITICAL FIX: Format channel name properly with CLEAN username
      let channelName = `📋-${this.formatUsernameForChannel(cleanUsername)}`;

      console.log(
        `[TicketManager:${this.instanceId}] Creating channel "${channelName}" in category "${category.name}" with custom permissions`
      );

      // Create the channel with better error handling and fallbacks
      try {
        // Try method 1: Full permissions
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: this.categoryId,
          reason: `Support ticket for ${cleanUsername} (${phoneNumber})`,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: this.discordClient.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ManageRoles,
                PermissionFlagsBits.ManageChannels, // Explicitly add manage channels permission
              ],
            },
          ],
        });
      } catch (createError) {
        console.error(
          `[TicketManager:${this.instanceId}] ERROR creating channel: ${createError.message}`
        );

        // Try method 2: Simplified approach with basic parameters
        try {
          console.log(
            `[TicketManager:${this.instanceId}] Trying simplified channel creation without permission overwrites`
          );
          channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: this.categoryId,
            reason: `Support ticket for ${cleanUsername} (${phoneNumber})`,
          });

          console.log(
            `[TicketManager:${this.instanceId}] Simplified channel creation succeeded`
          );

          // Try to update channel permissions after creation
          try {
            await channel.permissionOverwrites.set(
              [
                {
                  id: guild.roles.everyone.id,
                  deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                  id: this.discordClient.user.id,
                  allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.ManageRoles,
                  ],
                },
              ],
              `Setting up permissions for ticket channel - ${cleanUsername}`
            );

            console.log(
              `[TicketManager:${this.instanceId}] Updated channel permissions after creation`
            );
          } catch (permError) {
            console.warn(
              `[TicketManager:${this.instanceId}] Could not update channel permissions: ${permError.message}`
            );
            // Continue anyway since we at least have the channel
          }
        } catch (retryError) {
          console.error(
            `[TicketManager:${this.instanceId}] Simplified channel creation also failed: ${retryError.message}`
          );

          // Try method 3: Most basic approach possible
          try {
            console.log(
              `[TicketManager:${this.instanceId}] Trying most basic channel creation`
            );
            channel = await guild.channels.create({ name: channelName });
            console.log(
              `[TicketManager:${this.instanceId}] Basic channel creation succeeded`
            );

            // Try to move channel to category after creation
            try {
              await channel.setParent(this.categoryId);
              console.log(
                `[TicketManager:${this.instanceId}] Moved channel to category after creation`
              );
            } catch (moveError) {
              console.warn(
                `[TicketManager:${this.instanceId}] Could not move channel to category: ${moveError.message}`
              );
              // Continue anyway
            }
          } catch (basicError) {
            console.error(
              `[TicketManager:${this.instanceId}] All channel creation methods failed`
            );
            throw new Error(
              `Could not create channel using any method. Please check bot permissions. Last error: ${basicError.message}`
            );
          }
        }
      }

      console.log(
        `[TicketManager:${this.instanceId}] Created new ticket channel: ${channel.name} (${channel.id})`
      );

      // Save to channel map
      if (
        this.channelManager &&
        typeof this.channelManager.setChannelMapping === "function"
      ) {
        this.channelManager.setChannelMapping(phoneNumber, channel.id);
      } else {
        console.error(
          `[TicketManager:${this.instanceId}] Cannot save channel mapping: channelManager is missing or invalid`
        );
      }

      // CHANGED ORDER: First send the NewTicket marker and the transcript header
      await channel.send(`[---NewTicket---]`);

      await this.addPreviousTranscript(channel, phoneNumber, cleanUsername);

      // Send a transcript header message
      await channel.send(
        `# 📄 Transcript\nAll messages in this channel will be included in the ticket transcript.`
      );

      // IMPROVED: Use custom welcome message if available
      let welcomeMessage;
      if (this.customIntroMessages) {
        welcomeMessage = this.customIntroMessages
          .replace("{username}", cleanUsername)
          .replace("{name}", cleanUsername)
          .replace("{phoneNumber}", phoneNumber);
      } else {
        welcomeMessage = `# 📋 New Support Ticket\n**A new ticket has been created for ${cleanUsername}**\nWhatsApp: \`${phoneNumber}\`\n\nSupport agents will respond as soon as possible.`;
      }

      // Send the welcome message
      await channel.send(welcomeMessage);

      // LAST: Create and pin the user info embed with buttons
      // Cache this phone-channel-username relationship for transcript generation
      if (
        this.transcriptManager &&
        typeof this.transcriptManager.ensurePhoneForTranscript === "function"
      ) {
        this.transcriptManager.ensurePhoneForTranscript(
          channel.id,
          phoneNumber,
          cleanUsername
        );
      } else {
        console.warn(
          `[TicketManager:${this.instanceId}] transcriptManager is missing ensurePhoneForTranscript method`
        );
      }

      // Create embed with simplified structure - CLEAN username
      const embed = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle(`Ticket Information`)
        .setDescription(
          `\`\`\`${cleanUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``
        );

      // Add fields
      embed.addFields(
        {
          name: "Opened Ticket",
          value: `${new Date().toLocaleString()}`,
          inline: false,
        },
        // Add Notes field
        {
          name: "Notes",
          value:
            "```No notes provided yet. Use the Edit button to add details.```",
          inline: false,
        }
      );

      embed.setTimestamp();

      // Create button row with edit and close buttons - FIXED: custom ID
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`edit-user-${phoneNumber}`)
          .setLabel("Edit")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`close-ticket-${channel.id}`)
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger)
      );

      // Send and pin the embed
      const embedMsg = await channel.send({
        embeds: [embed],
        components: [row],
      });

      // Try to pin the message, but handle permission errors gracefully
      try {
        await embedMsg.pin();
      } catch (pinError) {
        if (pinError.code === 50013) {
          // Missing Permissions error code
          console.warn(
            `[TicketManager:${this.instanceId}] Warning: Bot doesn't have permission to pin messages in channel ${channel.id}. The embed message will not be pinned.`
          );
          await channel.send({
            content:
              "⚠️ **Warning:** I don't have permission to pin messages in this channel. Please give me the 'Manage Messages' permission for full functionality.",
            allowedMentions: { parse: [] }, // Don't ping anyone
          });
        } else {
          console.error(
            `[TicketManager:${this.instanceId}] Error pinning embed message: ${pinError.message}`
          );
        }
      }

      return channel;
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error creating ticket: ${error.message}`
      );
      console.error(error.stack);
      throw error;
    }
  }

  // Set ticket status
  setTicketStatus(channelId, status) {
    this.ticketStatus.set(channelId, status);
    this.saveTicketStatus();
  }

  // Get ticket status
  getTicketStatus(channelId) {
    return this.ticketStatus.get(channelId);
  }

  // Check if a ticket is closed
  isTicketClosed(channelId) {
    const status = this.ticketStatus.get(channelId);
    return status === "closed" || status === "closing";
  }

  // Check if a ticket is currently being closed
  isTicketClosing(channelId) {
    return this.closingTickets.has(channelId);
  }

  // Get ticket status count
  getTicketStatusCount() {
    return this.ticketStatus.size;
  }

  // Delete a Discord channel
  async deleteChannel(
    channelId,
    reason = "Ticket closed and transcript saved"
  ) {
    try {
      // Get the Discord guild
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(
          `[TicketManager:${this.instanceId}] Guild with ID ${this.guildId} not found when deleting channel`
        );
        return false;
      }

      // Get the channel
      const channel = await guild.channels
        .fetch(channelId)
        .catch((err) => null);
      if (!channel) {
        console.error(
          `[TicketManager:${this.instanceId}] Channel ${channelId} not found when trying to delete it`
        );
        // Clean up our tracking anyway
        this.closingTickets.delete(channelId);
        this.generatingTranscripts.delete(channelId);
        return false;
      }

      // Delete the channel
      console.log(
        `[TicketManager:${this.instanceId}] Deleting channel ${channel.name} (${channelId})`
      );
      await channel.delete(reason);
      console.log(
        `[TicketManager:${this.instanceId}] Channel ${channelId} deleted successfully`
      );

      // Clean up tracking
      this.closingTickets.delete(channelId);
      this.generatingTranscripts.delete(channelId);

      return true;
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error deleting channel ${channelId}:`,
        error
      );
      // Clean up tracking even on error
      this.closingTickets.delete(channelId);
      this.generatingTranscripts.delete(channelId);
      return false;
    }
  }

  async handleCloseButton(interaction) {
    try {
      const channelId = interaction.channel.id;

      // Check if already being closed
      if (
        this.isTicketClosed(channelId) ||
        this.closingTickets.has(channelId)
      ) {
        await interaction.reply({
          content: "This ticket is already being closed.",
          ephemeral: true,
        });
        return;
      }

      // Mark as being closed immediately
      this.closingTickets.add(channelId);
      this.setTicketStatus(channelId, "closing");

      // Get the associated WhatsApp number
      let sender = null;
      if (
        this.channelManager &&
        typeof this.channelManager.getWhatsAppNumberByChannelId === "function"
      ) {
        sender = this.channelManager.getWhatsAppNumberByChannelId(channelId);
      }

      await interaction.deferReply({ ephemeral: true });

      // Generate and save transcript
      let transcriptSuccess = false;

      try {
        await interaction.editReply(
          "Closing ticket and generating transcript..."
        );

        // Force get the username from userCardManager for the transcript
        let username = interaction.channel.name.replace(/^(✓|📋\s*-\s*)/, "");
        if (this.userCardManager && sender) {
          try {
            const userCard = this.userCardManager.getUserCard(sender);
            if (userCard && userCard.name) {
              // CRITICAL FIX: Clean the username
              username = formatDisplayName(userCard.name);
            }
          } catch (err) {
            console.error(
              `[TicketManager:${this.instanceId}] Error getting username from userCard:`,
              err
            );
          }
        }

        // Generate transcript if manager is available
        if (
          this.transcriptManager &&
          typeof this.transcriptManager.generateHTMLTranscript === "function"
        ) {
          // IMPORTANT: Make sure sender info is available
          if (
            typeof this.transcriptManager.ensurePhoneForTranscript ===
            "function"
          ) {
            this.transcriptManager.ensurePhoneForTranscript(
              channelId,
              sender,
              username
            );
          }

          // Generate transcript
          const transcriptPath =
            await this.transcriptManager.generateHTMLTranscript(
              interaction.channel,
              interaction.user
            );

          transcriptSuccess = !!transcriptPath;

          // Add extra information if transcript channel exists
          if (transcriptSuccess && this.transcriptManager.transcriptChannelId) {
            try {
              const guild = this.discordClient.guilds.cache.get(this.guildId);
              const transcriptChannel = guild?.channels.cache.get(
                this.transcriptManager.transcriptChannelId
              );
              if (transcriptChannel) {
                await interaction.channel.send(
                  `📝 Transcript has been saved to <#${transcriptChannel.id}> and will be available for future reference.`
                );
              }
            } catch (error) {
              console.error(
                `[TicketManager:${this.instanceId}] Error sending transcript channel info: ${error.message}`
              );
            }
          }
        }
      } catch (error) {
        console.error(
          `[TicketManager:${this.instanceId}] Error generating transcript:`,
          error
        );
        await interaction.editReply(
          `Error generating transcript: ${error.message}. Channel will be deleted in 5 seconds.`
        );
      }

      // Always delete the channel after transcript attempt
      if (transcriptSuccess) {
        await interaction.editReply(
          "Transcript saved successfully. This channel will be deleted in 5 seconds."
        );
      } else {
        await interaction.editReply(
          "Failed to generate transcript. Channel will be deleted in 5 seconds."
        );
      }

      // Clean up channel mapping
      if (
        sender &&
        this.channelManager &&
        typeof this.channelManager.removeChannelMapping === "function"
      ) {
        this.channelManager.removeChannelMapping(sender);
      }

      // Wait 5 seconds before deleting
      setTimeout(async () => {
        try {
          await this.deleteChannel(channelId);
        } catch (deleteError) {
          console.error(
            `[TicketManager:${this.instanceId}] Error deleting channel: ${deleteError.message}`
          );
          this.closingTickets.delete(channelId);
        }
      }, 5000);
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error handling close button:`,
        error
      );

      // Clean up tracking on error
      this.closingTickets.delete(interaction.channel.id);
      this.setTicketStatus(interaction.channel.id, "open");

      // Inform the user
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply(`Error closing ticket: ${error.message}`);
        } else if (!interaction.replied) {
          await interaction.reply({
            content: `Error closing ticket: ${error.message}`,
            ephemeral: true,
          });
        }
      } catch (replyError) {
        console.error(
          `[TicketManager:${this.instanceId}] Error replying to interaction:`,
          replyError
        );
      }
    }
  }

  loadSettingsDirectly(guildId) {
    try {
      const settingsPath = path.join(
        __dirname,
        "..",
        "instances",
        guildId,
        "settings.json"
      );

      if (fs.existsSync(settingsPath)) {
        const settingsData = fs.readFileSync(settingsPath, "utf8");
        return JSON.parse(settingsData);
      } else {
        console.log(
          `[TicketManager:${this.instanceId}] No settings file found at ${settingsPath}`
        );
        return null;
      }
    } catch (error) {
      console.error(
        `[TicketManager:${this.instanceId}] Error loading settings file:`,
        error
      );
      return null;
    }
  }

  // FIXED: Handle closing and deleting a ticket with improved protection against double processing
  async handleCloseTicket(interaction) {
    try {
      // Extract channel ID from button ID or use current channel
      const channelId = interaction.customId.startsWith("close-ticket-")
        ? interaction.customId.substring("close-ticket-".length)
        : interaction.channel.id;

      console.log(`Closing ticket with channel ID: ${channelId}`);

      // Get user info for sending closing message via WhatsApp
      let sender = null;
      if (
        this.channelManager &&
        typeof this.channelManager.getWhatsAppNumberByChannelId === "function"
      ) {
        sender = this.channelManager.getWhatsAppNumberByChannelId(
          interaction.channel.id
        );
      }

      // First, acknowledge the interaction
      await interaction.reply({
        content: "Closing ticket and generating transcript...",
        ephemeral: true,
      });

      // Get username for transcript
      let username = interaction.channel.name.replace(/^(✓|📋\s*-\s*)/, "");
      if (this.userCardManager && sender) {
        try {
          const userCard = this.userCardManager.getUserCard(sender);
          if (userCard && userCard.name) {
            const MediaManager = require("./MediaManager");
            username = MediaManager.formatFunctions.formatDisplayName(
              userCard.name
            );
          }
        } catch (err) {
          console.error(`Error getting username:`, err);
        }
      }

      // Send closing message to WhatsApp user if setting allows
      const settingsPath = path.join(
        __dirname,
        "..",
        "instances",
        interaction.guildId,
        "settings.json"
      );

      // Assume disabled by default
      let shouldSendMessage = false;

      if (fs.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

          // ONLY send if explicitly true
          if (settings.sendClosingMessage === true) {
            shouldSendMessage = true;
          }

          console.log(
            `[BaileysDiscordHandler:${this.instanceId}] Closing message setting: ${settings.sendClosingMessage}`
          );
          console.log(
            `[BaileysDiscordHandler:${this.instanceId}] Should send message: ${shouldSendMessage}`
          );
        } catch (readError) {
          console.error(
            `[BaileysDiscordHandler:${this.instanceId}] Error reading settings:`,
            readError
          );
        }
      } else {
        console.log(
          `[BaileysDiscordHandler:${this.instanceId}] No settings file found at ${settingsPath}`
        );
      }

      if (shouldSendMessage) {
        if (sender && this.baileysClient) {
          try {
            // Use custom message if configured
            let closeMessage =
              "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";

            if (this.ticketManager?.getFormattedCloseMessage) {
              closeMessage = this.ticketManager.getFormattedCloseMessage(
                username,
                sender
              );
            }

            await this.baileysClient.sendMessage(sender, closeMessage);
            console.log(
              `[BaileysDiscordHandler:${this.instanceId}] Sent closing message to ${sender}`
            );
          } catch (sendError) {
            console.error(
              `[BaileysDiscordHandler:${this.instanceId}] Error sending closing message:`,
              sendError
            );
          }
        } else {
          console.log(
            `[BaileysDiscordHandler:${this.instanceId}] Closing messages disabled - not sending`
          );
          return;
        }
      }

      // Make sure transcript manager has the phone number
      if (
        this.transcriptManager &&
        typeof this.transcriptManager.ensurePhoneForTranscript === "function" &&
        sender
      ) {
        this.transcriptManager.ensurePhoneForTranscript(
          interaction.channel.id,
          sender,
          username
        );
      }

      // Generate transcript
      let transcriptPath = null;
      try {
        if (
          this.transcriptManager &&
          typeof this.transcriptManager.generateHTMLTranscript === "function"
        ) {
          transcriptPath = await this.transcriptManager.generateHTMLTranscript(
            interaction.channel,
            interaction.user
          );

          // Update the interaction with success message
          await interaction.editReply(
            "Transcript saved successfully. This channel will be deleted in 5 seconds."
          );
        } else {
          await interaction.editReply(
            "Error: Transcript manager not available. Channel will be deleted in 5 seconds."
          );
        }
      } catch (transcriptError) {
        console.error(`Error generating transcript:`, transcriptError);
        await interaction.editReply(
          `Error generating transcript: ${transcriptError.message}. Channel will be deleted in 5 seconds.`
        );
      }

      // Remove from channel map
      if (
        sender &&
        this.channelManager &&
        typeof this.channelManager.removeChannelMapping === "function"
      ) {
        this.channelManager.removeChannelMapping(sender);
      }

      // Mark as closed
      this.setTicketStatus(interaction.channel.id, "closed");

      // Wait 5 seconds before deleting
      setTimeout(async () => {
        try {
          await this.deleteChannel(interaction.channel.id);
        } catch (deleteError) {
          console.error(`Error deleting channel:`, deleteError);
        }
      }, 5000);
    } catch (error) {
      console.error(`Error handling close button:`, error);
      if (!interaction.replied) {
        await interaction.reply({
          content: `Failed to close ticket: ${error.message}`,
          ephemeral: true,
        });
      } else {
        await interaction.followUp({
          content: `Error occurred while closing ticket: ${error.message}`,
          ephemeral: true,
        });
      }
    }
  }

  // Set reference to mediaManager
  setMediaManager(manager) {
    this.mediaManager = manager;
    console.log(
      `[TicketManager:${this.instanceId}] Set mediaManager: ${
        manager ? "Successful" : "Failed (null)"
      }`
    );
  }
}

module.exports = TicketManager;

// modules/handlers/DiscordHandler.js
const {
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const BaileysMedia = require("../clients/baileys/BaileysMedia.js");
const MentionProcessor = require("../../utils/mentionProcessor.js");

/**
 * Handles Discord events and interactions
 */
class DiscordHandler {
  /**
   * Create Discord handler
   * @param {Object} discordClient - Discord client
   * @param {string} categoryId - Category ID
   * @param {Object} channelManager - Channel manager
   * @param {Object} userCardManager - User card manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} options - Options
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
    this.vouchHandler = null; // Set externally
    this.customCloseMessage = null;

    this.instanceId = options.instanceId || "default";
    this.tempDir = options.tempDir || path.join(__dirname, "..", "..", "temp");
    this.assetsDir =
      options.assetsDir || path.join(__dirname, "..", "..", "assets");

    this.mentionProcessor = options.mentionProcessor;

    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    console.log(
      `[DiscordHandler:${this.instanceId}] Initialized for category ${this.categoryId}`
    );
  }

  /**
   * Handle a media file from a Discord attachment
   * @param {Object} attachment - Discord attachment
   * @param {string} phoneNumber - WhatsApp phone number
   * @param {string} content - Text content to send with media
   * @returns {Promise<boolean>} - Success
   */
  async handleAttachment(attachment, phoneNumber, content = "") {
    try {
      console.log(
        `[DiscordHandler:${this.instanceId}] Processing attachment: ${attachment.name} (${attachment.contentType})`
      );

      // Early validation
      if (!this.whatsAppClient) {
        console.error(
          `[DiscordHandler:${this.instanceId}] WhatsApp client not available`
        );
        return false;
      }

      // Determine the attachment type
      const isImage = attachment.contentType?.startsWith("image/");
      const isVideo = attachment.contentType?.startsWith("video/");
      const isAudio = attachment.contentType?.startsWith("audio/");
      const isGif =
        attachment.contentType === "image/gif" ||
        attachment.name?.endsWith(".gif");
      // FIXED: Improve voice detection - look for opus format or voice indicators in name
      const isVoice =
        isAudio &&
        (attachment.name?.includes("voice") ||
          attachment.name?.includes("ptt") ||
          attachment.contentType?.includes("opus") ||
          (attachment.name?.endsWith(".ogg") &&
            attachment.contentType?.includes("audio")));
      const isDocument = !isImage && !isVideo && !isAudio && !isGif;

      // Create a dedicated BaileysMedia instance with proper client reference
      const BaileysMedia = require("../clients/baileys/BaileysMedia.js");
      const mediaHandler = new BaileysMedia(this.whatsAppClient);

      // Download the file
      const response = await axios({
        method: "GET",
        url: attachment.url,
        responseType: "arraybuffer",
      });

      // Create a temp file for the download
      const tempPath = path.join(
        this.tempDir,
        `discord_${Date.now()}_${attachment.name}`
      );
      fs.writeFileSync(tempPath, Buffer.from(response.data));

      let result = false;

      try {
        // Process different media types
        if (isGif) {
          result = await mediaHandler.sendGif(phoneNumber, tempPath, content);
        } else if (isImage) {
          result = await mediaHandler.sendImage(phoneNumber, tempPath, content);
        } else if (isVideo) {
          result = await mediaHandler.sendVideo(phoneNumber, tempPath, content);
        } else if (isVoice) {
          // FIXED: Add more detailed logging for voice notes
          console.log(
            `[DiscordHandler:${this.instanceId}] Sending as voice note: ${attachment.name}`
          );
          result = await mediaHandler.sendAudio(phoneNumber, tempPath, true); // true = voice note
        } else if (isAudio) {
          result = await mediaHandler.sendAudio(phoneNumber, tempPath, false);
        } else if (isDocument) {
          result = await mediaHandler.sendDocument(
            phoneNumber,
            tempPath,
            attachment.name,
            content
          );
        } else {
          // Unknown type, try as document
          result = await mediaHandler.sendDocument(
            phoneNumber,
            tempPath,
            attachment.name,
            content
          );
        }

        console.log(
          `[DiscordHandler:${this.instanceId}] Successfully sent ${
            isGif
              ? "GIF"
              : isImage
              ? "image"
              : isVideo
              ? "video"
              : isVoice
              ? "voice"
              : isAudio
              ? "audio"
              : "document"
          } to WhatsApp`
        );
      } catch (sendError) {
        console.error(
          `[DiscordHandler:${this.instanceId}] Error sending media to WhatsApp: ${sendError.message}`
        );
        result = false;
      }

      // Clean up temp file
      try {
        fs.unlinkSync(tempPath);
      } catch (unlinkError) {
        console.error(
          `[DiscordHandler:${this.instanceId}] Error cleaning up temp file:`,
          unlinkError
        );
      }

      return result;
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling attachment:`,
        error
      );
      return false;
    }
  }

  /**
   * Handle Discord message
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleDiscordMessage(message) {
    try {
      // Skip bot messages and DMs
      if (message.author.bot || !message.guild) return false;

      // Check if this is in a category we're monitoring
      const categoryId = message.channel.parentId;
      if (!categoryId || categoryId !== this.categoryId) {
        return false;
      }

      // Check for commands first
      if (message.content.startsWith("!")) {
        return await this.handleCommand(message);
      }

      // Get phone number for this channel
      const phoneNumber = this.channelManager.getPhoneNumberByChannelId(
        message.channel.id
      );

      if (!phoneNumber) {
        console.log(
          `[DiscordHandler:${this.instanceId}] No phone number found for channel ${message.channel.id}`
        );
        await message.react("❌");
        return false;
      }

      // Format the message content
      let content = message.content || "";

      // Process mentions in the message content
      const guildId = message.guild.id;

      // Get special channels with careful access paths to avoid circular dependencies
      let specialChannels = {};
      try {
        if (this.customSettings?.specialChannels) {
          specialChannels = this.customSettings.specialChannels;
        } else if (this.instance?.customSettings?.specialChannels) {
          specialChannels = this.instance.customSettings.specialChannels;
        }
      } catch (err) {
        // Silently continue if we can't access special channels
      }

      // Process mentions in the content
      if (content && this.discordClient) {
        content = MentionProcessor.convertDiscordMentionsToText(
          content,
          this.discordClient,
          guildId,
          specialChannels
        );
      }

      // Add agent prefix
      const agentName = message.member?.nickname || message.author.username;
      content = `*${agentName}*: ${content}`;

      // FIXED: Handle attachments with the text message properly
      if (message.attachments.size > 0) {
        // Process each attachment and track successful ones
        let successCount = 0;
        const totalAttachments = message.attachments.size;
        const reactions = [];

        // Initial feedback reaction to show processing
        await message.react("⏳");

        // Process each attachment WITH the message content
        for (const [attachmentId, attachment] of message.attachments) {
          try {
            // IMPROVED: Always include the content with the first attachment, empty for others
            // This ensures text and media arrive together
            const attachmentContent = successCount === 0 ? content : "";

            const success = await this.handleAttachment(
              attachment,
              phoneNumber,
              attachmentContent
            );

            if (success) {
              successCount++;
            } else {
              // Add reaction for the specific failed media type
              if (attachment.contentType?.startsWith("image/")) {
                reactions.push("🖼️");
              } else if (attachment.contentType?.startsWith("video/")) {
                reactions.push("🎥");
              } else if (attachment.contentType?.startsWith("audio/")) {
                reactions.push(
                  attachment.name?.includes("voice") ? "🎤" : "🎵"
                );
              } else {
                reactions.push("📄");
              }
            }
          } catch (attachmentError) {
            console.error(
              `[DiscordHandler:${this.instanceId}] Error processing attachment:`,
              attachmentError
            );
            reactions.push("⚠️");
          }
        }

        // Remove the processing reaction
        try {
          await message.reactions.cache
            .find((r) => r.emoji.name === "⏳")
            ?.remove();
        } catch (e) {
          /* Ignore reaction removal errors */
        }

        // Add specific reaction for failed media types if any
        for (const reaction of reactions) {
          try {
            await message.react(reaction);
          } catch (e) {
            /* Ignore reaction errors */
          }
        }

        // React based on success ratio
        if (successCount === totalAttachments) {
          await message.react("✅");
        } else if (successCount > 0) {
          await message.react("⚠️"); // Some attachments failed
        } else {
          await message.react("❌"); // All attachments failed
          await message.reply(
            "❌ Failed to send media attachments to WhatsApp. Please try again or use a different format."
          );
          return false;
        }
      } else {
        // No attachments, just send the text message
        try {
          await this.whatsAppClient.sendTextMessage(phoneNumber, content);
          await message.react("✅");
        } catch (textError) {
          console.error(
            `[DiscordHandler:${this.instanceId}] Error sending text message:`,
            textError
          );
          await message.react("⚠️");
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling Discord message:`,
        error
      );

      // Try to react with error emoji
      try {
        await message.react("❌");
      } catch (reactError) {
        console.error(
          `[DiscordHandler:${this.instanceId}] Error reacting to message:`,
          reactError
        );
      }

      return false;
    }
  }

  /**
   * Handle Discord command
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleCommand(message) {
    const command = message.content.split(" ")[0].toLowerCase();

    switch (command) {
      case "!close":
        return await this.handleCloseCommand(message);
      case "!vouch":
        return await this.handleVouchCommand(message);
      case "!help":
        return await this.handleHelpCommand(message);
      default:
        return false;
    }
  }

  /**
   * Handle close command
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleCloseCommand(message) {
    try {
      // Get channel ID
      const channelId = message.channel.id;

      // Try to close the ticket
      const success = await this.ticketManager.closeTicket(
        channelId,
        this.customCloseMessage !== false
      );

      if (!success) {
        await message.reply(
          "❌ Failed to close ticket. Please try again or check logs."
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling close command:`,
        error
      );
      await message.reply(`❌ Error: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle vouch command
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleVouchCommand(message) {
    try {
      // Check if vouch handler is available
      if (!this.vouchHandler) {
        await message.reply("❌ Vouch system is not available.");
        return false;
      }

      if (this.vouchHandler.isDisabled) {
        await message.reply("❌ Vouch system is disabled.");
        return false;
      }

      // Get phone number from channel
      const phoneNumber = this.channelManager.getPhoneNumberByChannelId(
        message.channel.id
      );
      if (!phoneNumber) {
        await message.reply("❌ Could not find phone number for this channel.");
        return false;
      }

      // Get user info
      const userCard = await this.userCardManager.getUserInfo(phoneNumber);
      if (!userCard) {
        await message.reply("❌ Could not find user information.");
        return false;
      }

      // Send vouch instructions
      const success = await this.vouchHandler.sendVouchInstructions(
        phoneNumber,
        userCard
      );

      if (success) {
        await message.reply("✅ Vouch instructions sent successfully!");
        return true;
      } else {
        await message.reply("❌ Failed to send vouch instructions.");
        return false;
      }
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling vouch command:`,
        error
      );
      await message.reply(`❌ Error: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle help command
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleHelpCommand(message) {
    try {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Help: Available Commands")
        .setDescription("Here are the commands you can use in this channel:")
        .addFields(
          {
            name: "!close",
            value: "Close this ticket and save a transcript",
            inline: false,
          },
          {
            name: "!vouch",
            value: "Send vouch instructions to the customer",
            inline: false,
          },
          { name: "!help", value: "Show this help message", inline: false }
        )
        .setFooter({ text: `WhatsApp Bridge | ${this.instanceId}` });

      await message.reply({ embeds: [embed] });
      return true;
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling help command:`,
        error
      );
      await message.reply(`❌ Error: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle interaction create event
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleInteraction(interaction) {
    try {
      // Handle button interactions with legacy IDs for backward compatibility
      if (interaction.isButton()) {
        // First check for the new button IDs that are handled via separate files
        // but provide backward compatibility if those don't get processed

        // Handle edit button (legacy format)
        if (interaction.customId.startsWith("edit-user-")) {
          console.log(
            `[DiscordHandler:${this.instanceId}] Legacy handling for edit-user button`
          );
          return await this.handleEditTicketButton(interaction);
        }

        // Handle close button (legacy format)
        else if (interaction.customId.startsWith("close-ticket-")) {
          console.log(
            `[DiscordHandler:${this.instanceId}] Legacy handling for close-ticket button`
          );

          // Extract channel ID from the button's custom ID
          const channelId = interaction.channelId; // Use current channel ID

          await interaction.deferReply({ ephemeral: true });

          // Try to close the ticket with the channel ID
          const success = await this.ticketManager.closeTicket(
            channelId,
            true,
            interaction
          );

          if (!success) {
            await interaction.editReply(
              "❌ Failed to close ticket. Please try again or check logs."
            );
            return false;
          }

          await interaction.editReply("✅ Ticket closed successfully!");
          return true;
        }

        // Handle other button types
        else if (interaction.customId === "close_ticket") {
          // Old format close button without channel ID
          await interaction.deferReply({ ephemeral: true });
          const success = await this.ticketManager.closeTicket(
            interaction.channelId,
            true,
            interaction
          );

          if (!success) {
            await interaction.editReply(
              "❌ Failed to close ticket. Please try again or check logs."
            );
            return false;
          }

          await interaction.editReply("✅ Ticket closed successfully!");
          return true;
        }

        // Add other legacy button handling here if needed
      }

      // Handle modal submissions (legacy format)
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith("edit_ticket_modal_")) {
          console.log(
            `[DiscordHandler:${this.instanceId}] Legacy handling for edit ticket modal`
          );
          return await this.handleEditTicketModal(interaction);
        }

        // Add other legacy modal handling here if needed
      }

      return false; // Pass to other handlers if not handled here
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling interaction:`,
        error
      );

      try {
        if (!interaction.replied) {
          await interaction.reply({
            content: `❌ Error: ${error.message}`,
            ephemeral: true,
          });
        } else {
          await interaction.followUp({
            content: `❌ Error: ${error.message}`,
            ephemeral: true,
          });
        }
      } catch (replyError) {
        console.error(
          `[DiscordHandler:${this.instanceId}] Error sending error message:`,
          replyError
        );
      }

      return false;
    }
  }

  /**
   * Handle close ticket button
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleCloseTicketButton(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Get channel ID from button ID
      const channelId = interaction.customId.replace("close-ticket-", "");

      // Try to close the ticket
      const success = await this.ticketManager.closeTicket(
        channelId,
        this.customCloseMessage !== false
      );

      if (!success) {
        await interaction.editReply(
          "❌ Failed to close ticket. Please try again or check logs."
        );
        return false;
      }

      await interaction.editReply("✅ Ticket closed successfully!");
      return true;
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling close ticket button:`,
        error
      );
      await interaction.editReply(`❌ Error: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle vouch instructions button
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleVouchInstructionsButton(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Check if vouch handler is available
      if (!this.vouchHandler) {
        await interaction.editReply("❌ Vouch system is not available.");
        return false;
      }

      if (this.vouchHandler.isDisabled) {
        await interaction.editReply("❌ Vouch system is disabled.");
        return false;
      }

      // Get phone number from channel
      const phoneNumber = this.channelManager.getPhoneNumberByChannelId(
        interaction.channel.id
      );
      if (!phoneNumber) {
        await interaction.editReply(
          "❌ Could not find phone number for this channel."
        );
        return false;
      }

      // Get user info
      const userCard = await this.userCardManager.getUserInfo(phoneNumber);
      if (!userCard) {
        await interaction.editReply("❌ Could not find user information.");
        return false;
      }

      // Send vouch instructions
      const success = await this.vouchHandler.sendVouchInstructions(
        phoneNumber,
        userCard
      );

      if (success) {
        await interaction.editReply("✅ Vouch instructions sent successfully!");
        return true;
      } else {
        await interaction.editReply("❌ Failed to send vouch instructions.");
        return false;
      }
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling vouch instructions button:`,
        error
      );
      await interaction.editReply(`❌ Error: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle edit ticket button
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleEditTicketButton(interaction) {
    try {
      // Get phone number from button ID
      const phoneNumber = interaction.customId.replace("edit-user-", "");

      // Get user info
      const userInfo = this.userCardManager.getUserInfo(phoneNumber);
      const username = userInfo ? userInfo.username : "Unknown User";

      // Find the embed message to get current info
      const messages = await interaction.channel.messages.fetchPinned();
      const embedMessage = messages.find(
        (m) => m.embeds.length > 0 && m.embeds[0].title === "Ticket Tool"
      );

      let currentNotes = "No notes provided yet.";
      if (embedMessage && embedMessage.embeds[0]) {
        // Extract notes from fields
        const notesField = embedMessage.embeds[0].fields.find(
          (field) => field.name === "Notes"
        );
        if (notesField && notesField.value) {
          // Strip the code block markers from the notes
          currentNotes = notesField.value.replace(/```/g, "").trim();
          if (
            currentNotes ===
            "No notes provided yet. Use the Edit button to add details."
          ) {
            currentNotes = "";
          }
        }
      }

      // Create modal
      const modal = new ModalBuilder()
        .setCustomId(`edit_ticket_modal_${phoneNumber}`)
        .setTitle("Edit Ticket Information");

      // Username input
      const usernameInput = new TextInputBuilder()
        .setCustomId("ticket_username")
        .setLabel("Username")
        .setStyle(TextInputStyle.Short)
        .setValue(username)
        .setRequired(true);

      // Notes input
      const notesInput = new TextInputBuilder()
        .setCustomId("ticket_notes")
        .setLabel("Notes")
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentNotes)
        .setPlaceholder("Add notes about this support ticket here");

      const firstRow = new ActionRowBuilder().addComponents(usernameInput);
      const secondRow = new ActionRowBuilder().addComponents(notesInput);

      modal.addComponents(firstRow, secondRow);

      await interaction.showModal(modal);
      return true;
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling edit ticket button:`,
        error
      );

      try {
        await interaction.reply({
          content: `❌ Error: ${error.message}`,
          ephemeral: true,
        });
      } catch (replyError) {
        console.error(
          `[DiscordHandler:${this.instanceId}] Error replying with error:`,
          replyError
        );
      }

      return false;
    }
  }

  /**
   * Handle edit ticket modal
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleEditTicketModal(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Get phoneNumber from modal ID
      const phoneNumber = interaction.customId.replace(
        "edit_ticket_modal_",
        ""
      );

      // Get updated data
      const newUsername =
        interaction.fields.getTextInputValue("ticket_username");
      const newNotes =
        interaction.fields.getTextInputValue("ticket_notes") ||
        "No notes provided.";

      // Handle username change
      let usernameUpdated = false;
      if (newUsername && phoneNumber) {
        // Update user card
        if (this.userCardManager) {
          // Use getUserInfo and setUserInfo methods for consistency
          const oldUserInfo = await this.userCardManager.getUserInfo(
            phoneNumber
          );
          const oldUsername = oldUserInfo ? oldUserInfo.username : "";

          if (oldUsername !== newUsername) {
            await this.userCardManager.setUserInfo(phoneNumber, newUsername);
            usernameUpdated = true;

            // Update channel name
            const channelId = this.channelManager.getChannelId(phoneNumber);
            if (channelId) {
              const channel = this.discordClient.channels.cache.get(channelId);
              if (channel) {
                // Format new channel name
                const formattedUsername = newUsername
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "-")
                  .replace(/-+/g, "-")
                  .substring(0, 25);
                const newChannelName = `📋-${formattedUsername}`;

                if (channel.name !== newChannelName) {
                  await channel.setName(newChannelName, "Updated username");
                }
              }
            }
          }
        }
      }

      // Find the embed message using multiple strategies
      let embedMessage = null;
      const channelId = interaction.channelId;

      // First try: Load pinned messages (most efficient as ticket info is pinned)
      const pinnedMessages = await interaction.channel.messages.fetchPinned();
      embedMessage = pinnedMessages.find(
        (m) => m.embeds.length > 0 && m.embeds[0].title === "Ticket Tool"
      );

      // Second try: Check if we have stored the message ID in settings
      if (!embedMessage) {
        try {
          if (
            this.channelManager &&
            typeof this.channelManager.getInstanceSettings === "function"
          ) {
            const settings = await this.channelManager.getInstanceSettings(
              this.instanceId
            );
            const ticketInfoMessages = settings.ticketInfoMessages || {};

            if (ticketInfoMessages[channelId]) {
              try {
                embedMessage = await interaction.channel.messages.fetch(
                  ticketInfoMessages[channelId]
                );
              } catch (fetchError) {
                console.error(
                  `[DiscordHandler:${this.instanceId}] Error fetching stored message:`,
                  fetchError
                );
              }
            }
          }
        } catch (settingsError) {
          console.error(
            `[DiscordHandler:${this.instanceId}] Error checking settings:`,
            settingsError
          );
        }
      }

      // Third try: Load more messages (fallback)
      if (!embedMessage) {
        const messages = await interaction.channel.messages.fetch({
          limit: 50,
        });
        embedMessage = messages.find(
          (m) => m.embeds.length > 0 && m.embeds[0].title === "Ticket Tool"
        );
      }

      // Update the embed if found
      if (embedMessage) {
        const originalEmbed = embedMessage.embeds[0];

        // Create updated embed with the exact format specified
        const updatedEmbed = new EmbedBuilder()
          .setColor(0x00ae86)
          .setTitle("Ticket Tool")
          .setDescription(
            `\`\`\`${newUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``
          )
          .addFields(
            {
              name: "Opened Ticket",
              value: `${new Date(
                embedMessage.createdTimestamp
              ).toLocaleString()}`,
              inline: false,
            },
            {
              name: "Notes",
              value: `\`\`\`${newNotes}\`\`\``,
              inline: false,
            }
          )
          .setTimestamp(originalEmbed.timestamp);

        // Preserve the original button components
        await embedMessage.edit({
          embeds: [updatedEmbed],
          components: embedMessage.components,
        });

        // Update the reply message
        let replyMessage = "✅ Ticket information updated successfully!";
        if (usernameUpdated) {
          replyMessage +=
            "\n\nUsername has been updated, which might affect where conversation history is stored. If needed, staff can search both old and new usernames for transcripts.";
        }

        await interaction.editReply(replyMessage);
      } else {
        await interaction.editReply({
          content:
            "❌ Could not find ticket information message to update. Please try the following:\n" +
            "1. Check if the ticket information message was deleted or unpinned\n" +
            "2. Try closing this ticket and creating a new one\n" +
            "3. Contact support if the issue persists",
          ephemeral: true,
        });
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `[DiscordHandler:${this.instanceId}] Error handling edit ticket modal:`,
        error
      );
      await interaction.editReply(`❌ Error: ${error.message}`);
      return false;
    }
  }
}

module.exports = DiscordHandler;

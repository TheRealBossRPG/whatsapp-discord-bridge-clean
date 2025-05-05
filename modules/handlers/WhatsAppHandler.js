// modules/handlers/WhatsAppHandler.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const MentionProcessor = require("../../utils/mentionProcessor");

/**
 * WhatsAppHandler class for handling WhatsApp interactions
 */
class WhatsAppHandler {
  /**
   * Create a new WhatsAppHandler
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} userCardManager - User card manager
   * @param {Object} channelManager - Channel manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} vouchHandler - Vouch handler
   * @param {Object} options - Handler options
   */
  constructor(
    whatsAppClient,
    userCardManager,
    channelManager,
    ticketManager,
    transcriptManager,
    vouchHandler,
    options = {}
  ) {
    this.whatsAppClient = whatsAppClient;
    this.userCardManager = userCardManager;
    this.channelManager = channelManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.vouchHandler = vouchHandler;
    this.tempDir = options.tempDir || path.join(__dirname, "temp");
    this.instanceId = options.instanceId || "default";

    this.mentionProcessor = options.mentionProcessor;

    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Default messages
    this.welcomeMessage =
      "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
    this.introMessage =
      "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
    this.reopenTicketMessage =
      "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";

    console.log(`[WhatsAppHandler:${this.instanceId}] Initialized`);
  }

  /**
   * Handle incoming WhatsApp message
   * @param {Object} message - WhatsApp message
   * @returns {Promise<boolean>} - Success status
   */
  async handleMessage(message) {
    try {
      // Extract user ID
      const userId = this.channelManager.extractUserIdFromMessage(message);
      if (!userId) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Could not extract user ID from message`
        );
        return false;
      }

      // Get message content
      const content = this.getTextFromMessage(message);
      const hasMedia = this.isMediaMessage(message);

      // CRITICAL FIX: Get existing user info FIRST and log it
      const existingUserInfo = this.userCardManager.getUserInfo(userId);
      console.log(
        `[WhatsAppHandler:${this.instanceId}] Looking up user ${userId}, found:`,
        existingUserInfo ? JSON.stringify(existingUserInfo) : "no existing info"
      );

      // Initialize user state tracker if needed
      if (!this.userState) {
        this.userState = new Map();
      }

      // Get or create user state with proper username initialization
      let userState = this.userState.get(userId);
      if (!userState) {
        // IMPORTANT: If we have existing username, we're in active stage
        const hasValidUsername =
          existingUserInfo &&
          existingUserInfo.username &&
          existingUserInfo.username !== "Unknown User";

        userState = {
          stage: hasValidUsername ? "active" : "new",
          messages: [],
          username: hasValidUsername ? existingUserInfo.username : null,
          hasTicket: false,
          welcomedBack: false,
        };

        this.userState.set(userId, userState);
      }

      // Add message to history
      userState.messages.push({
        content,
        timestamp: Date.now(),
        isMedia: hasMedia,
      });

      // Process based on conversation stage
      switch (userState.stage) {
        case "new":
          // Send welcome message
          await this.whatsAppClient.sendTextMessage(
            userId,
            this.welcomeMessage || "Welcome! What's your name?"
          );
          userState.stage = "greeted";
          this.userState.set(userId, userState);
          return true;

        case "greeted":
          // Process user's name response
          const username = this.sanitizeUsername(content);
          userState.username = username;

          // CRITICAL FIX: Save user info immediately and properly
          console.log(
            `[WhatsAppHandler:${this.instanceId}] Setting username for ${userId} to "${username}"`
          );
          this.userCardManager.setUserInfo(userId, username);

          // Send intro message
          const introMessage = (
            this.introMessage || "Nice to meet you, {name}!"
          ).replace(/{name}/g, username);
          await this.whatsAppClient.sendTextMessage(userId, introMessage);

          // Create ticket
          const ticketCreated = await this.ticketManager.createTicket(
            userId,
            username
          );
          userState.stage = "active";
          userState.hasTicket = ticketCreated;
          this.userState.set(userId, userState);
          return ticketCreated;

        case "active":
          // CRITICAL FIX: Better handle existing user case
          // Check if user has an active ticket channel
          let channelId = this.channelManager.getUserChannel(userId);

          if (channelId) {
            // Channel exists - use it regardless of userState
            userState.hasTicket = true; // Update userState to reflect reality
            console.log(
              `[WhatsAppHandler:${this.instanceId}] Using existing channel ${channelId} for ${userId}`
            );
            return await this.processMessage(message, userId, channelId);
          }

          if (!channelId || !userState.hasTicket) {
            // Get username - prefer userState, fallback to stored info
            const username =
              userState.username ||
              (existingUserInfo ? existingUserInfo.username : "Unknown User");

            // If returning user, send welcome back message
            if (!userState.welcomedBack) {
              console.log(
                `[WhatsAppHandler:${this.instanceId}] Sending welcome back message to ${username} (${userId})`
              );
              const reopenMessage = (
                this.reopenTicketMessage || "Welcome back, {name}!"
              ).replace(/{name}/g, username);
              await this.whatsAppClient.sendTextMessage(userId, reopenMessage);
              userState.welcomedBack = true;
            }

            // Create a new ticket
            console.log(
              `[WhatsAppHandler:${this.instanceId}] Creating new ticket for ${username} (${userId})`
            );
            const newTicket = await this.ticketManager.createTicket(
              userId,
              username
            );
            userState.hasTicket = !!newTicket;
            this.userState.set(userId, userState);

            // If ticket created successfully, forward the current message
            if (newTicket) {
              return await this.processMessage(message, userId, newTicket.id);
            }
            return false;
          }

          // Forward message to existing ticket
          return await this.processMessage(message, userId, channelId);

        default:
          console.error(
            `[WhatsAppHandler:${this.instanceId}] Unknown stage: ${userState.stage}`
          );
          return false;
      }
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling message:`,
        error
      );
      return false;
    }
  }

  /**
   * Sanitize username input
   * @param {string} input - Raw username input
   * @returns {string} - Sanitized username
   */
  sanitizeUsername(input) {
    if (!input) return "Unknown User";

    // Remove any leading/trailing whitespace
    let username = input.trim();

    // Limit length
    if (username.length > 32) {
      username = username.substring(0, 32);
    }

    // Remove any potential Discord markdown
    username = username
      .replace(/\*/g, "")
      .replace(/~/g, "")
      .replace(/`/g, "")
      .replace(/>/g, "")
      .replace(/\|/g, "");

    return username || "Unknown User";
  }

  /**
   * Process message for existing ticket channel
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<boolean>} - Success status
   */
  async processMessage(message, sender, channelId) {
    try {
      // Get the text content from the message
      const text = this.getTextFromMessage(message);

      // Process vouch commands if they exist
      if (
        typeof text === "string" &&
        text.trim().toLowerCase().startsWith("vouch!")
      ) {
        // Check if vouch handler is available
        if (this.vouchHandler && !this.vouchHandler.isDisabled) {
          const userCard = this.userCardManager.getUserInfo(sender);
          const result = await this.vouchHandler.handleVouch(
            sender,
            { text },
            userCard,
            message
          );
          // If vouch was handled successfully, don't process as normal message
          if (result) return true;
        }
      }

      // Check for different media types
      // First check for stickers specifically
      if (message.message?.stickerMessage) {
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Detected sticker message`
        );
        return await this.handleStickerMessage(
          message,
          sender,
          channelId,
          text
        );
      }

      // Check for other media types
      if (message.message?.imageMessage) {
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Detected image message`
        );
        return await this.handleMediaMessage(
          message,
          sender,
          channelId,
          "image",
          text
        );
      } else if (message.message?.videoMessage) {
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Detected video message`
        );
        return await this.handleMediaMessage(
          message,
          sender,
          channelId,
          "video",
          text
        );
      } else if (message.message?.documentMessage) {
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Detected document message`
        );
        return await this.handleMediaMessage(
          message,
          sender,
          channelId,
          "document",
          text
        );
      } else if (message.message?.audioMessage) {
        // Check if it's a voice note (ptt = push to talk)
        const isVoice = message.message.audioMessage.ptt === true;
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Detected ${
            isVoice ? "voice" : "audio"
          } message`
        );
        return await this.handleMediaMessage(
          message,
          sender,
          channelId,
          isVoice ? "voice" : "audio",
          text
        );
      } else if (message.message?.locationMessage) {
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Detected location message`
        );
        return await this.handleLocationMessage(message, sender, channelId);
      } else if (message.message?.contactMessage) {
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Detected contact message`
        );
        return await this.handleContactMessage(message, sender, channelId);
      } else {
        // Default to text message handling
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Detected text message`
        );
        return await this.handleTextMessage(message, sender, channelId);
      }
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error processing message:`,
        error
      );
      return false;
    }
  }

  /**
   * Get sender ID from message
   * @param {Object} message - WhatsApp message
   * @returns {string} - Sender ID
   */
  getSenderFromMessage(message) {
    try {
      // CRITICAL FIX: Handle different message formats
      // The message structure can vary depending on message type and Baileys version
      const sender =
        // New baileys format
        message.key?.remoteJid ||
        // Legacy format
        message.from ||
        // Other possible locations
        message.participant ||
        message.sender?.id ||
        null;

      return sender;
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error getting sender:`,
        error
      );
      return null;
    }
  }

  /**
   * Check if a message contains media
   * @param {Object} message - WhatsApp message object
   * @returns {boolean} - Whether the message contains media
   */
  isMediaMessage(message) {
    if (!message) return false;

    // Extract the message content
    const messageContent = message.message || {};

    // Check for various media types
    return !!(
      messageContent.imageMessage ||
      messageContent.videoMessage ||
      messageContent.audioMessage ||
      messageContent.documentMessage ||
      messageContent.stickerMessage ||
      messageContent.viewOnceMessage ||
      messageContent.viewOnceMessageV2 ||
      messageContent.documentWithCaptionMessage ||
      // Backwards compatibility with older Baileys versions
      messageContent.documentWithCaption
    );
  }

  /**
   * Get text content from a message
   * @param {Object} message - WhatsApp message
   * @returns {string} - Text content or empty string
   */
  getTextFromMessage(message) {
    try {
      // CRITICAL FIX: Handle different message formats safely
      // First check if we have a message object
      if (!message) return "";

      // Try different potential locations for the text content
      let text = "";

      // Modern baileys format (primary)
      if (message.message) {
        if (typeof message.message === "object") {
          // Check conversation (plain text)
          if (message.message.conversation) {
            text = message.message.conversation;
          }
          // Check extendedTextMessage
          else if (message.message.extendedTextMessage?.text) {
            text = message.message.extendedTextMessage.text;
          }
          // Check buttonsResponseMessage
          else if (
            message.message.buttonsResponseMessage?.selectedDisplayText
          ) {
            text = message.message.buttonsResponseMessage.selectedDisplayText;
          }
          // Check listResponseMessage
          else if (message.message.listResponseMessage?.title) {
            text = message.message.listResponseMessage.title;
          }
          // Check templateButtonReplyMessage
          else if (
            message.message.templateButtonReplyMessage?.selectedDisplayText
          ) {
            text =
              message.message.templateButtonReplyMessage.selectedDisplayText;
          }
        } else if (typeof message.message === "string") {
          // Direct string message
          text = message.message;
        }
      }
      // Legacy or alternative formats
      else if (message.text) {
        text = typeof message.text === "string" ? message.text : "";
      } else if (message.body) {
        text = typeof message.body === "string" ? message.body : "";
      }

      // Ensure we return a string
      return text ? String(text) : "";
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error getting message text:`,
        error
      );
      return ""; // Return empty string on error
    }
  }

  /**
   * Ultra-simplified sticker handler
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
   * @param {string} caption - Optional caption text
   * @returns {Promise<boolean>} - Success status
   */
  async handleStickerMessage(message, sender, channelId, caption = "") {
    try {
      console.log(
        `[WhatsAppHandler:${this.instanceId}] Processing sticker message - simplified approach`
      );

      // Get user info
      const userInfo = this.userCardManager.getUserInfo(sender);
      const username = userInfo?.username || "Unknown User";

      // Let's skip the placeholder message to eliminate any possible interference

      // Use the simplest approach possible - just use the WhatsApp client directly
      if (!this.whatsAppClient) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] WhatsApp client not available`
        );
        return false;
      }

      try {
        // Just get the raw buffer from client with no options
        const mediaData = await this.whatsAppClient.downloadMedia(message);

        if (!mediaData || !mediaData.buffer || mediaData.buffer.length === 0) {
          throw new Error("Empty sticker data received");
        }

        // Write to file with minimal code
        const tempFilePath = path.join(
          this.tempDir,
          `sticker_${Date.now()}.webp`
        );
        fs.writeFileSync(tempFilePath, mediaData.buffer);

        // Create content string
        const content = `**${username}**: ${caption || ""} [Sticker]`;

        // Forward to Discord
        const success = await this.ticketManager.forwardUserMessage(
          sender,
          {
            content: content,
            files: [tempFilePath],
          },
          true
        );

        // Cleanup immediately after forwarding (no delay)
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          // Ignore cleanup errors
        }

        return success;
      } catch (innerError) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Sticker processing failed:`,
          innerError
        );

        // Just send a text message indicating sticker was received
        await this.ticketManager.forwardUserMessage(
          sender,
          `**${username}**: ${
            caption || ""
          } [Sticker - could not be displayed]`,
          false
        );

        // Still return true since we did handle the message in some way
        return true;
      }
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Sticker handler error:`,
        error
      );
      return false;
    }
  }

  async handleTextMessage(message, sender, channelId) {
    try {
      // Get the text content
      const text = this.getTextFromMessage(message);

      // Skip if no text content
      if (!text || !text.trim()) {
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Empty text message, skipping`
        );
        return false;
      }

      // Get user info
      const userInfo = this.userCardManager.getUserInfo(sender);
      const username = userInfo?.username || "Unknown User";

      // Process any channel mentions in the text
      let processedText = text;

      // Access necessary references for mention processing
      const discordClient = this.ticketManager?.discordClient;
      const guildId = this.ticketManager?.guildId;

      // Get special channels from settings - carefully access to avoid circular dependencies
      let specialChannels = {};
      try {
        // Find special channels through various possible paths
        if (this.ticketManager?.customSettings?.specialChannels) {
          specialChannels = this.ticketManager.customSettings.specialChannels;
        } else if (
          this.ticketManager?.instance?.customSettings?.specialChannels
        ) {
          specialChannels =
            this.ticketManager.instance.customSettings.specialChannels;
        }
      } catch (err) {
        // Silently continue if we can't access special channels
      }

      // Process mentions if we have the needed references
      if (discordClient && guildId) {
        processedText = MentionProcessor.processChannelAndUserMentions(
          text,
          discordClient,
          guildId,
          specialChannels
        );
      }

      // Forward message to Discord with processed text
      const success = await this.ticketManager.forwardUserMessage(
        sender,
        processedText,
        false
      );

      // Update the user's status and last activity
      if (userInfo) {
        this.userCardManager.setUserInfo(sender, username, {
          lastMessage: text,
          lastActivity: Date.now(),
          status: "active",
        });
      }

      return success;
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling text message:`,
        error
      );
      return false;
    }
  }

  /**
   * Handle media message (image, video, document, audio)
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
   * @param {string} mediaType - Media type
   * @param {string} caption - Optional pre-extracted caption
   * @returns {Promise<boolean>} - Success status
   */
  async handleMediaMessage(
    message,
    sender,
    channelId,
    mediaType,
    caption = ""
  ) {
    try {
      // Get user info
      const userInfo = this.userCardManager.getUserInfo(sender);
      const username = userInfo?.username || "Unknown User";

      // If caption not provided, extract it from the message
      if (!caption) {
        // Safely extract the caption from various message types
        if (message.message?.imageMessage?.caption) {
          caption = message.message.imageMessage.caption;
        } else if (message.message?.videoMessage?.caption) {
          caption = message.message.videoMessage.caption;
        } else if (message.message?.documentMessage?.caption) {
          caption = message.message.documentMessage.caption;
        } else if (message.caption) {
          caption = message.caption;
        }
      }

      // Create a waiting message to notify that media is being processed
      const placeholderId = await this.ticketManager.forwardUserMessage(
        sender,
        `**${username}**: ${
          caption ? caption : ""
        } *[${mediaType} downloading...]*`,
        false
      );

      // Download media
      let mediaData = null;
      try {
        // Verify WhatsApp client exists
        if (!this.whatsAppClient) {
          console.error(
            `[WhatsAppHandler:${this.instanceId}] WhatsApp client not available`
          );
          return false;
        }

        // Download the media using the client's method
        console.log(
          `[WhatsAppHandler:${this.instanceId}] Attempting to download media...`
        );
        mediaData = await this.whatsAppClient.downloadMedia(message);

        // If download failed, log and return early
        if (!mediaData || !mediaData.buffer) {
          console.error(
            `[WhatsAppHandler:${this.instanceId}] Failed to download media`
          );
          await this.ticketManager.forwardUserMessage(
            sender,
            `**${username}**: ${
              caption ? caption : ""
            } *[${mediaType} download failed]*`,
            false
          );
          return false;
        }

        console.log(
          `[WhatsAppHandler:${this.instanceId}] Successfully downloaded ${mediaType} (${mediaData.buffer.length} bytes)`
        );
      } catch (downloadError) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Error downloading media:`,
          downloadError
        );
        await this.ticketManager.forwardUserMessage(
          sender,
          `**${username}**: ${
            caption ? caption : ""
          } *[Error downloading media: ${downloadError.message}]*`,
          false
        );
        return false;
      }

      // Get appropriate file extension
      let extension;
      if (mediaType === "voice" || mediaType === "ptt") {
        extension = ".ogg";
      } else if (mediaType === "image") {
        extension =
          mediaData.mimetype && mediaData.mimetype.includes("png")
            ? ".png"
            : ".jpg";
      } else if (mediaType === "video") {
        extension = ".mp4";
      } else if (mediaType === "audio") {
        extension = ".mp3";
      } else if (mediaType === "sticker") {
        extension = ".webp";
      } else {
        extension = this.getExtensionFromMimeType(
          mediaData.mimetype || "application/octet-stream"
        );
      }

      // Create filename and save to temp directory
      const timestamp = Date.now();
      const filename = `${mediaType}_${timestamp}_${sender.replace(
        /[^\w]/g,
        "_"
      )}${extension}`;
      const filepath = path.join(this.tempDir, filename);

      // Write the media to file
      fs.writeFileSync(filepath, mediaData.buffer);

      // Add media type label for voice messages
      let mediaLabel = "";
      if (mediaType === "voice" || mediaType === "ptt") {
        mediaLabel = " [Voice Message]";
      } else if (mediaType === "audio") {
        mediaLabel = " [Audio]";
      }

      // Create content with username and caption
      const formattedContent = `**${username}**: ${caption || ""}${mediaLabel}`;

      // Forward the media to Discord
      const success = await this.ticketManager.forwardUserMessage(
        sender,
        {
          content: formattedContent,
          files: [filepath],
        },
        true
      );

      // Update the user's status and last activity
      if (userInfo && success) {
        this.userCardManager.setUserInfo(sender, username, {
          lastMessage: caption || `[${mediaType}]`,
          lastActivity: Date.now(),
          status: "active",
        });
      }

      // Cleanup temp file after delay to ensure Discord has time to process it
      setTimeout(() => {
        try {
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        } catch (unlinkError) {
          console.error(
            `[WhatsAppHandler:${this.instanceId}] Error deleting temp file:`,
            unlinkError
          );
        }
      }, 60000); // 1 minute delay

      return success;
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling ${mediaType} message:`,
        error
      );
      return false;
    }
  }

  /**
   * Handle location message
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<boolean>} - Success status
   */
  async handleLocationMessage(message, sender, channelId) {
    try {
      // Get location data
      const locationMessage =
        message.message?.locationMessage || message.location || {};
      const latitude =
        locationMessage.degreesLatitude || locationMessage.latitude || 0;
      const longitude =
        locationMessage.degreesLongitude || locationMessage.longitude || 0;

      // Skip if invalid location
      if (!latitude || !longitude) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Invalid location data`
        );
        return false;
      }

      // Get user info
      const userInfo = this.userCardManager.getUserInfo(sender);
      const username = userInfo?.username || "Unknown User";

      // Generate Google Maps link
      const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

      // Forward location message
      const locationText = `**${username}**: 📍 *Location shared*\n${mapsLink}`;
      const success = await this.ticketManager.forwardUserMessage(
        sender,
        locationText,
        false
      );

      // Update the user's status and last activity
      if (userInfo) {
        this.userCardManager.setUserInfo(sender, username, {
          lastMessage: "[Location]",
          lastActivity: Date.now(),
          status: "active",
        });
      }

      return success;
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling location message:`,
        error
      );
      return false;
    }
  }

  /**
   * Handle contact message
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
   * @returns {Promise<boolean>} - Success status
   */
  async handleContactMessage(message, sender, channelId) {
    try {
      // Get contact data
      const contactMessage =
        message.message?.contactMessage || message.contacts?.[0] || {};
      const vcard = contactMessage.vcard || "";

      // Extract contact info from vcard
      let contactName = contactMessage.displayName || "Unknown Contact";
      let contactPhone = "";

      // Try to extract phone number from vcard
      if (vcard) {
        const phoneMatch = vcard.match(/TEL[^:]*:(.*)/i);
        if (phoneMatch && phoneMatch[1]) {
          contactPhone = phoneMatch[1].trim();
        }
      }

      // Get user info
      const userInfo = this.userCardManager.getUserInfo(sender);
      const username = userInfo?.username || "Unknown User";

      // Forward contact message
      let contactText = `**${username}**: 📒 *Contact shared*\nName: ${contactName}`;
      if (contactPhone) {
        contactText += `\nPhone: ${contactPhone}`;
      }

      const success = await this.ticketManager.forwardUserMessage(
        sender,
        contactText,
        false
      );

      // Update the user's status and last activity
      if (userInfo) {
        this.userCardManager.setUserInfo(sender, username, {
          lastMessage: "[Contact]",
          lastActivity: Date.now(),
          status: "active",
        });
      }

      return success;
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling contact message:`,
        error
      );
      return false;
    }
  }

  /**
   * Get default file extension based on media type
   * @param {string} mediaType - Media type
   * @returns {string} - File extension with dot
   */
  getDefaultExtension(mediaType) {
    const typeToExt = {
      image: ".jpg",
      video: ".mp4",
      audio: ".mp3",
      voice: ".ogg",
      ptt: ".ogg",
      sticker: ".webp",
      document: ".bin",
    };

    return typeToExt[mediaType] || ".bin";
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} - File extension with dot
   */
  getExtensionFromMimeType(mimeType) {
    const extensions = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "video/mp4": ".mp4",
      "video/mpeg": ".mpeg",
      "video/quicktime": ".mov",
      "audio/mpeg": ".mp3",
      "audio/ogg": ".ogg",
      "audio/wav": ".wav",
      "application/pdf": ".pdf",
      "application/msword": ".doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        ".docx",
      "application/vnd.ms-excel": ".xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        ".xlsx",
      "application/vnd.ms-powerpoint": ".ppt",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        ".pptx",
      "text/plain": ".txt",
    };

    return extensions[mimeType] || ".bin";
  }
}

module.exports = WhatsAppHandler;

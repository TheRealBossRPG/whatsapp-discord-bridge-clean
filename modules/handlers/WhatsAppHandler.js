// modules/handlers/WhatsAppHandler.js
const fs = require("fs");
const path = require("path");
const BaileysMessage = require("../clients/baileys/BaileysMessage.js");

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
      const baileysMessage = require("../clients/baileys/BaileysMessage.js");
      const baileysMessageInstance = new BaileysMessage();
      const content = baileysMessageInstance.extractMessageText(message);
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
   * Process message for existing ticket channel
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
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

      // IMPROVED: Better media type detection
      // First check for stickers specifically
      if (message.message?.stickerMessage) {
        // Handle sticker message specially
        return await this.handleStickerMessage(
          message,
          sender,
          channelId,
          text
        );
      }

      // Then check for other media types
      if (
        message.message?.imageMessage ||
        message.image ||
        message.mimetype?.startsWith("image/")
      ) {
        // Handle image message
        return await this.handleMediaMessage(
          message,
          sender,
          channelId,
          "image",
          text
        );
      } else if (
        message.message?.videoMessage ||
        message.video ||
        message.mimetype?.startsWith("video/")
      ) {
        // Handle video message
        return await this.handleMediaMessage(
          message,
          sender,
          channelId,
          "video",
          text
        );
      } else if (
        message.message?.documentMessage ||
        message.document ||
        message.mimetype?.startsWith("application/")
      ) {
        // Handle document message
        return await this.handleMediaMessage(
          message,
          sender,
          channelId,
          "document",
          text
        );
      } else if (
        message.message?.audioMessage ||
        message.audio ||
        message.mimetype?.startsWith("audio/")
      ) {
        // IMPROVED: Better voice message detection
        // Check if it's a voice note (ptt = push to talk)
        const isVoice =
          message.message?.audioMessage?.ptt === true ||
          (message.message?.audioMessage &&
            (message.message.audioMessage.mimetype === "audio/ogg" ||
              message.message.audioMessage.mimetype?.includes("opus")));

        // Handle audio/voice message
        return await this.handleMediaMessage(
          message,
          sender,
          channelId,
          isVoice ? "voice" : "audio",
          text
        );
      } else if (message.message?.locationMessage || message.location) {
        // Handle location message
        return await this.handleLocationMessage(message, sender, channelId);
      } else if (message.message?.contactMessage || message.contacts) {
        // Handle contact message
        return await this.handleContactMessage(message, sender, channelId);
      } else {
        // Default to text message handling
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
   * Handle sticker message specifically
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
   * @param {string} caption - Optional caption text
   */
  async handleStickerMessage(message, sender, channelId, caption = "") {
    try {
      console.log(
        `[WhatsAppHandler:${this.instanceId}] Processing sticker message`
      );

      // Get user info
      const userInfo = this.userCardManager.getUserInfo(sender);
      const username = userInfo?.username || "Unknown User";

      // Create a waiting message to notify that sticker is being processed
      const placeholderId = await this.ticketManager.forwardUserMessage(
        sender,
        `**${username}**: ${caption ? caption : ""} *[sticker downloading...]*`,
        false
      );

      // Download sticker
      let mediaData = null;
      try {
        // Make sure we have a WhatsApp client
        if (!this.whatsAppClient) {
          throw new Error("WhatsApp client is not available");
        }

        // Attempt to download the sticker
        mediaData = await this.whatsAppClient.downloadMedia(message);

        // If download failed, log and return early
        if (!mediaData || !mediaData.buffer) {
          console.error(
            `[WhatsAppHandler:${this.instanceId}] Failed to download sticker`
          );
          return false;
        }

        console.log(
          `[WhatsAppHandler:${this.instanceId}] Successfully downloaded sticker (${mediaData.buffer.length} bytes)`
        );
      } catch (downloadError) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Error downloading sticker:`,
          downloadError
        );
        return false;
      }

      // Force webp extension for stickers since they are webp format
      const timestamp = Date.now();
      const filename = `sticker_${timestamp}_${sender.replace(
        /[^\w]/g,
        "_"
      )}.webp`;
      const filepath = path.join(this.tempDir, filename);

      // Write the sticker to file
      fs.writeFileSync(filepath, mediaData.buffer);

      // Create content with username and caption
      const formattedContent = `**${username}**: ${caption || ""} [Sticker]`;

      // Forward the sticker to Discord as an image attachment
      const success = await this.ticketManager.forwardUserMessage(
        sender,
        {
          content: formattedContent,
          files: [filepath],
        },
        true
      );

      // Update the user's status and last activity
      if (userInfo) {
        this.userCardManager.setUserInfo(sender, username, {
          lastMessage: caption || "[Sticker]",
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
        `[WhatsAppHandler:${this.instanceId}] Error handling sticker:`,
        error
      );
      return false;
    }
  }

  /**
   * Handle text message
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
   */
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

      // Forward message to Discord
      const success = await this.ticketManager.forwardUserMessage(
        sender,
        text,
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

      // IMPROVED: Use an async function to avoid double-sending placeholder messages
      // This ensures we either send the media with caption or nothing at all
      const sendMediaWithDelay = async () => {
        try {
          // Create a waiting message to notify that media is being processed
          // This uses the ticketManager directly to show the message in Discord
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
            // Make sure we have a WhatsApp client
            if (!this.whatsAppClient) {
              throw new Error("WhatsApp client is not available");
            }

            // Attempt to download the media
            mediaData = await this.whatsAppClient.downloadMedia(message);

            // If download failed, log and return early
            if (!mediaData || !mediaData.buffer) {
              console.error(
                `[WhatsAppHandler:${this.instanceId}] Failed to download media`
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
            return false;
          }

          // IMPROVED: Handle voice/audio more specifically to ensure proper format
          let extension;

          if (mediaType === "voice") {
            // Force .ogg extension for voice messages
            extension = ".ogg";

            // If it's a voice note but has a different mime type, try to ensure it has audio/ogg
            if (
              mediaData.mimetype !== "audio/ogg" &&
              mediaData.mimetype !== "audio/ogg; codecs=opus"
            ) {
              mediaData.mimetype = "audio/ogg";
            }

            console.log(
              `[WhatsAppHandler:${this.instanceId}] Voice message with mimetype: ${mediaData.mimetype}`
            );
          } else {
            // For other media types, use extension from mime type or default
            extension = mediaData.mimetype
              ? this.getExtensionFromMimeType(mediaData.mimetype)
              : this.getDefaultExtension(mediaType);
          }

          const timestamp = Date.now();
          const filename = `${mediaType}_${timestamp}_${sender.replace(
            /[^\w]/g,
            "_"
          )}${extension}`;
          const filepath = path.join(this.tempDir, filename);

          // Write the media to file
          fs.writeFileSync(filepath, mediaData.buffer);

          // IMPROVED: Add media type label for clearer identification in Discord
          let mediaLabel = "";
          if (mediaType === "voice") {
            mediaLabel = " [Voice Message]";
          } else if (mediaType === "audio") {
            mediaLabel = " [Audio]";
          }

          // Create content with username and caption
          const formattedContent = `**${username}**: ${
            caption || ""
          }${mediaLabel}`;

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
          if (userInfo) {
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
            `[WhatsAppHandler:${this.instanceId}] Media processing error:`,
            error
          );
          return false;
        }
      };

      // Execute our async media handling function
      return await sendMediaWithDelay();
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling ${mediaType} message:`,
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
   * Handle location message
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
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

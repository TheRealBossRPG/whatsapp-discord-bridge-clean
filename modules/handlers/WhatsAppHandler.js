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
              return await this.ticketManager.forwardUserMessage(
                userId,
                content,
                hasMedia
              );
            }
            return false;
          }

          // Forward message to existing ticket
          return await this.ticketManager.forwardUserMessage(
            userId,
            content,
            hasMedia
          );

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
   * Handle first contact from a new user
   * @param {string} sender - Sender ID
   * @param {Object} message - WhatsApp message
   */
  async handleFirstContact(sender, message) {
    try {
      // CRITICAL FIX: Get the text safely with proper type checking
      const text = this.getTextFromMessage(message);

      // Check if we have a non-empty string
      if (typeof text === "string" && text.trim()) {
        // Check if the message contains a name (assume any first message with 2+ chars is a name)
        if (text.trim().length >= 2 && /[a-zA-Z]/.test(text)) {
          // Assume this is a name response
          await this.handleNameResponse(sender, text.trim());
        } else {
          // Send welcome message asking for name
          await this.sendWelcomeMessage(sender);
        }
      } else {
        // No text content (maybe a media message), send welcome message
        await this.sendWelcomeMessage(sender);
      }
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling first contact:`,
        error
      );
    }
  }

  /**
   * Send welcome message to new user
   * @param {string} sender - Sender ID
   */
  async sendWelcomeMessage(sender) {
    try {
      // Send welcome message
      await this.whatsAppClient.sendTextMessage(sender, this.welcomeMessage);

      // Create a minimal user card to track that we've initiated contact
      this.userCardManager.createMinimalUserCard(sender);
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error sending welcome message:`,
        error
      );
    }
  }

  /**
   * Handle name response from user
   * @param {string} sender - Sender ID
   * @param {string} name - User's name
   */
  async handleNameResponse(sender, name) {
    try {
      // Create or update user card with name
      const userCard = this.userCardManager.getUserCard(sender) || {};
      userCard.name = name;
      this.userCardManager.updateUserCard(sender, userCard);

      // Create channel for this user
      const channel = await this.ticketManager.createTicket(sender, name);

      if (!channel) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Failed to create channel for ${sender}`
        );
        await this.whatsAppClient.sendTextMessage(
          sender,
          "I'm sorry, there was an issue setting up your support ticket. Please try again later."
        );
        return;
      }

      // Map user to channel
      // CRITICAL FIX: Handle different method names for backward compatibility
      if (typeof this.channelManager.mapUserToChannel === "function") {
        this.channelManager.addChannelMapping(sender, channel.id);
      } else if (typeof this.channelManager.addUserToChannel === "function") {
        this.channelManager.addChannelMapping(sender, channel.id);
      } else {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Could not find a method to map user to channel`
        );
      }

      // Send intro message to user
      const personalizedIntro = this.introMessage.replace(/{name}/g, name);
      await this.whatsAppClient.sendTextMessage(sender, personalizedIntro);

      console.log(
        `[WhatsAppHandler:${this.instanceId}] Created ticket channel ${channel.id} for user ${name} (${sender})`
      );
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling name response:`,
        error
      );

      // Try to send fallback message
      try {
        await this.whatsAppClient.sendTextMessage(
          sender,
          "I'm sorry, there was an issue setting up your support ticket. Please try again later."
        );
      } catch (sendError) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Error sending fallback message:`,
          sendError
        );
      }
    }
  }

  /**
   * Handle returning user
   * @param {string} sender - Sender ID
   * @param {Object} userCard - User card
   * @param {Object} message - WhatsApp message
   */
  async handleReturningUser(sender, userCard, message) {
    try {
      // Create a new ticket channel for returning user
      const name = userCard.name || "User";
      const channel = await this.ticketManager.createTicket(sender, name);

      if (!channel) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Failed to create channel for returning user ${sender}`
        );
        await this.whatsAppClient.sendTextMessage(
          sender,
          "I'm sorry, there was an issue setting up your support ticket. Please try again later."
        );
        return;
      }

      // Map user to channel
      // CRITICAL FIX: Handle different method names for backward compatibility
      if (typeof this.channelManager.mapUserToChannel === "function") {
        this.channelManager.mapUserToChannel(sender, channel.id);
      } else if (typeof this.channelManager.addUserToChannel === "function") {
        this.channelManager.addUserToChannel(sender, channel.id);
      } else {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Could not find a method to map user to channel`
        );
      }

      // Send reopen message
      const reopenMessage = this.reopenTicketMessage.replace(/{name}/g, name);
      await this.whatsAppClient.sendTextMessage(sender, reopenMessage);

      // Also send the original message to Discord
      await this.processMessage(message, sender, channel.id);

      console.log(
        `[WhatsAppHandler:${this.instanceId}] Reopened ticket channel ${channel.id} for returning user ${name} (${sender})`
      );
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling returning user:`,
        error
      );
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

      // Process commands if they exist
      if (typeof text === "string" && text.trim().startsWith("!")) {
        const command = text.trim().split(" ")[0].toLowerCase();

        // Check for vouch command
        if (
          command === "!vouch" &&
          this.vouchHandler &&
          !this.vouchHandler.isDisabled
        ) {
          await this.vouchHandler.handleVouchCommand(sender);
          return;
        }
      }

      // Process message based on type
      if (
        message.message?.imageMessage ||
        message.image ||
        message.mimetype?.startsWith("image/")
      ) {
        // Handle image message
        await this.handleMediaMessage(message, sender, channelId, "image");
      } else if (
        message.message?.videoMessage ||
        message.video ||
        message.mimetype?.startsWith("video/")
      ) {
        // Handle video message
        await this.handleMediaMessage(message, sender, channelId, "video");
      } else if (
        message.message?.documentMessage ||
        message.document ||
        message.mimetype?.startsWith("application/")
      ) {
        // Handle document message
        await this.handleMediaMessage(message, sender, channelId, "document");
      } else if (
        message.message?.audioMessage ||
        message.audio ||
        message.mimetype?.startsWith("audio/")
      ) {
        // Handle audio message
        await this.handleMediaMessage(message, sender, channelId, "audio");
      } else if (message.message?.locationMessage || message.location) {
        // Handle location message
        await this.handleLocationMessage(message, sender, channelId);
      } else if (message.message?.contactMessage || message.contacts) {
        // Handle contact message
        await this.handleContactMessage(message, sender, channelId);
      } else {
        // Default to text message handling
        await this.handleTextMessage(message, sender, channelId);
      }
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error processing message:`,
        error
      );
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
        return;
      }

      // Get user info
      const userCard = this.userCardManager.getUserCard(sender) || {};
      const username = userCard.name || "Unknown User";

      // Forward message to Discord
      await this.ticketManager.forwardUserMessage(
        channelId,
        username,
        text,
        sender
      );

      // Update the user's status and last activity
      if (userCard) {
        userCard.lastMessage = text;
        userCard.lastActivity = Date.now();
        userCard.status = "active";
        this.userCardManager.updateUserCard(sender, userCard);
      }
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling text message:`,
        error
      );
    }
  }

  /**
   * Handle media message (image, video, document, audio)
   * @param {Object} message - WhatsApp message
   * @param {string} sender - Sender ID
   * @param {string} channelId - Discord channel ID
   * @param {string} mediaType - Media type
   */
  async handleMediaMessage(message, sender, channelId, mediaType) {
    try {
      // Get user info
      const userCard = this.userCardManager.getUserCard(sender) || {};
      const username = userCard.name || "Unknown User";
  
      // Get caption if any
      let caption = "";
  
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
  
      // Get media with better error handling
      let media = null;
      try {
        // Always pass the full message object to downloadMedia
        media = await this.whatsAppClient.downloadMedia(message);
      } catch (downloadError) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] Failed to download media:`,
          downloadError
        );
        
        // Forward just the caption if we couldn't download the media
        if (caption) {
          await this.ticketManager.forwardUserMessage(
            sender,
            `[Failed to download ${mediaType}] ${caption}`,
            false
          );
        } else {
          await this.ticketManager.forwardUserMessage(
            sender,
            `[Failed to download ${mediaType}]`,
            false
          );
        }
        return;
      }
  
      // If no media data, handle gracefully
      if (!media || !media.buffer) {
        console.error(
          `[WhatsAppHandler:${this.instanceId}] No media data for ${mediaType} message`
        );
  
        // Forward just the caption if we have one
        if (caption) {
          await this.ticketManager.forwardUserMessage(
            sender,
            `[${mediaType} attachment - no data] ${caption}`,
            false
          );
        } else {
          await this.ticketManager.forwardUserMessage(
            sender,
            `[${mediaType} attachment - no data]`,
            false
          );
        }
        return;
      }
  
      // Create a temporary file to store the media with proper extension
      const timestamp = Date.now();
      const extension = media.mimetype ? 
        this.getExtensionFromMimeType(media.mimetype) : 
        this.getDefaultExtension(mediaType);
      
      const filename = media.filename || `${timestamp}_${sender.replace(/[^\w]/g, "_")}_${mediaType}${extension}`;
      const filepath = path.join(this.tempDir, filename);
  
      // Write the media to file
      fs.writeFileSync(filepath, media.buffer);
  
      // Create content with username and caption
      const contentPrefix = caption
        ? `${caption}`
        : `[${mediaType.toUpperCase()}]`;
      const formattedContent = `**${username}**: ${contentPrefix}`;
  
      // Forward the media to Discord
      await this.ticketManager.forwardUserMessage(
        sender,
        {
          content: formattedContent,
          files: [filepath],
        },
        true
      );
  
      // Update the user's status and last activity
      if (userCard) {
        userCard.lastMessage = caption || `[${mediaType}]`;
        userCard.lastActivity = Date.now();
        userCard.status = "active";
        this.userCardManager.updateUserCard(sender, userCard);
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
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling ${mediaType} message:`,
        error
      );
    }
  }

  getDefaultExtension(mediaType) {
    switch (mediaType.toLowerCase()) {
      case 'image': return '.jpg';
      case 'video': return '.mp4';
      case 'audio': return '.mp3';
      case 'ptt': return '.ogg';
      case 'sticker': return '.webp';
      case 'document': return '.bin';
      default: return '.bin';
    }
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
        return;
      }

      // Get user info
      const userCard = this.userCardManager.getUserCard(sender) || {};
      const username = userCard.name || "Unknown User";

      // Generate Google Maps link
      const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

      // Forward location message
      const locationText = `📍 *Location shared*\n${mapsLink}`;
      await this.ticketManager.forwardUserMessage(
        channelId,
        username,
        locationText,
        sender
      );

      // Update the user's status and last activity
      if (userCard) {
        userCard.lastMessage = "[Location]";
        userCard.lastActivity = Date.now();
        userCard.status = "active";
        this.userCardManager.updateUserCard(sender, userCard);
      }
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling location message:`,
        error
      );
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
      const userCard = this.userCardManager.getUserCard(sender) || {};
      const username = userCard.name || "Unknown User";

      // Forward contact message
      let contactText = `📒 *Contact shared*\nName: ${contactName}`;
      if (contactPhone) {
        contactText += `\nPhone: ${contactPhone}`;
      }

      await this.ticketManager.forwardUserMessage(
        channelId,
        username,
        contactText,
        sender
      );

      // Update the user's status and last activity
      if (userCard) {
        userCard.lastMessage = "[Contact]";
        userCard.lastActivity = Date.now();
        userCard.status = "active";
        this.userCardManager.updateUserCard(sender, userCard);
      }
    } catch (error) {
      console.error(
        `[WhatsAppHandler:${this.instanceId}] Error handling contact message:`,
        error
      );
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

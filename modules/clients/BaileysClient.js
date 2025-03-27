// modules/clients/BaileysClient.js - FIXED QR GENERATION & AUTH
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidDecode,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");

/**
 * BaileysClient - WhatsApp client implementation using Baileys
 */
class BaileysClient extends EventEmitter {
  /**
   * Create a new Baileys WhatsApp client
   * @param {Object} options - Client options
   * @param {string} options.authFolder - Path to auth folder
   * @param {string} options.tempDir - Path to temp directory
   * @param {string} options.instanceId - Instance ID
   * @param {number} options.maxRetries - Maximum connection retries
   */
  constructor(options = {}) {
    super();

    // Set instance variables
    this.authFolder =
      options.authFolder ||
      path.join(__dirname, "..", "..", "instances", "default", "auth");
    this.baileysAuthDir = path.join(this.authFolder, "baileys_auth");
    this.tempDir = options.tempDir || path.join(__dirname, "..", "..", "temp");
    this.instanceId = options.instanceId || "default";
    this.maxRetries = options.maxRetries || 5;
    this.qrRetryCount = 0;
    this.connectionRetryCount = 0;
    this.isReady = false;
    this.shouldShowQrCode = true;
    this.qrTimeout = 60000; // Default QR timeout in ms

    // Set up logger with minimal logging to console
    this.logger = pino({
      level: "warn",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    });

    // Create directories if they don't exist
    this.ensureDirectoriesExist();

    // Initialize any cleanup tasks
    this.setupCleanupTasks();

    // Store message handlers
    this._messageHandlers = new Set();
  }

  /**
   * Set whether to show QR code
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.shouldShowQrCode = show;
    console.log(
      `[BaileysClient:${this.instanceId}] QR code display set to: ${show}`
    );
  }

  /**
   * Set QR code timeout
   * @param {number} timeout - Timeout in milliseconds
   */
  setQrTimeout(timeout) {
    this.qrTimeout = timeout;
  }

  /**
   * Ensure all required directories exist
   */
  ensureDirectoriesExist() {
    try {
      // Ensure auth folder exists
      if (!fs.existsSync(this.authFolder)) {
        fs.mkdirSync(this.authFolder, { recursive: true });
      }

      // Ensure Baileys auth directory exists
      if (!fs.existsSync(this.baileysAuthDir)) {
        fs.mkdirSync(this.baileysAuthDir, { recursive: true });
      }

      // Ensure temp directory exists
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }

      console.log(`[BaileysClient:${this.instanceId}] Directories initialized`);
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error creating directories:`,
        error
      );
    }
  }

  /**
   * Set up cleanup tasks for temporary files
   */
  setupCleanupTasks() {
    // Periodically clean temp directory (every 12 hours)
    setInterval(() => {
      this.cleanTempDirectory();
    }, 12 * 60 * 60 * 1000);

    // Clean on startup
    this.cleanTempDirectory();
  }

  /**
   * Clean temporary directory
   */
  cleanTempDirectory() {
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        let deletedCount = 0;

        for (const file of files) {
          // Only try to delete files, not directories
          const filePath = path.join(this.tempDir, file);

          try {
            const stats = fs.statSync(filePath);
            if (stats.isFile()) {
              // Don't delete files that are being used currently
              try {
                fs.unlinkSync(filePath);
                deletedCount++;
              } catch (e) {
                // Skip files that can't be deleted (might be in use)
                if (e.code !== "EBUSY" && e.code !== "EPERM") {
                  console.error(
                    `[BaileysClient:${this.instanceId}] Error deleting file ${file}:`,
                    e
                  );
                }
              }
            }
          } catch (statError) {
            // Skip files we can't stat
          }
        }

        if (deletedCount > 0) {
          console.log(
            `[BaileysClient:${this.instanceId}] Cleaned ${deletedCount} old files from temp directory`
          );
        }
      }
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error cleaning temp directory:`,
        error
      );
    }
  }

  /**
   * Format phone number for WhatsApp
   * @param {string} phoneNumber - Phone number to format
   * @returns {string} - Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    let formatted = String(phoneNumber).trim();

    // Remove WhatsApp extensions
    formatted = formatted
      .replace(/@s\.whatsapp\.net/g, "")
      .replace(/@c\.us/g, "")
      .replace(/@g\.us/g, "")
      .replace(/@broadcast/g, "")
      .replace(/@.*$/g, "");

    // Remove any non-digit characters except leading '+'
    if (formatted.startsWith("+")) {
      formatted = "+" + formatted.substring(1).replace(/\D/g, "");
    } else {
      formatted = formatted.replace(/\D/g, "");
    }

    // Ensure the number has the @s.whatsapp.net suffix
    if (!formatted.includes("@")) {
      formatted = `${formatted}@s.whatsapp.net`;
    }

    return formatted;
  }

  /**
   * Extract phone number from JID
   * @param {string} jid - JID to extract from
   * @returns {string} - Extracted phone number
   */
  extractPhoneNumber(jid) {
    if (!jid) return null;

    try {
      // Use Baileys function if available
      if (typeof jidDecode === "function") {
        const decoded = jidDecode(jid);
        return decoded?.user || jid.split("@")[0];
      }

      // Fallback to regex
      return jid.split("@")[0];
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error extracting phone number:`,
        error
      );
      return jid.split("@")[0];
    }
  }

  /**
   * Initialize WhatsApp client
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async initialize() {
    try {
      console.log(
        `[BaileysClient:${this.instanceId}] Initializing WhatsApp client...`
      );

      // Check if we're already initialized
      if (this.sock) {
        console.log(
          `[BaileysClient:${this.instanceId}] Client already initialized`
        );
        return true;
      }

      // Reset retry counter
      this.qrRetryCount = 0;
      this.connectionRetryCount = 0;

      // Fetch latest version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(
        `[BaileysClient:${this.instanceId}] Using WA v${version.join(
          "."
        )}, isLatest: ${isLatest}`
      );

      // Delete any existing creds.json file
      // This forces QR code generation
      if (this.shouldShowQrCode) {
        const credsFiles = [
          path.join(this.baileysAuthDir, "creds.json"),
          path.join(this.authFolder, "creds.json"),
        ];

        for (const credsFile of credsFiles) {
          if (fs.existsSync(credsFile)) {
            try {
              fs.unlinkSync(credsFile);
              console.log(
                `[BaileysClient:${this.instanceId}] Deleted existing creds file: ${credsFile}`
              );
            } catch (e) {
              console.error(
                `[BaileysClient:${this.instanceId}] Error deleting creds file: ${e.message}`
              );
            }
          }
        }
      }

      // Use multi-file auth state
      const { state, saveCreds } = await useMultiFileAuthState(
        this.baileysAuthDir
      );

      // Create Baileys socket with options for better reliability
      this.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: true, // Enable QR in terminal for debugging
        auth: {
          creds: state.creds,
          // Add signal key store cacheability for better performance
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        // Browser client details
        browser: ["Discord WhatsApp Bridge", "Chrome", "108.0.0.0"],
        // Implement proper retries for connection
        retryRequestDelayMs: 2000,
        connectTimeoutMs: 30000,
        keepAliveIntervalMs: 25000,
        // Message download options
        downloadHistory: false,
        markOnlineOnConnect: true,
        // Sync options
        syncFullHistory: false,
        // For best stability
        throwErrorOnTosBlock: false,
        // Don't use message history - causes conflicts
        patchMessageBeforeSending: false,
        // For improved reliability
        shouldIgnoreJid: (jid) => jid.includes("broadcast"),
        // Custom message processor - IMPORTANT: We need to return undefined, not a message
        getMessage: async (key) => {
          return undefined;
        },
        // Force QR code generation
        generateHighQualityLinkPreview: true,
      });

      // Save credentials on update
      this.sock.ev.on("creds.update", saveCreds);

      // Set up event handlers
      this.setupEventHandlers();

      console.log(`[BaileysClient:${this.instanceId}] Initialization complete`);
      return true;
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error initializing WhatsApp client:`,
        error
      );

      // Retry connection on specific errors
      if (error instanceof Boom && error.output?.statusCode === 429) {
        if (this.connectionRetryCount < this.maxRetries) {
          this.connectionRetryCount++;
          console.log(
            `[BaileysClient:${this.instanceId}] Rate limited, retrying in 10 seconds... (${this.connectionRetryCount}/${this.maxRetries})`
          );

          // Wait 10 seconds and retry
          await new Promise((resolve) => setTimeout(resolve, 10000));
          return this.initialize();
        }
      }

      return false;
    }
  }

  /**
   * Set up event handlers for the Baileys socket
   */
  setupEventHandlers() {
    if (!this.sock) {
      console.error(
        `[BaileysClient:${this.instanceId}] Cannot set up event handlers: Socket not initialized`
      );
      return;
    }

    // Handle connection updates - FIXED QR HANDLING
    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Handle QR code generation - THIS MUST COME FIRST
      if (qr) {
        console.log(
          `[BaileysClient:${this.instanceId}] New QR code generated (attempt ${
            this.qrRetryCount + 1
          }/${this.maxRetries})`
        );

        // Always emit QR regardless of settings for flexibility
        this.emit("qr", qr);

        // Increment QR retry count
        this.qrRetryCount++;

        // Set timeout for QR code expiration
        setTimeout(() => {
          if (!this.isReady && this.qrRetryCount === this.maxRetries) {
            console.log(
              `[BaileysClient:${this.instanceId}] QR code timed out after ${this.maxRetries} attempts`
            );
            this.emit("qr_timeout");
          }
        }, this.qrTimeout);
      }

      // Handle connection status
      if (connection === "close") {
        // Check if we should reconnect
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(
          `[BaileysClient:${this.instanceId}] Connection closed with status: ${statusCode}, reconnect: ${shouldReconnect}`
        );

        // Update ready status
        this.isReady = false;

        // Emit disconnected event
        this.emit("disconnected", statusCode);

        // Try to reconnect if appropriate
        if (shouldReconnect && this.connectionRetryCount < this.maxRetries) {
          this.connectionRetryCount++;
          console.log(
            `[BaileysClient:${this.instanceId}] Attempting to reconnect... (${this.connectionRetryCount}/${this.maxRetries})`
          );

          // Set a timeout to avoid rapid reconnection
          setTimeout(() => {
            this.initialize();
          }, 5000);
        }
      } else if (connection === "open") {
        console.log(
          `[BaileysClient:${this.instanceId}] Connection opened successfully`
        );

        // Reset retry counters
        this.connectionRetryCount = 0;
        this.qrRetryCount = 0;

        // Set ready status
        this.isReady = true;

        // Emit ready event
        this.emit("ready");
      }
    });

    // Handle messages
    this.sock.ev.on("messages.upsert", async (m) => {
      try {
        if (m.type !== "notify") return;

        for (const msg of m.messages) {
          // Skip outgoing messages
          if (msg.key.fromMe) continue;

          try {
            // Get sender information
            const jid = msg.key.remoteJid;

            // Skip if no JID or it's a group/broadcast
            if (!jid || jid.includes("@g.us") || jid.includes("@broadcast"))
              continue;

            // Basic logging - avoid logging the entire message structure
            console.log(
              `[BaileysClient:${this.instanceId}] Received message from ${jid}`,
              {
                messageId: msg.key.id,
                timestamp: msg.messageTimestamp,
              }
            );

            // Extract message content based on type
            let messageContent = "";
            let messageType = "text";
            let mediaUrl = null;

            // Determine message type and extract content
            if (msg.message?.conversation) {
              messageContent = msg.message.conversation;
              messageType = "text";
            } else if (msg.message?.extendedTextMessage?.text) {
              messageContent = msg.message.extendedTextMessage.text;
              messageType = "text";
            } else if (msg.message?.imageMessage) {
              messageContent = msg.message.imageMessage.caption || "";
              messageType = "image";
              // We'll download the image later if needed
            } else if (msg.message?.videoMessage) {
              messageContent = msg.message.videoMessage.caption || "";
              messageType = "video";
              // We'll download the video later if needed
            } else if (msg.message?.documentMessage) {
              messageContent = msg.message.documentMessage.caption || "";
              messageType = "document";
              // We'll download the document later if needed
            } else if (msg.message?.audioMessage) {
              messageContent = "";
              messageType = "audio";
              // Audio messages don't have captions
            } else if (msg.message?.stickerMessage) {
              messageContent = "";
              messageType = "sticker";
            } else {
              // Unknown message type - log a simplified version
              console.log(
                `[BaileysClient:${this.instanceId}] Unknown message type from ${jid}`,
                {
                  keys: Object.keys(msg.message || {}),
                }
              );
              messageType = "unknown";
            }

            // Create a simplified message object to emit
            const simplifiedMsg = {
              key: msg.key,
              jid: jid,
              messageId: msg.key.id,
              sender: this.extractPhoneNumber(jid),
              timestamp: msg.messageTimestamp,
              type: messageType,
              content: messageContent,
              rawMessage: msg, // Include the raw message for special handlers
            };

            // Mark as read
            await this.sock.readMessages([msg.key]);

            // Emit the message event with the simplified message
            this.emit("message", simplifiedMsg);
          } catch (msgError) {
            console.error(
              `[BaileysClient:${this.instanceId}] Error processing individual message:`,
              msgError
            );
            // Continue to next message even if one fails
          }
        }
      } catch (error) {
        console.error(
          `[BaileysClient:${this.instanceId}] Error in messages.upsert handler:`,
          error
        );
      }
    });

    // Handle message receipt updates
    this.sock.ev.on("messages.update", (updates) => {
      try {
        for (const update of updates) {
          // Emit update event with simplified data
          this.emit("message_update", {
            key: update.key,
            update: update,
          });
        }
      } catch (error) {
        console.error(
          `[BaileysClient:${this.instanceId}] Error in messages.update handler:`,
          error
        );
      }
    });

    // Handle group events (optional)
    this.sock.ev.on("group-participants.update", (update) => {
      try {
        this.emit("group_update", update);
      } catch (error) {
        console.error(
          `[BaileysClient:${this.instanceId}] Error in group-participants.update handler:`,
          error
        );
      }
    });
  }

  /**
   * Send a text message
   * @param {string} to - Recipient phone number
   * @param {string} text - Message text
   * @returns {Promise<Object>} - Message info
   */
  async sendTextMessage(to, text) {
    try {
      if (!this.sock || !this.isReady) {
        throw new Error("Client not initialized or not ready");
      }

      // Format recipient number
      const recipient = this.formatPhoneNumber(to);

      // Send message
      console.log(
        `[BaileysClient:${this.instanceId}] Sending text message to ${recipient}`
      );
      const result = await this.sock.sendMessage(recipient, { text });

      return result;
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error sending text message:`,
        error
      );
      throw error;
    }
  }

  /**
   * Send a media message
   * @param {string} to - Recipient phone number
   * @param {string} mediaPath - Path to media file
   * @param {string} caption - Optional caption
   * @param {string} mediaType - Media type (image, video, document)
   * @returns {Promise<Object>} - Message info
   */
  async sendMediaMessage(to, mediaPath, caption = "", mediaType = "image") {
    try {
      if (!this.sock || !this.isReady) {
        throw new Error("Client not initialized or not ready");
      }

      // Format recipient number
      const recipient = this.formatPhoneNumber(to);

      // Check if file exists
      if (!fs.existsSync(mediaPath)) {
        throw new Error(`Media file not found: ${mediaPath}`);
      }

      // Read file
      const media = fs.readFileSync(mediaPath);

      // Determine message type
      let messageContent = {};

      switch (mediaType.toLowerCase()) {
        case "image":
          messageContent = {
            image: media,
            caption: caption || undefined,
          };
          break;
        case "video":
          messageContent = {
            video: media,
            caption: caption || undefined,
          };
          break;
        case "document":
          messageContent = {
            document: media,
            mimetype: "application/octet-stream",
            fileName: path.basename(mediaPath),
            caption: caption || undefined,
          };
          break;
        default:
          throw new Error(`Unsupported media type: ${mediaType}`);
      }

      // Send message
      console.log(
        `[BaileysClient:${this.instanceId}] Sending ${mediaType} message to ${recipient}`
      );
      const result = await this.sock.sendMessage(recipient, messageContent);

      return result;
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error sending media message:`,
        error
      );
      throw error;
    }
  }

  /**
   * Download media from a message
   * @param {Object} message - WhatsApp message with media
   * @returns {Promise<Buffer>} - Media buffer
   */
  async downloadMedia(message) {
    try {
      if (!this.sock) {
        throw new Error("Client not initialized");
      }

      if (!message || !message.rawMessage) {
        throw new Error("Invalid message object");
      }

      // Use downloadMediaMessage function from Baileys
      const { downloadMediaMessage } = require("@whiskeysockets/baileys");

      // Download media
      const buffer = await downloadMediaMessage(
        message.rawMessage,
        "buffer",
        {},
        {
          logger: this.logger,
          reuploadRequest: this.sock.updateMediaMessage,
        }
      );

      return buffer;
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error downloading media:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get user profile picture
   * @param {string} jid - User JID
   * @returns {Promise<string|null>} - Profile picture URL or null
   */
  async getProfilePicture(jid) {
    try {
      if (!this.sock || !this.isReady) {
        throw new Error("Client not initialized or not ready");
      }

      // Format JID
      const formattedJid = this.formatPhoneNumber(jid);

      try {
        // Try to get high-res picture
        const ppUrl = await this.sock.profilePictureUrl(formattedJid, "image");
        return ppUrl;
      } catch (error) {
        // No profile picture or error
        console.log(
          `[BaileysClient:${this.instanceId}] No profile picture for ${formattedJid}`
        );
        return null;
      }
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error getting profile picture:`,
        error
      );
      return null;
    }
  }

  /**
   * Set QR code timeout
   * @param {number} timeout - Timeout in milliseconds
   */
  setQrTimeout(timeout) {
    this.qrTimeout = timeout;
    console.log(`Set QR code timeout to ${timeout}ms`);
  }

  /**
   * Set whether to show QR code
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.forceQrCode = show;
    console.log(`QR code display set to: ${show}`);
  }

  /**
   * Disconnect from WhatsApp
   * @param {boolean} logOut - Whether to logout and clear credentials
   */
  async disconnect(logOut = false) {
    try {
      if (!this.sock) {
        console.log("No active connection to disconnect");
        return true;
      }

      if (logOut) {
        // Full logout (will require new QR code)
        console.log("Performing full WhatsApp logout");
        await this.sock.logout();
      }

      // Standard disconnect
      console.log("Disconnecting WhatsApp...");
      this.sock.ws.close();

      // Clean up resources
      this.isReady = false;
      if (logOut) {
        this.messageQueue = [];
        this.messageStore = {};
      }

      console.log("Disconnected successfully");
      return true;
    } catch (error) {
      console.error("Error disconnecting WhatsApp:", error);
      // Force states to disconnected anyway
      this.isReady = false;
      return false;
    }
  }
}

module.exports = BaileysClient;

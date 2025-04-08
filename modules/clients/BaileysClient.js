// modules/clients/BaileysClient.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = require("@whiskeysockets/baileys");
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

/**
 * WhatsApp client implementation using @whiskeysockets/baileys
 */
class BaileysClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.instanceId = options.instanceId || "default";
    this.authFolder =
      options.authFolder ||
      path.join(__dirname, "..", "..", "instances", this.instanceId, "auth");
    this.baileysAuthFolder =
      options.baileysAuthFolder ||
      path.join(
        __dirname,
        "..",
        "..",
        "instances",
        this.instanceId,
        "baileys_auth"
      );
    this.tempDir =
      options.tempDir ||
      path.join(__dirname, "..", "..", "instances", this.instanceId, "temp");
    this.maxRetries = options.maxRetries || 5;
    this.connectionRetries = 0;
    this.showQrCode = false;
    this.isReady = false;
    this.socket = null;
    this.logger =
      global.pinoCompatLogger?.child({
        module: `BaileysClient:${this.instanceId}`,
      }) ||
      pino({ level: "warn" }).child({
        module: `BaileysClient:${this.instanceId}`,
      });

    console.log(
      `[BaileysClient:${this.instanceId}] Initialized. Will connect on initialize() call.`
    );
  }

  /**
   * Set whether to show QR code during connection
   * @param {boolean} showQrCode - Whether to show QR code
   */
  setShowQrCode(showQrCode) {
    this.showQrCode = showQrCode;
    console.log(
      `[BaileysClient:${this.instanceId}] QR code display set to: ${showQrCode}`
    );
  }

  /**
   * Initialize WhatsApp connection
   * @param {boolean} showQrCode - Whether to show QR code
   * @returns {Promise<boolean>} - Success status
   */
  async initialize(showQrCode = false) {
    try {
      // Set QR code preference
      if (showQrCode !== undefined) {
        this.setShowQrCode(showQrCode);
      }

      // Check if already initialized and ready
      if (this.socket && this.isReady) {
        console.log(
          `[BaileysClient:${this.instanceId}] Already initialized and ready`
        );
        return true;
      }

      console.log(
        `[BaileysClient:${this.instanceId}] Initializing WhatsApp connection...`
      );

      // Create auth folder if it doesn't exist
      if (!fs.existsSync(this.baileysAuthFolder)) {
        fs.mkdirSync(this.baileysAuthFolder, { recursive: true });
      }

      console.log(
        `[BaileysClient:${this.instanceId}] Using auth folder: ${this.baileysAuthFolder}`
      );

      // Set up auth state
      const { state, saveCreds } = await useMultiFileAuthState(
        this.baileysAuthFolder
      );

      // Configure Baileys socket
      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We'll handle QR ourselves
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false,
        logger: this.logger,
        markOnlineOnConnect: true,
        defaultQueryTimeoutMs: 60000,
      });

      // Set up event handlers
      this.setupEventHandlers(saveCreds);

      console.log(
        `[BaileysClient:${this.instanceId}] Event handlers registered`
      );
      return true;
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Initialize error:`,
        error
      );
      return false;
    }
  }

  /**
   * Set up Baileys event handlers
   * @param {Function} saveCreds - Function to save credentials
   */
  setupEventHandlers(saveCreds) {
    if (!this.socket) return;

    // Connection update event
    this.socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Handle QR code
      if (qr && this.showQrCode) {
        console.log(
          `[BaileysClient:${this.instanceId}] QR code received: ${qr.length} chars`
        );
        this.emit("qr", qr);
      }

      // Handle connection status
      if (connection === "close") {
        const error = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || "Unknown";
        console.log(
          `[BaileysClient:${this.instanceId}] Connection closed. Reason: ${reason}`
        );

        // Check for logout
        if (error === DisconnectReason.loggedOut) {
          console.log(`[BaileysClient:${this.instanceId}] Session logged out`);
          this.emit("auth_failure", new Error("Session logged out"));
          return;
        }

        // Handle reconnection
        if (this.connectionRetries < this.maxRetries) {
          this.connectionRetries++;
          console.log(
            `[BaileysClient:${this.instanceId}] Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`
          );

          // Emit disconnected event
          this.emit("disconnected", "Reconnecting");
        } else {
          console.error(
            `[BaileysClient:${this.instanceId}] Max reconnection attempts reached`
          );
          this.emit("disconnected", "Max reconnection attempts reached");
        }
      } else if (connection === "open") {
        // Reset connection retries on successful connection
        this.connectionRetries = 0;
        this.isReady = true;
        console.log(`[BaileysClient:${this.instanceId}] Connected to WhatsApp`);
        this.emit("ready");
      }
    });

    // Credentials update event
    this.socket.ev.on("creds.update", saveCreds);

    // Messages update event
    this.socket.ev.on("messages.upsert", (messages) => {
      if (messages.type === "notify") {
        for (const msg of messages.messages) {
          // Skip messages sent by the bot itself
          const fromMe = msg.key?.fromMe === true;
          if (fromMe) continue;

          // Process the message
          this.emit("message", msg);
        }
      }
    });
  }

  /**
   * Check if client is authenticated
   * @returns {Promise<boolean>} - Authentication status
   */
  async isAuthenticated() {
    try {
      if (!fs.existsSync(this.baileysAuthFolder)) {
        return false;
      }

      const credsPath = path.join(this.baileysAuthFolder, "creds.json");
      return fs.existsSync(credsPath);
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error checking auth:`,
        error
      );
      return false;
    }
  }

  /**
   * Restore session from auth files
   * @returns {Promise<boolean>} - Success status
   */
  async restoreSession() {
    try {
      if (!(await this.isAuthenticated())) {
        return false;
      }

      if (this.isReady && this.socket) {
        return true;
      }

      // Try to initialize without showing QR code
      return await this.initialize(false);
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error restoring session:`,
        error
      );
      return false;
    }
  }

  /**
   * Check if client is ready
   * @returns {boolean} - Ready status
   */
  isReady() {
    return this.isReady && this.socket !== null;
  }

  /**
   * Disconnect WhatsApp client
   * @param {boolean} logOut - Whether to log out and clear auth
   * @returns {Promise<boolean>} - Success status
   */
  async disconnect(logOut = false) {
    try {
      console.log(
        `[BaileysClient:${this.instanceId}] Disconnecting WhatsApp... ${
          logOut ? "(with logout)" : ""
        }`
      );

      // If not connected, just return success
      if (!this.socket) {
        console.log(
          `[BaileysClient:${this.instanceId}] No active socket to disconnect`
        );
        this.isReady = false;
        return true;
      }

      // If logout requested, remove auth files
      if (logOut) {
        try {
          // Close socket connection
          if (this.socket.ws) {
            this.socket.ws.close();
          }

          // Remove auth files
          const authFolders = [this.authFolder, this.baileysAuthFolder];
          for (const folder of authFolders) {
            if (fs.existsSync(folder)) {
              const files = fs.readdirSync(folder);
              for (const file of files) {
                try {
                  fs.unlinkSync(path.join(folder, file));
                } catch (unlinkError) {
                  console.error(
                    `[BaileysClient:${this.instanceId}] Error removing auth file: ${file}`,
                    unlinkError
                  );
                }
              }
            }
          }

          console.log(
            `[BaileysClient:${this.instanceId}] Auth files removed for logout`
          );
        } catch (cleanupError) {
          console.error(
            `[BaileysClient:${this.instanceId}] Error cleaning up auth files:`,
            cleanupError
          );
        }
      }

      // Close socket connection
      if (this.socket.ws) {
        this.socket.ws.close();
      }

      // Reset socket and state
      this.socket = null;
      this.isReady = false;

      console.log(`[BaileysClient:${this.instanceId}] Socket closed`);
      return true;
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error disconnecting:`,
        error
      );

      // Force reset state even on error
      this.socket = null;
      this.isReady = false;

      return false;
    }
  }

  /**
   * Send a text message
   * @param {string} to - Recipient ID
   * @param {string} text - Message text
   * @returns {Promise<Object>} - Send result
   */
  async sendTextMessage(to, text) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error("Client not initialized or not ready");
      }

      // Make sure recipient ID has proper format
      const recipient = to.includes("@s.whatsapp.net")
        ? to
        : `${to}@s.whatsapp.net`;

      // Send the message
      const result = await this.socket.sendMessage(recipient, { text });
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
   * @param {string} to - Recipient ID
   * @param {Object} media - Media object
   * @param {string} caption - Media caption
   * @returns {Promise<Object>} - Send result
   */
  async sendMediaMessage(to, media, caption = "") {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error("Client not initialized or not ready");
      }

      // Make sure recipient ID has proper format
      const recipient = to.includes("@s.whatsapp.net")
        ? to
        : `${to}@s.whatsapp.net`;

      // Determine media type and prepare message
      let message = {};

      if (media.mimetype?.startsWith("image/")) {
        message = {
          image: media.data,
          caption: caption,
          mimetype: media.mimetype,
        };
      } else if (media.mimetype?.startsWith("video/")) {
        message = {
          video: media.data,
          caption: caption,
          mimetype: media.mimetype,
        };
      } else if (media.mimetype?.startsWith("audio/")) {
        message = {
          audio: media.data,
          mimetype: media.mimetype,
        };
      } else {
        message = {
          document: media.data,
          caption: caption,
          mimetype: media.mimetype || "application/octet-stream",
          fileName: media.filename || "file",
        };
      }

      // Send the message
      const result = await this.socket.sendMessage(recipient, message);
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
   * Send media from URL
   * @param {string} to - Recipient
   * @param {string} url - Media URL
   * @param {string} caption - Caption (optional)
   * @param {string} filename - Filename (optional)
   * @returns {Promise<Object>} - Send result
   */
  async sendMediaFromUrl(
    to,
    url,
    mediaType = "auto",
    filename = null,
    caption = ""
  ) {
    try {
      if (!this.isReady || !this.socket) {
        throw new Error("Client not initialized or not ready");
      }

      // Ensure media helper exists
      if (!this.media) {
        const BaileysMedia = require("./baileys/BaileysMedia");
        this.media = new BaileysMedia(this);
      }

      // Send the media
      return await this.media.sendMediaFromUrl(
        to,
        url,
        mediaType,
        filename,
        caption
      );
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error sending media from URL:`,
        error
      );
      throw error;
    }
  }

  /**
   * Send a GIF
   * @param {string} to - Recipient
   * @param {string|Buffer} gifInput - GIF URL or Buffer
   * @param {string} caption - Caption (optional)
   * @returns {Promise<Object>} - Send result
   */
  async sendGif(to, gifInput, caption = "") {
    try {
      if (!this.isReady || !this.socket) {
        throw new Error("Client not initialized or not ready");
      }

      // Ensure media helper exists
      if (!this.media) {
        const BaileysMedia = require("./baileys/BaileysMedia");
        this.media = new BaileysMedia(this);
      }

      // Send the GIF
      return await this.media.sendGif(to, gifInput, caption);
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error sending GIF:`,
        error
      );
      throw error;
    }
  }

  /**
   * Send a sticker
   * @param {string} to - Recipient
   * @param {string|Buffer} stickerInput - Sticker URL or Buffer
   * @returns {Promise<Object>} - Send result
   */
  async sendSticker(to, stickerInput) {
    try {
      if (!this.isReady || !this.socket) {
        throw new Error("Client not initialized or not ready");
      }

      // Ensure media helper exists
      if (!this.media) {
        const BaileysMedia = require("./baileys/BaileysMedia");
        this.media = new BaileysMedia(this);
      }

      // Send the sticker
      return await this.media.sendSticker(to, stickerInput);
    } catch (error) {
      console.error(
        `[BaileysClient:${this.instanceId}] Error sending sticker:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get profile picture for a user
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} - Profile picture URL or null
   */
  async getProfilePicture(userId) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error("Client not initialized or not ready");
      }

      // Make sure user ID has proper format
      const user = userId.includes("@s.whatsapp.net")
        ? userId
        : `${userId}@s.whatsapp.net`;

      // Get profile picture
      const ppUrl = await this.socket.profilePictureUrl(user, "image");
      return ppUrl;
    } catch (error) {
      // Profile picture might not be available, don't log as error
      console.log(
        `[BaileysClient:${this.instanceId}] Could not get profile picture for ${userId}`
      );
      return null;
    }
  }

  /**
   * Get contact name for a user
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} - Contact name or null
   */
  async getContactName(userId) {
    try {
      if (!this.socket || !this.isReady) {
        throw new Error("Client not initialized or not ready");
      }

      // Make sure user ID has proper format
      const user = userId.includes("@s.whatsapp.net")
        ? userId
        : `${userId}@s.whatsapp.net`;

      // Get contact
      const contact = await this.socket.contacts[user];
      if (contact) {
        return contact.name || contact.notify || null;
      }
      return null;
    } catch (error) {
      console.log(
        `[BaileysClient:${this.instanceId}] Could not get contact name for ${userId}`
      );
      return null;
    }
  }
}

module.exports = BaileysClient;

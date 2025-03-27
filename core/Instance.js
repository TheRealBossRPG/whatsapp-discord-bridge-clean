// core/Instance.js (Fixed QR Code Handling)
const fs = require("fs");
const path = require("path");
const EventBus = require("./EventBus");
const ModuleLoader = require("./ModuleLoader");

class Instance {
  constructor(options) {
    this.instanceId = options.instanceId;
    this.guildId = options.guildId;
    this.categoryId = options.categoryId;
    this.transcriptChannelId = options.transcriptChannelId;
    this.vouchChannelId = options.vouchChannelId;
    this.discordClient = options.discordClient;
    this.customSettings = options.customSettings || {};

    // Create event bus for this instance
    this.events = new EventBus();

    // Track connection state
    this.connected = false;

    // Initialize empty component references
    this.managers = {};
    this.handlers = {};
    this.clients = {};

    // QR code handling
    this.qrCodeListeners = new Set();
    this.lastQrCode = null;
    this.qrCodeTimer = null;

    // Initialize directories
    this.initializeDirectories();
  }

  initializeDirectories() {
    this.baseDir = path.join(__dirname, "..", "instances", this.instanceId);

    // Define paths with fallbacks to default locations
    this.paths = {
      auth: path.join(this.baseDir, "auth"),
      temp: path.join(this.baseDir, "temp"),
      transcripts: path.join(this.baseDir, "transcripts"),
      assets: path.join(this.baseDir, "assets"),
      logs: path.join(this.baseDir, "logs"),
    };

    // Create directories if they don't exist
    Object.values(this.paths).forEach((dirPath) => {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    });
  }

  setupWhatsAppClientEvents() {
    try {
      if (!this.clients.whatsAppClient) {
        console.error(
          `[Instance:${this.instanceId}] Cannot set up events for null WhatsApp client`
        );
        return;
      }

      // Remove any existing handlers to prevent duplication
      this.clients.whatsAppClient.removeAllListeners("qr");
      this.clients.whatsAppClient.removeAllListeners("ready");
      this.clients.whatsAppClient.removeAllListeners("disconnected");
      this.clients.whatsAppClient.removeAllListeners("message");

      // Handle QR code - FIXED
      this.clients.whatsAppClient.on("qr", (qrCode) => {
        // Store the last QR code
        this.lastQrCode = qrCode;

        // Clear previous timer if any
        if (this.qrCodeTimer) {
          clearTimeout(this.qrCodeTimer);
        }

        // Set a timer to clear QR code after 45 seconds
        this.qrCodeTimer = setTimeout(() => {
          this.lastQrCode = null;
        }, 45000);

        console.log(
          `[Instance:${this.instanceId}] New QR code generated (${qrCode.length} chars)`
        );

        // Emit QR code event - this is crucial
        if (this.events) {
          this.events.emit("qr", qrCode);
        } else {
          console.error(
            `[Instance:${this.instanceId}] Events system not initialized`
          );
        }

        // Call any registered QR code listeners directly
        if (this.qrCodeListeners && this.qrCodeListeners.size > 0) {
          for (const listener of this.qrCodeListeners) {
            try {
              listener(qrCode);
            } catch (e) {
              console.error(
                `[Instance:${this.instanceId}] Error in QR code listener:`,
                e
              );
            }
          }
        }
      });

      // Handle ready event
      this.clients.whatsAppClient.on("ready", () => {
        console.log(`[Instance:${this.instanceId}] WhatsApp client ready`);

        // Clear QR code and timer
        this.lastQrCode = null;
        if (this.qrCodeTimer) {
          clearTimeout(this.qrCodeTimer);
          this.qrCodeTimer = null;
        }

        this.connected = true;

        // Emit ready event
        if (this.events) {
          this.events.emit("ready");
        }
      });

      // Handle disconnected event
      this.clients.whatsAppClient.on("disconnected", () => {
        console.log(
          `[Instance:${this.instanceId}] WhatsApp client disconnected`
        );
        this.connected = false;

        if (this.events) {
          this.events.emit("disconnect");
        }
      });

      // Handle message events
      this.clients.whatsAppClient.on("message", (message) => {
        try {
          if (this.handlers.whatsAppHandler) {
            this.handlers.whatsAppHandler.handleMessage(message);
          }
        } catch (error) {
          console.error(
            `[Instance:${this.instanceId}] Error in message handler:`,
            error
          );
        }
      });

      console.log(
        `[Instance:${this.instanceId}] WhatsApp client events set up`
      );
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error setting up WhatsApp client events:`,
        error
      );
    }
  }

  initializeTicketManager() {
    try {
      console.log(`[Instance:${this.instanceId}] Initializing ticket manager`);

      if (!this.managers.ticketManager) {
        // Get required managers
        const channelManager = this.managers.channelManager;

        // Create the ticket manager
        const TicketManager = require("../modules/managers/TicketManager");
        this.managers.ticketManager = new TicketManager(
          channelManager,
          this.discordClient,
          this.guildId,
          this.categoryId,
          {
            instanceId: this.instanceId,
            customIntroMessages: this.customSettings?.introMessage,
            customCloseMessages: this.customSettings?.closingMessage,
          }
        );

        // Connect managers to each other
        if (this.managers.userCardManager) {
          this.managers.ticketManager.setUserCardManager(
            this.managers.userCardManager
          );
        }

        if (this.managers.transcriptManager) {
          this.managers.ticketManager.setTranscriptManager(
            this.managers.transcriptManager
          );
        }

        console.log(`[Instance:${this.instanceId}] Ticket manager initialized`);
      }

      return this.managers.ticketManager;
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error initializing ticket manager: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Clean temporary files for this instance
   */
  cleanTempFiles() {
    try {
      const fs = require("fs");
      const path = require("path");

      console.log(`[Instance:${this.instanceId}] Cleaning temporary files`);

      // Get temp directory
      const tempDir = this.paths.temp;
      if (!tempDir || !fs.existsSync(tempDir)) {
        console.log(
          `[Instance:${this.instanceId}] No temp directory found at ${tempDir}`
        );
        return;
      }

      // Read temp directory
      const files = fs.readdirSync(tempDir);
      let deletedCount = 0;

      // Delete each file
      for (const file of files) {
        const filePath = path.join(tempDir, file);

        try {
          // Skip qrcode.png file
          if (file === "qrcode.png") {
            continue;
          }

          // Get file stats to check if it's a file (not a directory)
          const stats = fs.statSync(filePath);

          if (stats.isFile()) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (fileError) {
          console.error(
            `[Instance:${this.instanceId}] Error deleting file ${filePath}: ${fileError.message}`
          );
        }
      }

      console.log(
        `[Instance:${this.instanceId}] Deleted ${deletedCount} temporary files`
      );
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error cleaning temp files: ${error.message}`
      );
    }
  }

  async initialize() {
    try {
      // 1. Initialize all managers
      const ChannelManager = require("../modules/managers/ChannelManager");
      const UserCardManager = require("../modules/managers/UserCardManager");
      const TranscriptManager = require("../modules/managers/TranscriptManager");
      const TicketManager = require("../modules/managers/TicketManager");

      this.managers.channelManager = new ChannelManager(this.instanceId);
      this.managers.userCardManager = new UserCardManager(this.instanceId);
      this.managers.transcriptManager = new TranscriptManager({
        instanceId: this.instanceId,
        transcriptChannelId: this.transcriptChannelId,
        discordClient: this.discordClient,
        guildId: this.guildId,
        baseDir: this.paths.transcripts,
      });

      this.managers.ticketManager = new TicketManager(
        this.managers.channelManager,
        this.discordClient,
        this.guildId,
        this.categoryId,
        {
          instanceId: this.instanceId,
          customIntroMessages: this.customSettings?.introMessage,
          customCloseMessages: this.customSettings?.closingMessage,
        }
      );

      // Connect managers to each other
      this.managers.ticketManager.setUserCardManager(
        this.managers.userCardManager
      );
      this.managers.ticketManager.setTranscriptManager(
        this.managers.transcriptManager
      );

      // 2. Initialize WhatsApp client
      const BaileysClient = require("../modules/clients/BaileysClient");
      this.clients.whatsAppClient = new BaileysClient({
        authFolder: this.paths.auth,
        tempDir: this.paths.temp,
        instanceId: this.instanceId,
      });

      // 3. Initialize handlers
      const WhatsAppHandler = require("../modules/handlers/WhatsAppHandler");
      const DiscordHandler = require("../modules/handlers/DiscordHandler");
      const VouchHandler = require("../modules/handlers/VouchHandler");

      // Initialize vouch handler if a channel is configured
      if (this.vouchChannelId) {
        this.handlers.vouchHandler = new VouchHandler(
          this.clients.whatsAppClient,
          this.discordClient,
          this.guildId,
          this.vouchChannelId,
          this.managers.userCardManager,
          {
            instanceId: this.instanceId,
            tempDir: this.paths.temp,
            assetsDir: this.paths.assets,
          }
        );

        // Connect to channel manager
        this.handlers.vouchHandler.setChannelManager(
          this.managers.channelManager
        );

        // Set custom message if specified
        if (this.customSettings && this.customSettings.vouchMessage) {
          this.handlers.vouchHandler.setCustomVouchMessage(
            this.customSettings.vouchMessage
          );
        }
      }

      // Initialize WhatsApp handler
      this.handlers.whatsAppHandler = new WhatsAppHandler(
        this.clients.whatsAppClient,
        this.managers.userCardManager,
        this.managers.channelManager,
        this.managers.ticketManager,
        this.managers.transcriptManager,
        this.handlers.vouchHandler,
        {
          instanceId: this.instanceId,
          tempDir: this.paths.temp,
        }
      );

      // Apply custom messages
      if (this.customSettings) {
        if (this.customSettings.welcomeMessage) {
          this.handlers.whatsAppHandler.welcomeMessage =
            this.customSettings.welcomeMessage;
        }
        if (this.customSettings.introMessage) {
          this.handlers.whatsAppHandler.introMessage =
            this.customSettings.introMessage;
        }
        if (this.customSettings.reopenTicketMessage) {
          this.handlers.whatsAppHandler.reopenTicketMessage =
            this.customSettings.reopenTicketMessage;
        }
      }

      // Initialize Discord handler
      this.handlers.discordHandler = new DiscordHandler(
        this.discordClient,
        this.categoryId,
        this.managers.channelManager,
        this.managers.userCardManager,
        this.managers.ticketManager,
        this.managers.transcriptManager,
        this.clients.whatsAppClient,
        {
          instanceId: this.instanceId,
          tempDir: this.paths.temp,
          assetsDir: this.paths.assets,
        }
      );

      // Connect vouch handler to Discord handler
      if (this.handlers.vouchHandler) {
        this.handlers.discordHandler.vouchHandler = this.handlers.vouchHandler;
      }

      // Set WhatsApp client in managers
      this.managers.channelManager.setWhatsAppClient(
        this.clients.whatsAppClient
      );
      this.managers.userCardManager.setWhatsAppClient(
        this.clients.whatsAppClient
      );

      // 4. Load instance settings
      await this.loadSettings();

      console.log(`Instance ${this.instanceId} initialized successfully`);
      return true;
    } catch (error) {
      console.error(
        `Error initializing instance ${this.instanceId}: ${error.message}`
      );
      return false;
    }
  }

  async loadSettings() {
    try {
      const settingsPath = path.join(this.baseDir, "settings.json");

      if (fs.existsSync(settingsPath)) {
        // Read settings file
        const fileContent = fs.readFileSync(settingsPath, "utf8");
        if (fileContent.trim() === "") {
          return this.customSettings || {};
        }

        const settings = JSON.parse(fileContent);

        // Update instance settings
        this.customSettings = settings;

        // Apply settings to components
        await this.applySettings(settings);

        return settings;
      } else {
        // Create default settings file
        const defaultSettings = {
          welcomeMessage:
            "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
          introMessage:
            "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
          reopenTicketMessage:
            "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
          newTicketMessage:
            "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
          closingMessage:
            "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
          vouchMessage:
            "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.",
          vouchSuccessMessage:
            "✅ Thank you for your vouch! It has been posted to our community channel.",
          sendClosingMessage: true,
          transcriptsEnabled: true,
          vouchEnabled: true,
        };

        // Save default settings
        this.customSettings = defaultSettings;
        await this.saveSettings(defaultSettings);

        return defaultSettings;
      }
    } catch (error) {
      console.error(
        `Error loading settings for instance ${this.instanceId}: ${error.message}`
      );
      return {};
    }
  }

  async saveSettings(settings) {
    try {
      const settingsPath = path.join(this.baseDir, "settings.json");

      // Merge with existing settings
      this.customSettings = {
        ...this.customSettings,
        ...settings,
      };

      // Save to disk
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(this.customSettings, null, 2),
        "utf8"
      );

      // Apply settings to components
      await this.applySettings(settings);

      return true;
    } catch (error) {
      console.error(
        `Error saving settings for instance ${this.instanceId}: ${error.message}`
      );
      return false;
    }
  }

  async applySettings(settings) {
    try {
      // Apply to WhatsApp handler
      if (this.handlers.whatsAppHandler) {
        if (settings.welcomeMessage) {
          this.handlers.whatsAppHandler.welcomeMessage =
            settings.welcomeMessage;
        }
        if (settings.introMessage) {
          this.handlers.whatsAppHandler.introMessage = settings.introMessage;
        }
        if (settings.reopenTicketMessage) {
          this.handlers.whatsAppHandler.reopenTicketMessage =
            settings.reopenTicketMessage;
        }
      }

      // Apply to Vouch handler
      if (this.handlers.vouchHandler) {
        if (
          settings.vouchMessage &&
          typeof this.handlers.vouchHandler.setCustomVouchMessage === "function"
        ) {
          this.handlers.vouchHandler.setCustomVouchMessage(
            settings.vouchMessage
          );
        }

        // Toggle vouch enabled state
        if (settings.hasOwnProperty("vouchEnabled")) {
          this.handlers.vouchHandler.isDisabled = !settings.vouchEnabled;
        }
      }

      // Apply to TicketManager
      if (this.managers.ticketManager) {
        if (
          settings.closingMessage &&
          typeof this.managers.ticketManager.setCustomCloseMessage ===
            "function"
        ) {
          this.managers.ticketManager.setCustomCloseMessage(
            settings.closingMessage
          );
        }

        if (
          settings.newTicketMessage &&
          typeof this.managers.ticketManager.setCustomIntroMessage ===
            "function"
        ) {
          this.managers.ticketManager.setCustomIntroMessage(
            settings.newTicketMessage
          );
        }
      }

      // Apply to TranscriptManager
      if (this.managers.transcriptManager) {
        if (settings.hasOwnProperty("transcriptsEnabled")) {
          this.managers.transcriptManager.isDisabled =
            !settings.transcriptsEnabled;
        }
      }

      // Apply special channels to ChannelManager if present
      if (settings.specialChannels && this.managers.channelManager) {
        this.managers.channelManager.setSpecialChannels(
          settings.specialChannels
        );
      }

      return true;
    } catch (error) {
      console.error(
        `Error applying settings for instance ${this.instanceId}: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Set up Discord routes for message handling
   * @private
   */
  _setupDiscordRoutes() {
    if (!this.discordClient) return;

    // Initialize the routes map if it doesn't exist
    if (!this.discordClient._instanceRoutes) {
      this.discordClient._instanceRoutes = new Map();
    }

    // Register this instance's category for routing
    this.discordClient._instanceRoutes.set(this.categoryId, {
      instanceId: this.instanceId,
      handler: this.handlers.discordHandler,
      instance: this,
    });

    console.log(
      `[Instance:${this.instanceId}] Route set up for category ${this.categoryId}`
    );
  }

  /**
   * Connect WhatsApp client
   * @param {boolean} showQrCode - Whether to force QR code display
   * @returns {Promise<boolean>} - Connection success status
   */
  async connect(showQrCode = false) {
    try {
      console.log(`[Instance:${this.instanceId}] Connecting WhatsApp...`);

      await this.loadSettings();

      // Verify Discord client is available
      if (!this.discordClient) {
        throw new Error(
          `[Instance:${this.instanceId}] Discord client is required to connect WhatsApp`
        );
      }

      // Make sure ticket manager is initialized
      if (!this.managers.ticketManager) {
        this.initializeTicketManager();
      }

      // Create WhatsApp client if not already initialized
      if (!this.clients.whatsAppClient) {
        // Import BaileysClient properly
        const BaileysClient = require("../modules/clients/BaileysClient");

        this.clients.whatsAppClient = new BaileysClient({
          authFolder: this.paths.auth,
          tempDir: this.paths.temp,
          instanceId: this.instanceId,
          maxRetries: 5,
        });
      }

      // Update component relationships
      this.managers.channelManager.setWhatsAppClient(
        this.clients.whatsAppClient
      );
      this.managers.userCardManager.setWhatsAppClient(
        this.clients.whatsAppClient
      );

      if (this.handlers.vouchHandler) {
        this.handlers.vouchHandler.whatsAppClient = this.clients.whatsAppClient;
      }

      if (this.handlers.discordHandler) {
        this.handlers.discordHandler.whatsAppClient =
          this.clients.whatsAppClient;
      }

      // Set up event handlers - BEFORE initialization
      this.setupWhatsAppClientEvents();

      // Set force QR flag if the method exists
      if (typeof this.clients.whatsAppClient.setShowQrCode === "function") {
        this.clients.whatsAppClient.setShowQrCode(showQrCode);
      }

      // Clear any existing QR code timeout
      if (this.qrCodeTimer) {
        clearTimeout(this.qrCodeTimer);
        this.qrCodeTimer = null;
      }

      // Initialize WhatsApp client
      const success = await this.clients.whatsAppClient.initialize();

      // Set connected state - but check isReady flag from client
      if (success && this.clients.whatsAppClient.isReady) {
        this.connected = true;
        console.log(
          `[Instance:${this.instanceId}] WhatsApp connected successfully!`
        );

        // Set up routes for Discord
        this._setupDiscordRoutes();

        // Emit ready event
        if (this.events) {
          this.events.emit("ready");
        }
      } else if (success) {
        console.log(
          `[Instance:${this.instanceId}] WhatsApp initialized but waiting for connection...`
        );
      } else {
        console.log(
          `[Instance:${this.instanceId}] WhatsApp initialization failed`
        );
      }

      return success;
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error connecting WhatsApp:`,
        error
      );
      return false;
    }
  }

  /**
   * Disconnect WhatsApp client
   * @param {boolean} logOut - Whether to perform full logout
   * @returns {Promise<boolean>} - Disconnect success status
   */
  async disconnect(logOut = false) {
    try {
      console.log(
        `[Instance:${this.instanceId}] Disconnecting WhatsApp...${
          logOut ? " (with full logout)" : ""
        }`
      );

      if (!this.clients.whatsAppClient) {
        console.log(
          `[Instance:${this.instanceId}] No WhatsApp client to disconnect`
        );
        return true;
      }

      // Clear QR code
      this.lastQrCode = null;
      if (this.qrCodeTimer) {
        clearTimeout(this.qrCodeTimer);
        this.qrCodeTimer = null;
      }

      // Properly disconnect the client
      await this.clients.whatsAppClient.disconnect(logOut);

      // Clean up Discord routes
      if (this.discordClient && this.discordClient._instanceRoutes) {
        // Only remove our own route
        this.discordClient._instanceRoutes.delete(this.categoryId);
      }

      // Clean temp files
      this.cleanTempFiles();

      // Update state
      this.connected = false;

      // Emit disconnect event
      if (this.events) {
        this.events.emit("disconnect");
      }

      return true;
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error disconnecting:`,
        error
      );

      // Force update state on error
      this.connected = false;

      // Try to emit disconnect event even on error
      if (this.events) {
        this.events.emit("disconnect");
      }

      return false;
    }
  }

  isConnected() {
    return (
      this.connected &&
      this.clients.whatsAppClient &&
      this.clients.whatsAppClient.isReady
    );
  }

  onQRCode(callback) {
    if (!this.events) {
      this.events = new EventBus();
    }

    // Register the callback
    this.events.on("qr", callback);

    // If we already have a QR code, call it immediately
    if (this.lastQrCode) {
      callback(this.lastQrCode);
    }

    // Save the callback to be able to remove it later
    this.qrCodeListeners.add(callback);
  }

  offQRCode(callback) {
    if (this.events && callback) {
      this.events.off("qr", callback);
      this.qrCodeListeners.delete(callback);
    }
  }

  onReady(callback) {
    if (!this.events) {
      this.events = new EventBus();
    }
    this.events.on("ready", callback);
  }

  onDisconnect(callback) {
    if (!this.events) {
      this.events = new EventBus();
    }
    this.events.on("disconnect", callback);
  }

  getStatus() {
    return {
      instanceId: this.instanceId,
      guildId: this.guildId,
      isConnected: this.isConnected(),
      activeTickets: this.managers.channelManager
        ? this.managers.channelManager.getChannelMapSize()
        : 0,
      registeredUsers: this.managers.userCardManager
        ? this.managers.userCardManager.getUserCardCount()
        : 0,
      transcriptChannel: this.transcriptChannelId,
      vouchChannel: this.vouchChannelId,
      categoryId: this.categoryId,
      paths: this.paths,
      hasQrCode: !!this.lastQrCode,
    };
  }
}

module.exports = Instance;

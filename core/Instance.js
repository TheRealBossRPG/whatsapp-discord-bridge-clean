// core/Instance.js - FIXED VERSION with improved reconnection handling
const fs = require('fs');
const path = require('path');
const EventBus = require('./EventBus');

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
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnecting = false;

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
    this.baseDir = path.join(__dirname, '..', 'instances', this.instanceId);

    // Define paths with fallbacks to default locations
    this.paths = {
      auth: path.join(this.baseDir, 'auth'),
      baileys_auth: path.join(this.baseDir, 'baileys_auth'), // Added explicit baileys auth dir
      temp: path.join(this.baseDir, 'temp'),
      transcripts: path.join(this.baseDir, 'transcripts'),
      assets: path.join(this.baseDir, 'assets'),
      logs: path.join(this.baseDir, 'logs'),
    };

    // Create directories if they don't exist
    Object.values(this.paths).forEach((dirPath) => {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    });
  }

  /**
   * Set up WhatsApp client event listeners
   * FIXED: Improved event handling
   */
  setupWhatsAppClientEvents() {
    try {
      if (!this.clients.whatsAppClient) {
        console.error(`[Instance:${this.instanceId}] Cannot set up events for null WhatsApp client`);
        return;
      }

      // Remove any existing handlers to prevent duplication
      this.clients.whatsAppClient.removeAllListeners('qr');
      this.clients.whatsAppClient.removeAllListeners('ready');
      this.clients.whatsAppClient.removeAllListeners('authenticated');
      this.clients.whatsAppClient.removeAllListeners('auth_failure');
      this.clients.whatsAppClient.removeAllListeners('disconnected');
      this.clients.whatsAppClient.removeAllListeners('message');

      // Handle QR code - FIXED for better event processing
      this.clients.whatsAppClient.on('qr', (qrCode) => {
        console.log(`[Instance:${this.instanceId}] QR code received (${qrCode.length} chars)`);
        
        // Store the last QR code
        this.lastQrCode = qrCode;

        // Clear previous timer if any
        if (this.qrCodeTimer) {
          clearTimeout(this.qrCodeTimer);
        }

        // Set a timer to clear QR code after 60 seconds
        this.qrCodeTimer = setTimeout(() => {
          this.lastQrCode = null;
          console.log(`[Instance:${this.instanceId}] QR code cleared due to timeout`);
        }, 60000);

        // Emit QR code event
        if (this.events) {
          this.events.emit('qr', qrCode);
        }

        // Call any registered QR code listeners
        if (this.qrCodeListeners && this.qrCodeListeners.size > 0) {
          for (const listener of this.qrCodeListeners) {
            try {
              listener(qrCode);
            } catch (error) {
              console.error(`[Instance:${this.instanceId}] Error in QR code listener:`, error);
            }
          }
        }
      });

      // Handle authentication
      this.clients.whatsAppClient.on('authenticated', () => {
        console.log(`[Instance:${this.instanceId}] WhatsApp authenticated`);
        
        // Reset reconnection attempts on successful authentication
        this.reconnectAttempts = 0;
        this.reconnecting = false;
      });

      // Handle authentication failure
      this.clients.whatsAppClient.on('auth_failure', (error) => {
        console.error(`[Instance:${this.instanceId}] WhatsApp authentication failed:`, error);
        this.connected = false;
        
        // Increment reconnection attempts
        this.reconnectAttempts++;
        
        // Emit auth failure event
        if (this.events) {
          this.events.emit('auth_failure', error);
        }
      });

      // Handle ready event
      this.clients.whatsAppClient.on('ready', () => {
        console.log(`[Instance:${this.instanceId}] WhatsApp client ready`);

        // Clear QR code and timer
        this.lastQrCode = null;
        if (this.qrCodeTimer) {
          clearTimeout(this.qrCodeTimer);
          this.qrCodeTimer = null;
        }

        // Update connection state
        this.connected = true;
        this.reconnectAttempts = 0;
        this.reconnecting = false;

        // Emit ready event
        if (this.events) {
          this.events.emit('ready');
        }
      });

      // Handle disconnected event
      this.clients.whatsAppClient.on('disconnected', (reason) => {
        console.log(`[Instance:${this.instanceId}] WhatsApp client disconnected: ${reason || 'Unknown reason'}`);
        this.connected = false;

        // Emit disconnect event
        if (this.events) {
          this.events.emit('disconnect', reason);
        }

        // Attempt auto-reconnect if not deliberately disconnected
        if (reason !== 'user_disconnected' && reason !== 'logout' && !this.reconnecting) {
          this.attemptReconnect();
        }
      });

      // Handle connection_closed event (specific to baileys)
      this.clients.whatsAppClient.on('connection_closed', () => {
        console.log(`[Instance:${this.instanceId}] WhatsApp connection closed`);
        this.connected = false;

        // Attempt reconnection
        if (!this.reconnecting) {
          this.attemptReconnect();
        }
      });

      // Handle message events
      this.clients.whatsAppClient.on('message', (message) => {
        try {
          if (this.handlers.whatsAppHandler) {
            this.handlers.whatsAppHandler.handleMessage(message);
          }
        } catch (error) {
          console.error(`[Instance:${this.instanceId}] Error in message handler:`, error);
        }
      });

      console.log(`[Instance:${this.instanceId}] WhatsApp client events set up`);
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error setting up WhatsApp client events:`, error);
    }
  }

  /**
   * Attempt to reconnect WhatsApp with exponential backoff
   * @private
   */
  async attemptReconnect() {
    try {
      // Prevent multiple reconnection attempts
      if (this.reconnecting) {
        console.log(`[Instance:${this.instanceId}] Reconnection already in progress`);
        return;
      }

      // Set reconnecting flag
      this.reconnecting = true;

      // Check if we've exceeded max attempts
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error(`[Instance:${this.instanceId}] Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
        this.reconnecting = false;
        return;
      }

      // Increment attempt counter
      this.reconnectAttempts++;

      // Calculate backoff time with exponential increase (1s, 2s, 4s, 8s, etc)
      const backoffTime = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
      
      console.log(`[Instance:${this.instanceId}] Attempting reconnect in ${backoffTime}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      // Wait for backoff time
      await new Promise(resolve => setTimeout(resolve, backoffTime));

      // Check if the client still exists
      if (!this.clients.whatsAppClient) {
        console.log(`[Instance:${this.instanceId}] WhatsApp client no longer exists, cannot reconnect`);
        this.reconnecting = false;
        return;
      }

      // Attempt reconnection
      console.log(`[Instance:${this.instanceId}] Executing reconnection attempt ${this.reconnectAttempts}`);
      
      // Perform the reconnection without showing QR code first
      const success = await this.connect(false);

      if (success && this.isConnected()) {
        console.log(`[Instance:${this.instanceId}] Reconnection successful`);
        this.reconnectAttempts = 0;
        this.reconnecting = false;
      } else {
        console.log(`[Instance:${this.instanceId}] Reconnection attempt failed, will retry`);
        
        // Reset reconnecting flag to allow another attempt
        this.reconnecting = false;
        
        // Try again with backoff
        this.attemptReconnect();
      }
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error during reconnection:`, error);
      this.reconnecting = false;
      
      // Try again despite error unless max attempts reached
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => this.attemptReconnect(), 5000);
      }
    }
  }

  /**
   * Initialize ticket manager
   */
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
      console.error(`[Instance:${this.instanceId}] Error initializing ticket manager: ${error.message}`);
      return null;
    }
  }

  /**
   * Clean temporary files
   */
  cleanTempFiles() {
    try {
      console.log(`[Instance:${this.instanceId}] Cleaning temporary files`);

      // Get temp directory
      const tempDir = this.paths.temp;
      if (!tempDir || !fs.existsSync(tempDir)) {
        console.log(`[Instance:${this.instanceId}] No temp directory found at ${tempDir}`);
        return;
      }

      // Read temp directory
      const files = fs.readdirSync(tempDir);
      let deletedCount = 0;

      // Delete each file except QR code
      for (const file of files) {
        // Skip qrcode.png file
        if (file === "qrcode.png") continue;
        
        const filePath = path.join(tempDir, file);

        try {
          // Get file stats to check if it's a file (not a directory)
          const stats = fs.statSync(filePath);

          if (stats.isFile()) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (fileError) {
          console.error(`[Instance:${this.instanceId}] Error deleting file ${filePath}: ${fileError.message}`);
        }
      }

      console.log(`[Instance:${this.instanceId}] Deleted ${deletedCount} temporary files`);
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error cleaning temp files: ${error.message}`);
    }
  }

  /**
   * Initialize all managers, handlers and clients
   */
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
        baileysAuthFolder: this.paths.baileys_auth, // Add explicit Baileys auth folder
        tempDir: this.paths.temp,
        instanceId: this.instanceId,
        maxRetries: 5,
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
        
        // Set vouch enabled state
        if (this.customSettings && this.customSettings.hasOwnProperty('vouchEnabled')) {
          this.handlers.vouchHandler.isDisabled = !this.customSettings.vouchEnabled;
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
      console.error(`Error initializing instance ${this.instanceId}: ${error.message}`);
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
      console.error(`Error loading settings for instance ${this.instanceId}: ${error.message}`);
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
      console.error(`Error saving settings for instance ${this.instanceId}: ${error.message}`);
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
      console.error(`Error applying settings for instance ${this.instanceId}: ${error.message}`);
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

    console.log(`[Instance:${this.instanceId}] Route set up for category ${this.categoryId}`);
  }

  /**
   * Connect WhatsApp client with improved error handling
   * @param {boolean} showQrCode - Whether to force QR code generation
   * @returns {Promise<boolean>} - Connection success status
   */
  async connect(showQrCode = false) {
    try {
      console.log(`[Instance:${this.instanceId}] Connecting WhatsApp...`);
      
      await this.loadSettings();

      // Verify Discord client is available
      if (!this.discordClient) {
        throw new Error(`[Instance:${this.instanceId}] Discord client is required to connect WhatsApp`);
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
          baileysAuthFolder: this.paths.baileys_auth, // Explicit Baileys auth folder
          tempDir: this.paths.temp,
          instanceId: this.instanceId,
          maxRetries: 5,
        });
      }

      // Set up event handlers - CRITICAL: Do this BEFORE initialization
      this.setupWhatsAppClientEvents();

      // Update component relationships
      this.managers.channelManager.setWhatsAppClient(this.clients.whatsAppClient);
      this.managers.userCardManager.setWhatsAppClient(this.clients.whatsAppClient);

      if (this.handlers.vouchHandler) {
        this.handlers.vouchHandler.whatsAppClient = this.clients.whatsAppClient;
      }

      if (this.handlers.discordHandler) {
        this.handlers.discordHandler.whatsAppClient = this.clients.whatsAppClient;
      }

      // Set force QR flag if method exists
      if (typeof this.clients.whatsAppClient.setShowQrCode === 'function') {
        this.clients.whatsAppClient.setShowQrCode(showQrCode);
      }

      // Clear any existing QR code timeout
      if (this.qrCodeTimer) {
        clearTimeout(this.qrCodeTimer);
        this.qrCodeTimer = null;
      }

      // Initialize WhatsApp client with retry mechanism
      let success = false;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (!success && retryCount < maxRetries) {
        try {
          console.log(`[Instance:${this.instanceId}] Initialization attempt ${retryCount + 1}/${maxRetries}`);
          success = await this.clients.whatsAppClient.initialize();
          
          if (success) {
            console.log(`[Instance:${this.instanceId}] WhatsApp client initialized successfully`);
            break;
          } else {
            console.log(`[Instance:${this.instanceId}] Initialization returned false, retrying...`);
          }
        } catch (initError) {
          console.error(`[Instance:${this.instanceId}] Error during initialization attempt ${retryCount + 1}:`, initError);
        }
        
        retryCount++;
        if (retryCount < maxRetries) {
          // Add small delay before retry
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Update connection state based on client status
      if (success && this.clients.whatsAppClient.isReady) {
        this.connected = true;
        console.log(`[Instance:${this.instanceId}] WhatsApp connected and ready`);
        
        // Set up Discord routes for message handling
        this._setupDiscordRoutes();
        
        // Emit ready event
        if (this.events) {
          this.events.emit('ready');
        }
      } else if (success) {
        console.log(`[Instance:${this.instanceId}] WhatsApp initialized but waiting for connection`);
      } else {
        console.log(`[Instance:${this.instanceId}] WhatsApp initialization failed after ${maxRetries} attempts`);
      }

      return success;
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error connecting WhatsApp:`, error);
      return false;
    }
  }

  /**
   * Ensure instance is connected - for auto-reconnect on startup
   * @returns {Promise<boolean>} - Connection status
   */
  async ensureConnected() {
    try {
      // Check if already connected
      if (this.isConnected()) {
        console.log(`[Instance:${this.instanceId}] Already connected, no action needed`);
        return true;
      }
      
      console.log(`[Instance:${this.instanceId}] Not connected, attempting to restore connection`);
      
      // Try to connect without forcing QR code
      const connected = await this.connect(false);
      
      // Check if connection was successful
      if (connected && this.isConnected()) {
        console.log(`[Instance:${this.instanceId}] Connection restored successfully`);
        return true;
      }
      
      // Check if we have client and it's pre-authenticated
      if (this.clients.whatsAppClient && await this.clients.whatsAppClient.isAuthenticated()) {
        console.log(`[Instance:${this.instanceId}] Client is pre-authenticated, but not yet connected`);
        
        // Try more directly to restore session
        try {
          await this.clients.whatsAppClient.restoreSession();
          
          // Check if now connected
          if (this.isConnected()) {
            console.log(`[Instance:${this.instanceId}] Session restored successfully`);
            return true;
          }
        } catch (restoreError) {
          console.error(`[Instance:${this.instanceId}] Error restoring session:`, restoreError);
        }
      }
      
      console.log(`[Instance:${this.instanceId}] Could not restore connection automatically, QR code scan needed`);
      return false;
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error ensuring connection:`, error);
      return false;
    }
  }

  /**
   * Disconnect the WhatsApp client with improved cleanup
   * @param {boolean} logOut - Whether to logout/remove auth data
   * @returns {Promise<boolean>} - Disconnect success status
   */
  async disconnect(logOut = false) {
    try {
      console.log(`[Instance:${this.instanceId}] Disconnecting WhatsApp...${logOut ? ' (with full logout)' : ''}`);

      // Flag to prevent auto-reconnect
      this.reconnecting = false;

      if (!this.clients.whatsAppClient) {
        console.log(`[Instance:${this.instanceId}] No WhatsApp client to disconnect`);
        this.connected = false;
        return true;
      }

      // Clear QR code tracking
      this.lastQrCode = null;
      if (this.qrCodeTimer) {
        clearTimeout(this.qrCodeTimer);
        this.qrCodeTimer = null;
      }

      // Properly disconnect the client
      try {
        await this.clients.whatsAppClient.disconnect(logOut);
        console.log(`[Instance:${this.instanceId}] WhatsApp client disconnected successfully`);
      } catch (disconnectError) {
        console.error(`[Instance:${this.instanceId}] Error during client disconnect:`, disconnectError);
        // Continue anyway
      }

      // Clean up Discord routes
      if (this.discordClient && this.discordClient._instanceRoutes) {
        // Only remove our own route
        this.discordClient._instanceRoutes.delete(this.categoryId);
      }

      // Additional cleanup for auth files if requested
      if (logOut) {
        this.cleanAuthFiles();
      }

      // Clean temporary files
      this.cleanTempFiles();

      // Update state
      this.connected = false;

      // Emit disconnect event
      if (this.events) {
        this.events.emit('disconnect', logOut ? 'logout' : 'disconnect');
      }

      return true;
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error disconnecting:`, error);

      // Force update state on error
      this.connected = false;

      // Try to emit disconnect event even on error
      if (this.events) {
        this.events.emit('disconnect', 'error');
      }

      return false;
    }
  }

  /**
   * Clean auth files to force new QR code on next connection
   */
  cleanAuthFiles() {
    try {
      console.log(`[Instance:${this.instanceId}] Cleaning authentication files`);
      
      // Define auth directories and files
      const authDirs = [
        this.paths.auth,
        this.paths.baileys_auth,
        path.join(this.paths.auth, 'baileys_auth')
      ];
      
      const authFiles = [
        path.join(this.baseDir, 'creds.json'),
        path.join(this.paths.auth, 'creds.json'),
        path.join(this.paths.baileys_auth, 'creds.json'),
        path.join(this.paths.auth, 'baileys_auth', 'creds.json')
      ];
      
      // Clean auth files
      for (const filePath of authFiles) {
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            console.log(`[Instance:${this.instanceId}] Deleted auth file: ${filePath}`);
          } catch (error) {
            console.error(`[Instance:${this.instanceId}] Error deleting auth file ${filePath}:`, error);
          }
        }
      }
      
      // Clean auth directories
      for (const dirPath of authDirs) {
        if (fs.existsSync(dirPath)) {
          try {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
              const fullPath = path.join(dirPath, file);
              if (fs.statSync(fullPath).isFile()) {
                fs.unlinkSync(fullPath);
                console.log(`[Instance:${this.instanceId}] Deleted auth file: ${fullPath}`);
              }
            }
          } catch (error) {
            console.error(`[Instance:${this.instanceId}] Error cleaning auth directory ${dirPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error cleaning auth files:`, error);
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
    
    // If already connected, trigger immediately
    if (this.isConnected()) {
      setTimeout(() => callback(), 0);
    }
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
      reconnectAttempts: this.reconnectAttempts,
      reconnecting: this.reconnecting
    };
  }
}

module.exports = Instance;
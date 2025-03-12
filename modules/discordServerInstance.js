// modules/DiscordServerInstance.js - Improved and self-contained
const fs = require("fs");
const path = require("path");
const { Events } = require("discord.js");

// Import required managers
const UserCardManager = require("./userCardManager");
const ChannelManager = require("./channelManager");
const TicketManager = require("./ticketManager");
const MediaManager = require("./MediaManager");
const BaileysClient = require("./baileysClient");
const BaileysWhatsAppHandler = require("./baileysWhatsAppHandler");
const BaileysDiscordHandler = require("./baileysDiscordHandler");
const BaileysVouchHandler = require("./baileysVouchHandler");

/**
 * DiscordServerInstance - A self-contained class that encapsulates all components for a Discord server
 * Each instance is completely isolated with its own managers, handlers, and state
 */
class DiscordServerInstance {
  /**
   * Create a new server instance
   * @param {Object} options Configuration for this server instance
   */
  constructor(options) {
    // Required options
    this.instanceId = options.instanceId;
    this.discordClient = options.discordClient;
    this.guildId = options.guildId;
    this.categoryId = options.categoryId;

    // Optional channels
    this.transcriptChannelId = options.transcriptChannelId || null; // Can be null
    this.vouchChannelId = options.vouchChannelId || null; // Can be null

    // Custom settings
    this.customSettings = options.customSettings || {};

    // Event callbacks
    this.callbacks = {
      onQRCode: null,
      onReady: null,
      onMessage: null,
      onDisconnect: null,
      onTicketCreated: null,
      onTicketClosed: null,
    };

    // Setup instance directories
    this.setupDirectories(options.paths);

    // Initialize managers with proper instance isolation
    this.initializeManagers();

    console.log(
      `[Instance:${this.instanceId}] Initialized with guild ${this.guildId}`
    );
  }

  async saveSettingsToDisk(settings) {
    try {
      // Make sure we have a settings file path
      const settingsFilePath = path.join(this.baseDir, 'settings.json');
      
      // Merge with existing settings
      this.customSettings = {
        ...this.customSettings,
        ...settings
      };
      
      // Ensure the directory exists
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      
      // Save to disk
      fs.writeFileSync(
        settingsFilePath, 
        JSON.stringify(this.customSettings, null, 2),
        'utf8'
      );
      
      console.log(`[Instance:${this.instanceId}] Saved settings to disk at ${settingsFilePath}`);
      
      // Apply settings to the instance components
      await this.applySettingsToComponents(this.customSettings);
      
      return true;
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error saving settings to disk:`, error);
      return false;
    }
  }

  async applySettingsToComponents(settings) {
    try {
      // Apply to WhatsApp handler
      if (this.whatsAppHandler) {
        if (settings.welcomeMessage) {
          this.whatsAppHandler.welcomeMessage = settings.welcomeMessage;
        }
        if (settings.introMessage) {
          this.whatsAppHandler.introMessage = settings.introMessage;
        }
        if (settings.reopenTicketMessage) {
          this.whatsAppHandler.reopenTicketMessage = settings.reopenTicketMessage;
        }
      }
      
      // Apply to Vouch handler
      if (this.vouchHandler) {
        if (typeof this.vouchHandler.setCustomVouchMessage === 'function' && settings.vouchMessage) {
          this.vouchHandler.setCustomVouchMessage(settings.vouchMessage);
        }
        
        // Toggle vouch enabled state
        if (settings.hasOwnProperty('vouchEnabled')) {
          this.vouchHandler.isDisabled = !settings.vouchEnabled;
        }
      }
      
      // Apply to TicketManager
      if (this.ticketManager) {
        if (typeof this.ticketManager.setCustomCloseMessage === 'function' && settings.closingMessage) {
          this.ticketManager.setCustomCloseMessage(settings.closingMessage);
        }
        
        if (typeof this.ticketManager.setCustomIntroMessage === 'function' && settings.newTicketMessage) {
          this.ticketManager.setCustomIntroMessage(settings.newTicketMessage);
        }
      }
      
      // Apply to TranscriptManager
      if (this.transcriptManager) {
        if (settings.hasOwnProperty('transcriptsEnabled')) {
          this.transcriptManager.isDisabled = !settings.transcriptsEnabled;
        }
      }
      
      return true;
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error applying settings to components:`, error);
      return false;
    }
  }
  
  /**
   * Load settings from disk with better error handling
   */
  async loadSettingsFromDisk() {
    try {
      const settingsFilePath = path.join(this.baseDir, 'settings.json');
      
      // Check if file exists first
      if (fs.existsSync(settingsFilePath)) {
        // Read and parse with error handling
        try {
          const fileContent = fs.readFileSync(settingsFilePath, 'utf8');
          if (fileContent.trim() === '') {
            console.log(`[Instance:${this.instanceId}] Settings file exists but is empty, using defaults`);
            return this.customSettings || {};
          }
          
          const settings = JSON.parse(fileContent);
          
          console.log(`[Instance:${this.instanceId}] Loaded settings from disk:`, 
            Object.keys(settings).join(', '));
          
          // Update instance settings
          this.customSettings = settings;
          
          // Apply the settings to components immediately
          await this.applySettingsToComponents(settings);
          
          return settings;
        } catch (parseError) {
          console.error(`[Instance:${this.instanceId}] Error parsing settings file:`, parseError);
          return this.customSettings || {};
        }
      } else {
        console.log(`[Instance:${this.instanceId}] No settings file found at ${settingsFilePath}, using defaults`);
        
        // Initialize with default settings
        const defaultSettings = {
          welcomeMessage: "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
          introMessage: "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
          reopenTicketMessage: "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
          newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
          closingMessage: "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
          vouchMessage: "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.",
          vouchSuccessMessage: "✅ Thank you for your vouch! It has been posted to our community channel.",
          sendClosingMessage: true,
          transcriptsEnabled: true,
          vouchEnabled: true
        };
        
        // Save defaults to disk for future use
        this.customSettings = defaultSettings;
        this.saveSettingsToDisk(defaultSettings);
        
        return defaultSettings;
      }
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error loading settings from disk:`, error);
      return this.customSettings || {};
    }
  }

  
  /**
   * Setup instance directories
   * @param {Object} [customPaths] Custom directory paths
   */
  setupDirectories(customPaths = {}) {
    // Base directory for this instance
    const instancesDir = path.join(__dirname, '..', 'instances');
    this.baseDir = path.join(instancesDir, this.instanceId);
    
    // Define paths with fallbacks to default locations, removing redundant directories
    this.paths = {
      auth: customPaths.auth || path.join(this.baseDir, 'auth'),
      temp: customPaths.temp || path.join(this.baseDir, 'temp'),
      transcripts: customPaths.transcripts || path.join(this.baseDir, 'transcripts'),
      assets: customPaths.assets || path.join(this.baseDir, 'assets'),
      logs: customPaths.logs || path.join(this.baseDir, 'logs')
    };
    
    // Remove 'media_archive' and other unnecessary directories
    
    // Create directories if they don't exist
    Object.values(this.paths).forEach(dirPath => {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    });
    
    console.log(`[Instance:${this.instanceId}] Directories initialized`);
  }
  

  /**
   * Initialize managers with instance isolation
   */
  initializeManagers() {
    // Initialize user card manager
    this.userCardManager = new UserCardManager(this.instanceId);

    // Initialize channel manager
    this.channelManager = new ChannelManager(this.instanceId);

    // Load data from persistent storage
    this.userCardManager.loadUserCards();
    this.channelManager.loadChannelMap();

    // Initialize media manager
    try {
      this.mediaManager = new MediaManager({
        instanceId: this.instanceId,
        baseDir: this.paths.media,
      });
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error creating MediaManager:`,
        error
      );

      // Fallback to simplified media manager
      const simplifiedMediaManager = require("./simplifiedMediaManager");
      if (typeof simplifiedMediaManager.setInstanceId === "function") {
        simplifiedMediaManager.setInstanceId(this.instanceId);
      }
      this.mediaManager = simplifiedMediaManager;
    }

    console.log(`[Instance:${this.instanceId}] Base managers initialized`);
  }

  /**
   * Initialize ticket manager and transcript manager
   * Requires Discord client to be available
   */
  initializeTicketManager() {
    // Verify Discord client is available
    if (!this.discordClient) {
      throw new Error(
        `[Instance:${this.instanceId}] Discord client is required for ticket manager`
      );
    }

    try {
      // Initialize ticket manager
      this.ticketManager = new TicketManager(
        this.channelManager,
        this.discordClient,
        this.guildId,
        this.categoryId,
        {
          instanceId: this.instanceId,
          customIntroMessages: this.customSettings?.introMessage,
          customCloseMessages: this.customSettings?.closingMessage,
        }
      );

      // Always create the transcript manager, but configure it based on settings
      const TranscriptManager = require("./TranscriptManager");
      this.transcriptManager = new TranscriptManager({
        instanceId: this.instanceId,
        transcriptChannelId: this.transcriptChannelId, // Can be null, it will handle this internally
        discordClient: this.discordClient,
        guildId: this.guildId,
        baseDir: this.paths.transcripts,
      });

      // Set local-only flag if no transcriptChannelId is provided
      if (!this.transcriptChannelId) {
        console.log(
          `[Instance:${this.instanceId}] No transcript channel provided, using local-only transcripts`
        );
        this.transcriptManager.localOnly = true;
      }

      // Set transcriptsEnabled flag based on custom settings
      if (
        this.customSettings &&
        this.customSettings.transcriptsEnabled === false
      ) {
        this.transcriptManager.isDisabled = true;
        console.log(
          `[Instance:${this.instanceId}] Transcripts explicitly disabled via settings`
        );
      }

      // Connect all managers
      this.ticketManager.setUserCardManager(this.userCardManager);
      this.ticketManager.setTranscriptManager(this.transcriptManager);
      this.ticketManager.setMediaManager(this.mediaManager);

      console.log(
        `[Instance:${this.instanceId}] Ticket and transcript managers initialized`
      );
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error initializing ticket manager:`,
        error
      );
      throw error;
    }
  }

  /**
   * Initialize WhatsApp client connection
   * @returns {Promise<boolean>} Connection success status
   */
  async connect() {
    try {
      console.log(`[Instance:${this.instanceId}] Connecting WhatsApp...`);

      await this.loadSettingsFromDisk();
  
      // Verify Discord client is available
      if (!this.discordClient) {
        throw new Error(
          `[Instance:${this.instanceId}] Discord client is required to connect WhatsApp`
        );
      }
  
      // Make sure ticket manager is initialized
      if (!this.ticketManager) {
        this.initializeTicketManager();
      }
  
      // Create Baileys client with instance-specific auth folder if not already created
      if (!this.baileysClient) {
        this.baileysClient = new BaileysClient({
          authFolder: this.paths.auth,
          tempDir: this.paths.temp,
          instanceId: this.instanceId,
        });
  
        // Set up event handlers
        this.setupBaileysClientEvents();
      }
  
      // Initialize WhatsApp client
      const success = await this.baileysClient.initialize();

      await this.loadSettingsFromDisk();
  
      // If already authenticated, initialize handlers immediately
      if (success && this.baileysClient.isReady) {
        console.log(
          `[Instance:${this.instanceId}] WhatsApp already authenticated`
        );
        this.initializeHandlers();
  
        // Call the ready callback if set
        if (typeof this.callbacks.onReady === "function") {
          this.callbacks.onReady();
        }
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
   * Set up event handlers for Baileys client
   */
  setupBaileysClientEvents() {
    // Set up QR code event handler
    this.baileysClient.on("qr", (qr) => {
      console.log(`[Instance:${this.instanceId}] WhatsApp QR code received`);

      // Call the QR code callback if set
      if (typeof this.callbacks.onQRCode === "function") {
        this.callbacks.onQRCode(qr);
      }
    });

    // Store reference to this for callbacks
    const self = this;

    // Set up ready event handler
    this.baileysClient.on("ready", () => {
      console.log(`[Instance:${self.instanceId}] WhatsApp client is ready`);

      // Initialize handlers
      self.initializeHandlers();

      // Call the ready callback if set
      if (typeof self.callbacks.onReady === "function") {
        self.callbacks.onReady();
      }
    });

    // Set up disconnect event handler
    this.baileysClient.on("disconnected", (reason) => {
      console.log(
        `[Instance:${self.instanceId}] WhatsApp disconnected: ${reason}`
      );

      // Call the disconnect callback if set
      if (typeof self.callbacks.onDisconnect === "function") {
        self.callbacks.onDisconnect(reason);
      }
    });
  }

  /**
   * Initialize handlers for WhatsApp and Discord
   */
  initializeHandlers() {
    try {
      // Check if we've already initialized handlers to prevent duplicates
      if (this.whatsAppHandler) {
        console.log(`[Instance:${this.instanceId}] Handlers already initialized, skipping`);
        return;
      }
      
      // Initialize the VouchHandler only if vouchChannelId is provided
      if (this.vouchChannelId) {
        this.vouchHandler = new BaileysVouchHandler(
          this.baileysClient,
          this.discordClient,
          this.guildId,
          this.vouchChannelId,
          this.userCardManager,
          {
            instanceId: this.instanceId,
            tempDir: this.paths.temp,
            assetsDir: this.paths.assets,
          }
        );
    
        // Set channel manager reference
        this.vouchHandler.setChannelManager(this.channelManager);
    
        // Set custom vouch message if specified in settings
        if (this.customSettings && this.customSettings.vouchMessage) {
          this.vouchHandler.setCustomVouchMessage(this.customSettings.vouchMessage);
        }
    
        // Disable vouches if specified in settings
        if (this.customSettings && this.customSettings.vouchEnabled === false) {
          this.vouchHandler.isDisabled = true;
          console.log(
            `[Instance:${this.instanceId}] Vouches explicitly disabled via settings`
          );
        }
      } else {
        console.log(
          `[Instance:${this.instanceId}] No vouch channel provided, vouch system disabled`
        );
        // Create a dummy voucher that does nothing
        this.vouchHandler = {
          handleVouchCommand: async () => false,
          handleDiscordVouchCommand: async (message) => {
            await message.reply("Vouch system is not enabled for this server.");
            return true;
          },
          isDisabled: true,
        };
      }
    
      // Initialize WhatsApp handler
      this.whatsAppHandler = new BaileysWhatsAppHandler(
        this.baileysClient,
        this.userCardManager,
        this.channelManager,
        this.ticketManager,
        this.transcriptManager,
        this.vouchHandler,
        {
          instanceId: this.instanceId,
          mediaManager: this.mediaManager,
          tempDir: this.paths.temp,
        }
      );
    
      // Apply custom welcome and intro messages if provided
      if (this.customSettings) {
        if (this.customSettings.welcomeMessage) {
          this.whatsAppHandler.welcomeMessage =
            this.customSettings.welcomeMessage;
        }
    
        if (this.customSettings.introMessage) {
          this.whatsAppHandler.introMessage = this.customSettings.introMessage;
        }
      }
    
      // Initialize Discord handler
      this.discordHandler = new BaileysDiscordHandler(
        this.discordClient,
        this.categoryId,
        this.channelManager,
        this.userCardManager,
        this.ticketManager,
        this.transcriptManager,
        this.baileysClient,
        {
          instanceId: this.instanceId,
          tempDir: this.paths.temp,
          assetsDir: this.paths.assets,
        }
      );
    
      // Set reference to vouchHandler in Discord handler
      this.discordHandler.vouchHandler = this.vouchHandler;
    
      // Register this instance with Discord for message routing
      this.registerWithDiscord();
    
      console.log(
        `[Instance:${this.instanceId}] Handlers initialized successfully`
      );
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error initializing handlers:`,
        error
      );
    }
  }

  async updateSettings(newSettings) {
    try {
      // Save the new settings to disk first for persistence
      await this.saveSettingsToDisk(newSettings);
      
      // Apply settings to handlers
      if (this.whatsAppHandler) {
        if (newSettings.welcomeMessage) {
          this.whatsAppHandler.welcomeMessage = newSettings.welcomeMessage;
        }
        if (newSettings.introMessage) {
          this.whatsAppHandler.introMessage = newSettings.introMessage;
        }
        if (newSettings.reopenTicketMessage) {
          this.whatsAppHandler.reopenTicketMessage = newSettings.reopenTicketMessage;
        }
      }
      
      if (this.vouchHandler && typeof this.vouchHandler.setCustomVouchMessage === 'function' && newSettings.vouchMessage) {
        this.vouchHandler.setCustomVouchMessage(newSettings.vouchMessage);
      }
      
      if (this.ticketManager && newSettings.closingMessage) {
        this.ticketManager.setCustomCloseMessage(newSettings.closingMessage);
      }
      
      if (this.ticketManager && newSettings.newTicketMessage) {
        this.ticketManager.setCustomIntroMessage(newSettings.newTicketMessage);
      }
      
      // Toggle features if specified
      if (newSettings.hasOwnProperty('transcriptsEnabled') && this.transcriptManager) {
        this.transcriptManager.isDisabled = !newSettings.transcriptsEnabled;
      }
      
      if (newSettings.hasOwnProperty('vouchEnabled') && this.vouchHandler) {
        this.vouchHandler.isDisabled = !newSettings.vouchEnabled;
      }
      
      if (newSettings.hasOwnProperty('sendClosingMessage')) {
        this.customSettings.sendClosingMessage = newSettings.sendClosingMessage;
      }
      
      return true;
    } catch (error) {
      console.error(`[Instance:${this.instanceId}] Error updating settings:`, error);
      return false;
    }
  }

async ensureConnected() {
  try {
    if (this.isConnected()) {
      return true;
    }
    
    console.log(`[Instance:${this.instanceId}] Ensuring WhatsApp connection...`);
    
    // Check if auth exists for this instance
    const authDir = path.join(this.baseDir, 'baileys_auth');
    const baileysAuthDir = path.join(this.paths.auth, 'baileys_auth');
    
    const credsPath = path.join(authDir, 'creds.json');
    const baileysCredsPath = path.join(baileysAuthDir, 'creds.json');
    
    // Check if we have credentials
    const hasCredentials = fs.existsSync(credsPath) || fs.existsSync(baileysCredsPath);
    
    if (!hasCredentials) {
      console.log(`[Instance:${this.instanceId}] No credentials found, connection will require QR scan`);
      return false;
    }
    
    // Try to connect with existing credentials
    console.log(`[Instance:${this.instanceId}] Found credentials, attempting to reconnect...`);
    return await this.connect();
  } catch (error) {
    console.error(`[Instance:${this.instanceId}] Error ensuring connection:`, error);
    return false;
  }
}

  /**
   * Register this instance with Discord client for message routing
   */
  registerWithDiscord() {
    if (!this.discordClient) {
      console.warn(`[Instance:${this.instanceId}] Cannot register Discord handlers: No Discord client available`);
      return;
    }
  
    // Store instance ID with Discord client for message routing
    if (!this.discordClient._instanceRoutes) {
      this.discordClient._instanceRoutes = new Map();
    }
    
    // Check if this category is already registered
    if (this.discordClient._instanceRoutes.has(this.categoryId)) {
      console.log(`[Instance:${this.instanceId}] Category ${this.categoryId} already registered, updating registration`);
    }
  
    // Register this instance's category for message routing
    this.discordClient._instanceRoutes.set(this.categoryId, {
      instanceId: this.instanceId,
      handler: this.discordHandler,
      instance: this
    });
    
    console.log(`[Instance:${this.instanceId}] Registered Discord handlers for category ${this.categoryId}`);
  }

  /**
   * Disconnect WhatsApp client
   * @returns {Promise<boolean>} Disconnect success status
   */
  async disconnect(logOut = false) {
    try {
      console.log(`[Instance:${this.instanceId}] Disconnecting WhatsApp...${logOut ? ' (with full logout)' : ''}`);
    
      if (this.baileysClient) {
        try {
          // Properly disconnect the client
          await this.baileysClient.disconnect(logOut);
          
          // If we're doing a full logout, clean up auth files
          if (logOut) {
            const authPath = path.join(this.paths.auth, 'creds.json');
            const baileysAuthDir = path.join(this.paths.auth, 'baileys_auth');
            
            // Delete baileys auth files if they exist
            if (fs.existsSync(baileysAuthDir)) {
              const files = fs.readdirSync(baileysAuthDir);
              files.forEach(file => {
                try {
                  fs.unlinkSync(path.join(baileysAuthDir, file));
                  console.log(`[Instance:${this.instanceId}] Deleted auth file: ${file}`);
                } catch (e) {
                  console.error(`[Instance:${this.instanceId}] Error deleting auth file ${file}:`, e);
                }
              });
            }
            
            // Delete primary creds file if it exists
            if (fs.existsSync(authPath)) {
              fs.unlinkSync(authPath);
              console.log(`[Instance:${this.instanceId}] Deleted creds.json file`);
            }
          }
        } catch (e) {
          console.error(`[Instance:${this.instanceId}] Error during disconnect:`, e);
        }
      }
    
      // Clean up Discord routes
      if (this.discordClient && this.discordClient._instanceRoutes) {
        this.discordClient._instanceRoutes.delete(this.categoryId);
      }
    
      // Clean temp files
      this.cleanTempFiles();
    
      return true;
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error disconnecting:`,
        error
      );
      return false;
    }
  }

  /**
   * Clean temporary files
   */
  cleanTempFiles() {
    try {
      if (fs.existsSync(this.paths.temp)) {
        const files = fs.readdirSync(this.paths.temp);

        for (const file of files) {
          try {
            fs.unlinkSync(path.join(this.paths.temp, file));
          } catch (e) {
            console.error(
              `[Instance:${this.instanceId}] Could not delete temp file ${file}: ${e.message}`
            );
          }
        }

        console.log(
          `[Instance:${this.instanceId}] Cleaned ${files.length} temp files`
        );
      }
    } catch (error) {
      console.error(
        `[Instance:${this.instanceId}] Error cleaning temp files:`,
        error
      );
    }
  }

  /**
   * Check if WhatsApp is connected
   * @returns {boolean} Connection status
   */
  isConnected() {
    return this.baileysClient && this.baileysClient.isReady;
  }

  /**
   * Set callback for QR code event
   * @param {Function} callback Function to call when QR code is received
   */
  onQRCode(callback) {
    this.callbacks.onQRCode = callback;
  }

  /**
   * Set callback for ready event
   * @param {Function} callback Function to call when WhatsApp is ready
   */
  onReady(callback) {
    this.callbacks.onReady = callback;
  }

  /**
   * Set callback for disconnect event
   * @param {Function} callback Function to call when WhatsApp disconnects
   */
  onDisconnect(callback) {
    this.callbacks.onDisconnect = callback;
  }

  /**
   * Get instance status information
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      instanceId: this.instanceId,
      guildId: this.guildId,
      isConnected: this.isConnected(),
      activeTickets: this.channelManager
        ? this.channelManager.getChannelMapSize()
        : 0,
      registeredUsers: this.userCardManager
        ? this.userCardManager.getUserCardCount()
        : 0,
      transcriptChannel: this.transcriptChannelId,
      vouchChannel: this.vouchChannelId,
      paths: this.paths,
    };
  }
}

module.exports = DiscordServerInstance;

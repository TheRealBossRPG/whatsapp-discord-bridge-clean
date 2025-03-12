const fs = require('fs');
const path = require('path');
const EventBus = require('./EventBus');
const ModuleLoader = require('./ModuleLoader');

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
    
    // Initialize directories
    this.initializeDirectories();
  }
  
  initializeDirectories() {
    this.baseDir = path.join(__dirname, '..', 'instances', this.instanceId);
    
    // Define paths with fallbacks to default locations
    this.paths = {
      auth: path.join(this.baseDir, 'auth'),
      temp: path.join(this.baseDir, 'temp'),
      transcripts: path.join(this.baseDir, 'transcripts'),
      assets: path.join(this.baseDir, 'assets'),
      logs: path.join(this.baseDir, 'logs')
    };
    
    // Create directories if they don't exist
    Object.values(this.paths).forEach(dirPath => {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    });
  }
  
  async initialize() {
    try {
      // 1. Initialize all managers
      const ChannelManager = require('../modules/managers/ChannelManager');
      const UserCardManager = require('../modules/managers/UserCardManager');
      const TranscriptManager = require('../modules/managers/TranscriptManager');
      const TicketManager = require('../modules/managers/TicketManager');
      
      this.managers.channelManager = new ChannelManager(this.instanceId);
      this.managers.userCardManager = new UserCardManager(this.instanceId);
      this.managers.transcriptManager = new TranscriptManager({
        instanceId: this.instanceId,
        transcriptChannelId: this.transcriptChannelId,
        discordClient: this.discordClient,
        guildId: this.guildId,
        baseDir: this.paths.transcripts
      });
      
      this.managers.ticketManager = new TicketManager(
        this.managers.channelManager,
        this.discordClient,
        this.guildId,
        this.categoryId,
        {
          instanceId: this.instanceId,
          customIntroMessages: this.customSettings?.introMessage,
          customCloseMessages: this.customSettings?.closingMessage
        }
      );
      
      // Connect managers to each other
      this.managers.ticketManager.setUserCardManager(this.managers.userCardManager);
      this.managers.ticketManager.setTranscriptManager(this.managers.transcriptManager);
      
      // 2. Initialize WhatsApp client
      const BaileysClient = require('../modules/clients/BaileysClient');
      this.clients.whatsAppClient = new BaileysClient({
        authFolder: this.paths.auth,
        tempDir: this.paths.temp,
        instanceId: this.instanceId
      });
      
      // 3. Initialize handlers
      const WhatsAppHandler = require('../modules/handlers/WhatsAppHandler');
      const DiscordHandler = require('../modules/handlers/DiscordHandler');
      const VouchHandler = require('../modules/handlers/VouchHandler');
      
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
            assetsDir: this.paths.assets
          }
        );
        
        // Connect to channel manager
        this.handlers.vouchHandler.setChannelManager(this.managers.channelManager);
        
        // Set custom message if specified
        if (this.customSettings && this.customSettings.vouchMessage) {
          this.handlers.vouchHandler.setCustomVouchMessage(this.customSettings.vouchMessage);
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
          tempDir: this.paths.temp
        }
      );
      
      // Apply custom messages
      if (this.customSettings) {
        if (this.customSettings.welcomeMessage) {
          this.handlers.whatsAppHandler.welcomeMessage = this.customSettings.welcomeMessage;
        }
        if (this.customSettings.introMessage) {
          this.handlers.whatsAppHandler.introMessage = this.customSettings.introMessage;
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
          assetsDir: this.paths.assets
        }
      );
      
      // Connect vouch handler to Discord handler
      if (this.handlers.vouchHandler) {
        this.handlers.discordHandler.vouchHandler = this.handlers.vouchHandler;
      }
      
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
      const settingsPath = path.join(this.baseDir, 'settings.json');
      
      if (fs.existsSync(settingsPath)) {
        // Read settings file
        const fileContent = fs.readFileSync(settingsPath, 'utf8');
        if (fileContent.trim() === '') {
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
      const settingsPath = path.join(this.baseDir, 'settings.json');
      
      // Merge with existing settings
      this.customSettings = {
        ...this.customSettings,
        ...settings
      };
      
      // Save to disk
      fs.writeFileSync(
        settingsPath, 
        JSON.stringify(this.customSettings, null, 2),
        'utf8'
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
          this.handlers.whatsAppHandler.welcomeMessage = settings.welcomeMessage;
        }
        if (settings.introMessage) {
          this.handlers.whatsAppHandler.introMessage = settings.introMessage;
        }
        if (settings.reopenTicketMessage) {
          this.handlers.whatsAppHandler.reopenTicketMessage = settings.reopenTicketMessage;
        }
      }
      
      // Apply to Vouch handler
      if (this.handlers.vouchHandler) {
        if (settings.vouchMessage && typeof this.handlers.vouchHandler.setCustomVouchMessage === 'function') {
          this.handlers.vouchHandler.setCustomVouchMessage(settings.vouchMessage);
        }
        
        // Toggle vouch enabled state
        if (settings.hasOwnProperty('vouchEnabled')) {
          this.handlers.vouchHandler.isDisabled = !settings.vouchEnabled;
        }
      }
      
      // Apply to TicketManager
      if (this.managers.ticketManager) {
        if (settings.closingMessage && typeof this.managers.ticketManager.setCustomCloseMessage === 'function') {
          this.managers.ticketManager.setCustomCloseMessage(settings.closingMessage);
        }
        
        if (settings.newTicketMessage && typeof this.managers.ticketManager.setCustomIntroMessage === 'function') {
          this.managers.ticketManager.setCustomIntroMessage(settings.newTicketMessage);
        }
      }
      
      // Apply to TranscriptManager
      if (this.managers.transcriptManager) {
        if (settings.hasOwnProperty('transcriptsEnabled')) {
          this.managers.transcriptManager.isDisabled = !settings.transcriptsEnabled;
        }
      }
      
      return true;
    } catch (error) {
      console.error(`Error applying settings for instance ${this.instanceId}: ${error.message}`);
      return false;
    }
  }
  
  async connect() {
    try {
      // Connect WhatsApp client
      const success = await this.clients.whatsAppClient.initialize();
      this.connected = success;
      return success;
    } catch (error) {
      console.error(`Error connecting instance ${this.instanceId}: ${error.message}`);
      this.connected = false;
      return false;
    }
  }
  
  async disconnect(logOut = false) {
    try {
      // Disconnect WhatsApp client
      if (this.clients.whatsAppClient) {
        await this.clients.whatsAppClient.disconnect(logOut);
      }
      
      this.connected = false;
      return true;
    } catch (error) {
      console.error(`Error disconnecting instance ${this.instanceId}: ${error.message}`);
      return false;
    }
  }
  
  isConnected() {
    return this.connected && this.clients.whatsAppClient && this.clients.whatsAppClient.isReady;
  }
  
  onQRCode(callback) {
    if (this.clients.whatsAppClient) {
      this.clients.whatsAppClient.on('qr', callback);
    }
  }
  
  onReady(callback) {
    if (this.clients.whatsAppClient) {
      this.clients.whatsAppClient.on('ready', callback);
    }
  }
  
  onDisconnect(callback) {
    if (this.clients.whatsAppClient) {
      this.clients.whatsAppClient.on('disconnected', callback);
    }
  }
  
  getStatus() {
    return {
      instanceId: this.instanceId,
      guildId: this.guildId,
      isConnected: this.isConnected(),
      activeTickets: this.managers.channelManager ? this.managers.channelManager.getChannelMapSize() : 0,
      registeredUsers: this.managers.userCardManager ? this.managers.userCardManager.getUserCardCount() : 0,
      transcriptChannel: this.transcriptChannelId,
      vouchChannel: this.vouchChannelId,
      paths: this.paths
    };
  }
}

module.exports = Instance;
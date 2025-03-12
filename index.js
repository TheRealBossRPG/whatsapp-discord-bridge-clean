// index.js - WhatsApp Discord Bridge
const express = require('express');
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Import modules
const bridgeInstanceManager = require('./modules/BridgeInstanceManager');
const discordCommands = require('./modules/discordCommands');
const interactionHandler = require('./interactionHandler');

// Load environment variables
dotenv.config();

// Express app
const app = express();
app.use(express.json());

// Create required directories
const instancesDir = path.join(__dirname, 'instances');
if (!fs.existsSync(instancesDir)) {
  fs.mkdirSync(instancesDir, { recursive: true });
}

// Create setup storage directory
const setupStorageDir = path.join(__dirname, 'setup_storage');
if (!fs.existsSync(setupStorageDir)) {
  fs.mkdirSync(setupStorageDir, { recursive: true });
}

// Add setup storage functions to global scope for easy access
global.setupStorage = {
  saveSetupParams: function(guildId, params) {
    try {
      const filePath = path.join(setupStorageDir, `${guildId}_setup.json`);
      
      // Ensure we aren't overwriting existing parameters if only partial update
      let existingParams = {};
      if (fs.existsSync(filePath)) {
        try {
          existingParams = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
          console.error(`Error reading existing setup parameters for guild ${guildId}:`, e);
        }
      }
      
      // Merge existing with new parameters
      const mergedParams = { ...existingParams, ...params };
      
      fs.writeFileSync(filePath, JSON.stringify(mergedParams, null, 2), 'utf8');
      console.log(`Saved setup parameters for guild ${guildId}`);
      
      return true;
    } catch (error) {
      console.error(`Error saving setup parameters for guild ${guildId}:`, error);
      return false;
    }
  },
  
  getSetupParams: function(guildId) {
    const filePath = path.join(setupStorageDir, `${guildId}_setup.json`);
    if (fs.existsSync(filePath)) {
      try {
        const params = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        console.log(`Retrieved setup parameters for guild ${guildId}`);
        return params;
      } catch (error) {
        console.error(`Error reading setup parameters for guild ${guildId}:`, error);
        return null;
      }
    }
    return null;
  },
  
  cleanupSetupParams: function(guildId) {
    const filePath = path.join(setupStorageDir, `${guildId}_setup.json`);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up setup parameters for guild ${guildId}`);
        return true;
      } catch (error) {
        console.error(`Error cleaning up setup parameters for guild ${guildId}:`, error);
        return false;
      }
    }
    return true; // Already clean
  },
  
  updateSetupParams: function(guildId, key, value) {
    try {
      const params = this.getSetupParams(guildId) || {};
      params[key] = value;
      return this.saveSetupParams(guildId, params);
    } catch (error) {
      console.error(`Error updating setup parameter ${key} for guild ${guildId}:`, error);
      return false;
    }
  }
};

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configure logging with timestamps
const startTime = new Date();
const logFileName = `log-${startTime.toISOString().replace(/:/g, '-')}.txt`;
const logFilePath = path.join(logsDir, logFileName);
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

// Override console methods to log to file
console.oldLog = console.log;
console.oldError = console.error;
console.oldWarn = console.warn;

console.log = function(...args) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [INFO] ${args.join(' ')}`;
  logStream.write(line + '\n');
  console.oldLog(line);
};

console.error = function(...args) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [ERROR] ${args.join(' ')}`;
  logStream.write(line + '\n');
  console.oldError(line);
};

console.warn = function(...args) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [WARN] ${args.join(' ')}`;
  logStream.write(line + '\n');
  console.oldWarn(line);
};

// Initialize Discord client with all required intents
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction
  ],
  restGlobalRateLimit: 50,
  retryLimit: 3
});

// Initialize global variable for custom settings
global.lastCustomSettings = null;

// Discord Event Listeners
discordClient.on('ready', async () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  
  // Register slash commands
  try {
    await discordCommands.registerCommands(discordClient);
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
  
  // Initialize all existing instances
  try {
    await bridgeInstanceManager.initializeInstances(discordClient);
  } catch (error) {
    console.error('Error initializing instances:', error);
  }
  
  console.log(`Ready to serve ${bridgeInstanceManager.instances.size} WhatsApp bridges`);
});

discordClient.on('interactionCreate', async (interaction) => {
  await interactionHandler.handleInteraction(interaction);
});

function getInstanceForInteraction(interaction) {
  if (!interaction.guildId) return null;
  
  // Check channel parent ID first for more specific matching
  if (interaction.channel && interaction.channel.parentId) {
    const categoryId = interaction.channel.parentId;
    if (discordClient._instanceRoutes && discordClient._instanceRoutes.has(categoryId)) {
      return bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    }
  }
  
  // Fall back to guild ID matching
  return bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
}

/**
 * Safely update an interaction response
 * @param {Interaction} interaction - Discord interaction
 * @param {string|Object} content - Update content
 */
async function safeUpdate(interaction, content) {
  try {
    const options = typeof content === 'string' ? { content } : content;
    
    if (interaction.replied) {
      await interaction.editReply(options);
    } else if (interaction.deferred) {
      await interaction.editReply(options);
    } else {
      await interaction.update(options);
    }
  } catch (error) {
    console.error('Error in safeUpdate:', error);
    
    // Fallback to reply if update fails
    try {
      if (!interaction.replied) {
        await interaction.reply({ ...options, ephemeral: true });
      }
    } catch (fallbackError) {
      console.error('Error in safeUpdate fallback:', fallbackError);
    }
  }
}

/**
 * Safely send a followup message
 * @param {Interaction} interaction - Discord interaction
 * @param {string|Object} content - Followup content
 */
async function safeFollowUp(interaction, content) {
  try {
    const options = typeof content === 'string' ? { content } : content;
    await interaction.followUp(options);
  } catch (error) {
    console.error('Error in safeFollowUp:', error);
  }
}

// Handler for edit message modal submissions
async function handleEditMessageModalSubmission(interaction) {
  try {
    // Get the type of message from the modal ID
    const modalId = interaction.customId;
    let messageType, inputId;
    
    if (modalId.startsWith('edit_welcome_modal')) {
      messageType = 'welcome';
      inputId = 'welcome_message';
    } else if (modalId.startsWith('edit_intro_modal')) {
      messageType = 'intro';
      inputId = 'intro_message';
    } else if (modalId.startsWith('edit_new_ticket_modal')) {
      messageType = 'new_ticket';
      inputId = 'new_ticket_message';
    } else if (modalId.startsWith('edit_closing_modal')) {
      messageType = 'closing';
      inputId = 'closing_message';
    } else if (modalId.startsWith('edit_vouch_modal')) {
      messageType = 'vouch';
      inputId = 'vouch_message';
    } else {
      await interaction.reply({
        content: "Unknown modal type. Please try again.",
        ephemeral: true
      });
      return;
    }
    
    // Get the new message from the submission
    const newMessage = interaction.fields.getTextInputValue(inputId);
    
    // Get the server instance
    const instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    if (!instance) {
      await interaction.reply({
        content: "❌ Server instance not found. Please set up the WhatsApp bridge first.",
        ephemeral: true
      });
      return;
    }
    
    // Get current settings
    if (!instance.customSettings) {
      instance.customSettings = {};
    }
    
    // Update the specific message type
    switch (messageType) {
      case 'welcome':
        instance.customSettings.welcomeMessage = newMessage;
        if (instance.whatsAppHandler) instance.whatsAppHandler.welcomeMessage = newMessage;
        break;
      case 'intro':
        instance.customSettings.introMessage = newMessage;
        if (instance.whatsAppHandler) instance.whatsAppHandler.introMessage = newMessage;
        break;
      case 'new_ticket':
        instance.customSettings.newTicketMessage = newMessage;
        if (instance.ticketManager) instance.ticketManager.setCustomIntroMessage(newMessage);
        break;
      case 'closing':
        instance.customSettings.closingMessage = newMessage;
        if (instance.ticketManager) instance.ticketManager.setCustomCloseMessage(newMessage);
        break;
      case 'vouch':
        instance.customSettings.vouchMessage = newMessage;
        if (instance.vouchHandler && typeof instance.vouchHandler.setCustomVouchMessage === 'function') {
          instance.vouchHandler.setCustomVouchMessage(newMessage);
        }
        break;
    }
    
    // Save the settings
    await bridgeInstanceManager.saveInstanceSettings(instance.instanceId, instance.customSettings);
    
    // Show preview with variables replaced
    let previewMessage = newMessage;
    if (messageType !== 'welcome') {
      // Replace variables in preview
      previewMessage = previewMessage
        .replace(/{name}/g, 'John Doe')
        .replace(/{phoneNumber}/g, '+1234567890');
    }
    
    // Confirm successful update
    await interaction.reply({
      content: `✅ The ${messageType} message has been updated!\n\n**New Message:**\n${previewMessage}`,
      ephemeral: true
    });
    
    console.log(`[DiscordCommands] ${messageType} message updated successfully by ${interaction.user.tag}`);
  } catch (error) {
    console.error(`Error processing modal submission:`, error);
    
    // Handle errors
    try {
      await interaction.reply({
        content: `❌ Error updating message: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      console.error(`Error sending error message:`, replyError);
    }
  }
}

// Message handler with instance routing
discordClient.on('messageCreate', async (message) => {
  try {
    // Skip bot messages and DMs
    if (message.author.bot || !message.guild) return;
    
    // Get category ID for this channel
    const categoryId = message.channel.parentId;
    if (!categoryId) return;
    
    // Check if this category belongs to an instance
    if (discordClient._instanceRoutes && discordClient._instanceRoutes.has(categoryId)) {
      const routeInfo = discordClient._instanceRoutes.get(categoryId);
      
      // Log details for debugging
      console.log(`Message in channel ${message.channel.name} (${message.channel.id}) belongs to instance ${routeInfo.instanceId || 'unknown'}`);
      
      const { handler, instance: routeInstance } = routeInfo;
      
      // First try using the handler directly
      if (handler && typeof handler.handleDiscordMessage === 'function') {
        try {
          await handler.handleDiscordMessage(message);
          return;
        } catch (handlerError) {
          console.error(`Error in direct handler for ${routeInfo.instanceId}: ${handlerError.message}`);
        }
      }
      
      // If direct handler failed, try the instance's handler
      if (routeInstance?.discordHandler?.handleDiscordMessage) {
        try {
          await routeInstance.discordHandler.handleDiscordMessage(message);
          return;
        } catch (instanceError) {
          console.error(`Error in instance handler for ${routeInfo.instanceId}: ${instanceError.message}`);
        }
      }
      
      // Final fallback - check all instances for this guild
      const guildId = message.guild.id;
      const fallbackInstance = bridgeInstanceManager.getInstanceByGuildId(guildId);
      if (fallbackInstance?.discordHandler?.handleDiscordMessage) {
        try {
          await fallbackInstance.discordHandler.handleDiscordMessage(message);
          return;
        } catch (fallbackError) {
          console.error(`Error in fallback handler for ${guildId}: ${fallbackError.message}`);
        }
      }
      
      console.error(`No working handler found for message in channel ${message.channel.name}`);
    }
  } catch (error) {
    console.error('Error handling message:', error);
  }
});

// Express routes
app.get('/', (req, res) => {
  res.send('WhatsApp-Discord Bridge is running');
});

// Health check endpoint
app.get('/health', (req, res) => {
  const instanceStatus = bridgeInstanceManager.getStatus();
  
  const health = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    instances: instanceStatus,
    discordStatus: discordClient.isReady() ? 'CONNECTED' : 'DISCONNECTED'
  };
  
  res.status(200).json(health);
});

// API endpoints for instances
app.get('/api/instances', (req, res) => {
  try {
    const instances = bridgeInstanceManager.getStatus();
    res.status(200).json({ instances });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the application
async function start() {
  console.log("Starting WhatsApp-Discord Bridge with full instance isolation...");

  // Validate environment variables
  if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN environment variable is missing');
    process.exit(1);
  }

  try {
    // Start Express server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Express server running on port ${port}`);
    });

    // Login to Discord
    console.log('Logging in to Discord...');
    await discordClient.login(process.env.DISCORD_TOKEN);

    // Add this new code to restore connections:
    console.log('Restoring WhatsApp connections...');
    const instances = bridgeInstanceManager.getStatus();
    for (const instance of instances) {
      try {
        const instanceObj = bridgeInstanceManager.getInstanceByGuildId(instance.guildId);
        if (instanceObj) {
          console.log(`Attempting to restore connection for ${instance.instanceId}...`);
          const connected = await instanceObj.ensureConnected();
          console.log(`Instance ${instance.instanceId} connection ${connected ? 'restored' : 'requires QR scan'}`);
        }
      } catch (restoreError) {
        console.error(`Error restoring connection for ${instance.instanceId}:`, restoreError);
      }
    }

    console.log('Bridge startup complete');
  } catch (error) {
    console.error('Failed to start bridge:', error);
    process.exit(1);
  }
}

// Global error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Log stack trace
  if (error.stack) {
    console.error(error.stack);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  if (reason && reason.stack) {
    console.error('Stack:', reason.stack);
  }
});

// Handle termination signals
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await gracefulShutdown();
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await gracefulShutdown();
});

// Graceful shutdown function
async function gracefulShutdown() {
  console.log('Starting graceful shutdown...');

  // Disconnect all WhatsApp instances
  try {
    await bridgeInstanceManager.disconnectAllInstances();
  } catch (error) {
    console.error('Error disconnecting WhatsApp instances:', error);
  }
  
  // Logout of Discord
  try {
    if (discordClient.isReady()) {
      await discordClient.destroy();
      console.log('Discord client destroyed');
    }
  } catch (error) {
    console.error('Error destroying Discord client:', error);
  }
  
  // Close log stream
  logStream.end();
  
  console.log('Graceful shutdown complete, exiting...');
  process.exit(0);
}

// Start the application
start();
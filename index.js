// index.js - Main entry point
const express = require('express');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(express.json());

// Create required directories
const directories = ['instances', 'setup_storage', 'logs', 'temp'];
directories.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Configure logging with timestamps
const startTime = new Date();
const logFileName = `log-${startTime.toISOString().replace(/:/g, '-')}.txt`;
const logFilePath = path.join(__dirname, 'logs', logFileName);
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

// Add setup storage functions to global scope for easy access
global.setupStorage = {
  saveSetupParams: function(guildId, params) {
    try {
      const filePath = path.join(__dirname, 'setup_storage', `${guildId}_setup.json`);
      
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
    const filePath = path.join(__dirname, 'setup_storage', `${guildId}_setup.json`);
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
    const filePath = path.join(__dirname, 'setup_storage', `${guildId}_setup.json`);
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

// Initialize global variable for custom settings
global.lastCustomSettings = null;

// Import core modules
const bridgeInstanceManager = require('./core/InstanceManager');

// Set up collections for commands, events, etc.
discordClient.commands = new Collection();
discordClient.buttons = new Collection();
discordClient.modals = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  
  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.name) {
      discordClient.commands.set(command.name, command);
    }
  }
  
  console.log(`Loaded ${discordClient.commands.size} commands`);
}

// Load button handlers
const buttonsPath = path.join(__dirname, 'buttons');
if (fs.existsSync(buttonsPath)) {
  const buttonFiles = fs.readdirSync(buttonsPath).filter(file => file.endsWith('.js'));
  
  for (const file of buttonFiles) {
    const button = require(path.join(buttonsPath, file));
    if (button.customId) {
      discordClient.buttons.set(button.customId, button);
    } else if (button.regex) {
      discordClient.buttons.set(button.regex.toString(), button);
    }
  }
  
  console.log(`Loaded ${discordClient.buttons.size} button handlers`);
}

// Load modal handlers
const modalsPath = path.join(__dirname, 'modals');
if (fs.existsSync(modalsPath)) {
  const modalFiles = fs.readdirSync(modalsPath).filter(file => file.endsWith('.js'));
  
  for (const file of modalFiles) {
    const modal = require(path.join(modalsPath, file));
    if (modal.customId) {
      discordClient.modals.set(modal.customId, modal);
    } else if (modal.regex) {
      discordClient.modals.set(modal.regex.toString(), modal);
    }
  }
  
  console.log(`Loaded ${discordClient.modals.size} modal handlers`);
}

// Load event handlers
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
  
  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.name) {
      if (event.once) {
        discordClient.once(event.name, (...args) => event.execute(...args, discordClient));
      } else {
        discordClient.on(event.name, (...args) => event.execute(...args, discordClient));
      }
    }
  }
  
  console.log(`Loaded ${eventFiles.length} event handlers`);
}

// Discord Event Listeners
discordClient.on('ready', async () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  
  // Register slash commands
  try {
    await registerCommands(discordClient);
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

// Register slash commands with Discord
async function registerCommands(client) {
  try {
    const commands = [];
    
    // Get all command exports
    discordClient.commands.forEach(command => {
      if (command.data) {
        commands.push(command.data.toJSON());
      }
    });
    
    console.log("Started refreshing application (/) commands.");
    await client.application.commands.set(commands);
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error registering slash commands:", error);
  }
}

// Handle incoming interactions
discordClient.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      // Handle commands
      const command = discordClient.commands.get(interaction.commandName);
      if (!command) return;
      
      // Get the appropriate instance
      const instance = getInstanceForInteraction(interaction);
      
      await command.execute(interaction, instance);
    } 
    else if (interaction.isButton()) {
      // Handle buttons
      let buttonHandler = null;
      
      // First check exact matches
      if (discordClient.buttons.has(interaction.customId)) {
        buttonHandler = discordClient.buttons.get(interaction.customId);
      } else {
        // Try regex matches for dynamic button IDs
        for (const [key, handler] of discordClient.buttons.entries()) {
          if (handler.matches && typeof handler.matches === 'function' && 
              handler.matches(interaction.customId)) {
            buttonHandler = handler;
            break;
          } else if (handler.regex && handler.regex.test(interaction.customId)) {
            buttonHandler = handler;
            break;
          }
        }
      }
      
      if (buttonHandler) {
        const instance = getInstanceForInteraction(interaction);
        await buttonHandler.execute(interaction, instance);
      }
    }
    else if (interaction.isModalSubmit()) {
      // Handle modal submissions
      let modalHandler = null;
      
      // First check exact matches
      if (discordClient.modals.has(interaction.customId)) {
        modalHandler = discordClient.modals.get(interaction.customId);
      } else {
        // Try regex matches for dynamic modal IDs
        for (const [key, handler] of discordClient.modals.entries()) {
          if (handler.matches && typeof handler.matches === 'function' && 
              handler.matches(interaction.customId)) {
            modalHandler = handler;
            break;
          } else if (handler.regex && handler.regex.test(interaction.customId)) {
            modalHandler = handler;
            break;
          }
        }
      }
      
      if (modalHandler) {
        const instance = getInstanceForInteraction(interaction);
        await modalHandler.execute(interaction, instance);
      }
    }
  } catch (error) {
    console.error(`Error handling interaction:`, error);
    
    // Try to respond with an error message
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: `There was an error with this interaction: ${error.message}`, 
          ephemeral: true 
        });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ 
          content: `There was an error with this interaction: ${error.message}`
        });
      } else {
        await interaction.followUp({ 
          content: `There was an error with this interaction: ${error.message}`, 
          ephemeral: true 
        });
      }
    } catch (replyError) {
      console.error("Error responding to interaction error:", replyError);
    }
  }
});

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

// Helper function to get the instance for an interaction
function getInstanceForInteraction(interaction) {
  if (!interaction.guildId) return null;
  
  // IMPORTANT: Skip instance check for customize_messages_modal
  // This needs to be processed even without an instance
  if (interaction.isModalSubmit() && interaction.customId === "customize_messages_modal") {
    console.log("Skipping instance check for customize_messages_modal");
    return { customSettings: {}, isTemporary: true };
  }
  
  try {
    // Check channel parent ID first for more specific matching
    if (interaction.channel && interaction.channel.parentId) {
      const categoryId = interaction.channel.parentId;
      
      // Check if Discord client has instance routes
      if (interaction.client._instanceRoutes && interaction.client._instanceRoutes.has(categoryId)) {
        const routeInfo = interaction.client._instanceRoutes.get(categoryId);
        return routeInfo.instance || bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
      }
    }
    
    // Fall back to guild ID matching
    return bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
  } catch (error) {
    console.error("Error getting instance for interaction:", error);
    return null;
  }
}

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
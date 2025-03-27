// index.js - Fixed for proper dependency loading
const express = require('express');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Initialize logger early for complete log capture
const Logger = require('./utils/logger');
Logger();

// Initialize Express app
const app = express();
app.use(express.json());

// Create required directories
const directories = ['instances', 'setup_storage', 'logs', 'temp'];
for (const dir of directories) {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Initialize Discord client
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

// Initialize setup storage
const SetupStorage = require('./utils/setupStorage');
SetupStorage();

// Initialize collections for components
discordClient.commands = new Collection();
discordClient.buttons = new Collection();
discordClient.modals = new Collection();
discordClient.selectMenus = new Collection();

// Register all handlers - defer loading to avoid circular dependencies
let handlers;

// Instance manager for WhatsApp connections
const InstanceManager = require('./core/InstanceManager');

// Express API routes
app.get('/', (req, res) => {
  res.send('WhatsApp-Discord Bridge is running');
});

// Health check endpoint
app.get('/health', (req, res) => {
  const instanceStatus = InstanceManager.getStatus();
  
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
    const instances = InstanceManager.getStatus();
    res.status(200).json({ instances });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register handlers when the client is ready
discordClient.once('ready', async () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  
  // Now that we're ready, we can safely register handlers
  const registerHandlers = require('./registerHandlers');
  handlers = registerHandlers(discordClient);
  
  // Register slash commands
  try {
    await registerCommands(discordClient);
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
  
  // Initialize all existing instances
  try {
    await InstanceManager.initializeInstances(discordClient);
  } catch (error) {
    console.error('Error initializing instances:', error);
  }
  
  console.log('WhatsApp-Discord Bridge is fully operational');
});

// Register slash commands with Discord
async function registerCommands(client) {
  try {
    const commands = [];
    
    // Load command files directly
    const commandsDir = path.join(__dirname, 'commands');
    if (fs.existsSync(commandsDir)) {
      const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
      
      for (const file of commandFiles) {
        try {
          const command = require(path.join(commandsDir, file));
          
          if (command && command.data) {
            commands.push(command.data.toJSON());
            console.log(`Loaded command for registration: ${command.data.name}`);
          }
        } catch (error) {
          console.error(`Error loading command file ${file}:`, error);
        }
      }
    }
    
    if (commands.length > 0) {
      console.log("Started refreshing application (/) commands.");
      await client.application.commands.set(commands);
      console.log(`Successfully registered ${commands.length} application (/) commands.`);
    } else {
      console.warn("No commands found to register");
    }
  } catch (error) {
    console.error("Error registering slash commands:", error);
  }
}

// Start the application
async function start() {
  console.log("Starting WhatsApp-Discord Bridge with modular architecture...");

  // Validate environment variables
  if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN environment variable is missing');
    process.exit(1);
  }

  try {
    // Start Express server
    const port = process.env.PORT || 3001;
    app.listen(port, () => {
      console.log(`Express server running on port ${port}`);
    });

    // Login to Discord
    console.log('Logging in to Discord...');
    await discordClient.login(process.env.DISCORD_TOKEN);

    console.log('Bridge startup complete');
  } catch (error) {
    console.error('Failed to start bridge:', error);
    process.exit(1);
  }
}

// Global error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
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
    await InstanceManager.disconnectAllInstances();
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
  
  console.log('Graceful shutdown complete, exiting...');
  process.exit(0);
}

// Start the application
start();
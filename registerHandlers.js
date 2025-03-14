// registerHandlers.js
// A simple script to register all the components with the Discord client

/**
 * Register all handlers with the Discord client
 * @param {Client} client - Discord.js client
 */
function registerHandlers(client) {
  // Import the handler classes
  const buttonLoader = require('./core/ButtonLoader');
  const modalLoader = require('./core/ModalLoader');
  const interactionHandler = require('./core/interactionHandler');
  
  // Set up the global interaction event handler
  client.on('interactionCreate', async (interaction) => {
    // Pass all interactions to our centralized handler
    await interactionHandler.handleInteraction(interaction);
  });
  
  console.log('All handlers registered with Discord client');
  
  return {
    buttonLoader,
    modalLoader,
    interactionHandler
  };
}

module.exports = registerHandlers;
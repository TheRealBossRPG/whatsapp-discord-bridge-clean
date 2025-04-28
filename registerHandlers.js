// registerHandlers.js - Improved with better error handling and logs
const fs = require('fs');
const path = require('path');

/**
 * Register all handlers with the Discord client
 * @param {Client} client - Discord.js client
 * @returns {Object} - Registered handlers
 */
function registerHandlers(client) {
  console.log('==== REGISTERING ALL HANDLERS ====');
  
  // Initialize collections for components if not already done
  client.commands = client.commands || new Map();
  client.buttons = client.buttons || new Map();
  client.modals = client.modals || new Map();
  client.selectMenus = client.selectMenus || new Map();
  
  // Create result object to track registered handlers
  const handlers = {
    commands: [],
    buttons: [],
    modals: [],
    selectMenus: [],
    events: {
      discord: [],
      whatsapp: []
    }
  };
  
  try {
    // Register Commands
    console.log('Loading command handlers...');
    const commandsDir = path.join(__dirname, 'commands');
    
    if (fs.existsSync(commandsDir)) {
      const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
      
      for (const file of commandFiles) {
        try {
          const commandPath = path.join(commandsDir, file);
          const command = require(commandPath);
          
          if (command && command.name) {
            client.commands.set(command.name, command);
            handlers.commands.push(command.name);
            console.log(`Registered command: ${command.name}`);
          } else {
            console.warn(`Invalid command in file: ${file}`);
          }
        } catch (commandError) {
          console.error(`Error loading command ${file}:`, commandError);
        }
      }
    }
    console.log(`Registered ${handlers.commands.length} commands`);
    
    // Register Buttons - including subdirectories
    console.log('Loading button handlers...');
    const buttonsDir = path.join(__dirname, 'buttons');
    
    if (fs.existsSync(buttonsDir)) {
      // First load buttons in main directory
      const mainButtonFiles = fs.readdirSync(buttonsDir, { withFileTypes: true });
      
      for (const item of mainButtonFiles) {
        if (item.isFile() && item.name.endsWith('.js')) {
          try {
            const buttonPath = path.join(buttonsDir, item.name);
            const button = require(buttonPath);
            
            if (button && (button.customId || (button.regex || typeof button.matches === 'function'))) {
              // For direct customId buttons
              if (button.customId) {
                client.buttons.set(button.customId, button);
                handlers.buttons.push(button.customId);
                console.log(`Registered direct button handler: ${button.customId}`);
              }
              // For regex-based buttons
              else if (button.regex || typeof button.matches === 'function') {
                // Generate a special regex key
                const regexKey = `regex:${item.name}`;
                client.buttons.set(regexKey, button);
                handlers.buttons.push(regexKey);
                console.log(`Registered regex button handler from: ${item.name}`);
              }
            } else {
              console.warn(`Invalid button handler in file: ${item.name}`);
            }
          } catch (buttonError) {
            console.error(`Error loading button handler ${item.name}:`, buttonError);
          }
        } else if (item.isDirectory()) {
          // Process subdirectory
          try {
            const subdirPath = path.join(buttonsDir, item.name);
            const subdirFiles = fs.readdirSync(subdirPath).filter(file => file.endsWith('.js'));
            
            for (const file of subdirFiles) {
              try {
                const buttonPath = path.join(subdirPath, file);
                const button = require(buttonPath);
                
                if (button) {
                  // For direct customId buttons
                  if (button.customId) {
                    client.buttons.set(button.customId, button);
                    handlers.buttons.push(`${item.name}/${file}:${button.customId}`);
                    console.log(`Registered subdirectory button: ${item.name}/${file} with ID ${button.customId}`);
                  }
                  // For regex-based buttons
                  else if (button.regex || typeof button.matches === 'function') {
                    // Generate a special regex key
                    const regexKey = `regex:${item.name}/${file}`;
                    client.buttons.set(regexKey, button);
                    handlers.buttons.push(regexKey);
                    console.log(`Registered regex button from subdirectory: ${item.name}/${file}`);
                  } else {
                    console.warn(`Invalid button handler in subdirectory file: ${item.name}/${file}`);
                  }
                }
              } catch (subdirButtonError) {
                console.error(`Error loading button from subdirectory ${item.name}/${file}:`, subdirButtonError);
              }
            }
          } catch (subdirError) {
            console.error(`Error processing button subdirectory ${item.name}:`, subdirError);
          }
        }
      }
    }
    console.log(`Registered ${handlers.buttons.length} button handlers`);
    
    // Register Modals - including subdirectories
    console.log('Loading modal handlers...');
    const modalsDir = path.join(__dirname, 'modals');
    
    if (fs.existsSync(modalsDir)) {
      const processModalDirectory = (directory, subdirPath = '') => {
        const items = fs.readdirSync(directory, { withFileTypes: true });
        
        for (const item of items) {
          const itemPath = path.join(directory, item.name);
          const relativePath = subdirPath ? `${subdirPath}/${item.name}` : item.name;
          
          if (item.isFile() && item.name.endsWith('.js')) {
            try {
              const modal = require(itemPath);
              
              if (modal) {
                // For direct customId modals
                if (modal.customId) {
                  client.modals.set(modal.customId, modal);
                  handlers.modals.push(modal.customId);
                  console.log(`Registered modal handler: ${relativePath} with ID ${modal.customId}`);
                } 
                // For regex-based modals
                else if (modal.regex || typeof modal.matches === 'function') {
                  const regexKey = `regex:${relativePath}`;
                  client.modals.set(regexKey, modal);
                  handlers.modals.push(regexKey);
                  console.log(`Registered regex modal handler: ${relativePath}`);
                } else {
                  console.warn(`Invalid modal handler in file: ${relativePath}`);
                }
              }
            } catch (modalError) {
              console.error(`Error loading modal handler ${relativePath}:`, modalError);
            }
          } else if (item.isDirectory()) {
            // Process subdirectory recursively
            processModalDirectory(itemPath, relativePath);
          }
        }
      };
      
      // Start processing from the modals root directory
      processModalDirectory(modalsDir);
    }
    console.log(`Registered ${handlers.modals.length} modal handlers`);
    
    // Register Select Menus
    console.log('Loading select menu handlers...');
    const selectMenusDir = path.join(__dirname, 'selectMenus');
    
    if (fs.existsSync(selectMenusDir)) {
      const selectMenuFiles = fs.readdirSync(selectMenusDir)
        .filter(file => file.endsWith('.js'));
      
      for (const file of selectMenuFiles) {
        try {
          const selectMenuPath = path.join(selectMenusDir, file);
          const selectMenu = require(selectMenuPath);
          
          if (selectMenu) {
            // For direct customId select menus
            if (selectMenu.customId) {
              client.selectMenus.set(selectMenu.customId, selectMenu);
              handlers.selectMenus.push(selectMenu.customId);
              console.log(`Registered select menu handler: ${file} with ID ${selectMenu.customId}`);
            } 
            // For regex-based select menus
            else if (selectMenu.regex || typeof selectMenu.matches === 'function') {
              const regexKey = `regex:${file}`;
              client.selectMenus.set(regexKey, selectMenu);
              handlers.selectMenus.push(regexKey);
              console.log(`Registered regex select menu handler: ${file}`);
            } else {
              console.warn(`Invalid select menu handler in file: ${file}`);
            }
          }
        } catch (selectMenuError) {
          console.error(`Error loading select menu handler ${file}:`, selectMenuError);
        }
      }
    }
    console.log(`Registered ${handlers.selectMenus.length} select menu handlers`);
    
    // Register Discord Events
    console.log('Loading Discord event handlers...');
    const discordEventsDir = path.join(__dirname, 'events', 'discord');
    
    if (fs.existsSync(discordEventsDir)) {
      const discordEventFiles = fs.readdirSync(discordEventsDir)
        .filter(file => file.endsWith('.js'));
      
      for (const file of discordEventFiles) {
        try {
          const eventPath = path.join(discordEventsDir, file);
          const event = require(eventPath);
          
          if (event && event.event) {
            if (event.once) {
              client.once(event.event, (...args) => event.execute(...args));
            } else {
              client.on(event.event, (...args) => event.execute(...args));
            }
            handlers.events.discord.push(event.event);
            console.log(`Registered Discord event handler: ${event.event} (${file})`);
          } else {
            console.warn(`Invalid Discord event handler in file: ${file}`);
          }
        } catch (eventError) {
          console.error(`Error loading Discord event handler ${file}:`, eventError);
        }
      }
    }
    console.log(`Registered ${handlers.events.discord.length} Discord event handlers`);
    
    // Look for and display ticket-related buttons - diagnostic information
    try {
      console.log('==== TICKET BUTTON DIAGNOSTICS ====');
      
      // Check for close ticket button
      for (const [key, handler] of client.buttons.entries()) {
        if (
          key === 'close' || 
          key === 'close-ticket' || 
          (typeof key === 'string' && key.includes('close-ticket')) ||
          (handler.customId === 'close' || handler.customId === 'close-ticket') || 
          (handler.regex && String(handler.regex).includes('close'))
        ) {
          console.log(`Found ticket close button: ${key}`);
          console.log(`- Custom ID: ${handler.customId || 'N/A'}`);
          console.log(`- Has regex: ${!!handler.regex} ${handler.regex ? `(${handler.regex})` : ''}`);
          console.log(`- Has matches function: ${typeof handler.matches === 'function'}`);
        }
        
        if (
          key === 'edit-user' || 
          (typeof key === 'string' && key.includes('edit-user')) ||
          (handler.customId === 'edit-user') || 
          (handler.regex && String(handler.regex).includes('edit-user'))
        ) {
          console.log(`Found edit user button: ${key}`);
          console.log(`- Custom ID: ${handler.customId || 'N/A'}`);
          console.log(`- Has regex: ${!!handler.regex} ${handler.regex ? `(${handler.regex})` : ''}`);
          console.log(`- Has matches function: ${typeof handler.matches === 'function'}`);
        }
      }
      
      // Check for edit ticket modal
      for (const [key, handler] of client.modals.entries()) {
        if (
          (typeof key === 'string' && key.includes('edit_ticket_modal')) ||
          (handler.customId && handler.customId.includes('edit_ticket_modal')) || 
          (handler.regex && String(handler.regex).includes('edit_ticket_modal'))
        ) {
          console.log(`Found edit ticket modal: ${key}`);
          console.log(`- Custom ID: ${handler.customId || 'N/A'}`);
          console.log(`- Has regex: ${!!handler.regex} ${handler.regex ? `(${handler.regex})` : ''}`);
          console.log(`- Has matches function: ${typeof handler.matches === 'function'}`);
        }
      }
      
      console.log('==== END TICKET BUTTON DIAGNOSTICS ====');
    } catch (diagnosticError) {
      console.error('Error running ticket button diagnostics:', diagnosticError);
    }
    
    console.log('==== ALL HANDLERS REGISTERED SUCCESSFULLY ====');
    
    return handlers;
  } catch (error) {
    console.error('Error registering handlers:', error);
    throw error;
  }
}

module.exports = registerHandlers;
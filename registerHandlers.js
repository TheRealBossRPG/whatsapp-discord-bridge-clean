// registerHandlers.js - Comprehensive module for registering all handlers
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
      const mainButtonFiles = fs.readdirSync(buttonsDir)
        .filter(file => file.endsWith('.js'));
      
      for (const file of mainButtonFiles) {
        try {
          const buttonPath = path.join(buttonsDir, file);
          const button = require(buttonPath);
          
          if (button && (button.customId || (button.regex && button.matches))) {
            // For regex-based buttons, use a special key format
            const key = button.customId || `regex:${file}`;
            client.buttons.set(key, button);
            handlers.buttons.push(key);
            console.log(`Registered button handler: ${key}`);
          } else {
            console.warn(`Invalid button handler in file: ${file}`);
          }
        } catch (buttonError) {
          console.error(`Error loading button handler ${file}:`, buttonError);
        }
      }
      
      // Then check subdirectories
      const subdirs = fs.readdirSync(buttonsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      console.log(`Found ${subdirs.length} subdirectories in buttons folder`);
      
      for (const subdir of subdirs) {
        const subdirPath = path.join(buttonsDir, subdir);
        
        if (fs.existsSync(subdirPath)) {
          const subdirFiles = fs.readdirSync(subdirPath)
            .filter(file => file.endsWith('.js'));
          
          for (const file of subdirFiles) {
            try {
              const buttonPath = path.join(subdirPath, file);
              const button = require(buttonPath);
              
              if (button && (button.customId || (button.regex && button.matches))) {
                // For subdirectory buttons, include the subdirectory in the key
                const key = button.customId || `regex:${subdir}/${file}`;
                client.buttons.set(key, button);
                handlers.buttons.push(`${subdir}/${file}`);
                console.log(`Registered button handler from subdirectory: ${subdir}/${file}`);
              } else {
                console.warn(`Invalid button handler in subdirectory file: ${subdir}/${file}`);
              }
            } catch (subdirButtonError) {
              console.error(`Error loading button handler from subdirectory ${subdir}/${file}:`, subdirButtonError);
            }
          }
        }
      }
    }
    console.log(`Registered ${handlers.buttons.length} button handlers`);
    
    // Register Modals - including subdirectories
    console.log('Loading modal handlers...');
    const modalsDir = path.join(__dirname, 'modals');
    
    if (fs.existsSync(modalsDir)) {
      // First load modals in main directory
      const mainModalFiles = fs.readdirSync(modalsDir)
        .filter(file => file.endsWith('.js'));
      
      for (const file of mainModalFiles) {
        try {
          const modalPath = path.join(modalsDir, file);
          const modal = require(modalPath);
          
          if (modal && (modal.customId || (modal.regex && modal.matches))) {
            const key = modal.customId || `regex:${file}`;
            client.modals.set(key, modal);
            handlers.modals.push(key);
            console.log(`Registered modal handler: ${key}`);
          } else {
            console.warn(`Invalid modal handler in file: ${file}`);
          }
        } catch (modalError) {
          console.error(`Error loading modal handler ${file}:`, modalError);
        }
      }
      
      // Then check subdirectories
      const subdirs = fs.readdirSync(modalsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const subdir of subdirs) {
        const subdirPath = path.join(modalsDir, subdir);
        
        if (fs.existsSync(subdirPath)) {
          const subdirFiles = fs.readdirSync(subdirPath)
            .filter(file => file.endsWith('.js'));
          
          for (const file of subdirFiles) {
            try {
              const modalPath = path.join(subdirPath, file);
              const modal = require(modalPath);
              
              if (modal && (modal.customId || (modal.regex && modal.matches))) {
                const key = modal.customId || `regex:${subdir}/${file}`;
                client.modals.set(key, modal);
                handlers.modals.push(`${subdir}/${file}`);
                console.log(`Registered modal handler from subdirectory: ${subdir}/${file}`);
              } else {
                console.warn(`Invalid modal handler in subdirectory file: ${subdir}/${file}`);
              }
            } catch (subdirModalError) {
              console.error(`Error loading modal handler from subdirectory ${subdir}/${file}:`, subdirModalError);
            }
          }
        }
      }
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
          
          if (selectMenu && (selectMenu.customId || (selectMenu.regex && selectMenu.matches))) {
            const key = selectMenu.customId || `regex:${file}`;
            client.selectMenus.set(key, selectMenu);
            handlers.selectMenus.push(key);
            console.log(`Registered select menu handler: ${key}`);
          } else {
            console.warn(`Invalid select menu handler in file: ${file}`);
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
    
    // Check the close ticket button
    try {
      const closeButtonPath = path.join(__dirname, 'buttons', 'closeTicket.js');
      if (fs.existsSync(closeButtonPath)) {
        const closeButton = require(closeButtonPath);
        console.log(`Close ticket button in main directory: ${!!closeButton}`);
        if (closeButton) {
          console.log(`- Custom ID: ${closeButton.customId}`);
          console.log(`- Has regex: ${!!closeButton.regex}`);
        }
      }
      
      // Also check in ticket subdirectory
      const ticketButtonPath = path.join(__dirname, 'buttons', 'ticket', 'closeTicket.js');
      if (fs.existsSync(ticketButtonPath)) {
        const ticketCloseButton = require(ticketButtonPath);
        console.log(`Close ticket button in ticket subdirectory: ${!!ticketCloseButton}`);
        if (ticketCloseButton) {
          console.log(`- Custom ID: ${ticketCloseButton.customId}`);
          console.log(`- Has regex: ${!!ticketCloseButton.regex}`);
        }
      }
    } catch (error) {
      console.error('Error checking close ticket buttons:', error);
    }
    
    console.log('==== ALL HANDLERS REGISTERED SUCCESSFULLY ====');
    
    return handlers;
  } catch (error) {
    console.error('Error registering handlers:', error);
    throw error;
  }
}

module.exports = registerHandlers;
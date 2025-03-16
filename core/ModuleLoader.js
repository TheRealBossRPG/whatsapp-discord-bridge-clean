// core/ModuleLoader.js - Updated for nested folder structure
const fs = require('fs');
const path = require('path');

class ModuleLoader {
  constructor() {
    this.commands = new Map();
    this.buttons = new Map();
    this.modals = new Map();
    this.selectMenus = new Map();
    this.eventHandlers = new Map();
  }
  
  /**
   * Load all modules
   */
  loadAll() {
    this.loadCommands();
    this.loadButtons();
    this.loadModals();
    this.loadSelectMenus();
    this.loadEventHandlers();
    
    console.log(`Loaded ${this.commands.size} commands, ${this.buttons.size} buttons, ${this.modals.size} modals, ${this.selectMenus.size} select menus, and ${this.eventHandlers.size} event handlers`);
  }
  
  /**
   * Load command modules from the commands directory
   */
  loadCommands() {
    const commandsDir = path.join(__dirname, '..', 'commands');
    if (!fs.existsSync(commandsDir)) {
      console.warn('Commands directory not found');
      return;
    }
    
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
      try {
        const command = require(path.join(commandsDir, file));
        if (command.data && command.execute) {
          this.commands.set(command.data.name, command);
          console.log(`Loaded command: ${command.data.name}`);
        } else {
          console.warn(`Command ${file} is missing required properties`);
        }
      } catch (error) {
        console.error(`Error loading command ${file}:`, error);
      }
    }
  }
  
  /**
   * Recursively load modules from a directory and its subdirectories
   * @param {string} baseDir - Base directory
   * @param {string} subDir - Current subdirectory (relative to baseDir)
   * @param {Map} targetMap - Map to store loaded modules
   * @param {Function} validator - Validation function for modules
   */
  loadModulesRecursively(baseDir, subDir = '', targetMap, validator) {
    const currentDir = path.join(baseDir, subDir);
    
    if (!fs.existsSync(currentDir)) {
      console.warn(`Directory not found: ${currentDir}`);
      return;
    }
    
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const relativePath = path.join(subDir, entry.name);
      const fullPath = path.join(baseDir, relativePath);
      
      if (entry.isDirectory()) {
        // Recurse into subdirectory
        this.loadModulesRecursively(baseDir, relativePath, targetMap, validator);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        try {
          const module = require(fullPath);
          
          // Use validator function to check module
          if (validator(module)) {
            // Use full relative path as key for better organization
            const moduleKey = relativePath.replace(/\.js$/, '');
            targetMap.set(moduleKey, module);
            console.log(`Loaded module: ${moduleKey}`);
          } else {
            console.warn(`Module ${relativePath} is missing required properties`);
          }
        } catch (error) {
          console.error(`Error loading module ${relativePath}:`, error);
        }
      }
    }
  }
  
  /**
   * Load button handlers from the buttons directory and subdirectories
   */
  loadButtons() {
    const buttonsDir = path.join(__dirname, '..', 'buttons');
    this.loadModulesRecursively(
      buttonsDir, 
      '', 
      this.buttons,
      (module) => module.customId || module.regex || typeof module.matches === 'function'
    );
  }
  
  /**
   * Load modal handlers from the modals directory and subdirectories
   */
  loadModals() {
    const modalsDir = path.join(__dirname, '..', 'modals');
    this.loadModulesRecursively(
      modalsDir,
      '',
      this.modals,
      (module) => module.customId || module.regex || typeof module.matches === 'function'
    );
  }
  
  /**
   * Load select menu handlers from the selectMenus directory and subdirectories
   */
  loadSelectMenus() {
    const selectMenusDir = path.join(__dirname, '..', 'selectMenus');
    this.loadModulesRecursively(
      selectMenusDir,
      '',
      this.selectMenus,
      (module) => module.customId || module.regex || typeof module.matches === 'function'
    );
  }
  
  /**
   * Load event handlers from the events directory
   */
  loadEventHandlers() {
    const eventsDir = path.join(__dirname, '..', 'events');
    this.loadModulesRecursively(
      eventsDir,
      '',
      this.eventHandlers,
      (module) => module.event && typeof module.execute === 'function'
    );
  }
  
  /**
   * Find the handler for an interaction
   * @param {Object} interaction - Discord interaction
   * @returns {Object} - Handler for the interaction
   */
  findHandler(interaction) {
    if (interaction.isCommand()) {
      return this.commands.get(interaction.commandName);
    }
    
    if (interaction.isButton()) {
      // Find button handler by customId or regex
      for (const [_, handler] of this.buttons) {
        if (
          handler.customId === interaction.customId ||
          (handler.regex && handler.regex.test(interaction.customId)) ||
          (typeof handler.matches === 'function' && handler.matches(interaction.customId))
        ) {
          return handler;
        }
      }
    }
    
    if (interaction.isModalSubmit()) {
      // Find modal handler by customId or regex
      for (const [_, handler] of this.modals) {
        if (
          handler.customId === interaction.customId ||
          (handler.regex && handler.regex.test(interaction.customId)) ||
          (typeof handler.matches === 'function' && handler.matches(interaction.customId))
        ) {
          return handler;
        }
      }
    }
    
    if (interaction.isStringSelectMenu()) {
      // Find select menu handler by customId or regex
      for (const [_, handler] of this.selectMenus) {
        if (
          handler.customId === interaction.customId ||
          (handler.regex && handler.regex.test(interaction.customId)) ||
          (typeof handler.matches === 'function' && handler.matches(interaction.customId))
        ) {
          return handler;
        }
      }
    }
    
    return null;
  }
}

module.exports = new ModuleLoader();
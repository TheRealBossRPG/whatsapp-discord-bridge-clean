// core/ModuleLoader.js - Fixed for proper directory loading and StringSelectMenu
const fs = require('fs');
const path = require('path');

/**
 * ModuleLoader class for loading and managing all modules
 */
class ModuleLoader {
  constructor() {
    this.commands = new Map();
    this.buttons = new Map();
    this.modals = new Map();
    this.selectMenus = new Map();
    this.eventHandlers = new Map();
    this.controllers = new Map();
    this.managers = new Map();
    this.handlers = new Map();
    this.utils = new Map();
  }
  
  /**
   * Load all modules
   */
  loadAll() {
    this.loadCommands();
    this.loadButtons();
    this.loadModals();
    this.loadSelectMenus();
    this.loadUtils();
    
    // Don't load event handlers or controllers here to avoid circular dependencies
    // These are loaded by EventLoader and EventController directly
    
    console.log(
      `Loaded ${this.commands.size} commands, ${this.buttons.size} buttons, ` +
      `${this.modals.size} modals, ${this.selectMenus.size} select menus, ` +
      `${this.eventHandlers.size} event handlers, ${this.controllers.size} controllers, ` +
      `${this.utils.size} utilities`
    );
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
          }
        } catch (error) {
          console.error(`Error loading module ${relativePath}:`, error);
        }
      }
    }
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
          const name = file.replace('.js', '');
          this.commands.set(name, command);
          console.log(`Loaded command module: ${name}`);
        }
      } catch (error) {
        console.error(`Error loading command module ${file}:`, error);
      }
    }
  }
  
  /**
   * Load button handlers from the buttons directory and subdirectories
   */
  loadButtons() {
    const buttonsDir = path.join(__dirname, '..', 'buttons');
    if (!fs.existsSync(buttonsDir)) {
      console.warn('Buttons directory not found');
      return;
    }
    
    this.loadModulesRecursively(
      buttonsDir, 
      '', 
      this.buttons,
      (module) => module && (module.customId || module.regex || typeof module.matches === 'function')
    );
  }
  
  /**
   * Load modal handlers from the modals directory and subdirectories
   */
  loadModals() {
    const modalsDir = path.join(__dirname, '..', 'modals');
    if (!fs.existsSync(modalsDir)) {
      console.warn('Modals directory not found');
      return;
    }
    
    this.loadModulesRecursively(
      modalsDir,
      '',
      this.modals,
      (module) => module && (module.customId || module.regex || typeof module.matches === 'function')
    );
  }
  
  /**
   * Load select menu handlers from the selectMenus directory and subdirectories
   */
  loadSelectMenus() {
    const selectMenusDir = path.join(__dirname, '..', 'selectMenus');
    if (!fs.existsSync(selectMenusDir)) {
      console.warn('SelectMenus directory not found');
      return;
    }
    
    const selectMenuFiles = fs.readdirSync(selectMenusDir).filter(file => file.endsWith('.js'));
    
    for (const file of selectMenuFiles) {
      try {
        const selectMenu = require(path.join(selectMenusDir, file));
        const name = file.replace('.js', '');
        if (selectMenu && (selectMenu.customId || selectMenu.regex || typeof selectMenu.matches === 'function')) {
          this.selectMenus.set(name, selectMenu);
          console.log(`Loaded select menu module: ${name}`);
        }
      } catch (error) {
        console.error(`Error loading select menu module ${file}:`, error);
      }
    }
  }
  
  /**
   * Load utility modules
   */
  loadUtils() {
    const utilsDir = path.join(__dirname, '..', 'utils');
    if (!fs.existsSync(utilsDir)) {
      console.warn('Utils directory not found');
      return;
    }
    
    const utilFiles = fs.readdirSync(utilsDir).filter(file => file.endsWith('.js'));
    
    for (const file of utilFiles) {
      try {
        const util = require(path.join(utilsDir, file));
        const name = file.replace('.js', '');
        this.utils.set(name, util);
        console.log(`Loaded utility module: ${name}`);
      } catch (error) {
        console.error(`Error loading utility module ${file}:`, error);
      }
    }
  }
  
  /**
   * Find the handler for an interaction
   * @param {Object} interaction - Discord interaction
   * @returns {Object} - Handler for the interaction
   */
  findHandler(interaction) {
    if (interaction.isCommand()) {
      // Find by command name
      const command = [...this.commands.values()].find(cmd => cmd.data?.name === interaction.commandName);
      if (command) return command;
    }
    
    if (interaction.isButton()) {
      // Find button handler by customId or regex
      for (const handler of this.buttons.values()) {
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
      for (const handler of this.modals.values()) {
        if (
          handler.customId === interaction.customId ||
          (handler.regex && handler.regex.test(interaction.customId)) ||
          (typeof handler.matches === 'function' && handler.matches(interaction.customId))
        ) {
          return handler;
        }
      }
    }
    
    // Fixed for StringSelectMenu deprecation
    if (interaction.isStringSelectMenu()) {
      // Find select menu handler by customId or regex
      for (const handler of this.selectMenus.values()) {
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
  
  /**
   * Get a command by name
   * @param {string} name - Command name
   * @returns {Object} Command module
   */
  getCommand(name) {
    return this.commands.get(name);
  }
  
  /**
   * Get a utility by name
   * @param {string} name - Utility name
   * @returns {Object} Utility module
   */
  getUtil(name) {
    return this.utils.get(name);
  }
}

module.exports = new ModuleLoader();
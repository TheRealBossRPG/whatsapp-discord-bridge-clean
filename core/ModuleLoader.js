const fs = require('fs');
const path = require('path');

class ModuleLoader {
  /**
   * Load all modules from a directory
   * @param {string} dir - Directory to load modules from
   * @returns {Object} - Object with module names as keys and module exports as values
   */
  static loadModulesFromDir(dir) {
    const modules = {};
    
    if (!fs.existsSync(dir)) {
      console.warn(`Directory does not exist: ${dir}`);
      return modules;
    }
    
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      if (file.endsWith('.js')) {
        const moduleName = path.basename(file, '.js');
        const modulePath = path.join(dir, file);
        
        try {
          modules[moduleName] = require(modulePath);
        } catch (error) {
          console.error(`Error loading module ${modulePath}: ${error.message}`);
        }
      }
    }
    
    return modules;
  }
  
  /**
   * Load commands from directory and register them
   * @param {Object} client - Discord client
   */
  static loadCommands(client) {
    const commandsDir = path.join(__dirname, '..', 'commands');
    const commands = [];
    
    if (!fs.existsSync(commandsDir)) {
      console.warn(`Commands directory does not exist: ${commandsDir}`);
      return;
    }
    
    const files = fs.readdirSync(commandsDir);
    
    for (const file of files) {
      if (file.endsWith('.js')) {
        try {
          const command = require(path.join(commandsDir, file));
          if (command.data && command.execute) {
            commands.push(command.data);
            client.commands.set(command.data.name, command);
          }
        } catch (error) {
          console.error(`Error loading command ${file}: ${error.message}`);
        }
      }
    }
    
    // Register commands with Discord
    if (client.application) {
      client.application.commands.set(commands)
        .then(() => console.log(`Registered ${commands.length} slash commands`))
        .catch(error => console.error('Error registering commands:', error));
    }
  }
  
  /**
   * Load button handlers from directory
   */
  static loadButtons() {
    const buttonsDir = path.join(__dirname, '..', 'buttons');
    const buttons = [];
    
    if (!fs.existsSync(buttonsDir)) {
      console.warn(`Buttons directory does not exist: ${buttonsDir}`);
      return buttons;
    }
    
    const files = fs.readdirSync(buttonsDir);
    
    for (const file of files) {
      if (file.endsWith('.js')) {
        try {
          const button = require(path.join(buttonsDir, file));
          if (button.customId && button.execute) {
            buttons.push(button);
          }
        } catch (error) {
          console.error(`Error loading button ${file}: ${error.message}`);
        }
      }
    }
    
    return buttons;
  }
  
  /**
   * Load modal handlers from directory
   */
  static loadModals() {
    const modalsDir = path.join(__dirname, '..', 'modals');
    const modals = [];
    
    if (!fs.existsSync(modalsDir)) {
      console.warn(`Modals directory does not exist: ${modalsDir}`);
      return modals;
    }
    
    const files = fs.readdirSync(modalsDir);
    
    for (const file of files) {
      if (file.endsWith('.js')) {
        try {
          const modal = require(path.join(modalsDir, file));
          if (modal.customId && modal.execute) {
            modals.push(modal);
          }
        } catch (error) {
          console.error(`Error loading modal ${file}: ${error.message}`);
        }
      }
    }
    
    return modals;
  }
}

module.exports = ModuleLoader;
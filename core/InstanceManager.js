// core/InstanceManager.js
const Instance = require('./Instance');
const fs = require('fs');
const path = require('path');

class InstanceManager {
  constructor() {
    this.instances = new Map();
    this.configPath = path.join(__dirname, '..', 'instance_configs.json');
    
    // Create instances directory if it doesn't exist
    this.instancesDir = path.join(__dirname, '..', 'instances');
    if (!fs.existsSync(this.instancesDir)) {
      fs.mkdirSync(this.instancesDir, { recursive: true });
    }
    
    this.loadConfigurations();
  }
  
  loadConfigurations() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configs = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.configs = configs;
        console.log(`Loaded ${Object.keys(configs).length} instance configurations`);
      } else {
        this.configs = {};
        fs.writeFileSync(this.configPath, '{}', 'utf8');
        console.log('Created empty instance configurations file');
      }
    } catch (error) {
      console.error('Error loading instance configurations:', error);
      this.configs = {};
    }
  }
  
  saveConfigurations() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.configs, null, 2), 'utf8');
      console.log(`Saved ${Object.keys(this.configs).length} instance configurations`);
    } catch (error) {
      console.error('Error saving instance configurations:', error);
    }
  }
  
  getInstanceByGuildId(guildId) {
    // First check directly if an instance exists with this ID
    let instance = this.instances.get(guildId);
    if (instance) {
      return instance;
    }
    
    // If not found directly, search through all instances
    for (const [instanceId, inst] of this.instances.entries()) {
      if (inst.guildId === guildId) {
        return inst;
      }
    }
    
    // Not found
    return null;
  }
  
  async createInstance(options) {
    try {
      const { guildId, categoryId, discordClient, transcriptChannelId, vouchChannelId, customSettings } = options;
      
      // Use guild ID as instance ID
      const instanceId = guildId;
      
      // Create a new instance
      const instance = new Instance({
        instanceId,
        guildId,
        categoryId,
        discordClient,
        transcriptChannelId,
        vouchChannelId,
        customSettings
      });
      
      // Initialize the instance
      await instance.initialize();
      
      // Add to instances map
      this.instances.set(instanceId, instance);
      
      // Store configuration
      this.configs[instanceId] = {
        guildId,
        categoryId,
        transcriptChannelId,
        vouchChannelId,
        customSettings
      };
      
      this.saveConfigurations();
      
      return instance;
    } catch (error) {
      console.error(`Error creating instance: ${error.message}`);
      throw error;
    }
  }
  
  async initializeInstances(discordClient) {
    for (const [instanceId, config] of Object.entries(this.configs)) {
      try {
        // Add discord client to config
        config.discordClient = discordClient;
        
        // Create or get instance
        let instance = this.instances.get(instanceId);
        if (!instance) {
          instance = new Instance({
            instanceId,
            ...config
          });
          
          // Initialize the instance
          await instance.initialize();
          
          // Add to instances map
          this.instances.set(instanceId, instance);
        }
        
        // Connect WhatsApp
        await instance.connect();
      } catch (error) {
        console.error(`Error initializing instance ${instanceId}: ${error.message}`);
      }
    }
  }
  
  async disconnectAllInstances() {
    const promises = [];
    for (const [instanceId, instance] of this.instances.entries()) {
      promises.push(instance.disconnect());
    }
    
    await Promise.all(promises);
    this.instances.clear();
  }
}

module.exports = new InstanceManager();
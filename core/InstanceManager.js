// core/InstanceManager.js - Modified to use QRCodeUtils
const Instance = require('./Instance');
const fs = require('fs');
const path = require('path');
const QRCodeUtils = require('../utils/qrCodeUtils');

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
      // Convert configs to serializable format (no BigInts or circular references)
      // CRITICAL: Don't store customSettings, only minimal identification info
      const serializable = {};
      
      for (const [instanceId, config] of Object.entries(this.configs)) {
        // Create a clean copy with ONLY identification info
        serializable[instanceId] = {
          guildId: config.guildId,
          categoryId: String(config.categoryId), // Convert BigInt to string
          transcriptChannelId: config.transcriptChannelId ? String(config.transcriptChannelId) : null,
          vouchChannelId: config.vouchChannelId ? String(config.vouchChannelId) : null,
          // Deliberately NOT including customSettings
        };
      }
      
      fs.writeFileSync(this.configPath, JSON.stringify(serializable, null, 2), 'utf8');
      console.log(`Saved ${Object.keys(serializable).length} instance configurations (minimal info only)`);
    } catch (error) {
      console.error('Error saving instance configurations:', error);
    }
  }
  
  getInstanceByGuildId(guildId) {
    if (!guildId) {
      console.error('getInstanceByGuildId called with undefined guildId');
      return null;
    }
    
    // First check directly if an instance exists with this ID
    let instance = this.instances.get(guildId);
    if (instance) {
      return instance;
    }
    
    // If not found directly, search through all instances
    for (const [instanceId, inst] of this.instances.entries()) {
      if (inst.guildId === guildId) {
        console.log(`Found instance ${instanceId} for guild ${guildId}`);
        return inst;
      }
    }
    
    console.log(`No instance found for guild ${guildId}`);
    
    // Last resort: try to load instance configuration and create temporary instance
    try {
      if (this.configs) {
        // Try to find config entry for this guild
        const configEntry = Object.entries(this.configs).find(([_, config]) => config.guildId === guildId);
        
        if (configEntry) {
          const [configId, config] = configEntry;
          console.log(`Found config for guild ${guildId}, creating temporary instance`);
          
          // Check if there's a settings file
          const settingsPath = path.join(this.instancesDir, configId, 'settings.json');
          let settings = {};
          
          if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            console.log(`Loaded settings from ${settingsPath}`);
          }
          
          // Return a simple settings object for access to customSettings
          return {
            instanceId: configId,
            guildId: guildId,
            customSettings: settings,
            isTemporary: true
          };
        }
      }
    } catch (error) {
      console.error(`Error creating temporary instance for ${guildId}:`, error);
    }
    
    return null;
  }
  
  async createInstance(options) {
    try {
      // Use guild ID as instance ID for simplicity
      const instanceId = options.guildId;
      
      console.log(`Creating instance ${instanceId} for guild ${options.guildId}...`);
      
      // Create instance-specific directories
      const instanceDir = path.join(this.instancesDir, instanceId);
      if (!fs.existsSync(instanceDir)) {
        fs.mkdirSync(instanceDir, { recursive: true });
      }
      
      // Create a new Instance
      const instance = new Instance({
        instanceId: instanceId,
        guildId: options.guildId,
        categoryId: options.categoryId,
        transcriptChannelId: options.transcriptChannelId,
        vouchChannelId: options.vouchChannelId,
        discordClient: options.discordClient,
        customSettings: options.customSettings || {}
      });
      
      // Initialize the instance
      await instance.initialize();
      
      // Add the instance to our map
      this.instances.set(instanceId, instance);
      
      // Store the minimal configuration for future reference
      this.configs[instanceId] = {
        guildId: options.guildId,
        categoryId: options.categoryId,
        transcriptChannelId: options.transcriptChannelId || null,
        vouchChannelId: options.vouchChannelId || null,
        // Intentionally NOT including customSettings
      };
      
      // Save minimal configurations for future lookup
      this.saveConfigurations();
      
      // If customSettings provided, save them to instance-specific file
      if (options.customSettings && Object.keys(options.customSettings).length > 0) {
        const settingsPath = path.join(instanceDir, 'settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify(options.customSettings, null, 2), 'utf8');
        console.log(`Saved custom settings to instance-specific file at ${settingsPath}`);
      }
      
      console.log(`Instance ${instanceId} created successfully`);
      return instance;
    } catch (error) {
      console.error(`Error creating instance for guild ${options.guildId}:`, error);
      throw error;
    }
  }
  
  async initializeInstances(discordClient) {
    try {
      if (!discordClient) {
        console.error('Discord client is required to initialize instances');
        return;
      }
      
      console.log(`Initializing ${Object.keys(this.configs).length} instances...`);
      
      for (const [instanceId, config] of Object.entries(this.configs)) {
        try {
          console.log(`Initializing instance ${instanceId} for guild ${config.guildId}...`);
          
          // Get or create instance
          let instance = this.instances.get(instanceId);
          
          if (!instance) {
            // Create a new instance with this configuration
            const initialConfig = {
              ...config,
              discordClient
            };
            
            instance = new Instance({
              instanceId,
              guildId: config.guildId,
              categoryId: config.categoryId,
              transcriptChannelId: config.transcriptChannelId,
              vouchChannelId: config.vouchChannelId,
              discordClient,
              customSettings: config.customSettings || {}
            });
            
            // Initialize the instance
            await instance.initialize();
            
            // Add to instances map
            this.instances.set(instanceId, instance);
          }
          
          // Connect WhatsApp for this instance only if previously connected
          // Pass false to not show QR code during startup
          const shouldShowQrCode = false; // Don't show QR codes on startup
          await instance.connect(shouldShowQrCode);
          
          console.log(`Initialized instance ${instanceId}`);
        } catch (error) {
          console.error(`Error initializing instance ${instanceId}:`, error);
        }
      }
      
      console.log(`Finished initializing ${this.instances.size} instances`);
    } catch (error) {
      console.error("Error initializing instances:", error);
    }
  }

  async saveInstanceSettings(instanceId, settings) {
    try {
      console.log(`[InstanceManager] Saving settings for instance ${instanceId}`);
      
      // Get the instance directory path
      const instanceDir = path.join(this.instancesDir, instanceId);
      if (!fs.existsSync(instanceDir)) {
        fs.mkdirSync(instanceDir, { recursive: true });
      }
      
      // Get the settings file path
      const settingsPath = path.join(instanceDir, 'settings.json');
      
      // Load existing settings first
      let existingSettings = {};
      if (fs.existsSync(settingsPath)) {
        try {
          existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (e) {
          console.error(`Error reading existing settings:`, e);
        }
      }
      
      // Merge with new settings
      const mergedSettings = {
        ...existingSettings,
        ...settings
      };
      
      // Write to instance-specific settings file
      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
      console.log(`Saved settings to instance-specific file at ${settingsPath}`);
      
      // Try to find the instance object to update in-memory settings
      let instance = this.instances.get(instanceId);
      
      // If not found directly, try searching by guild ID
      if (!instance) {
        for (const [id, inst] of this.instances.entries()) {
          if (inst.guildId === instanceId) {
            instance = inst;
            instanceId = id;
            break;
          }
        }
      }
      
      // Update instance settings if found
      if (instance) {
        // Update customSettings directly on the instance
        instance.customSettings = {
          ...instance.customSettings,
          ...settings
        };
        
        console.log(`Updated settings in memory for instance ${instanceId}`);
      }
      
      // IMPORTANT: Only store minimal identification info in configs
      // Remove all custom messages and detailed settings
      if (this.configs && this.configs[instanceId]) {
        // Only save non-custom settings to the global config
        // Do NOT save any customSettings or message templates
        
        // Only update essential connection fields like channel IDs
        if (settings.transcriptChannelId !== undefined) {
          this.configs[instanceId].transcriptChannelId = settings.transcriptChannelId;
        }
        if (settings.vouchChannelId !== undefined) {
          this.configs[instanceId].vouchChannelId = settings.vouchChannelId;
        }
        
        // Save minimal global configs
        this.saveConfigurations();
      }
      
      return true;
    } catch (error) {
      console.error(`Error saving instance settings for ${instanceId}:`, error);
      return false;
    }
  }
  
  
  // MODIFIED: Now uses QRCodeUtils
  async generateQRCode(options) {
    // Simply pass through to the centralized QRCodeUtils method
    return await QRCodeUtils.generateQRCode(options);
  }
    
  async disconnectInstance(guildId, fullCleanup = false) {
    try {
      console.log(`Disconnecting instance for guild ${guildId}...`);
      
      const instance = this.getInstanceByGuildId(guildId);
      if (!instance) {
        console.log(`No instance found for guild ${guildId}`);
        return false;
      }
      
      // Get the instance ID
      const instanceId = instance.instanceId;
      
      // Backup settings before disconnect
      let storedSettings = null;
      if (!fullCleanup && instance.customSettings) {
        storedSettings = { ...instance.customSettings };
        console.log(`Preserved custom settings for guild ${guildId} before disconnecting`);
      }
      
      // Disconnect instance
      await instance.disconnect();
      
      if (fullCleanup) {
        // Remove from instances map
        this.instances.delete(instanceId);
        
        // Remove from configs
        delete this.configs[instanceId];
        this.saveConfigurations();
        
        console.log(`Instance for guild ${guildId} disconnected and removed`);
      } else {
        // Delete auth files but keep the instance
        try {
          // Clean auth files using QRCodeUtils
          await QRCodeUtils.cleanAuthFiles(instance);
          
          // Restore settings
          if (storedSettings) {
            this.configs[instanceId].customSettings = storedSettings;
            if (instance.customSettings) {
              instance.customSettings = storedSettings;
            }
            this.saveConfigurations();
            console.log(`Restored custom settings for guild ${guildId}`);
          }
        } catch (cleanupError) {
          console.error(`Error cleaning up auth files: ${cleanupError.message}`);
        }
      }
      
      return true;
    } catch (error) {
      console.error(`Error disconnecting instance for guild ${guildId}:`, error);
      return false;
    }
  }
    
  async disconnectAllInstances() {
    try {
      console.log(`Disconnecting all ${this.instances.size} instances...`);
      
      const disconnectPromises = [];
      for (const [instanceId, instance] of this.instances.entries()) {
        disconnectPromises.push(
          instance.disconnect()
            .catch(error => {
              console.error(`Error disconnecting instance ${instanceId}:`, error);
            })
        );
      }
      
      await Promise.all(disconnectPromises);
      
      // Clear instances
      this.instances.clear();
      
      console.log('All instances disconnected');
      return true;
    } catch (error) {
      console.error('Error disconnecting all instances:', error);
      return false;
    }
  }
  
  getStatus() {
    const status = [];
    
    for (const [instanceId, instance] of this.instances.entries()) {
      const instanceStatus = instance.getStatus();
      status.push(instanceStatus);
    }
    
    return status;
  }
}

module.exports = new InstanceManager();
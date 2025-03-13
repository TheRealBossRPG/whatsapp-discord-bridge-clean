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
      // Convert configs to serializable format (no BigInts or circular references)
      const serializable = {};
      
      for (const [instanceId, config] of Object.entries(this.configs)) {
        // Create a clean copy without non-serializable parts
        serializable[instanceId] = {
          guildId: config.guildId,
          categoryId: String(config.categoryId), // Convert BigInt to string
          transcriptChannelId: config.transcriptChannelId ? String(config.transcriptChannelId) : null,
          vouchChannelId: config.vouchChannelId ? String(config.vouchChannelId) : null,
          customSettings: config.customSettings || {}
        };
      }
      
      fs.writeFileSync(this.configPath, JSON.stringify(serializable, null, 2), 'utf8');
      console.log(`Saved ${Object.keys(serializable).length} instance configurations`);
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
      
      // Store the configuration (but without the Discord client reference)
      this.configs[instanceId] = {
        guildId: options.guildId,
        categoryId: options.categoryId,
        transcriptChannelId: options.transcriptChannelId || null,
        vouchChannelId: options.vouchChannelId || null,
        customSettings: options.customSettings || {}
      };
      
      this.saveConfigurations();
      
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
          
          // Connect WhatsApp for this instance
          await instance.connect();
          
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
      console.log(`Saving settings for instance ${instanceId}`);
      
      // Try both ways to find the instance - by instanceId and by guildId
      let instance = this.instances.get(instanceId);
      
      // If not found directly, try finding by guildId
      if (!instance) {
        // Search through all instances to find one with matching guildId
        for (const [id, inst] of this.instances) {
          if (inst.guildId === instanceId) {
            instance = inst;
            break;
          }
        }
      }
      
      if (!instance) {
        console.error(`Instance ${instanceId} not found in any form. Creating direct file.`);
        
        // No instance found, but we can still save the settings to disk
        const instanceDir = path.join(this.instancesDir, instanceId);
        if (!fs.existsSync(instanceDir)) {
          fs.mkdirSync(instanceDir, { recursive: true });
        }
        
        const settingsPath = path.join(instanceDir, 'settings.json');
        
        // Read existing settings first if available
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
        
        fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
        
        console.log(`Direct settings file created at ${settingsPath}`);
        
        // Also try to store in configs
        if (this.configs) {
          if (this.configs[instanceId]) {
            // CRITICAL FIX: Update both customSettings AND direct channel properties
            this.configs[instanceId].customSettings = {
              ...this.configs[instanceId].customSettings,
              ...settings
            };
            
            // If settings contains channel IDs, update them directly too
            if (settings.transcriptChannelId) {
              this.configs[instanceId].transcriptChannelId = settings.transcriptChannelId;
            }
            if (settings.vouchChannelId) {
              this.configs[instanceId].vouchChannelId = settings.vouchChannelId;
            }
            
            this.saveConfigurations();
          }
        }
        
        return true;
      }
      
      // Use instance's saveSettings method if available
      if (typeof instance.saveSettings === 'function') {
        return await instance.saveSettings(settings);
      } else {
        // Direct save for temporary instances
        // Update instance settings
        instance.customSettings = {
          ...instance.customSettings,
          ...settings
        };
        
        // CRITICAL FIX: Also update direct channel properties if present in settings
        if (settings.transcriptChannelId) {
          instance.transcriptChannelId = settings.transcriptChannelId;
        }
        if (settings.vouchChannelId) {
          instance.vouchChannelId = settings.vouchChannelId;
        }
        
        // Save to configs
        if (this.configs && this.configs[instanceId]) {
          // Update customSettings
          this.configs[instanceId].customSettings = instance.customSettings;
          
          // CRITICAL FIX: Also update direct channel properties
          if (settings.transcriptChannelId) {
            this.configs[instanceId].transcriptChannelId = settings.transcriptChannelId;
          }
          if (settings.vouchChannelId) {
            this.configs[instanceId].vouchChannelId = settings.vouchChannelId;
          }
          
          this.saveConfigurations();
        }
        
        // Direct file save
        const instanceDir = path.join(this.instancesDir, instance.instanceId || instanceId);
        const settingsPath = path.join(instanceDir, 'settings.json');
        
        if (!fs.existsSync(instanceDir)) {
          fs.mkdirSync(instanceDir, { recursive: true });
        }
        
        // Read existing settings first if available
        let existingSettings = {};
        if (fs.existsSync(settingsPath)) {
          try {
            existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          } catch (e) {
            console.error(`Error reading existing settings:`, e);
          }
        }
        
        // Merge with new settings and write
        const mergedSettings = {
          ...existingSettings,
          ...settings
        };
        
        fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
        
        return true;
      }
    } catch (error) {
      console.error(`Error saving instance settings for ${instanceId}:`, error);
      
      // Last resort emergency save
      try {
        const instanceDir = path.join(this.instancesDir, instanceId);
        if (!fs.existsSync(instanceDir)) {
          fs.mkdirSync(instanceDir, { recursive: true });
        }
        
        const settingsPath = path.join(instanceDir, 'settings.json');
        
        // Read existing settings first if available
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
        
        fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
        console.log(`Emergency direct save to ${settingsPath}`);
        
        return true;
      } catch (emergencyError) {
        console.error(`Even emergency save failed:`, emergencyError);
        return false;
      }
    }
  }
  
  async generateQRCode(options) {
    const { guildId, categoryId, transcriptChannelId, vouchChannelId, customSettings, discordClient } = options;
    
    try {
      // Validate required parameters
      if (!guildId) throw new Error('Guild ID is required');
      if (!categoryId) throw new Error('Category ID is required');
      if (!discordClient) throw new Error('Discord client is required');
      
      console.log(`Generating QR code for guild ${guildId}...`);
      
      // Check if we already have an instance for this guild
      let instance = this.getInstanceByGuildId(guildId);
      
      // If already authenticated and connected, return null to indicate no QR code needed
      if (instance && instance.isConnected && instance.isConnected()) {
        console.log(`WhatsApp already connected for guild ${guildId}`);
        return null;
      }
      
      // Create config for this guild
      const config = {
        guildId,
        categoryId,
        transcriptChannelId,  // Can be null
        vouchChannelId,       // Can be null
        customSettings,       // Can be null/undefined
        discordClient
      };
      
      // Create new instance or disconnect existing one
      if (!instance || instance.isTemporary) {
        console.log(`Creating new instance for guild ${guildId}`);
        instance = await this.createInstance(config);
      } else {
        console.log(`Disconnect existing instance for guild ${guildId} to generate fresh QR code`);
        await instance.disconnect();
      }
      
      // Set up promise to catch QR code
      return new Promise((resolve, reject) => {
        // Set timeout for QR code generation
        const timeout = setTimeout(() => {
          console.log(`QR code generation timed out for guild ${guildId}`);
          resolve("TIMEOUT");
        }, 60000);
        
        // Set callback for QR code
        instance.onQRCode((qrCode) => {
          console.log(`Got QR code for guild ${guildId} (${qrCode.length} chars)`);
          clearTimeout(timeout);
          resolve(qrCode);
        });
        
        // Set callback for ready event
        instance.onReady(() => {
          console.log(`WhatsApp connected for guild ${guildId}`);
          clearTimeout(timeout);
          resolve(null); // Already authenticated
        });
        
        // Connect WhatsApp
        instance.connect()
          .then(success => {
            if (!success) {
              console.error(`Failed to connect WhatsApp for guild ${guildId}`);
              clearTimeout(timeout);
              reject(new Error('Failed to connect WhatsApp'));
            }
          })
          .catch(error => {
            console.error(`Error connecting WhatsApp: ${error.message}`);
            clearTimeout(timeout);
            reject(error);
          });
      });
    } catch (error) {
      console.error(`Error generating QR code for guild ${guildId}:`, error);
      throw error;
    }
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
          // Clean baileys_auth directory
          const authDir = path.join(__dirname, '..', 'instances', instanceId, 'baileys_auth');
          if (fs.existsSync(authDir)) {
            const files = fs.readdirSync(authDir);
            for (const file of files) {
              fs.unlinkSync(path.join(authDir, file));
            }
            console.log(`Deleted baileys_auth files for instance ${instanceId}`);
          }
          
          // Clean auth directory
          const authDir2 = path.join(__dirname, '..', 'instances', instanceId, 'auth');
          if (fs.existsSync(authDir2)) {
            const files = fs.readdirSync(authDir2);
            for (const file of files) {
              fs.unlinkSync(path.join(authDir2, file));
            }
            console.log(`Deleted auth files for instance ${instanceId}`);
          }
          
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
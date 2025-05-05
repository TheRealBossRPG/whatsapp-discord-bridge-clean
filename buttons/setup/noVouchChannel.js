// buttons/setup/noVouchChannel.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../templates/Button');
const fs = require('fs');
const path = require('path');

class NoVouchChannelButton extends Button {
  constructor() {
    super({
      customId: 'no_vouch_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[NoVouchChannel] Processing button click`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[NoVouchChannel] Error deferring update:`, err);
        });
      }
      
      // Get setup info directly from storage file
      const guildId = interaction.guild.id;
      let setupParams = {};
      
      // Load existing setup params directly from file
      try {
        const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
        if (fs.existsSync(setupStoragePath)) {
          const setupData = fs.readFileSync(setupStoragePath, 'utf8');
          setupParams = JSON.parse(setupData);
          console.log(`[NoVouchChannel] Loaded setup params directly from file`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          const params = global.setupStorage.getSetupParams(guildId);
          if (params) setupParams = params;
          console.log(`[NoVouchChannel] Loaded setup params from global.setupStorage`);
        }
      } catch (loadError) {
        console.error(`[NoVouchChannel] Error loading setup params:`, loadError);
      }
      
      // Set vouchChannelId to null to disable vouches
      setupParams.vouchChannelId = null;
      
      // Save setup params back to file directly
      try {
        const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
        const storageDir = path.dirname(setupStoragePath);
        
        // Ensure directory exists
        if (!fs.existsSync(storageDir)) {
          fs.mkdirSync(storageDir, { recursive: true });
        }
        
        // Write updated setup params
        fs.writeFileSync(setupStoragePath, JSON.stringify(setupParams, null, 2), 'utf8');
        console.log(`[NoVouchChannel] Saved setup params directly to file`);
      } catch (saveError) {
        console.error(`[NoVouchChannel] Error saving setup params directly:`, saveError);
        
        // Try fallback to global storage
        if (global.setupStorage && typeof global.setupStorage.saveSetupParams === 'function') {
          global.setupStorage.saveSetupParams(guildId, setupParams);
          console.log(`[NoVouchChannel] Saved setup params using global.setupStorage`);
        }
      }

      // IMPORTANT: Update global configuration immediately
      try {
        // Update existing instance if available
        if (instance) {
          // Update instance properties directly
          instance.vouchChannelId = null;
          instance.customSettings = instance.customSettings || {};
          instance.customSettings.vouchChannelId = null;
          instance.customSettings.vouchEnabled = false;
          
          // Update handlers if they exist
          if (instance.handlers && instance.handlers.vouchHandler) {
            instance.handlers.vouchHandler.isDisabled = true;
            instance.handlers.vouchHandler.vouchChannelId = null;
          }
          
          // Also update via managers if available
          if (instance.managers && instance.managers.vouchHandler) {
            instance.managers.vouchHandler.isDisabled = true;
            instance.managers.vouchHandler.vouchChannelId = null;
          }
          
          // Save to instance settings file directly
          try {
            const instanceDir = path.join(__dirname, '..', '..', 'instances', instance.instanceId || guildId);
            if (!fs.existsSync(instanceDir)) {
              fs.mkdirSync(instanceDir, { recursive: true });
            }
            
            const settingsPath = path.join(instanceDir, 'settings.json');
            let settings = {};
            
            // Read existing settings if available
            if (fs.existsSync(settingsPath)) {
              settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            }
            
            // Update settings
            settings.vouchChannelId = null;
            settings.vouchEnabled = false;
            
            // Write updated settings
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            console.log(`[NoVouchChannel] Updated instance settings file directly`);
          } catch (instanceError) {
            console.error(`[NoVouchChannel] Error updating instance settings file:`, instanceError);
          }
        }
        
        // Try updating instance_configs.json as well
        const configPath = path.join(__dirname, '..', '..', 'instance_configs.json');
        if (fs.existsSync(configPath)) {
          let configs = {};
          
          try {
            configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          } catch (readError) {
            console.error(`[NoVouchChannel] Error reading instance_configs.json:`, readError);
          }
          
          // Find the config for this guild
          const instanceId = instance?.instanceId || guildId;
          
          if (configs[instanceId]) {
            configs[instanceId].vouchChannelId = null;
            // Write updated configs
            fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
            console.log(`[NoVouchChannel] Updated instance_configs.json`);
          }
        }
      } catch (configError) {
        console.error(`[NoVouchChannel] Error updating global configuration:`, configError);
      }
      
      // Create customize options buttons
      const customizeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("customize_messages")
          .setLabel("Customize Messages")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("continue_default")
          .setLabel("Continue with Defaults")
          .setStyle(ButtonStyle.Secondary)
      );
      
      // Build status text
      let statusText = "";
      
      if (setupParams.categoryId) {
        statusText += `Category: <#${setupParams.categoryId}>\n`;
      }
      
      if (setupParams.transcriptChannelId) {
        statusText += `Transcript channel: <#${setupParams.transcriptChannelId}>\n`;
      } else {
        statusText += `Transcript channel: None (disabled)\n`;
      }
      
      statusText += `Vouch channel: None (disabled)\n`;
      
      await interaction.editReply({
        content: `${statusText}\nWould you like to customize the messages users will see?\n\nYou can include \`{name}\` in messages to insert the user's name automatically and \`{phoneNumber}\` for their phone number.`,
        components: [customizeRow],
      });
    } catch (error) {
      console.error("[NoVouchChannel] Error handling no vouch channel option:", error);
      
      try {
        await interaction.editReply({
          content: "Error: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[NoVouchChannel] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new NoVouchChannelButton();
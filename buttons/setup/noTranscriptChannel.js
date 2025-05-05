// buttons/setup/noTranscriptChannel.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../templates/Button');
const fs = require('fs');
const path = require('path');

class NoTranscriptChannelButton extends Button {
  constructor() {
    super({
      customId: 'no_transcript_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[NoTranscriptChannel] Processing button click`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[NoTranscriptChannel] Error deferring update:`, err);
        });
      }
      
      // Get setup info
      const guildId = interaction.guild.id;
      let setupParams = {};
      
      // Load existing setup params directly from file
      try {
        const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
        if (fs.existsSync(setupStoragePath)) {
          const setupData = fs.readFileSync(setupStoragePath, 'utf8');
          setupParams = JSON.parse(setupData);
          console.log(`[NoTranscriptChannel] Loaded setup params directly from file`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          const params = global.setupStorage.getSetupParams(guildId);
          if (params) setupParams = params;
          console.log(`[NoTranscriptChannel] Loaded setup params from global.setupStorage`);
        }
      } catch (loadError) {
        console.error(`[NoTranscriptChannel] Error loading setup params:`, loadError);
      }
      
      // Update the setup params with no transcript channel
      setupParams.transcriptChannelId = null;
      
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
        console.log(`[NoTranscriptChannel] Saved setup params directly to file`);
      } catch (saveError) {
        console.error(`[NoTranscriptChannel] Error saving setup params directly:`, saveError);
        
        // Try fallback to global storage
        if (global.setupStorage && typeof global.setupStorage.saveSetupParams === 'function') {
          global.setupStorage.saveSetupParams(guildId, setupParams);
          console.log(`[NoTranscriptChannel] Saved setup params using global.setupStorage`);
        }
      }
      
      // IMPORTANT: Update global configuration immediately
      try {
        // Update existing instance if available
        if (instance) {
          // Update instance properties directly
          instance.transcriptChannelId = null;
          instance.customSettings = instance.customSettings || {};
          instance.customSettings.transcriptChannelId = null;
          instance.customSettings.transcriptsEnabled = false;
          
          // Update transcript manager if available
          if (instance.transcriptManager) {
            instance.transcriptManager.transcriptChannelId = null;
            instance.transcriptManager.isDisabled = true;
          } else if (instance.managers && instance.managers.transcriptManager) {
            instance.managers.transcriptManager.transcriptChannelId = null;
            instance.managers.transcriptManager.isDisabled = true;
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
            settings.transcriptChannelId = null;
            settings.transcriptsEnabled = false;
            
            // Write updated settings
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            console.log(`[NoTranscriptChannel] Updated instance settings file directly`);
          } catch (instanceError) {
            console.error(`[NoTranscriptChannel] Error updating instance settings file:`, instanceError);
          }
        }
        
        // Try updating instance_configs.json as well
        const configPath = path.join(__dirname, '..', '..', 'instance_configs.json');
        if (fs.existsSync(configPath)) {
          let configs = {};
          
          try {
            configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          } catch (readError) {
            console.error(`[NoTranscriptChannel] Error reading instance_configs.json:`, readError);
          }
          
          // Find the config for this guild
          const instanceId = instance?.instanceId || guildId;
          
          if (configs[instanceId]) {
            configs[instanceId].transcriptChannelId = null;
            // Write updated configs
            fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
            console.log(`[NoTranscriptChannel] Updated instance_configs.json`);
          }
        }
      } catch (configError) {
        console.error(`[NoTranscriptChannel] Error updating global configuration:`, configError);
      }
      
      // CHANGED: Ask if they want a vouch channel
      const vouchOptionsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("use_vouch_channel")
          .setLabel("Yes, Enable Vouches")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("no_vouch_channel")
          .setLabel("No Vouches")
          .setStyle(ButtonStyle.Secondary)
      );
      
      // Update directly without using the tracker
      await interaction.editReply({
        content: `Category: <#${setupParams.categoryId}>\nNo transcript channel selected\n\nDo you want to enable the vouching system?`,
        components: [vouchOptionsRow],
      });
    } catch (error) {
      console.error("Error handling no transcript channel option:", error);
      
      try {
        await interaction.editReply({
          content: "Error: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("Error sending error response:", replyError);
        try {
          await interaction.followUp({
            content: "Error: " + error.message,
            ephemeral: true
          });
        } catch (finalError) {
          console.error("Final error attempt failed:", finalError);
        }
      }
    }
  }
}

module.exports = new NoTranscriptChannelButton();
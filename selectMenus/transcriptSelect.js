// Updated selectMenus/transcriptSelect.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');
const InteractionTracker = require('../utils/InteractionTracker');

class TranscriptSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'transcript_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      // Get the selected option
      const selectedValue = interaction.values[0];
      
      // Get instance manager for saving settings
      let instanceManager;
      try {
        instanceManager = require('../core/InstanceManager');
      } catch (err) {
        console.error(`[TranscriptSelect] Error loading InstanceManager:`, err);
      }
      
      // Update setup params
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId) || {};
      
      // Handle the "no_transcripts" special value
      if (selectedValue === "no_transcripts") {
        // Disable transcripts
        setupParams.transcriptChannelId = null;
        
        if (instance) {
          // Update instance settings
          try {
            // 1. Update the instance property directly
            instance.transcriptChannelId = null;
            
            // 2. Update the instance's transcriptManager if it exists
            if (instance.transcriptManager) {
              instance.transcriptManager.transcriptChannelId = null;
              instance.transcriptManager.isDisabled = true;
              console.log(`[TranscriptSelect] Updated transcriptManager directly`);
            } else if (instance.managers && instance.managers.transcriptManager) {
              instance.managers.transcriptManager.transcriptChannelId = null;
              instance.managers.transcriptManager.isDisabled = true;
              console.log(`[TranscriptSelect] Updated managers.transcriptManager`);
            }
            
            // 3. Update custom settings
            if (!instance.customSettings) instance.customSettings = {};
            instance.customSettings.transcriptChannelId = null;
            instance.customSettings.transcriptsEnabled = false;
            
            // 4. Save via different methods based on availability
            let saved = false;
            
            // Try instance.saveSettings first
            if (typeof instance.saveSettings === 'function') {
              await instance.saveSettings({ 
                transcriptChannelId: null,
                transcriptsEnabled: false
              });
              saved = true;
              console.log(`[TranscriptSelect] Saved settings via instance.saveSettings`);
            }
            
            // Try instance manager if available and first attempt failed
            if (!saved && instanceManager) {
              await instanceManager.saveInstanceSettings(
                instance.instanceId,
                { 
                  transcriptChannelId: null,
                  transcriptsEnabled: false
                }
              );
              saved = true;
              console.log(`[TranscriptSelect] Saved settings via instanceManager`);
            }
            
            // Try directly saving if all else fails
            if (!saved) {
              // Direct save to file using fs and path
              const fs = require('fs');
              const path = require('path');
              const settingsPath = path.join(__dirname, '..', 'instances', instance.instanceId, 'settings.json');
              
              // Read existing settings
              let settings = {};
              if (fs.existsSync(settingsPath)) {
                try {
                  const data = fs.readFileSync(settingsPath, 'utf8');
                  settings = JSON.parse(data);
                } catch (err) {
                  console.error(`[TranscriptSelect] Error reading settings:`, err);
                }
              }
              
              // Update settings
              settings.transcriptChannelId = null;
              settings.transcriptsEnabled = false;
              
              // Ensure directory exists
              const dir = path.dirname(settingsPath);
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              
              // Write settings
              fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
              console.log(`[TranscriptSelect] Directly saved settings to file`);
            }
            
            console.log(`[TranscriptSelect] Disabled transcripts for instance ${instance.instanceId}`);
          } catch (saveError) {
            console.error(`[TranscriptSelect] Error saving settings:`, saveError);
          }
        }
        
        global.setupStorage.saveSetupParams(guildId, setupParams);
        console.log(`[TranscriptSelect] Disabled transcripts for guild ${guildId}`);
      } else {
        // Regular channel selection
        const transcriptChannelId = selectedValue;
        setupParams.transcriptChannelId = transcriptChannelId;
        
        if (instance) {
          // Update instance settings
          try {
            // 1. Update the instance property directly
            instance.transcriptChannelId = transcriptChannelId;
            
            // 2. Update the instance's transcriptManager if it exists
            if (instance.transcriptManager) {
              instance.transcriptManager.transcriptChannelId = transcriptChannelId;
              instance.transcriptManager.isDisabled = false;
              console.log(`[TranscriptSelect] Updated transcriptManager directly`);
            } else if (instance.managers && instance.managers.transcriptManager) {
              instance.managers.transcriptManager.transcriptChannelId = transcriptChannelId;
              instance.managers.transcriptManager.isDisabled = false;
              console.log(`[TranscriptSelect] Updated managers.transcriptManager`);
            }
            
            // 3. Update custom settings
            if (!instance.customSettings) instance.customSettings = {};
            instance.customSettings.transcriptChannelId = transcriptChannelId;
            instance.customSettings.transcriptsEnabled = true;
            
            // 4. Save via different methods based on availability
            let saved = false;
            
            // Try instance.saveSettings first
            if (typeof instance.saveSettings === 'function') {
              await instance.saveSettings({ 
                transcriptChannelId: transcriptChannelId,
                transcriptsEnabled: true
              });
              saved = true;
              console.log(`[TranscriptSelect] Saved settings via instance.saveSettings`);
            }
            
            // Try instance manager if available and first attempt failed
            if (!saved && instanceManager) {
              await instanceManager.saveInstanceSettings(
                instance.instanceId,
                { 
                  transcriptChannelId: transcriptChannelId,
                  transcriptsEnabled: true
                }
              );
              saved = true;
              console.log(`[TranscriptSelect] Saved settings via instanceManager`);
            }
            
            // Try directly saving if all else fails
            if (!saved) {
              // Direct save to file using fs and path
              const fs = require('fs');
              const path = require('path');
              const settingsPath = path.join(__dirname, '..', 'instances', instance.instanceId, 'settings.json');
              
              // Read existing settings
              let settings = {};
              if (fs.existsSync(settingsPath)) {
                try {
                  const data = fs.readFileSync(settingsPath, 'utf8');
                  settings = JSON.parse(data);
                } catch (err) {
                  console.error(`[TranscriptSelect] Error reading settings:`, err);
                }
              }
              
              // Update settings
              settings.transcriptChannelId = transcriptChannelId;
              settings.transcriptsEnabled = true;
              
              // Ensure directory exists
              const dir = path.dirname(settingsPath);
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              
              // Write settings
              fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
              console.log(`[TranscriptSelect] Directly saved settings to file`);
            }
            
            console.log(`[TranscriptSelect] Set transcript channel to ${transcriptChannelId} for instance ${instance.instanceId}`);
          } catch (saveError) {
            console.error(`[TranscriptSelect] Error saving settings:`, saveError);
          }
        }
        
        global.setupStorage.saveSetupParams(guildId, setupParams);
        console.log(`[TranscriptSelect] Set transcript channel to ${transcriptChannelId} for guild ${guildId}`);
      }
      
      // If this was a regular channel, verify it exists
      if (selectedValue !== "no_transcripts") {
        const selectedChannel = interaction.guild.channels.cache.get(selectedValue);
        if (!selectedChannel) {
          await interaction.editReply({
            content: "❌ Selected channel not found. Please try again.",
            components: [],
          });
          return;
        }
      }
      
      // Update the message with success
      const channelText = selectedValue === "no_transcripts" ? 
        "Transcripts disabled" : 
        `Transcript channel: <#${selectedValue}>`;
      
      await interaction.editReply({
        content: `✅ Settings updated successfully!\n\n${channelText}`,
        components: [],
      });
      
      // Force update of instance configs
      if (instanceManager && instanceManager.configs && instance.instanceId) {
        if (!instanceManager.configs[instance.instanceId]) {
          instanceManager.configs[instance.instanceId] = {};
        }
        
        instanceManager.configs[instance.instanceId].transcriptChannelId = 
          selectedValue === "no_transcripts" ? null : selectedValue;
        
        instanceManager.saveConfigurations();
        console.log(`[TranscriptSelect] Updated instance configs`);
      }
    } catch (error) {
      console.error("Error in transcript channel selection:", error);
      
      await interaction.editReply({
        content: "Channel selection failed: " + error.message,
        components: [],
      });
    }
  }
}

module.exports = new TranscriptSelectMenu();
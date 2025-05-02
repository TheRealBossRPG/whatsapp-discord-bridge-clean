// Updated selectMenus/vouchSelect.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');
const InteractionTracker = require('../utils/InteractionTracker');

class VouchSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'vouch_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      // Get the selected option
      const selectedValue = interaction.values[0];
      
      // Update setup params
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId) || {};
      
      // Get instance manager for saving settings
      let instanceManager;
      try {
        instanceManager = require('../core/InstanceManager');
      } catch (err) {
        console.error(`[VouchSelect] Error loading InstanceManager:`, err);
      }
      
      // Handle special values
      let finalVouchChannelId = null;
      const disableVouches = selectedValue === "no_vouches";
      const useSameAsTranscript = selectedValue === "same_as_transcript";
      
      if (disableVouches) {
        // Disable vouches entirely
        setupParams.vouchChannelId = null;
        finalVouchChannelId = null;
      } 
      else if (useSameAsTranscript) {
        // Use same channel as transcript
        const transcriptChannelId = instance ? 
          instance.transcriptChannelId : 
          setupParams.transcriptChannelId;
        
        if (!transcriptChannelId) {
          await interaction.editReply({
            content: "❌ No transcript channel set. Please set a transcript channel first.",
            components: [],
          });
          return;
        }
        
        setupParams.vouchChannelId = transcriptChannelId;
        finalVouchChannelId = transcriptChannelId;
      }
      else {
        // Regular channel selection
        setupParams.vouchChannelId = selectedValue;
        finalVouchChannelId = selectedValue;
      }
      
      // Set enable/disable flag
      const enableVouches = !disableVouches;
      
      if (instance) {
        // Update instance settings
        try {
          // 1. Update instance properties directly
          instance.vouchChannelId = finalVouchChannelId;
          
          // 2. Update the vouchHandler if it exists
          if (instance.vouchHandler) {
            instance.vouchHandler.vouchChannelId = finalVouchChannelId;
            instance.vouchHandler.isDisabled = !enableVouches;
            console.log(`[VouchSelect] Updated vouchHandler directly`);
          } else if (instance.handlers && instance.handlers.vouchHandler) {
            instance.handlers.vouchHandler.vouchChannelId = finalVouchChannelId;
            instance.handlers.vouchHandler.isDisabled = !enableVouches;
            console.log(`[VouchSelect] Updated handlers.vouchHandler`);
          }
          
          // 3. Update custom settings
          if (!instance.customSettings) instance.customSettings = {};
          instance.customSettings.vouchChannelId = finalVouchChannelId;
          instance.customSettings.vouchEnabled = enableVouches;
          
          // 4. Save via different methods based on availability
          let saved = false;
          
          // Try instance.saveSettings first
          if (typeof instance.saveSettings === 'function') {
            await instance.saveSettings({ 
              vouchChannelId: finalVouchChannelId,
              vouchEnabled: enableVouches
            });
            saved = true;
            console.log(`[VouchSelect] Saved settings via instance.saveSettings`);
          }
          
          // Try instance manager if available and first attempt failed
          if (!saved && instanceManager) {
            await instanceManager.saveInstanceSettings(
              instance.instanceId,
              { 
                vouchChannelId: finalVouchChannelId,
                vouchEnabled: enableVouches
              }
            );
            saved = true;
            console.log(`[VouchSelect] Saved settings via instanceManager`);
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
                console.error(`[VouchSelect] Error reading settings:`, err);
              }
            }
            
            // Update settings
            settings.vouchChannelId = finalVouchChannelId;
            settings.vouchEnabled = enableVouches;
            
            // Ensure directory exists
            const dir = path.dirname(settingsPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            
            // Write settings
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            console.log(`[VouchSelect] Directly saved settings to file`);
          }
          
          const status = disableVouches ? 
            "disabled" : 
            (useSameAsTranscript ? "set to use transcript channel" : `set to ${finalVouchChannelId}`);
          
          console.log(`[VouchSelect] Vouches ${status} for instance ${instance.instanceId}`);
        } catch (saveError) {
          console.error(`[VouchSelect] Error saving settings:`, saveError);
        }
      }
      
      // Save to setup params
      global.setupStorage.saveSetupParams(guildId, setupParams);
      
      const status = disableVouches ? 
        "disabled" : 
        (useSameAsTranscript ? "set to use transcript channel" : `set to ${finalVouchChannelId}`);
      
      console.log(`[VouchSelect] Vouches ${status} for guild ${guildId}`);
      
      // Verify channel exists if it's a regular channel
      if (!disableVouches && !useSameAsTranscript) {
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
      let channelText;
      if (disableVouches) {
        channelText = "Vouches disabled";
      } else if (useSameAsTranscript) {
        const transcriptChannelId = instance ? 
          instance.transcriptChannelId : 
          setupParams.transcriptChannelId;
        channelText = `Using transcript channel for vouches (<#${transcriptChannelId}>)`;
      } else {
        channelText = `Vouch channel: <#${selectedValue}>`;
      }
      
      await interaction.editReply({
        content: `✅ Settings updated successfully!\n\n${channelText}`,
        components: [],
      });
      
      // Force update of instance configs
      if (instanceManager && instanceManager.configs && instance.instanceId) {
        if (!instanceManager.configs[instance.instanceId]) {
          instanceManager.configs[instance.instanceId] = {};
        }
        
        instanceManager.configs[instance.instanceId].vouchChannelId = finalVouchChannelId;
        
        instanceManager.saveConfigurations();
        console.log(`[VouchSelect] Updated instance configs`);
      }
    } catch (error) {
      console.error("Error in vouch channel selection:", error);
      
      await interaction.editReply({
        content: "Channel selection failed: " + error.message,
        components: [],
      });
    }
  }
}

module.exports = new VouchSelectMenu();
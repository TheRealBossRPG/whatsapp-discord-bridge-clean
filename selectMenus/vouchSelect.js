// Updated selectMenus/vouchSelect.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');
const fs = require('fs');
const path = require('path');

class VouchSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'vouch_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[VouchSelect] Processing selection`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[VouchSelect] Error deferring update:`, err);
        });
      }
      
      // Get the selected option
      const selectedValue = interaction.values[0];
      
      // Get setup info directly from storage file
      const guildId = interaction.guild.id;
      let setupParams = {};
      
      // Load existing setup params directly from file
      try {
        const setupStoragePath = path.join(__dirname, '..', 'setup_storage', `${guildId}_setup.json`);
        if (fs.existsSync(setupStoragePath)) {
          const setupData = fs.readFileSync(setupStoragePath, 'utf8');
          setupParams = JSON.parse(setupData);
          console.log(`[VouchSelect] Loaded setup params directly from file`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          const params = global.setupStorage.getSetupParams(guildId);
          if (params) setupParams = params;
          console.log(`[VouchSelect] Loaded setup params from global.setupStorage`);
        }
      } catch (loadError) {
        console.error(`[VouchSelect] Error loading setup params:`, loadError);
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
        const transcriptChannelId = setupParams.transcriptChannelId;
        
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
      
      // Save setup params back to file directly
      try {
        const setupStoragePath = path.join(__dirname, '..', 'setup_storage', `${guildId}_setup.json`);
        const storageDir = path.dirname(setupStoragePath);
        
        // Ensure directory exists
        if (!fs.existsSync(storageDir)) {
          fs.mkdirSync(storageDir, { recursive: true });
        }
        
        // Write updated setup params
        fs.writeFileSync(setupStoragePath, JSON.stringify(setupParams, null, 2), 'utf8');
        console.log(`[VouchSelect] Saved setup params directly to file`);
      } catch (saveError) {
        console.error(`[VouchSelect] Error saving setup params directly:`, saveError);
        
        // Try fallback to global storage
        if (global.setupStorage && typeof global.setupStorage.saveSetupParams === 'function') {
          global.setupStorage.saveSetupParams(guildId, setupParams);
          console.log(`[VouchSelect] Saved setup params using global.setupStorage`);
        }
      }
      
      // Try to save to instance settings if instance is available
      if (instance) {
        try {
          // Update instance properties directly
          if (instance.vouchChannelId !== undefined) {
            instance.vouchChannelId = finalVouchChannelId;
          }
          
          // Update instance settings
          if (!instance.customSettings) instance.customSettings = {};
          instance.customSettings.vouchChannelId = finalVouchChannelId;
          instance.customSettings.vouchEnabled = enableVouches;
          
          console.log(`[VouchSelect] Updated instance properties directly`);
          
          // Try to save instance settings to file directly
          try {
            const instanceId = instance.instanceId || guildId;
            const settingsPath = path.join(__dirname, '..', 'instances', instanceId, 'settings.json');
            
            // Ensure directory exists
            const dir = path.dirname(settingsPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            
            // Read existing settings if available
            let settings = {};
            if (fs.existsSync(settingsPath)) {
              try {
                const data = fs.readFileSync(settingsPath, 'utf8');
                settings = JSON.parse(data);
              } catch (readError) {
                console.error(`[VouchSelect] Error reading settings file:`, readError);
              }
            }
            
            // Update settings
            settings.vouchChannelId = finalVouchChannelId;
            settings.vouchEnabled = enableVouches;
            
            // Write settings
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            console.log(`[VouchSelect] Saved instance settings directly to file`);
          } catch (settingsError) {
            console.error(`[VouchSelect] Error saving instance settings:`, settingsError);
          }
        } catch (instanceError) {
          console.error(`[VouchSelect] Error updating instance:`, instanceError);
        }
      } else {
        console.log(`[VouchSelect] No instance available, skipping instance update`);
      }
      
      // Verify channel existence for regular channel selection
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
        const transcriptChannelId = setupParams.transcriptChannelId;
        channelText = `Using transcript channel for vouches (<#${transcriptChannelId}>)`;
      } else {
        channelText = `Vouch channel: <#${selectedValue}>`;
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
      
      await interaction.editReply({
        content: `✅ Settings updated successfully!\n\n${channelText}\n\nWould you like to customize the messages users will see?\n\nYou can include \`{name}\` in messages to insert the user's name automatically and \`{phoneNumber}\` for their phone number.`,
        components: [customizeRow],
      });
      
      // Try updating instance_configs.json directly
      try {
        const configPath = path.join(__dirname, '..', 'instance_configs.json');
        if (fs.existsSync(configPath)) {
          let configs = {};
          try {
            const data = fs.readFileSync(configPath, 'utf8');
            configs = JSON.parse(data);
          } catch (readConfigError) {
            console.error(`[VouchSelect] Error reading instance configs:`, readConfigError);
          }
          
          // Update config for this guild
          const instanceId = instance?.instanceId || guildId;
          if (!configs[instanceId]) {
            configs[instanceId] = {
              guildId: guildId
            };
          }
          
          configs[instanceId].vouchChannelId = finalVouchChannelId;
          configs[instanceId].vouchEnabled = enableVouches;
          
          // Save updated configs
          fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
          console.log(`[VouchSelect] Updated instance configs directly`);
        }
      } catch (configError) {
        console.error(`[VouchSelect] Error updating instance configs:`, configError);
      }
    } catch (error) {
      console.error("[VouchSelect] Error in vouch channel selection:", error);
      
      try {
        await interaction.editReply({
          content: "Channel selection failed: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[VouchSelect] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new VouchSelectMenu();
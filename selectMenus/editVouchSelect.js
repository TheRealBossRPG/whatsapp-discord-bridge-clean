// selectMenus/editVouchSelect.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');
const fs = require('fs');
const path = require('path');

class EditVouchSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'edit_vouch_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate().catch(err => {
        console.error(`[EditVouchSelect] Error deferring update:`, err);
      });
      
      // Get the selected option
      const selectedValue = interaction.values[0];
      
      // Handle special values
      let newVouchChannelId = null;
      const disableVouches = selectedValue === "no_vouches";
      const useSameAsTranscript = selectedValue === "same_as_transcript";
      
      if (disableVouches) {
        // Disable vouches entirely
        newVouchChannelId = null;
      } 
      else if (useSameAsTranscript) {
        // Use same channel as transcript
        newVouchChannelId = instance.transcriptChannelId;
      }
      else {
        // Regular channel selection
        newVouchChannelId = selectedValue;
      }
      
      // Set enable/disable flag
      const vouchEnabled = !disableVouches;
      
      // Update instance properties
      if (instance) {
        // Update instance directly
        instance.vouchChannelId = newVouchChannelId;
        
        // Update custom settings
        if (!instance.customSettings) {
          instance.customSettings = {};
        }
        
        instance.customSettings.vouchChannelId = newVouchChannelId;
        instance.customSettings.vouchEnabled = vouchEnabled;
        
        // Update vouch handler if available
        if (instance.handlers && instance.handlers.vouchHandler) {
          instance.handlers.vouchHandler.vouchChannelId = newVouchChannelId;
          instance.handlers.vouchHandler.isDisabled = !vouchEnabled;
        } else if (instance.vouchHandler) {
          instance.vouchHandler.vouchChannelId = newVouchChannelId;
          instance.vouchHandler.isDisabled = !vouchEnabled;
        }
        
        // Save settings to file
        try {
          // Try instance method first
          if (typeof instance.saveSettings === 'function') {
            await instance.saveSettings({
              vouchChannelId: newVouchChannelId,
              vouchEnabled: vouchEnabled
            });
          } else {
            // Direct file update
            const instanceId = instance.instanceId || interaction.guildId;
            const settingsPath = path.join(__dirname, '..', 'instances', instanceId, 'settings.json');
            
            let settings = {};
            if (fs.existsSync(settingsPath)) {
              try {
                settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
              } catch (readError) {
                console.error(`[EditVouchSelect] Error reading settings:`, readError);
              }
            }
            
            // Update settings
            settings.vouchChannelId = newVouchChannelId;
            settings.vouchEnabled = vouchEnabled;
            
            // Ensure directory exists
            const dir = path.dirname(settingsPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            
            // Write updated settings
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            
            console.log(`[EditVouchSelect] Saved settings directly to file: ${settingsPath}`);
          }
          
          // Also update instance_configs.json
          const configPath = path.join(__dirname, '..', 'instance_configs.json');
          if (fs.existsSync(configPath)) {
            try {
              const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              const instanceId = instance.instanceId || interaction.guildId;
              
              if (configs[instanceId]) {
                configs[instanceId].vouchChannelId = newVouchChannelId;
                fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
                console.log(`[EditVouchSelect] Updated instance_configs.json for ${instanceId}`);
              }
            } catch (configError) {
              console.error(`[EditVouchSelect] Error updating config:`, configError);
            }
          }
        } catch (saveError) {
          console.error(`[EditVouchSelect] Error saving settings:`, saveError);
        }
      }
      
      // Build the settings screen embed
      const configEmbed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('WhatsApp Bridge Settings')
        .addFields(
          { 
            name: 'Category', 
            value: instance.categoryId ? `<#${instance.categoryId}>` : 'Not set', 
            inline: true 
          },
          { 
            name: 'Transcript Channel', 
            value: instance.transcriptChannelId ? `<#${instance.transcriptChannelId}>` : 'Not set', 
            inline: true 
          },
          { 
            name: 'Vouch Channel', 
            value: newVouchChannelId ? `<#${newVouchChannelId}>` : 'Not set (disabled)', 
            inline: true 
          }
        )
        .setDescription('Vouch channel settings updated successfully! You can change the following settings for your WhatsApp bridge.')
        .setTimestamp();
      
      // Create buttons for feature toggles
      const currentSettings = {
        transcriptsEnabled: true,
        vouchEnabled: vouchEnabled, // Use our new value
        sendClosingMessage: true,
        ...instance.customSettings,
        vouchEnabled: vouchEnabled // Ensure this override takes effect
      };
      
      const featureRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('toggle_transcripts')
            .setLabel(`Transcripts: ${currentSettings.transcriptsEnabled !== false ? 'Enabled' : 'Disabled'}`)
            .setStyle(currentSettings.transcriptsEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('toggle_vouches')
            .setLabel(`Vouches: ${currentSettings.vouchEnabled ? 'Enabled' : 'Disabled'}`)
            .setStyle(currentSettings.vouchEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('toggle_closing_messages')
            .setLabel(`Closing Messages: ${currentSettings.sendClosingMessage !== false ? 'Enabled' : 'Disabled'}`)
            .setStyle(currentSettings.sendClosingMessage !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
      
      // Create buttons for channel settings
      const channelRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('change_category')
            .setLabel('Change Category')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('change_transcript_channel')
            .setLabel('Change Transcript Channel')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('change_vouch_channel')
            .setLabel('Change Vouch Channel')
            .setStyle(ButtonStyle.Primary)
        );
      
      // Send the settings menu
      await interaction.editReply({
        content: '',
        embeds: [configEmbed],
        components: [featureRow, channelRow]
      });
    } catch (error) {
      console.error("[EditVouchSelect] Error in vouch channel selection:", error);
      
      try {
        await interaction.editReply({
          content: "Channel selection failed: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[EditVouchSelect] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new EditVouchSelectMenu();
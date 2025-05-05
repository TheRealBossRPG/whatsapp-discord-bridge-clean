// selectMenus/editTranscriptSelect.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');
const fs = require('fs');
const path = require('path');

class EditTranscriptSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'edit_transcript_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate().catch(err => {
        console.error(`[EditTranscriptSelect] Error deferring update:`, err);
      });
      
      // Get the selected option
      const selectedValue = interaction.values[0];
      const transcriptsEnabled = selectedValue !== "no_transcripts";
      
      // Set the new transcript channel ID
      let newTranscriptChannelId = null;
      if (selectedValue !== "no_transcripts") {
        newTranscriptChannelId = selectedValue;
      }
      
      // Update instance properties
      if (instance) {
        // Update instance directly
        instance.transcriptChannelId = newTranscriptChannelId;
        
        // Update custom settings
        if (!instance.customSettings) {
          instance.customSettings = {};
        }
        
        instance.customSettings.transcriptChannelId = newTranscriptChannelId;
        instance.customSettings.transcriptsEnabled = transcriptsEnabled;
        
        // Update transcript manager if available
        if (instance.managers && instance.managers.transcriptManager) {
          instance.managers.transcriptManager.transcriptChannelId = newTranscriptChannelId;
          instance.managers.transcriptManager.isDisabled = !transcriptsEnabled;
        } else if (instance.transcriptManager) {
          instance.transcriptManager.transcriptChannelId = newTranscriptChannelId;
          instance.transcriptManager.isDisabled = !transcriptsEnabled;
        }
        
        // Save settings to file
        try {
          // Try instance method first
          if (typeof instance.saveSettings === 'function') {
            await instance.saveSettings({
              transcriptChannelId: newTranscriptChannelId,
              transcriptsEnabled: transcriptsEnabled
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
                console.error(`[EditTranscriptSelect] Error reading settings:`, readError);
              }
            }
            
            // Update settings
            settings.transcriptChannelId = newTranscriptChannelId;
            settings.transcriptsEnabled = transcriptsEnabled;
            
            // Ensure directory exists
            const dir = path.dirname(settingsPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            
            // Write updated settings
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            
            console.log(`[EditTranscriptSelect] Saved settings directly to file: ${settingsPath}`);
          }
          
          // Also update instance_configs.json
          const configPath = path.join(__dirname, '..', 'instance_configs.json');
          if (fs.existsSync(configPath)) {
            try {
              const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              const instanceId = instance.instanceId || interaction.guildId;
              
              if (configs[instanceId]) {
                configs[instanceId].transcriptChannelId = newTranscriptChannelId;
                fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
                console.log(`[EditTranscriptSelect] Updated instance_configs.json for ${instanceId}`);
              }
            } catch (configError) {
              console.error(`[EditTranscriptSelect] Error updating config:`, configError);
            }
          }
        } catch (saveError) {
          console.error(`[EditTranscriptSelect] Error saving settings:`, saveError);
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
            value: newTranscriptChannelId ? `<#${newTranscriptChannelId}>` : 'Not set (still saved locally)', 
            inline: true 
          },
          { 
            name: 'Vouch Channel', 
            value: instance.vouchChannelId ? `<#${instance.vouchChannelId}>` : 'Not set', 
            inline: true 
          }
        )
        .setDescription('Transcript channel settings updated successfully! You can change the following settings for your WhatsApp bridge.')
        .setTimestamp();
      
      // Create buttons for feature toggles
      const currentSettings = {
        transcriptsEnabled: transcriptsEnabled, // Use our new value
        vouchEnabled: true,
        sendClosingMessage: true,
        ...instance.customSettings,
        transcriptsEnabled: transcriptsEnabled // Ensure this override takes effect
      };
      
      const featureRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('toggle_transcripts')
            .setLabel(`Transcripts: ${currentSettings.transcriptsEnabled ? 'Enabled' : 'Disabled'}`)
            .setStyle(currentSettings.transcriptsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('toggle_vouches')
            .setLabel(`Vouches: ${currentSettings.vouchEnabled !== false ? 'Enabled' : 'Disabled'}`)
            .setStyle(currentSettings.vouchEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
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
      console.error("[EditTranscriptSelect] Error in transcript channel selection:", error);
      
      try {
        await interaction.editReply({
          content: "Channel selection failed: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[EditTranscriptSelect] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new EditTranscriptSelectMenu();
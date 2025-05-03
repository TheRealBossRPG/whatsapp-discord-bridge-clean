// Updated selectMenus/transcriptSelect.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');
const fs = require('fs');
const path = require('path');

class TranscriptSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'transcript_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate().catch(err => {
        console.error(`[TranscriptSelect] Error deferring update:`, err);
      });
      
      // Get the selected option
      const selectedValue = interaction.values[0];
      
      // Update setup params directly
      const guildId = interaction.guild.id;
      let setupParams = {};
      
      // Load existing setup params
      try {
        const setupStoragePath = path.join(__dirname, '..', 'setup_storage', `${guildId}_setup.json`);
        if (fs.existsSync(setupStoragePath)) {
          const setupData = fs.readFileSync(setupStoragePath, 'utf8');
          setupParams = JSON.parse(setupData);
          console.log(`[TranscriptSelect] Loaded setup params directly from file`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          const params = global.setupStorage.getSetupParams(guildId);
          if (params) setupParams = params;
          console.log(`[TranscriptSelect] Loaded setup params from global.setupStorage`);
        }
      } catch (loadError) {
        console.error(`[TranscriptSelect] Error loading setup params:`, loadError);
      }
      
      // Update transcriptChannelId setting
      if (selectedValue === "no_transcripts") {
        setupParams.transcriptChannelId = null;
      } else {
        setupParams.transcriptChannelId = selectedValue;
      }
      
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
        console.log(`[TranscriptSelect] Saved setup params directly to file`);
      } catch (saveError) {
        console.error(`[TranscriptSelect] Error saving setup params directly:`, saveError);
        
        // Try fallback to global storage
        if (global.setupStorage && typeof global.setupStorage.saveSetupParams === 'function') {
          global.setupStorage.saveSetupParams(guildId, setupParams);
          console.log(`[TranscriptSelect] Saved setup params using global.setupStorage`);
        }
      }
      
      // Update instance if available (try different approaches safely)
      if (instance) {
        try {
          // Update transcriptChannelId
          if (instance.transcriptChannelId !== undefined) {
            instance.transcriptChannelId = selectedValue === "no_transcripts" ? null : selectedValue;
          }
          
          // Update manager if it exists
          if (instance.transcriptManager) {
            instance.transcriptManager.transcriptChannelId = selectedValue === "no_transcripts" ? null : selectedValue;
            instance.transcriptManager.isDisabled = selectedValue === "no_transcripts";
          } else if (instance.managers && instance.managers.transcriptManager) {
            instance.managers.transcriptManager.transcriptChannelId = selectedValue === "no_transcripts" ? null : selectedValue;
            instance.managers.transcriptManager.isDisabled = selectedValue === "no_transcripts";
          }
          
          // Update settings
          if (!instance.customSettings) instance.customSettings = {};
          instance.customSettings.transcriptChannelId = selectedValue === "no_transcripts" ? null : selectedValue;
          instance.customSettings.transcriptsEnabled = selectedValue !== "no_transcripts";
          
          console.log(`[TranscriptSelect] Updated instance properties`);
        } catch (instanceError) {
          console.error(`[TranscriptSelect] Error updating instance:`, instanceError);
        }
      }
      
      // Verify channel exists if it's not "no_transcripts"
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
      
      // Update message with success
      const channelText = selectedValue === "no_transcripts" ? 
        "Transcripts disabled" : 
        `Transcript channel: <#${selectedValue}>`;

      // Now we need to decide what to show next - ask about vouches
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
      
      await interaction.editReply({
        content: `✅ Settings updated successfully!\n\n${channelText}\n\nDo you want to enable the vouching system?`,
        components: [vouchOptionsRow],
      });
    } catch (error) {
      console.error("[TranscriptSelect] Error in transcript channel selection:", error);
      
      try {
        await interaction.editReply({
          content: "Channel selection failed: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[TranscriptSelect] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new TranscriptSelectMenu();
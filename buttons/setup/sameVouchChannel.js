// Updated buttons/setup/sameVouchChannel.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../templates/Button');
const fs = require('fs');
const path = require('path');

class SameVouchChannelButton extends Button {
  constructor() {
    super({
      customId: 'same_vouch_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[SameVouchChannel] Processing button click`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[SameVouchChannel] Error deferring update:`, err);
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
          console.log(`[SameVouchChannel] Loaded setup params directly from file`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          const params = global.setupStorage.getSetupParams(guildId);
          if (params) setupParams = params;
          console.log(`[SameVouchChannel] Loaded setup params from global.setupStorage`);
        }
      } catch (loadError) {
        console.error(`[SameVouchChannel] Error loading setup params:`, loadError);
      }
      
      // Use same channel for vouch as transcript
      if (setupParams.transcriptChannelId) {
        setupParams.vouchChannelId = setupParams.transcriptChannelId;
        
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
          console.log(`[SameVouchChannel] Saved setup params directly to file`);
        } catch (saveError) {
          console.error(`[SameVouchChannel] Error saving setup params directly:`, saveError);
          
          // Try fallback to global storage
          if (global.setupStorage && typeof global.setupStorage.saveSetupParams === 'function') {
            global.setupStorage.saveSetupParams(guildId, setupParams);
            console.log(`[SameVouchChannel] Saved setup params using global.setupStorage`);
          }
        }
        
        console.log(`[SameVouchChannel] Using same channel for vouches: ${setupParams.vouchChannelId} for guild ${guildId}`);
      } else {
        console.error(`[SameVouchChannel] No transcript channel ID found in setup params`);
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
        statusText += `Vouch channel: <#${setupParams.vouchChannelId}> (same as transcripts)\n`;
      } else {
        statusText += `Transcript channel: None (disabled)\n`;
        statusText += `Vouch channel: None (disabled)\n`;
      }
      
      await interaction.editReply({
        content: `${statusText}\nWould you like to customize the messages users will see?\n\nYou can include \`{name}\` in messages to insert the user's name automatically and \`{phoneNumber}\` for their phone number.`,
        components: [customizeRow],
      });
    } catch (error) {
      console.error("[SameVouchChannel] Error handling same vouch channel option:", error);
      
      try {
        await interaction.editReply({
          content: "Error: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[SameVouchChannel] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new SameVouchChannelButton();
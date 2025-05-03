// Updated buttons/setup/differentVouchChannel.js
const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');
const fs = require('fs');
const path = require('path');

class DifferentVouchChannelButton extends Button {
  constructor() {
    super({
      customId: 'different_vouch_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[DifferentVouchChannel] Processing button click`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[DifferentVouchChannel] Error deferring update:`, err);
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
          console.log(`[DifferentVouchChannel] Loaded setup params directly from file`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          const params = global.setupStorage.getSetupParams(guildId);
          if (params) setupParams = params;
          console.log(`[DifferentVouchChannel] Loaded setup params from global.setupStorage`);
        }
      } catch (loadError) {
        console.error(`[DifferentVouchChannel] Error loading setup params:`, loadError);
      }
      
      // Get all text channels in the guild
      const textChannels = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildText
      );
      
      if (textChannels.size === 0) {
        await interaction.editReply({
          content: "❌ No text channels found in this server. Please create a text channel first.",
          components: [],
        });
        return;
      }
      
      // Create options for select menu
      const channelOptions = [
        {
          label: "No Vouches",
          value: "no_vouches",
          description: "Disable vouch system"
        },
        ...textChannels
          .map((channel) => ({
            label: channel.name,
            value: channel.id,
            description: "Channel for posting vouches",
          }))
          .slice(0, 24) // Leave room for "No Vouches" option
      ];
      
      // Create select menu for vouch channel
      const vouchSelectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("vouch_select")
          .setPlaceholder("Select a channel for vouches")
          .addOptions(channelOptions)
      );
      
      // Display category and transcript information
      let displayContent = '';
      
      if (setupParams.categoryId) {
        displayContent += `Category: <#${setupParams.categoryId}>\n`;
      }
      
      if (setupParams.transcriptChannelId) {
        displayContent += `Transcript channel: <#${setupParams.transcriptChannelId}>\n`;
      } else {
        displayContent += `No transcript channel selected\n`;
      }
      
      displayContent += `Now select a channel for vouches:`;
      
      await interaction.editReply({
        content: displayContent,
        components: [vouchSelectRow],
      });
    } catch (error) {
      console.error("[DifferentVouchChannel] Error handling different vouch channel option:", error);
      
      try {
        await interaction.editReply({
          content: "Error: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[DifferentVouchChannel] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new DifferentVouchChannelButton();
// Updated buttons/setup/useVouchChannel.js
const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');
const fs = require('fs');
const path = require('path');

class UseVouchChannelButton extends Button {
  constructor() {
    super({
      customId: 'use_vouch_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[UseVouchChannel] Processing button click`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[UseVouchChannel] Error deferring update:`, err);
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
          console.log(`[UseVouchChannel] Loaded setup params directly from file`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          const params = global.setupStorage.getSetupParams(guildId);
          if (params) setupParams = params;
          console.log(`[UseVouchChannel] Loaded setup params from global.setupStorage`);
        }
      } catch (loadError) {
        console.error(`[UseVouchChannel] Error loading setup params:`, loadError);
      }
      
      if (setupParams.transcriptChannelId) {
        // Ask if they want to use the same channel as transcript
        const sameChannelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("same_vouch_channel")
            .setLabel("Use Same Channel for Vouches")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("different_vouch_channel")
            .setLabel("Select Different Channel")
            .setStyle(ButtonStyle.Secondary)
        );
        
        // Build content that shows selected category and transcript channel
        let content = '';
        
        if (setupParams.categoryId) {
          content += `Category: <#${setupParams.categoryId}>\n`;
        }
        
        if (setupParams.transcriptChannelId) {
          content += `Transcript channel: <#${setupParams.transcriptChannelId}>\n`;
        }
        
        content += `\nDo you want to use the same channel for vouches, or select a different one?`;
        
        await interaction.editReply({
          content: content,
          components: [sameChannelRow],
        });
      } else {
        // No transcript channel but wants vouches, select a vouch channel
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
        
        // Build content that shows selected category 
        let content = '';
        
        if (setupParams.categoryId) {
          content += `Category: <#${setupParams.categoryId}>\n`;
        }
        
        content += `No transcript channel selected\nNow select a channel for vouches:`;
        
        await interaction.editReply({
          content: content,
          components: [vouchSelectRow],
        });
      }
    } catch (error) {
      console.error("[UseVouchChannel] Error handling vouch channel option:", error);
      
      try {
        await interaction.editReply({
          content: "Error: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[UseVouchChannel] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new UseVouchChannelButton();
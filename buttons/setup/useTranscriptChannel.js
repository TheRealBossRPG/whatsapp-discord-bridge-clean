// Updated buttons/setup/useTranscriptChannel.js
const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');
const fs = require('fs');
const path = require('path');

class UseTranscriptChannelButton extends Button {
  constructor() {
    super({
      customId: 'use_transcript_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[UseTranscriptChannel] Processing button click`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[UseTranscriptChannel] Error deferring update:`, err);
        });
      }
      
      // Get setup info directly from storage to avoid circular dependency
      const guildId = interaction.guild.id;
      let setupParams = null;
      
      // Get setup params directly from storage file
      try {
        const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
        if (fs.existsSync(setupStoragePath)) {
          const setupData = fs.readFileSync(setupStoragePath, 'utf8');
          setupParams = JSON.parse(setupData);
          console.log(`[UseTranscriptChannel] Loaded setup params directly from file: ${setupStoragePath}`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          setupParams = global.setupStorage.getSetupParams(guildId);
          console.log(`[UseTranscriptChannel] Loaded setup params from global.setupStorage`);
        }
      } catch (paramError) {
        console.error(`[UseTranscriptChannel] Error loading setup parameters:`, paramError);
      }
      
      // If we still couldn't get setup params, create a minimal object
      if (!setupParams) {
        setupParams = { guildId, categoryId: null };
        console.log(`[UseTranscriptChannel] Created minimal setup params object`);
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
          label: "No Transcripts",
          value: "no_transcripts",
          description: "Disable transcript saving"
        },
        ...textChannels
          .map((channel) => ({
            label: channel.name,
            value: channel.id,
            description: "Channel for saving transcripts",
          }))
          .slice(0, 24) // Leave room for "No Transcripts" option
      ];
      
      // Create select menu for transcript channel
      const transcriptSelectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("transcript_select")
          .setPlaceholder("Select a channel for transcripts")
          .addOptions(channelOptions)
      );
      
      // Update the reply with category ID from setupParams
      let categoryMessage = '';
      if (setupParams.categoryId) {
        try {
          // Check if category exists
          const category = interaction.guild.channels.cache.get(setupParams.categoryId);
          if (category) {
            categoryMessage = `Category selected: <#${setupParams.categoryId}>\n`;
          } else {
            categoryMessage = `Category selected (ID: ${setupParams.categoryId})\n`;
          }
        } catch (error) {
          categoryMessage = `Category selected\n`;
        }
      } else {
        categoryMessage = `Category selected\n`;
      }
      
      await interaction.editReply({
        content: `${categoryMessage}Now select a channel for ticket transcripts:`,
        components: [transcriptSelectRow],
      });
    } catch (error) {
      console.error("[UseTranscriptChannel] Error handling transcript channel option:", error);
      
      try {
        await interaction.editReply({
          content: "Error: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[UseTranscriptChannel] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new UseTranscriptChannelButton();
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const SelectMenu = require('../templates/SelectMenu');

class CategorySelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'category_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      const categoryId = interaction.values[0];
      const guildId = interaction.guild.id;
      
      // Save to setup storage
      global.setupStorage.saveSetupParams(guildId, {
        guildId: guildId,
        categoryId: categoryId,
      });
      
      console.log(`[Setup] Saved category ID ${categoryId} for guild ${guildId}`);
      
      // Verify category exists
      const selectedCategory = interaction.guild.channels.cache.get(categoryId);
      if (!selectedCategory) {
        try {
          await interaction.guild.channels.fetch(categoryId);
        } catch (e) {
          await interaction.editReply({
            content: "❌ Selected category not found. Please try again.",
            components: [],
          });
          return;
        }
      }
      
      // CHANGED: Ask if they want a transcript channel
      const transcriptOptionsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("use_transcript_channel")
          .setLabel("Yes, Save Transcripts")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("no_transcript_channel")
          .setLabel("No Transcript Channel")
          .setStyle(ButtonStyle.Secondary)
      );
      
      await interaction.editReply({
        content: `Category selected: <#${categoryId}>\n\nDo you want to save ticket transcripts to a channel?`,
        components: [transcriptOptionsRow],
      });
    } catch (error) {
      console.error("Error in category selection:", error);
      await interaction.editReply({
        content: "Category selection failed: " + error.message,
        components: [],
      });
    }
  }
}

module.exports = new CategorySelectMenu();
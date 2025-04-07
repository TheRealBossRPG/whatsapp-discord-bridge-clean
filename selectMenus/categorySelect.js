const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');
const InteractionTracker = require('../utils/InteractionTracker');

class CategorySelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'category_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // IMPORTANT: First check if the interaction exists and is valid
      if (!interaction || !interaction.id) {
        console.error("Invalid interaction object passed to CategorySelectMenu");
        return;
      }

      // Get the selected category ID
      const categoryId = interaction.values[0];
      const guildId = interaction.guild?.id;
      
      if (!guildId) {
        console.error("Guild ID not found in interaction");
        return;
      }
      
      // Save to setup storage
      global.setupStorage.saveSetupParams(guildId, {
        guildId: guildId,
        categoryId: categoryId,
      });
      
      console.log(`[Setup] Saved category ID ${categoryId} for guild ${guildId}`);
      
      // CRITICAL: Check if the interaction can be edited before proceeding
      if (!interaction.deferred && !interaction.replied) {
        try {
          await interaction.deferUpdate();
          console.log(`Deferred category selection update for ${interaction.id}`);
        } catch (deferError) {
          console.error(`Error deferring category selection:`, deferError);
          // Try to send a new response if deferring fails
          try {
            await interaction.reply({
              content: `Processing your selection...`,
              ephemeral: true
            });
          } catch (replyError) {
            console.error(`Error replying to category selection:`, replyError);
            return; // Can't continue if we can't interact
          }
        }
      }
      
      // Create the buttons for transcript channel options
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
      
      // Try multiple methods to ensure the message gets updated
      try {
        // First try direct editReply if applicable
        if (interaction.replied) {
          await interaction.editReply({
            content: `Category selected: <#${categoryId}>\n\nDo you want to save ticket transcripts to a channel?`,
            components: [transcriptOptionsRow],
          });
        } 
        // Then try update if applicable
        else if (interaction.deferred) {
          await interaction.editReply({
            content: `Category selected: <#${categoryId}>\n\nDo you want to save ticket transcripts to a channel?`,
            components: [transcriptOptionsRow],
          });
        } 
        // Otherwise try to update directly
        else {
          await interaction.update({
            content: `Category selected: <#${categoryId}>\n\nDo you want to save ticket transcripts to a channel?`,
            components: [transcriptOptionsRow],
          });
        }
        console.log(`Successfully updated the message after category selection for ${interaction.id}`);
      } catch (updateError) {
        console.error(`Error updating message after category selection:`, updateError);
        
        // As a fallback, try to send a followUp
        try {
          await interaction.followUp({
            content: `Category selected: <#${categoryId}>\n\nDo you want to save ticket transcripts to a channel?`,
            components: [transcriptOptionsRow],
            ephemeral: true
          });
        } catch (followUpError) {
          console.error(`Error sending followup for category selection:`, followUpError);
        }
      }
    } catch (error) {
      console.error("Error in category selection:", error);
      
      // Try to send an error response
      try {
        if (interaction && interaction.isRepliable()) {
          await interaction.reply({
            content: "❌ Category selection failed: " + error.message,
            ephemeral: true
          }).catch(err => console.error("Failed to send error message:", err));
        }
      } catch (replyError) {
        console.error("Could not send error response:", replyError);
      }
    }
  }
}

module.exports = new CategorySelectMenu();
// selectMenus/editCategorySelect.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');
const fs = require('fs');
const path = require('path');

class EditCategorySelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'edit_category_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate().catch(err => {
        console.error(`[EditCategorySelect] Error deferring update:`, err);
      });
      
      // Get the selected category ID
      const newCategoryId = interaction.values[0];
      
      // Update instance directly
      if (instance) {
        const oldCategoryId = instance.categoryId;
        
        // Update the instance's category ID
        instance.categoryId = newCategoryId;
        
        // Update route mapping if needed
        if (interaction.client._instanceRoutes) {
          // Remove old route mapping
          if (oldCategoryId && interaction.client._instanceRoutes.has(oldCategoryId)) {
            interaction.client._instanceRoutes.delete(oldCategoryId);
          }
          
          // Add new route mapping
          interaction.client._instanceRoutes.set(newCategoryId, {
            instanceId: instance.instanceId,
            handler: instance.handlers?.discordHandler || null,
            instance: instance
          });
        }
        
        // Save changes to instance settings
        if (typeof instance.saveSettings === 'function') {
          await instance.saveSettings({ categoryId: newCategoryId });
        }
        
        // Also update global config file directly
        const configPath = path.join(__dirname, '..', 'instance_configs.json');
        if (fs.existsSync(configPath)) {
          let configs = {};
          
          try {
            configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            
            // Update the config for this instance
            if (configs[instance.instanceId]) {
              configs[instance.instanceId].categoryId = newCategoryId;
              fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
            }
          } catch (configError) {
            console.error(`[EditCategorySelect] Error updating config file:`, configError);
          }
        }
      }
      
      // Return to Edit Settings screen - recreate the settings menu
      const configEmbed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('WhatsApp Bridge Settings')
        .addFields(
          { 
            name: 'Category', 
            value: newCategoryId ? `<#${newCategoryId}>` : 'Not set', 
            inline: true 
          },
          { 
            name: 'Transcript Channel', 
            value: instance.transcriptChannelId ? `<#${instance.transcriptChannelId}>` : 'Not set', 
            inline: true 
          },
          { 
            name: 'Vouch Channel', 
            value: instance.vouchChannelId ? `<#${instance.vouchChannelId}>` : 'Not set', 
            inline: true 
          }
        )
        .setDescription('Category updated successfully! You can change the following settings for your WhatsApp bridge.')
        .setTimestamp();
      
      // Create buttons for feature toggles
      const currentSettings = {
        transcriptsEnabled: true,
        vouchEnabled: true,
        sendClosingMessage: true,
        ...instance.customSettings // Override with actual instance settings
      };
      
      const featureRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('toggle_transcripts')
            .setLabel(`Transcripts: ${currentSettings.transcriptsEnabled !== false ? 'Enabled' : 'Disabled'}`)
            .setStyle(currentSettings.transcriptsEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
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
      console.error("[EditCategorySelect] Error in category selection:", error);
      
      try {
        await interaction.editReply({
          content: "Category selection failed: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("[EditCategorySelect] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new EditCategorySelectMenu();
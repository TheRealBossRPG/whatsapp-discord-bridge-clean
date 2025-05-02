// buttons/setup/editSettings.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const Button = require('../../templates/Button');

/**
 * Button handler for editing settings
 * UPDATED: Added Change Category button
 */
class EditSettingsButton extends Button {
  constructor() {
    super({
      customId: 'edit_settings'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[EditSettings] Processing edit settings button`);
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[EditSettings] Error deferring update:`, err);
        });
      }
      
      // Get instance if not provided
      if (!instance) {
        // First try getting instance from client's route map via category
        if (interaction.channel?.parentId && interaction.client._instanceRoutes) {
          const categoryId = interaction.channel.parentId;
          console.log(`[EditSettings] Checking category ID: ${categoryId}`);
          
          if (interaction.client._instanceRoutes.has(categoryId)) {
            instance = interaction.client._instanceRoutes.get(categoryId).instance;
            console.log(`[EditSettings] Found instance via category: ${instance?.instanceId || 'unknown'}`);
          }
        }
        
        // If not found by category, try finding by guild ID
        if (!instance && interaction.client._instanceRoutes) {
          console.log(`[EditSettings] Searching all routes for guild match: ${interaction.guildId}`);
          
          for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
            if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
              instance = routeInfo.instance;
              console.log(`[EditSettings] Found instance via guild match: ${instance?.instanceId || 'unknown'}`);
              break;
            }
          }
        }
        
        // If still no instance, show error
        if (!instance) {
          console.error(`[EditSettings] No instance found for guild ${interaction.guildId}`);
          await interaction.editReply({
            content: '❌ Could not find WhatsApp configuration. Please run `/setup` first.',
            components: []
          });
          return;
        }
      }
      
      // Get current settings with proper defaults
      const currentSettings = {
        transcriptsEnabled: true,
        vouchEnabled: true,
        sendClosingMessage: true,
        ...instance.customSettings // Override with actual instance settings
      };
      
      // Create information embed
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
            value: instance.vouchChannelId ? `<#${instance.vouchChannelId}>` : 'Not set', 
            inline: true 
          }
        )
        .setDescription('You can change the following settings for your WhatsApp bridge.')
        .setTimestamp();
      
      // Create buttons for feature toggles
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
      console.error(`[EditSettings] Error handling edit settings button:`, error);
      
      try {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          components: []
        });
      } catch (replyError) {
        console.error(`[EditSettings] Error sending error message:`, replyError);
      }
    }
  }
}

module.exports = new EditSettingsButton();
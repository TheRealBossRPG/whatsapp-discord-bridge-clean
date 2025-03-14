const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Command = require('../templates/Command');

class ManageSpecialChannelsCommand extends Command {
  constructor() {
    super({
      name: 'manage-special-channels',
      description: 'List, edit or remove special channels',
      permissions: PermissionFlagsBits.ManageGuild
    });
  }
  
  async execute(interaction, instance) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      // Get instance
      if (!instance) {
        await interaction.editReply("❌ WhatsApp bridge is not set up for this server. Please use `/setup` first.");
        return;
      }
      
      // Get special channels from instance settings
      const specialChannels = instance.customSettings?.specialChannels || {};
      const specialChannelIds = Object.keys(specialChannels);
      
      if (specialChannelIds.length === 0) {
        // No special channels configured
        const addRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('add_special_channel_btn')
              .setLabel('Add Special Channel')
              .setStyle(ButtonStyle.Primary)
          );
        
        await interaction.editReply({
          content: "📋 **Special Channels**\n\nNo special channels have been configured yet. Click the button below to add one.",
          components: [addRow]
        });
        return;
      }
      
      // Create an embed to list all special channels
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('Special Channels')
        .setDescription('These channels have custom messages when mentioned in WhatsApp messages:')
        .setTimestamp();
      
      // Add each special channel to the embed
      for (const channelId of specialChannelIds) {
        const channel = interaction.guild.channels.cache.get(channelId);
        const channelName = channel ? `#${channel.name}` : `Unknown Channel (${channelId})`;
        const message = specialChannels[channelId].message;
        
        embed.addFields({
          name: channelName,
          value: `Message: ${message}`
        });
      }
      
      // Create buttons for each special channel to edit or remove
      const rows = [];
      let currentRow = new ActionRowBuilder();
      let buttonCount = 0;
      
      for (const channelId of specialChannelIds) {
        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) continue;
        
        // Add edit button for this channel
        currentRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`edit_special_${channelId}`)
            .setLabel(`Edit #${channel.name}`)
            .setStyle(ButtonStyle.Primary)
        );
        
        // Add remove button for this channel
        currentRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`remove_special_${channelId}`)
            .setLabel(`Remove #${channel.name}`)
            .setStyle(ButtonStyle.Danger)
        );
        
        buttonCount += 2;
        
        // Discord has a limit of 5 buttons per row
        if (buttonCount >= 4 || specialChannelIds.indexOf(channelId) === specialChannelIds.length - 1) {
          rows.push(currentRow);
          currentRow = new ActionRowBuilder();
          buttonCount = 0;
        }
      }
      
      // Add a row with an "Add New" button if we have room
      if (rows.length < 5) {
        const addRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('add_special_channel_btn')
              .setLabel('Add New Special Channel')
              .setStyle(ButtonStyle.Success)
          );
        
        rows.push(addRow);
      }
      
      // Send the embed with buttons
      await interaction.editReply({
        embeds: [embed],
        components: rows
      });
    } catch (error) {
      console.error("Error handling manage-special-channels command:", error);
      await interaction.editReply(`❌ Error: ${error.message}`);
    }
  }
}

module.exports = new ManageSpecialChannelsCommand();
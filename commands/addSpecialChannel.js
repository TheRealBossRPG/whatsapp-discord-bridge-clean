const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const Command = require('../templates/Command');
const InstanceManager = require('../core/InstanceManager');

class AddSpecialChannelCommand extends Command {
  constructor() {
    super({
      name: 'add-special-channel',
      description: 'Add a channel with a custom message when mentioned',
      permissions: PermissionFlagsBits.ManageGuild
    });
  }
  
  async execute(interaction, instance) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      // Get instance
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }
      
      if (!instance) {
        await interaction.editReply("❌ WhatsApp bridge is not set up for this server. Please use `/setup` first.");
        return;
      }
      
      // Get all text channels in the guild
      const textChannels = interaction.guild.channels.cache.filter(
        c => c.type === ChannelType.GuildText
      );
      
      if (textChannels.size === 0) {
        await interaction.editReply({
          content: "❌ No text channels found in this server."
        });
        return;
      }
      
      // Create select menu with text channels
      const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
      const channelOptions = textChannels
        .map(channel => ({
          label: channel.name,
          value: channel.id,
          description: `#${channel.name}`
        }))
        .slice(0, 25); // Discord limit
      
      // Create the select menu
      const row = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('special_channel_select')
            .setPlaceholder('Select a channel to make special')
            .addOptions(channelOptions)
        );
      
      // Send the select menu
      await interaction.editReply({
        content: "Select a channel to add special handling for when mentioned:",
        components: [row]
      });
    } catch (error) {
      console.error("Error handling add-special-channel command:", error);
      await interaction.editReply(`❌ Error: ${error.message}`);
    }
  }
}

module.exports = new AddSpecialChannelCommand();
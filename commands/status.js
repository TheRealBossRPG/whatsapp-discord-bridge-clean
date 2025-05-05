// commands/status.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const Command = require('../templates/Command');

class StatusCommand extends Command {
  constructor() {
    super({
      name: 'status',
      description: 'Check the status of the WhatsApp connection'
    });
  }

  async execute(interaction, instance) {
    try {
      // Ensure interaction is deferred
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      // Get instance without using InstanceManager
      if (!instance) {
        console.log(`[StatusCommand] Finding instance for guild ${interaction.guildId}`);
        
        // First check client route map
        if (interaction.client._instanceRoutes) {
          // Try by category ID
          if (interaction.channel && interaction.channel.parentId) {
            const categoryId = interaction.channel.parentId;
            if (interaction.client._instanceRoutes.has(categoryId)) {
              instance = interaction.client._instanceRoutes.get(categoryId).instance;
              console.log(`[StatusCommand] Found instance by category: ${instance?.instanceId || 'unknown'}`);
            }
          }
          
          // If not found by category, try guild ID
          if (!instance) {
            for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
              if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
                instance = routeInfo.instance;
                console.log(`[StatusCommand] Found instance by guild: ${instance?.instanceId || 'unknown'}`);
                break;
              }
            }
          }
        }
        
        // If still no instance, try reading config directly
        if (!instance) {
          try {
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(__dirname, '..', 'instance_configs.json');
            
            if (fs.existsSync(configPath)) {
              const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              
              // Find config for this guild
              for (const [instanceId, config] of Object.entries(configs)) {
                if (config.guildId === interaction.guildId) {
                  // Create a minimal instance object
                  instance = {
                    instanceId,
                    guildId: interaction.guildId,
                    categoryId: config.categoryId,
                    transcriptChannelId: config.transcriptChannelId,
                    vouchChannelId: config.vouchChannelId,
                    customSettings: config.customSettings || {},
                    isConnected: function() { return false; },
                    isTemporary: true
                  };
                  console.log(`[StatusCommand] Created instance from config: ${instanceId}`);
                  break;
                }
              }
            }
          } catch (configError) {
            console.error(`[StatusCommand] Error loading config:`, configError);
          }
        }
      }

      if (!instance) {
        await interaction.editReply(
          "❌ No WhatsApp bridge is configured for this server. Use `/setup` to set one up."
        );
        return;
      }

      // Get instance status without using getStatus directly
      let status = {
        instanceId: instance.instanceId || 'unknown',
        guildId: instance.guildId || interaction.guildId,
        isConnected: false,
        activeTickets: 0,
        registeredUsers: 0,
        transcriptChannel: instance.transcriptChannelId || null,
        vouchChannel: instance.vouchChannelId || null,
        categoryId: instance.categoryId || null
      };
      
      // Try different ways to determine if connected
      if (typeof instance.isConnected === 'function') {
        try {
          status.isConnected = instance.isConnected();
        } catch (connectedError) {
          console.error(`[StatusCommand] Error checking isConnected:`, connectedError);
        }
      } else if (instance.connected === true) {
        status.isConnected = true;
      } else if (instance.clients?.whatsAppClient?.isReady === true) {
        status.isConnected = true;
      }
      
      // Try to get ticket count
      if (instance.managers?.channelManager && typeof instance.managers.channelManager.getChannelMapSize === 'function') {
        try {
          status.activeTickets = instance.managers.channelManager.getChannelMapSize();
        } catch (ticketError) {
          console.error(`[StatusCommand] Error getting active tickets:`, ticketError);
        }
      }
      
      // Try to get user count
      if (instance.managers?.userCardManager && typeof instance.managers.userCardManager.getUserCardCount === 'function') {
        try {
          status.registeredUsers = instance.managers.userCardManager.getUserCardCount();
        } catch (userError) {
          console.error(`[StatusCommand] Error getting registered users:`, userError);
        }
      }

      // Create status embed
      const embed = new EmbedBuilder()
        .setColor(status.isConnected ? 0x00ff00 : 0xff0000)
        .setTitle("WhatsApp Bridge Status")
        .addFields([
          {
            name: "Status",
            value: status.isConnected ? "🟢 Connected" : "🔴 Disconnected",
          },
          { name: "Server", value: interaction.guild.name, inline: true },
          {
            name: "Category",
            value: status.categoryId ? `<#${status.categoryId}>` : "Not set",
          },
          {
            name: "Transcript Channel",
            value: status.transcriptChannel ? `<#${status.transcriptChannel}>` : "Not set",
          },
          {
            name: "Vouch Channel",
            value: status.vouchChannel ? `<#${status.vouchChannel}>` : "Not set",
          },
          { name: "Active Tickets", value: status.activeTickets.toString() },
          { name: "Registered Users", value: status.registeredUsers.toString() }
        ])
        .setFooter({ text: "Last updated" })
        .setTimestamp();

      // Add reconnect button if disconnected
      const components = [];
      if (!status.isConnected) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("reconnect_status")
            .setLabel("Reconnect WhatsApp")
            .setStyle(ButtonStyle.Primary)
        );
        components.push(row);
      } else {
        // Add refresh QR code option for connected instance
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("refresh_qr")
            .setLabel("Refresh QR Code")
            .setStyle(ButtonStyle.Secondary)
        );
        components.push(row);
      }

      await interaction.editReply({
        embeds: [embed],
        components: components,
      });
    } catch (error) {
      console.error("Error in status command:", error);
      await interaction.editReply(`❌ Error checking status: ${error.message}`);
    }
  }
}

module.exports = new StatusCommand();
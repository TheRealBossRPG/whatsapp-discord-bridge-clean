// buttons/ticket/closeTicket.js

const { ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../templates/Button');

class CloseTicketButton extends Button {
  constructor() {
    super({
      customId: 'close',
      regex: /^(close|close-ticket|close_ticket)$/
    });
  }
  
  matches(customId) {
    return customId === 'close' || 
           customId.startsWith('close-ticket') || 
           customId === 'close_ticket';
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[CloseTicketButton] Processing close ticket interaction: ${interaction.customId}`);
      
      // FIXED: Use flags instead of ephemeral directly
      await interaction.deferReply({ ephemeral: true });
      
      // Get the current channel ID - we'll always close the current channel
      const channelId = interaction.channelId;
      console.log(`[CloseTicketButton] Closing ticket in channel: ${channelId}`);
      
      // Get instance if not provided - FIXED: Avoid circular dependency completely
      if (!instance) {
        console.log(`[CloseTicketButton] Instance not provided, getting from route map`);
        
        // Look directly in route map without using InstanceManager
        if (interaction.client._instanceRoutes) {
          // First try by channel's parent category
          const categoryId = interaction.channel.parentId;
          console.log(`[CloseTicketButton] Channel parent ID: ${categoryId}`);
          
          if (categoryId && interaction.client._instanceRoutes.has(categoryId)) {
            instance = interaction.client._instanceRoutes.get(categoryId).instance;
            console.log(`[CloseTicketButton] Found instance via category: ${instance?.instanceId || 'unknown'}`);
          } else {
            // If no direct match, look for any instance with this guild ID
            for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
              if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
                instance = routeInfo.instance;
                console.log(`[CloseTicketButton] Found instance via guild match: ${instance?.instanceId || 'unknown'}`);
                break;
              }
            }
          }
        }
        
        if (!instance) {
          // As a last resort, try to read config file directly
          try {
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(__dirname, '..', '..', 'instance_configs.json');
            
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
                    isTemporary: true
                  };
                  console.log(`[CloseTicketButton] Created instance from config: ${instanceId}`);
                  break;
                }
              }
            }
          } catch (configError) {
            console.error(`[CloseTicketButton] Error loading config:`, configError);
          }
        }
        
        // If still no instance, error out
        if (!instance) {
          console.error(`[CloseTicketButton] Could not find instance for channel`);
          await interaction.editReply({
            content: "❌ System error: Could not find WhatsApp bridge configuration."
          });
          return false;
        }
      }
      
      // Find ticketManager - PROPERLY SCOPED SEARCH
      let ticketManager = null;
      let managerPath = null;
      
      // Check all possible paths to ticketManager
      if (instance.ticketManager) {
        ticketManager = instance.ticketManager;
        managerPath = "instance.ticketManager";
      } else if (instance.managers && instance.managers.ticketManager) {
        ticketManager = instance.managers.ticketManager;
        managerPath = "instance.managers.ticketManager";
      } else if (instance.handlers && instance.handlers.ticketHandler) {
        ticketManager = instance.handlers.ticketHandler;
        managerPath = "instance.handlers.ticketHandler";
      }
      
      // If no ticketManager, try to create one
      if (!ticketManager) {
        console.log(`[CloseTicketButton] No ticket manager found, creating temporary one`);
        
        try {
          // Load required modules directly
          const path = require('path');
          const TicketManager = require(path.join(__dirname, '..', '..', 'modules', 'managers', 'TicketManager'));
          
          // Create channel manager (required for TicketManager)
          let channelManager = null;
          if (instance.channelManager) {
            channelManager = instance.channelManager;
          } else if (instance.managers && instance.managers.channelManager) {
            channelManager = instance.managers.channelManager;
          } else {
            // Create minimal channel manager if needed
            const ChannelManager = require(path.join(__dirname, '..', '..', 'modules', 'managers', 'ChannelManager'));
            channelManager = new ChannelManager(instance.instanceId || 'default');
          }
          
          // Create new ticket manager
          ticketManager = new TicketManager(
            channelManager,
            interaction.client,
            interaction.guildId,
            interaction.channel.parentId,
            {
              instanceId: instance.instanceId || 'default',
              customSettings: instance.customSettings || {}
            }
          );
          
          managerPath = "temporary TicketManager";
          console.log(`[CloseTicketButton] Created ${managerPath}`);
        } catch (creationError) {
          console.error(`[CloseTicketButton] Error creating ticket manager:`, creationError);
        }
      }
      
      // Check if we have a valid ticket manager
      if (!ticketManager || typeof ticketManager.closeTicket !== 'function') {
        console.error(`[CloseTicketButton] No valid ticket manager found`);
        await interaction.editReply({
          content: "❌ System error: Ticket manager not available. Please report this issue."
        });
        return false;
      }
      
      console.log(`[CloseTicketButton] Found ticket manager at ${managerPath}`);
      
      // Close the ticket
      console.log(`[CloseTicketButton] Closing ticket in channel: ${channelId}`);
      const shouldSendClosingMessage = instance.customSettings?.sendClosingMessage !== false;
      const success = await ticketManager.closeTicket(channelId, shouldSendClosingMessage, interaction);
      
      if (success) {
        console.log(`[CloseTicketButton] Ticket closed successfully`);
        return true;
      } else {
        console.error(`[CloseTicketButton] Failed to close ticket`);
        await interaction.editReply({
          content: "❌ Failed to close ticket. Please try again later."
        });
        return false;
      }
    } catch (error) {
      console.error(`[CloseTicketButton] Error handling close ticket:`, error);
      
      try {
        await interaction.editReply({
          content: `❌ Error closing ticket: ${error.message}`
        });
      } catch (replyError) {
        console.error(`[CloseTicketButton] Error sending error reply:`, replyError);
      }
      
      return false;
    }
  }
}

module.exports = new CloseTicketButton();
// buttons/status/reconnectStatus.js - Enhanced for better reconnection
const Button = require('../../templates/Button');

/**
 * Button handler for reconnecting WhatsApp from the status command
 */
class ReconnectStatusButton extends Button {
  constructor() {
    super({
      customId: 'reconnect_status'
    });
  }
  
  /**
   * Execute button action
   * @param {Object} interaction - Discord interaction
   * @param {Object} instance - Server instance
   */
  async execute(interaction, instance) {
    try {
      // Defer update to prevent interaction timeout
      await interaction.deferUpdate();
      
      // Get the instance manager
      const InstanceManager = require('../../core/InstanceManager');
      
      // Get the instance if not provided
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }
      
      // Check if instance exists
      if (!instance) {
        await interaction.editReply({
          content: '❌ No WhatsApp connection configured for this server. Please use `/setup` to configure.',
          components: []
        });
        return;
      }
      
      // Update UI to show progress
      await interaction.editReply({
        content: '🔄 Checking connection status...',
        components: [],
        embeds: []
      });
      
      // Check if already connected
      if (instance.isConnected && instance.isConnected()) {
        await interaction.editReply({
          content: '✅ WhatsApp is already connected! Loading current status...'
        });
        
        // Load status command to show current status
        const statusCommand = require('../../commands/status');
        if (statusCommand && typeof statusCommand.execute === 'function') {
          await statusCommand.execute(interaction, instance);
        } else {
          await interaction.editReply({
            content: '✅ WhatsApp is connected and ready to use.'
          });
        }
        return;
      }
      
      // Try to reconnect automatically without QR code first
      await interaction.editReply({
        content: '🔄 Attempting to reconnect automatically...'
      });
      
      // First check if authenticated
      let isAuthenticated = false;
      if (instance.clients?.whatsAppClient?.isAuthenticated) {
        try {
          isAuthenticated = await instance.clients.whatsAppClient.isAuthenticated();
        } catch (authError) {
          console.error(`Error checking authentication status:`, authError);
        }
      }
      
      if (isAuthenticated) {
        // Try to restore session
        let restored = false;
        
        if (instance.clients?.whatsAppClient?.restoreSession) {
          try {
            await interaction.editReply({
              content: '🔄 Authentication data found. Attempting to restore session...'
            });
            
            restored = await instance.clients.whatsAppClient.restoreSession();
            
            if (restored) {
              await interaction.editReply({
                content: '✅ Session restored successfully! Loading status...'
              });
              
              // Show status
              const statusCommand = require('../../commands/status');
              if (statusCommand && typeof statusCommand.execute === 'function') {
                await statusCommand.execute(interaction, instance);
              }
              return;
            }
          } catch (restoreError) {
            console.error(`Error restoring session:`, restoreError);
          }
        }
        
        // Try normal connect if restore failed
        try {
          await interaction.editReply({
            content: '🔄 Session restore failed. Trying normal connection...'
          });
          
          const connected = await instance.connect(false);
          
          if (connected && instance.isConnected()) {
            await interaction.editReply({
              content: '✅ Connection restored successfully! Loading status...'
            });
            
            // Show status
            const statusCommand = require('../../commands/status');
            if (statusCommand && typeof statusCommand.execute === 'function') {
              await statusCommand.execute(interaction, instance);
            }
            return;
          }
        } catch (connectError) {
          console.error(`Error connecting:`, connectError);
        }
      }
      
      // If we reach here, we couldn't reconnect automatically
      // Try using the QR code utils for a more robust reconnection
      try {
        const { handleReconnect } = require('../../utils/qrCodeUtils');
        
        // Call the robust reconnect handler
        await handleReconnect(interaction, instance, {
          fromStatus: true,
          timeoutDuration: 120000 // 2 minutes
        });
      } catch (qrError) {
        console.error(`Error during QR reconnect:`, qrError);
        
        // If QR code handling failed too, show simplified message with buttons
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('reconnect')
            .setLabel('Try Reconnect')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('setup')
            .setLabel('Run Setup Again')
            .setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.editReply({
          content: '❌ Could not reconnect to WhatsApp. You may need to run setup again.',
          components: [row]
        });
      }
    } catch (error) {
      console.error(`Error executing reconnect button:`, error);
      
      try {
        await interaction.editReply({
          content: `❌ Error reconnecting: ${error.message}`
        });
      } catch (replyError) {
        console.error(`Error sending error message:`, replyError);
      }
    }
  }
}

module.exports = new ReconnectStatusButton();
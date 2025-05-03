// commands/refreshConnection.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Command = require('../templates/Command');
const InstanceManager = require('../core/InstanceManager');
const InteractionTracker = require('../utils/InteractionTracker');

class RefreshConnectionCommand extends Command {
  constructor() {
    super({
      name: 'refresh-connection',
      description: 'Developer command to refresh WhatsApp connection without QR scan',
      permissions: PermissionFlagsBits.Administrator
    });
    
    // Developer server ID - replace with your actual developer server ID
    this.developerGuildId = process.env.DEVELOPER_GUILD_ID || '693183257998524496';
  }
  
  async execute(interaction, instance) {
    try {
      // Use InteractionTracker to safely handle the interaction
      // This will avoid the "already replied" error
      if (!interaction.deferred && !interaction.replied) {
        await InteractionTracker.safeDefer(interaction);
      }

      // Check if we're in the developer guild - if not, only the admin who added the bot can use this
      const isDeveloperGuild = interaction.guildId === this.developerGuildId;
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
      
      if (!isDeveloperGuild && !isAdmin) {
        await InteractionTracker.safeEdit(interaction, {
          content: "❌ This command can only be used by administrators.",
        });
        return;
      }

      // Get ALL instances from InstanceManager
      const allInstances = Array.from(InstanceManager.instances.values());
      
      if (allInstances.length === 0) {
        await InteractionTracker.safeEdit(interaction, {
          content: "❌ No WhatsApp instances found to refresh."
        });
        return;
      }
      
      // Send initial status message
      await InteractionTracker.safeEdit(interaction, {
        content: `📡 Refreshing ${allInstances.length} WhatsApp connections...\nThis may take a moment.`
      });
      
      // Process them all in parallel with a limit
      const results = [];
      let successCount = 0;
      let failureCount = 0;
      let skippedCount = 0;
      
      // Process in batches of 5 to avoid overwhelming the system
      const batchSize = 5;
      for (let i = 0; i < allInstances.length; i += batchSize) {
        const batch = allInstances.slice(i, i + batchSize);
        
        // Process this batch in parallel
        const batchPromises = batch.map(async (inst) => {
          try {
            // Skip if instance is already reconnecting
            if (inst.reconnecting) {
              results.push(`⏳ Instance ${inst.instanceId} (Guild: ${inst.guildId}) is already reconnecting, skipped.`);
              skippedCount++;
              return;
            }
            
            // Check connection status
            const wasConnected = inst.isConnected();
            let needsRefresh = false;
            
            // If connected, verify it's a working connection
            if (wasConnected) {
              const isWorkingConnection = await this.verifyActiveConnection(inst);
              needsRefresh = !isWorkingConnection;
              
              if (!needsRefresh) {
                results.push(`✓ Instance ${inst.instanceId} (Guild: ${inst.guildId}) is already properly connected.`);
                skippedCount++;
                return;
              }
            } else {
              needsRefresh = true;
            }
            
            // Refresh the connection
            const refreshed = await this.forceReconnect(inst);
            
            if (refreshed) {
              results.push(`✅ Refreshed instance ${inst.instanceId} (Guild: ${inst.guildId}) successfully.`);
              successCount++;
            } else {
              results.push(`❌ Failed to refresh instance ${inst.instanceId} (Guild: ${inst.guildId}).`);
              failureCount++;
            }
          } catch (instError) {
            console.error(`Error refreshing instance ${inst.instanceId}:`, instError);
            results.push(`❌ Error refreshing instance ${inst.instanceId} (Guild: ${inst.guildId}): ${instError.message}`);
            failureCount++;
          }
        });
        
        // Wait for this batch to complete
        await Promise.all(batchPromises);
        
        // Update the status message after each batch
        const progressMessage = 
          `📡 Refreshing WhatsApp connections: ${i + batch.length}/${allInstances.length} processed\n` +
          `✅ Success: ${successCount} | ❌ Failed: ${failureCount} | ⏭️ Skipped: ${skippedCount}`;
        
        await InteractionTracker.safeEdit(interaction, {
          content: progressMessage
        });
      }
      
      // Sort results: successes first, then skipped, then failures
      results.sort((a, b) => {
        if (a.startsWith('✅') && !b.startsWith('✅')) return -1;
        if (!a.startsWith('✅') && b.startsWith('✅')) return 1;
        if (a.startsWith('✓') && !b.startsWith('✓')) return -1;
        if (!a.startsWith('✓') && b.startsWith('✓')) return 1;
        return 0;
      });
      
      // Final report
      const finalMessage = 
        `# WhatsApp Connection Refresh Results\n` +
        `**Total Instances:** ${allInstances.length}\n` +
        `**✅ Successfully Refreshed:** ${successCount}\n` +
        `**⏭️ Already Working:** ${skippedCount}\n` +
        `**❌ Failed:** ${failureCount}\n\n` +
        `## Detailed Results\n` +
        `${results.join('\n')}`;
      
      // Send final report, splitting if needed due to Discord length limits
      if (finalMessage.length <= 2000) {
        await InteractionTracker.safeEdit(interaction, {
          content: finalMessage
        });
      } else {
        // Send summary first
        await InteractionTracker.safeEdit(interaction, {
          content: `# WhatsApp Connection Refresh Results\n` +
                  `**Total Instances:** ${allInstances.length}\n` +
                  `**✅ Successfully Refreshed:** ${successCount}\n` +
                  `**⏭️ Already Working:** ${skippedCount}\n` +
                  `**❌ Failed:** ${failureCount}\n\n` +
                  `Detailed results are too long to display. Here are the first 10 results:`
        });
        
        // Send results in chunks
        const chunkSize = 10;
        for (let i = 0; i < results.length; i += chunkSize) {
          const chunk = results.slice(i, i + chunkSize);
          await interaction.followUp({
            content: `## Results ${i + 1} - ${Math.min(i + chunkSize, results.length)}\n${chunk.join('\n')}`,
            ephemeral: true
          });
        }
      }
    } catch (error) {
      console.error(`Error in refresh-connection command:`, error);
      await InteractionTracker.safeEdit(interaction, {
        content: `❌ Error refreshing WhatsApp connections: ${error.message}`
      });
    }
  }
  
  /**
   * Verify if the connection is truly active by checking client state
   * @param {Object} instance - The instance to check
   * @returns {Promise<boolean>} - Whether the connection is truly active
   */
  async verifyActiveConnection(instance) {
    try {
      if (!instance.clients || !instance.clients.whatsAppClient) {
        return false;
      }
      
      const client = instance.clients.whatsAppClient;
      
      // Method 1: Check if WhatsApp client can get connection state
      if (typeof client.isConnected === 'function') {
        return await client.isConnected();
      }
      
      // Method 2: Check for socket existence and readiness
      if (client.sock && client.sock.ws) {
        // Check socket connection state
        return client.sock.ws.readyState === 1; // WebSocket.OPEN
      }
      
      // Method 3: Check if client indicates it's ready
      if (typeof client.isReady === 'function') {
        return client.isReady();
      } else if (typeof client.isReady === 'boolean') {
        return client.isReady;
      }
      
      // If we can't verify, assume it's not connected properly
      return false;
    } catch (error) {
      console.error(`Error verifying connection for instance ${instance.instanceId}:`, error);
      return false;
    }
  }
  
  /**
   * Force a reconnection without QR code by using existing credentials
   * @param {Object} instance - The instance to reconnect
   * @returns {Promise<boolean>} - Success status
   */
  async forceReconnect(instance) {
    try {
      console.log(`[RefreshConnection] Forcing reconnection for instance ${instance.instanceId}`);
      
      // First try to disconnect cleanly but maintain auth
      if (instance.disconnect) {
        await instance.disconnect(false); // false = don't log out/don't remove auth
      }
      
      // Set flag to avoid showing QR code
      if (instance.clients && instance.clients.whatsAppClient) {
        if (typeof instance.clients.whatsAppClient.setShowQrCode === 'function') {
          instance.clients.whatsAppClient.setShowQrCode(false);
        }
      }
      
      // Wait a bit before reconnecting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try to restore session first
      let reconnected = false;
      
      // Try method 1: Use restoreSession if available
      try {
        if (instance.clients && 
            instance.clients.whatsAppClient && 
            typeof instance.clients.whatsAppClient.restoreSession === 'function') {
          
          console.log(`[RefreshConnection] Attempting to restore session for ${instance.instanceId}`);
          reconnected = await instance.clients.whatsAppClient.restoreSession();
          
          if (reconnected) {
            console.log(`[RefreshConnection] Successfully restored session for ${instance.instanceId}`);
            return true;
          }
        }
      } catch (restoreError) {
        console.error(`[RefreshConnection] Error restoring session:`, restoreError);
      }
      
      // Method 2: Use connect with showQrCode=false
      try {
        console.log(`[RefreshConnection] Attempting to connect with existing credentials for ${instance.instanceId}`);
        reconnected = await instance.connect(false);
        
        if (reconnected) {
          console.log(`[RefreshConnection] Successfully reconnected instance ${instance.instanceId}`);
          return true;
        }
      } catch (connectError) {
        console.error(`[RefreshConnection] Error connecting:`, connectError);
      }
      
      // Method 3: Force reinitialize client as a last resort
      try {
        console.log(`[RefreshConnection] Reinitializing client for ${instance.instanceId}`);
        
        if (instance.clients && instance.clients.whatsAppClient) {
          await instance.clients.whatsAppClient.initialize(false);
          
          // Check if we're connected now
          if (instance.isConnected && instance.isConnected()) {
            console.log(`[RefreshConnection] Successfully reinitialized client for ${instance.instanceId}`);
            return true;
          }
        }
      } catch (initError) {
        console.error(`[RefreshConnection] Error reinitializing client:`, initError);
      }
      
      return false;
    } catch (error) {
      console.error(`[RefreshConnection] Error forcing reconnection:`, error);
      return false;
    }
  }
}

module.exports = new RefreshConnectionCommand();
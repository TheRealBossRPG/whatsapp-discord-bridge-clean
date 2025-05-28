const { PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const Command = require('../templates/Command');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const InteractionTracker = require('../utils/InteractionTracker');

class VouchMediaCommand extends Command {
  constructor() {
    super({
      name: 'vouch-media',
      description: 'Upload a GIF, image, or video to use with vouch instructions',
      permissions: PermissionFlagsBits.ManageGuild,
      options: [
        {
          type: 'attachment',
          name: 'media',
          description: 'The GIF, image, or video file to use for vouch instructions',
          required: true
        }
      ]
    });
  }

  async execute(interaction, instance) {
    try {
      // Defer the reply
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // Get the attachment
      const attachment = interaction.options.getAttachment('media');
      
      if (!attachment) {
        await interaction.editReply({
          content: '❌ Please provide a media file (GIF, image, or video).'
        });
        return;
      }

      // Validate file type
      const allowedTypes = ['image/gif', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'video/mp4', 'video/webm'];
      const contentType = attachment.contentType?.toLowerCase() || '';
      
      // Check if it's an allowed type
      let isAllowed = false;
      for (const type of allowedTypes) {
        if (contentType.includes(type)) {
          isAllowed = true;
          break;
        }
      }
      
      // Also check file extension
      const allowedExtensions = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm'];
      const hasAllowedExtension = allowedExtensions.some(ext => 
        attachment.name.toLowerCase().endsWith(ext)
      );
      
      if (!isAllowed && !hasAllowedExtension) {
        await interaction.editReply({
          content: '❌ Invalid file type. Please upload a GIF, image (PNG/JPG/WebP), or video (MP4/WebM).'
        });
        return;
      }

      // Check file size (Discord's limit is 25MB, but let's be reasonable)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (attachment.size > maxSize) {
        await interaction.editReply({
          content: '❌ File is too large. Please upload a file smaller than 10MB.'
        });
        return;
      }

      // Get instance - handle both provided instance and finding it
      if (!instance) {
        // Try getting from InstanceManager
        const InstanceManager = require('../core/InstanceManager');
        instance = InstanceManager.getInstanceByGuildId(interaction.guildId);
        
        if (!instance) {
          // Try to find instance from route map as fallback
          if (interaction.client._instanceRoutes) {
            for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
              if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
                instance = routeInfo.instance;
                break;
              }
            }
          }
        }
        
        if (!instance) {
          await interaction.editReply({
            content: '❌ WhatsApp bridge is not set up for this server. Please use `/setup` first.'
          });
          return;
        }
      }

      // Determine the assets directory
      const instanceId = instance.instanceId || interaction.guildId;
      const assetsDir = path.join(__dirname, '..', 'instances', instanceId, 'assets');
      
      // Create assets directory if it doesn't exist
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }

      // Download the file
      try {
        const response = await axios({
          method: 'GET',
          url: attachment.url,
          responseType: 'arraybuffer'
        });

        // Determine filename based on type
        let filename = 'vouch';
        if (attachment.name.toLowerCase().endsWith('.gif')) {
          filename = 'vouch.gif';
        } else if (attachment.name.toLowerCase().endsWith('.mp4')) {
          filename = 'vouch.mp4';
        } else if (attachment.name.toLowerCase().endsWith('.webm')) {
          filename = 'vouch.webm';
        } else if (attachment.name.toLowerCase().includes('.png')) {
          filename = 'vouch.png';
        } else if (attachment.name.toLowerCase().includes('.jpg') || attachment.name.toLowerCase().includes('.jpeg')) {
          filename = 'vouch.jpg';
        } else if (attachment.name.toLowerCase().includes('.webp')) {
          filename = 'vouch.webp';
        }

        const filePath = path.join(assetsDir, filename);

        // Save the file
        fs.writeFileSync(filePath, Buffer.from(response.data));

        // Send success message with preview
        await interaction.editReply({
          content: `✅ Vouch media uploaded successfully!\n\n**File saved as:** ${filename}\n**Location:** assets folder\n\nThis media will be sent with vouch instructions when agents use the \`!vouch\` command.`,
          files: [new AttachmentBuilder(filePath)]
        });

        console.log(`[VouchMedia] Uploaded vouch media for instance ${instanceId}: ${filename}`);

      } catch (downloadError) {
        console.error('[VouchMedia] Error downloading file:', downloadError);
        await interaction.editReply({
          content: `❌ Error downloading file: ${downloadError.message}`
        });
      }

    } catch (error) {
      console.error('Error in vouch-media command:', error);
      
      // Try to respond with error
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: `❌ Error: ${error.message}`
          });
        } else {
          await interaction.reply({
            content: `❌ Error: ${error.message}`,
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error('Error sending error message:', replyError);
      }
    }
  }
}

module.exports = new VouchMediaCommand();
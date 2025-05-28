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
      // Defer the reply immediately
      await InteractionTracker.safeDefer(interaction, { ephemeral: true });

      // Get the attachment using the correct method for Discord.js
      const attachment = interaction.options.getAttachment('media');
      
      if (!attachment) {
        await InteractionTracker.safeEdit(interaction, {
          content: '❌ Please provide a media file (GIF, image, or video).'
        });
        return;
      }

      console.log(`[VouchMedia] Processing attachment: ${attachment.name}, Type: ${attachment.contentType}, Size: ${attachment.size}`);

      // Validate file type
      const allowedTypes = [
        'image/gif', 
        'image/png', 
        'image/jpeg', 
        'image/jpg', 
        'image/webp', 
        'video/mp4', 
        'video/webm',
        'video/quicktime'
      ];
      
      const contentType = attachment.contentType?.toLowerCase() || '';
      
      // Check if it's an allowed type
      let isAllowed = false;
      for (const type of allowedTypes) {
        if (contentType === type || contentType.startsWith(type)) {
          isAllowed = true;
          break;
        }
      }
      
      // Also check file extension as fallback
      const allowedExtensions = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov'];
      const hasAllowedExtension = allowedExtensions.some(ext => 
        attachment.name.toLowerCase().endsWith(ext)
      );
      
      if (!isAllowed && !hasAllowedExtension) {
        await InteractionTracker.safeEdit(interaction, {
          content: '❌ Invalid file type. Please upload a GIF, image (PNG/JPG/WebP), or video (MP4/WebM/MOV).\n\n' +
                  `Detected type: ${contentType || 'unknown'}\n` +
                  `File name: ${attachment.name}`
        });
        return;
      }

      // Check file size (Discord's limit is 25MB for bots, but let's be reasonable)
      const maxSize = 15 * 1024 * 1024; // 15MB
      if (attachment.size > maxSize) {
        await InteractionTracker.safeEdit(interaction, {
          content: `❌ File is too large (${Math.round(attachment.size / 1024 / 1024)}MB). Please upload a file smaller than 15MB.`
        });
        return;
      }

      // Get instance
      if (!instance) {
        const InstanceManager = require('../core/InstanceManager');
        instance = InstanceManager.getInstanceByGuildId(interaction.guildId);
        
        if (!instance) {
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
          await InteractionTracker.safeEdit(interaction, {
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
        console.log(`[VouchMedia] Created assets directory: ${assetsDir}`);
      }

      // Update user about download progress
      await InteractionTracker.safeEdit(interaction, {
        content: '⏳ Downloading and processing your media file...'
      });

      // Download the file
      try {
        console.log(`[VouchMedia] Downloading from URL: ${attachment.url}`);
        
        const response = await axios({
          method: 'GET',
          url: attachment.url,
          responseType: 'arraybuffer',
          timeout: 30000, // 30 second timeout
          headers: {
            'User-Agent': 'DiscordBot'
          }
        });

        console.log(`[VouchMedia] Downloaded ${response.data.byteLength} bytes`);

        // FIXED: Determine filename based on original extension and preserve it correctly
        const originalExt = path.extname(attachment.name).toLowerCase();
        let filename = 'vouch';
        
        // CRITICAL FIX: Preserve the actual file type correctly
        if (originalExt === '.gif') {
          filename = 'vouch.gif';
        } else if (originalExt === '.png') {
          filename = 'vouch.png';
        } else if (['.jpg', '.jpeg'].includes(originalExt)) {
          filename = 'vouch.jpg';
        } else if (originalExt === '.webp') {
          filename = 'vouch.webp';
        } else if (originalExt === '.mp4') {
          filename = 'vouch.mp4';
        } else if (originalExt === '.webm') {
          filename = 'vouch.webm';
        } else if (originalExt === '.mov') {
          filename = 'vouch.mov';
        } else {
          // Fallback based on content type - preserve original format
          if (contentType.includes('gif')) {
            filename = 'vouch.gif';
          } else if (contentType.includes('png')) {
            filename = 'vouch.png';
          } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
            filename = 'vouch.jpg';
          } else if (contentType.includes('webp')) {
            filename = 'vouch.webp';
          } else if (contentType.includes('mp4')) {
            filename = 'vouch.mp4';
          } else if (contentType.includes('webm')) {
            filename = 'vouch.webm';
          } else if (contentType.includes('quicktime')) {
            filename = 'vouch.mov';
          } else {
            // Default but try to preserve original extension if it's valid
            if (allowedExtensions.includes(originalExt)) {
              filename = `vouch${originalExt}`;
            } else {
              filename = 'vouch.mp4'; // Ultimate fallback
            }
          }
        }

        const filePath = path.join(assetsDir, filename);

        // Remove any existing vouch media files first to avoid conflicts
        const existingFiles = ['vouch.gif', 'vouch.mp4', 'vouch.webm', 'vouch.mov', 'vouch.png', 'vouch.jpg', 'vouch.jpeg', 'vouch.webp'];
        for (const existingFile of existingFiles) {
          const existingPath = path.join(assetsDir, existingFile);
          if (fs.existsSync(existingPath)) {
            try {
              fs.unlinkSync(existingPath);
              console.log(`[VouchMedia] Removed existing file: ${existingFile}`);
            } catch (removeError) {
              console.error(`[VouchMedia] Error removing existing file:`, removeError);
            }
          }
        }

        // Save the new file with the correct extension
        fs.writeFileSync(filePath, Buffer.from(response.data));
        console.log(`[VouchMedia] Saved file to: ${filePath}`);

        // Verify file was saved correctly
        if (!fs.existsSync(filePath)) {
          throw new Error('File was not saved correctly');
        }

        const savedSize = fs.statSync(filePath).size;
        console.log(`[VouchMedia] Verified saved file size: ${savedSize} bytes`);

        // Determine file type for display
        let fileTypeDisplay = 'media';
        if (filename.endsWith('.gif')) {
          fileTypeDisplay = 'GIF';
        } else if (['.png', '.jpg', '.jpeg', '.webp'].some(ext => filename.endsWith(ext))) {
          fileTypeDisplay = 'image';
        } else if (['.mp4', '.webm', '.mov'].some(ext => filename.endsWith(ext))) {
          fileTypeDisplay = 'video';
        }

        // Send success message with preview
        await InteractionTracker.safeEdit(interaction, {
          content: `✅ **Vouch ${fileTypeDisplay} uploaded successfully!**\n\n` +
                  `📁 **File saved as:** ${filename}\n` +
                  `📂 **Location:** Instance assets folder\n` +
                  `📏 **Size:** ${Math.round(savedSize / 1024)}KB\n\n` +
                  `This ${fileTypeDisplay} will be sent with vouch instructions when agents use the \`!vouch\` command.`,
          files: [new AttachmentBuilder(filePath, { name: filename })]
        });

        console.log(`[VouchMedia] Successfully uploaded vouch media for instance ${instanceId}: ${filename}`);

      } catch (downloadError) {
        console.error('[VouchMedia] Error downloading file:', downloadError);
        
        let errorMessage = `❌ Error downloading file: ${downloadError.message}`;
        
        if (downloadError.code === 'ECONNABORTED') {
          errorMessage = '❌ Download timed out. The file might be too large or the connection is slow.';
        } else if (downloadError.response?.status) {
          errorMessage = `❌ Download failed with HTTP ${downloadError.response.status}. The file URL might be invalid.`;
        }
        
        await InteractionTracker.safeEdit(interaction, {
          content: errorMessage
        });
      }

    } catch (error) {
      console.error('Error in vouch-media command:', error);
      
      // Try to respond with error
      try {
        await InteractionTracker.safeEdit(interaction, {
          content: `❌ Unexpected error: ${error.message}\n\nPlease try again or contact support if the issue persists.`
        });
      } catch (replyError) {
        console.error('Error sending error message:', replyError);
      }
    }
  }
}

module.exports = new VouchMediaCommand();
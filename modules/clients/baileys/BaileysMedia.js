// modules/clients/baileys/BaileysMedia.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

class BaileysMedia {
  constructor(client) {
    this.client = client;
  }
  
  // Check if FFmpeg is installed
  async checkFfmpeg() {
    return new Promise((resolve) => {
      exec('ffmpeg -version', (error) => {
        if (error) {
          console.error(`[BaileysMedia:${this.client.instanceId}] FFmpeg is not installed or not in PATH`);
          resolve(false);
          return;
        }
        console.log(`[BaileysMedia:${this.client.instanceId}] FFmpeg is installed and available`);
        resolve(true);
      });
    });
  }
  
  // Convert GIF to MP4 using FFmpeg
  async convertGifToMp4(gifInput) {
    try {
      let gifPath;
      let needToCleanup = false;
      
      // Handle buffer input
      if (Buffer.isBuffer(gifInput)) {
        gifPath = path.join(this.client.tempDir, `baileys_gif_${Date.now()}.gif`);
        fs.writeFileSync(gifPath, gifInput);
        needToCleanup = true;
      } else {
        gifPath = gifInput;
      }
      
      const outputPath = path.join(
        this.client.tempDir,
        `baileys_mp4_${Date.now()}.mp4`
      );
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Converting GIF to MP4: ${gifPath} -> ${outputPath}`);
      
      // Using exact command from working test
      return new Promise((resolve, reject) => {
        const command = `ffmpeg -i "${gifPath}" -movflags faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -b:v 1M -maxrate 1M -bufsize 1M -an "${outputPath}"`;
        
        exec(command, (error, stdout, stderr) => {
          // Clean up the input if we created it
          if (needToCleanup) {
            try { fs.unlinkSync(gifPath); } catch (e) { /* ignore */ }
          }
          
          if (error) {
            console.error(`[BaileysMedia:${this.client.instanceId}] FFmpeg error:`, error);
            reject(error);
            return;
          }
          
          console.log(`[BaileysMedia:${this.client.instanceId}] GIF to MP4 conversion complete: ${outputPath}`);
          resolve(outputPath);
        });
      });
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error in convertGifToMp4:`, error);
      throw error;
    }
  }
  
  // Send a GIF
  async sendGif(recipient, gifInput, caption = '') {
    try {
      console.log(`[BaileysMedia:${this.client.instanceId}] Preparing to send GIF to ${recipient}...`);
      
      // Ensure initialized
      if (!this.client.isReady) {
        console.log(`[BaileysMedia:${this.client.instanceId}] Client not ready, initializing...`);
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client.message.formatJid(recipient);
      
      // Convert GIF to MP4
      const mp4Path = await this.convertGifToMp4(gifInput);
      
      // Send as GIF
      const result = await this.client.auth.sock.sendMessage(jid, {
        video: fs.readFileSync(mp4Path),
        caption: caption || undefined,
        gifPlayback: true
      });
      
      // Clean up
      try {
        fs.unlinkSync(mp4Path);
      } catch (e) {
        console.error(`[BaileysMedia:${this.client.instanceId}] Error cleaning up temp file:`, e);
      }
      
      console.log(`[BaileysMedia:${this.client.instanceId}] GIF sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error sending GIF:`, error);
      throw error;
    }
  }
  
  // Send a video
  async sendVideo(recipient, videoPath, caption = '') {
    try {
      // Ensure initialized
      if (!this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client.message.formatJid(recipient);
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Sending video to ${jid}...`);
      
      // Send as video
      const result = await this.client.auth.sock.sendMessage(jid, {
        video: fs.readFileSync(videoPath),
        caption: caption || undefined,
      });
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Video sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error sending video:`, error);
      throw error;
    }
  }
  
  // Send a document
  async sendDocument(recipient, documentPath, filename, caption = '') {
    try {
      // Ensure initialized
      if (!this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client.message.formatJid(recipient);
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Sending document to ${jid}...`);
      
      // Handle buffer or file path
      let documentBuffer;
      if (Buffer.isBuffer(documentPath)) {
        documentBuffer = documentPath;
      } else {
        documentBuffer = fs.readFileSync(documentPath);
      }
      
      // Determine mimetype based on extension
      const ext = path.extname(filename).toLowerCase();
      let mimetype = 'application/octet-stream';
      
      // Set mimetype based on extension
      if (ext === '.pdf') mimetype = 'application/pdf';
      else if (ext === '.doc' || ext === '.docx') mimetype = 'application/msword';
      else if (ext === '.xls' || ext === '.xlsx') mimetype = 'application/vnd.ms-excel';
      else if (ext === '.ppt' || ext === '.pptx') mimetype = 'application/vnd.ms-powerpoint';
      else if (ext === '.txt') mimetype = 'text/plain';
      else if (ext === '.zip') mimetype = 'application/zip';
      else if (ext === '.rar') mimetype = 'application/x-rar-compressed';
      
      // Send document
      const result = await this.client.auth.sock.sendMessage(jid, {
        document: documentBuffer,
        mimetype: mimetype,
        fileName: filename,
        caption: caption || undefined
      });
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Document sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error sending document:`, error);
      throw error;
    }
  }
  
  // Download media from a message
  async downloadMedia(chatId, messageId, messageObj = null) {
    try {
      console.log(`[BaileysMedia:${this.client.instanceId}] Downloading media from chat ${chatId}, message ${messageId}`);
      
      // Ensure initialized
      if (!this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format chat ID
      const jid = this.client.message.formatJid(chatId);
      
      // Get message object
      let msg = messageObj;
      
      if (!msg) {
        // Try to get from message store
        msg = this.client.message.getStoredMessage(jid, messageId);
        
        if (!msg) {
          try {
            // Try to fetch message
            const msgs = await this.client.auth.sock.fetchMessages(jid, { limit: 10 });
            if (Array.isArray(msgs) && msgs.length > 0) {
              msg = msgs.find(m => m.key.id === messageId);
            }
          } catch (fetchError) {
            console.error(`[BaileysMedia:${this.client.instanceId}] Error fetching messages:`, fetchError);
          }
        }
      }
      
      if (!msg) {
        throw new Error(`Message ${messageId} not found in chat ${jid}`);
      }
      
      // Download media
      console.log(`[BaileysMedia:${this.client.instanceId}] Found message, downloading media...`);
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { 
          logger: this.client.logger,
          reuploadRequest: this.client.auth.sock.updateMediaMessage
        }
      );
      
      if (!buffer || buffer.length === 0) {
        throw new Error('Downloaded buffer is empty');
      }
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Successfully downloaded ${buffer.length} bytes of media`);
      return buffer;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error downloading media:`, error);
      throw error;
    }
  }
  
  // Create media object from buffer
  createMediaFromBuffer(buffer, mimetype, filename) {
    return {
      data: buffer.toString('base64'),
      mimetype: mimetype,
      filename: filename
    };
  }
}

module.exports = BaileysMedia;
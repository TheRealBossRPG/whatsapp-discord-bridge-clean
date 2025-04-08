// modules/clients/baileys/BaileysMedia.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');

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
  
  // Download media from URL to a local file
  async downloadMediaFromUrl(url, filename) {
    try {
      console.log(`[BaileysMedia:${this.client.instanceId}] Downloading media from URL: ${url}`);
      
      // Generate temporary filename if not provided
      if (!filename) {
        const urlParts = url.split('/');
        filename = urlParts[urlParts.length - 1].split('?')[0];
      }
      
      // Create a file path in the temp directory
      const tempPath = path.join(this.client.tempDir, `dl_${Date.now()}_${filename}`);
      
      // Download the file
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer'
      });
      
      // Write the file to disk
      fs.writeFileSync(tempPath, Buffer.from(response.data));
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Media downloaded to: ${tempPath}`);
      return {
        path: tempPath,
        data: Buffer.from(response.data),
        mimetype: response.headers['content-type']
      };
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error downloading media from URL:`, error);
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
      const jid = this.client.formatJid ? 
                 this.client.formatJid(recipient) : 
                 (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      // If the input is a URL, download it first
      if (typeof gifInput === 'string' && (gifInput.startsWith('http://') || gifInput.startsWith('https://'))) {
        const downloadedMedia = await this.downloadMediaFromUrl(gifInput, 'input.gif');
        gifInput = downloadedMedia.path;
      }
      
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
  
  // Send a sticker
  async sendSticker(recipient, stickerInput) {
    try {
      console.log(`[BaileysMedia:${this.client.instanceId}] Preparing to send sticker to ${recipient}...`);
      
      // Ensure initialized
      if (!this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client.formatJid ? 
                this.client.formatJid(recipient) : 
                (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      // If the input is a URL, download it first
      let stickerBuffer;
      if (typeof stickerInput === 'string' && (stickerInput.startsWith('http://') || stickerInput.startsWith('https://'))) {
        const downloadedMedia = await this.downloadMediaFromUrl(stickerInput);
        stickerBuffer = downloadedMedia.data;
      } else if (Buffer.isBuffer(stickerInput)) {
        stickerBuffer = stickerInput;
      } else if (typeof stickerInput === 'string' && fs.existsSync(stickerInput)) {
        stickerBuffer = fs.readFileSync(stickerInput);
      } else {
        throw new Error('Invalid sticker input type');
      }
      
      // Send as sticker
      const result = await this.client.auth.sock.sendMessage(jid, {
        sticker: stickerBuffer
      });
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Sticker sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error sending sticker:`, error);
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
      const jid = this.client.formatJid ? 
                this.client.formatJid(recipient) : 
                (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Sending video to ${jid}...`);
      
      // If the input is a URL, download it first
      let videoBuffer;
      if (typeof videoPath === 'string' && (videoPath.startsWith('http://') || videoPath.startsWith('https://'))) {
        const downloadedMedia = await this.downloadMediaFromUrl(videoPath);
        videoBuffer = downloadedMedia.data;
      } else if (Buffer.isBuffer(videoPath)) {
        videoBuffer = videoPath;
      } else if (typeof videoPath === 'string' && fs.existsSync(videoPath)) {
        videoBuffer = fs.readFileSync(videoPath);
      } else {
        throw new Error('Invalid video input type');
      }
      
      // Send as video
      const result = await this.client.auth.sock.sendMessage(jid, {
        video: videoBuffer,
        caption: caption || undefined,
      });
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Video sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error sending video:`, error);
      throw error;
    }
  }
  
  // Send an audio message
  async sendAudio(recipient, audioPath, isVoiceNote = false) {
    try {
      // Ensure initialized
      if (!this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client.formatJid ? 
                this.client.formatJid(recipient) : 
                (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Sending audio to ${jid}...`);
      
      // If the input is a URL, download it first
      let audioBuffer;
      if (typeof audioPath === 'string' && (audioPath.startsWith('http://') || audioPath.startsWith('https://'))) {
        const downloadedMedia = await this.downloadMediaFromUrl(audioPath);
        audioBuffer = downloadedMedia.data;
      } else if (Buffer.isBuffer(audioPath)) {
        audioBuffer = audioPath;
      } else if (typeof audioPath === 'string' && fs.existsSync(audioPath)) {
        audioBuffer = fs.readFileSync(audioPath);
      } else {
        throw new Error('Invalid audio input type');
      }
      
      // Send as audio or voice note
      const result = await this.client.auth.sock.sendMessage(jid, {
        audio: audioBuffer,
        mimetype: 'audio/mp4',
        ptt: isVoiceNote // Set to true for voice note, false for audio file
      });
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Audio sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error sending audio:`, error);
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
      const jid = this.client.formatJid ? 
                this.client.formatJid(recipient) : 
                (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      console.log(`[BaileysMedia:${this.client.instanceId}] Sending document to ${jid}...`);
      
      // Handle various input types
      let documentBuffer;
      if (typeof documentPath === 'string' && (documentPath.startsWith('http://') || documentPath.startsWith('https://'))) {
        const downloadedMedia = await this.downloadMediaFromUrl(documentPath);
        documentBuffer = downloadedMedia.data;
        
        // Use the downloaded file's content type if available
        if (!filename) {
          const urlParts = documentPath.split('/');
          filename = urlParts[urlParts.length - 1].split('?')[0];
        }
      } else if (Buffer.isBuffer(documentPath)) {
        documentBuffer = documentPath;
      } else if (typeof documentPath === 'string' && fs.existsSync(documentPath)) {
        documentBuffer = fs.readFileSync(documentPath);
        
        // Use the file's name if filename not provided
        if (!filename) {
          filename = path.basename(documentPath);
        }
      } else {
        throw new Error('Invalid document input type');
      }
      
      // Default filename if none provided
      if (!filename) {
        filename = `document_${Date.now()}.pdf`;
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
  
  // Send media from URL
  async sendMediaFromUrl(recipient, url, mediaType = 'auto', filename = null, caption = '') {
    try {
      console.log(`[BaileysMedia:${this.client.instanceId}] Sending media from URL: ${url}`);
      
      // Download the media from the URL
      const downloadedMedia = await this.downloadMediaFromUrl(url, filename);
      
      // Determine media type if set to auto
      let detectedType = mediaType.toLowerCase();
      if (detectedType === 'auto') {
        const contentType = downloadedMedia.mimetype || '';
        if (contentType.startsWith('image/')) {
          if (contentType === 'image/gif') {
            detectedType = 'gif';
          } else {
            detectedType = 'image';
          }
        } else if (contentType.startsWith('video/')) {
          detectedType = 'video';
        } else if (contentType.startsWith('audio/')) {
          detectedType = 'audio';
        } else {
          detectedType = 'document';
        }
      }
      
      // Extract filename from URL if not provided
      if (!filename) {
        const urlParts = url.split('/');
        filename = urlParts[urlParts.length - 1].split('?')[0];
      }
      
      // Send based on detected type
      let result;
      switch (detectedType.toLowerCase()) {
        case 'image':
          result = await this.client.auth.sock.sendMessage(
            this.client.formatJid ? this.client.formatJid(recipient) : `${recipient}@s.whatsapp.net`,
            {
              image: downloadedMedia.data,
              caption: caption || undefined,
              mimetype: downloadedMedia.mimetype
            }
          );
          break;
        
        case 'gif':
          result = await this.sendGif(recipient, downloadedMedia.path, caption);
          break;
        
        case 'video':
          result = await this.sendVideo(recipient, downloadedMedia.data, caption);
          break;
        
        case 'audio':
          result = await this.sendAudio(recipient, downloadedMedia.data, false);
          break;
        
        case 'voice':
        case 'ptt':
          result = await this.sendAudio(recipient, downloadedMedia.data, true);
          break;
        
        case 'document':
        default:
          result = await this.sendDocument(recipient, downloadedMedia.data, filename, caption);
          break;
      }
      
      // Clean up the downloaded file
      try {
        fs.unlinkSync(downloadedMedia.path);
      } catch (e) {
        console.error(`[BaileysMedia:${this.client.instanceId}] Error cleaning up temp file:`, e);
      }
      
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client.instanceId}] Error sending media from URL:`, error);
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
      const jid = this.client.formatJid ? 
                this.client.formatJid(chatId) : 
                (chatId.includes('@s.whatsapp.net') ? chatId : `${chatId}@s.whatsapp.net`);
      
      // Get message object
      let msg = messageObj;
      
      if (!msg) {
        // Try to get from message store
        if (this.client.message && typeof this.client.message.getStoredMessage === 'function') {
          msg = this.client.message.getStoredMessage(jid, messageId);
        }
        
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
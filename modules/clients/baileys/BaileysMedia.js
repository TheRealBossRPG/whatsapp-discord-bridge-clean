// modules/clients/baileys/BaileysMedia.js - FIXED version
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
          console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] FFmpeg is not installed or not in PATH`);
          resolve(false);
          return;
        }
        console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] FFmpeg is installed and available`);
        resolve(true);
      });
    });
  }
  
  // Convert GIF to MP4 using FFmpeg
  async convertGifToMp4(gifInput, outputPath = null) {
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
      
      // Create output path if not provided
      if (!outputPath) {
        outputPath = path.join(
          this.client.tempDir,
          `baileys_mp4_${Date.now()}.mp4`
        );
      }
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Converting GIF to MP4: ${gifPath} -> ${outputPath}`);
      
      return new Promise((resolve, reject) => {
        // Use more compatible ffmpeg settings
        const command = `ffmpeg -f gif -i "${gifPath}" -movflags faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -preset fast -c:v libx264 -b:v 1M -maxrate 1M -bufsize 1M -an "${outputPath}"`;
        
        exec(command, (error, stdout, stderr) => {
          // Clean up the input if we created it
          if (needToCleanup) {
            try { fs.unlinkSync(gifPath); } catch (e) { /* ignore */ }
          }
          
          if (error) {
            console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] FFmpeg error:`, error);
            
            // Try a more basic conversion as fallback
            const fallbackCommand = `ffmpeg -i "${gifPath}" -c:v libx264 -f mp4 "${outputPath}"`;
            
            exec(fallbackCommand, (fallbackError, fallbackStdout, fallbackStderr) => {
              if (fallbackError) {
                console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Fallback FFmpeg error:`, fallbackError);
                reject(fallbackError);
                return;
              }
              
              console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] GIF to MP4 fallback conversion complete: ${outputPath}`);
              resolve(outputPath);
            });
            
            return;
          }
          
          console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] GIF to MP4 conversion complete: ${outputPath}`);
          resolve(outputPath);
        });
      });
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error in convertGifToMp4:`, error);
      throw error;
    }
  }
  
  // Download media from URL to a local file
  async downloadMediaFromUrl(url, filename) {
    try {
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Downloading media from URL: ${url}`);
      
      // Generate temporary filename if not provided
      if (!filename) {
        const urlParts = url.split('/');
        filename = urlParts[urlParts.length - 1].split('?')[0];
      }
      
      // Create a file path in the temp directory
      const tempPath = path.join(this.client?.tempDir || './temp', `dl_${Date.now()}_${filename}`);
      
      // Download the file
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer'
      });
      
      // Write the file to disk
      fs.writeFileSync(tempPath, Buffer.from(response.data));
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Media downloaded to: ${tempPath}`);
      return {
        path: tempPath,
        data: Buffer.from(response.data),
        mimetype: response.headers['content-type']
      };
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error downloading media from URL:`, error);
      throw error;
    }
  }
  
  // Send a GIF
  async sendGif(recipient, gifInput, caption = '') {
    try {
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Preparing to send GIF to ${recipient}...`);
      
      // Ensure initialized
      if (this.client && !this.client.isReady) {
        console.log(`[BaileysMedia:${this.client.instanceId}] Client not ready, initializing...`);
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client && this.client.formatJid ? 
                 this.client.formatJid(recipient) : 
                 (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      // If the input is a URL, download it first
      if (typeof gifInput === 'string' && (gifInput.startsWith('http://') || gifInput.startsWith('https://'))) {
        const downloadedMedia = await this.downloadMediaFromUrl(gifInput, 'input.gif');
        gifInput = downloadedMedia.path;
      }
      
      // Check if FFmpeg is installed
      const ffmpegInstalled = await this.checkFfmpeg();
      
      if (!ffmpegInstalled) {
        console.warn(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] FFmpeg not found, sending as regular video`);
        
        // If ffmpeg isn't available, try sending as regular video
        if (Buffer.isBuffer(gifInput)) {
          const gifPath = path.join(this.client?.tempDir || './temp', `baileys_gif_${Date.now()}.gif`);
          fs.writeFileSync(gifPath, gifInput);
          gifInput = gifPath;
        }
        
        // Send as regular video without conversion
        // FIXED: Use socket directly, not auth.sock
        if (!this.client || !this.client.socket) {
          throw new Error('WhatsApp client socket is not available');
        }
        
        const result = await this.client.socket.sendMessage(jid, {
          video: fs.readFileSync(gifInput),
          caption: caption || undefined,
          gifPlayback: true
        });
        
        return result;
      }
      
      // Convert GIF to MP4
      const mp4Path = await this.convertGifToMp4(gifInput);
      
      // Send as GIF with proper attributes
      // FIXED: Use socket directly, not auth.sock
      if (!this.client || !this.client.socket) {
        throw new Error('WhatsApp client socket is not available');
      }
      
      const result = await this.client.socket.sendMessage(jid, {
        video: fs.readFileSync(mp4Path),
        caption: caption || undefined,
        gifPlayback: true,
        jpegThumbnail: await this.generateThumbnail(mp4Path),
        mimetype: 'video/mp4'
      });
      
      // Clean up
      try {
        fs.unlinkSync(mp4Path);
      } catch (e) {
        console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error cleaning up temp file:`, e);
      }
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] GIF sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error sending GIF:`, error);
      throw error;
    }
  }

  async generateThumbnail(videoPath) {
    try {
      const thumbnailPath = path.join(this.client?.tempDir || './temp', `thumb_${Date.now()}.jpg`);
      
      return new Promise((resolve, reject) => {
        exec(`ffmpeg -i "${videoPath}" -ss 0.0 -frames:v 1 "${thumbnailPath}"`, (error) => {
          if (error) {
            console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error generating thumbnail:`, error);
            resolve(null); // Continue without thumbnail
            return;
          }
          
          try {
            const thumbBuffer = fs.readFileSync(thumbnailPath);
            fs.unlinkSync(thumbnailPath); // Clean up
            resolve(thumbBuffer);
          } catch (readError) {
            console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error reading thumbnail:`, readError);
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error in generateThumbnail:`, error);
      return null;
    }
  }
  
  // Send a sticker
  async sendSticker(recipient, stickerInput) {
    try {
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Preparing to send sticker to ${recipient}...`);
      
      // Ensure initialized
      if (this.client && !this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client && this.client.formatJid ? 
                this.client.formatJid(recipient) : 
                (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      // Process different input types
      let stickerBuffer;
      
      // If the input is a URL, download it first
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
      
      // Ensure we have valid sticker data
      if (!stickerBuffer || stickerBuffer.length === 0) {
        throw new Error('Empty sticker data');
      }
      
      // FIXED: Use socket directly, not auth.sock
      if (!this.client || !this.client.socket) {
        throw new Error('WhatsApp client socket is not available');
      }
      
      // Send as sticker
      const result = await this.client.socket.sendMessage(jid, {
        sticker: stickerBuffer,
        mimetype: 'image/webp'
      });
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Sticker sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error sending sticker:`, error);
      throw error;
    }
  }
  
  // Send a video
  async sendVideo(recipient, videoPath, caption = '') {
    try {
      // Ensure initialized
      if (this.client && !this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client && this.client.formatJid ? 
                this.client.formatJid(recipient) : 
                (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Sending video to ${jid}...`);
      
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
      
      // FIXED: Use socket directly, not auth.sock
      if (!this.client || !this.client.socket) {
        throw new Error('WhatsApp client socket is not available');
      }
      
      // Send as video
      const result = await this.client.socket.sendMessage(jid, {
        video: videoBuffer,
        caption: caption || undefined,
      });
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Video sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error sending video:`, error);
      throw error;
    }
  }
  
  // Send an audio message
  async sendAudio(recipient, audioPath, isVoiceNote = false) {
    try {
      // Ensure initialized
      if (this.client && !this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client && this.client.formatJid ? 
                this.client.formatJid(recipient) : 
                (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Sending ${isVoiceNote ? 'voice note' : 'audio'} to ${jid}...`);
      
      // Handle different input types
      let audioBuffer;
      let mimetype = 'audio/mp4';
      
      if (typeof audioPath === 'string' && (audioPath.startsWith('http://') || audioPath.startsWith('https://'))) {
        const downloadedMedia = await this.downloadMediaFromUrl(audioPath);
        audioBuffer = downloadedMedia.data;
        mimetype = downloadedMedia.mimetype || mimetype;
      } else if (Buffer.isBuffer(audioPath)) {
        audioBuffer = audioPath;
      } else if (typeof audioPath === 'string' && fs.existsSync(audioPath)) {
        audioBuffer = fs.readFileSync(audioPath);
        
        // Try to determine mimetype from filename extension
        const ext = path.extname(audioPath).toLowerCase();
        if (ext === '.mp3') mimetype = 'audio/mpeg';
        else if (ext === '.ogg') mimetype = 'audio/ogg';
        else if (ext === '.m4a') mimetype = 'audio/mp4';
        else if (ext === '.wav') mimetype = 'audio/wav';
      } else {
        throw new Error('Invalid audio input type');
      }
      
      // For voice notes (ptt), consider converting to the right format if needed
      if (isVoiceNote) {
        // WhatsApp voice notes typically work better as OGG/OPUS
        if (mimetype !== 'audio/ogg' && await this.checkFfmpeg()) {
          try {
            const tempInput = path.join(this.client?.tempDir || './temp', `voice_in_${Date.now()}`);
            const tempOutput = path.join(this.client?.tempDir || './temp', `voice_out_${Date.now()}.ogg`);
            
            fs.writeFileSync(tempInput, audioBuffer);
            
            await new Promise((resolve, reject) => {
              // Convert to OGG/OPUS - optimal for voice notes
              exec(`ffmpeg -i "${tempInput}" -c:a libopus -b:a 24k "${tempOutput}"`, (error) => {
                if (error) {
                  console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error converting voice note:`, error);
                  resolve(); // Continue with original format
                } else {
                  try {
                    audioBuffer = fs.readFileSync(tempOutput);
                    mimetype = 'audio/ogg; codecs=opus';
                    resolve();
                  } catch (readError) {
                    console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error reading converted voice note:`, readError);
                    resolve(); // Continue with original format
                  }
                }
                
                // Clean up
                try {
                  if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                  if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                } catch (e) { /* ignore */ }
              });
            });
          } catch (convError) {
            console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Voice conversion error:`, convError);
            // Continue with original format
          }
        }
      }
      
      // FIXED: Use socket directly, not auth.sock
      if (!this.client || !this.client.socket) {
        throw new Error('WhatsApp client socket is not available');
      }
      
      // Send the audio or voice note
      const result = await this.client.socket.sendMessage(jid, {
        audio: audioBuffer,
        mimetype: mimetype,
        ptt: isVoiceNote, // This flag makes it a voice note
        seconds: 0, // Baileys will calculate duration if not provided
      });
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] ${isVoiceNote ? 'Voice note' : 'Audio'} sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error sending ${isVoiceNote ? 'voice note' : 'audio'}:`, error);
      throw error;
    }
  }
  
  // Send a document
  async sendDocument(recipient, documentPath, filename, caption = '') {
    try {
      // Ensure initialized
      if (this.client && !this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client && this.client.formatJid ? 
                this.client.formatJid(recipient) : 
                (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Sending document to ${jid}...`);
      
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
      
      // FIXED: Use socket directly, not auth.sock
      if (!this.client || !this.client.socket) {
        throw new Error('WhatsApp client socket is not available');
      }
      
      // Send document
      const result = await this.client.socket.sendMessage(jid, {
        document: documentBuffer,
        mimetype: mimetype,
        fileName: filename,
        caption: caption || undefined
      });
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Document sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error sending document:`, error);
      throw error;
    }
  }
  
  // Send an image
  async sendImage(recipient, imagePath, caption = '') {
    try {
      // Ensure initialized
      if (this.client && !this.client.isReady) {
        const initialized = await this.client.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient
      const jid = this.client && this.client.formatJid ? 
                this.client.formatJid(recipient) : 
                (recipient.includes('@s.whatsapp.net') ? recipient : `${recipient}@s.whatsapp.net`);
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Sending image to ${jid}...`);
      
      // If the input is a URL, download it first
      let imageBuffer;
      let mimetype = 'image/jpeg';
      
      if (typeof imagePath === 'string' && (imagePath.startsWith('http://') || imagePath.startsWith('https://'))) {
        const downloadedMedia = await this.downloadMediaFromUrl(imagePath);
        imageBuffer = downloadedMedia.data;
        mimetype = downloadedMedia.mimetype || mimetype;
      } else if (Buffer.isBuffer(imagePath)) {
        imageBuffer = imagePath;
      } else if (typeof imagePath === 'string' && fs.existsSync(imagePath)) {
        imageBuffer = fs.readFileSync(imagePath);
        
        // Try to determine mimetype from filename extension
        const ext = path.extname(imagePath).toLowerCase();
        if (ext === '.png') mimetype = 'image/png';
        else if (ext === '.jpg' || ext === '.jpeg') mimetype = 'image/jpeg';
        else if (ext === '.webp') mimetype = 'image/webp';
        else if (ext === '.gif') mimetype = 'image/gif';
      } else {
        throw new Error('Invalid image input type');
      }
      
      // FIXED: Use socket directly, not auth.sock
      if (!this.client || !this.client.socket) {
        throw new Error('WhatsApp client socket is not available');
      }
      
      // Send as image
      const result = await this.client.socket.sendMessage(jid, {
        image: imageBuffer,
        mimetype: mimetype,
        caption: caption || undefined,
      });
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Image sent successfully!`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error sending image:`, error);
      throw error;
    }
  }
  
  // Send media from URL
  async sendMediaFromUrl(recipient, url, mediaType = 'auto', filename = null, caption = '') {
    try {
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Sending media from URL: ${url}`);
      
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
      
      // FIXED: Use local methods for each media type
      let result;
      switch (detectedType.toLowerCase()) {
        case 'image':
          result = await this.sendImage(
            recipient,
            downloadedMedia.data,
            caption
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
        console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error cleaning up temp file:`, e);
      }
      
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error sending media from URL:`, error);
      throw error;
    }
  }
  
  // Download media from a message
  async downloadMedia(message, options = {}) {
    try {
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Downloading media from message`);
      
      if (!message) {
        console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] No message provided for media download`);
        return null;
      }
      
      // Make sure we have socket available
      if (!this.client || !this.client.socket) {
        throw new Error('WhatsApp client socket is not available');
      }
      
      // Get the message properly depending on baileys structure
      const downloadableMessage = message.message || message;
      
      // Use the downloadMediaMessage function with proper error handling
      const buffer = await downloadMediaMessage(
        message, 
        'buffer',
        {},
        { 
          logger: this.client.logger,
          reuploadRequest: this.client.socket?.updateMediaMessage || undefined,
          // Add timeouts to prevent hanging
          downloadMediaTimeout: 60000
        }
      );
      
      if (!buffer || buffer.length === 0) {
        console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Downloaded buffer is empty`);
        return null;
      }
      
      // Get media type and metadata
      const mediaType = this.getMediaType(message);
      let mimetype = this.getMimeType(message, mediaType);
      let filename = this.getFilename(message, mediaType, mimetype);
      
      console.log(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Successfully downloaded ${buffer.length} bytes of ${mediaType} media`);
      
      return {
        buffer,
        mediaType,
        mimetype,
        filename,
        size: buffer.length
      };
    } catch (error) {
      console.error(`[BaileysMedia:${this.client?.instanceId || 'unknown'}] Error downloading media:`, error);
      return null;
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

  getMediaType(message) {
    const msg = message.message || message;
    
    if (msg.imageMessage) return 'image';
    if (msg.videoMessage) return 'video';
    if (msg.audioMessage) return msg.audioMessage.ptt ? 'ptt' : 'audio';
    if (msg.documentMessage) return 'document';
    if (msg.stickerMessage) return 'sticker';
    
    return 'unknown';
  }
  
  getMimeType(message, mediaType) {
    const msg = message.message || message;
    
    switch (mediaType) {
      case 'image': return msg.imageMessage?.mimetype || 'image/jpeg';
      case 'video': return msg.videoMessage?.mimetype || 'video/mp4';
      case 'audio': 
      case 'ptt': return msg.audioMessage?.mimetype || 'audio/ogg';
      case 'document': return msg.documentMessage?.mimetype || 'application/octet-stream';
      case 'sticker': return msg.stickerMessage?.mimetype || 'image/webp';
      default: return 'application/octet-stream';
    }
  }
  
  getFilename(message, mediaType, mimetype) {
    const msg = message.message || message;
    const timestamp = Date.now();
    
    // If document has a filename, use it
    if (mediaType === 'document' && msg.documentMessage?.fileName) {
      return msg.documentMessage.fileName;
    }
    
    // Generate appropriate extension based on mimetype
    const ext = this.getExtensionFromMimetype(mimetype);
    return `${mediaType}_${timestamp}${ext}`;
  }

  getExtensionFromMimetype(mimetype) {
    const mimeToExt = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'audio/ogg': '.ogg',
      'audio/mp4': '.m4a',
      'audio/mpeg': '.mp3',
      'application/pdf': '.pdf',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/zip': '.zip'
    };
    
    return mimeToExt[mimetype] || '.bin';
  }
}

module.exports = BaileysMedia;
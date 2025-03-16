// modules/mediaProcessor.js - Utility for processing and finding media files
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const mediaConverter = require('./mediaConverter');

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

class MediaProcessor {
  constructor() {
    // Create temp directory if it doesn't exist
    this.tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Create directories for archiving media
    this.mediaArchiveDir = path.join(__dirname, '..', 'media_archive');
    if (!fs.existsSync(this.mediaArchiveDir)) {
      fs.mkdirSync(this.mediaArchiveDir, { recursive: true });
    }
    
    // Create transcript media directory
    this.transcriptMediaDir = path.join(__dirname, '..', 'transcripts', 'media');
    if (!fs.existsSync(this.transcriptMediaDir)) {
      fs.mkdirSync(this.transcriptMediaDir, { recursive: true });
    }
    
    console.log('MediaProcessor initialized');
  }
  
  /**
   * Download media from Discord attachment
   * @param {Object} attachment - Discord attachment object
   * @returns {Promise<Buffer>} - Media buffer
   */
  async downloadDiscordAttachment(attachment) {
    try {
      console.log(`Downloading Discord attachment from: ${attachment.url}`);
      const response = await axios({
        method: 'GET',
        url: attachment.url,
        responseType: 'arraybuffer',
        timeout: 30000, // 30 second timeout
        headers: {
          'User-Agent': 'WhatsApp-Discord-Bridge'
        }
      });
      
      console.log(`Download successful, content length: ${response.data.length} bytes`);
      return Buffer.from(response.data);
    } catch (error) {
      console.error(`Error downloading Discord attachment: ${error.message}`);
      throw new Error(`Failed to download Discord attachment: ${error.message}`);
    }
  }
  
  /**
   * Archive media file with user information
   * @param {string} filepath - Path to file
   * @param {string} username - Username
   * @param {string} mediaType - Type of media
   * @param {string} phoneNumber - WhatsApp phone number (optional)
   * @returns {Promise<string|null>} - Path to archived file or null
   */
  async archiveMediaFile(filepath, username, mediaType, phoneNumber = null) {
    try {
      if (!fs.existsSync(filepath)) {
        console.error(`Cannot archive file, it doesn't exist: ${filepath}`);
        return null;
      }
      
      // Create user-specific directory structure
      const safeUsername = username.replace(/[^a-zA-Z0-9]/g, '_');
      
      // Main archive structure: media_archive/username/YYYY-MM-DD/
      const userDir = path.join(this.mediaArchiveDir, safeUsername);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      
      // Date-based subdirectory
      const today = new Date();
      const dateDir = path.join(
        userDir,
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      );
      
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
      }
      
      // Create a unique filename that includes user, mediaType, and timestamp
      const originalExt = path.extname(filepath);
      const timestamp = Date.now();
      const fileName = `${safeUsername}_${mediaType}_${timestamp}${originalExt}`;
      const archivePath = path.join(dateDir, fileName);
      
      // Copy the file
      fs.copyFileSync(filepath, archivePath);
      console.log(`Media archived to: ${archivePath}`);
      
      // Create a JSON metadata file with the same base name
      const metadataPath = path.join(dateDir, `${path.basename(archivePath, originalExt)}.json`);
      const metadata = {
        originalPath: filepath,
        username: username,
        safeUsername: safeUsername,
        phoneNumber: phoneNumber, // Store phone number if available
        mediaType: mediaType,
        timestamp: timestamp,
        date: today.toISOString(),
        fileSize: fs.statSync(filepath).size,
        extension: originalExt
      };
      
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      console.log(`Media metadata saved to: ${metadataPath}`);
      
      return archivePath;
    } catch (error) {
      console.error('Error archiving media file:', error);
      return null;
    }
  }
  
  /**
   * Find media files for a user across all archives
   * @param {string} username - Username to search for
   * @param {string} mediaType - Type of media to find (optional)
   * @param {string} phoneNumber - Phone number to search for (optional)
   * @param {number} limit - Maximum number of files to return (default 5)
   * @returns {Promise<Array>} - Array of media file info objects
   */
  async findMediaFilesForUser(username, mediaType = null, phoneNumber = null, limit = 5) {
    try {
      const results = [];
      const safeUsername = username.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      
      // Search patterns
      const searchTerms = [safeUsername];
      if (phoneNumber) {
        searchTerms.push(phoneNumber);
      }
      
      // 1. First, check the user-specific directory in media archive
      const userDir = path.join(this.mediaArchiveDir, safeUsername);
      if (fs.existsSync(userDir)) {
        const dateDirs = fs.readdirSync(userDir)
          .filter(dir => fs.statSync(path.join(userDir, dir)).isDirectory())
          .sort().reverse(); // Newest first
        
        for (const dateDir of dateDirs.slice(0, 5)) { // Check 5 most recent days
          const datePath = path.join(userDir, dateDir);
          
          // Get files matching the media type if specified
          const files = fs.readdirSync(datePath)
            .filter(f => !f.endsWith('.json'))
            .filter(f => {
              if (!mediaType) return true;
              
              // Check if file matches the requested media type
              return f.includes(`_${mediaType}_`) || this.detectMediaTypeFromFilename(f) === mediaType;
            })
            .map(f => ({
              path: path.join(datePath, f),
              filename: f,
              source: 'user_archive',
              mediaType: this.detectMediaTypeFromFilename(f),
              dateDir: dateDir
            }));
          
          results.push(...files);
          
          // Break if we have enough results
          if (results.length >= limit) break;
        }
      }
      
      // 2. Check date-based directories in media archive
      if (results.length < limit) {
        const dateDirs = fs.readdirSync(this.mediaArchiveDir)
          .filter(dir => 
            fs.statSync(path.join(this.mediaArchiveDir, dir)).isDirectory() && 
            /^\d{4}-\d{2}-\d{2}$/.test(dir)
          )
          .sort().reverse(); // Newest first
        
        for (const dateDir of dateDirs.slice(0, 5)) { // Check 5 most recent days
          const datePath = path.join(this.mediaArchiveDir, dateDir);
          
          // Check all files in this date directory
          const files = fs.readdirSync(datePath);
          
          // Find files that match this user
          for (const file of files) {
            // Skip JSON files
            if (file.endsWith('.json')) continue;
            
            // Skip if we're filtering by media type and it doesn't match
            if (mediaType && !file.includes(`_${mediaType}_`) && 
                this.detectMediaTypeFromFilename(file) !== mediaType) {
              continue;
            }
            
            // Check if filename contains any search term
            const lowerFile = file.toLowerCase();
            const matches = searchTerms.some(term => lowerFile.includes(term));
            
            if (matches) {
              results.push({
                path: path.join(datePath, file),
                filename: file,
                source: 'date_archive',
                mediaType: this.detectMediaTypeFromFilename(file),
                dateDir: dateDir
              });
              
              // Break if we have enough results
              if (results.length >= limit) break;
            }
            
            // Try to check JSON metadata if available
            if (!matches) {
              const jsonPath = path.join(datePath, `${path.basename(file, path.extname(file))}.json`);
              if (fs.existsSync(jsonPath)) {
                try {
                  const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                  
                  // Check if metadata contains our search terms
                  if ((metadata.username && searchTerms.some(term => 
                        metadata.username.toLowerCase().includes(term))) ||
                      (metadata.phoneNumber && metadata.phoneNumber === phoneNumber)) {
                    
                    results.push({
                      path: path.join(datePath, file),
                      filename: file,
                      source: 'date_archive_metadata',
                      mediaType: metadata.mediaType || this.detectMediaTypeFromFilename(file),
                      dateDir: dateDir,
                      metadata: metadata
                    });
                    
                    // Break if we have enough results
                    if (results.length >= limit) break;
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }
          
          // Break if we have enough results
          if (results.length >= limit) break;
        }
      }
      
      // 3. Check transcript media directories
      if (results.length < limit) {
        const transcriptDirs = fs.readdirSync(this.transcriptMediaDir)
          .filter(dir => fs.statSync(path.join(this.transcriptMediaDir, dir)).isDirectory());
        
        // First check directories that match the username
        const matchingDirs = transcriptDirs.filter(dir => {
          const lowerDir = dir.toLowerCase();
          return searchTerms.some(term => lowerDir.includes(term));
        });
        
        for (const dir of matchingDirs) {
          const dirPath = path.join(this.transcriptMediaDir, dir);
          
          // Get all files in this directory
          const files = fs.readdirSync(dirPath)
            .filter(f => !f.endsWith('.json'))
            .filter(f => {
              if (!mediaType) return true;
              return this.detectMediaTypeFromFilename(f) === mediaType;
            })
            .map(f => ({
              path: path.join(dirPath, f),
              filename: f,
              source: 'transcript_' + dir,
              mediaType: this.detectMediaTypeFromFilename(f)
            }));
          
          // Check files that match the username
          const matchingFiles = files.filter(f => {
            const lowerFile = f.filename.toLowerCase();
            return searchTerms.some(term => lowerFile.includes(term));
          });
          
          results.push(...matchingFiles);
          
          // Break if we have enough results
          if (results.length >= limit) break;
        }
        
        // If we still need more, check all other transcript directories
        if (results.length < limit) {
          for (const dir of transcriptDirs.filter(d => !matchingDirs.includes(d))) {
            const dirPath = path.join(this.transcriptMediaDir, dir);
            
            // Get all files in this directory
            const files = fs.readdirSync(dirPath);
            
            // Look for files with the username
            for (const file of files) {
              // Skip JSON files
              if (file.endsWith('.json')) continue;
              
              // Skip if we're filtering by media type and it doesn't match
              if (mediaType && this.detectMediaTypeFromFilename(file) !== mediaType) {
                continue;
              }
              
              // Check if filename contains any search term
              const lowerFile = file.toLowerCase();
              const matches = searchTerms.some(term => lowerFile.includes(term));
              
              if (matches) {
                results.push({
                  path: path.join(dirPath, file),
                  filename: file,
                  source: 'transcript_' + dir,
                  mediaType: this.detectMediaTypeFromFilename(file)
                });
                
                // Break if we have enough results
                if (results.length >= limit) break;
              }
            }
            
            // Break if we have enough results
            if (results.length >= limit) break;
          }
        }
      }
      
      // Deduplicate by file path
      const uniqueResults = [];
      const seenPaths = new Set();
      
      for (const result of results) {
        if (!seenPaths.has(result.path)) {
          seenPaths.add(result.path);
          uniqueResults.push(result);
        }
      }
      
      // Sort by newest first (using filename which often includes timestamp)
      uniqueResults.sort((a, b) => b.filename.localeCompare(a.filename));
      
      // Limit to requested number
      return uniqueResults.slice(0, limit);
    } catch (error) {
      console.error('Error finding media files for user:', error);
      return [];
    }
  }
  
  /**
   * Detect the media type from a filename
   * @param {string} filename - Filename to analyze
   * @returns {string} - Media type
   */
  detectMediaTypeFromFilename(filename) {
    if (!filename) return 'file';
    
    // Check for embedded type markers
    if (filename.includes('_image_')) return 'image';
    if (filename.includes('_video_')) return 'video';
    if (filename.includes('_audio_')) return 'audio';
    if (filename.includes('_document_')) return 'document';
    if (filename.includes('_gif_')) return 'gif';
    if (filename.includes('_sticker_')) return 'sticker';
    
    // Check extension
    const ext = path.extname(filename).toLowerCase();
    
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'image';
    if (ext === '.gif') return 'gif';
    if (['.mp4', '.avi', '.mov', '.webm'].includes(ext)) return 'video';
    if (['.mp3', '.ogg', '.wav', '.m4a'].includes(ext)) return 'audio';
    if (['.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(ext)) return 'document';
    if (ext === '.webp') return 'sticker';
    
    return 'file';
  }
  
  /**
   * Send a media file to a Discord channel
   * @param {Object} channel - Discord channel
   * @param {string} filepath - Path to media file
   * @param {string} username - Username for attribution
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Sent message
   */
  async sendMediaToDiscord(channel, filepath, username, options = {}) {
    try {
      if (!fs.existsSync(filepath)) {
        throw new Error(`Media file does not exist: ${filepath}`);
      }
      
      // Get file size and check Discord limits
      const fileSize = fs.statSync(filepath).size;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
      
      // Detect media type
      const mediaType = options.mediaType || this.detectMediaTypeFromFilename(filepath);
      
      // Determine appropriate message content
      let messageContent;
      if (options.content) {
        messageContent = options.content;
      } else {
        const typeDesc = mediaType === 'image' ? 'an image' :
                       mediaType === 'video' ? 'a video' :
                       mediaType === 'audio' ? 'an audio file' :
                       mediaType === 'document' ? 'a document' :
                       mediaType === 'gif' ? 'a GIF' :
                       mediaType === 'sticker' ? 'a sticker' :
                       'a file';
        
        messageContent = `**${username} sent ${typeDesc} (${fileSizeMB}MB):**`;
      }
      
      // Check if file is too large (8MB limit for normal servers, 100MB for boosted)
      const discordLimit = 8 * 1024 * 1024; // 8MB default
      
      if (fileSize > discordLimit) {
        // File is too large - check if we can optimize it
        if (mediaType === 'video') {
          // Try to optimize the video
          const optimizingMsg = await channel.send(`**${username}'s video is over 8MB, optimizing for Discord...**`);
          
          try {
            const optimizedPath = await mediaConverter.convertVideo(filepath, { maxSize: 8 });
            const optimizedSize = (fs.statSync(optimizedPath).size / (1024 * 1024)).toFixed(2); // MB
            
            if (fs.statSync(optimizedPath).size < discordLimit) {
              // Send the optimized video
              const sentMessage = await channel.send({
                content: `**${username} sent a video (optimized to ${optimizedSize}MB):**`,
                files: [{
                  attachment: optimizedPath,
                  name: path.basename(filepath)
                }]
              });
              
              // Clean up
              mediaConverter.cleanup(optimizedPath);
              optimizingMsg.delete().catch(() => {});
              
              return sentMessage;
            } else {
              // Still too large
              await optimizingMsg.edit(`**Video is ${optimizedSize}MB, which exceeds Discord's limit even after optimization. Please check the original source.**`);
              mediaConverter.cleanup(optimizedPath);
              return optimizingMsg;
            }
          } catch (error) {
            console.error('Error optimizing video:', error);
            await optimizingMsg.edit(`**Video is ${fileSizeMB}MB, which exceeds Discord's limit and couldn't be optimized. Please check the original source.**`);
            return optimizingMsg;
          }
        } else {
          // Other file types that can't be optimized
          return await channel.send(`**${username} sent a ${mediaType} file (${fileSizeMB}MB), but it exceeds Discord's attachment limit. Please check the original source.**`);
        }
      }
      
      // File is within Discord limits, send it directly
      return await channel.send({
        content: messageContent,
        files: [{
          attachment: filepath,
          name: options.filename || path.basename(filepath)
        }]
      });
    } catch (error) {
      console.error('Error sending media to Discord:', error);
      return await channel.send(`**Error sending ${username}'s media: ${error.message}**`);
    }
  }
  
  /**
   * Process and optimize a video file for Discord
   * @param {string} filepath - Path to video file
   * @param {Object} options - Options for processing
   * @returns {Promise<string>} - Path to optimized file
   */
  async processVideoForDiscord(filepath, options = {}) {
    try {
      const maxSize = options.maxSize || 8; // 8MB default limit
      
      // Check if file needs optimization
      const fileSize = fs.statSync(filepath).size;
      const fileSizeMB = fileSize / (1024 * 1024);
      
      if (fileSizeMB <= maxSize) {
        // Already small enough
        return filepath;
      }
      
      // Need to optimize
      return await mediaConverter.convertVideo(filepath, { maxSize });
    } catch (error) {
      console.error('Error processing video for Discord:', error);
      throw error;
    }
  }
  
  /**
   * Create a temporary file
   * @param {Buffer} buffer - Data buffer
   * @param {string} extension - File extension
   * @returns {Promise<string>} - Path to temporary file
   */
  async createTempFile(buffer, extension) {
    try {
      const tempPath = path.join(this.tempDir, `temp_${Date.now()}${extension}`);
      fs.writeFileSync(tempPath, buffer);
      return tempPath;
    } catch (error) {
      console.error('Error creating temp file:', error);
      throw error;
    }
  }
  
  /**
   * Clean up a temporary file
   * @param {string} filepath - Path to file
   */
  cleanup(filepath) {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`Cleaned up temporary file: ${filepath}`);
      }
    } catch (error) {
      console.error('Error cleaning up temp file:', error);
    }
  }
}

module.exports = new MediaProcessor();
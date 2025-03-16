// modules/mediaConverter.js - Fixed with instance isolation
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

class MediaConverter {
  constructor(options = {}) {
    // Instance ID for proper isolation
    this.instanceId = options.instanceId || 'default';
    
    // Set FFmpeg path
    ffmpeg.setFfmpegPath(ffmpegPath);
    
    // Create instance-specific temp directory
    this.tempDir = options.tempDir || path.join(__dirname, '..', 'instances', this.instanceId, 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`[MediaConverter:${this.instanceId}] Initialized with FFmpeg path: ${ffmpegPath}`);
  }
  
  /**
   * Set instance ID - useful for updating after initialization
   * @param {string} instanceId - Instance ID
   */
  setInstanceId(instanceId) {
    if (!instanceId) return;
    
    this.instanceId = instanceId;
    
    // Update temp directory path
    this.tempDir = path.join(__dirname, '..', 'instances', this.instanceId, 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`[MediaConverter:${this.instanceId}] Updated instance ID to ${instanceId}`);
  }

  /**
   * Convert a GIF to MP4 format specifically optimized for WhatsApp "GIF" display
   * Using direct FFmpeg command that's known to work from Baileys test
   * @param {string|Buffer} input - Path to GIF file or Buffer containing GIF data
   * @returns {Promise<string>} - Path to the converted MP4 file
   */
  async convertGifToWhatsAppVideo(input) {
    try {
      let inputPath;
      let needToCleanupInput = false;

      // Handle input as buffer or path
      if (Buffer.isBuffer(input)) {
        // It's a buffer, save to a temp file first
        inputPath = path.join(this.tempDir, `input_gif_${Date.now()}.gif`);
        fs.writeFileSync(inputPath, input);
        needToCleanupInput = true;
      } else {
        // It's a path
        inputPath = input;
        if (!fs.existsSync(inputPath)) {
          throw new Error(`GIF file not found: ${inputPath}`);
        }
      }

      // Create output path
      const outputPath = path.join(
        this.tempDir,
        `whatsapp_gif_${Date.now()}.mp4`
      );

      console.log(`[MediaConverter:${this.instanceId}] Converting GIF to WhatsApp-compatible MP4: ${inputPath} -> ${outputPath}`);

      // Use the exact FFmpeg command from Baileys test that is known to work
      return new Promise((resolve, reject) => {
        const command = `ffmpeg -i "${inputPath}" -movflags faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -b:v 1M -maxrate 1M -bufsize 1M -an "${outputPath}"`;
        
        exec(command, (error, stdout, stderr) => {
          if (error) {
            console.error(`[MediaConverter:${this.instanceId}] FFmpeg error:`, error);
            
            // Clean up the input temp file if we created it
            if (needToCleanupInput) {
              try { fs.unlinkSync(inputPath); } catch (e) { /* ignore */ }
            }
            
            reject(error);
            return;
          }
          
          if (stderr) {
            console.log(`[MediaConverter:${this.instanceId}] FFmpeg stderr:`, stderr);
          }
          
          console.log(`[MediaConverter:${this.instanceId}] GIF to MP4 conversion complete: ${outputPath}`);
          
          // Clean up the input temp file if we created it
          if (needToCleanupInput) {
            try { fs.unlinkSync(inputPath); } catch (e) { /* ignore */ }
          }
          
          resolve(outputPath);
        });
      });
    } catch (error) {
      console.error(`[MediaConverter:${this.instanceId}] Error converting GIF to WhatsApp video:`, error);
      throw error;
    }
  }

  /**
   * Converts a video to WhatsApp-compatible MP4 format
   * Using direct FFmpeg command with parameters known to work
   * @param {string|Buffer} input - Path to video file or Buffer containing video data
   * @param {object} options - Options for conversion
   * @param {number} options.maxSize - Maximum file size in MB (default 15)
   * @returns {Promise<string>} - Path to the converted MP4 file
   */
  async convertVideo(input, options = {}) {
    try {
      const maxSize = options.maxSize || 15; // Default 15MB limit for WhatsApp
      
      let inputPath;
      let needToCleanupInput = false;
      let inputExt = '.mp4';

      // Handle input as buffer or path
      if (Buffer.isBuffer(input)) {
        // It's a buffer, save to a temp file first
        inputPath = path.join(this.tempDir, `input_video_${Date.now()}${inputExt}`);
        fs.writeFileSync(inputPath, input);
        needToCleanupInput = true;
      } else {
        // It's a path
        inputPath = input;
        if (!fs.existsSync(inputPath)) {
          throw new Error(`Video file not found: ${inputPath}`);
        }
        inputExt = path.extname(inputPath);
      }

      // Create output path
      const outputPath = path.join(
        this.tempDir,
        `converted_video_${Date.now()}.mp4`
      );

      console.log(`[MediaConverter:${this.instanceId}] Optimizing video for WhatsApp: ${inputPath} -> ${outputPath}`);

      // Use direct FFmpeg command with parameters similar to the GIF conversion
      return new Promise((resolve, reject) => {
        // Determine bitrate based on file size and target size
        const inputSize = fs.statSync(inputPath).size / (1024 * 1024); // Size in MB
        let bitrate = '1M';
        let scale = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
        
        if (inputSize > maxSize) {
          const targetBitrate = Math.floor((maxSize / inputSize) * 1000000 * 0.8); // 80% of theoretical max
          bitrate = `${Math.max(500000, Math.min(1000000, targetBitrate))}`;  // Between 500k and 1M
          console.log(`[MediaConverter:${this.instanceId}] Input video is ${inputSize.toFixed(2)}MB, adjusting bitrate to ${bitrate}`);
          
          // For much larger videos, also scale down the resolution
          if (inputSize > maxSize * 2) {
            scale = 'scale=640:trunc(640*ih/iw/2)*2'; // Resize to 640px width
            console.log(`[MediaConverter:${this.instanceId}] Using reduced resolution for large video`);
          }
        }
        
        const command = `ffmpeg -i "${inputPath}" -movflags faststart -pix_fmt yuv420p -vf "${scale}" -b:v ${bitrate} -maxrate ${bitrate} -bufsize ${bitrate} -c:a aac -b:a 128k "${outputPath}"`;
        
        exec(command, (error, stdout, stderr) => {
          // Clean up the input temp file if we created it
          if (needToCleanupInput) {
            try { fs.unlinkSync(inputPath); } catch (e) { /* ignore */ }
          }
          
          if (error) {
            console.error(`[MediaConverter:${this.instanceId}] FFmpeg error:`, error);
            reject(error);
            return;
          }
          
          if (stderr) {
            console.log(`[MediaConverter:${this.instanceId}] FFmpeg stderr:`, stderr);
          }
          
          console.log(`[MediaConverter:${this.instanceId}] Video conversion complete: ${outputPath}`);
          
          // Get final size
          const finalSize = fs.statSync(outputPath).size / (1024 * 1024); // MB
          console.log(`[MediaConverter:${this.instanceId}] Output video size: ${finalSize.toFixed(2)}MB`);
          
          resolve(outputPath);
        });
      });
    } catch (error) {
      console.error(`[MediaConverter:${this.instanceId}] Error converting video for WhatsApp:`, error);
      throw error;
    }
  }

  /**
   * Convert a WebP file (including animated WebP) to GIF
   * @param {string} webpPath - Path to WebP file
   * @param {Object} options - Conversion options
   * @returns {Promise<string>} - Path to output GIF file
   */
  async convertWebpToGif(webpPath, options = {}) {
    try {
      if (!fs.existsSync(webpPath)) {
        throw new Error(`WebP file not found: ${webpPath}`);
      }

      const outputPath = path.join(
        this.tempDir,
        `converted_gif_${Date.now()}.gif`
      );

      console.log(`[MediaConverter:${this.instanceId}] Converting WebP to GIF: ${webpPath} -> ${outputPath}`);

      return new Promise((resolve, reject) => {
        // Try using direct FFmpeg command first (more reliable)
        const command = `ffmpeg -i "${webpPath}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -f gif "${outputPath}"`;
        
        exec(command, (error, stdout, stderr) => {
          if (error) {
            console.error(`[MediaConverter:${this.instanceId}] FFmpeg direct command error:`, error);
            console.log(`[MediaConverter:${this.instanceId}] Falling back to fluent-ffmpeg`);
            
            // Fallback to fluent-ffmpeg
            ffmpeg(webpPath)
              .outputOptions([
                '-loop 0',                  // Maintain loop
                '-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2"', // Ensure dimensions are even
                '-f gif'                    // Force GIF format
              ])
              .save(outputPath)
              .on('end', () => {
                console.log(`[MediaConverter:${this.instanceId}] WebP to GIF conversion complete: ${outputPath}`);
                const finalSize = fs.statSync(outputPath).size / 1024; // KB
                console.log(`[MediaConverter:${this.instanceId}] Output GIF size: ${finalSize.toFixed(2)}KB`);
                resolve(outputPath);
              })
              .on('error', (ffmpegError) => {
                console.error(`[MediaConverter:${this.instanceId}] FFmpeg error in WebP to GIF conversion:`, ffmpegError);
                reject(ffmpegError);
              });
            
            return;
          }
          
          if (stderr) {
            console.log(`[MediaConverter:${this.instanceId}] FFmpeg stderr:`, stderr);
          }
          
          console.log(`[MediaConverter:${this.instanceId}] WebP to GIF conversion complete: ${outputPath}`);
          const finalSize = fs.statSync(outputPath).size / 1024; // KB
          console.log(`[MediaConverter:${this.instanceId}] Output GIF size: ${finalSize.toFixed(2)}KB`);
          resolve(outputPath);
        });
      });
    } catch (error) {
      console.error(`[MediaConverter:${this.instanceId}] Error converting WebP to GIF:`, error);
      throw error;
    }
  }

  /**
   * Convert to animated WebP for WhatsApp stickers
   * @param {string} inputPath - Path to input file
   * @param {string} outputPath - Path to output file
   * @param {number} quality - Quality of output (1-100)
   * @returns {Promise<string>}
   */
  convertToAnimatedWebP(inputPath, outputPath, quality = 80) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,setsar=1',
          '-loop', '0',
          '-compression_level', '6',
          `-quality`, quality,
          '-an', // Remove audio
          '-vsync', '0'
        ])
        .toFormat('webp')
        .save(outputPath)
        .on('end', () => {
          console.log(`[MediaConverter:${this.instanceId}] WebP conversion complete: ${outputPath}`);
          const finalSize = fs.statSync(outputPath).size / 1024; // KB
          console.log(`[MediaConverter:${this.instanceId}] Output WebP size: ${finalSize.toFixed(2)}KB`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error(`[MediaConverter:${this.instanceId}] FFmpeg WebP error:`, err);
          reject(err);
        });
    });
  }

  /**
   * Clean up a file
   * @param {string} filePath - Path to file to clean up
   */
  cleanup(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[MediaConverter:${this.instanceId}] Cleaned up: ${filePath}`);
      }
    } catch (error) {
      console.error(`[MediaConverter:${this.instanceId}] Error cleaning up file ${filePath}:`, error);
    }
  }
}

// Create instance with default options
const defaultConverter = new MediaConverter();

module.exports = defaultConverter;
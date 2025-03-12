// modules/TranscriptManager.js - FIXED for proper transcript handling

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");
const MediaManager = require('./MediaManager');
const { formatDisplayName, formatDirectoryName, cleanPhoneNumber } = MediaManager.formatFunctions;

class TranscriptManager {
  constructor(options = {}) {
    this.instanceId = options.instanceId || "default";
    this.transcriptChannelId = options.transcriptChannelId || null;
    this.discordClient = options.discordClient || null;
    this.guildId = options.guildId || null;

    // FIXED: Split these flags for more flexibility
    // localOnly controls whether to send to Discord channel, but local saving always happens
    this.localOnly = false; 
    // isDisabled controls whether to generate transcripts at all
    this.isDisabled = false;

    // Phone number cache for transcript generation
    this._channelPhoneCache = new Map();

    // Media hash cache for deduplication during transcript generation
    this.mediaHashCache = new Map();

    try {
      const MediaManager = require('./MediaManager');
      this.mediaManager = new MediaManager({
        instanceId: this.instanceId,
        baseDir: this.baseDir
      });
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error creating MediaManager: ${error.message}`);
    }

    // Default base directory - FIXED to use the right structure
    this.baseDir =
      options.baseDir ||
      path.join(__dirname, "..", "instances", this.instanceId, "transcripts");

    // Ensure base directory exists
    this.ensureBaseDir();

    // Set up UserCardManager reference if available
    if (options.userCardManager) {
      this.userCardManager = options.userCardManager;
    }

    console.log(
      `[TranscriptManager:${this.instanceId}] Created new transcript manager instance`
    );
  }

  sanitizeName(name) {
    if (!name) return "unknown-user";
    // Remove invalid characters for file system
    return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  getTranscriptDir(username, phoneNumber) {
    try {
      // Method 1: Use MediaManager if available
      if (this.mediaManager && typeof this.mediaManager.getTranscriptsDir === 'function') {
        return this.mediaManager.getTranscriptsDir(phoneNumber, username);
      }
      
      // Method 2: Use MediaManager directly
      const MediaManager = require('./MediaManager');
      const mediaManager = new MediaManager({
        instanceId: this.instanceId,
        baseDir: this.baseDir
      });
      return mediaManager.getTranscriptsDir(phoneNumber, username);
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error using MediaManager: ${error.message}`);
      
      // Method 3: Use static functions from MediaManager 
      try {
        const MediaManager = require('./MediaManager');
        const { formatDisplayName, cleanPhoneNumber } = MediaManager.formatFunctions;
        
        const displayName = formatDisplayName(username);
        const sanitizedName = this.sanitizeName(displayName);
        const cleanPhone = cleanPhoneNumber(phoneNumber);
        
        // Create directory with phone number in parentheses
        const dir = path.join(this.baseDir, `${sanitizedName}(${cleanPhone})`);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
      } catch (fallbackError) {
        console.error(`[TranscriptManager:${this.instanceId}] Fallback error: ${fallbackError.message}`);
        
        // Method 4: Last resort emergency fallback
        const dir = path.join(this.baseDir, String(username || "unknown").replace(/[<>:"/\\|?*]/g, "-"));
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
      }
    }
  }

  /**
   * Ensure base directory exists
   */
  ensureBaseDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
      console.log(
        `[TranscriptManager:${this.instanceId}] Created base directory: ${this.baseDir}`
      );
    }
  }

  /**
   * Set base directory explicitly (used for custom paths)
   * @param {string} baseDir - Path to base directory
   */
  setBaseDirs(baseDir) {
    this.baseDir = baseDir;
    this.ensureBaseDir();
    console.log(
      `[TranscriptManager:${this.instanceId}] Set base directory to ${this.baseDir}`
    );
  }

  /**
   * Set the Discord client reference
   * @param {Object} client - Discord client
   */
  setDiscordClient(client) {
    this.discordClient = client;
  }

  /**
   * Set the guild ID
   * @param {string} guildId - Discord guild ID
   */
  setGuildId(guildId) {
    this.guildId = guildId;
  }

  /**
   * Set the transcript channel ID
   * @param {string} channelId - Discord channel ID for transcripts
   */
  setTranscriptChannelId(channelId) {
    this.transcriptChannelId = channelId;
  }

  /**
   * Set UserCardManager reference
   * @param {Object} manager - UserCardManager instance
   */
  setUserCardManager(manager) {
    this.userCardManager = manager;
  }

  /**
   * Set instance ID
   * @param {string} instanceId - Instance ID
   */
  setInstanceId(instanceId) {
    this.instanceId = instanceId;
    // Update base directory to use the new instance ID
    this.baseDir = path.join(
      __dirname,
      "..",
      "instances",
      this.instanceId,
      "transcripts"
    );
    this.ensureBaseDir();
  }

  /**
   * Ensure we have the phone number for a channel when generating transcript
   * @param {string} channelId - Discord channel ID
   * @param {string} phoneNumber - WhatsApp phone number
   * @param {string} username - User name
   */
  ensurePhoneForTranscript(channelId, phoneNumber, username) {
    if (!this._channelPhoneCache) {
      this._channelPhoneCache = new Map();
    }

    console.log(
      `[TranscriptManager:${this.instanceId}] Caching phone number ${phoneNumber} for channel ${channelId} (${username})`
    );
    this._channelPhoneCache.set(channelId, {
      phoneNumber,
      username,
      timestamp: Date.now(),
    });
  }

  /**
   * Generate and send HTML transcript
   * @param {object} channel - Discord channel
   * @param {object} closedBy - User who closed the ticket
   * @returns {Promise<string>} - Transcript path
   */
  async generateHTMLTranscript(channel, closedBy) {
    try {
      // If transcripts are completely disabled, return early
      if (this.isDisabled) {
        console.log(`[TranscriptManager:${this.instanceId}] Transcripts are disabled - skipping generation`);
        return null;
      }

      console.log(
        `[TranscriptManager:${this.instanceId}] Generating HTML transcript for channel ${channel.name}`
      );

      // Validate client and guild access
      if (!this.discordClient) {
        console.error(
          `[TranscriptManager:${this.instanceId}] Discord client is missing!`
        );
        throw new Error("Discord client not available");
      }

      // Get the guild
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(
          `[TranscriptManager:${this.instanceId}] Error: Guild with ID ${this.guildId} not found`
        );
        throw new Error(`Guild not found: ${this.guildId}`);
      }

      // Verify this is the correct guild for this instance
      console.log(
        `[TranscriptManager:${this.instanceId}] Verified guild: ${guild.name} (${guild.id})`
      );

      // Get the transcript channel if set
      let transcriptChannel = null;
      if (this.transcriptChannelId) {
        transcriptChannel = await guild.channels
          .fetch(this.transcriptChannelId)
          .catch((error) => {
            console.error(
              `[TranscriptManager:${this.instanceId}] Error fetching transcript channel: ${error.message}`
            );
            return null;
          });

        if (transcriptChannel) {
          console.log(
            `[TranscriptManager:${this.instanceId}] Using transcript channel: ${transcriptChannel.name}`
          );
        } else {
          console.warn(
            `[TranscriptManager:${this.instanceId}] Warning: Transcript channel with ID ${this.transcriptChannelId} not found`
          );
        }
      }

      // Get the WhatsApp number and username for this channel
      let phoneNumber = null;
      let username = null;

      try {
        // Get user information from cache or channel
        if (
          this._channelPhoneCache &&
          this._channelPhoneCache.has(channel.id)
        ) {
          const cached = this._channelPhoneCache.get(channel.id);
          phoneNumber = cached.phoneNumber;
          username = cached.username;
          console.log(
            `[TranscriptManager:${this.instanceId}] Using cached phone number ${phoneNumber} and username ${username}`
          );
        }

        // Get username from channel name if we don't have it
        if (!username) {
          const nameMatch = channel.name.match(/^(?:✓)?📋\s*-\s*(.+)$/);
          if (nameMatch) {
            username = nameMatch[1];
          } else {
            username = channel.name.replace(/^✓/, ""); // Fallback to channel name without checkmark
          }
          console.log(
            `[TranscriptManager:${this.instanceId}] Using username from channel name: ${username}`
          );
        }

        // Try to get phone number from UserCardManager if we don't have it
        if (!phoneNumber && this.userCardManager && username) {
          const matchingUsers = this.userCardManager.findUsersByPartialName(
            username,
            1
          );
          if (matchingUsers && matchingUsers.length > 0) {
            phoneNumber = matchingUsers[0].phoneNumber;
            console.log(
              `[TranscriptManager:${this.instanceId}] Found phone number ${phoneNumber} from UserCardManager`
            );
          }
        }
      } catch (error) {
        console.error(
          `[TranscriptManager:${this.instanceId}] Error getting user information:`,
          error
        );
        username = channel.name.replace(/^✓/, "");
      }

      // Fetch all messages from the channel
      const allMessages = await this.fetchAllMessages(channel);

      // Start building HTML content
      let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticket Transcript: ${channel.name}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
        }
        header {
            background-color: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 5px solid #2196F3;
        }
        h1 {
            margin-top: 0;
            color: #2196F3;
        }
        .info-list {
            list-style: none;
            padding: 0;
        }
        .info-list li {
            margin-bottom: 5px;
        }
        .message {
            background-color: #f9f9f9;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 15px;
            position: relative;
        }
        .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            border-bottom: 1px solid #eaeaea;
            padding-bottom: 5px;
        }
        .author {
            font-weight: bold;
            color: #2196F3;
        }
        .timestamp {
            color: #777;
            font-size: 0.85em;
        }
        .content {
            white-space: pre-wrap;
        }
        .media-list {
            margin-top: 10px;
            border-top: 1px dashed #ddd;
            padding-top: 10px;
        }
        .media-item {
            background-color: #eef7ff;
            padding: 5px 10px;
            border-radius: 3px;
            margin-bottom: 5px;
            font-size: 0.9em;
        }
        .section {
            margin-top: 40px;
            border-top: 2px solid #eaeaea;
            padding-top: 20px;
        }
        .system-message {
            font-style: italic;
            color: #777;
            background-color: #f0f0f0;
        }
        .message-id {
            position: absolute;
            right: 10px;
            bottom: 5px;
            font-size: 0.7em;
            color: #ccc;
        }
        .footer {
            margin-top: 40px;
            text-align: center;
            font-size: 0.8em;
            color: #777;
        }
    </style>
</head>
<body>
    <header>
        <h1>Ticket Transcript: ${channel.name}</h1>
        <ul class="info-list">
            <li><strong>Generated:</strong> ${new Date().toLocaleString()}</li>
            <li><strong>Closed by:</strong> ${
              closedBy.tag || closedBy.username
            }</li>
            <li><strong>WhatsApp:</strong> ${phoneNumber || "unknown"}</li>
            <li><strong>Username:</strong> ${username || "unknown"}</li>
            <li><strong>Instance:</strong> ${this.instanceId}</li>
            <li><strong>Guild:</strong> ${guild.name} (${guild.id})</li>
            <li><strong>Channel:</strong> ${channel.name} (${channel.id})</li>
        </ul>
    </header>

    <div class="messages">`;

      // Filter out system messages and add message content
      const processedMessages = allMessages.filter((msg) => {
        return !(
          msg.author?.bot &&
          (msg.content === "[---NewTicket---]" ||
            msg.content?.includes("Previous conversation:") ||
            msg.content?.includes("End of previous conversation") ||
            msg.content?.includes("Transcript saved:"))
        );
      });

      for (const msg of processedMessages) {
        // Use member display name (nickname) if available, otherwise username
        const authorName =
          msg.member?.displayName || msg.author?.username || "Unknown";
        const timestamp = new Date(msg.createdTimestamp).toLocaleString();
        const isSystemMessage =
          msg.author?.bot &&
          (msg.content?.includes("Transcript saved") ||
            msg.content?.includes("Closing ticket") ||
            msg.content?.includes("has been posted"));

        // Add message to HTML
        htmlContent += `
    <div class="message ${isSystemMessage ? "system-message" : ""}">
        <div class="message-header">
            <span class="author">${authorName}</span>
            <span class="timestamp">${timestamp}</span>
        </div>
        <div class="content">${
          // Replace Discord markdown with HTML
          (msg.content || "")
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.*?)\*/g, "<em>$1</em>")
            .replace(/~~(.*?)~~/g, "<del>$1</del>")
            .replace(/`(.*?)`/g, "<code>$1</code>")
            .replace(/```(.*?)```/gs, "<pre><code>$1</code></pre>")
            .replace(/\n/g, "<br>")
        }</div>`;

        // Process attachments
        if (msg.attachments && msg.attachments.size > 0) {
          htmlContent += `
        <div class="media-list">
            <p><em>Message contained ${msg.attachments.size} attachment(s):</em></p>`;

          // List each attachment
          for (const [_, attachment] of msg.attachments) {
            htmlContent += `
            <div class="media-item">
                <a href="${attachment.url}" target="_blank">${
              attachment.name || "Attachment"
            }</a> (${this.formatBytes(attachment.size)})
            </div>`;
          }

          htmlContent += `
        </div>`;
        }

        htmlContent += `
        <div class="message-id">ID: ${msg.id}</div>
    </div>`;
      }

      // Add footer
      htmlContent += `
    <div class="section">
        <h2>Instance Information</h2>
        <ul class="info-list">
            <li><strong>Instance ID:</strong> ${this.instanceId}</li>
            <li><strong>Guild:</strong> ${guild.name} (${guild.id})</li>
            <li><strong>Generated:</strong> ${new Date().toISOString()}</li>
        </ul>
    </div>
    
    <div class="footer">
        WhatsApp Discord Bridge Transcript | Generated on ${new Date().toISOString()}
    </div>
</body>
</html>`;

      // Get transcript directory using the new structure
      const transcriptDir = this.getTranscriptDir(username, phoneNumber);

      // Save the transcript locally - ALWAYS do this regardless of localOnly setting
      const timestamp = Date.now();
    const safeTicketName = channel.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const htmlFilename = `transcript-${safeTicketName}-${timestamp}.html`;
    const transcriptPath = path.join(transcriptDir, htmlFilename);

    fs.writeFileSync(transcriptPath, htmlContent, "utf8");
    console.log(`[TranscriptManager:${this.instanceId}] Saved HTML transcript to ${transcriptPath}`);

    const buffer = Buffer.from(htmlContent, "utf8");

    // CHANGE ORDER: Send to transcript channel FIRST, before original channel
    if (this.transcriptChannelId && !this.localOnly) {
      try {
        console.log(`[TranscriptManager:${this.instanceId}] Sending transcript to channel: ${transcriptChannel.name} (${transcriptChannel.id})`);

        // Send to transcript channel with clear content message
        await transcriptChannel.send({
          content: `📝 **Transcript for ${channel.name}** (closed by ${closedBy.username})`,
          files: [{ attachment: buffer, name: htmlFilename }]
        });
        
        console.log(`[TranscriptManager:${this.instanceId}] Successfully sent transcript to transcript channel`);
      } catch (sendError) {
        console.error(`[TranscriptManager:${this.instanceId}] Error sending to transcript channel:`, sendError);
      }
    } else if (this.localOnly) {
      console.log(`[TranscriptManager:${this.instanceId}] Local-only mode: transcript saved locally but not sent to Discord channel`);
    } else {
      console.log(`[TranscriptManager:${this.instanceId}] No transcript channel configured, skipping Discord send`);
    }

    // THEN send a brief note to original channel
    await channel.send({
      content: `Transcript saved successfully. This channel will be deleted in 5 seconds.`,
    });

    console.log(`[TranscriptManager:${this.instanceId}] Transcript generated and sent successfully`);
    return transcriptPath;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error generating HTML transcript:`,
        error
      );
      return null;
    }
  }

  /**
   * Find and retrieve the most recent transcript for a user
   * @param {string} phoneNumber - User phone number 
   * @param {string} username - Username
   * @returns {Promise<{path: string, content: string} | null>} - Transcript info or null
   */
  async getPreviousTranscript(phoneNumber, username) {
    try {
      // Find the user's transcript
      const result = this.findUserTranscript(username, phoneNumber);
      if (!result) {
        console.log(`[TranscriptManager:${this.instanceId}] No previous transcript found for ${username} (${phoneNumber})`);
        return null;
      }

      console.log(`[TranscriptManager:${this.instanceId}] Found previous transcript at ${result.path}`);
      return result;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error getting previous transcript:`, error);
      return null;
    }
  }

  /**
   * Send previous transcript to a channel
   * @param {Object} channel - Discord channel to send transcript to
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - Username
   * @returns {Promise<boolean>} - Success status
   */
  async sendPreviousTranscriptToChannel(channel, phoneNumber, username) {
    try {
      // Get previous transcript
      const transcript = await this.getPreviousTranscript(phoneNumber, username);
      if (!transcript) {
        return false;
      }

      // If it's an HTML transcript, send the file
      if (transcript.path.endsWith('.html')) {
        const buffer = fs.readFileSync(transcript.path);
        
        // Send as an attachment with a helpful message
        await channel.send({
          content: `# 📄 Previous Conversation\nThis transcript contains the previous conversation history:`,
          files: [
            {
              attachment: buffer,
              name: path.basename(transcript.path)
            }
          ]
        });
        
        return true;
      } 
      // For markdown transcripts, send the content directly with proper formatting
      else if (transcript.path.endsWith('.md')) {
        // Split into chunks if needed
        const content = transcript.content;
        const chunkSize = 1900; // Discord limit with buffer
        
        if (content.length <= chunkSize) {
          await channel.send(`# 📄 Previous Conversation\n${content}`);
        } else {
          // Send in chunks
          await channel.send(`# 📄 Previous Conversation\nThis transcript is too long and will be sent in multiple messages:`);
          
          const chunks = [];
          for (let i = 0; i < content.length; i += chunkSize) {
            chunks.push(content.substring(i, i + chunkSize));
          }
          
          for (const chunk of chunks) {
            await channel.send(chunk);
          }
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error sending previous transcript:`, error);
      return false;
    }
  }

  /**
   * Backward compatibility method
   */
  async generateAndSendTranscript(channel, closedBy) {
    return this.generateHTMLTranscript(channel, closedBy);
  }

  findUserTranscript(username, phoneNumber = null) {
    try {
      console.log(`[TranscriptManager:${this.instanceId}] Finding transcript for user ${username} (${phoneNumber || 'no phone'})`);
      
      // CRITICAL FIX: Make sure we're looking in the correct instance directory
      // This function should never return a transcript from a different instance
      
      // First try direct approach with phone and username
      if (phoneNumber) {
        const cleanPhone = cleanPhoneNumber(phoneNumber);
        const displayName = formatDisplayName(username);
        const sanitizedName = this.sanitizeName(displayName);
        
        // FIXED: Use new path format with phone in parentheses
        const userDir = path.join(this.baseDir, `${sanitizedName}(${cleanPhone})`);
        
        // Try master transcript first
        const masterPath = path.join(userDir, 'transcript-master.md');
        
        if (fs.existsSync(masterPath)) {
          console.log(`[TranscriptManager:${this.instanceId}] Found master transcript at ${masterPath}`);
          
          // Verify this transcript belongs to this instance by checking its content
          const content = fs.readFileSync(masterPath, 'utf8');
          const instanceMatch = content.match(/Instance: ([^\s\n]+)/);
          
          if (instanceMatch && instanceMatch[1] !== this.instanceId && this.instanceId !== null) {
            console.error(`[TranscriptManager:${this.instanceId}] WARNING: Found transcript belongs to different instance: ${instanceMatch[1]}`);
          }
          
          return { 
            path: masterPath, 
            content,
            isLatest: true 
          };
        }
        
        // Look for HTML transcripts too
        const htmlFiles = fs.existsSync(userDir) ? 
          fs.readdirSync(userDir).filter(file => file.startsWith('transcript-') && file.endsWith('.html')) : [];
          
        if (htmlFiles.length > 0) {
          // Sort to get newest first
          htmlFiles.sort().reverse();
          const latestHtmlPath = path.join(userDir, htmlFiles[0]);
          console.log(`[TranscriptManager:${this.instanceId}] Found HTML transcript at ${latestHtmlPath}`);
          
          // For HTML, we can't easily check instance, but we assume it's correct based on directory
          return {
            path: latestHtmlPath,
            content: fs.readFileSync(latestHtmlPath, 'utf8'),
            isLatest: true
          };
        }
        
        // Then try to find most recent timestamped transcript
        if (fs.existsSync(userDir)) {
          const mdFiles = fs.readdirSync(userDir)
            .filter(file => file.startsWith('transcript-') && file.endsWith('.md') && file !== 'transcript-master.md')
            .sort().reverse(); // Newest first based on timestamp in name
          
          if (mdFiles.length > 0) {
            const latestTranscriptPath = path.join(userDir, mdFiles[0]);
            console.log(`[TranscriptManager:${this.instanceId}] Found latest transcript at ${latestTranscriptPath}`);
            
            // Verify this transcript belongs to this instance
            const content = fs.readFileSync(latestTranscriptPath, 'utf8');
            const instanceMatch = content.match(/Instance: ([^\s\n]+)/);
            
            if (instanceMatch && instanceMatch[1] !== this.instanceId && this.instanceId !== null) {
              console.error(`[TranscriptManager:${this.instanceId}] WARNING: Found transcript belongs to different instance: ${instanceMatch[1]}`);
            }
            
            return { 
              path: latestTranscriptPath, 
              content,
              isLatest: false
            };
          }
        }
      }
      
      // If we reach here, we couldn't find a transcript with exact paths
      // Try to search more broadly through base directory
      console.log(`[TranscriptManager:${this.instanceId}] No direct transcript found, searching broadly...`);
      
      // Function to recursively search directories
      const searchTranscripts = (dir, depth = 0) => {
        if (depth > 3) return null; // Limit search depth
        
        try {
          if (!fs.existsSync(dir)) return null;
          
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          
          // First check if folder name contains phone number
          if (phoneNumber && dir.includes(phoneNumber)) {
            // This directory name contains the phone number - check for transcripts
            
            // Check for HTML files first
            const htmlFiles = entries
              .filter(entry => !entry.isDirectory() && 
                      entry.name.startsWith('transcript-') && 
                      entry.name.endsWith('.html'))
              .map(entry => path.join(dir, entry.name));
            
            if (htmlFiles.length > 0) {
              const sortedHtml = htmlFiles.sort().reverse(); // Newest first
              return {
                path: sortedHtml[0],
                content: fs.readFileSync(sortedHtml[0], 'utf8'),
                isLatest: true
              };
            }
            
            // Look for master transcript
            const masterPath = path.join(dir, 'transcript-master.md');
            if (fs.existsSync(masterPath)) {
              return {
                path: masterPath,
                content: fs.readFileSync(masterPath, 'utf8'),
                isLatest: true
              };
            }
            
            // Look for any MD transcript
            const mdFiles = entries
              .filter(entry => !entry.isDirectory() && 
                      entry.name.startsWith('transcript-') && 
                      entry.name.endsWith('.md'))
              .map(entry => path.join(dir, entry.name));
            
            if (mdFiles.length > 0) {
              const sortedMd = mdFiles.sort().reverse(); // Newest first
              return {
                path: sortedMd[0],
                content: fs.readFileSync(sortedMd[0], 'utf8'),
                isLatest: false
              };
            }
          }
          
          // First look for direct transcript files in this directory
          const transcriptFiles = entries
            .filter(entry => !entry.isDirectory() && 
                    entry.name.startsWith('transcript-') && 
                    (entry.name.endsWith('.md') || entry.name.endsWith('.html')))
            .map(entry => path.join(dir, entry.name));
          
          // Check if any exist and have username
          for (const filePath of transcriptFiles) {
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              
              // CRITICAL FIX: Verify this transcript belongs to this instance
              const instanceMatch = content.match(/Instance: ([^\s\n]+)/);
              if (instanceMatch && instanceMatch[1] !== this.instanceId && this.instanceId !== null) {
                console.log(`[TranscriptManager:${this.instanceId}] Skipping transcript from different instance: ${instanceMatch[1]}`);
                continue;
              }
              
              // Check if the file contains the username or phone number
              const lowerContent = content.toLowerCase();
              const lowerUsername = username.toLowerCase();
              
              if (lowerContent.includes(lowerUsername) || 
                  (phoneNumber && lowerContent.includes(phoneNumber))) {
                console.log(`[TranscriptManager:${this.instanceId}] Found transcript by content match: ${filePath}`);
                return { path: filePath, content, isLatest: false };
              }
            } catch (e) {
              console.error(`[TranscriptManager:${this.instanceId}] Error reading ${filePath}:`, e);
            }
          }
          
          // Recursively search subdirectories
          for (const entry of entries) {
            if (entry.isDirectory()) {
              // FIXED: Check if folder name includes username with phone in parentheses
              const sanitizedUsername = this.sanitizeName(formatDisplayName(username)).toLowerCase();
              
              if (entry.name.toLowerCase().includes(sanitizedUsername) || 
                  (phoneNumber && entry.name.includes(phoneNumber))) {
                
                // Check for master transcript
                const masterPath = path.join(dir, entry.name, 'transcript-master.md');
                if (fs.existsSync(masterPath)) {
                  const content = fs.readFileSync(masterPath, 'utf8');
                  
                  // CRITICAL FIX: Verify this transcript belongs to this instance
                  const instanceMatch = content.match(/Instance: ([^\s\n]+)/);
                  if (instanceMatch && instanceMatch[1] !== this.instanceId && this.instanceId !== null) {
                    console.log(`[TranscriptManager:${this.instanceId}] Skipping transcript from different instance: ${instanceMatch[1]}`);
                    continue;
                  }
                  
                  console.log(`[TranscriptManager:${this.instanceId}] Found master transcript in matching folder: ${masterPath}`);
                  return { path: masterPath, content, isLatest: true };
                }
                
                // Check for HTML transcripts
                const htmlFiles = fs.readdirSync(path.join(dir, entry.name))
                  .filter(file => file.startsWith('transcript-') && file.endsWith('.html'))
                  .sort().reverse(); // Newest first
                
                if (htmlFiles.length > 0) {
                  const htmlPath = path.join(dir, entry.name, htmlFiles[0]);
                  console.log(`[TranscriptManager:${this.instanceId}] Found HTML transcript in matching folder: ${htmlPath}`);
                  return { 
                    path: htmlPath, 
                    content: fs.readFileSync(htmlPath, 'utf8'),
                    isLatest: true 
                  };
                }
              }
              
              // Otherwise search this directory
              const result = searchTranscripts(path.join(dir, entry.name), depth + 1);
              if (result) return result;
            }
          }
          
          return null;
        } catch (error) {
          console.error(`[TranscriptManager:${this.instanceId}] Error searching directory ${dir}:`, error);
          return null;
        }
      };
      
      // Start the search from the base directory
      return searchTranscripts(this.baseDir);
    } catch (error) {
      console.error(`[TranscriptManager:${this.instanceId}] Error finding user transcript:`, error);
      return null;
    }
  }

  /**
   * Fetch all messages from a channel
   * @param {object} channel - Discord channel
   * @returns {Promise<Array>} - Messages array
   */
  async fetchAllMessages(channel) {
    let allMessages = [];
    let lastId = null;
    let fetchedMessages;

    // Fetch in batches
    do {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      fetchedMessages = await channel.messages.fetch(options);
      if (fetchedMessages.size === 0) break;

      allMessages = [...allMessages, ...fetchedMessages.values()];
      lastId = fetchedMessages.last().id;

      // Prevent rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Limit to 1000 messages to prevent excessive fetching
      if (allMessages.length >= 1000) break;
    } while (fetchedMessages.size === 100);

    // Sort by timestamp (oldest first)
    allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    return allMessages;
  }

  /**
   * Format bytes to human-readable format
   * @param {number} bytes - Number of bytes
   * @returns {string} - Formatted string
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }
}

module.exports = TranscriptManager;
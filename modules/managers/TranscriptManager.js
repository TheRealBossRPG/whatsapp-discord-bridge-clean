// modules/managers/TranscriptManager.js
const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const path = require("path");
const fs = require("fs");
const MediaManager = require("../../utils/MediaManager");

/**
 * Manages chat transcripts
 */
class TranscriptManager {
  /**
   * Create transcript manager
   * @param {Object} options - Options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || "default";
    this.transcriptChannelId = options.transcriptChannelId || null;
    this.discordClient = options.discordClient || null;
    this.guildId = options.guildId || null;
    this.isDisabled = false;

    // Set up media manager
    this.baseDir =
      options.baseDir ||
      path.join(
        __dirname,
        "..",
        "..",
        "instances",
        this.instanceId,
        "transcripts"
      );
    this.mediaManager = new MediaManager({
      instanceId: this.instanceId,
      baseDir: this.baseDir,
    });

    console.log(`[TranscriptManager:${this.instanceId}] Initialized`);
  }

  /**
   * Set custom base directory
   * @param {string} dir - Base directory
   */
  setBaseDir(dir) {
    this.baseDir = dir;
    this.mediaManager.baseDir = dir;
  }

  /**
   * Find existing transcript folder for a phone number
   * @param {string} phoneNumber - Phone number to find
   * @returns {string|null} - Path to folder if found, null otherwise
   */
  findExistingFolderByPhone(phoneNumber) {
    try {
      if (!phoneNumber || !this.baseDir || !fs.existsSync(this.baseDir)) {
        return null;
      }

      // Clean phone number for consistent matching
      const cleanPhone = phoneNumber.replace(/\D/g, "");

      // Get all directories in the base folder
      const items = fs.readdirSync(this.baseDir, { withFileTypes: true });

      for (const item of items) {
        if (item.isDirectory()) {
          // Check if directory name contains the phone number in parentheses
          const dirName = item.name;
          if (dirName.includes(`(${cleanPhone})`) || dirName === cleanPhone) {
            return path.join(this.baseDir, dirName);
          }
        }
      }

      return null;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error finding folder by phone:`,
        error
      );
      return null;
    }
  }

  /**
   * Update username in folder name and transcript content
   * @param {string} phoneNumber - Phone number
   * @param {string} oldUsername - Old username
   * @param {string} newUsername - New username
   * @returns {Promise<boolean>} - Success status
   */
  async updateUsernameInTranscripts(phoneNumber, oldUsername, newUsername) {
    try {
      if (!phoneNumber || !oldUsername || !newUsername) {
        return false;
      }

      console.log(
        `[TranscriptManager:${this.instanceId}] Updating username in transcripts from ${oldUsername} to ${newUsername}`
      );

      // First check for existing folder with exact old format
      let oldDir = this.getUserDir(phoneNumber, oldUsername);

      // If not found, try to find by phone number
      if (!fs.existsSync(oldDir)) {
        const existingFolder = this.findExistingFolderByPhone(phoneNumber);
        if (existingFolder) {
          oldDir = existingFolder;
          console.log(
            `[TranscriptManager:${this.instanceId}] Found existing folder by phone: ${oldDir}`
          );
        } else {
          console.log(
            `[TranscriptManager:${this.instanceId}] No existing transcript folder found for ${phoneNumber}`
          );
          return false;
        }
      }

      // Get new directory path
      const newDir = this.getUserDir(phoneNumber, newUsername);

      // Update transcripts in the folder - find all HTML and master transcripts
      const files = fs.readdirSync(oldDir);
      const transcriptFiles = files.filter(
        (file) =>
          (file.endsWith(".html") && file.startsWith("transcript-")) ||
          file === "transcript-master.html"
      );

      // Update each transcript file
      for (const file of transcriptFiles) {
        const filePath = path.join(oldDir, file);
        try {
          // Read file content
          let content = fs.readFileSync(filePath, "utf8");

          // Replace all instances of old username with new username
          const escapeRegExp = (string) =>
            string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(escapeRegExp(oldUsername), "g");
          content = content.replace(regex, newUsername);

          // Update user info in the header section if it exists
          content = content.replace(
            /<p><strong>User:<\/strong> .*?<\/p>/,
            `<p><strong>User:</strong> ${newUsername}</p>`
          );

          // Write updated content back to file
          fs.writeFileSync(filePath, content, "utf8");
          console.log(
            `[TranscriptManager:${this.instanceId}] Updated username in transcript: ${file}`
          );
        } catch (fileError) {
          console.error(
            `[TranscriptManager:${this.instanceId}] Error updating transcript ${file}:`,
            fileError
          );
        }
      }

      // Create parent directory for new path if needed
      const parentDir = path.dirname(newDir);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Now rename the directory if paths are different
      if (oldDir !== newDir) {
        fs.renameSync(oldDir, newDir);
        console.log(
          `[TranscriptManager:${this.instanceId}] Renamed transcript folder from ${oldDir} to ${newDir}`
        );
      }

      return true;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error updating username in transcripts:`,
        error
      );
      return false;
    }
  }

  /**
   * Create or update master transcript
   * @param {Object} channel - Discord channel
   * @param {string} username - Username
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<string>} - Path to master transcript
   */
  async createOrUpdateMasterTranscript(channel, username, phoneNumber) {
    try {
      // Get user directory
      const userDir = this.getUserDir(phoneNumber, username);

      // Ensure directory exists
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      // Path to master transcript
      const masterPath = path.join(userDir, "transcript-master.html");

      // Check if master transcript already exists
      const masterExists = fs.existsSync(masterPath);

      // Fetch messages from the channel (up to 100)
      const messages = await channel.messages.fetch({ limit: 100 });

      // Sort messages by timestamp (oldest first)
      const sortedMessages = Array.from(messages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      // Start building HTML or get existing content
      let html;

      if (masterExists) {
        // Read existing master transcript
        const existingHtml = fs.readFileSync(masterPath, "utf8");

        // Extract the main body part before the closing tags
        const bodyEndIndex = existingHtml.lastIndexOf("</div>");
        if (bodyEndIndex !== -1) {
          html = existingHtml.substring(0, bodyEndIndex);
        } else {
          // If we can't find the end point, start fresh
          html = this.createTranscriptHeader(username, phoneNumber);
        }

        // Add a separator for new content
        html += `
  <div class="separator">
    <hr>
    <p class="update-info">--- Updated on ${new Date().toLocaleString()} ---</p>
    <hr>
  </div>`;
      } else {
        // Create new transcript with header
        html = this.createTranscriptHeader(username, phoneNumber);
      }

      // Add latest messages
      html += this.formatMessagesHtml(sortedMessages);

      // Close HTML
      html += `
</body>
</html>`;

      // Write file
      fs.writeFileSync(masterPath, html, "utf8");
      console.log(
        `[TranscriptManager:${this.instanceId}] ${
          masterExists ? "Updated" : "Created"
        } master transcript at ${masterPath}`
      );

      return masterPath;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error with master transcript:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create transcript header HTML
   * @param {string} username - Username
   * @param {string} phoneNumber - Phone number
   * @returns {string} - HTML header
   */
  createTranscriptHeader(username, phoneNumber) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ticket Transcript: ${username}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    .header {
      background-color: #5865F2;
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .info {
      background-color: #f9f9f9;
      border-left: 5px solid #5865F2;
      padding: 10px 20px;
      margin-bottom: 20px;
    }
    .message {
      padding: 10px;
      border-bottom: 1px solid #eee;
      display: flex;
    }
    .message:nth-child(odd) {
      background-color: #f9f9f9;
    }
    .message .author {
      font-weight: bold;
      margin-right: 10px;
      min-width: 120px;
    }
    .message .content {
      flex: 1;
    }
    .message .time {
      color: #777;
      font-size: 0.8em;
    }
    .attachment {
      margin-top: 5px;
      background-color: #f1f1f1;
      padding: 5px;
      border-radius: 5px;
    }
    .embed {
      border-left: 4px solid #5865F2;
      padding: 8px;
      margin: 5px 0;
      background-color: #f1f1f1;
    }
    .separator {
      text-align: center;
      color: #5865F2;
      margin: 20px 0;
    }
    .update-info {
      font-style: italic;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Support Ticket Transcript</h1>
  </div>
  <div class="info">
    <p><strong>User:</strong> ${username}</p>
    <p><strong>WhatsApp:</strong> ${phoneNumber}</p>
    <p><strong>Instance:</strong> ${this.instanceId}</p>
    <p><strong>First Created:</strong> ${new Date().toLocaleString()}</p>
  </div>
  <h2>Messages</h2>
`;
  }

  /**
   * Format messages as HTML
   * @param {Array} messages - Array of Discord messages
   * @returns {string} - HTML content
   */
  formatMessagesHtml(messages) {
    let html = "";

    for (const message of messages) {
      const author = message.member?.nickname || message.author.username;
      const isBot = message.author.bot;
      const botPrefix = isBot ? "[BOT] " : "";

      html += `
  <div class="message">
    <div class="author">${botPrefix}${author}</div>
    <div class="content">
      <div class="time">${message.createdAt.toLocaleString()}</div>
      <div class="text">${message.content || ""}</div>`;

      // Add attachments
      if (message.attachments.size > 0) {
        for (const [id, attachment] of message.attachments) {
          html += `
      <div class="attachment">
        <a href="${attachment.url}" target="_blank">${attachment.name}</a>
        ${
          attachment.contentType?.startsWith("image/")
            ? `<br><img src="${attachment.url}" alt="${attachment.name}" style="max-width:400px; max-height:300px;">`
            : ""
        }
      </div>`;
        }
      }

      // Add embeds
      if (message.embeds.length > 0) {
        for (const embed of message.embeds) {
          html += `
      <div class="embed">
        ${embed.title ? `<div><strong>${embed.title}</strong></div>` : ""}
        ${embed.description ? `<div>${embed.description}</div>` : ""}`;

          if (embed.fields.length > 0) {
            for (const field of embed.fields) {
              html += `
        <div><strong>${field.name}:</strong> ${field.value}</div>`;
            }
          }

          html += `
      </div>`;
        }
      }

      html += `
    </div>
  </div>`;
    }

    return html;
  }

  /**
   * Create and save transcript
   * @param {Object} channel - Discord channel
   * @param {string} username - Username
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<string>} - Path to transcript
   */
  async createAndSaveTranscript(channel, username, phoneNumber) {
    try {
      // Check if disabled
      if (this.isDisabled) {
        console.log(
          `[TranscriptManager:${this.instanceId}] Transcript creation disabled`
        );
        return null;
      }

      // First update or create master transcript
      const masterTranscriptPath = await this.createOrUpdateMasterTranscript(
        channel,
        username,
        phoneNumber
      );

      // Create a timestamped copy for this specific closure
      const userDir = this.getUserDir(phoneNumber, username);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `transcript-${timestamp}.html`;
      const filepath = path.join(userDir, filename);

      // Copy the master transcript to the timestamped version
      fs.copyFileSync(masterTranscriptPath, filepath);

      console.log(
        `[TranscriptManager:${this.instanceId}] Created timestamped transcript copy at ${filepath}`
      );

      // Send to transcript channel if available
      if (this.transcriptChannelId && this.discordClient && this.guildId) {
        await this.sendTranscriptToChannel(filepath, username, phoneNumber);
      }

      return filepath;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error creating transcript:`,
        error
      );
      throw error;
    }
  }

  /**
   * Send transcript to channel
   * @param {string} filepath - Path to transcript
   * @param {string} username - Username
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<boolean>} - Success
   */
  async sendTranscriptToChannel(filepath, username, phoneNumber) {
    try {
      // Check if we have what we need
      if (!this.transcriptChannelId || !this.discordClient || !this.guildId) {
        console.log(
          `[TranscriptManager:${this.instanceId}] Missing information to send transcript to channel`
        );
        return false;
      }

      // Get guild
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(
          `[TranscriptManager:${this.instanceId}] Guild not found: ${this.guildId}`
        );
        return false;
      }

      // Get channel
      const channel = guild.channels.cache.get(this.transcriptChannelId);
      if (!channel) {
        console.error(
          `[TranscriptManager:${this.instanceId}] Channel not found: ${this.transcriptChannelId}`
        );
        return false;
      }

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Ticket Transcript")
        .setDescription(`Support ticket transcript for ${username}`)
        .addFields(
          { name: "User", value: username, inline: true },
          {
            name: "WhatsApp",
            value: phoneNumber.replace(/@.*$/, ""),
            inline: true,
          },
          { name: "Date", value: new Date().toLocaleString(), inline: true }
        )
        .setTimestamp();

      // Create attachment
      const attachment = new AttachmentBuilder(filepath, {
        name: `transcript-${username
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")}-${Date.now()}.html`,
      });

      // Send to channel
      await channel.send({ embeds: [embed], files: [attachment] });
      console.log(
        `[TranscriptManager:${this.instanceId}] Sent transcript to channel ${this.transcriptChannelId}`
      );

      return true;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error sending transcript to channel:`,
        error
      );
      return false;
    }
  }

  /**
   * Add a user message to the transcript
   * @param {string} userId - User ID or phone number
   * @param {string} username - User's name
   * @param {string} message - Message content
   * @param {Date} timestamp - Message timestamp
   * @param {boolean} isMedia - Whether the message is media
   * @returns {boolean} - Success status
   */
  addUserMessage(
    userId,
    username,
    message,
    timestamp = new Date(),
    isMedia = false
  ) {
    try {
      // Skip if transcripts are disabled
      if (this.isDisabled) {
        return true;
      }

      // Initialize user's transcript array if it doesn't exist
      if (!this.transcripts) {
        this.transcripts = {};
      }

      if (!this.transcripts[userId]) {
        this.transcripts[userId] = {
          username: username || "Unknown User",
          messages: [],
        };
      }

      // Add message to transcript
      this.transcripts[userId].messages.push({
        isBot: false,
        username: username,
        content: message,
        timestamp: timestamp,
        isMedia: isMedia,
      });

      console.log(
        `[TranscriptManager:${
          this.instanceId
        }] Added user message to transcript for ${username || userId}`
      );
      return true;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error adding user message:`,
        error
      );
      return false;
    }
  }

  /**
   * Update the user directory name when username changes
   * @param {string} phoneNumber - Phone number
   * @param {string} oldUsername - Old username
   * @param {string} newUsername - New username
   * @returns {Promise<boolean>} - Success status
   */
  async updateUsername(phoneNumber, oldUsername, newUsername) {
    try {
      if (!phoneNumber || !oldUsername || !newUsername) {
        console.log(
          `[TranscriptManager:${this.instanceId}] Missing parameters for updateUsername`
        );
        return false;
      }

      console.log(
        `[TranscriptManager:${this.instanceId}] Updating username from ${oldUsername} to ${newUsername} for ${phoneNumber}`
      );

      // Get old and new directory paths
      const oldDir = this.getUserDir(phoneNumber, oldUsername);
      const newDir = this.getUserDir(phoneNumber, newUsername);

      // Check if old directory exists
      if (!fs.existsSync(oldDir)) {
        console.log(
          `[TranscriptManager:${this.instanceId}] Old directory not found: ${oldDir}`
        );
        // Check alternative formats for the old directory
        const alternativePaths = [
          path.join(this.baseDir, `${oldUsername}(${phoneNumber})`),
          path.join(this.baseDir, `${oldUsername} (${phoneNumber})`),
          path.join(this.baseDir, `${oldUsername}-${phoneNumber}`),
          path.join(this.baseDir, phoneNumber),
          path.join(this.baseDir, `${phoneNumber}/${oldUsername}`),
        ];

        let foundPath = null;
        for (const altPath of alternativePaths) {
          if (fs.existsSync(altPath)) {
            foundPath = altPath;
            console.log(
              `[TranscriptManager:${this.instanceId}] Found alternative path: ${altPath}`
            );
            break;
          }
        }

        if (!foundPath) {
          console.log(
            `[TranscriptManager:${this.instanceId}] No existing directory found for ${phoneNumber} with username ${oldUsername}`
          );
          return false;
        }

        // Set oldDir to the found path
        oldDir = foundPath;
      }

      // Ensure parent directory exists for new path
      const parentDir = path.dirname(newDir);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Rename directory
      fs.renameSync(oldDir, newDir);
      console.log(
        `[TranscriptManager:${this.instanceId}] Renamed directory from ${oldDir} to ${newDir}`
      );

      return true;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error updating username:`,
        error
      );
      return false;
    }
  }

  /**
   * Get user directory - made more robust to handle edge cases
   * @param {string} phoneNumber - Phone number
   * @param {string} username - Username
   * @returns {string} - Directory path
   */
  getUserDir(phoneNumber, username) {
    if (!phoneNumber) {
      return path.join(this.baseDir, "unknown");
    }

    // Clean phone number
    const cleanPhone = phoneNumber.replace(/\D/g, "").replace(/^(\+|00)/, "");

    // If username is provided, use it
    if (username) {
      // Format directory name consistently
      return path.join(this.baseDir, `${username} (${cleanPhone})`);
    }

    // If no username, just use phone number
    return path.join(this.baseDir, cleanPhone);
  }

  /**
   * Get transcripts directory
   * @param {string} phoneNumber - Phone number
   * @param {string} username - Username
   * @returns {string} - Directory path
   */
  getTranscriptsDir(phoneNumber, username) {
    return this.mediaManager.getTranscriptsDir(phoneNumber, username);
  }
}

module.exports = TranscriptManager;

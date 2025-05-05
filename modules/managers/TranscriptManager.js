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
  async updateUsername(phoneNumber, oldUsername, newUsername) {
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

      // Find the master transcript file
      const sanitizedNewUsername = newUsername.replace(/[^a-zA-Z0-9]/g, "-");
      const masterFilename = `${sanitizedNewUsername}-transcript-master.html`;
      const oldMasterPath = path.join(oldDir, "transcript-master.html");
      const newMasterPath = path.join(newDir, masterFilename);

      // Look for any master transcript file patterns
      let masterPath = null;
      let masterContent = null;

      if (fs.existsSync(oldMasterPath)) {
        masterPath = oldMasterPath;
      } else {
        // Look for any HTML files that might be transcripts
        const files = fs.readdirSync(oldDir);
        for (const file of files) {
          if (file.endsWith(".html") && file.includes("transcript")) {
            masterPath = path.join(oldDir, file);
            break;
          }
        }
      }

      // If we found a master file, update its content
      if (masterPath && fs.existsSync(masterPath)) {
        masterContent = fs.readFileSync(masterPath, "utf8");

        // Replace all instances of old username with new username
        const escapeRegExp = (string) =>
          string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const regex = new RegExp(escapeRegExp(oldUsername), "g");
        masterContent = masterContent.replace(regex, newUsername);

        // Update user info in the header section if it exists
        masterContent = masterContent.replace(
          /<p><strong>User:<\/strong> .*?<\/p>/,
          `<p><strong>User:</strong> ${newUsername}</p>`
        );

        // Update author names in message divs
        const authorRegex = new RegExp(
          `<div class="author">${escapeRegExp(oldUsername)}</div>`,
          "g"
        );
        masterContent = masterContent.replace(
          authorRegex,
          `<div class="author">${newUsername}</div>`
        );
      }

      // Create parent directory for new path if needed
      if (!fs.existsSync(newDir) && newDir !== oldDir) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      // Save updated content to new location if we have it
      if (masterContent) {
        fs.writeFileSync(newMasterPath, masterContent, "utf8");
        console.log(
          `[TranscriptManager:${this.instanceId}] Updated and saved master transcript to ${newMasterPath}`
        );

        // If paths are different and old file exists, delete it
        if (masterPath !== newMasterPath && fs.existsSync(masterPath)) {
          fs.unlinkSync(masterPath);
          console.log(
            `[TranscriptManager:${this.instanceId}] Deleted old master transcript: ${masterPath}`
          );
        }
      }

      // Now rename the directory if paths are different
      if (oldDir !== newDir) {
        // Copy all other files if any
        const files = fs.readdirSync(oldDir);
        for (const file of files) {
          // Skip HTML files as we've already handled the master
          if (file.endsWith(".html") && file.includes("transcript")) {
            continue;
          }

          const oldFilePath = path.join(oldDir, file);
          const newFilePath = path.join(newDir, file);

          // Copy file
          fs.copyFileSync(oldFilePath, newFilePath);
        }

        // Delete old directory with all its contents
        this.deleteDirectory(oldDir);

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
   * Update username in transcript content
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

      // Look for any master transcript file patterns
      let masterFiles = [];
      const files = fs.readdirSync(oldDir);
      for (const file of files) {
        if (file.endsWith(".html") && file.includes("transcript")) {
          masterFiles.push(file);
        }
      }

      // Process each found file
      let updatedAnyFile = false;
      for (const file of masterFiles) {
        const oldFilePath = path.join(oldDir, file);

        try {
          // Read file content
          let content = fs.readFileSync(oldFilePath, "utf8");

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

          // Update author names in message divs
          const authorRegex = new RegExp(
            `<div class="author">${escapeRegExp(oldUsername)}</div>`,
            "g"
          );
          content = content.replace(
            authorRegex,
            `<div class="author">${newUsername}</div>`
          );

          // Create the new filename using the updated username
          const sanitizedNewUsername = newUsername.replace(
            /[^a-zA-Z0-9]/g,
            "-"
          );
          const newFilename = `${sanitizedNewUsername}-transcript-master.html`;
          const newFilePath = path.join(newDir, newFilename);

          // Ensure the directory exists
          if (!fs.existsSync(path.dirname(newFilePath))) {
            fs.mkdirSync(path.dirname(newFilePath), { recursive: true });
          }

          // Write updated content to new file location
          fs.writeFileSync(newFilePath, content, "utf8");
          console.log(
            `[TranscriptManager:${this.instanceId}] Updated username in transcript: ${file} -> ${newFilename}`
          );

          // If this isn't the target master file, delete it after copying
          if (oldFilePath !== newFilePath) {
            fs.unlinkSync(oldFilePath);
            console.log(
              `[TranscriptManager:${this.instanceId}] Deleted old transcript: ${oldFilePath}`
            );
          }

          updatedAnyFile = true;
        } catch (fileError) {
          console.error(
            `[TranscriptManager:${this.instanceId}] Error updating transcript ${file}:`,
            fileError
          );
        }
      }

      // If directories are different, move any other files and delete old dir
      if (oldDir !== newDir) {
        // Ensure new directory exists
        if (!fs.existsSync(newDir)) {
          fs.mkdirSync(newDir, { recursive: true });
        }

        // Copy any remaining files
        const remainingFiles = fs.readdirSync(oldDir);
        for (const file of remainingFiles) {
          const oldFilePath = path.join(oldDir, file);
          const newFilePath = path.join(newDir, file);

          // Copy the file if it's not an HTML transcript
          if (!file.endsWith(".html") || !file.includes("transcript")) {
            fs.copyFileSync(oldFilePath, newFilePath);
          }
        }

        // Try to delete the old directory
        this.deleteDirectory(oldDir);

        console.log(
          `[TranscriptManager:${this.instanceId}] Renamed transcript folder from ${oldDir} to ${newDir}`
        );
      }

      return updatedAnyFile || oldDir !== newDir;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error updating username in transcripts:`,
        error
      );
      return false;
    }
  }

  /**
   * Recursively delete a directory and all its contents
   * @param {string} dirPath - Directory path
   */
  deleteDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) return;

    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);

      if (fs.statSync(filePath).isDirectory()) {
        this.deleteDirectory(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    }

    fs.rmdirSync(dirPath);
    console.log(
      `[TranscriptManager:${this.instanceId}] Deleted directory: ${dirPath}`
    );
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

      // Create master transcript filename
      const sanitizedUsername = username.replace(/[^a-zA-Z0-9]/g, "-");
      const masterFilename = `${sanitizedUsername}-transcript-master.html`;
      const userDir = this.getUserDir(phoneNumber, username);

      // Ensure directory exists
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      // Path to master transcript
      const masterPath = path.join(userDir, masterFilename);
      const masterExists = fs.existsSync(masterPath);

      // Fetch messages from the channel (up to 100)
      const messages = await channel.messages.fetch({ limit: 100 });

      // Sort messages by timestamp (oldest first)
      const sortedMessages = Array.from(messages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      // Filter out system messages and only keep user/staff messages
      const filteredMessages = this.filterMessagesForTranscript(sortedMessages);

      let html = "";

      if (masterExists) {
        // If master exists, read it and append new messages
        console.log(
          `[TranscriptManager:${this.instanceId}] Found existing master transcript, appending new messages`
        );
        const existingHtml = fs.readFileSync(masterPath, "utf8");

        // Find where to insert new content (before closing body/html tags)
        const insertPosition = existingHtml.lastIndexOf("</body>");

        if (insertPosition !== -1) {
          // Create a separator for the new session
          const separator = `
  <div class="separator">
    <hr>
    <p class="update-info">--- New conversation on ${new Date().toLocaleString()} ---</p>
    <hr>
  </div>`;

          // Build HTML by inserting new content before closing tags
          html =
            existingHtml.substring(0, insertPosition) +
            separator +
            this.formatMessagesHtml(filteredMessages) +
            existingHtml.substring(insertPosition);

          // Update the "Last Updated" timestamp
          html = html.replace(
            /<p><strong>Last Updated:<\/strong>.*?<\/p>/,
            `<p><strong>Last Updated:</strong> ${new Date().toLocaleString()}</p>`
          );
        } else {
          // If we can't find insertion point, create new content but preserve history
          console.log(
            `[TranscriptManager:${this.instanceId}] Couldn't find insertion point, rebuilding transcript`
          );
          html = this.createTranscriptContent(
            username,
            phoneNumber,
            filteredMessages
          );
        }
      } else {
        // If master doesn't exist, create new content
        console.log(
          `[TranscriptManager:${this.instanceId}] Creating new master transcript`
        );
        html = this.createTranscriptContent(
          username,
          phoneNumber,
          filteredMessages
        );
      }

      // Write to master file
      fs.writeFileSync(masterPath, html, "utf8");
      console.log(
        `[TranscriptManager:${this.instanceId}] Updated master transcript at ${masterPath}`
      );

      // If we need to send to a transcript channel, create a temporary copy
      if (this.transcriptChannelId && this.discordClient && this.guildId) {
        // Create a temporary copy for sending to the channel
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const tempFilename = `temp-transcript-${timestamp}.html`;
        const tempPath = path.join(userDir, tempFilename);

        // Copy the master to temp file
        fs.copyFileSync(masterPath, tempPath);

        // Send to transcript channel
        await this.sendTranscriptToChannel(tempPath, username, phoneNumber);

        // Delete the temporary file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
          console.log(
            `[TranscriptManager:${this.instanceId}] Deleted temporary transcript: ${tempPath}`
          );
        }

        // Return the master path since the temp file is deleted
        return masterPath;
      }

      return masterPath;
    } catch (error) {
      console.error(
        `[TranscriptManager:${this.instanceId}] Error creating transcript:`,
        error
      );
      throw error;
    }
  }

  /**
   * Filter out system messages and only keep user/staff messages
   * @param {Array} messages - Array of Discord messages
   * @returns {Array} - Filtered messages
   */
  filterMessagesForTranscript(messages) {
    return messages.filter((message) => {
      // Skip messages with no content or embed-only messages from the bot
      if (message.author.bot) {
        // Check if this is a system message we want to skip
        const isSystemMessage =
          // Skip transcript messages
          message.content.includes("Transcript") ||
          // Skip ticket tool embeds
          (message.embeds.length > 0 &&
            (message.embeds[0].title === "Ticket Tool" ||
              message.embeds[0].title === "Support Ticket Transcript" ||
              message.embeds.some(
                (embed) =>
                  embed.description && embed.description.includes("transcript")
              ))) ||
          // Skip countdown messages
          message.content.includes("ticket will be closed in") ||
          // Skip transcript notes
          message.content.includes(
            "All messages in this channel will be included"
          );

        return !isSystemMessage;
      }

      // Keep real user messages
      return true;
    });
  }

  /**
   * Create complete transcript HTML content
   * @param {string} username - Username
   * @param {string} phoneNumber - Phone number
   * @param {Array} messages - Filtered messages
   * @returns {string} - Complete HTML content
   */
  createTranscriptContent(username, phoneNumber, messages) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Support Ticket: ${username}</title>
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
    <p><strong>Last Updated:</strong> ${new Date().toLocaleString()}</p>
  </div>
  <h2>Conversation</h2>
  ${this.formatMessagesHtml(messages)}
</body>
</html>`;
  }

  /**
   * Format messages as HTML, filtering out system messages
   * @param {Array} messages - Array of Discord messages
   * @returns {string} - HTML content
   */
  formatMessagesHtml(messages) {
    let html = "";

    for (const message of messages) {
      // Skip empty messages
      if (
        !message.content &&
        message.attachments.size === 0 &&
        message.embeds.length === 0
      ) {
        continue;
      }

      // Get the author name
      let authorName = message.member?.nickname || message.author.username;

      // If the message is from a bot and is a user message (from WhatsApp)
      const isWhatsAppUserMessage =
        message.author.bot &&
        message.content.includes("**") &&
        message.content.includes(":");

      if (isWhatsAppUserMessage) {
        // Extract the username from the message format "**Username**: message"
        const match = message.content.match(/^\*\*(.*?)\*\*:/);
        if (match && match[1]) {
          authorName = match[1];
          // Remove the prefix from the content
          message.content = message.content.replace(/^\*\*.*?\*\*: /, "");
        }
      }

      html += `
  <div class="message">
    <div class="author">${authorName}</div>
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

      // Only include relevant embeds (skip ticket tool embeds)
      const relevantEmbeds = message.embeds.filter(
        (embed) =>
          embed.title !== "Ticket Tool" &&
          !embed.description?.includes("transcript") &&
          !embed.title?.includes("Transcript")
      );

      if (relevantEmbeds.length > 0) {
        for (const embed of relevantEmbeds) {
          html += `
      <div class="embed">
        ${embed.title ? `<div><strong>${embed.title}</strong></div>` : ""}
        ${embed.description ? `<div>${embed.description}</div>` : ""}`;

          if (embed.fields && embed.fields.length > 0) {
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

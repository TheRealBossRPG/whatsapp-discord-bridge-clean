// modules/MediaManager.js - FIXED VERSION

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * MediaManager class for handling media storage and directory structure
 * CRITICAL FIX: Complete rewrite to address username/phone number separation
 */
class MediaManager {
  constructor(options = {}) {
    // Set instance ID - critical for isolation
    this.instanceId = options.instanceId || "default";

    // Base directory for all storage
    this.baseDir =
      options.baseDir ||
      path.join(__dirname, "..", "instances", this.instanceId, "transcripts");

    // Cache for phone-to-username mapping (CLEAN phone numbers without @s.whatsapp.net)
    this.phoneNumberCache = new Map();

    // Cache for media file hashes (for deduplication)
    this.mediaHashCache = new Map();

    // Create essential directories
    this.ensureBaseDir();

    console.log(
      `[MediaManager:${this.instanceId}] Initialized with base directory: ${this.baseDir}`
    );
  }

  /**
   * Ensure base directory exists
   */
  ensureBaseDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
      console.log(
        `[MediaManager:${this.instanceId}] Created base directory: ${this.baseDir}`
      );
    }
  }

  /**
   * Set the instance ID
   * @param {string} instanceId - Instance ID to use
   */
  setInstanceId(instanceId) {
    if (!instanceId) {
      console.warn(
        `[MediaManager:${this.instanceId}] Warning: Attempted to set null instanceId`
      );
      return;
    }

    // Only update if the instance ID actually changed
    if (this.instanceId !== instanceId) {
      console.log(
        `[MediaManager:${this.instanceId}] Changing instance ID from ${this.instanceId} to ${instanceId}`
      );

      // Clear caches when changing instances to prevent data leakage
      this.phoneNumberCache = new Map();
      this.mediaHashCache = new Map();

      this.instanceId = instanceId;

      // Update base directory for the new instance
      this.baseDir = path.join(
        __dirname,
        "..",
        "instances",
        this.instanceId,
        "transcripts"
      );
      this.ensureBaseDir();

      console.log(
        `[MediaManager:${this.instanceId}] Set instance ID to ${instanceId}, using base directory: ${this.baseDir}`
      );
    }
  }

  /**
   * CRITICAL FUNCTION: Clean phone number for consistent storage
   * Strips all WhatsApp extensions and formatting
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} - Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return "unknown";

    // Convert to string first
    let clean = String(phoneNumber);

    // Remove WhatsApp extensions (be thorough)
    clean = clean
      .replace(/@s\.whatsapp\.net/g, "")
      .replace(/@c\.us/g, "")
      .replace(/@g\.us/g, "")
      .replace(/@broadcast/g, "")
      .replace(/@.*$/, "");

    // Remove any non-digit characters except possibly leading '+' sign
    if (clean.startsWith("+")) {
      clean = "+" + clean.substring(1).replace(/[^0-9]/g, "");
    } else {
      clean = clean.replace(/[^0-9]/g, "");
    }

    return clean;
  }

  /**
   * CRITICAL FUNCTION: Extract clean username WITHOUT phone number
   * @param {string} username - Raw username (may contain phone number)
   * @returns {string} - Clean username
   */
  extractCleanUsername(username) {
    if (!username) return "unknown";

    // Convert to string and trim
    let clean = String(username).trim();

    // Remove phone number if it's in parentheses at the end
    clean = clean.replace(/\([^)]*\)$/, "").trim();

    // Also check for WhatsApp extensions directly in the username
    clean = clean
      .replace(/@s\.whatsapp\.net/g, "")
      .replace(/@c\.us/g, "")
      .replace(/@g\.us/g, "")
      .replace(/@broadcast/g, "")
      .replace(/@.*$/, "")
      .trim();

    // Remove just numbers that look like phone numbers (10+ digits)
    clean = clean.replace(/\s+\d{10,}$/, "").trim();
    clean = clean.replace(/^\d{10,}\s+/, "").trim();

    // Check for phone numbers that might be separated by hyphens, spaces, etc.
    clean = clean.replace(/\s+\d{3}[\s-]*\d{3}[\s-]*\d{4}$/, "").trim();

    // If username is now empty, use 'unknown'
    if (!clean) return "unknown";

    return clean;
  }

  /**
   * Format display name for UI presentation - NO phone number included
   * @param {string} username - Username (may include phone number)
   * @param {string} phoneNumber - Phone number (unused, for compatibility)
   * @returns {string} - Clean display name
   */
  formatDisplayName(username) {
    return this.extractCleanUsername(username);
  }

  /**
   * Format directory name for folder structure - NO phone number included
   * @param {string} username - Username
   * @returns {string} - Safe directory name
   */
  formatDirectoryName(username) {
    // Get clean username without phone number
    const clean = this.extractCleanUsername(username);

    // Make filesystem safe: lowercase, replace spaces with hyphens, remove special chars
    return clean
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  /**
   * Set phone number to username mapping
   * CRITICAL FIX: Store ONLY the clean username without phone
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name (may include phone)
   */
  setPhoneToUsername(phoneNumber, username) {
    if (!phoneNumber || !username) {
      console.log(
        `[MediaManager:${this.instanceId}] Skipping invalid phone-username mapping: ${phoneNumber} -> ${username}`
      );
      return;
    }

    // Clean the phone number
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);

    // Extract clean username (no phone number)
    const cleanUsername = this.extractCleanUsername(username);

    console.log(
      `[MediaManager:${this.instanceId}] MAPPING: Setting phone ${cleanPhone} to clean username "${cleanUsername}"`
    );

    // Check if we already have a mapping for this phone
    const existingUsername = this.phoneNumberCache.get(cleanPhone);

    // If we don't have a mapping or it's different, update it
    if (!existingUsername || existingUsername !== cleanUsername) {
      // FIRST: Store the new mapping BEFORE doing anything else
      this.phoneNumberCache.set(cleanPhone, cleanUsername);

      // If we had a different username before, handle directory renaming
      if (existingUsername && existingUsername !== cleanUsername) {
        this.renameUserDirectory(cleanPhone, existingUsername, cleanUsername);
      } else {
        // Otherwise just ensure directories exist
        this.ensureUserDirectories(cleanPhone, cleanUsername);
      }
    }
  }

  /**
   * Get username from phone number
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Username or null if not found
   */
  getUsernameFromPhone(phoneNumber) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    return this.phoneNumberCache.get(cleanPhone) || null;
  }

  /**
   * Get user directory path - FIXED for consistent structure
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name (may include phone)
   * @returns {string} - Path to user directory
   */
  /**
   * Get user directory path - FIXED for consistent structure
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name (may include phone)
   * @returns {string} - Path to user directory
   */
  getUserDir(phoneNumber, username) {
    // Clean the phone number
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);

    // IMPROVED: Better username handling - check phone cache first
    let cleanUsername = null;

    // First try getting from cache
    if (this.phoneNumberCache.has(cleanPhone)) {
      cleanUsername = this.phoneNumberCache.get(cleanPhone);
      console.log(
        `[MediaManager:${this.instanceId}] Using cached username "${cleanUsername}" for ${cleanPhone}`
      );
    }

    // If no username in cache but username provided, extract and use it
    if (!cleanUsername && username) {
      cleanUsername = this.extractCleanUsername(username);

      // Important: Save this mapping to the cache
      if (cleanUsername) {
        this.phoneNumberCache.set(cleanPhone, cleanUsername);
        console.log(
          `[MediaManager:${this.instanceId}] Saved username "${cleanUsername}" for ${cleanPhone} to cache`
        );
      }
    }

    // If still no username, use unknown
    if (!cleanUsername) {
      cleanUsername = "unknown";
    }

    // Format for safe directory name
    const safeDirName = this.formatDirectoryName(cleanUsername);

    // IMPORTANT: Log the directory name we're using
    console.log(
      `[MediaManager:${this.instanceId}] Using directory name "${safeDirName}" for user ${cleanPhone}`
    );

    // CHANGED: Include phone number in directory name with parentheses
    const dirNameWithPhone = `${safeDirName}(${cleanPhone})`;

    // SIMPLIFIED STRUCTURE: baseDir/username(phone)
    return path.join(this.baseDir, dirNameWithPhone);
  }

  /**
   * Ensure user directories exist
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name
   * @returns {Object} - Directory paths
   */
  ensureUserDirectories(phoneNumber, username) {
    const userDir = this.getUserDir(phoneNumber, username);

    // Create user directory if it doesn't exist
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
      console.log(
        `[MediaManager:${this.instanceId}] Created user directory: ${userDir}`
      );
    }

    // REMOVED: No longer creating redundant transcripts subdirectory

    return { userDir };
  }

  /**
   * Rename user directory when username changes
   * @param {string} phoneNumber - User's phone number
   * @param {string} oldUsername - Old username
   * @param {string} newUsername - New username
   */
  renameUserDirectory(phoneNumber, oldUsername, newUsername) {
    try {
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);

      // Format directory names
      const safeOldDirName = this.formatDirectoryName(oldUsername);
      const safeNewDirName = this.formatDirectoryName(newUsername);

      // Skip if directory names are the same
      if (safeOldDirName === safeNewDirName) {
        console.log(
          `[MediaManager:${this.instanceId}] Directory names are the same, no need to rename: ${safeOldDirName}`
        );
        return;
      }

      // Include phone number in directory names with parentheses
      const oldDirWithPhone = `${safeOldDirName}(${cleanPhone})`;
      const newDirWithPhone = `${safeNewDirName}(${cleanPhone})`;

      // Get old and new paths
      const oldDir = path.join(this.baseDir, oldDirWithPhone);
      const newDir = path.join(this.baseDir, newDirWithPhone);

      console.log(
        `[MediaManager:${this.instanceId}] Trying to rename directory: ${oldDir} -> ${newDir}`
      );

      // IMPROVED: First collect all possible old directories
      let possibleOldDirs = [
        oldDir, // Format: username(phone)
        path.join(this.baseDir, safeOldDirName), // Format: just username
        path.join(this.baseDir, cleanPhone), // Format: just phone
      ];

      // Find direct match first - exact format
      let foundOldDir = null;
      for (const dirToCheck of possibleOldDirs) {
        if (fs.existsSync(dirToCheck)) {
          console.log(
            `[MediaManager:${this.instanceId}] Found exact match directory: ${dirToCheck}`
          );
          foundOldDir = dirToCheck;
          break;
        }
      }

      // If none of the standard formats match, search for any directory containing this phone number
      if (!foundOldDir) {
        try {
          // Make sure baseDir exists
          if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
            console.log(
              `[MediaManager:${this.instanceId}] Created base directory: ${this.baseDir}`
            );
            // No old directories to process
            return;
          }

          console.log(
            `[MediaManager:${this.instanceId}] Searching for directories with phone number: ${cleanPhone}`
          );
          const baseItems = fs.readdirSync(this.baseDir);

          for (const item of baseItems) {
            const fullPath = path.join(this.baseDir, item);
            if (fs.statSync(fullPath).isDirectory()) {
              if (item.includes(`(${cleanPhone})`) || item === cleanPhone) {
                console.log(
                  `[MediaManager:${this.instanceId}] Found directory with matching phone: ${fullPath}`
                );
                foundOldDir = fullPath;
                break;
              }
            }
          }
        } catch (searchError) {
          console.error(
            `[MediaManager:${this.instanceId}] Error searching for matching directories:`,
            searchError
          );
        }
      }

      // Make sure parent dir exists for new location
      const parentDir = path.dirname(newDir);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Process found directory (if any)
      if (foundOldDir) {
        try {
          // Check if target already exists
          if (fs.existsSync(newDir)) {
            console.log(
              `[MediaManager:${this.instanceId}] Target directory already exists: ${newDir}`
            );
            console.log(
              `[MediaManager:${this.instanceId}] Will merge contents instead of renaming`
            );

            // Copy files from old to new directory
            const files = fs.readdirSync(foundOldDir);
            for (const file of files) {
              const oldFilePath = path.join(foundOldDir, file);
              const newFilePath = path.join(newDir, file);

              // Skip if file already exists in target
              if (fs.existsSync(newFilePath)) {
                console.log(
                  `[MediaManager:${this.instanceId}] File already exists in target: ${file}`
                );
                continue;
              }

              try {
                // Copy the file
                fs.copyFileSync(oldFilePath, newFilePath);
                console.log(
                  `[MediaManager:${this.instanceId}] Copied file: ${file} to new location`
                );
              } catch (copyError) {
                console.error(
                  `[MediaManager:${this.instanceId}] Error copying file ${file}:`,
                  copyError
                );
              }
            }

            // Remove old directory after copying all files
            try {
              console.log(
                `[MediaManager:${this.instanceId}] Removing old directory after merge: ${foundOldDir}`
              );
              fs.rmdirSync(foundOldDir, { recursive: true });
              console.log(
                `[MediaManager:${this.instanceId}] Old directory removed successfully`
              );
            } catch (rmError) {
              console.error(
                `[MediaManager:${this.instanceId}] Error removing old directory:`,
                rmError
              );
            }
          } else {
            // No conflict, just rename the directory
            console.log(
              `[MediaManager:${this.instanceId}] Renaming directory: ${foundOldDir} -> ${newDir}`
            );
            fs.renameSync(foundOldDir, newDir);
            console.log(
              `[MediaManager:${this.instanceId}] Directory renamed successfully`
            );
          }
        } catch (processError) {
          console.error(
            `[MediaManager:${this.instanceId}] Error processing directory:`,
            processError
          );
        }
      } else {
        // No old directory found, create new directory structure
        console.log(
          `[MediaManager:${this.instanceId}] No matching directory found, creating: ${newDir}`
        );
        fs.mkdirSync(newDir, { recursive: true });
      }

      console.log(
        `[MediaManager:${this.instanceId}] Username directory update complete: ${phoneNumber}`
      );
    } catch (error) {
      console.error(
        `[MediaManager:${this.instanceId}] Error renaming user directory:`,
        error
      );
      // Try to create new directories anyway as a fallback
      try {
        this.ensureUserDirectories(phoneNumber, newUsername);
      } catch (createError) {
        console.error(
          `[MediaManager:${this.instanceId}] Error creating user directories:`,
          createError
        );
      }
    }
  }

  /**
   * Get transcripts directory path
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name
   * @returns {string} - Path to transcripts directory
   */
  getTranscriptsDir(phoneNumber, username) {
    // Just return the user directory since we no longer use a separate transcripts subfolder
    return this.getUserDir(phoneNumber, username);
  }

  /**
   * Save transcript file with proper path structure
   * @param {string} username - Username
   * @param {string} content - Transcript content
   * @param {string} ticketName - Optional ticket name
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Path to saved transcript
   */
  saveTranscript(username, content, ticketName = "", phoneNumber = null) {
    try {
      // Add instance ID to content if not already there
      if (!content.includes(`Instance: ${this.instanceId}`)) {
        const instanceLine = `Instance: ${this.instanceId}\n`;
        const lines = content.split("\n");

        // Find appropriate place to insert instance info
        let insertIndex = 0;
        for (let i = 0; i < Math.min(10, lines.length); i++) {
          if (lines[i].includes("WhatsApp:")) {
            insertIndex = i + 1;
            break;
          }
        }

        if (insertIndex > 0) {
          lines.splice(insertIndex, 0, instanceLine);
          content = lines.join("\n");
        }
      }

      // Extract clean username without phone number
      const cleanUsername = this.extractCleanUsername(username);

      // Get clean phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);

      // CHANGED: Get user directory which now includes the phone number
      const userDir = this.getUserDir(cleanPhone, cleanUsername);

      // Create user directory if it doesn't exist
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      // Create a master transcript filename
      const masterFilename = `transcript-master.md`;
      const masterPath = path.join(userDir, masterFilename);

      // Also create a timestamped version for history
      const timestamp = Date.now();
      const safeTicketName = ticketName
        ? this.formatDirectoryName(ticketName)
        : "ticket";
      const timestampedFilename = `transcript-${safeTicketName}-${timestamp}.md`;
      const timestampedPath = path.join(userDir, timestampedFilename);

      // Make sure the content includes the phone number
      if (cleanPhone && !content.includes(`WhatsApp: ${cleanPhone}`)) {
        // Add phone number if not already included
        let phoneSection = `WhatsApp: ${cleanPhone}\n\n`;

        if (content.includes("WhatsApp:")) {
          // Replace existing phone number
          content = content.replace(/WhatsApp:.*\n/, phoneSection);
        } else {
          // Add phone number after the first few lines
          const lines = content.split("\n");
          const firstLines = lines.slice(0, Math.min(5, lines.length));
          const restLines = lines.slice(Math.min(5, lines.length));
          content = [...firstLines, phoneSection, ...restLines].join("\n");
        }
      }

      // Write transcript to both files
      fs.writeFileSync(masterPath, content, "utf8");
      fs.writeFileSync(timestampedPath, content, "utf8");

      console.log(
        `[MediaManager:${this.instanceId}] Saved master transcript to ${masterPath}`
      );
      console.log(
        `[MediaManager:${this.instanceId}] Saved timestamped transcript to ${timestampedPath}`
      );

      // Return the master path
      return masterPath;
    } catch (error) {
      console.error(
        `[MediaManager:${this.instanceId}] Error saving transcript: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Reset all caches for clean restart
   */
  resetInstanceCaches() {
    console.log(`[MediaManager:${this.instanceId}] Resetting all caches`);
    this.phoneNumberCache = new Map();
    this.mediaHashCache = new Map();
  }
}

// Export the class for creating new instances
module.exports = MediaManager;

// Export utility functions separately for other modules to use directly
module.exports.formatFunctions = {
  // Extract clean username WITHOUT phone number
  formatDisplayName: (username, phoneNumber = null) => {
    if (!username) return phoneNumber ? `Unknown(${phoneNumber})` : "Unknown";

    // Remove phone number if in parentheses at the end
    return (
      String(username)
        .replace(/\([^)]*\)$/, "")
        .trim() || "Unknown"
    );
  },

  // Format directory name safely
  formatDirectoryName: (username, phoneNumber = null) => {
    // Extract clean username (no phone)
    const clean =
      String(username)
        .replace(/\([^)]*\)$/, "")
        .trim() || "unknown-user";

    // Make filesystem safe
    return clean
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  },

  // Clean phone number by removing extensions
  cleanPhoneNumber: (phoneNumber) => {
    if (!phoneNumber) return "";

    // Convert to string
    let clean = String(phoneNumber);

    // Remove WhatsApp extensions and non-digits
    clean = clean
      .replace(/@s\.whatsapp\.net/g, "")
      .replace(/@c\.us/g, "")
      .replace(/@g\.us/g, "")
      .replace(/@broadcast/g, "")
      .replace(/@.*$/, "");

    return clean;
  },
};

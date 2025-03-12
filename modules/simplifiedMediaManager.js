// modules/simplifiedMediaManager.js - FIXED FOR INSTANCE ISOLATION
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SimplifiedMediaManager {
  constructor() {
    this.instanceId = null;
    
    // Default base directory (will be updated when instanceId is set)
    this.baseDir = path.join(__dirname, '..', 'transcripts'); 
    
    // Path to file index (will be updated when instanceId is set)
    this.indexPath = path.join(this.baseDir, 'file_index.json');
    
    // Create the base directory if it doesn't exist
    this.ensureBaseDir();
    
    // Cache for phone number lookups - IMPORTANT for consistent username-phone mapping
    this.phoneNumberCache = new Map();
    
    // CRITICAL CHANGE: Flag to completely disable file creation except for transcripts
    // Set to true to completely disable all media storing
    this.disableMediaCreation = true;
    
    console.log(`[MediaManager] Initialized with default path: ${this.baseDir} - Media creation DISABLED`);
  }
  
  
  /**
   * Set the instance ID for this media manager
   * @param {string} instanceId - Instance ID
   */
  setInstanceId(instanceId) {
    if (!instanceId) {
      console.warn(`[MediaManager] Warning: Setting null instanceId`);
      return;
    }
    
    // Only update if the instance ID actually changed
    if (this.instanceId !== instanceId) {
      console.log(`[MediaManager] Changing instance ID from ${this.instanceId || 'default'} to ${instanceId}`);
      
      // CRITICAL FIX: Clear caches when changing instances to prevent data leakage
      this.phoneNumberCache = new Map();
      
      this.instanceId = instanceId;
      
      // Update paths for this instance - IMPORTANT: All data must be in instance-specific directories
      this.baseDir = path.join(__dirname, '..', 'instances', instanceId, 'transcripts');
      this.indexPath = path.join(this.baseDir, 'file_index.json');
      
      // Create the base directory if it doesn't exist
      this.ensureBaseDir();
      
      console.log(`[MediaManager] Set instance ID to ${instanceId}, using base directory: ${this.baseDir}`);
    }
  }
  
  
  /**
   * Ensure the base directory exists
   */
  ensureBaseDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
      console.log(`[MediaManager] Created base directory: ${this.baseDir}`);
    }
  }
  
  /**
   * Force cleanup a file with confirmation
   * @param {string} filePath - Path to file to delete
   * @returns {boolean} - Success status
   */
  forceCleanupFile(filePath) {
    if (!filePath) return false;
    
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[MediaManager] 🗑️ DELETED: ${filePath}`);
        
        // Double-check it's really gone
        if (fs.existsSync(filePath)) {
          console.error(`[MediaManager] ⚠️ File still exists after deletion attempt: ${filePath}`);
          // Try one more time
          fs.unlinkSync(filePath);
          console.log(`[MediaManager] 🗑️ Second deletion attempt for: ${filePath}`);
          return !fs.existsSync(filePath);
        }
        return true;
      } else {
        return true; // Consider it a success if the file doesn't exist
      }
    } catch (e) {
      console.error(`[MediaManager] Error deleting ${filePath}: ${e.message}`);
      return false;
    }
  }
  
  /**
   * Load file index
   * @returns {Map} File index map
   */
  loadFileIndex() {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
        console.log(`[MediaManager:${this.instanceId || 'default'}] Loaded file index from ${this.indexPath}`);
        return new Map(Object.entries(data));
      }
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error loading file index:`, error);
    }
    
    return new Map();
  }
  
  /**
   * Save file index
   */
  saveFileIndex() {
    try {
      const data = Object.fromEntries(this.fileIndex);
      fs.writeFileSync(this.indexPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[MediaManager:${this.instanceId || 'default'}] Saved file index to ${this.indexPath}`);
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error saving file index:`, error);
    }
  }
  
  /**
   * Set phone number to username mapping in the cache and rename directory if needed
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name
   */
  setPhoneToUsername(phoneNumber, username) {
    if (!phoneNumber || !username) return;
    
    // Log both values for debugging purposes
    console.log(`[MediaManager:${this.instanceId || 'default'}] MAPPING: Setting phone ${phoneNumber} to username ${username}`);
    
    // Check if there's an existing username for this phone number
    const existingUsername = this.phoneNumberCache.get(phoneNumber);
    
    // Update the cache
    this.phoneNumberCache.set(phoneNumber, username);
    
    // If there's an existing username and it's different from the new username, rename the directory
    if (existingUsername && existingUsername !== username) {
      this.renameUserDirectory(phoneNumber, existingUsername, username);
    } else {
      // Pre-create the directory structure
      this.ensureUserDirectories(phoneNumber, username);
    }
  }
  
  /**
   * Rename user directory when username changes
   * @param {string} phoneNumber - User's phone number
   * @param {string} oldUsername - Old username
   * @param {string} newUsername - New username
   */
  renameUserDirectory(phoneNumber, oldUsername, newUsername) {
    try {
      const safePhone = this.sanitizePhoneNumber(phoneNumber);
      const safeOldUsername = this.sanitizeUsername(oldUsername);
      const safeNewUsername = this.sanitizeUsername(newUsername);
      
      // Skip if the sanitized usernames are the same
      if (safeOldUsername === safeNewUsername) {
        console.log(`[MediaManager:${this.instanceId || 'default'}] Sanitized usernames are the same, no need to rename: ${safeOldUsername}`);
        this.ensureUserDirectories(phoneNumber, newUsername);
        return;
      }
      
      const oldDir = path.join(this.baseDir, safePhone, safeOldUsername);
      const newDir = path.join(this.baseDir, safePhone, safeNewUsername);
      
      console.log(`[MediaManager:${this.instanceId || 'default'}] Renaming directory: ${oldDir} -> ${newDir}`);
      
      // Check if old directory exists
      if (fs.existsSync(oldDir)) {
        // Create parent directory if it doesn't exist
        const parentDir = path.join(this.baseDir, safePhone);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        
        // Rename directory
        fs.renameSync(oldDir, newDir);
        console.log(`[MediaManager:${this.instanceId || 'default'}] Directory renamed successfully from ${safeOldUsername} to ${safeNewUsername}`);
        
        // Ensure media subdirectory exists in new location
        const newMediaDir = path.join(newDir, 'media');
        if (!fs.existsSync(newMediaDir)) {
          fs.mkdirSync(newMediaDir, { recursive: true });
        }
        
        // Update transcript file paths in transcripts
        this.updateTranscriptPaths(oldDir, newDir, safeOldUsername, safeNewUsername);
        
        // Update file index for media files
        this.updateFileIndexPaths(oldDir, newDir);
        
        // Update hash cache
        this.updateHashCachePaths(oldDir, newDir);
      } else {
        console.log(`[MediaManager:${this.instanceId || 'default'}] Old directory ${oldDir} doesn't exist, creating new directory structure`);
        this.ensureUserDirectories(phoneNumber, newUsername);
      }
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error renaming user directory: ${error.message}`);
      // If something goes wrong, at least try to ensure the new directory exists
      this.ensureUserDirectories(phoneNumber, newUsername);
    }
  }
  
  /**
   * Update paths in transcript files when directory is renamed
   * @param {string} oldDir - Old directory path
   * @param {string} newDir - New directory path 
   * @param {string} oldUsername - Old sanitized username
   * @param {string} newUsername - New sanitized username
   */
  updateTranscriptPaths(oldDir, newDir, oldUsername, newUsername) {
    try {
      if (!fs.existsSync(newDir)) {
        console.log(`[MediaManager:${this.instanceId || 'default'}] New directory ${newDir} does not exist, cannot update transcripts`);
        return;
      }
      
      console.log(`[MediaManager:${this.instanceId || 'default'}] Updating transcript paths from ${oldDir} to ${newDir}`);
      
      // Find all transcript files in the new location
      const files = fs.readdirSync(newDir)
        .filter(file => file.startsWith('transcript-') && file.endsWith('.md'))
        .map(file => path.join(newDir, file));
      
      console.log(`[MediaManager:${this.instanceId || 'default'}] Found ${files.length} transcript files to update`);
      
      files.forEach(filePath => {
        try {
          let content = fs.readFileSync(filePath, 'utf8');
          
          // Check if content contains old paths
          if (content.includes(oldDir)) {
            console.log(`[MediaManager:${this.instanceId || 'default'}] Updating paths in transcript file: ${filePath}`);
            
            // Replace all occurrences of old directory path with new directory path
            // Use path separator that works in regex
            const oldDirRegex = oldDir.replace(/\\/g, '\\\\').replace(/\//g, '\\/');
            const newDirRegex = newDir.replace(/\\/g, '\\\\').replace(/\//g, '\\/');
            const updatedContent = content.replace(new RegExp(oldDirRegex, 'g'), newDirRegex);
            
            // Replace old username with new username in path patterns
            const oldUsernamePattern = new RegExp(`([/_-])${oldUsername}([/_-])`, 'g');
            const newUsernameReplacement = `$1${newUsername}$2`;
            const contentWithUpdatedUsernames = updatedContent.replace(oldUsernamePattern, newUsernameReplacement);
            
            // Write updated content back to file
            fs.writeFileSync(filePath, contentWithUpdatedUsernames, 'utf8');
            console.log(`[MediaManager:${this.instanceId || 'default'}] Updated paths in ${filePath}`);
          } else {
            console.log(`[MediaManager:${this.instanceId || 'default'}] No old paths found in ${filePath}, skipping update`);
          }
        } catch (fileError) {
          console.error(`[MediaManager:${this.instanceId || 'default'}] Error updating paths in ${filePath}: ${fileError.message}`);
        }
      });
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error updating transcript paths: ${error.message}`);
    }
  }
  
  /**
   * Update file index paths when directory is renamed
   * @param {string} oldDir - Old directory path
   * @param {string} newDir - New directory path
   */
  updateFileIndexPaths(oldDir, newDir) {
    try {
      console.log(`[MediaManager:${this.instanceId || 'default'}] Updating file index paths from ${oldDir} to ${newDir}`);
      
      // Create a new map for the updated index
      const updatedIndex = new Map();
      
      // Update all paths in the file index
      for (const [hash, filePath] of this.fileIndex.entries()) {
        if (filePath.startsWith(oldDir)) {
          const newPath = filePath.replace(oldDir, newDir);
          updatedIndex.set(hash, newPath);
          console.log(`[MediaManager:${this.instanceId || 'default'}] Updated file index path: ${filePath} -> ${newPath}`);
        } else {
          updatedIndex.set(hash, filePath);
        }
      }
      
      // Replace the file index with the updated one
      this.fileIndex = updatedIndex;
      
      // Save the updated index
      this.saveFileIndex();
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error updating file index paths: ${error.message}`);
    }
  }
  
  /**
   * Update hash cache paths when directory is renamed
   * @param {string} oldDir - Old directory path
   * @param {string} newDir - New directory path
   */
  updateHashCachePaths(oldDir, newDir) {
    try {
      console.log(`[MediaManager:${this.instanceId || 'default'}] Updating hash cache paths from ${oldDir} to ${newDir}`);
      
      // Update all paths in the hash cache
      for (const [hash, filePath] of this.mediaHashCache.entries()) {
        if (filePath.startsWith(oldDir)) {
          const newPath = filePath.replace(oldDir, newDir);
          this.mediaHashCache.set(hash, newPath);
          console.log(`[MediaManager:${this.instanceId || 'default'}] Updated hash cache path: ${filePath} -> ${newPath}`);
        }
      }
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error updating hash cache paths: ${error.message}`);
    }
  }
  
  /**
   * Get username from phone number cache
   * @param {string} phoneNumber - User's phone number
   * @returns {string|null} - Username if found, null otherwise
   */
  getUsernameFromPhone(phoneNumber) {
    const username = this.phoneNumberCache.get(phoneNumber);
    console.log(`[MediaManager:${this.instanceId || 'default'}] Getting username for phone ${phoneNumber}: ${username || 'not found'}`);
    return username || null;
  }
  
  /**
   * Sanitize username consistently
   * @param {string} username - Raw username
   * @returns {string} - Filesystem-safe username
   */
  sanitizeUsername(username) {
    if (!username) return 'unknown-user';
    // FIXED: Consistent sanitization - all lowercase, spaces to single dash, remove all other special chars
    const sanitized = username.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return sanitized;
  }
  
  /**
   * Sanitize phone number consistently
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} - Filesystem-safe phone number
   */
  sanitizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return 'unknown-number';
    
    // Remove any non-numeric characters except the leading + if present
    let sanitized = phoneNumber;
    
    // Remove WhatsApp extensions if present
    sanitized = sanitized.replace(/@.*$/, '');
    
    // Clean the number to just digits and possibly leading +
    if (sanitized.startsWith('+')) {
      sanitized = '+' + sanitized.substring(1).replace(/[^0-9]/g, '');
    } else {
      sanitized = sanitized.replace(/[^0-9]/g, '');
    }
    
    // Check if empty after sanitization
    if (!sanitized || sanitized === '+') {
      console.error(`[MediaManager:${this.instanceId || 'default'}] WARNING: Phone number '${phoneNumber}' was sanitized to empty string, using unknown-number`);
      return 'unknown-number';
    }
    
    return sanitized;
  }
  
  /**
   * Get user directory path based on phone number and username
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name
   * @returns {string} - Path to user directory
   */
  getUserDir(phoneNumber, username) {
    // FIXED: Always try to use phoneNumber from cache if not provided but username is
    if (!phoneNumber && username) {
      // Look through cache for username
      for (const [phone, user] of this.phoneNumberCache.entries()) {
        if (user === username || this.sanitizeUsername(user) === this.sanitizeUsername(username)) {
          console.log(`[MediaManager:${this.instanceId || 'default'}] Found phone number ${phone} for username ${username} in cache`);
          phoneNumber = phone;
          break;
        }
      }
    }
    
    // CRITICAL FIX: Use instance ID in folder structure for complete isolation
    // Each instance needs to have completely separated user directories
    // This change by itself would be enough to fix cross-server issues
    
    const safePhone = this.sanitizePhoneNumber(phoneNumber);
    const safeUsername = this.sanitizeUsername(username);
    
    // Structure: instances/[instanceId]/transcripts/+1234567890/john-smith/
    const userDir = path.join(this.baseDir, safePhone, safeUsername);
    return userDir;
  }
  
  /**
   * Get media directory path (without creating it)
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name
   * @returns {string} - Path to media directory
   */
  getMediaDir(phoneNumber, username) {
    return path.join(this.getUserDir(phoneNumber, username), 'media');
  }
  
  /**
   * Ensure user directories exist
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name
   * @returns {Object} - User directory paths
   */
  ensureUserDirectories(phoneNumber, username) {
    const userDir = this.getUserDir(phoneNumber, username);
    const mediaDir = path.join(userDir, 'media');
    
    if (!fs.existsSync(userDir)) {
      console.log(`[MediaManager:${this.instanceId || 'default'}] Creating user directory: ${userDir}`);
      fs.mkdirSync(userDir, { recursive: true });
    }
    
    if (!fs.existsSync(mediaDir)) {
      console.log(`[MediaManager:${this.instanceId || 'default'}] Creating media directory: ${mediaDir}`);
      fs.mkdirSync(mediaDir, { recursive: true });
    }
    
    return { userDir, mediaDir };
  }
  
  /**
   * Calculate hash for a file to enable deduplication
   * @param {string} filePath - Path to file
   * @returns {string} MD5 hash
   */
  calculateFileHash(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        console.log(`[MediaManager:${this.instanceId || 'default'}] File doesn't exist: ${filePath}`);
        return null;
      }
      
      const data = fs.readFileSync(filePath);
      return crypto.createHash('md5').update(data).digest('hex');
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error calculating hash: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Save media file with deduplication
   * @param {string} filePath - Path to source file
   * @param {string} username - Username
   * @param {string} mediaType - Type of media
   * @param {string} phoneNumber - Phone number
   * @returns {Object} - Result info
   */
  saveMedia(filePath, username, mediaType, phoneNumber = null) {
    // Flag to disable permanent media creation
    this.disableMediaCreation = true;
    
    if (this.disableMediaCreation) {
      console.log(`[MediaManager:${this.instanceId || 'default'}] Permanent media storage is disabled - using temp file only`);
      
      try {
        if (!fs.existsSync(filePath)) {
          console.error(`[MediaManager:${this.instanceId || 'default'}] Source file not found: ${filePath}`);
          return { success: false, error: 'Source file not found' };
        }
    
        // Create a hash of the file for reference purposes
        const fileHash = this.calculateFileHash(filePath);
        
        // Check if the file is in temp directory
        const isInTempDir = filePath.includes('/temp/') || filePath.includes('\\temp\\') || 
                          filePath.includes('temp_');
        
        // If not in temp dir, create a copy in temp dir for consistency
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        let tempFilePath = filePath;
        if (!isInTempDir) {
          const ext = path.extname(filePath);
          const timestamp = Date.now();
          const tempFileName = `temp_${username.replace(/\s+/g, '_')}_${timestamp}${ext}`;
          tempFilePath = path.join(tempDir, tempFileName);
          fs.copyFileSync(filePath, tempFilePath);
          console.log(`[MediaManager:${this.instanceId || 'default'}] Copied media to temp location: ${tempFilePath}`);
        }
        
        // Return original or temp file path
        return { 
          success: true, 
          path: tempFilePath, 
          hash: fileHash,
          isDuplicate: false,
          mediaType: mediaType,
          isTemporary: true
        };
      } catch (error) {
        console.error(`[MediaManager:${this.instanceId || 'default'}] Error handling media:`, error);
        return { success: false, error: error.message };
      }
    }
    
    // The rest of the original function for permanent storage (will never be called with disableMediaCreation = true)
    try {
      // Ensure we're using instance-specific directories
      if (!this.instanceId) {
        console.warn(`[MediaManager] WARNING: No instance ID set for media manager. Using default paths.`);
      }
      
      if (!fs.existsSync(filePath)) {
        console.error(`[MediaManager:${this.instanceId || 'default'}] Source file not found: ${filePath}`);
        return { success: false, error: 'Source file not found' };
      }
      
      // Check if the file is in temp directory
      const isInTempDir = filePath.includes('/temp/') || filePath.includes('\\temp\\') || 
                        filePath.includes('temp_');
      
      // Calculate hash for deduplication
      const fileHash = this.calculateFileHash(filePath);
      if (!fileHash) {
        return { success: false, error: 'Failed to generate file hash' };
      }
      
      console.log(`[MediaManager:${this.instanceId || 'default'}] 🔍 File hash: ${fileHash.substring(0, 8)}... for ${path.basename(filePath)}`);
      
      // Check if we've already seen this file in this instance
      if (this.mediaHashCache.has(fileHash)) {
        const existingPath = this.mediaHashCache.get(fileHash);
        if (fs.existsSync(existingPath)) {
          console.log(`[MediaManager:${this.instanceId || 'default'}] 📋 DEDUP: Found duplicate media with hash ${fileHash.substring(0, 8)}...`);
          console.log(`[MediaManager:${this.instanceId || 'default'}] Using existing file: ${existingPath}`);
          
          // Delete temp file immediately if it's in temp directory
          if (isInTempDir) {
            this.forceCleanupFile(filePath);
          }
          
          return {
            success: true,
            path: existingPath,
            hash: fileHash,
            isDuplicate: true,
            mediaType: mediaType
          };
        } else {
          // File doesn't exist anymore
          this.mediaHashCache.delete(fileHash);
        }
      }
      
      // Check for duplicate by hash in index (legacy method)
      if (this.fileIndex.has(fileHash)) {
        const existingPath = this.fileIndex.get(fileHash);
        
        // Verify the existing file actually exists
        if (fs.existsSync(existingPath)) {
          console.log(`[MediaManager:${this.instanceId || 'default'}] Found duplicate media by hash (${fileHash}). Using existing file: ${existingPath}`);
          
          // Add to our hash cache for future lookups
          this.mediaHashCache.set(fileHash, existingPath);
          
          // Clean up temp file if it's in temp directory
          if (isInTempDir) {
            this.forceCleanupFile(filePath);
          }
          
          return {
            success: true,
            path: existingPath,
            hash: fileHash,
            isDuplicate: true,
            mediaType: mediaType
          };
        }
        
        // File in index doesn't exist, remove from index
        this.fileIndex.delete(fileHash);
      }
      
      // Look up phone number if needed
      if (!phoneNumber && username) {
        // Look through cache for username
        for (const [phone, user] of this.phoneNumberCache.entries()) {
          if (user === username || this.sanitizeUsername(user) === this.sanitizeUsername(username)) {
            console.log(`[MediaManager:${this.instanceId || 'default'}] Found phone number ${phone} for username ${username} in cache`);
            phoneNumber = phone;
            break;
          }
        }
      }
      
      // Ensure user directories exist using phone number as primary identifier
      const { mediaDir } = this.ensureUserDirectories(phoneNumber, username);
      console.log(`[MediaManager:${this.instanceId || 'default'}] Target media directory: ${mediaDir}`);
      
      // Create a filename with hash included for easier identification of duplicates
      const ext = path.extname(filePath);
      const timestamp = Date.now();
      const safeUsername = this.sanitizeUsername(username);
      const filename = `media_${safeUsername}_${fileHash.substring(0, 8)}_${timestamp}${ext}`;
      const destPath = path.join(mediaDir, filename);
      
      // Copy file to user's media directory
      fs.copyFileSync(filePath, destPath);
      console.log(`[MediaManager:${this.instanceId || 'default'}] Saved media to ${destPath}`);
      
      // Add to file index
      this.fileIndex.set(fileHash, destPath);
      this.saveFileIndex();
      
      // Add to our hash cache
      this.mediaHashCache.set(fileHash, destPath);
      
      // Clean up temp file if it's in temp directory
      if (isInTempDir) {
        this.forceCleanupFile(filePath);
      }
      
      return {
        success: true,
        path: destPath,
        hash: fileHash,
        isDuplicate: false,
        mediaType: mediaType
      };
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error saving media:`, error);
      
      // Clean up temp file if it's in temp directory
      if (filePath && (filePath.includes('/temp/') || filePath.includes('\\temp\\') || 
                      filePath.includes('temp_'))) {
        this.forceCleanupFile(filePath);
      }
      
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Save transcript file - updated to use a master file with phone number
   * @param {string} username - Username
   * @param {string} content - Transcript content
   * @param {string} ticketName - Optional ticket name
   * @param {string} phoneNumber - User's phone number (required)
   * @returns {string} - Path to saved transcript
   */
  saveTranscript(username, content, ticketName = '', phoneNumber = null) {
    try {
      // Add current instance ID to content if not already there
      if (!content.includes(`Instance: ${this.instanceId || 'default'}`)) {
        const instanceLine = `Instance: ${this.instanceId || 'default'}\n`;
        const lines = content.split('\n');
        
        // Find a good place to insert the instance ID (after intro, before content)
        let insertIndex = 0;
        for (let i = 0; i < Math.min(10, lines.length); i++) {
          if (lines[i].includes('WhatsApp:')) {
            insertIndex = i + 1;
            break;
          }
        }
        
        if (insertIndex > 0) {
          lines.splice(insertIndex, 0, instanceLine);
          content = lines.join('\n');
        }
      }
      
      // IMPROVED: More aggressive phone number lookup
      console.log(`[MediaManager:${this.instanceId || 'default'}] Saving transcript for ${username} with phone ${phoneNumber || 'not provided'}`);
      
      // If phoneNumber is null or unknown-number, try to get it from cache
      if ((!phoneNumber || phoneNumber === 'unknown-number') && username) {
        // Look through cache for username
        for (const [phone, user] of this.phoneNumberCache.entries()) {
          if (user === username || this.sanitizeUsername(user) === this.sanitizeUsername(username)) {
            console.log(`[MediaManager:${this.instanceId || 'default'}] Found phone number ${phone} for username ${username} in cache`);
            phoneNumber = phone;
            break;
          }
        }
      }
      
      // Ensure user directory exists
      const { userDir } = this.ensureUserDirectories(phoneNumber, username);
      console.log(`[MediaManager:${this.instanceId || 'default'}] Saving transcript to user directory: ${userDir}`);
      
      // Create a master transcript filename that gets updated
      const masterFilename = `transcript-master.md`;
      const masterPath = path.join(userDir, masterFilename);
      
      // Also create a timestamped version for history
      const timestamp = Date.now();
      const safeTicketName = ticketName ? this.sanitizeUsername(ticketName) : 'ticket';
      const timestampedFilename = `transcript-${safeTicketName}-${timestamp}.md`;
      const timestampedPath = path.join(userDir, timestampedFilename);
      
      // Make sure the content includes the phone number
      if (!content.includes(`WhatsApp: ${phoneNumber}`)) {
        // Add phone number if not already included
        let phoneSection = `WhatsApp: ${phoneNumber}\n\n`;
        
        if (content.includes('WhatsApp:')) {
          // Replace existing phone number
          content = content.replace(/WhatsApp:.*\n/, phoneSection);
        } else {
          // Add phone number after the first few lines
          const lines = content.split('\n');
          const firstLines = lines.slice(0, Math.min(5, lines.length));
          const restLines = lines.slice(Math.min(5, lines.length));
          content = [...firstLines, phoneSection, ...restLines].join('\n');
        }
      }
      
      // CRITICAL NEW ADDITION: ALWAYS include instance ID in transcript metadata
      if (!content.includes(`Instance: ${this.instanceId || 'default'}`)) {
        // Add instance ID if not already included
        let instanceHeader = `\n# Instance Information\n`;
        instanceHeader += `Instance: ${this.instanceId || 'default'}\n`;
        instanceHeader += `Base Directory: ${this.baseDir}\n`;
        instanceHeader += `Saved: ${new Date().toISOString()}\n\n`;
        
        if (content.includes('# Instance Information')) {
          // Replace existing instance information
          content = content.replace(/# Instance Information[\s\S]*?(?=\n#|\n$)/m, instanceHeader);
        } else {
          // Add instance information at the end
          content += instanceHeader;
        }
      }
      
      // Write transcript to both files
      fs.writeFileSync(masterPath, content, 'utf8');
      fs.writeFileSync(timestampedPath, content, 'utf8');
      
      console.log(`[MediaManager:${this.instanceId || 'default'}] Saved master transcript to ${masterPath}`);
      console.log(`[MediaManager:${this.instanceId || 'default'}] Saved timestamped transcript to ${timestampedPath}`);
      
      // Return the master path as the primary transcript
      return masterPath;
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error saving transcript:`, error);
      return null;
    }
  }

  findUserTranscript(username, phoneNumber = null) {
    try {
      console.log(`[MediaManager:${this.instanceId || 'default'}] Finding transcript for user ${username} (${phoneNumber || 'no phone'})`);
      
      // CRITICAL FIX: Make sure we're looking in the correct instance directory
      // This function should never return a transcript from a different instance
      
      // First try direct approach with phone and username
      if (phoneNumber) {
        const safePhone = this.sanitizePhoneNumber(phoneNumber);
        const safeUsername = this.sanitizeUsername(username);
        
        // Try master transcript first
        const masterPath = path.join(this.baseDir, safePhone, safeUsername, 'transcript-master.md');
        
        if (fs.existsSync(masterPath)) {
          console.log(`[MediaManager:${this.instanceId || 'default'}] Found master transcript at ${masterPath}`);
          
          // Verify this transcript belongs to this instance by checking its content
          const content = fs.readFileSync(masterPath, 'utf8');
          const instanceMatch = content.match(/Instance: ([^\s\n]+)/);
          
          if (instanceMatch && instanceMatch[1] !== this.instanceId && this.instanceId !== null) {
            console.error(`[MediaManager:${this.instanceId || 'default'}] WARNING: Found transcript belongs to different instance: ${instanceMatch[1]}`);
          }
          
          return { 
            path: masterPath, 
            content,
            isLatest: true 
          };
        }
        
        // Then try to find most recent timestamped transcript
        const userDir = path.join(this.baseDir, safePhone, safeUsername);
        if (fs.existsSync(userDir)) {
          const files = fs.readdirSync(userDir)
            .filter(file => file.startsWith('transcript-') && file.endsWith('.md') && file !== 'transcript-master.md')
            .sort().reverse(); // Newest first based on timestamp in name
          
          if (files.length > 0) {
            const latestTranscriptPath = path.join(userDir, files[0]);
            console.log(`[MediaManager:${this.instanceId || 'default'}] Found latest transcript at ${latestTranscriptPath}`);
            
            // Verify this transcript belongs to this instance
            const content = fs.readFileSync(latestTranscriptPath, 'utf8');
            const instanceMatch = content.match(/Instance: ([^\s\n]+)/);
            
            if (instanceMatch && instanceMatch[1] !== this.instanceId && this.instanceId !== null) {
              console.error(`[MediaManager:${this.instanceId || 'default'}] WARNING: Found transcript belongs to different instance: ${instanceMatch[1]}`);
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
      console.log(`[MediaManager:${this.instanceId || 'default'}] No direct transcript found, searching broadly...`);
      
      // Function to recursively search directories
      const searchTranscripts = (dir, depth = 0) => {
        if (depth > 3) return null; // Limit search depth
        
        try {
          if (!fs.existsSync(dir)) return null;
          
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          
          // First look for direct transcript files in this directory
          const transcriptFiles = entries
            .filter(entry => !entry.isDirectory() && 
                    entry.name.startsWith('transcript-') && 
                    entry.name.endsWith('.md'))
            .map(entry => path.join(dir, entry.name));
          
          // Check if any exist and have username
          for (const filePath of transcriptFiles) {
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              
              // CRITICAL FIX: Verify this transcript belongs to this instance
              const instanceMatch = content.match(/Instance: ([^\s\n]+)/);
              if (instanceMatch && instanceMatch[1] !== this.instanceId && this.instanceId !== null) {
                console.log(`[MediaManager:${this.instanceId || 'default'}] Skipping transcript from different instance: ${instanceMatch[1]}`);
                continue;
              }
              
              // Check if the file contains the username or phone number
              const lowerContent = content.toLowerCase();
              const lowerUsername = username.toLowerCase();
              
              if (lowerContent.includes(lowerUsername) || 
                  (phoneNumber && lowerContent.includes(phoneNumber))) {
                console.log(`[MediaManager:${this.instanceId || 'default'}] Found transcript by content match: ${filePath}`);
                return { path: filePath, content, isLatest: false };
              }
            } catch (e) {
              console.error(`[MediaManager:${this.instanceId || 'default'}] Error reading ${filePath}:`, e);
            }
          }
          
          // Recursively search subdirectories
          for (const entry of entries) {
            if (entry.isDirectory()) {
              // First check if folder name matches
              if (entry.name.toLowerCase().includes(this.sanitizeUsername(username).toLowerCase())) {
                // Check for master transcript
                const masterPath = path.join(dir, entry.name, 'transcript-master.md');
                if (fs.existsSync(masterPath)) {
                  const content = fs.readFileSync(masterPath, 'utf8');
                  
                  // CRITICAL FIX: Verify this transcript belongs to this instance
                  const instanceMatch = content.match(/Instance: ([^\s\n]+)/);
                  if (instanceMatch && instanceMatch[1] !== this.instanceId && this.instanceId !== null) {
                    console.log(`[MediaManager:${this.instanceId || 'default'}] Skipping transcript from different instance: ${instanceMatch[1]}`);
                    continue;
                  }
                  
                  console.log(`[MediaManager:${this.instanceId || 'default'}] Found master transcript in matching folder: ${masterPath}`);
                  return { path: masterPath, content, isLatest: true };
                }
              }
              
              // Otherwise search this directory
              const result = searchTranscripts(path.join(dir, entry.name), depth + 1);
              if (result) return result;
            }
          }
          
          return null;
        } catch (error) {
          console.error(`[MediaManager:${this.instanceId || 'default'}] Error searching directory ${dir}:`, error);
          return null;
        }
      };
      
      // Start the search from the base directory
      return searchTranscripts(this.baseDir);
    } catch (error) {
      console.error(`[MediaManager:${this.instanceId || 'default'}] Error finding user transcript:`, error);
      return null;
    }
  }
  
  /**
   * Get media type from filename
   * @param {string} filename - Filename
   * @returns {string} - Media type
   */
  getMediaTypeFromFilename(filename) {
    if (!filename) return 'file';
    
    const lower = filename.toLowerCase();
    
    // Check explicit type markers
    if (lower.includes('_image_')) return 'image';
    if (lower.includes('_video_')) return 'video';
    if (lower.includes('_audio_')) return 'audio';
    if (lower.includes('_document_')) return 'document';
    if (lower.includes('_gif_')) return 'gif';
    if (lower.includes('_sticker_')) return 'sticker';
    
    // Check by extension
    const ext = path.extname(lower);
    
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'image';
    if (ext === '.gif') return 'gif';
    if (['.mp4', '.avi', '.mov', '.webm'].includes(ext)) return 'video';
    if (['.mp3', '.ogg', '.wav', '.m4a'].includes(ext)) return 'audio';
    if (['.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(ext)) return 'document';
    
    return 'file';
  }
  
  /**
   * Reset all instance caches - CRITICAL NEW METHOD  
   */
  resetInstanceCaches() {
    console.log(`[MediaManager:${this.instanceId || 'default'}] Resetting all caches`);
    this.phoneNumberCache = new Map();
    this.mediaHashCache = new Map();
    this.fileIndex = new Map();
    this.saveFileIndex();
  }
}

// Create and export singleton instance
module.exports = new SimplifiedMediaManager();
// modules/managers/ChannelManager.js
const fs = require("fs");
const path = require("path");

/**
 * Manages mapping between WhatsApp users and Discord channels
 */
class ChannelManager {
  /**
   * Create a new channel manager
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId = "default") {
    this.instanceId = instanceId;
    this.channelMap = new Map();
    this.whatsAppClient = null;
    this.loadMappings();

    // Store special channel handlers
    this.specialChannels = {};
  }

  /**
   * Set the WhatsApp client
   * @param {Object} client - WhatsApp client
   */
  setWhatsAppClient(client) {
    this.whatsAppClient = client;
  }

  /**
   * Get the WhatsApp client
   * @returns {Object} WhatsApp client
   */
  getWhatsAppClient() {
    return this.whatsAppClient;
  }

  /**
   * Load channel mappings from disk
   */
  loadMappings() {
    try {
      const mappingsFile = path.join(
        __dirname,
        "../../instances",
        this.instanceId,
        "channel_mappings.json"
      );

      if (fs.existsSync(mappingsFile)) {
        const data = JSON.parse(fs.readFileSync(mappingsFile, "utf8"));

        // Convert to Map
        for (const [phoneNumber, channelId] of Object.entries(data)) {
          this.channelMap.set(phoneNumber, channelId);
        }

        console.log(
          `[ChannelManager:${this.instanceId}] Loaded ${this.channelMap.size} channel mappings`
        );
      } else {
        console.log(
          `[ChannelManager:${this.instanceId}] No channel mappings file found`
        );
      }
    } catch (error) {
      console.error(
        `[ChannelManager:${this.instanceId}] Error loading channel mappings:`,
        error
      );
    }
  }

  /**
   * Save channel mappings to disk
   */
  saveMappings() {
    try {
      const mappingsFile = path.join(
        __dirname,
        "../../instances",
        this.instanceId,
        "channel_mappings.json"
      );

      // Convert Map to object
      const data = {};
      for (const [phoneNumber, channelId] of this.channelMap.entries()) {
        data[phoneNumber] = channelId;
      }

      fs.writeFileSync(mappingsFile, JSON.stringify(data, null, 2), "utf8");
      console.log(
        `[ChannelManager:${this.instanceId}] Saved ${this.channelMap.size} channel mappings`
      );
    } catch (error) {
      console.error(
        `[ChannelManager:${this.instanceId}] Error saving channel mappings:`,
        error
      );
    }
  }

  /**
   * Add a channel mapping
   * @param {string} phoneNumber - WhatsApp phone number
   * @param {string} channelId - Discord channel ID
   */
  addChannelMapping(phoneNumber, channelId) {
    // Clean up phone number format
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);

    this.channelMap.set(cleanPhone, channelId);
    this.saveMappings();
  }

  /**
   * Get channel for a user
   * @param {string} phoneNumber - WhatsApp phone number
   * @returns {string|null} Channel ID
   */
  getUserChannel(phoneNumber) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    return this.channelMap.get(cleanPhone) || null;
  }

  /**
   * Check if user has a channel
   * @param {string} phoneNumber - WhatsApp phone number
   * @returns {boolean} Whether user has a channel
   */
  hasChannel(phoneNumber) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    return this.channelMap.has(cleanPhone);
  }

  /**
   * Remove a channel mapping
   * @param {string} phoneNumber - WhatsApp phone number
   * @returns {boolean} Success
   */
  removeChannel(phoneNumber) {
    const cleanPhone = this.cleanPhoneNumber(phoneNumber);
    const result = this.channelMap.delete(cleanPhone);

    if (result) {
      this.saveMappings();
    }

    return result;
  }

  /**
   * Get a mapping of all channels
   * @returns {Object} Channel map
   */
  getChannelMap() {
    const map = {};

    for (const [phone, channelId] of this.channelMap.entries()) {
      map[phone] = channelId;
    }

    return map;
  }

  /**
   * Get channel map size
   * @returns {number} Number of channels
   */
  getChannelMapSize() {
    return this.channelMap.size;
  }

  /**
   * Extract user ID (phone number) from a WhatsApp message
   * @param {Object} message - WhatsApp message object
   * @returns {string|null} - Clean user ID or null if not found
   */
  extractUserIdFromMessage(message) {
    try {
      // First try to get the raw user ID from the message
      let userId = null;

      // Check for modern Baileys (key.remoteJid or key.participant)
      if (message.key) {
        // For private messages, use remoteJid
        if (message.key.remoteJid && !message.key.remoteJid.includes("g.us")) {
          userId = message.key.remoteJid;
        }

        // For group messages, use participant
        else if (message.key.participant) {
          userId = message.key.participant;
        }

        // Fallback to remoteJid even if it's a group
        else if (message.key.remoteJid) {
          userId = message.key.remoteJid;
        }
      }

      // Check legacy/alternative formats
      if (!userId) {
        if (message.from) {
          userId = message.from;
        } else if (message.participant) {
          userId = message.participant;
        } else if (message.id && message.id.remote) {
          userId = message.id.remote;
        } else if (message.jid) {
          userId = message.jid;
        } else if (message.sender) {
          userId = message.sender;
        }
      }

      // If still no userId, search for anything that looks like a phone number
      if (!userId) {
        for (const key in message) {
          if (
            typeof message[key] === "string" &&
            (message[key].includes("@s.whatsapp.net") ||
              message[key].includes("@c.us"))
          ) {
            userId = message[key];
            break;
          }
        }
      }

      // If no userId found, return null
      if (!userId) {
        console.error(
          `[ChannelManager:${this.instanceId}] Could not find user ID in message:`,
          JSON.stringify(message, null, 2).substring(0, 500) + "..."
        );
        return null;
      }

      // Clean the phone number
      const cleanUserId = this.cleanPhoneNumber(userId);

      return cleanUserId;
    } catch (error) {
      console.error(
        `[ChannelManager:${this.instanceId}] Error extracting user ID:`,
        error
      );
      return null;
    }
  }

  /**
   * Clean a phone number
   * @param {string} phoneNumber - Phone number to clean
   * @returns {string} Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return "";

    // Convert to string
    let phone = String(phoneNumber);

    // Remove WhatsApp suffix
    phone = phone
      .replace(/@s\.whatsapp\.net/g, "")
      .replace(/@c\.us/g, "")
      .replace(/@g\.us/g, "")
      .replace(/@broadcast/g, "");

    return phone;
  }

  /**
 * Get username by user ID
 * @param {string} userId - User ID or phone number
 * @returns {string} - Username or default if not found
 */
getUsernameByUserId(userId) {
  try {
    if (!userId) {
      console.error(`[ChannelManager:${this.instanceId}] Cannot get username: missing userId`);
      return 'Unknown User';
    }
    
    // Clean phone number if it's a phone number
    const cleanUserId = this.cleanPhoneNumber(userId);
    
    // Check if we have a username for this user
    if (this.usernameMap && this.usernameMap.has(cleanUserId)) {
      return this.usernameMap.get(cleanUserId);
    }
    
    // If no username found but we have a user card manager, try to get from there
    if (this.userCardManager && typeof this.userCardManager.getUserInfo === 'function') {
      const userInfo = this.userCardManager.getUserInfo(cleanUserId);
      if (userInfo && userInfo.username) {
        // Store for future use
        if (this.usernameMap) {
          this.usernameMap.set(cleanUserId, userInfo.username);
        }
        return userInfo.username;
      }
    }
    
    // Default fallback
    return 'Unknown User';
  } catch (error) {
    console.error(`[ChannelManager:${this.instanceId}] Error getting username for ${userId}:`, error);
    return 'Unknown User';
  }
}

  /**
   * Set special channels
   * @param {Object} channels - Special channels mapping
   */
  setSpecialChannels(channels) {
    this.specialChannels = channels || {};
  }

  /**
   * Get special channel info
   * @param {string} channelId - Channel ID
   * @returns {Object|null} Special channel info
   */
  getSpecialChannel(channelId) {
    return this.specialChannels[channelId] || null;
  }

  /**
   * Sync with WhatsApp client
   */
  syncWithWhatsApp() {
    console.log(
      `[ChannelManager:${this.instanceId}] Channel synchronization complete`
    );
  }

  /**
   * Get channel ID for a user/phone number
   * @param {string} userId - User ID or phone number
   * @returns {string|null} - Channel ID or null if not found
   */
  getChannelId(userId) {
    try {
      // Clean phone number if it's a phone number
      if (
        typeof userId === "string" &&
        (userId.includes("@") || /^\+?\d+$/.test(userId))
      ) {
        // Use a helper to clean the phone number if available
        if (
          this.helpers &&
          typeof this.helpers.cleanPhoneNumber === "function"
        ) {
          userId = this.helpers.cleanPhoneNumber(userId);
        } else {
          // Basic cleaning if helper not available
          userId = userId
            .replace(/@s\.whatsapp\.net/g, "")
            .replace(/@c\.us/g, "")
            .replace(/@g\.us/g, "")
            .replace(/@broadcast/g, "")
            .replace(/@.*$/, "");
        }
      }

      // Check if this user has a channel mapping
      if (this.channelMap.has(userId)) {
        console.log(
          `[ChannelManager:${
            this.instanceId
          }] Found channel ID for user ${userId}: ${this.channelMap.get(
            userId
          )}`
        );
        return this.channelMap.get(userId);
      }

      console.log(
        `[ChannelManager:${this.instanceId}] No channel found for user ${userId}`
      );
      return null;
    } catch (error) {
      console.error(
        `[ChannelManager:${this.instanceId}] Error getting channel ID for ${userId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Map a user to a channel
   * @param {string} userId - User ID or phone number
   * @param {string} channelId - Discord channel ID
   * @param {string} [username] - Optional username
   * @returns {boolean} - Success status
   */
  mapUserToChannel(userId, channelId, username = null) {
    try {
      if (!userId || !channelId) {
        console.error(
          `[ChannelManager:${this.instanceId}] Cannot map user to channel: missing userId or channelId`
        );
        return false;
      }

      // Clean phone number if it's a phone number
      if (
        typeof userId === "string" &&
        (userId.includes("@") || /^\+?\d+$/.test(userId))
      ) {
        // Use a helper to clean the phone number if available
        if (
          this.helpers &&
          typeof this.helpers.cleanPhoneNumber === "function"
        ) {
          userId = this.helpers.cleanPhoneNumber(userId);
        } else {
          // Basic cleaning if helper not available
          userId = userId
            .replace(/@s\.whatsapp\.net/g, "")
            .replace(/@c\.us/g, "")
            .replace(/@g\.us/g, "")
            .replace(/@broadcast/g, "")
            .replace(/@.*$/, "");
        }
      }

      // Save the mapping
      this.channelMap.set(userId, channelId);

      // Also store username if provided
      if (username) {
        this.usernameMap.set(userId, username);
      }

      // Save to disk if persistence is enabled
      if (this.persistEnabled) {
        this.saveMappings();
      }

      console.log(
        `[ChannelManager:${this.instanceId}] Mapped user ${userId} to channel ${channelId}`
      );
      return true;
    } catch (error) {
      console.error(
        `[ChannelManager:${this.instanceId}] Error mapping user ${userId} to channel:`,
        error
      );
      return false;
    }
  }

  /**
   * Get phone number by channel ID
   * @param {string} channelId - Discord channel ID
   * @returns {string|null} - Phone number or null if not found
   */
  getPhoneNumberByChannelId(channelId) {
    try {
      if (!channelId) {
        console.error(
          `[ChannelManager:${this.instanceId}] Cannot get phone number: missing channelId`
        );
        return null;
      }

      // Reverse lookup in the channel map
      for (const [userId, mappedChannelId] of this.channelMap.entries()) {
        if (mappedChannelId === channelId) {
          console.log(
            `[ChannelManager:${this.instanceId}] Found user ${userId} for channel ${channelId}`
          );
          return userId;
        }
      }

      console.log(
        `[ChannelManager:${this.instanceId}] No user found for channel ${channelId}`
      );
      return null;
    } catch (error) {
      console.error(
        `[ChannelManager:${this.instanceId}] Error getting phone number for channel ${channelId}:`,
        error
      );
      return null;
    }
  }
}

module.exports = ChannelManager;

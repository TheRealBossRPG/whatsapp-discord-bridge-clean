// utils/channelManagerUtils.js

/**
 * Helper utility to safely work with ChannelManager across different versions
 * This ensures backward compatibility with different method names
 */
class ChannelManagerUtils {
  /**
   * Safely get a channel for a user
   * @param {Object} channelManager - ChannelManager instance
   * @param {string} userPhone - User's phone number
   * @returns {string|null} - Channel ID or null if not found
   */
  static getChannelForUser(channelManager, userPhone) {
    try {
      // Try different possible method names
      // First try getUserChannel which appears to be the current method
      if (typeof channelManager.getUserChannel === 'function') {
        return channelManager.getUserChannel(userPhone);
      }
      
      // Then try getChannelForUser which might be used in older versions
      if (typeof channelManager.getChannelForUser === 'function') {
        return channelManager.getChannelForUser(userPhone);
      }
      
      // Try other possible method names
      const otherMethodNames = [
        'getChannel', 
        'findUserChannel',
        'findChannelByUser'
      ];
      
      for (const methodName of otherMethodNames) {
        if (typeof channelManager[methodName] === 'function') {
          return channelManager[methodName](userPhone);
        }
      }
      
      // If all methods failed, log an error and return null
      console.error('Could not find a method to get channel for user in channelManager');
      return null;
    } catch (error) {
      console.error('Error getting channel for user:', error);
      return null;
    }
  }
  
  /**
   * Safely map a user to a channel
   * @param {Object} channelManager - ChannelManager instance
   * @param {string} userPhone - User's phone number
   * @param {string} channelId - Channel ID
   * @returns {boolean} - Success
   */
  static mapUserToChannel(channelManager, userPhone, channelId) {
    try {
      // Try the most likely method name
      if (typeof channelManager.mapUserToChannel === 'function') {
        channelManager.mapUserToChannel(userPhone, channelId);
        return true;
      }
      
      // Try alternative method names
      const alternativeMethods = [
        'addUserToChannel',
        'setUserChannel',
        'addMapping'
      ];
      
      for (const methodName of alternativeMethods) {
        if (typeof channelManager[methodName] === 'function') {
          channelManager[methodName](userPhone, channelId);
          return true;
        }
      }
      
      // If no method is found, try to access the internal map directly
      if (channelManager.channelMap) {
        channelManager.channelMap.set(userPhone, channelId);
        return true;
      }
      
      console.error('Could not find a method to map user to channel in channelManager');
      return false;
    } catch (error) {
      console.error('Error mapping user to channel:', error);
      return false;
    }
  }
}

module.exports = ChannelManagerUtils;
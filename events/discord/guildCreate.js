const EventHandler = require('../../templates/EventHandler');

/**
 * Handles when the bot joins a new Discord server
 */
class GuildCreateEvent extends EventHandler {
  constructor() {
    super({
      event: 'guildCreate'
    });
  }
  
  /**
   * Process guild join event
   * @param {Guild} guild - Discord guild
   */
  async execute(guild) {
    try {
      console.log(`Bot joined a new guild: ${guild.name} (${guild.id}) with ${guild.memberCount} members`);
      
      // Check if bot has necessary permissions
      const me = guild.members.cache.get(guild.client.user.id);
      
      if (!me) {
        console.warn(`Could not find bot in guild ${guild.name} (${guild.id})`);
        return;
      }
      
      // Log permissions
      const permissions = me.permissions.toArray();
      console.log(`Bot permissions in ${guild.name}: ${permissions.join(', ')}`);
      
      // Check for critical permissions
      const requiredPermissions = [
        'MANAGE_CHANNELS', 
        'VIEW_CHANNEL', 
        'SEND_MESSAGES', 
        'EMBED_LINKS', 
        'ATTACH_FILES', 
        'READ_MESSAGE_HISTORY', 
        'MANAGE_MESSAGES'
      ];
      
      const missingPermissions = requiredPermissions.filter(perm => !permissions.includes(perm));
      
      if (missingPermissions.length > 0) {
        console.warn(`Missing permissions in ${guild.name}: ${missingPermissions.join(', ')}`);
        
        // Try to notify a guild admin
        try {
          const owner = await guild.fetchOwner();
          if (owner) {
            owner.send(`Thank you for adding the WhatsApp Bridge bot to your server "${guild.name}"! In order to function properly, the bot needs the following permissions which are currently missing:\n\n${missingPermissions.join(', ')}\n\nPlease update the bot's permissions or reinvite it with the correct permissions.`);
          }
        } catch (error) {
          console.error(`Could not notify owner of guild ${guild.name} about missing permissions:`, error);
        }
      } else {
        console.log(`Bot has all required permissions in ${guild.name}`);
      }
    } catch (error) {
      console.error(`Error handling guild create event:`, error);
    }
  }
}

module.exports = new GuildCreateEvent();
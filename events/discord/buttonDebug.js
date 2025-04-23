// events/discord/buttonDebug.js
// Add this as a new event handler to monitor all button interactions

const EventHandler = require('../../templates/EventHandler');
const InstanceManager = require('../../core/InstanceManager');

/**
 * Debug handler for all button interactions
 */
class ButtonDebugEvent extends EventHandler {
  constructor() {
    super({
      event: 'interactionCreate'
    });
  }
  
  /**
   * Process interaction
   * @param {Interaction} interaction - Discord interaction
   */
  async execute(interaction) {
    try {
      // Only process button interactions
      if (!interaction.isButton()) return;
      
      // Log detailed information about the button interaction
      console.log('\n==== BUTTON DEBUG EVENT ====');
      console.log(`Button pressed: ${interaction.customId}`);
      console.log(`Channel ID: ${interaction.channelId}`);
      console.log(`Guild ID: ${interaction.guildId}`);
      console.log(`User: ${interaction.user.tag}`);
      
      // Get the channel information
      try {
        const channel = interaction.channel;
        if (channel) {
          console.log(`Channel name: ${channel.name}`);
          console.log(`Channel type: ${channel.type}`);
          console.log(`Channel parent ID: ${channel.parentId}`);
        }
      } catch (channelError) {
        console.error(`Error getting channel info: ${channelError.message}`);
      }
      
      // Try to get the instance for this interaction
      try {
        const instance = InstanceManager.getInstanceByGuildId(interaction.guildId);
        console.log(`Instance found: ${!!instance}`);
        
        if (instance) {
          console.log(`Instance ID: ${instance.instanceId || 'unknown'}`);
          
          // Check for critical properties
          console.log(`Has direct ticketManager: ${!!instance.ticketManager}`);
          console.log(`Has managers object: ${!!instance.managers}`);
          
          if (instance.managers) {
            console.log(`Has managers.ticketManager: ${!!instance.managers.ticketManager}`);
            
            if (instance.managers.ticketManager) {
              console.log(`managers.ticketManager has closeTicket method: ${typeof instance.managers.ticketManager.closeTicket === 'function'}`);
            }
          }
          
          if (instance.ticketManager) {
            console.log(`ticketManager has closeTicket method: ${typeof instance.ticketManager.closeTicket === 'function'}`);
          }
        }
      } catch (instanceError) {
        console.error(`Error checking instance for button: ${instanceError.message}`);
      }
      
      // Check if a button handler exists for this customId
      try {
        let foundHandler = false;
        
        // Check direct matches
        if (interaction.client.buttons) {
          for (const [buttonId, handler] of interaction.client.buttons) {
            if (buttonId === interaction.customId) {
              console.log(`Found direct button handler match: ${buttonId}`);
              foundHandler = true;
              break;
            }
          }
          
          // If no direct match, check regex handlers
          if (!foundHandler) {
            for (const [buttonId, handler] of interaction.client.buttons) {
              if (handler.regex && handler.regex.test(interaction.customId)) {
                console.log(`Found regex button handler match: ${buttonId} with regex pattern`);
                foundHandler = true;
                break;
              } else if (typeof handler.matches === 'function' && handler.matches(interaction.customId)) {
                console.log(`Found function-based button handler match: ${buttonId}`);
                foundHandler = true;
                break;
              }
            }
          }
        }
        
        console.log(`Button handler found: ${foundHandler}`);
      } catch (handlerError) {
        console.error(`Error checking button handlers: ${handlerError.message}`);
      }
      
      console.log('==== END BUTTON DEBUG EVENT ====\n');
      
      // Do not block other event handlers
    } catch (error) {
      console.error('Error in button debug event:', error);
    }
  }
}

module.exports = new ButtonDebugEvent();
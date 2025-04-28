// commands/editMessages.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const Command = require('../templates/Command');

class EditMessagesCommand extends Command {
  constructor() {
    super({
      name: 'edit-messages',
      description: 'Edit WhatsApp bot messages and toggle features',
      permissions: PermissionFlagsBits.ManageGuild
    });
  }

  async execute(interaction, instance) {
    try {
      // Check if interaction has a valid guild
      if (!interaction.guild) {
        await interaction.reply({
          content: "❌ This command can only be used in a server, not in DMs.",
          ephemeral: true
        });
        return;
      }

      // Make sure the interaction is deferred
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // Check if an instance exists
      if (!instance) {
        // Try to get instance from Discord client route map first
        if (interaction.client._instanceRoutes) {
          // Look through all routes to find matching guild
          for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
            if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
              instance = routeInfo.instance;
              console.log(`Found instance from route map with ID: ${instance?.instanceId || 'unknown'}`);
              break;
            }
          }
        }
        
        if (!instance) {
          await interaction.editReply({
            content: "❌ No WhatsApp bridge is configured for this server. Use `/setup` to set one up.",
            components: []
          });
          return;
        }
      }

      // Get current settings with proper defaults
      const currentSettings = {
        welcomeMessage: "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
        introMessage: "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
        reopenTicketMessage: "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
        newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
        closingMessage: "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
        vouchMessage: "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback.",
        vouchSuccessMessage: "✅ Thank you for your vouch! It has been posted to our community channel.",
        sendClosingMessage: true,
        transcriptsEnabled: true,
        vouchEnabled: true,
        ...instance.customSettings // Override with actual instance settings
      };

      // Create category buttons for message editing
      const categoryRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('edit_welcome_category')
            .setLabel('Welcome Messages')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('👋'),
          new ButtonBuilder()
            .setCustomId('edit_ticket_category')
            .setLabel('Ticket Messages')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📋'),
          new ButtonBuilder()
            .setCustomId('edit_vouch_category')
            .setLabel('Vouch Messages')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⭐')
        );

      // Create a row for feature toggles
      const featureRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('toggle_transcripts')
            .setLabel(`Transcripts: ${currentSettings.transcriptsEnabled !== false ? 'Enabled' : 'Disabled'}`)
            .setStyle(currentSettings.transcriptsEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('toggle_vouches')
            .setLabel(`Vouches: ${currentSettings.vouchEnabled !== false ? 'Enabled' : 'Disabled'}`)
            .setStyle(currentSettings.vouchEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('toggle_closing_messages')
            .setLabel(`Closing Messages: ${currentSettings.sendClosingMessage !== false ? 'Enabled' : 'Disabled'}`)
            .setStyle(currentSettings.sendClosingMessage !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
        );

      // Send message with category buttons
      await interaction.editReply({
        content: "📝 **Edit WhatsApp Bot Messages**\n\nSelect a category of messages to edit or toggle features below.",
        components: [categoryRow, featureRow]
      });
    } catch (error) {
      console.error(`Error in edit-messages command:`, error);
      
      // Make sure we respond even on error
      if (interaction.deferred) {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          components: []
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          content: `❌ Error: ${error.message}`,
          components: [],
          ephemeral: true
        });
      }
    }
  }
}

module.exports = new EditMessagesCommand();
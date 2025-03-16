const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../../templates/Button');

class EditBackToMainButton extends Button {
  constructor() {
    super({
      customId: 'edit_back_to_main'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get instance
      if (!instance) {
        await interaction.update({
          content: '❌ Could not find WhatsApp configuration. Please run `/setup` first.',
          components: []
        });
        return;
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
      
      // Update with main menu
      await interaction.update({
        content: '📝 **Edit WhatsApp Bot Messages**\n\nSelect a category of messages to edit or toggle features below.',
        components: [categoryRow, featureRow]
      });
    } catch (error) {
      console.error('Error handling back button click:', error);
      await interaction.update({
        content: `❌ Error: ${error.message}`,
        components: []
      });
    }
  }
}

module.exports = new EditBackToMainButton();
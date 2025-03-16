const Button = require('../templates/Button');

class ContinueDefaultButton extends Button {
  constructor() {
    super({
      customId: 'continue_default'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.update({
        content: "Continuing with default messages.\n\nGenerating QR code...",
        components: [],
      });
      
      // Get setup info
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId);
      
      // Get bridge instance manager
      const bridgeInstanceManager = require('../core/InstanceManager');
      
      // Prepare default settings
      const customSettings = {
        welcomeMessage: "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
        introMessage: "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
        reopenTicketMessage: "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
        newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
        closingMessage: "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
        vouchMessage: "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.",
        transcriptsEnabled: !!setupParams.transcriptChannelId,
        vouchEnabled: !!setupParams.vouchChannelId,
      };
      
      // Generate QR code with this configuration
      const qrCode = await bridgeInstanceManager.generateQRCode({
        guildId,
        categoryId: setupParams.categoryId,
        transcriptChannelId: setupParams.transcriptChannelId,
        vouchChannelId: setupParams.vouchChannelId,
        customSettings,
        discordClient: interaction.client,
      });
      
      if (qrCode === null) {
        await interaction.editReply({
          content: "✅ WhatsApp is already connected for this server!",
          components: [],
        });
        
        // Clean up setup params
        global.setupStorage.cleanupSetupParams(guildId);
        return;
      }
      
      if (qrCode === "TIMEOUT") {
        await interaction.editReply({
          content: "⚠️ QR code generation timed out. Please try again later.",
          components: [],
        });
        
        // Clean up setup params
        global.setupStorage.cleanupSetupParams(guildId);
        return;
      }
      
      // Import and use the QR code display function
      const { displayQRCode } = require('../utils/qrCodeUtils');
      await displayQRCode(interaction, qrCode, guildId);
      
      // Clean up setup params after successful QR code display
      global.setupStorage.cleanupSetupParams(guildId);
    } catch (error) {
      console.error("Error handling continue with defaults:", error);
      await interaction.editReply({
        content: `❌ Error: ${error.message}`,
        components: [],
      });
    }
  }
}

module.exports = new ContinueDefaultButton();
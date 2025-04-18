const Button = require('../../templates/Button');

class ContinueSetupButton extends Button {
  constructor() {
    super({
      customId: 'continue_setup'
    });
  }
  
  async execute(interaction, instance) {
    try {
      const guildId = interaction.guild.id;
  
      // Get setup info from storage
      const setupParams = global.setupStorage.getSetupParams(guildId);
  
      if (!setupParams || !setupParams.categoryId) {
        console.error(`Setup parameters not found for guild ${guildId}`);
        await interaction.update({
          content: "❌ Error: Setup information not found. Please run /setup again.",
          components: [],
        });
        return;
      }
  
      // Update the button message
      await interaction.update({
        content: `Continuing with setup and generating QR code...`,
        components: [],
      });
  
      // Check multiple sources for custom settings:
      // 1. First check if there are custom settings in the setupParams
      // 2. Then check the global variable
      // 3. Fall back to defaults if neither exists
      let customSettings = setupParams.customSettings || global.lastCustomSettings || {
        welcomeMessage: "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
        introMessage: "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
        reopenTicketMessage: "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
        newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
        closingMessage: "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
        vouchMessage: "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.",
        vouchSuccessMessage: "✅ Thank you for your vouch! It has been posted to our community channel.",
        sendClosingMessage: true,
        transcriptsEnabled: !!setupParams.transcriptChannelId,
        vouchEnabled: !!setupParams.vouchChannelId,
      };
  
      // Log which source we're using for customSettings
      if (setupParams.customSettings) {
        console.log(`Using custom settings from setupParams for guild ${guildId}`);
        console.log("Custom settings content:", JSON.stringify(setupParams.customSettings, null, 2));
      } else if (global.lastCustomSettings) {
        console.log(`Using custom settings from global.lastCustomSettings for guild ${guildId}`);
        console.log("Custom settings content:", JSON.stringify(global.lastCustomSettings, null, 2));
      } else {
        console.log(`Using default settings for guild ${guildId}`);
      }
  
      // IMPORTANT: Save these settings directly to ensure they are persisted
      // Get bridge instance manager
      const InstanceManager = require('../../core/InstanceManager');
      
      // Clear the global variable
      global.lastCustomSettings = null;
  
      // Generate QR code with this configuration
      const qrCode = await InstanceManager.generateQRCode({
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
  
        // Even though already connected, make sure the settings are saved
        const existingInstance = InstanceManager.getInstanceByGuildId(guildId);
        if (existingInstance) {
          await InstanceManager.saveInstanceSettings(existingInstance.instanceId, customSettings);
          console.log(`Saved settings to existing instance ${existingInstance.instanceId}`);
        }
        
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
      const { displayQRCode } = require('../../utils/qrCodeUtils');
      await displayQRCode(interaction, qrCode, guildId);
  
      // Clean up setup params after successful QR code display
      global.setupStorage.cleanupSetupParams(guildId);
    } catch (error) {
      console.error("Error handling continue setup button:", error);
      try {
        await interaction.editReply({
          content: `❌ Error continuing setup: ${error.message}`,
        });
      } catch (followupError) {
        console.error("Error sending error message:", followupError);
      }
    }
  }
}

module.exports = new ContinueSetupButton();
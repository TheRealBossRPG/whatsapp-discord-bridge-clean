// buttons/status/refreshQR.js
const Button = require('../../templates/Button');
const InstanceManager = require('../../core/InstanceManager');
const { displayQRCode } = require('../../utils/qrCodeUtils');

class RefreshQRButton extends Button {
  constructor() {
    super({
      customId: 'refresh_qr'
    });
  }
  
  async execute(interaction, instance) {
    await interaction.update({
      content: "🔄 Refreshing QR code... This will take a moment.",
      components: [],
      embeds: []
    });

    try {
      // Get the instance if not provided
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }

      if (!instance) {
        await interaction.editReply({
          content:
            "❌ No WhatsApp connection is configured for this server. Use `/setup` to set one up.",
          components: [],
        });
        return;
      }

      // Generate a fresh QR code
      const refreshedQR = await InstanceManager.generateQRCode({
        guildId: interaction.guild.id,
        categoryId: instance.categoryId,
        transcriptChannelId: instance.transcriptChannelId,
        vouchChannelId: instance.vouchChannelId,
        discordClient: interaction.client,
      });

      if (refreshedQR === null) {
        // Already authenticated
        await interaction.editReply({
          content: "✅ WhatsApp is already connected for this server!",
          embeds: [],
          components: [],
          files: [],
        });
        return;
      }

      if (refreshedQR === "TIMEOUT") {
        await interaction.editReply({
          content: "⚠️ QR code generation timed out. Please try again later.",
          embeds: [],
          components: [],
          files: [],
        });
        return;
      }

      // Display the new QR code
      await displayQRCode(interaction, refreshedQR, interaction.guild.id);
    } catch (error) {
      console.error(`Error refreshing QR code: ${error.message}`);
      await interaction.editReply({
        content: `⚠️ Error refreshing QR code: ${error.message}. Please try running /setup again.`,
        embeds: [],
        components: [],
        files: [],
      });
    }
  }
}

module.exports = new RefreshQRButton();
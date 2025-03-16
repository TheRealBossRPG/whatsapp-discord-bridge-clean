// utils/qrCodeUtils.js
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Generate and display QR code for WhatsApp connection
 * @param {Object} interaction - Discord interaction
 * @param {string} qrCode - QR code string data
 * @param {string} guildId - Guild ID
 * @returns {Promise<boolean>} - Success status
 */
async function displayQRCode(interaction, qrCode, guildId) {
  try {
    // Validate inputs
    if (
      !interaction ||
      !interaction.editReply ||
      typeof interaction.editReply !== "function"
    ) {
      throw new Error("Invalid interaction object");
    }

    if (!qrCode || typeof qrCode !== "string" || qrCode.trim() === "") {
      throw new Error("Invalid or empty QR code");
    }

    if (!guildId) {
      throw new Error("Missing guild ID");
    }

    // Let user know we're generating the QR code
    await interaction.editReply({
      content: "⌛ Generating QR code for WhatsApp connection...",
      components: [],
    });

    // Create directory for QR code if it doesn't exist
    const instancesDir = path.join(__dirname, "..", "instances");
    const guildDir = path.join(instancesDir, guildId);

    if (!fs.existsSync(guildDir)) {
      fs.mkdirSync(guildDir, { recursive: true });
    }

    const qrCodePath = path.join(guildDir, "qrcode.png");

    console.log(
      `Generating QR code image for guild ${guildId}, QR data length: ${qrCode.length}`
    );

    // Generate QR code image with larger size and better margins
    await qrcode.toFile(qrCodePath, qrCode, {
      scale: 12, // Larger scale for clearer image
      margin: 4,
      color: {
        dark: "#000000", // Pure black for better scanning
        light: "#FFFFFF",
      },
      errorCorrectionLevel: "H", // Highest error correction
    });

    console.log(`QR code image saved to ${qrCodePath}`);

    // Verify file was created
    if (!fs.existsSync(qrCodePath)) {
      throw new Error("QR code file was not created");
    }

    // Create modern embed with clearer instructions
    const embed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord blurple color
      .setTitle("📱 Connect WhatsApp")
      .setDescription(
        "**Scan this QR code with your WhatsApp to connect to your Discord server.**"
      )
      .addFields(
        {
          name: "📋 How to Connect",
          value:
            '1️⃣ Open WhatsApp on your phone\n2️⃣ Tap Menu (⋮) or Settings (⚙️)\n3️⃣ Select "WhatsApp Web/Desktop"\n4️⃣ Tap "Link a device"\n5️⃣ Point your camera at this QR code',
        },
        {
          name: "🔄 Connection Status",
          value:
            "`⌛ Waiting for scan...`\nThis message will update when your device connects.",
        },
        {
          name: "⏰ QR Code Expiration",
          value:
            'This QR code will expire after a few minutes. If it expires, use the "Refresh QR Code" button below to generate a fresh one.',
        }
      )
      .setFooter({ text: "WhatsApp-Discord Bridge • Scan to Connect" })
      .setTimestamp();

    // Create attachment from QR code image
    const attachment = new AttachmentBuilder(qrCodePath, {
      name: "qrcode.png",
    });
    embed.setImage("attachment://qrcode.png");

    // Create a button for refreshing the QR code if needed
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("refresh_qr")
        .setLabel("Refresh QR Code")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄")
    );

    // Update the reply with QR code and instructions
    const message = await interaction.editReply({
      content: "",
      embeds: [embed],
      files: [attachment],
      components: [row],
    });

    // Init global storage for QR code messages if needed
    if (!global.qrCodeMessages) {
      global.qrCodeMessages = new Map();
    }

    // Store the interaction data for updates when connection status changes
    global.qrCodeMessages.set(guildId, {
      interaction,
      message,
      embedData: embed.toJSON(),
    });

    // Set up connection status updates
    startConnectionStatusUpdates(guildId, interaction, embed);

    return true;
  } catch (error) {
    console.error("Error displaying QR code in Discord:", error);
    try {
      await interaction.editReply({
        content: `⚠️ Error displaying QR code: ${error.message}. Please try again.`,
        embeds: [],
        files: [],
      });
    } catch (replyError) {
      console.error(
        "Additional error trying to send error message:",
        replyError
      );
    }
    return false;
  }
}

/**
 * Set up connection status updates for the QR code message
 * @param {string} guildId - Guild ID
 * @param {Object} interaction - Discord interaction
 * @param {Object} embed - Original embed
 */
function startConnectionStatusUpdates(guildId, interaction, embed) {
  const InstanceManager = require('../core/InstanceManager');
  
  // Set up a connection status updater for this instance
  const instance = InstanceManager.getInstanceByGuildId(guildId);
  if (instance) {
    // Set up onReady handler to update message
    instance.onReady(async () => {
      try {
        console.log(
          `WhatsApp connected for guild ${guildId}, updating QR code message`
        );

        // Get stored data
        const storedData = global.qrCodeMessages.get(guildId);
        if (!storedData) {
          console.log(
            `No stored QR code message data found for guild ${guildId}`
          );
          return;
        }

        // Create a success embed based on the original
        const successEmbed = new EmbedBuilder(storedData.embedData)
          .setColor(0x57f287) // Discord green for success
          .setTitle("📱 WhatsApp Connected Successfully!")
          .setDescription(
            "**Your WhatsApp account is now connected to this Discord server!**"
          )
          .spliceFields(1, 1, {
            name: "🔄 Connection Status",
            value:
              "`✅ Connected and ready!`\nYour WhatsApp messages will now appear in channels within the configured category.",
          });

        // Update the interaction reply
        await interaction.editReply({
          content: "",
          embeds: [successEmbed],
          files: [], // Remove QR code
          components: [], // Remove buttons
        });

        // Clean up the stored data
        global.qrCodeMessages.delete(guildId);

        console.log(
          `QR code message updated to show successful connection for guild ${guildId}`
        );
      } catch (updateError) {
        console.error(
          `Error updating QR code message on connection: ${updateError.message}`
        );
      }
    });
  }
}

module.exports = {
  displayQRCode
};
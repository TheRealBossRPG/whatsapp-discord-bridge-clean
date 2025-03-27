// buttons/status/refreshQR.js - FIXED path issue
const Button = require('../../templates/Button');
const { refreshQRCode } = require('../../utils/qrCodeUtils');

class RefreshQRButton extends Button {
  constructor() {
    super({
      customId: 'refresh_qr'
    });
  }
  
  async execute(interaction, instance) {
    // Use the QR code refresh handler from qrCodeUtils
    return await refreshQRCode(interaction, instance);
  }
}

module.exports = new RefreshQRButton();
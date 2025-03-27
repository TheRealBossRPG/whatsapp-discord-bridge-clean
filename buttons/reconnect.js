// buttons/reconnect.js
const Button = require('../templates/Button');
const { handleReconnect } = require('../utils/qrCodeUtils');

class ReconnectButton extends Button {
  constructor() {
    super({
      customId: 'reconnect'
    });
  }
  
  async execute(interaction, instance) {
    // Use the unified reconnect handler from qrCodeUtils
    return await handleReconnect(interaction, instance);
  }
}

module.exports = new ReconnectButton();
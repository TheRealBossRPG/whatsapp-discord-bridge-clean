// buttons/status/reconnectStatus.js
const Button = require('../../templates/Button');
const { handleReconnect } = require('../../utils/qrCodeUtils');

class ReconnectStatusButton extends Button {
  constructor() {
    super({
      customId: 'reconnect_status'
    });
  }
  
  async execute(interaction, instance) {
    // Use the unified reconnect handler with status flag
    return await handleReconnect(interaction, instance, {
      fromStatus: true
    });
  }
}

module.exports = new ReconnectStatusButton();
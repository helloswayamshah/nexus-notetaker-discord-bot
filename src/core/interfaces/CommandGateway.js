const { NotImplementedError } = require('./_abstract');

class CommandGateway {
  /** Start listening for platform events. Long-lived. */
  async start() { throw new NotImplementedError('start'); }
  /** Graceful shutdown. */
  async stop() { throw new NotImplementedError('stop'); }
}

module.exports = { CommandGateway };

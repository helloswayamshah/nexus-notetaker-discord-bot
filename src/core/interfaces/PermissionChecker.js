const { NotImplementedError } = require('./_abstract');

/**
 * Abstract permission checker. Each platform overrides this to decide whether
 * a given user context has permission to configure the bot for a tenant.
 */
class PermissionChecker {
  /**
   * @param {object} ctx  platform-specific context (interaction, request, etc.)
   * @param {object} tenantConfig  current tenant configuration row
   * @returns {boolean}
   */
  canConfigure(ctx, tenantConfig) { throw new NotImplementedError('canConfigure'); }
}

module.exports = { PermissionChecker };

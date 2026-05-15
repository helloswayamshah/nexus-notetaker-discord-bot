const { PermissionChecker } = require('../../core/interfaces/PermissionChecker');

class SlackPermissionChecker extends PermissionChecker {
  constructor(client) {
    super();
    this._client = client;
  }

  async canConfigure(userId, tenantConfig) {
    try {
      const { user } = await this._client.users.info({ user: userId });
      if (user.is_admin || user.is_owner) return true;
    } catch {
      // fall through to role check if users.info fails (missing scope, etc.)
    }

    const allowedIds = (tenantConfig.slack_config_role || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    return allowedIds.includes(userId);
  }
}

module.exports = { SlackPermissionChecker };

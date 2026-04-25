const { PermissionFlagsBits } = require('discord.js');
const { PermissionChecker } = require('../../core/interfaces/PermissionChecker');

/**
 * Discord-specific permission checker.
 * Checks Manage Server permission and optional config role.
 */
class DiscordPermissionChecker extends PermissionChecker {
  canConfigure(interaction, tenantConfig) {
    const perms = interaction.memberPermissions;
    if (perms && perms.has(PermissionFlagsBits.ManageGuild)) return true;

    if (tenantConfig?.config_role_id) {
      const roles = interaction.member?.roles;
      const hasRole = Array.isArray(roles)
        ? roles.includes(tenantConfig.config_role_id)
        : roles?.cache?.has?.(tenantConfig.config_role_id);
      if (hasRole) return true;
    }
    return false;
  }
}

// Convenience function matching the old canConfigure(interaction, cfg) signature.
const checker = new DiscordPermissionChecker();
function canConfigure(interaction, cfg) {
  return checker.canConfigure(interaction, cfg);
}

module.exports = { canConfigure, DiscordPermissionChecker };

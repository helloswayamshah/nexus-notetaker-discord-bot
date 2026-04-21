const { PermissionFlagsBits } = require('discord.js');

function canConfigure(interaction, guildCfg) {
  const perms = interaction.memberPermissions;
  if (perms && perms.has(PermissionFlagsBits.ManageGuild)) return true;

  if (guildCfg?.config_role_id) {
    const roles = interaction.member?.roles;
    const hasRole = Array.isArray(roles)
      ? roles.includes(guildCfg.config_role_id)
      : roles?.cache?.has?.(guildCfg.config_role_id);
    if (hasRole) return true;
  }
  return false;
}

module.exports = { canConfigure };

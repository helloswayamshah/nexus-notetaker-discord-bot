const { MessageFlags } = require('discord.js');
const { createLogger } = require('../../../core/utils/logger');

const log = createLogger('dispatch');

function createDispatcher(commandMap) {
  return async function dispatch(interaction) {
    if (!interaction.isChatInputCommand()) return;
    const command = commandMap.get(interaction.commandName);
    if (!command) {
      log.warn('unknown command', { command: interaction.commandName });
      return;
    }

    const sub = safeGetSubcommand(interaction);
    const meta = {
      command: interaction.commandName,
      subcommand: sub,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      user: interaction.user.tag,
    };
    const timer = log.time(interaction.commandName + (sub ? `:${sub}` : ''));
    log.info('command start', meta);

    try {
      await command.execute(interaction);
      timer.end('command ok', meta);
    } catch (err) {
      timer.fail('command failed', err, meta);
      const body = {
        content: `Unexpected error running \`/${interaction.commandName}\`: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      };
      try {
        if (interaction.deferred) {
          await interaction.editReply(body);
        } else if (interaction.replied) {
          await interaction.followUp(body);
        } else {
          await interaction.reply(body);
        }
      } catch (replyErr) {
        log.error('failed to report error to user', { err: replyErr, ...meta });
      }
    }
  };
}

function safeGetSubcommand(interaction) {
  try {
    return interaction.options.getSubcommand(false) || null;
  } catch {
    return null;
  }
}

module.exports = { createDispatcher };

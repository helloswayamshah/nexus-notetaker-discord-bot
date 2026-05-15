const sessions = new Map(); // guildId -> VoiceSession

function setSession(guildId, session) {
  sessions.set(guildId, session);
}

function getSession(guildId) {
  return sessions.get(guildId);
}

function clearSession(guildId) {
  sessions.delete(guildId);
}

module.exports = { setSession, getSession, clearSession };

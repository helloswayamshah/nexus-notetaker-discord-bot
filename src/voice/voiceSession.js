const fs = require('node:fs');
const path = require('node:path');
const { EndBehaviorType, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { OpusEncoder } = require('@discordjs/opus');
const { createLogger } = require('../utils/logger');

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FLUSH_TIMEOUT_MS = 5000;
// 20ms of 48kHz stereo silence, 16-bit PCM — emitted when a packet fails to decode,
// so timing stays roughly correct and whisper doesn't splice unrelated audio together.
const SILENCE_FRAME = Buffer.alloc(48 * 20 * CHANNELS * 2);

class VoiceSession {
  constructor({ connection, guildId, channelId, outDir, resolveDisplayName }) {
    this.connection = connection;
    this.guildId = guildId;
    this.channelId = channelId;
    this.outDir = outDir;
    this.resolveDisplayName = resolveDisplayName;
    this.startedAt = Date.now();
    this.segments = [];
    this.activeStreams = new Map(); // userId -> { writeStream, opusStream }
    this.pendingWrites = [];
    this.log = createLogger('voice').child(guildId);
    this._onSpeakingStart = (userId) => this._handleStart(userId);
  }

  start() {
    fs.mkdirSync(this.outDir, { recursive: true });
    this.connection.receiver.speaking.on('start', this._onSpeakingStart);
    this.log.info('session started', {
      guildId: this.guildId,
      channelId: this.channelId,
      outDir: this.outDir,
    });
  }

  _handleStart(userId) {
    if (this.activeStreams.has(userId)) return;

    const startMs = Date.now() - this.startedAt;
    const pcmPath = path.join(this.outDir, `${userId}_${startMs}.pcm`);

    const opusStream = this.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });
    const decoder = new OpusEncoder(SAMPLE_RATE, CHANNELS);
    const out = fs.createWriteStream(pcmPath);

    this.activeStreams.set(userId, { writeStream: out, opusStream });
    this.log.debug('speaker opened', { userId, startMs, pcmPath });

    let packetsOk = 0;
    let packetsBad = 0;

    const writePromise = new Promise((resolve) => {
      let settled = false;
      const finish = async (reason) => {
        if (settled) return;
        settled = true;
        const endMs = Date.now() - this.startedAt;
        this.activeStreams.delete(userId);
        let displayName = userId;
        try {
          displayName = await this.resolveDisplayName(userId);
        } catch (err) {
          this.log.warn('resolveDisplayName failed', { userId, err });
        }
        let size = 0;
        try {
          size = fs.statSync(pcmPath).size;
        } catch {
          /* may not exist */
        }
        this.segments.push({ userId, displayName, startMs, endMs, pcmPath, size });
        this.log.debug('speaker closed', {
          userId,
          displayName,
          durationMs: endMs - startMs,
          bytes: size,
          packetsOk,
          packetsBad,
          reason,
        });
        resolve();
      };
      out.on('close', () => finish('close'));
      out.on('error', (err) => {
        this.log.warn('writeStream error', { userId, err });
        finish('error');
      });
    });

    this.pendingWrites.push(writePromise);

    opusStream.on('data', (packet) => {
      try {
        const pcm = decoder.decode(packet);
        packetsOk++;
        if (!out.write(pcm)) {
          opusStream.pause();
          out.once('drain', () => opusStream.resume());
        }
      } catch (err) {
        packetsBad++;
        // Discord occasionally sends silence/comfort-noise frames that Opus can't
        // decode. Write 20ms of PCM silence so timestamps stay aligned.
        out.write(SILENCE_FRAME);
        if (packetsBad === 1 || packetsBad % 100 === 0) {
          this.log.debug('skipped bad opus packet', {
            userId,
            packetsBad,
            err: err.message,
          });
        }
      }
    });

    opusStream.on('error', (err) => {
      this.log.warn('opusStream error', { userId, err });
      try {
        out.end();
      } catch {}
    });
    opusStream.on('end', () => out.end());
    opusStream.on('close', () => out.end());
  }

  async stop() {
    this.log.info('stopping session', {
      activeStreams: this.activeStreams.size,
      recordedSegments: this.segments.length,
    });
    this.connection.receiver.speaking.off('start', this._onSpeakingStart);

    // Nudge any still-active streams to end so their pending write promise resolves.
    for (const [userId, { opusStream }] of this.activeStreams) {
      try {
        opusStream.destroy();
      } catch (err) {
        this.log.warn('failed to destroy opusStream', { userId, err });
      }
    }

    try {
      this.connection.destroy();
    } catch (err) {
      this.log.warn('connection.destroy threw', { err });
    }

    const flushRace = Promise.race([
      Promise.all(this.pendingWrites),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), FLUSH_TIMEOUT_MS)),
    ]);
    const result = await flushRace;
    if (result === 'timeout') {
      this.log.warn('flush timed out; proceeding with partial segments', {
        pendingCount: this.activeStreams.size,
        totalSegments: this.segments.length,
      });
    } else {
      this.log.info('flush complete', { totalSegments: this.segments.length });
    }
    return this.segments;
  }
}

async function waitUntilReady(connection) {
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
}

module.exports = { VoiceSession, waitUntilReady, SAMPLE_RATE, CHANNELS };

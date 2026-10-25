/** Escreve cabeçalho WAV PCM (44 bytes) no início de `target`. */
function writePcmWavHeader(
  target: Buffer,
  opts: { sampleRate: number; numChannels: number; bitsPerSample: number; dataSize: number },
) {
  const { sampleRate, numChannels, bitsPerSample, dataSize } = opts;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const chunkSize = 36 + dataSize;
  let o = 0;
  target.write("RIFF", o);
  o += 4;
  target.writeUInt32LE(chunkSize, o);
  o += 4;
  target.write("WAVE", o);
  o += 4;
  target.write("fmt ", o);
  o += 4;
  target.writeUInt32LE(16, o);
  o += 4;
  target.writeUInt16LE(1, o);
  o += 2;
  target.writeUInt16LE(numChannels, o);
  o += 2;
  target.writeUInt32LE(sampleRate, o);
  o += 4;
  target.writeUInt32LE(byteRate, o);
  o += 4;
  target.writeUInt16LE(blockAlign, o);
  o += 2;
  target.writeUInt16LE(bitsPerSample, o);
  o += 2;
  target.write("data", o);
  o += 4;
  target.writeUInt32LE(dataSize, o);
}

/** Áudio silencioso PCM 16-bit mono para testes E2E. */
export function buildSilentPcmWavBuffer(
  durationSec: number,
  sampleRate = 8000,
  numChannels = 1,
  bitsPerSample = 16,
): Buffer {
  if (durationSec <= 0 || !Number.isFinite(durationSec)) {
    throw new Error("durationSec inválido");
  }
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * numChannels * bytesPerSample;
  const headerSize = 44;
  const out = Buffer.alloc(headerSize + dataSize);
  writePcmWavHeader(out, { sampleRate, numChannels, bitsPerSample, dataSize });
  out.fill(0, headerSize);
  return out;
}

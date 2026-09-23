// Longer, independent stereo textures. Road noise has contact grains and
// irregular density, wind has slow pressure movement, and rain has many small
// overlapping droplets. They no longer share the same pink-noise fingerprint.
export function createTextureBuffer(ctx, kind) {
  const rate = ctx.sampleRate, length = Math.round(rate * 8), overlap = Math.round(rate * .12);
  const buffer = ctx.createBuffer(2, length, rate);
  let state = { road: 0x173acd, wind: 0x712abc, rain: 0x817de }[kind] ?? 0x173acd;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel), tail = new Float32Array(overlap);
    let low = 0, mid = 0, grain = 0, pressure = 0;
    const lowRate = 1 - Math.exp(-2 * Math.PI * 110 / rate), midRate = 1 - Math.exp(-2 * Math.PI * 2200 / rate);
    const grainDecay = Math.exp(-1 / (rate * (kind === 'rain' ? .0025 : .006)));
    for (let i = 0; i < length + overlap; i++) {
      const white = random() * 2 - 1;
      low += (white - low) * lowRate; mid += (white - mid) * midRate;
      pressure += (Math.abs(low) * 9 - pressure) * .0002;
      if (random() < (kind === 'rain' ? 1600 : 480) / rate) grain += random() ** 3;
      grain *= grainDecay;
      const raw = kind === 'wind' ? low * 2.2 + mid * .12 * (.4 + pressure)
        : kind === 'rain' ? (white - mid) * (.07 + grain * .28) + mid * .2
          : low * .65 + mid * (.16 + grain * .45) * (.65 + pressure);
      const sample = .8 * Math.tanh(raw / .8);
      if (i < length) data[i] = sample; else tail[i - length] = sample;
    }
    for (let i = 0; i < overlap; i++) {
      const phase = i / (overlap - 1) * Math.PI / 2;
      data[i] = tail[i] * Math.cos(phase) + data[i] * Math.sin(phase);
    }
  }
  return buffer;
}

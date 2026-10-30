class PCMProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Float32Array(2048); this.offset = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      this.samples[this.offset++] = sample;
      if (this.offset === this.samples.length) {
        const buffer = new ArrayBuffer(this.samples.length * 2), view = new DataView(buffer);
        let energy = 0;
        this.samples.forEach((value, j) => {
          const s = Math.max(-1, Math.min(1, value)); energy += s * s;
          view.setInt16(j * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
        });
        this.port.postMessage({buffer, rms: Math.sqrt(energy / this.samples.length)}, [buffer]); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMProcessor);

export class AudioIO {
  constructor(onLevel) { this.onLevel = onLevel; this.sources = new Set(); this.nextTime = 0; this.generation = 0; }
  async prepare() {
    if (!this.output || this.output.state === 'closed') this.output = new AudioContext({sampleRate: 24000});
    await this.output.resume();
  }
  async startMic(onChunk) {
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream;
    this.input = new AudioContext({sampleRate: 16000});
    await this.input.audioWorklet.addModule('/pcm-worklet.js');
    if (generation !== this.generation) return false;
    const ctx = this.input;
    this.capture = new AudioWorkletNode(ctx, 'pcm-capture');
    this.capture.port.onmessage = ({data}) => {
      if (generation !== this.generation) return;
      this.onLevel(data.rms);
      const bytes = new Uint8Array(data.buffer);
      let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
      onChunk({data: btoa(binary), mimeType: `audio/pcm;rate=${ctx.sampleRate}`});
    };
    this.inputSource = ctx.createMediaStreamSource(stream);
    this.inputSource.connect(this.capture);
    // The processor emits silence; connecting keeps capture active without mic feedback.
    this.capture.connect(ctx.destination);
    await ctx.resume(); return generation === this.generation;
  }
  stopMic() {
    ++this.generation;
    this.capture?.disconnect(); this.inputSource?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    if (this.input?.state !== 'closed') this.input?.close().catch(() => {});
    this.input = null; this.stream = null; this.capture = null; this.inputSource = null; this.onLevel(0);
  }
  play(data, mimeType) {
    if (!this.output || this.output.state === 'closed') return;
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    if (bytes.length % 2) throw new Error('Invalid PCM audio chunk.');
    const rate = Number(mimeType.match(/rate=(\d+)/)?.[1] || 24000);
    const buffer = this.output.createBuffer(1, bytes.length / 2, rate);
    const view = new DataView(bytes.buffer), samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    const source = this.output.createBufferSource(); source.buffer = buffer; source.connect(this.output.destination);
    this.nextTime = Math.max(this.nextTime, this.output.currentTime + .025);
    this.sources.add(source); source.onended = () => this.sources.delete(source);
    source.start(this.nextTime); this.nextTime += buffer.duration;
  }
  stopPlayback() { for (const source of this.sources) { try { source.stop(); } catch {} } this.sources.clear(); this.nextTime = 0; }
  close() { this.stopMic(); this.stopPlayback(); if (this.output?.state !== 'closed') this.output?.close().catch(() => {}); this.output = null; }
}

// AudioWorklet that turns the 2-channel graph (L = mic, R = meeting tab) into interleaved int16 PCM blocks.

class StereoPcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockFrames = 4000; // 0.25 s at 16 kHz
    this.buffer = new Int16Array(this.blockFrames * 2);
    this.filled = 0;
    this.levelAcc = [0, 0];
    this.levelCount = 0;
    this.port.onmessage = (e) => {
      if (e.data === "flush") {
        this.emit();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  emit() {
    if (this.filled === 0) return;
    const out = this.buffer.slice(0, this.filled * 2);
    this.port.postMessage({ type: "pcm", buffer: out.buffer }, [out.buffer]);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const left = input[0];
    const right = input[1] || new Float32Array(left.length);

    for (let i = 0; i < left.length; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      this.buffer[this.filled * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
      this.buffer[this.filled * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
      this.levelAcc[0] += l * l;
      this.levelAcc[1] += r * r;
      this.levelCount++;
      this.filled++;
      if (this.filled === this.blockFrames) {
        this.emit();
        const n = this.levelCount || 1;
        this.port.postMessage({
          type: "level",
          mic: Math.sqrt(this.levelAcc[0] / n),
          tab: Math.sqrt(this.levelAcc[1] / n),
        });
        this.levelAcc = [0, 0];
        this.levelCount = 0;
      }
    }
    return true;
  }
}

registerProcessor("stereo-pcm-recorder", StereoPcmRecorder);

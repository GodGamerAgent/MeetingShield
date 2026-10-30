// AURA-MEET single-stream capture engine (offscreen document)
// Mic -> left channel, meeting tab -> right channel, one sample-aligned stereo stream to the backend.
// Nothing is transcribed live; the backend stores audio.wav and transcribes once the meeting ends.

const WS_URL = "ws://localhost:8000/ws/audio";
const MAX_QUEUED_BYTES = 16000 * 2 * 2 * 60 * 15; // keep up to 15 min of audio while the backend is unreachable

let ctx = null;
let micStream = null;
let tabStream = null;
let recorderNode = null;
let merger = null;
let socket = null;
let meetingId = null;
let capturing = false;
let queue = [];
let queuedBytes = 0;
let reconnectTimer = null;
let reconnectDelay = 1000;
let endResolver = null;
let stopping = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;
  if (message.type === "START_CAPTURE") {
    startCapture(message.data).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
  if (message.type === "ADD_MIC") {
    attachMic().then((micOk) => sendResponse({ ok: micOk }));
    return true;
  }
  if (message.type === "STOP_CAPTURE") {
    stopCapture().then(sendResponse, (err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
  return false;
});

async function startCapture({ meetingId: id, streamId }) {
  if (capturing) await stopCapture();
  meetingId = id;
  stopping = false;
  queue = [];
  queuedBytes = 0;

  ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule("recorder-worklet.js");
  merger = ctx.createChannelMerger(2);

  // Meeting tab audio (right channel). tabCapture mutes the tab, so route it back to the speakers.
  let tabOk = false;
  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: false,
    });
    const tabSource = ctx.createMediaStreamSource(tabStream);
    tabSource.connect(ctx.destination);
    tabSource.connect(merger, 0, 1);
    tabOk = true;
    tabStream.getAudioTracks()[0].addEventListener("ended", () => reportError("Meeting tab audio stopped."));
  } catch (err) {
    console.warn("[AuraMeet] Tab capture failed:", err);
  }

  const micOk = await attachMic();

  if (!tabOk && !micOk) {
    await teardownAudio();
    return { ok: false, error: "Neither the meeting tab nor the microphone could be captured." };
  }

  recorderNode = new AudioWorkletNode(ctx, "stereo-pcm-recorder", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: "explicit",
    channelInterpretation: "discrete",
  });
  recorderNode.port.onmessage = onWorkletMessage;
  merger.connect(recorderNode);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  recorderNode.connect(sink).connect(ctx.destination); // keeps the worklet pulled

  capturing = true;
  connectSocket();
  return { ok: true, micOk, tabOk };
}

// Microphone (left channel). Echo cancellation keeps the meeting audio out of the mic.
async function attachMic() {
  if (!ctx || !merger) return false;
  if (micStream) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    ctx.createMediaStreamSource(micStream).connect(merger, 0, 0);
    return true;
  } catch (err) {
    console.warn("[AuraMeet] Microphone capture failed:", err);
    return false;
  }
}

function onWorkletMessage(e) {
  const msg = e.data;
  if (msg.type === "pcm") {
    enqueue(msg.buffer);
  } else if (msg.type === "level") {
    chrome.runtime.sendMessage({
      type: "LEVELS",
      meetingId,
      mic: Math.min(1, Math.sqrt(msg.mic) * 2.2),
      tab: Math.min(1, Math.sqrt(msg.tab) * 2.2),
    }).catch(() => {});
  } else if (msg.type === "flushed" && flushResolver) {
    flushResolver();
  }
}

// ----------------- Socket with buffering & reconnect -----------------
function connectSocket() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(WS_URL);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    reconnectDelay = 1000;
    socket.send(JSON.stringify({ type: "INIT", meeting_id: meetingId, channels: 2, sample_rate: 16000 }));
    drain();
  };
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.status === "ENDED" && endResolver) endResolver();
      if (data.status === "STOP_REQUESTED" && !stopping) {
        chrome.runtime.sendMessage({ type: "STOP_RECORDING", reason: "dashboard" }).catch(() => {});
      }
    } catch (e) {}
  };
  socket.onclose = () => {
    if (capturing) {
      reconnectTimer = setTimeout(connectSocket, reconnectDelay);
      reconnectDelay = Math.min(10000, reconnectDelay * 2);
    }
  };
  socket.onerror = () => {};
}

function enqueue(buffer) {
  queue.push(buffer);
  queuedBytes += buffer.byteLength;
  while (queuedBytes > MAX_QUEUED_BYTES && queue.length) {
    queuedBytes -= queue.shift().byteLength;
  }
  drain();
}

function drain() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  while (queue.length) {
    const buf = queue.shift();
    queuedBytes -= buf.byteLength;
    socket.send(buf);
  }
}

// ----------------- Stop -----------------
let flushResolver = null;

async function stopCapture() {
  if (!capturing && !ctx) return { ok: true };
  stopping = true;

  // Pull the last partial block out of the worklet
  if (recorderNode) {
    await withTimeout(new Promise((resolve) => {
      flushResolver = resolve;
      recorderNode.port.postMessage("flush");
    }), 1000);
    flushResolver = null;
  }
  await teardownAudio();

  // Make sure every queued byte is on the backend before we report success
  let delivered = true;
  if (queue.length && (!socket || socket.readyState !== WebSocket.OPEN)) {
    delivered = await withTimeout(new Promise((resolve) => {
      const check = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          clearInterval(check);
          resolve(true);
        }
      }, 200);
    }), 8000);
  }
  drain();
  if (socket && socket.readyState === WebSocket.OPEN) {
    await withTimeout(new Promise((resolve) => {
      endResolver = resolve;
      socket.send(JSON.stringify({ type: "END" }));
    }), 5000);
  }
  capturing = false;
  endResolver = null;
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  const lost = queue.length > 0;
  queue = [];
  queuedBytes = 0;
  return delivered && !lost ? { ok: true } : { ok: false, error: "Backend was unreachable; the end of the recording may be missing." };
}

async function teardownAudio() {
  for (const stream of [micStream, tabStream]) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
  micStream = null;
  tabStream = null;
  if (recorderNode) {
    recorderNode.port.onmessage = null;
    recorderNode.disconnect();
    recorderNode = null;
  }
  if (ctx) {
    await ctx.close().catch(() => {});
    ctx = null;
  }
  merger = null;
}

function reportError(error) {
  if (capturing && !stopping) chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", error }).catch(() => {});
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
}

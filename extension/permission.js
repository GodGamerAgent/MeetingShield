// Quorum One-Time Microphone Permission Grant Handler

const statusEl = document.getElementById("status");
const grantBtn = document.getElementById("grant-btn");

async function requestMicAccess() {
  statusEl.className = "status-msg";
  statusEl.textContent = "Requesting browser microphone access...";
  grantBtn.disabled = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Permission granted! Stop all tracks
    stream.getTracks().forEach((track) => track.stop());

    statusEl.className = "status-msg success";
    statusEl.innerHTML = "✅ Microphone access granted!<br><span style='font-size:11px;font-weight:normal;'>Returning to your meeting in a moment...</span>";

    // Notify extension components that microphone permission is now permanently granted
    try {
      chrome.runtime.sendMessage({ type: "MIC_PERMISSION_GRANTED" });
    } catch (e) {}

    setTimeout(() => {
      window.close();
    }, 1200);
  } catch (err) {
    grantBtn.disabled = false;
    statusEl.className = "status-msg error";
    if (err.name === "NotAllowedError" || (err.message && err.message.toLowerCase().includes("dismissed"))) {
      statusEl.innerHTML = "Access dismissed. Please click <strong>Allow</strong> on the prompt, or click the 🔒 icon in the URL bar above to allow microphone access.";
    } else {
      statusEl.textContent = "Error accessing microphone: " + (err.message || err);
    }
  }
}

grantBtn.addEventListener("click", requestMicAccess);

// Automatically request on load
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(requestMicAccess, 300);
});
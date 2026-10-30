import io
import os
import re
import json
import math
import wave
import threading
import numpy as np
from scipy import signal
from typing import Tuple, Optional, Dict, Any, List, Callable
from config_store import config_store

# Try importing faster_whisper
try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    FASTER_WHISPER_AVAILABLE = False
    WhisperModel = None

SAMPLE_RATE = 16000
WAV_HEADER_BYTES = 44

# Channel layout of a session recording: one sample-aligned stereo stream.
CH_MIC = 0  # left  = the user's microphone ("Me")
CH_TAB = 1  # right = meeting tab audio ("Others")

# Phrases Whisper is known to hallucinate on silence / music.
HALLUCINATION_PATTERNS = [
    r"^thanks? (you )?for watching[.!]*$",
    r"^thank you\.?$",
    r"^please subscribe",
    r"^subtitles? by",
    r"^transcribed by",
    r"^\[?(music|applause|silence|blank_audio)\]?$",
    r"^you$",
    r"^\.+$",
]


class AudioPipeline:
    def __init__(self):
        self.model: Optional[Any] = None
        self._loaded_model_name: Optional[str] = None
        self._model_lock = threading.Lock()
        self._file_locks: Dict[str, threading.Lock] = {}
        self.sample_rate = SAMPLE_RATE

    # ----------------- Whisper Model -----------------
    def _get_whisper_model(self, model_name: Optional[str] = None):
        """Load Whisper from the local models/ directory (int8 on CPU / Apple AMX)."""
        if not FASTER_WHISPER_AVAILABLE:
            return None
        cfg = config_store.get()
        target_model = model_name or getattr(cfg, "whisper_model", "large-v3-turbo") or "large-v3-turbo"

        with self._model_lock:
            if self.model is not None and self._loaded_model_name == target_model:
                return self.model

            models_dir = os.path.join(os.path.dirname(__file__), "models")
            local_path = os.path.join(models_dir, target_model)
            load_target = local_path if os.path.exists(os.path.join(local_path, "model.bin")) else target_model
            threads = max(4, (os.cpu_count() or 8) - 2)
            try:
                print(f"[AudioPipeline] Loading faster-whisper '{load_target}' (int8, {threads} threads)...")
                self.model = WhisperModel(load_target, device="cpu", compute_type="int8", cpu_threads=threads)
                self._loaded_model_name = target_model
            except Exception as e:
                print(f"[AudioPipeline] Could not load '{target_model}': {e}. Falling back to large-v3-turbo.")
                fallback = os.path.join(models_dir, "large-v3-turbo")
                self.model = WhisperModel(
                    fallback if os.path.exists(fallback) else "base",
                    device="cpu", compute_type="int8", cpu_threads=threads
                )
                self._loaded_model_name = "large-v3-turbo" if os.path.exists(fallback) else "base"
            print(f"[AudioPipeline] Whisper model '{self._loaded_model_name}' ready.")
            return self.model

    # ----------------- Paths -----------------
    def get_meeting_dir(self, meeting_id: str) -> str:
        """Returns the dedicated directory for this meeting session."""
        cfg = config_store.get()
        meeting_dir = os.path.join(cfg.audio_export_dir, meeting_id)
        os.makedirs(meeting_dir, exist_ok=True)
        return meeting_dir

    def get_session_audio_path(self, meeting_id: str) -> Optional[str]:
        cfg = config_store.get()
        folder_wav = os.path.join(cfg.audio_export_dir, meeting_id, "audio.wav")
        if os.path.exists(folder_wav) and os.path.getsize(folder_wav) > WAV_HEADER_BYTES:
            return folder_wav
        flat_wav = os.path.join(cfg.audio_export_dir, f"{meeting_id}.wav")
        return flat_wav if os.path.exists(flat_wav) else None

    def get_session_duration(self, meeting_id: str) -> float:
        path = self.get_session_audio_path(meeting_id)
        if not path:
            return 0.0
        try:
            with wave.open(path, "rb") as wf:
                return wf.getnframes() / float(wf.getframerate())
        except Exception:
            return 0.0

    def _lock_for(self, meeting_id: str) -> threading.Lock:
        if meeting_id not in self._file_locks:
            self._file_locks[meeting_id] = threading.Lock()
        return self._file_locks[meeting_id]

    # ----------------- Recording -----------------
    def append_pcm(self, meeting_id: str, pcm_bytes: bytes, channels: int = 2, sample_rate: int = SAMPLE_RATE) -> Dict[str, Any]:
        """
        Appends interleaved int16 PCM to the session's audio.wav and returns live levels.
        The session file is always stereo (L = mic, R = tab); mono input lands on the mic channel.
        """
        usable = len(pcm_bytes) - (len(pcm_bytes) % (2 * channels))
        if usable <= 0:
            return {"mic_level": 0.0, "tab_level": 0.0, "duration": 0.0}

        frames = np.frombuffer(pcm_bytes[:usable], dtype=np.int16).reshape(-1, channels)
        if channels == 1:
            stereo = np.zeros((frames.shape[0], 2), dtype=np.int16)
            stereo[:, CH_MIC] = frames[:, 0]
        else:
            stereo = frames[:, :2]

        levels = {
            "mic_level": self._level(stereo[:, CH_MIC]),
            "tab_level": self._level(stereo[:, CH_TAB]),
            "duration": round(stereo.shape[0] / float(sample_rate), 3),
        }

        filepath = os.path.join(self.get_meeting_dir(meeting_id), "audio.wav")
        with self._lock_for(meeting_id):
            self._append_frames(filepath, stereo, sample_rate)
        return levels

    @staticmethod
    def _level(samples: np.ndarray) -> float:
        if samples.size == 0:
            return 0.0
        rms = float(np.sqrt(np.mean((samples.astype(np.float32) / 32768.0) ** 2)))
        # Perceptual-ish scaling so normal speech sits around 0.4-0.8
        return round(min(1.0, math.sqrt(rms) * 2.2), 3)

    def _append_frames(self, filepath: str, stereo: np.ndarray, sample_rate: int):
        if not os.path.exists(filepath) or os.path.getsize(filepath) < WAV_HEADER_BYTES:
            with wave.open(filepath, "wb") as wf:
                wf.setnchannels(2)
                wf.setsampwidth(2)
                wf.setframerate(sample_rate)
                wf.writeframes(stereo.tobytes())
            return

        with wave.open(filepath, "rb") as wf:
            file_channels = wf.getnchannels()
        if file_channels == 1:
            # Legacy mono session: mix down so we keep appending to the same file
            mixed = stereo.astype(np.int32).mean(axis=1).astype(np.int16)
            payload = mixed.tobytes()
        else:
            payload = stereo.tobytes()

        with open(filepath, "r+b") as f:
            f.seek(0, os.SEEK_END)
            f.write(payload)
            new_size = f.tell()
            f.seek(4)
            f.write((new_size - 8).to_bytes(4, byteorder="little"))
            f.seek(40)
            f.write((new_size - WAV_HEADER_BYTES).to_bytes(4, byteorder="little"))

    # Back-compat for the legacy base64 WAV chunk protocol (mono mic chunks)
    def save_audio_chunk(self, audio_bytes: bytes, meeting_id: str) -> Dict[str, Any]:
        pcm, sr = self.decode_audio_bytes(audio_bytes)
        if len(pcm) == 0:
            return {"amplitude": 0.0, "duration": 0.0}
        int16 = (np.clip(pcm, -1.0, 1.0) * 32767.0).astype(np.int16)
        levels = self.append_pcm(meeting_id, int16.tobytes(), channels=1, sample_rate=sr)
        return {"amplitude": levels["mic_level"], "duration": levels["duration"]}

    def decode_audio_bytes(self, audio_bytes: bytes) -> Tuple[np.ndarray, int]:
        """Converts WAV (or raw 16-bit 16kHz mono PCM) bytes to a float32 mono array."""
        try:
            with wave.open(io.BytesIO(audio_bytes), 'rb') as wav_file:
                n_channels = wav_file.getnchannels()
                framerate = wav_file.getframerate()
                frames = wav_file.readframes(wav_file.getnframes())
                pcm = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                if n_channels > 1:
                    pcm = pcm.reshape(-1, n_channels).mean(axis=1)
                return pcm, framerate
        except Exception:
            usable = len(audio_bytes) - (len(audio_bytes) % 2)
            return np.frombuffer(audio_bytes[:usable], dtype=np.int16).astype(np.float32) / 32768.0, SAMPLE_RATE

    # ----------------- Transcription -----------------
    def condition_audio(self, pcm_data: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
        """Gentle 80 Hz high-pass to remove rumble/hum before ASR (when enabled in settings)."""
        if not config_store.get().noise_cleaning_enabled or len(pcm_data) < 200:
            return pcm_data
        try:
            sos = signal.butter(4, 80.0 / (0.5 * sample_rate), btype="highpass", output="sos")
            return signal.sosfilt(sos, pcm_data).astype(np.float32)
        except Exception:
            return pcm_data

    def _load_channels(self, wav_path: str) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], int]:
        """Returns (mic, tab, sample_rate). For a mono file, tab is None."""
        with wave.open(wav_path, "rb") as wf:
            sr = wf.getframerate()
            n_channels = wf.getnchannels()
            frames = wf.readframes(wf.getnframes())
        pcm = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        if n_channels == 1:
            return pcm, None, sr
        pcm = pcm.reshape(-1, n_channels)
        return pcm[:, CH_MIC].copy(), pcm[:, CH_TAB].copy(), sr

    @staticmethod
    def _envelope(x: np.ndarray, sr: int, hop_s: float = 0.02) -> np.ndarray:
        hop = max(1, int(sr * hop_s))
        n = len(x) // hop
        if n == 0:
            return np.zeros(1, dtype=np.float32)
        frames = x[: n * hop].reshape(n, hop)
        return np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)

    @staticmethod
    def _active_reference(env: np.ndarray) -> float:
        """Typical speech loudness of a channel (95th percentile), 0 if the channel is silent."""
        ref = float(np.percentile(env, 95)) if env.size else 0.0
        return ref if ref > 0.003 else 0.0

    def _is_hallucination(self, text: str) -> bool:
        t = text.strip().lower()
        if len(t) < 2:
            return True
        return any(re.match(p, t) for p in HALLUCINATION_PATTERNS)

    def transcribe_session_audio(
        self,
        meeting_id: str,
        model_name: Optional[str] = None,
        progress_cb: Optional[Callable[[float], None]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Batch-transcribes a finished session.
        The mic and tab channels are mixed for Whisper, then every word is attributed to
        "Me" or "Others" by comparing the normalized energy of each channel under that word.
        """
        wav_path = self.get_session_audio_path(meeting_id)
        if not wav_path:
            print(f"[AudioPipeline] No audio file found for meeting {meeting_id}")
            return []

        model = self._get_whisper_model(model_name)
        if model is None:
            raise RuntimeError("faster-whisper is not installed in the backend venv.")

        mic, tab, sr = self._load_channels(wav_path)
        duration = len(mic) / float(sr)

        mic_env = self._envelope(mic, sr)
        mic_ref = self._active_reference(mic_env)
        tab_env = self._envelope(tab, sr) if tab is not None else None
        tab_ref = self._active_reference(tab_env) if tab_env is not None else 0.0
        can_attribute = mic_ref > 0 and tab_ref > 0

        # Equalize both channels so a quiet mic doesn't vanish under loud meeting audio
        mix = np.zeros_like(mic)
        if mic_ref > 0:
            mix += mic * min(8.0, 0.25 / mic_ref)
        if tab is not None and tab_ref > 0:
            mix += tab * min(8.0, 0.25 / tab_ref)
        peak = float(np.max(np.abs(mix))) if mix.size else 0.0
        if peak > 0.99:
            mix = mix * (0.99 / peak)
        mix = self.condition_audio(mix.astype(np.float32), sr)

        cfg = config_store.get()
        lang = cfg.whisper_language if cfg.whisper_language and cfg.whisper_language != "auto" else None

        print(f"[AudioPipeline] Transcribing {wav_path} ({duration:.1f}s, attribution={'on' if can_attribute else 'off'}) "
              f"with {self._loaded_model_name}...")
        segments_gen, info = model.transcribe(
            mix,
            beam_size=5,
            language=lang,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 200},
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            compression_ratio_threshold=2.4,
        )
        print(f"[AudioPipeline] Language: {info.language} ({info.language_probability:.2f})")

        user_name, others_name = self._speaker_names(meeting_id)

        def speaker_for(start: float, end: float) -> str:
            if not can_attribute:
                return "UNKNOWN"
            a = int(start / 0.02)
            b = max(a + 1, int(math.ceil(end / 0.02)))
            m = float(np.mean(mic_env[a:b])) / mic_ref if a < len(mic_env) else 0.0
            t = float(np.mean(tab_env[a:b])) / tab_ref if a < len(tab_env) else 0.0
            return "ME" if m >= t else "REMOTE"

        # 1. Collect words with a raw speaker guess
        words: List[Dict[str, Any]] = []
        for seg in segments_gen:
            if progress_cb and duration > 0:
                progress_cb(min(1.0, seg.end / duration))
            if self._is_hallucination(seg.text):
                continue
            if getattr(seg, "no_speech_prob", 0) > 0.8 and getattr(seg, "avg_logprob", 0) < -1.0:
                continue
            seg_words = seg.words or []
            if not seg_words:
                seg_words = [type("W", (), {"word": seg.text, "start": seg.start, "end": seg.end})()]
            for w in seg_words:
                token = w.word
                if not token.strip():
                    continue
                words.append({
                    "word": token,
                    "start": float(w.start),
                    "end": float(w.end),
                    "spk": speaker_for(float(w.start), float(w.end)),
                    "seg_end": seg.end,
                })

        if not words:
            print("[AudioPipeline] No speech detected.")
            return []

        # 2. Smooth isolated flips (1-2 words sandwiched between the same other speaker)
        labels = [w["spk"] for w in words]
        i = 0
        while i < len(labels):
            j = i
            while j < len(labels) and labels[j] == labels[i]:
                j += 1
            run_len = j - i
            if run_len <= 2 and i > 0 and j < len(labels) and labels[i - 1] == labels[j]:
                for k in range(i, j):
                    labels[k] = labels[i - 1]
            i = j
        for w, lbl in zip(words, labels):
            w["spk"] = lbl

        # 3. Group into turns: break on speaker change, long pauses, or very long turns at punctuation
        turns: List[Dict[str, Any]] = []
        cur: Optional[Dict[str, Any]] = None
        for w in words:
            new_turn = (
                cur is None
                or w["spk"] != cur["spk"]
                or w["start"] - cur["end"] > 1.5
                or (cur["end"] - cur["start"] > 30 and cur["text"].rstrip().endswith((".", "?", "!")))
            )
            if new_turn:
                if cur:
                    turns.append(cur)
                cur = {"spk": w["spk"], "start": w["start"], "end": w["end"], "text": w["word"]}
            else:
                cur["end"] = w["end"]
                cur["text"] += w["word"]
        if cur:
            turns.append(cur)

        results = []
        for t in turns:
            text = re.sub(r"\s+", " ", t["text"]).strip()
            if not text or self._is_hallucination(text):
                continue
            if t["spk"] == "ME":
                name, is_user, label = user_name, 1, "ME"
            elif t["spk"] == "REMOTE":
                name, is_user, label = others_name, 0, "REMOTE"
            else:
                name, is_user, label = "Speaker", 0, "UNKNOWN"
            start = round(t["start"], 2)
            results.append({
                "meeting_id": meeting_id,
                "speaker_label": label,
                "speaker_name": name,
                "is_user": is_user,
                "text": text,
                "start_time": start,
                "end_time": round(t["end"], 2),
                "timestamp_badge": self.format_timestamp(start),
                "raw_confidence": 0.95,
            })

        if progress_cb:
            progress_cb(1.0)
        print(f"[AudioPipeline] Transcription complete: {len(results)} turns.")
        return results

    def _speaker_names(self, meeting_id: str) -> Tuple[str, str]:
        """Name for the user and for the remote side (a single known attendee gets their name)."""
        from database import get_db
        cfg = config_store.get()
        user_name = (cfg.user_name or "Me").strip()
        attendees: List[str] = []
        try:
            conn = get_db()
            row = conn.execute("SELECT attendees FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
            conn.close()
            if row and row["attendees"]:
                attendees = json.loads(row["attendees"])
        except Exception:
            pass
        others = [
            a for a in attendees
            if a and user_name.lower() not in a.lower() and "(me)" not in a.lower()
        ]
        return user_name, (others[0] if len(others) == 1 else "Others")

    @staticmethod
    def format_timestamp(seconds: float) -> str:
        s = int(math.floor(seconds))
        return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


audio_pipeline = AudioPipeline()

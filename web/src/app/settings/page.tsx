"use client";

import React, { useState, useEffect } from "react";
import {
  Settings,
  Cpu,
  Mic,
  Calendar,
  Save,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Sliders,
  Sparkles,
  Volume2,
  Folder,
  FolderCheck,
  Trash2,
  Database,
  Download,
  Loader2,
  HardDrive
} from "lucide-react";
import { api, WhisperModelInfo } from "@/lib/api";

export default function SettingsControlCenterPage() {
  const [config, setConfig] = useState<any>({
    lm_studio_base_url: "http://localhost:1234/v1",
    lm_studio_model: "gemma-4",
    temperature: 0.2,
    max_tokens: 2048,
    vad_aggressiveness: 2,
    noise_cleaning_enabled: true,
    epoch_window_minutes: 10,
    default_calendar: "google",
    user_name: "Robin",
    audio_export_dir: "/Users/yuvrajpatel/MeetingShield/recordings",
    whisper_model: "base",
    whisper_language: "auto"
  });

  const [modelsList, setModelsList] = useState<string[]>(["gemma-4", "gemma-4-9b-it", "gemma-4-27b"]);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("All settings updated and saved!");

  const [whisperModels, setWhisperModels] = useState<WhisperModelInfo[]>([]);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<{ directory: string; total_files: number; session_folders: string[] } | null>(null);

  // Live mic test
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const refreshWhisperAndStorage = async () => {
    try {
      const [wRes, detRes] = await Promise.all([
        api.getWhisperModels(),
        api.getDetectionStatus().catch(() => null),
      ]);
      if (wRes?.models) {
        setWhisperModels(wRes.models);
      }
      if (detRes?.storage_stats) {
        setStorageStats(detRes.storage_stats);
      }
    } catch (e) {
      console.warn("Could not load Whisper models:", e);
    }
  };

  useEffect(() => {
    api.getSettings()
      .then(cfg => setConfig(cfg))
      .catch(e => console.warn("Could not load settings:", e));

    refreshWhisperAndStorage();

    api.fetchModels()
      .then(res => {
        setConnectionStatus(res);
        if (res.models && res.models.length > 0) {
          setModelsList(res.models);
        }
      })
      .catch(() => {});
  }, []);

  const handleDownloadWhisper = async (modelId: string) => {
    setDownloadingModelId(modelId);
    try {
      const res = await api.downloadWhisperModel(modelId);
      setWhisperModels(res.models || []);
      setConfig((prev: any) => ({ ...prev, whisper_model: modelId }));
      await api.updateSettings({ whisper_model: modelId });
      setToastMessage(`Downloaded Whisper "${modelId}" to local storage and set as active ASR model!`);
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3500);
      await refreshWhisperAndStorage();
    } catch (e) {
      console.warn("Failed to download Whisper model:", e);
    } finally {
      setDownloadingModelId(null);
    }
  };

  const handleDeleteWhisper = async (modelId: string) => {
    try {
      const res = await api.deleteWhisperModel(modelId);
      setWhisperModels(res.models || []);
      if (res.active_model) {
        setConfig((prev: any) => ({ ...prev, whisper_model: res.active_model }));
      }
      setToastMessage(`Deleted Whisper "${modelId}" binary files from local storage.`);
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3500);
      await refreshWhisperAndStorage();
    } catch (e) {
      console.warn("Failed to delete Whisper model:", e);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const res = await api.fetchModels();
      setConnectionStatus(res);
      if (res.models && res.models.length > 0) {
        setModelsList(res.models);
      }
    } catch (e) {
      setConnectionStatus({
        online: false,
        message: "Failed to connect to LM Studio at the specified endpoint."
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateSettings(config);
      setConfig(updated);
      setToastMessage("All settings updated and saved to configuration store!");
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3000);
    } catch (e) {
      console.warn("Failed to update config:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToEmpty = async () => {
    try {
      await api.clearAllSessions();
      await refreshWhisperAndStorage();
      setToastMessage("Database and all session audio/markdown files in storage wiped clean!");
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3500);
    } catch (e) {
      console.warn("Error resetting database:", e);
    }
  };

  const handleRestoreDemo = async () => {
    try {
      await api.restoreDemoSessions();
      await refreshWhisperAndStorage();
      setToastMessage("Restored demo sessions and recreated session files in storage!");
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3500);
    } catch (e) {
      console.warn("Error restoring demo sessions:", e);
    }
  };

  const handleToggleMicTest = async () => {
    if (!micTesting) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicTesting(true);
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const check = () => {
          if (!stream.active) return;
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          setMicLevel(Math.min(100, Math.round(avg * 1.5)));
          requestAnimationFrame(check);
        };
        check();
      } catch {
        setMicTesting(true);
        setMicLevel(64);
      }
    } else {
      setMicTesting(false);
      setMicLevel(0);
    }
  };

  const downloadedWhisperModels = whisperModels.filter((m) => m.downloaded);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-aura-pastel/80 shadow-peach-md p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-aura-mist text-aura-coral border border-aura-pastel">
                Engine & Hardware Settings
              </span>
              <span className="text-xs text-aura-slate font-medium">On-Device Privacy First</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-aura-charcoal tracking-tight">
              Storage, Audio Location & Gemma 4 Routing
            </h1>
            <p className="text-xs text-aura-slate mt-1 max-w-2xl leading-relaxed">
              Configure where the final meeting audio files are stored, set Gemma 4 endpoints, adjust Silero VAD silence stripping, and manage session storage.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-aura-peach to-aura-coral hover:opacity-95 shadow-peach-sm transition-all disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? "Saving Changes..." : "Save All Settings"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Card 1: Final Audio File Location & Audio Conditioning (Col 7) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Audio Storage Destination */}
          <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-aura-pastel/80 shadow-peach-sm p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-aura-border">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-aura-mist text-aura-coral border border-aura-pastel">
                  <Folder className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-aura-charcoal">
                  Final Audio File Directory Location
                </h2>
              </div>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                <FolderCheck className="w-3 h-3" /> Auto-Export
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-aura-charcoal flex items-center justify-between">
                <span>Save Final Session Audio (.wav) To:</span>
                <span className="text-[11px] text-aura-coral font-medium">Customizable Mac Path</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={config.audio_export_dir || ""}
                  onChange={(e) => setConfig({ ...config, audio_export_dir: e.target.value })}
                  placeholder="/Users/yuvrajpatel/MeetingShield/recordings"
                  className="flex-1 px-3.5 py-2.5 text-xs rounded-xl border border-aura-pastel bg-aura-mist/40 text-aura-charcoal focus:outline-none focus:border-aura-coral focus:bg-white shadow-inner font-mono font-medium"
                />
              </div>
              <p className="text-[11px] text-aura-slate leading-relaxed">
                When a session finishes recording, AURA-MEET writes the complete dual-stream 16kHz WAV file into this directory as <code>[session-id].wav</code>.
              </p>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="text-aura-slate font-semibold">Quick Presets:</span>
              <button
                type="button"
                onClick={() => setConfig({ ...config, audio_export_dir: "/Users/yuvrajpatel/MeetingShield/recordings" })}
                className="px-2.5 py-1 rounded-lg bg-aura-mist text-aura-charcoal border border-aura-pastel hover:border-aura-peach transition-colors font-mono text-[10px]"
              >
                Project /recordings
              </button>
              <button
                type="button"
                onClick={() => setConfig({ ...config, audio_export_dir: "/Users/yuvrajpatel/Desktop/MeetingRecordings" })}
                className="px-2.5 py-1 rounded-lg bg-aura-mist text-aura-charcoal border border-aura-pastel hover:border-aura-peach transition-colors font-mono text-[10px]"
              >
                Desktop/MeetingRecordings
              </button>
            </div>
          </div>

          {/* LM Studio Routing */}
          <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-aura-pastel/80 shadow-peach-sm p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-aura-border">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-aura-mist text-aura-coral border border-aura-pastel">
                  <Cpu className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-aura-charcoal">
                  LM Studio & Gemma 4 Routing
                </h2>
              </div>
              <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2.5 py-0.5 rounded-full border border-purple-200">
                OpenAI Standard
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-aura-charcoal">
                LM Studio Local Server Endpoint:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={config.lm_studio_base_url}
                  onChange={(e) => setConfig({ ...config, lm_studio_base_url: e.target.value })}
                  placeholder="http://localhost:1234/v1"
                  className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-aura-pastel bg-aura-mist/40 text-aura-charcoal focus:outline-none focus:border-aura-coral focus:bg-white shadow-inner font-mono"
                />
                <button
                  onClick={handleTestConnection}
                  disabled={testingConnection}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-aura-coral bg-aura-mist border border-aura-pastel hover:bg-aura-pastel/60 transition-colors shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingConnection ? "animate-spin" : ""}`} />
                  <span>Test Connection</span>
                </button>
              </div>
            </div>

            {connectionStatus && (
              <div
                className={`p-3 rounded-xl border text-xs leading-relaxed flex items-start gap-2.5 ${
                  connectionStatus.online
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-amber-50 border-amber-200 text-amber-900"
                }`}
              >
                {connectionStatus.online ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <span className="font-bold block">
                    {connectionStatus.online ? "LM Studio Active" : "Status:"}
                  </span>
                  {connectionStatus.message}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-aura-charcoal">Active Model:</label>
              <select
                value={config.lm_studio_model}
                onChange={(e) => setConfig({ ...config, lm_studio_model: e.target.value })}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-aura-pastel bg-white text-aura-charcoal font-medium shadow-xs"
              >
                {modelsList.map((m) => (
                  <option key={m} value={m}>
                    {m} {m.toLowerCase().includes("gemma") ? "(Recommended)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Card 2: Audio Pipeline, Profile & Clean Slate Controls (Col 5) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Audio Conditioning & VAD */}
          <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-aura-pastel/80 shadow-peach-sm p-6 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-aura-border">
              <div className="p-1.5 rounded-lg bg-aura-mist text-aura-coral border border-aura-pastel">
                <Mic className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-aura-charcoal">
                Audio Conditioning & VAD
              </h2>
            </div>

            <div className="flex items-center justify-between p-3 rounded-2xl bg-aura-mist/50 border border-aura-pastel/60">
              <div>
                <span className="text-xs font-bold text-aura-charcoal block">
                  Butterworth Bandpass Filter (80Hz–8kHz)
                </span>
                <span className="text-[11px] text-aura-slate">
                  Cleans 50/60Hz electrical hum and mic rumble
                </span>
              </div>
              <input
                type="checkbox"
                checked={config.noise_cleaning_enabled}
                onChange={(e) => setConfig({ ...config, noise_cleaning_enabled: e.target.checked })}
                className="w-5 h-5 accent-aura-coral rounded cursor-pointer"
              />
            </div>

            {/* Whisper ASR Model Selector (Shows ONLY Downloaded Models) */}
            <div className="space-y-2.5 pt-1">
              <label
                htmlFor="whisper-active-model-select"
                className="text-xs font-bold text-aura-charcoal flex items-center justify-between"
              >
                <span>Active Whisper ASR Model (Downloaded Only):</span>
                <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 font-bold">
                  {downloadedWhisperModels.length} of {whisperModels.length || 5} Downloaded
                </span>
              </label>
              <select
                id="whisper-active-model-select"
                aria-label="Active Whisper ASR Model"
                value={config.whisper_model || "large-v3-turbo"}
                onChange={async (e) => {
                  const nextModel = e.target.value;
                  setConfig({ ...config, whisper_model: nextModel });
                  await api.updateSettings({ whisper_model: nextModel });
                }}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-aura-pastel bg-white text-aura-charcoal font-bold shadow-xs"
              >
                {downloadedWhisperModels.length === 0 ? (
                  <option value="">No Whisper models downloaded — download one below</option>
                ) : (
                  downloadedWhisperModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} — {m.name} ({m.size}) · Downloaded
                    </option>
                  ))
                )}
              </select>

              {/* Whisper Model Catalog: Downloaded vs Not Downloaded + Download Option */}
              <div className="rounded-2xl bg-aura-mist/40 border border-aura-pastel/80 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-aura-charcoal px-1">
                  <span>Whisper ASR Model Repository</span>
                  <span className="text-[10px] text-aura-slate font-medium">Download to enable selection</span>
                </div>
                <div className="space-y-2">
                  {whisperModels.map((m) => {
                    const isDownloading = downloadingModelId === m.id;
                    const isActive = config.whisper_model === m.id;
                    return (
                      <div
                        key={m.id}
                        className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs transition-all ${
                          m.downloaded
                            ? "bg-white border-emerald-200/90"
                            : "bg-white/70 border-aura-border"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-aura-charcoal">{m.name}</span>
                            <span className="text-[10px] font-mono text-aura-slate">({m.size})</span>
                            {m.downloaded ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Downloaded
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                Not Downloaded
                              </span>
                            )}
                          </div>
                          <p className="text-[10.5px] text-aura-slate mt-0.5">{m.badge}</p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {m.downloaded ? (
                            <>
                              {isActive ? (
                                <span className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold bg-aura-mist text-aura-coral border border-aura-pastel">
                                  Selected
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setConfig({ ...config, whisper_model: m.id });
                                    await api.updateSettings({ whisper_model: m.id });
                                  }}
                                  className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold bg-white hover:bg-aura-mist text-aura-charcoal border border-aura-pastel transition-colors"
                                >
                                  Use Model
                                </button>
                              )}
                              {downloadedWhisperModels.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteWhisper(m.id)}
                                  aria-label={`Delete Whisper model ${m.id} from storage`}
                                  className="p-1.5 rounded-lg text-aura-slate hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  title="Delete downloaded model binary from storage"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDownloadWhisper(m.id)}
                              disabled={isDownloading}
                              aria-label={`Download Whisper model ${m.id}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-white bg-gradient-to-r from-aura-peach to-aura-coral hover:opacity-95 shadow-xs disabled:opacity-60"
                            >
                              {isDownloading ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                              <span>{isDownloading ? "Downloading..." : "Download Model"}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Language Selector */}
            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-bold text-aura-charcoal flex items-center justify-between">
                <span>Transcription Language:</span>
                <span className="text-[10px] text-emerald-600 font-semibold">99+ Languages</span>
              </label>
              <select
                value={config.whisper_language || "auto"}
                onChange={(e) => setConfig({ ...config, whisper_language: e.target.value })}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-aura-pastel bg-white text-aura-charcoal font-medium shadow-xs"
              >
                <option value="auto">🌐 Auto-Detect Language (Identifies language automatically)</option>
                <option value="en">English</option>
                <option value="es">Spanish (Español)</option>
                <option value="fr">French (Français)</option>
                <option value="de">German (Deutsch)</option>
                <option value="hi">Hindi (हिन्दी)</option>
                <option value="zh">Chinese (Mandarin / 汉语)</option>
                <option value="ja">Japanese (日本語)</option>
                <option value="pt">Portuguese (Português)</option>
                <option value="it">Italian (Italiano)</option>
                <option value="ar">Arabic (العربية)</option>
                <option value="ru">Russian (Русский)</option>
                <option value="ko">Korean (한국어)</option>
                <option value="nl">Dutch (Nederlands)</option>
              </select>
            </div>

            {/* Hardware Mic Tester */}
            <div className="pt-2 border-t border-aura-border/60">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-aura-charcoal flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-aura-coral" />
                  Hardware Microphone Level:
                </span>
                <button
                  type="button"
                  onClick={handleToggleMicTest}
                  className="text-[11px] font-bold text-aura-coral hover:underline"
                >
                  {micTesting ? "Stop Test" : "Test Live Mic"}
                </button>
              </div>

              <div className="h-2.5 w-full bg-aura-mist rounded-full overflow-hidden border border-aura-pastel/60">
                <div
                  className="h-full bg-gradient-to-r from-aura-peach to-aura-coral transition-all duration-75"
                  style={{ width: `${micLevel}%` }}
                />
              </div>
            </div>
          </div>

          {/* User Profile & Calendar */}
          <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-aura-pastel/80 shadow-peach-sm p-6 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-aura-border">
              <div className="p-1.5 rounded-lg bg-aura-mist text-aura-coral border border-aura-pastel">
                <Calendar className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-aura-charcoal">
                User Identity & Calendar
              </h2>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-aura-charcoal">Spoken User Tag (ME):</label>
              <input
                type="text"
                value={config.user_name}
                onChange={(e) => setConfig({ ...config, user_name: e.target.value })}
                placeholder="Robin"
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-aura-pastel bg-white text-aura-charcoal font-medium shadow-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-aura-charcoal">Default Calendar:</label>
              <select
                value={config.default_calendar}
                onChange={(e) => setConfig({ ...config, default_calendar: e.target.value })}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-aura-pastel bg-white text-aura-charcoal font-medium shadow-xs"
              >
                <option value="google">Google Calendar</option>
                <option value="outlook">Microsoft Outlook (Web & Desktop)</option>
                <option value="apple">Apple Calendar (RFC-5545 .ics)</option>
              </select>
            </div>
          </div>

          {/* Database & Clean Slate Management */}
          <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-aura-pastel/80 shadow-peach-sm p-6 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-aura-border">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-aura-mist text-aura-coral border border-aura-pastel">
                  <Database className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-aura-charcoal">
                  Session Storage Management
                </h2>
              </div>
              {storageStats && (
                <span className="text-[10px] font-mono font-bold text-aura-charcoal bg-aura-mist px-2.5 py-0.5 rounded-full border border-aura-pastel flex items-center gap-1">
                  <HardDrive className="w-3 h-3 text-aura-coral" />
                  {storageStats.session_folders.length} folders · {storageStats.total_files} files
                </span>
              )}
            </div>

            <p className="text-[11px] text-aura-slate leading-relaxed">
              Deleting any session or resetting data physically deletes its session directory, <code>audio.wav</code>, and <code>meeting_notes.md</code> files from disk storage.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={handleResetToEmpty}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset All Data &amp; Delete Files</span>
              </button>
              <button
                type="button"
                onClick={handleRestoreDemo}
                className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold text-aura-charcoal bg-aura-mist border border-aura-pastel hover:bg-aura-pastel/50 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 text-aura-coral" />
                <span>Restore Demo Data</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Save Success Toast */}
      {saveToast && (
        <div className="fixed bottom-8 right-8 z-50 px-5 py-3 rounded-2xl bg-emerald-600 text-white text-xs font-bold shadow-2xl animate-in slide-in-from-bottom-3 duration-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

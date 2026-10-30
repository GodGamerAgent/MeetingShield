export const API_BASE = "http://localhost:8000";
export const WS_BASE = "ws://localhost:8000";

export interface Meeting {
  id: string;
  title: string;
  agenda: string;
  attendees: string[];
  created_at: string;
  ended_at?: string;
  status: string;
  duration_sec: number;
  drift_score: number;
  has_audio?: boolean;
  raw_notes?: string;
  enhanced_notes?: string;
  folder_path?: string;
  has_markdown?: boolean;
  platform?: string;
  meeting_url?: string;
  processing_error?: string;
}

export interface ActiveRecording {
  meeting_id: string;
  seconds: number;
  mic_level?: number;
  tab_level?: number;
}

export interface TranscriptSegment {
  id: string;
  meeting_id: string;
  speaker_label: string;
  speaker_name: string;
  is_user: number;
  text: string;
  start_time: number;
  end_time: number;
  timestamp_badge: string;
  raw_confidence?: number;
  created_at?: string;
}

export interface DriftData {
  drift_score: number;
  is_drifting: boolean;
  current_topic: string;
  nudge_message: string;
}

export interface DominanceSpeaker {
  speaker_name: string;
  is_user: boolean;
  talk_time_sec: number;
  talk_time_formatted: string;
  percentage: number;
  wpm: number;
  turns: number;
}

export interface ProcessingStatus {
  meeting_id: string;
  status: "idle" | "processing" | "completed" | "error";
  stage: string;
  step: number;
  total_steps: number;
  progress: number;
  message: string;
  error?: string | null;
  export_path?: string;
}

export interface WhisperModelInfo {
  id: string;
  name: string;
  badge: string;
  size: string;
  status: string;
  ready: boolean;
  recommended: boolean;
}

export interface DominanceData {
  total_duration_sec: number;
  speakers: DominanceSpeaker[];
  user_talk_time_pct: number;
  most_dominant_speaker: string;
}

export interface TodoItem {
  id: string;
  meeting_id: string;
  task: string;
  owner: string;
  deadline?: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  timestamp_ref: string;
  completed: number;
}

export interface MemoryCard {
  id: string;
  meeting_id: string;
  fact: string;
  context?: string;
  person?: string;
  timestamp_ref: string;
  category: string;
}

export interface CoachingCard {
  id: string;
  meeting_id: string;
  timestamp_ref: string;
  what_you_said: string;
  tone_detected: string;
  impact_analysis: string;
  better_response: string;
  coaching_principle: string;
  clarity_score: number;
  empathy_score: number;
  meeting_title?: string;
}

export interface IndividualProfile {
  id: string;
  name: string;
  role: string;
  email: string;
  avatar_url: string;
  first_met: string;
  last_met: string;
  total_meetings: number;
  talk_time_sec_total: number;
  reliability_score: number;
  communication_cheat_sheet: string;
  notes: string;
  interactions?: any[];
  spoken_segments?: any[];
}

export interface AudioInfo {
  has_audio: boolean;
  file_path: string;
  export_dir: string;
  folder_path?: string;
  markdown_path?: string;
  has_markdown?: boolean;
  size_bytes: number;
  size_formatted: string;
}

export interface MeetingNotes {
  meeting_id: string;
  raw_notes: string;
  enhanced_notes: string;
  markdown_path?: string;
  folder_path?: string;
  has_markdown?: boolean;
}

export interface FollowupDraft {
  meeting_id: string;
  format: "email" | "slack";
  subject: string;
  body: string;
  mailto_link?: string;
}

export interface GlobalSearchResult {
  query: string;
  meetings: any[];
  transcripts: any[];
  todos: any[];
  people: any[];
  total_results: number;
}

export const api = {
  async getStatus() {
    const res = await fetch(`${API_BASE}/api/status`, { cache: "no-store" });
    return res.json();
  },
  async getMeetings(): Promise<Meeting[]> {
    const res = await fetch(`${API_BASE}/api/meetings`, { cache: "no-store" });
    return res.json();
  },
  async getMeeting(id: string): Promise<Meeting> {
    const res = await fetch(`${API_BASE}/api/meetings/${id}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Meeting not found");
    return res.json();
  },
  async createMeeting(data: { title: string; agenda: string; attendees: string[] }): Promise<Meeting> {
    const res = await fetch(`${API_BASE}/api/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return res.json();
  },
  async updateMeeting(id: string, data: { title?: string; agenda?: string; attendees?: string[]; status?: string }): Promise<Meeting> {
    const res = await fetch(`${API_BASE}/api/meetings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return res.json();
  },
  async deleteMeeting(id: string) {
    const res = await fetch(`${API_BASE}/api/meetings/${id}`, { method: "DELETE" });
    return res.json();
  },
  async getAudioInfo(id: string): Promise<AudioInfo> {
    const res = await fetch(`${API_BASE}/api/meetings/${id}/audio-info`, { cache: "no-store" });
    return res.json();
  },
  getAudioDownloadUrl(id: string): string {
    return `${API_BASE}/api/meetings/${id}/audio`;
  },
  async getTranscript(meetingId: string): Promise<TranscriptSegment[]> {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/transcript`, { cache: "no-store" });
    return res.json();
  },
  async reassignSpeaker(meetingId: string, segId: string, speakerName: string, scope: "one" | "all" = "one") {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/transcript/${segId}/speaker?speaker_name=${encodeURIComponent(speakerName)}&scope=${scope}`, {
      method: "PUT"
    });
    if (!res.ok) throw new Error("Could not rename speaker");
    return res.json();
  },
  async getActiveRecordings(): Promise<ActiveRecording[]> {
    const res = await fetch(`${API_BASE}/api/recording/active`, { cache: "no-store" });
    return res.json();
  },
  async stopMeeting(meetingId: string) {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/stop`, { method: "POST" });
    return res.json();
  },
  async getDrift(meetingId: string): Promise<DriftData> {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/drift`, { cache: "no-store" });
    return res.json();
  },
  async getDominance(meetingId: string): Promise<DominanceData> {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/dominance`, { cache: "no-store" });
    return res.json();
  },
  async getAnalysis(meetingId: string) {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/analysis`, { cache: "no-store" });
    return res.json();
  },
  async generateAnalysis(meetingId: string) {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/generate-analysis`, { method: "POST" });
    return res.json();
  },
  async askChat(meetingId: string, query: string, thinking: boolean = false) {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, thinking })
    });
    return res.json();
  },
  async processMeeting(meetingId: string, modelName?: string): Promise<{ status: string; meeting_id: string; message: string }> {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modelName ? { model_name: modelName } : {})
    });
    return res.json();
  },
  async getProcessingStatus(meetingId: string): Promise<ProcessingStatus> {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/processing-status`, { cache: "no-store" });
    return res.json();
  },
  async getWhisperModels(): Promise<{ models: WhisperModelInfo[]; active_model: string }> {
    const res = await fetch(`${API_BASE}/api/models/whisper`, { cache: "no-store" });
    return res.json();
  },
  async toggleTodo(todoId: string) {
    const res = await fetch(`${API_BASE}/api/todos/${todoId}/toggle`, { method: "POST" });
    return res.json();
  },
  async getIndividuals(): Promise<IndividualProfile[]> {
    const res = await fetch(`${API_BASE}/api/individuals`, { cache: "no-store" });
    return res.json();
  },
  async getIndividual(id: string): Promise<IndividualProfile> {
    const res = await fetch(`${API_BASE}/api/individuals/${id}`, { cache: "no-store" });
    return res.json();
  },
  async updateIndividualNotes(id: string, notes: string) {
    const res = await fetch(`${API_BASE}/api/individuals/${id}/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes })
    });
    return res.json();
  },
  async getCoachData() {
    const res = await fetch(`${API_BASE}/api/coach`, { cache: "no-store" });
    return res.json();
  },
  async exportCalendar(data: { title: string; description?: string; deadline?: string; attendees?: string[] }) {
    const res = await fetch(`${API_BASE}/api/calendar/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return res.json();
  },
  async getSettings() {
    const res = await fetch(`${API_BASE}/api/settings`, { cache: "no-store" });
    return res.json();
  },
  async updateSettings(data: any) {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return res.json();
  },
  async fetchModels() {
    const res = await fetch(`${API_BASE}/api/settings/models`, { cache: "no-store" });
    return res.json();
  },
  async clearAllSessions() {
    const res = await fetch(`${API_BASE}/api/meetings/clear-all`, { method: "POST" });
    return res.json();
  },
  async getMeetingNotes(meetingId: string): Promise<MeetingNotes> {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/notes`, { cache: "no-store" });
    return res.json();
  },
  async saveRawNotes(meetingId: string, rawNotes: string) {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_notes: rawNotes })
    });
    return res.json();
  },
  async enhanceNotes(meetingId: string, rawNotes: string): Promise<MeetingNotes & { status?: string }> {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/enhance-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_notes: rawNotes })
    });
    return res.json();
  },
  async getMeetingMarkdown(meetingId: string) {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/markdown`, { cache: "no-store" });
    return res.json();
  },
  getMarkdownDownloadUrl(meetingId: string): string {
    return `${API_BASE}/api/meetings/${meetingId}/download-markdown`;
  },
  async getFollowupDraft(meetingId: string, format: "email" | "slack" = "email"): Promise<FollowupDraft> {
    const res = await fetch(`${API_BASE}/api/meetings/${meetingId}/followup?format=${format}`, { cache: "no-store" });
    return res.json();
  },
  async globalSearch(query: string): Promise<GlobalSearchResult> {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    return res.json();
  }
};

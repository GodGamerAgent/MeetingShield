import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildExtensionZipBuffer } from "./extension-packager";
import {
  computeDominanceRatio,
  computeCoachMetrics,
  generateCalendarLinks,
  generateMeetingMarkdown,
  enhanceNotesWithTranscript,
  answerMeetingChat,
  performGlobalSearch,
  getStore,
  restoreDemoStore,
  getIndividualDossierWithSegments,
  draftFollowupMessage,
  processMeetingSession,
  simulateOrDetectCall,
  getWhisperModelsState,
  downloadWhisperModelInStore,
  deleteWhisperModelInStore,
  deleteMeetingFromStore,
  revealMeetingInFileManager,
} from "./aura-store";

test("computeDominanceRatio calculates speaker talk shares and WPM accurately", () => {
  restoreDemoStore();
  const store = getStore();
  const segments = store.transcripts["demo-meeting-01"];
  const dom = computeDominanceRatio(segments);

  assert.equal(dom.speakers.length, 4);
  assert.ok(dom.total_duration_sec > 200);
  assert.ok(dom.user_talk_time_pct > 20 && dom.user_talk_time_pct < 50);
  const sumPct = dom.speakers.reduce((a, b) => a + b.percentage, 0);
  assert.ok(Math.abs(sumPct - 100) <= 0.5);
});

test("computeCoachMetrics computes average clarity, empathy, and talk minutes", () => {
  restoreDemoStore();
  const store = getStore();
  const userSegments = store.transcripts["demo-meeting-01"].filter((s) => s.is_user === 1);
  const metrics = computeCoachMetrics(store.coaching, userSegments);

  assert.equal(metrics.clarity_score, 57);
  assert.equal(metrics.empathy_ratio, 54);
  assert.ok(metrics.talk_minutes > 1);
});

test("generateCalendarLinks builds valid Google, Outlook, and RFC-5545 ICS payload", () => {
  const res = generateCalendarLinks({
    title: "Review Terraform manifest",
    deadline: "Wednesday, Nov 4 - 10:00 AM",
    description: "Owner: Robin",
  });

  assert.ok(res.google_calendar_url.includes("calendar.google.com/calendar/render"));
  assert.ok(res.outlook_web_url.includes("outlook.office.com"));
  assert.ok(res.ics_content.includes("BEGIN:VCALENDAR"));
  assert.ok(res.ics_content.includes("SUMMARY:Review Terraform manifest"));
  assert.ok(res.ics_content.includes("END:VCALENDAR"));
});

test("enhanceNotesWithTranscript correlates raw bullets with transcript timestamps", () => {
  restoreDemoStore();
  const store = getStore();
  const segs = store.transcripts["demo-meeting-01"];
  const enhanced = enhanceNotesWithTranscript(
    "Q4 Product Architecture & Launch Sync",
    "• gRPC latency benchmark in staging\n• Reserved Kubernetes nodes savings",
    segs
  );

  assert.ok(enhanced.includes("[00:00:42]"));
  assert.ok(enhanced.includes("Priya Sharma"));
  assert.ok(enhanced.includes("[00:02:21]"));
});

test("performGlobalSearch finds matching meetings, transcripts, todos, and people", () => {
  restoreDemoStore();
  const res = performGlobalSearch("Prometheus");
  assert.ok(res.transcripts.length >= 1);
  assert.ok(res.todos.length >= 1);
  assert.ok(res.total_results >= 2);
});

test("getIndividualDossierWithSegments attaches spoken quotes across meetings", () => {
  restoreDemoStore();
  const dossier = getIndividualDossierWithSegments("ind-priya");
  assert.ok(dossier);
  assert.equal(dossier?.name, "Priya Sharma");
  assert.ok((dossier?.spoken_segments?.length || 0) >= 3);
});

test("answerMeetingChat returns grounded response with timestamp citations", () => {
  restoreDemoStore();
  const store = getStore();
  const meeting = store.meetings[0];
  const analysis = store.analyses[meeting.id];
  const todos = store.todos.filter((t) => t.meeting_id === meeting.id);
  const memories = store.memories.filter((m) => m.meeting_id === meeting.id);
  const segments = store.transcripts[meeting.id];

  const reply = answerMeetingChat(
    "What were the cloud budget savings?",
    true,
    meeting,
    analysis,
    todos,
    memories,
    segments
  );

  assert.ok(reply.response.includes("42%"));
  assert.ok(reply.citations.includes("00:02:21"));
  assert.ok(reply.thought.length > 10);
});

test("generateMeetingMarkdown and draftFollowupMessage format complete Obsidian + GFM outputs", () => {
  restoreDemoStore();
  const store = getStore();
  const meeting = store.meetings[0];
  const analysis = store.analyses[meeting.id];
  const todos = store.todos.filter((t) => t.meeting_id === meeting.id);
  const memories = store.memories.filter((m) => m.meeting_id === meeting.id);
  const coaching = store.coaching.filter((c) => c.meeting_id === meeting.id);
  const segments = store.transcripts[meeting.id];

  const md = generateMeetingMarkdown(meeting, analysis, todos, memories, coaching, segments);
  // Check Obsidian YAML frontmatter & formats
  assert.ok(md.startsWith("---\ntitle:"));
  assert.ok(md.includes("> [!SUMMARY] Executive Summary & Outcomes"));
  assert.ok(md.includes("> [!IMPORTANT] Approved Architecture & Strategic Decisions"));
  assert.ok(md.includes("> [!WARNING] Rejected Options & Explicit Trade-offs"));
  assert.ok(md.includes("> [!TIP]"));
  assert.ok(md.includes("[[Sarah Chen]]"));
  assert.ok(md.includes("#aura-meet"));
  assert.ok(md.includes("=="));
  // Check GitHub (GFM) formats
  assert.ok(md.includes("# 📋 Meeting Notes: Q4 Product Architecture & Launch Sync"));
  assert.ok(md.includes("| Speaker (Obsidian Link) | Role | Talk Share |"));
  assert.ok(md.includes("- [x]"));
  assert.ok(md.includes("```json"));
  assert.ok(md.includes("## 📜 Full Verbatim Transcript"));

  const emailDraft = draftFollowupMessage(meeting, analysis, todos, "Robin", "email");
  assert.equal(emailDraft.format, "email");
  assert.ok(emailDraft.mailto_link?.startsWith("mailto:?"));

  const slackDraft = draftFollowupMessage(meeting, analysis, todos, "Robin", "slack");
  assert.equal(slackDraft.format, "slack");
  assert.ok(slackDraft.body.includes(":memo: *Meeting Recap:"));
});

test("revealMeetingInFileManager returns OS-specific Finder, Explorer, and Thunar commands", () => {
  restoreDemoStore();
  const macReveal = revealMeetingInFileManager("demo-meeting-01", "mac");
  assert.equal(macReveal.file_manager_name, "Finder");
  assert.equal(macReveal.button_label, "Open in Finder");
  assert.ok(macReveal.command.includes("open -R"));

  const winReveal = revealMeetingInFileManager("demo-meeting-01", "win");
  assert.equal(winReveal.file_manager_name, "File Explorer");
  assert.equal(winReveal.button_label, "Open in Explorer");
  assert.ok(winReveal.command.includes("explorer.exe /select,"));

  const linuxReveal = revealMeetingInFileManager("demo-meeting-01", "linux");
  assert.equal(linuxReveal.file_manager_name, "Thunar");
  assert.equal(linuxReveal.button_label, "Open in Thunar");
  assert.ok(linuxReveal.command.includes("thunar"));
});

test("processMeetingSession updates Behavioral Coach and Individual Dossiers on every processed session", () => {
  restoreDemoStore();
  const store = getStore();
  const initialCoachCount = store.coaching.length;
  const initialPeopleCount = store.individuals.length;

  const detected = simulateOrDetectCall({
    platform: "meet",
    title: "Zero-Downtime Canary Architecture Sync",
    attendees: ["Robin (ME)", "Elena Rostova (Lead Security Architect)", "David Kim (Staff Backend Engineer)"],
    auto_start_recording: true,
  });

  assert.ok(detected.meeting);
  const newMeetingId = detected.meeting!.id;

  const result = processMeetingSession(newMeetingId, "large-v3-turbo");
  assert.equal(result.status, "completed");
  assert.ok(store.coaching.length > initialCoachCount);
  assert.ok(store.individuals.length >= initialPeopleCount + 2);

  const elena = store.individuals.find((p) => p.name === "Elena Rostova");
  assert.ok(elena);
  assert.ok((elena?.interactions?.length || 0) >= 1);
  assert.ok(elena?.interactions?.[0].promises_by_them.includes("canary"));

  const elenaDossier = getIndividualDossierWithSegments(elena!.id);
  assert.ok((elenaDossier?.spoken_segments?.length || 0) >= 1);
});

test("Whisper model state tracks downloaded vs not-downloaded models and supports downloading/deleting", () => {
  restoreDemoStore();
  const initial = getWhisperModelsState();
  assert.equal(initial.models.length, 5);
  const smallBefore = initial.models.find((m) => m.id === "small");
  assert.equal(smallBefore?.downloaded, false);
  assert.equal(smallBefore?.status, "Not Downloaded");

  const afterDl = downloadWhisperModelInStore("small");
  const smallAfter = afterDl.models.find((m) => m.id === "small");
  assert.equal(smallAfter?.downloaded, true);
  assert.ok(smallAfter?.local_path && fs.existsSync(smallAfter.local_path));

  const afterDel = deleteWhisperModelInStore("small");
  const smallDel = afterDel.models.find((m) => m.id === "small");
  assert.equal(smallDel?.downloaded, false);
});

test("deleteMeetingFromStore removes session files from disk storage", () => {
  restoreDemoStore();
  const detected = simulateOrDetectCall({ platform: "zoom", auto_start_recording: true });
  const meetingId = detected.meeting!.id;
  processMeetingSession(meetingId);

  const folderPath = detected.meeting!.folder_path!;
  assert.ok(fs.existsSync(folderPath));

  const delRes = deleteMeetingFromStore(meetingId);
  assert.equal(delRes.deleted, true);
  assert.equal(delRes.files_deleted, true);
  assert.equal(fs.existsSync(folderPath), false);
});

test("buildExtensionZipBuffer packages Chrome extension files into a valid ZIP archive", () => {
  const zip = buildExtensionZipBuffer();
  assert.ok(zip.length > 1000);
  // Check PK\x03\x04 ZIP signature
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const zipStr = zip.toString("utf-8");
  assert.ok(zipStr.includes("aura-meet-extension/manifest.json"));
  assert.ok(zipStr.includes("aura-meet-extension/background.js"));
  assert.ok(zipStr.includes("aura-meet-extension/content.js"));
  assert.ok(zipStr.includes("aura-meet-extension/README-INSTALL.txt"));
});



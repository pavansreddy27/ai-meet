"use client";

import { useState, useEffect, useRef } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Meeting = {
  meetingId: string;
  name: string;
  dateTime: string;
  docUploaded: boolean;
  mediaUploaded: boolean;
  messages: Message[];
};

export default function Home() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeMeeting, setActiveMeeting] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [meetingName, setMeetingName] = useState("");
  const [meetingDateTime, setMeetingDateTime] = useState("");

  const [docFile, setDocFile] = useState<File | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const active = meetings.find((m) => m.meetingId === activeMeeting);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages, chatLoading]);

  // 1. FETCH HISTORY
  useEffect(() => {
    const fetchMeetingHistory = async () => {
      try {
        const res = await fetch("https://jf07ylt4d2.execute-api.ap-south-1.amazonaws.com/list-meetings");
        const data = await res.json();
        const history = data.meetings || data;
        if (res.ok && Array.isArray(history)) {
          setMeetings(history);
        }
      } catch (err) {
        console.error("Failed to fetch history:", err);
      }
    };
    fetchMeetingHistory();
  }, []);

  // 2. SELECT MEETING & LOAD ANALYSIS
  const handleSelectMeeting = async (meetingId: string) => {
    setActiveMeeting(meetingId);
    setAnalysisResult(null);
    setAnalysisLoading(true);

    try {
      const res = await fetch(
        "https://jf07ylt4d2.execute-api.ap-south-1.amazonaws.com/get-meeting-analysis",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId }),
        }
      );
      const data = await res.json();
      if (res.ok && data) {
          setAnalysisResult(data);
      }
    } catch (err) {
      console.error("Failed to load stored analysis:", err);
    } finally {
      setAnalysisLoading(false);
    }
  };

  // 3. CREATE MEETING
  const createMeeting = async () => {
    if (!meetingName || !meetingDateTime) return;
    try {
      const res = await fetch(
        "https://jf07ylt4d2.execute-api.ap-south-1.amazonaws.com/create-meeting",
        { 
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: meetingName, dateTime: meetingDateTime }) 
        }
      );
      const data = await res.json();
      const newMeeting: Meeting = {
        meetingId: data.meetingId, 
        name: meetingName,
        dateTime: meetingDateTime,
        docUploaded: false,
        mediaUploaded: false,
        messages: [{ role: "assistant", content: `Meeting "${meetingName}" initialized.` }],
      };
      setMeetings((prev) => [newMeeting, ...prev]);
      setActiveMeeting(newMeeting.meetingId);
      setShowModal(false);
      setMeetingName("");
    } catch (err) {
      alert("Failed to create meeting.");
    }
  };

  // 4. SYNC DATA (Phases 1 & 2)
  const uploadFiles = async () => {
    if (!docFile || !mediaFile || !activeMeeting) {
      alert("Select documentation and media file first.");
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", docFile);
      formData.append("meeting_id", activeMeeting);
      
      // Phase 1: Ingest Docs
      await fetch("/api/ingest", { method: "POST", body: formData });
      
      // Phase 2: Generate S3 URL & Upload Media
      const response = await fetch(
        "https://jf07ylt4d2.execute-api.ap-south-1.amazonaws.com/generate-upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: mediaFile.name,
            fileType: mediaFile.type,
            meetingId: activeMeeting,
          }),
        }
      );

      const data = await response.json();
      const uploadRes = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mediaFile.type },
        body: mediaFile,
      });

      if (!uploadRes.ok) throw new Error("S3 upload failed");

      setMeetings((prev) =>
        prev.map((m) =>
          m.meetingId === activeMeeting
            ? { ...m, docUploaded: true, mediaUploaded: true }
            : m
        )
      );
      alert("✅ Data Synced. Now run Phase 3 Analysis.");
    } catch (err: any) {
      alert("❌ Sync failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  // 5. PHASE 3: ANALYSIS ENGINE
  const handleAnalyzeMeeting = async (meetingId: string) => {
    if (!active?.docUploaded || !active?.mediaUploaded) {
        alert("Please sync data to cloud before running analysis.");
        return;
    }
    
    setAnalysisLoading(true);
    setAnalysisResult(null);

    try {
      const res = await fetch(
        "https://jf07ylt4d2.execute-api.ap-south-1.amazonaws.com/analyze-meeting",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
          throw new Error(data.error || data.message || "Analysis timed out or failed.");
      }

      setAnalysisResult(data);
      alert("✅ Analysis Complete: Agents have processed the meeting.");
    } catch (err: any) {
      console.error("Analysis Error:", err);
      alert("❌ Analysis Engine Error: " + err.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  // 6. RAG CHAT BOT (Integrated Logic)
  const sendMessage = async () => {
    if (!chatInput.trim() || !activeMeeting) return;

    const userMessage: Message = { role: "user", content: chatInput };
    const currentInput = chatInput;
    setChatInput("");

    setMeetings((prev) =>
      prev.map((m) =>
        m.meetingId === activeMeeting
          ? { ...m, messages: [...m.messages, userMessage] }
          : m
      )
    );

    try {
      setChatLoading(true);
      const res = await fetch("https://jf07ylt4d2.execute-api.ap-south-1.amazonaws.com/chat-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: activeMeeting, query: currentInput }),
      });

      const raw = await res.json();

      // Handles both proxy + non-proxy responses
      const parsed = raw.body && typeof raw.body === "string" 
        ? JSON.parse(raw.body) 
        : raw;

      const assistantMessage: Message = { 
        role: "assistant", 
        content: parsed.answer || "I couldn't find specific details regarding that in the meeting transcript." 
      };

      setMeetings((prev) =>
        prev.map((m) =>
          m.meetingId === activeMeeting
            ? { ...m, messages: [...m.messages, assistantMessage] }
            : m
        )
      );
    } catch (err) {
      console.error("Chat Error:", err);
      const errorMessage: Message = { role: "assistant", content: "⚠ Error connecting to AI service." };
      setMeetings((prev) =>
        prev.map((m) =>
          m.meetingId === activeMeeting ? { ...m, messages: [...m.messages, errorMessage] } : m
        )
      );
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* SIDEBAR */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarLabel}>PROJECT: AI MEETING</div>
        <button style={styles.newButton} onClick={() => setShowModal(true)}>+ New Session</button>
        <div style={{ marginTop: 20 }}>
          {meetings.map((m) => (
            <div
              key={m.meetingId}
              onClick={() => handleSelectMeeting(m.meetingId)}
              style={{
                ...styles.meetingItem,
                borderLeft: activeMeeting === m.meetingId ? "4px solid #4f8cff" : "4px solid transparent",
                background: activeMeeting === m.meetingId ? "#2a2f3a" : "transparent",
              }}
            >
              <div style={{ fontWeight: 600, color: "#fff" }}>{m.name || "Session"}</div>
              <div style={{ fontSize: 11, opacity: 0.5 }}>{new Date(m.dateTime).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={styles.main}>
        {!activeMeeting ? (
          <div style={styles.placeholder}>Select a meeting history to view intelligence reports.</div>
        ) : (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <header style={{ marginBottom: 25, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <h2 style={{ margin: 0 }}>{active?.name}</h2>
                <div style={styles.statusBadge}>Meeting ID: {activeMeeting}</div>
              </div>
              <button 
                style={styles.primaryButton} 
                onClick={() => handleAnalyzeMeeting(activeMeeting)} 
                disabled={analysisLoading}
              >
                {analysisLoading ? "🧠 Agents Analyzing..." : "Run Phase 3 Analysis"}
              </button>
            </header>

            <div style={styles.dashboardGrid}>
              {/* LEFT COLUMN: UPLOAD & CHAT */}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>📂 Data Ingestion (Phases 1 & 2)</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label style={styles.fieldLabel}>Documentation (PRD/Agenda)</label>
                      <input type="file" accept=".docx,.pdf" onChange={(e) => setDocFile(e.target.files?.[0] || null)} style={styles.fileInput} />
                    </div>
                    <div>
                      <label style={styles.fieldLabel}>Recording (Audio/Video)</label>
                      <input type="file" accept=".mp3,.mp4" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} style={styles.fileInput} />
                    </div>
                    <button onClick={uploadFiles} style={styles.syncButton} disabled={uploading}>
                      {uploading ? "Syncing..." : "Sync Data to Cloud"}
                    </button>
                  </div>
                </div>

                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>💬 RAG Interactive Chat</h3>
                  <div style={styles.chatBox}>
                    {active?.messages.map((msg, i) => (
                      <div key={i} style={{ marginBottom: 12, textAlign: msg.role === "user" ? "right" : "left" }}>
                        <div style={{
                          ...styles.chatBubble,
                          background: msg.role === "user" ? "#4f8cff" : "#f1f1f1",
                          color: msg.role === "user" ? "#fff" : "#333",
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>AI is thinking...</div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <input
                      placeholder="Ask about meeting details..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                      style={styles.chatInput}
                    />
                    <button onClick={sendMessage} style={styles.sendButton} disabled={chatLoading}>
                      {chatLoading ? "..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: INTELLIGENCE */}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>🧠 Intelligence Feed (Phase 3)</h3>
                  
                  {analysisLoading ? (
                    <div style={styles.loadingState}>
                        <div style={styles.spinner}></div>
                        <p>Agents are comparing transcript with PRD and generating feedback...</p>
                    </div>
                  ) : analysisResult ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                      
                      <div style={styles.criticCard}>
                        <div style={styles.cardHeader}>
                           <span style={styles.agentTag}>Critic Agent</span>
                           <span style={styles.scoreBadge}>Score: {analysisResult.communication_score || "N/A"}/10</span>
                        </div>
                        <p style={styles.intelText}>{analysisResult.critic_feedback || "No performance data."}</p>
                      </div>

                      <div style={styles.deviationCard}>
                        <span style={styles.agentTag}>Deviation Agent</span>
                        <p style={styles.intelText}><strong>Missed/Deviated Points:</strong></p>
                        <ul style={styles.intelList}>
                          {(analysisResult.deviations || ["No deviations detected"]).map((d: string, i: number) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </div>

                      <div style={styles.momContainer}>
                        <span style={styles.agentTag}>MoM Generator</span>
                        <p style={styles.momText}><strong>Summary:</strong> {analysisResult.mom?.summary || analysisResult.summary || "No summary."}</p>
                        <div style={{ marginTop: 10 }}>
                          <strong>Action Items:</strong>
                          <ul style={styles.intelList}>
                            {(analysisResult.mom?.action_items || analysisResult.action_items || []).map((item: any, i: number) => (
                              <li key={i}>{typeof item === 'string' ? item : (item.task || "Task")}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                    </div>
                  ) : (
                    <div style={styles.emptyIntelligence}>Click "Run Phase 3 Analysis" after uploading files.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL */}
      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3>New Meeting Session</h3>
            <input placeholder="Meeting Name" value={meetingName} onChange={(e) => setMeetingName(e.target.value)} style={styles.input} />
            <input type="datetime-local" value={meetingDateTime} onChange={(e) => setMeetingDateTime(e.target.value)} style={styles.input} />
            <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
              <button onClick={createMeeting} style={styles.primaryButton}>Initialize</button>
              <button onClick={() => setShowModal(false)} style={{ ...styles.primaryButton, background: "#ccc" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: any = {
  container: { display: "flex", height: "100vh", fontFamily: "'Inter', sans-serif", background: "#f8f9fc" },
  sidebar: { width: 260, background: "#111418", color: "#fff", padding: "30px 20px", overflowY: "auto" },
  sidebarLabel: { marginBottom: 20, fontSize: 11, fontWeight: 800, color: "#4f8cff", letterSpacing: 1.5 },
  main: { flex: 1, padding: "40px 50px", overflow: "hidden" },
  newButton: { width: "100%", padding: 12, background: "#4f8cff", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontWeight: 700 },
  meetingItem: { padding: "12px 15px", cursor: "pointer", borderRadius: "0 8px 8px 0", marginBottom: 6 },
  section: { padding: 25, background: "#fff", borderRadius: 16, boxShadow: "0 4px 12px rgba(0,0,0,0.03)" },
  sectionTitle: { margin: "0 0 20px 0", fontSize: 16, fontWeight: 700, color: "#111" },
  dashboardGrid: { display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 25, height: "calc(100% - 100px)" },
  fieldLabel: { fontSize: 12, color: "#666", display: "block", marginBottom: 5 },
  fileInput: { fontSize: 12, color: "#444" },
  syncButton: { marginTop: 10, padding: 10, background: "#111", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  primaryButton: { padding: "12px 24px", background: "#4f8cff", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  chatBox: { height: 280, overflowY: "auto", border: "1px solid #eee", padding: 15, borderRadius: 12, marginBottom: 10, background: "#fafafa" },
  chatBubble: { display: "inline-block", padding: "10px 14px", borderRadius: "14px", maxWidth: "85%", fontSize: "13px" },
  chatInput: { flex: 1, padding: "12px", borderRadius: 8, border: "1px solid #ddd" },
  sendButton: { padding: "0 20px", background: "#4f8cff", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  statusBadge: { fontSize: 11, background: "#eef2ff", color: "#4f8cff", padding: "4px 8px", borderRadius: 4, display: "inline-block", marginTop: 5 },
  agentTag: { fontSize: 10, fontWeight: 800, color: "#4f8cff", textTransform: "uppercase", marginBottom: 8, display: "block" },
  scoreBadge: { background: "#4f8cff", color: "#fff", padding: "2px 8px", borderRadius: 10, fontSize: 11 },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  criticCard: { background: "#fff9e6", padding: 15, borderRadius: 12, border: "1px solid #ffeeba" },
  deviationCard: { background: "#fff5f5", padding: 15, borderRadius: 12, border: "1px solid #ffdada" },
  momContainer: { background: "#f8faff", padding: 15, borderRadius: 12, border: "1px solid #eef2ff" },
  intelText: { fontSize: 13, lineHeight: "1.5", margin: 0, color: "#333" },
  intelList: { fontSize: 13, paddingLeft: 20, marginTop: 5, color: "#444" },
  loadingState: { textAlign: "center", padding: 40, color: "#4f8cff", fontWeight: 600 },
  emptyIntelligence: { textAlign: "center", padding: 50, color: "#aaa", border: "1px dashed #ccc", borderRadius: 12 },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 },
  modal: { background: "#fff", padding: 30, borderRadius: 16, width: 380 },
  input: { width: "100%", padding: 12, marginTop: 10, borderRadius: 8, border: "1px solid #ddd", boxSizing: "border-box" },
  placeholder: { textAlign: "center", marginTop: 150, color: "#aaa", fontSize: 18, fontWeight: 500 },
  spinner: { width: 30, height: 30, border: "4px solid #f3f3f3", borderTop: "4px solid #4f8cff", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 10px" }
};
import React, { useState } from "react";

// Local-storage backed shim with the same shape as the Claude artifact
// storage API (get/set/delete), so the rest of the app is unchanged.
const storage = {
  async get(key) {
    const value = window.localStorage.getItem(key);
    return value === null ? null : { key, value };
  },
  async set(key, value) {
    window.localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    window.localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

const TONES = [
  { id: "luxury", label: "Luxury", hint: "elevated, aspirational" },
  { id: "family", label: "Family-friendly", hint: "warm, practical" },
  { id: "modern", label: "Modern minimal", hint: "clean, direct" },
  { id: "investor", label: "Investor-focused", hint: "numbers-first" },
];

const FIELD_LABELS = {
  address: "Address",
  propertyType: "Property type",
  beds: "Beds",
  baths: "Baths",
  sqft: "Sq ft",
  price: "Price",
};

export default function ListingGenerator() {
  const [form, setForm] = useState({
    address: "",
    propertyType: "Single-family home",
    beds: "",
    baths: "",
    sqft: "",
    price: "",
    features: "",
  });
  const [tone, setTone] = useState("luxury");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [compareResults, setCompareResults] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [captions, setCaptions] = useState(null);
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [captionsError, setCaptionsError] = useState("");
  const [media, setMedia] = useState([]);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const dragCounter = React.useRef(0);

  const update = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function addMediaFiles(fileList) {
    const files = Array.from(fileList || []).filter(
      (file) => file.type.startsWith("image") || file.type.startsWith("video")
    );
    const items = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      kind: file.type.startsWith("video") ? "video" : "image",
      url: URL.createObjectURL(file),
      size: file.size,
    }));
    setMedia((m) => [...m, ...items]);
  }

  function handleMediaSelect(e) {
    addMediaFiles(e.target.files);
    e.target.value = "";
  }

  function handleMediaDragEnter(e) {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer?.types?.includes("Files")) setIsDraggingMedia(true);
  }

  function handleMediaDragLeave(e) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDraggingMedia(false);
    }
  }

  function handleMediaDragOver(e) {
    e.preventDefault();
  }

  function handleMediaDrop(e) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingMedia(false);
    addMediaFiles(e.dataTransfer.files);
  }

  function removeMedia(id) {
    setMedia((m) => {
      const target = m.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return m.filter((item) => item.id !== id);
    });
  }

  const canGenerate = form.address.trim() && form.features.trim() && !loading;

  React.useEffect(() => {
    (async () => {
      try {
        const idx = await storage.get("listing-history-index");
        const ids = idx ? JSON.parse(idx.value) : [];
        const items = [];
        for (const id of ids) {
          try {
            const rec = await storage.get(`listing:${id}`);
            if (rec) items.push(JSON.parse(rec.value));
          } catch (e) {
            /* skip missing */
          }
        }
        items.sort((a, b) => b.createdAt - a.createdAt);
        setHistory(items);
      } catch (e) {
        /* no history yet */
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, []);

  async function saveToHistory(entry) {
    try {
      await storage.set(`listing:${entry.id}`, JSON.stringify(entry));
      const idx = await storage.get("listing-history-index").catch(() => null);
      const ids = idx ? JSON.parse(idx.value) : [];
      const nextIds = [entry.id, ...ids.filter((i) => i !== entry.id)].slice(0, 50);
      await storage.set("listing-history-index", JSON.stringify(nextIds));
      setHistory((h) => [entry, ...h.filter((e) => e.id !== entry.id)]);
    } catch (e) {
      /* saving is best-effort */
    }
  }

  async function deleteHistoryItem(id) {
    try {
      await storage.delete(`listing:${id}`);
      const idx = await storage.get("listing-history-index").catch(() => null);
      const ids = idx ? JSON.parse(idx.value) : [];
      await storage.set(
        "listing-history-index",
        JSON.stringify(ids.filter((i) => i !== id))
      );
    } catch (e) {
      /* ignore */
    }
    setHistory((h) => h.filter((e) => e.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function loadHistoryItem(entry) {
    setForm(entry.form);
    setTone(entry.tone);
    setResult(entry.result);
    setActiveId(entry.id);
    setShowHistory(false);
  }

  function listingPrompt(toneObj) {
    return `You are a real estate copywriter. Write a compelling MLS-style listing description for the following property. Tone: ${toneObj.label} (${toneObj.hint}).

Address: ${form.address}
Property type: ${form.propertyType}
Beds: ${form.beds || "n/a"}
Baths: ${form.baths || "n/a"}
Square footage: ${form.sqft || "n/a"}
Price: ${form.price || "n/a"}
Key features / notes: ${form.features}

Write 2-3 short paragraphs (120-180 words total). Do not use placeholder brackets. Do not include a headline or title, just the body copy. Avoid cliches like "won't last long" or "must see".`;
  }

  async function callClaude(prompt) {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!response.ok) throw new Error("request failed");
    const data = await response.json();
    const text = (data.text || "").trim();
    if (!text) throw new Error("empty response");
    return text;
  }

  async function generate() {
    setLoading(true);
    setError("");
    setCopied(false);
    setResult("");
    setCompareResults(null);
    setCaptions(null);

    try {
      const toneObj = TONES.find((t) => t.id === tone);
      const text = await callClaude(listingPrompt(toneObj));
      setResult(text);
      const entry = {
        id: `${Date.now()}`,
        createdAt: Date.now(),
        form: { ...form },
        tone,
        result: text,
      };
      setActiveId(entry.id);
      saveToHistory(entry);
    } catch (e) {
      setError("Couldn't generate a listing just now. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  async function generateCompare() {
    setCompareLoading(true);
    setError("");
    setResult("");
    setCompareResults(null);
    setCaptions(null);

    try {
      const pairs = await Promise.all(
        TONES.map(async (t) => [t.id, await callClaude(listingPrompt(t))])
      );
      setCompareResults(Object.fromEntries(pairs));
    } catch (e) {
      setError("Couldn't generate the comparison just now. Try again in a moment.");
    } finally {
      setCompareLoading(false);
    }
  }

  function useCompareResult(toneId, text) {
    setTone(toneId);
    setResult(text);
    setCompareResults(null);
    const entry = {
      id: `${Date.now()}`,
      createdAt: Date.now(),
      form: { ...form },
      tone: toneId,
      result: text,
    };
    setActiveId(entry.id);
    saveToHistory(entry);
  }

  async function generateCaptions() {
    if (!result) return;
    setCaptionsLoading(true);
    setCaptionsError("");
    setCaptions(null);
    const prompt = `Based on this real estate listing description, write social captions for promoting the property:

"""
${result}
"""

Address: ${form.address}
Price: ${form.price || "n/a"}

Write exactly 3 captions:
1. Instagram — punchy, 2-3 short lines, can include up to 5 relevant hashtags at the end
2. Facebook — slightly longer, friendly and inviting, 2-3 sentences, no hashtags
3. Text/MMS to an interested buyer — brief and casual, 1-2 sentences, no hashtags

Format your response as exactly:
INSTAGRAM: <caption>
FACEBOOK: <caption>
TEXT: <caption>`;
    try {
      const text = await callClaude(prompt);
      const grab = (label, stopLabels) => {
        const re = new RegExp(
          `${label}:\\s*([\\s\\S]*?)(?=${stopLabels.join("|")}|$)`,
          "i"
        );
        const m = text.match(re);
        return m ? m[1].trim() : "";
      };
      setCaptions({
        instagram: grab("INSTAGRAM", ["FACEBOOK:", "TEXT:"]),
        facebook: grab("FACEBOOK", ["TEXT:"]),
        text: grab("TEXT", []),
      });
    } catch (e) {
      setCaptionsError("Couldn't generate captions just now. Try again in a moment.");
    } finally {
      setCaptionsLoading(false);
    }
  }

  function copy(text) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F6F3ED",
        fontFamily: "'Inter', system-ui, sans-serif",
        color: "#1A1A1A",
        padding: "32px 20px 60px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        input, textarea, select { font-family: 'Inter', system-ui, sans-serif; }
        input:focus, textarea:focus, select:focus, button:focus-visible {
          outline: 2px solid #B8894F;
          outline-offset: 2px;
        }
        .tone-btn { transition: all 0.15s ease; }
        .gen-btn { transition: transform 0.1s ease, background 0.15s ease; }
        .gen-btn:hover:not(:disabled) { background: #16232F; }
        .gen-btn:active:not(:disabled) { transform: scale(0.98); }
        @media (min-width: 860px) {
          .layout { grid-template-columns: 380px 1fr !important; }
        }
      `}</style>

      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div
          style={{
            marginBottom: 32,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg
              width="46"
              height="46"
              viewBox="0 0 46 46"
              style={{ flexShrink: 0 }}
              aria-hidden="true"
            >
              <rect
                x="8"
                y="8"
                width="30"
                height="30"
                transform="rotate(45 23 23)"
                fill="none"
                stroke="#1B2A3A"
                strokeWidth="1.4"
              />
              <line x1="23" y1="1" x2="23" y2="7" stroke="#B8894F" strokeWidth="1.6" />
              <line x1="23" y1="39" x2="23" y2="45" stroke="#B8894F" strokeWidth="1.6" />
              <line x1="1" y1="23" x2="7" y2="23" stroke="#B8894F" strokeWidth="1.6" />
              <line x1="39" y1="23" x2="45" y2="23" stroke="#B8894F" strokeWidth="1.6" />
              <text
                x="23"
                y="28"
                textAnchor="middle"
                fontFamily="'Fraunces', serif"
                fontWeight="600"
                fontSize="15"
                fill="#1B2A3A"
              >
                NP
              </text>
            </svg>
            <div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#B8894F",
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                Listing Copy Studio
              </div>
              <h1
                style={{
                  fontFamily: "'Fraunces', serif",
                  fontWeight: 500,
                  fontSize: "clamp(26px, 4vw, 38px)",
                  margin: 0,
                  color: "#1B2A3A",
                  letterSpacing: "0.01em",
                }}
              >
                NIR PROPERTEE
              </h1>
            </div>
          </div>
          <button
            onClick={() => setShowHistory((s) => !s)}
            style={{
              padding: "9px 14px",
              borderRadius: 3,
              border: "1px solid #C9C3B6",
              background: showHistory ? "#1B2A3A" : "#FFFFFF",
              color: showHistory ? "#FFFFFF" : "#1B2A3A",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {showHistory ? "Hide history" : `History (${history.length})`}
          </button>
        </div>

        {showHistory && (
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E4DFD3",
              borderRadius: 4,
              padding: 16,
              marginBottom: 24,
            }}
          >
            {!historyLoaded && (
              <div style={{ fontSize: 13, color: "#8A8577" }}>Loading history...</div>
            )}
            {historyLoaded && history.length === 0 && (
              <div style={{ fontSize: 13, color: "#8A8577" }}>
                No saved listings yet — generate one and it'll show up here.
              </div>
            )}
            {history.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 4px",
                  borderBottom: "1px solid #F0ECE1",
                }}
              >
                <button
                  onClick={() => loadHistoryItem(entry)}
                  style={{
                    background: "none",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    padding: 0,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#1B2A3A",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.form.address || "Untitled property"}
                  </div>
                  <div style={{ fontSize: 12, color: "#8A8577" }}>
                    {new Date(entry.createdAt).toLocaleString()} ·{" "}
                    {TONES.find((t) => t.id === entry.tone)?.label}
                  </div>
                </button>
                <button
                  onClick={() => deleteHistoryItem(entry.id)}
                  style={{
                    background: "none",
                    border: "1px solid #E4DFD3",
                    borderRadius: 3,
                    color: "#B4442E",
                    fontSize: 12,
                    padding: "5px 9px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className="layout"
          style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}
        >
          {/* FORM */}
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E4DFD3",
              borderRadius: 4,
              padding: 24,
            }}
          >
            <Field label="Address">
              <input
                style={inputStyle}
                placeholder="412 Maple Ridge Rd, Asheville NC"
                value={form.address}
                onChange={update("address")}
              />
            </Field>

            <Field label="Property type">
              <select
                style={inputStyle}
                value={form.propertyType}
                onChange={update("propertyType")}
              >
                {[
                  "Single-family home",
                  "Condo",
                  "Townhouse",
                  "Multi-family",
                  "Land",
                  "Residential lot",
                  "Commercial lot",
                  "Agricultural lot",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <Field label="Beds">
                <input style={inputStyle} value={form.beds} onChange={update("beds")} />
              </Field>
              <Field label="Baths">
                <input style={inputStyle} value={form.baths} onChange={update("baths")} />
              </Field>
              <Field label="Sq ft">
                <input style={inputStyle} value={form.sqft} onChange={update("sqft")} />
              </Field>
            </div>

            <Field label="Price">
              <input
                style={inputStyle}
                placeholder="$685,000"
                value={form.price}
                onChange={update("price")}
              />
            </Field>

            <Field label="Key features & notes">
              <textarea
                style={{ ...inputStyle, minHeight: 100, resize: "vertical" }}
                placeholder="Updated kitchen, wraparound porch, quiet cul-de-sac, walk to schools, finished basement..."
                value={form.features}
                onChange={update("features")}
              />
            </Field>

            <div style={{ marginBottom: 18 }}>
              <div style={labelStyle}>Photos & video</div>
              <label
                htmlFor="media-upload"
                onDragEnter={handleMediaDragEnter}
                onDragOver={handleMediaDragOver}
                onDragLeave={handleMediaDragLeave}
                onDrop={handleMediaDrop}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "16px 12px",
                  border: `1.5px dashed ${isDraggingMedia ? "#B8894F" : "#C9C3B6"}`,
                  borderRadius: 3,
                  background: isDraggingMedia ? "#F3ECDF" : "#FDFCF9",
                  color: isDraggingMedia ? "#1B2A3A" : "#7A7568",
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "background 0.12s ease, border-color 0.12s ease",
                }}
              >
                {isDraggingMedia
                  ? "Drop to add"
                  : "Click or drag photos / a video walkthrough here"}
              </label>
              <input
                id="media-upload"
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handleMediaSelect}
                style={{ display: "none" }}
              />

              {media.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {media.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        position: "relative",
                        borderRadius: 3,
                        overflow: "hidden",
                        border: "1px solid #E4DFD3",
                        background: "#000",
                        aspectRatio: "1 / 1",
                      }}
                    >
                      {item.kind === "video" ? (
                        <video
                          src={item.url}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          muted
                        />
                      ) : (
                        <img
                          src={item.url}
                          alt={item.name}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      )}
                      {item.kind === "video" && (
                        <div
                          style={{
                            position: "absolute",
                            top: 4,
                            left: 4,
                            background: "rgba(0,0,0,0.6)",
                            color: "#fff",
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            padding: "2px 5px",
                            borderRadius: 2,
                          }}
                        >
                          VIDEO
                        </div>
                      )}
                      <button
                        onClick={() => removeMedia(item.id)}
                        aria-label={`Remove ${item.name}`}
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          border: "none",
                          background: "rgba(0,0,0,0.65)",
                          color: "#fff",
                          fontSize: 12,
                          lineHeight: "20px",
                          textAlign: "center",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: "#9B9585", marginTop: 8, lineHeight: 1.5 }}>
                Previews are for this session only — media isn't saved with history
                since attachments can be large.
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={labelStyle}>Tone</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    className="tone-btn"
                    onClick={() => setTone(t.id)}
                    style={{
                      padding: "7px 12px",
                      borderRadius: 3,
                      border: `1px solid ${tone === t.id ? "#1B2A3A" : "#D8D2C4"}`,
                      background: tone === t.id ? "#1B2A3A" : "#FFFFFF",
                      color: tone === t.id ? "#FFFFFF" : "#4A4A4A",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="gen-btn"
              onClick={generate}
              disabled={!canGenerate}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 3,
                border: "none",
                background: canGenerate ? "#1B2A3A" : "#C9C3B6",
                color: "#FFFFFF",
                fontSize: 14,
                fontWeight: 600,
                cursor: canGenerate ? "pointer" : "not-allowed",
              }}
            >
              {loading ? "Writing..." : "Generate listing"}
            </button>
            <button
              onClick={generateCompare}
              disabled={!form.address.trim() || !form.features.trim() || compareLoading}
              style={{
                width: "100%",
                padding: "10px",
                marginTop: 8,
                borderRadius: 3,
                border: "1px solid #1B2A3A",
                background: "transparent",
                color: "#1B2A3A",
                fontSize: 13,
                fontWeight: 600,
                cursor:
                  !form.address.trim() || !form.features.trim() || compareLoading
                    ? "not-allowed"
                    : "pointer",
                opacity: !form.address.trim() || !form.features.trim() ? 0.5 : 1,
              }}
            >
              {compareLoading ? "Comparing tones..." : "Compare all tones"}
            </button>
            {error && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#B4442E" }}>
                {error}
              </div>
            )}
          </div>

          {/* RESULT */}
          <div
            style={{
              background: "#1B2A3A",
              borderRadius: 4,
              padding: 0,
              minHeight: 360,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: "linear-gradient(90deg, #B8894F, #7C8B7A)",
              }}
            />
            <div style={{ padding: "28px 28px 24px" }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#B8894F",
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {result ? "Listing draft" : "Awaiting details"}
              </div>
              {form.address && (
                <div
                  style={{
                    fontFamily: "'Fraunces', serif",
                    fontSize: 22,
                    color: "#FFFFFF",
                    marginBottom: 18,
                    fontWeight: 500,
                  }}
                >
                  {form.address}
                </div>
              )}

              {!result && !loading && (
                <div style={{ color: "#8A96A3", fontSize: 14, lineHeight: 1.6, marginTop: 8 }}>
                  Fill in the property details and pick a tone, then generate a
                  ready-to-use listing description here.
                </div>
              )}

              {loading && (
                <div style={{ color: "#8A96A3", fontSize: 14 }}>
                  Drafting your listing...
                </div>
              )}

              {result && (
                <>
                  <div
                    style={{
                      color: "#E8E4DA",
                      fontSize: 15,
                      lineHeight: 1.75,
                      whiteSpace: "pre-wrap",
                      fontFamily: "'Fraunces', serif",
                      fontWeight: 400,
                    }}
                  >
                    {result}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
                    <button
                      onClick={() => copy(result)}
                      style={{
                        padding: "8px 14px",
                        background: "transparent",
                        border: "1px solid #47576A",
                        borderRadius: 3,
                        color: "#E8E4DA",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      {copied ? "Copied" : "Copy text"}
                    </button>
                    <button
                      onClick={generateCaptions}
                      disabled={captionsLoading}
                      style={{
                        padding: "8px 14px",
                        background: "transparent",
                        border: "1px solid #B8894F",
                        borderRadius: 3,
                        color: "#D9B27C",
                        fontSize: 13,
                        cursor: captionsLoading ? "not-allowed" : "pointer",
                      }}
                    >
                      {captionsLoading ? "Writing captions..." : "Generate social captions"}
                    </button>
                  </div>

                  {captionsError && (
                    <div style={{ marginTop: 12, fontSize: 13, color: "#E39B8A" }}>
                      {captionsError}
                    </div>
                  )}

                  {captions && (
                    <div
                      style={{
                        marginTop: 20,
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      <CaptionCard label="Instagram" text={captions.instagram} onCopy={copy} />
                      <CaptionCard label="Facebook" text={captions.facebook} onCopy={copy} />
                      <CaptionCard label="Text / MMS" text={captions.text} onCopy={copy} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {compareResults && (
          <div style={{ marginTop: 28 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#B8894F",
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              Tone comparison
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 14,
              }}
            >
              {TONES.map((t) => (
                <div
                  key={t.id}
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #E4DFD3",
                    borderRadius: 4,
                    padding: 18,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#1B2A3A",
                      marginBottom: 10,
                    }}
                  >
                    {t.label}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.65,
                      color: "#3A3A34",
                      flex: 1,
                      whiteSpace: "pre-wrap",
                      fontFamily: "'Fraunces', serif",
                    }}
                  >
                    {compareResults[t.id]}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button
                      onClick={() => useCompareResult(t.id, compareResults[t.id])}
                      style={{
                        padding: "7px 11px",
                        borderRadius: 3,
                        border: "1px solid #1B2A3A",
                        background: "#1B2A3A",
                        color: "#FFF",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Use this
                    </button>
                    <button
                      onClick={() => copy(compareResults[t.id])}
                      style={{
                        padding: "7px 11px",
                        borderRadius: 3,
                        border: "1px solid #D8D2C4",
                        background: "#FFF",
                        color: "#4A4A4A",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CaptionCard({ label, text, onCopy }) {
  if (!text) return null;
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid #33445A",
        borderRadius: 3,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#B8894F",
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13.5,
          lineHeight: 1.6,
          color: "#E8E4DA",
          whiteSpace: "pre-wrap",
          marginBottom: 10,
        }}
      >
        {text}
      </div>
      <button
        onClick={() => onCopy(text)}
        style={{
          padding: "5px 10px",
          background: "transparent",
          border: "1px solid #47576A",
          borderRadius: 3,
          color: "#C9C3B6",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Copy
      </button>
    </div>
  );
}

const labelStyle = {
  fontSize: 12,
  fontWeight: 600,
  color: "#5A5A52",
  marginBottom: 6,
  letterSpacing: "0.01em",
};

const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  border: "1px solid #D8D2C4",
  borderRadius: 3,
  fontSize: 14,
  background: "#FDFCF9",
  color: "#1A1A1A",
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

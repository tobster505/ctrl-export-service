// ===============================================
// build_PDF_link  (runs after V3_BuildSummary)
// Creates: workflow.ctrl.downloads.pdf (+ test links)
// Uses:    workflow.ctrlCard, workflow.ctrl.chartUrl
// Targets: https://ctrl-export-service.vercel.app/api/fill-template
// ===============================================
(function () {
  workflow.ctrl = workflow.ctrl || {};
  const card = workflow.ctrlCard || {};
  const chartUrl = (workflow.ctrl && workflow.ctrl.chartUrl) || card.chartUrl || "";

  // ---------- Single vs Pair headline ----------
  const isPair = Array.isArray(card.stateWords) && card.stateWords.length === 2;
  const stateWord  = !isPair ? (card.stateWord || undefined) : undefined;
  const stateWords =  isPair ? card.stateWords : undefined;

  // ---------- Tips (defend with safe fallbacks) ----------
  const tip1 = (typeof card.tip1 === "string" && card.tip1.trim()) ? card.tip1 : "Take one slow breath before you speak.";
  const tip2 = (typeof card.tip2 === "string" && card.tip2.trim()) ? card.tip2 : "Add a brief check-in between moments.";

  // ---------- HOW (pair/single chosen upstream) ----------
  const how = (card.how && card.how.trim())
    ? card.how
    : (card.headlineMeaning || "");

  // ---------- Page 1 right-column (direction + top theme) ----------
  const themeNice = {
    emotion_regulation: "Emotion regulation",
    social_navigation:  "Social navigation",
    awareness_impact:   "Awareness of impact",
    feedback_handling:  "Feedback handling",
    confidence_resilience: "Confidence & resilience",
    stress_awareness:   "Stress awareness",
    boundary_awareness: "Boundary awareness",
    intent_awareness:   "Intent awareness"
  };
  const themeExplain = {
    emotion_regulation: "Settling yourself when feelings spike.",
    social_navigation:  "Reading the room and adjusting to people and context.",
    awareness_impact:   "Noticing how your words and actions land.",
    feedback_handling:  "Hearing praise and pointers without losing balance.",
    confidence_resilience: "Bouncing back after wobbles and keeping momentum.",
    stress_awareness:   "Catching pressure early so it does not steer the car.",
    boundary_awareness: "Knowing and naming limits to protect energy and trust.",
    intent_awareness:   "Knowing your purpose before you act, reducing noise."
  };

  const directionLabel   = card.directionLabel || "";
  const directionMeaning = card.directionMeaning || "";

  const themeKeyFromCard = card.tipThemeKey; // set in V3_BuildSummary
  const themeLabel   = card.themeLabel   || (themeKeyFromCard ? (themeNice[themeKeyFromCard]   || "") : "");
  const themeMeaning = card.themeMeaning || (themeKeyFromCard ? (themeExplain[themeKeyFromCard] || "") : "");

  // ---------- Page 2 THEMES (Top 3) ----------
  // Prefer structured keys if you later add them in V3_BuildSummary:
  //   card.themeTop3Keys = ["emotion_regulation","social_navigation","awareness_impact"]
  //   or card.themeTop3 = [{label, meaning}, ...]
  // Otherwise, gracefully parse the existing `themesExplainer` bullets.
  let page2Themes = [];
  if (Array.isArray(card.themeTop3)) {
    page2Themes = card.themeTop3
      .slice(0, 3)
      .map(t => ({ title: String(t.label || "").trim(), body: String(t.meaning || "").trim() }))
      .filter(t => t.title || t.body);
  } else if (Array.isArray(card.themeTop3Keys)) {
    page2Themes = card.themeTop3Keys.slice(0,3).map(k => ({
      title: themeNice[k] || k,
      body:  themeExplain[k] || ""
    }));
  } else if (typeof card.themesExplainer === "string" && card.themesExplainer.trim()) {
    // Parse lines like: "• emotion regulation — Settling yourself when feelings spike."
    const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, "");
    const byNiceKey = Object.fromEntries(Object.entries(themeNice).map(([k, v]) => [norm(v), k]));
    const lines = card.themesExplainer
      .split("\n")
      .map(s => s.replace(/^•\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 3);

    page2Themes = lines.map(line => {
      // split on em dash or hyphen
      const parts = line.split(/\s+[—-]\s+/);
      const rawLabel = (parts[0] || "").trim();
      const rawBody  = (parts[1] || "").trim();
      const keyGuess = byNiceKey[norm(rawLabel)];
      return {
        title: keyGuess ? themeNice[keyGuess] : rawLabel,
        body:  keyGuess ? (themeExplain[keyGuess] || rawBody) : rawBody
      };
    });
  }

  // ---------- Build the payload ----------
  const payload = {
    // Headline label(s)
    stateWord,
    stateWords,

    // Action boxes
    tip1,
    tip2,

    // How this tends to show up
    how,

    // Page 1 right column (unchanged)
    directionLabel,
    directionMeaning,
    themeLabel,
    themeMeaning,

    // Page 2 right column: Top 3 Themes
    page2Themes,

    // Radar image URL
    chartUrl
  };

  // ---------- Base64 encode ----------
  function toBase64(str) {
    try { return Buffer.from(str, "utf8").toString("base64"); }
    catch (e) { if (typeof btoa !== "undefined") return btoa(unescape(encodeURIComponent(str))); return ""; }
  }
  const dataB64 = toBase64(JSON.stringify(payload));
  if (!dataB64) {
    workflow.ctrl.PDF_Debug = "❌ Could not base64-encode payload.";
    return;
  }

  // ---------- File naming ----------
  function safeName(s) {
    return String(s || "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  }
  const preferred =
    (session && (session.PreferredName || session.preferredName)) ||
    (workflow && (workflow.PreferredName || workflow.preferredName)) || "";
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  const who = safeName(preferred) || "report";
  const fileName = `CTRL_${who}_${yyyy}${mm}${dd}.pdf`;

  // ---------- Links ----------
  const BASE = "https://ctrl-export-service.vercel.app/api/fill-template";
  const cacheBust = String(Date.now()).slice(-6);

  const pdfUrl = `${BASE}?data=${encodeURIComponent(dataB64)}&name=${encodeURIComponent(fileName)}&safe=1&v=${cacheBust}`;
  const testOne  = `${BASE}?test=1&preview=1`;
  const testPair = `${BASE}?test=pair&preview=1`;
  const testAuto = isPair ? testPair : testOne;
  const tunerCommon = `&preview=1&box=1&cx=1050&cy=620&cw=700&ch=400`;
  const tuner  = `${BASE}?test=${isPair ? "pair" : "1"}${tunerCommon}`;

  workflow.ctrl.downloads = workflow.ctrl.downloads || {};
  workflow.ctrl.downloads.pdf               = pdfUrl;
  workflow.ctrl.downloads.pdf_test_single   = testOne;
  workflow.ctrl.downloads.pdf_test_pair     = testPair;
  workflow.ctrl.downloads.pdf_test_auto     = testAuto;
  workflow.ctrl.downloads.pdf_tuner         = tuner;

  const mode = isPair ? "PAIR" : "SINGLE";
  const keys = Object.keys(payload).join(",");
  workflow.ctrl.PDF_Debug = `✅ PDF link built [${mode}] · payload=${dataB64.length}B · keys=[${keys}] · url≈${pdfUrl.length}ch`;
})();

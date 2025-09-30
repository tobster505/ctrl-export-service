// Try to hydrate the payload P from Botpress-ish query + data
// q = req.query (plain query params)
// src = parsed base64 data object (if provided)
// RPT_MIN = minimal report structure you already carry around (optional)
function tryHydrateFromBotpressish(P, q = {}, src = {}, RPT_MIN = {}) {
  const S = (v, fb = "") => (v == null ? String(fb) : String(v));
  const norm = (s) => S(s).trim();

  // 1) Deep-merge source data first (authoritative for report content)
  if (src && typeof src === "object") {
    for (const [k, v] of Object.entries(src)) {
      if (P[k] == null) P[k] = v;
    }
  }

  // 2) Person name — DO NOT read from q.name (that is now reserved for downloads in older links)
  if (!P.name) {
    P.name = norm(
      (src && (src.name || src.fullName || src.preferredName)) ||
      (RPT_MIN && RPT_MIN.person && (RPT_MIN.person.fullName || RPT_MIN.person.name)) ||
      q.fullName ||
      q.preferredName
    );
  }

  // 3) Date label
  if (!P.dateLbl) {
    P.dateLbl = norm(src.d || src.dateLbl || q.dateLbl || q.d);
  }

  // 4) Dominant labels and strings commonly sent by your builder
  const preferredKeys = [
    "dom", "domLabel", "domchar", "character", "domdesc", "dominantDesc",
    "spiderdesc", "spiderfreq", "seqpat", "pattern", "theme", "chart", "chartUrl"
  ];

  for (const k of preferredKeys) {
    if (P[k] == null) {
      if (src && src[k] != null) P[k] = src[k];
      else if (q && q[k] != null) P[k] = q[k];
    }
  }

  // 5) Merge a few plain query keys ONLY IF still missing, but explicitly exclude "name"
  const plainQueryKeys = [
    "fullName", "preferredName", "dom", "domLabel", "domchar", "character",
    "domdesc", "dominantDesc", "spiderdesc", "spiderfreq", "chart", "seqpat",
    "pattern", "theme", "dateLbl", "d"
  ];
  for (const k of plainQueryKeys) {
    if (P[k] == null && q[k] != null) P[k] = q[k];
  }

  // 6) Fallbacks
  if (!P.name) P.name = "Perspective";
  if (!P.dateLbl) {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2,"0");
    const mmm = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getMonth()];
    const yyyy = d.getFullYear();
    P.dateLbl = `${dd}${mmm}${yyyy}`;
  }

  return P;
}

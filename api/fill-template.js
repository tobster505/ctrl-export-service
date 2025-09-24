--- a/fill-template.js
+++ b/fill-template.js
@@
-// /api/fill-template.js — CTRL V3 Slim Exporter (p7 colleagues only, p8 leaders, p9 tips/actions, p10 footer slot)
+// /api/fill-template.js — CTRL V3 Slim Exporter (p7/8 colleagues split, p9/10 leaders split, p11 tips/actions, p12 footer slot)
@@
-// - Page 7 draws only the four *colleague* boxes; internal “What to look…” labels removed.
+// - Page 7: *colleagues* — LOOK only (what to look out for)
 //   • Tune globally with ?p7_bodySize=NN or ?p7_s=NN and ?p7_maxLines=NN
 //   • Tune per-box with ?p7_col{C|T|R|L}_s=NN and/or ?p7_col{C|T|R|L}_max=NN
-// - Page 8 draws the four *leader* boxes (moved from p7); titles removed.
-//   • Tune globally with ?p8_bodySize=NN or ?p8_s=NN and ?p8_maxLines=NN
-//   • Tune per-box with ?p8_ldr{C|T|R|L}_s=NN and/or ?p8_ldr{C|T|R|L}_max=NN
-//     (also accepts legacy ?p7_ldr{C|T|R|L}_s / _max as fallback)
-// - Page 9 contains Tips & Actions. Use p9_* tuners (set *_size=0 to hide headers).
-// - Optional Page 10 footer/name slot: tune with n10x=…&n10y=…&n10w=…&n10s=…&n10align=…
+// - Page 8: *colleagues* — WORK only (how to work with)
+//   • Tune globally with ?p8_bodySize=NN or ?p8_s=NN and ?p8_maxLines=NN
+//   • Per-box: ?p8_col{C|T|R|L}_… (fallback to ?p7_col… if absent)
+// - Page 9: *leaders* — LOOK only. Per-box: ?p9_ldr{C|T|R|L}_…
+// - Page 10: *leaders* — WORK only. Per-box: ?p10_ldr{C|T|R|L}_…
+// - Page 11: Tips & Actions. Use p11_* (set *_size=0 to hide headers).
+// - Optional Page 12 footer/name slot: tune with n12x=…&n12y=…&n12w=…&n12s=…&n12align=…
@@
   footer: (() => {
     const one = { x: 205, y: 49.5, w: 400, size: 15, align: "center" };
     return {
       n2:{...one}, n3:{...one}, n4:{...one}, n5:{...one}, n6:{...one},
-      n7:{...one}, n8:{...one}, n9:{...one},
-      // n10 has a sensible default but is tunable via URL
-      n10: { x: 250, y: 64, w: 400, size: 12, align: "center" }
+      n7:{...one}, n8:{...one}, n9:{...one},
+      // p10..p12 have explicit small name slots
+      n10: { x: 250, y: 64, w: 400, size: 12, align: "center" },
+      n11: { x: 250, y: 64, w: 400, size: 12, align: "center" },
+      n12: { x: 250, y: 64, w: 400, size: 12, align: "center" }
     };
   })()
 };
@@
-    // PAGE 3 — text + state highlight (hard-locked defaults, tunable via URL)
+    // PAGE 3 — text + state highlight (hard-locked defaults, tunable via URL)
     p3: {
-      domChar: { x:  60, y: 170, w: 650, size: 11, align: "left"  },
-      domDesc: { x:  60, y: 200, w: 650, size: 11, align: "left"  },
+      // Locked to your tuner values
+      domChar: { x: 495, y: 640, w: 630, size: 25, align: "left"  },
+      domDesc: { x:  50, y: 700, w: 630, size: 18, align: "left"  },
@@
-    // PAGE 4
-    p4: {
-      spider: { x:  60, y: 320, w: 280, size: 11, align: "left" },
-      chart:  { x: 360, y: 320, w: 260, h: 260 }
-    },
+    // PAGE 4
+    p4: {
+      spider: { x:  30, y: 610, w: 670, size: 16, align: "left" },
+      chart:  { x:  20, y: 225, w: 570, h: 280 }
+    },
@@
-    // PAGE 5
-    p5: { seqpat: { x:  60, y: 160, w: 650, size: 11, align: "left" } },
+    // PAGE 5
+    p5: { seqpat: { x:  30, y: 270, w: 650, size: 16, align: "left" } },
@@
-    // PAGE 6
-    p6: { theme:  { x:  60, y: 160, w: 650, size: 11, align: "left" } },
+    // PAGE 6
+    p6: { theme:  { x:  30, y: 170, w: 630, size: 16, align: "left" } },
@@
-    // PAGE 7 — colleagues only (4 boxes)
+    // PAGE 7 — colleagues (LOOK only)
     p7: {
-      hCol: { x:  60, y: 110, w: 650, size: 0,  align: "left" }, // hidden by default; show if you want
-      // colleague boxes
-      colBoxes: [
-        { x:  60, y: 140, w: 300, h: 120 },  // C
-        { x: 410, y: 140, w: 300, h: 120 },  // T
-        { x:  60, y: 270, w: 300, h: 120 },  // R
-        { x: 410, y: 270, w: 300, h: 120 }   // L
-      ],
-      bodySize: 10,
-      maxLines: 9
+      hCol: { x:  60, y: 110, w: 650, size: 0, align: "left" },
+      colBoxes: [
+        { x:  25, y: 265, w: 300, h: 210 },  // C
+        { x: 320, y: 265, w: 300, h: 210 },  // T
+        { x:  25, y: 525, w: 300, h: 210 },  // R
+        { x: 320, y: 525, w: 300, h: 210 }   // L
+      ],
+      bodySize: 10,
+      maxLines: 25
     },
 
-    // PAGE 8 — leaders moved here (4 boxes)
-    p8: {
-      hLdr: { x:  60, y: 100, w: 650, size: 0, align: "left" }, // hidden by default
-      ldrBoxes: [
-        { x:  60, y: 125, w: 300, h: 120 },  // C
-        { x: 410, y: 125, w: 300, h: 120 },  // T
-        { x:  60, y: 255, w: 300, h: 120 },  // R
-        { x: 410, y: 255, w: 300, h: 120 }   // L
-      ],
-      bodySize: 10,
-      maxLines: 9
-    },
-
-    // PAGE 9 — Tips & Actions (moved from p8)
-    p9: {
-      tipsHdr: { x:  60, y: 120, w: 320, size: 12, align: "left" },
-      actsHdr: { x: 390, y: 120, w: 320, size: 12, align: "left" },
-      tipsBox: { x:  60, y: 150, w: 320, size: 11, align: "left" },
-      actsBox: { x: 390, y: 150, w: 320, size: 11, align: "left" }
-    }
+    // PAGE 8 — colleagues (WORK only)
+    p8: {
+      hCol: { x: 60, y: 100, w: 650, size: 0, align: "left" },
+      colBoxes: [
+        { x:  25, y: 265, w: 300, h: 210 },  // C
+        { x: 320, y: 265, w: 300, h: 210 },  // T
+        { x:  25, y: 525, w: 300, h: 210 },  // R
+        { x: 320, y: 525, w: 300, h: 210 }   // L
+      ],
+      bodySize: 10,
+      maxLines: 25
+    },
+
+    // PAGE 9 — leaders (LOOK only; your small 95px boxes)
+    p9: {
+      hLdr: { x: 30, y: 115, w: 640, size: 0, align: "left" },
+      ldrBoxes: [
+        { x:  25, y: 265, w: 300, h: 95,  size: 16, maxLines: 18 },  // C
+        { x: 320, y: 265, w: 300, h: 95,  size: 16, maxLines: 18 },  // T
+        { x:  25, y: 525, w: 300, h: 95,  size: 16, maxLines: 18 },  // R
+        { x: 320, y: 525, w: 300, h: 95,  size: 16, maxLines: 18 }   // L
+      ],
+      bodySize: 16,
+      maxLines: 18
+    },
+
+    // PAGE 10 — leaders (WORK only; your taller 210px boxes)
+    p10: {
+      hLdr: { x: 30, y: 115, w: 640, size: 0, align: "left" },
+      ldrBoxes: [
+        { x:  25, y: 265, w: 300, h: 210, size: 10, maxLines: 25 },  // C
+        { x: 320, y: 265, w: 300, h: 210, size: 10, maxLines: 25 },  // T
+        { x:  25, y: 525, w: 300, h: 210, size: 10, maxLines: 25 },  // R
+        { x: 320, y: 525, w: 300, h: 210, size: 10, maxLines: 25 }   // L
+      ],
+      bodySize: 10,
+      maxLines: 25
+    },
+
+    // PAGE 11 — Tips & Actions (moved from old p9)
+    p11: {
+      tipsHdr: { x:  70, y: 122, w: 320, size: 12, align: "left" },
+      actsHdr: { x: 400, y: 122, w: 320, size: 12, align: "left" },
+      tipsBox: { x:  70, y: 155, w: 315, size: 11, align: "left" },
+      actsBox: { x: 400, y: 155, w: 315, size: 11, align: "left" }
+    }
   };
@@
-  // Page 7 — colleagues (globals + per-box s/max)
+  // Page 7 — colleagues (LOOK only) tuners
   setBox(L.p7?.hCol, "p7_hCol");
@@
   ["C","T","R","L"].forEach((k, i) => setBoxPlus(L.p7?.colBoxes?.[i], `p7_col${k}`, true));
 
-  // Page 8 — leaders (globals + per-box s/max; primary: p8_*, fallback: p7_*)
-  setBox(L.p8?.hLdr, "p8_hLdr");
-  if (q.p8_bodySize != null)  L.p8.bodySize = +q.p8_bodySize;
-  if (q.p8_s        != null)  L.p8.bodySize = +q.p8_s;          // alias
-  if (q.p8_maxLines != null)  L.p8.maxLines = +q.p8_maxLines;
-
-  const applyLeaderBox = (idx, key) => {
-    const b = L.p8?.ldrBoxes?.[idx];
+  // Page 8 — colleagues (WORK only) tuners (primary: p8_col*, fallback: p7_col*)
+  setBox(L.p8?.hCol, "p8_hCol");
+  if (q.p8_bodySize != null)  L.p8.bodySize = +q.p8_bodySize;
+  if (q.p8_s        != null)  L.p8.bodySize = +q.p8_s;
+  if (q.p8_maxLines != null)  L.p8.maxLines = +q.p8_maxLines;
+  ["C","T","R","L"].forEach((k, i) => {
+    const b = L.p8?.colBoxes?.[i];
+    const hasP8 = ["x","y","w","h","size","s","align","max"].some(s => q[`p8_col${k}_${s}`] != null);
+    setBoxPlus(b, `p8_col${k}`, true);
+    if (!hasP8) setBoxPlus(b, `p7_col${k}`, true);
+  });
+
+  // Page 9 — leaders (LOOK only) tuners
+  setBox(L.p9?.hLdr, "p9_hLdr");
+  if (q.p9_bodySize != null)  L.p9.bodySize = +q.p9_bodySize;
+  if (q.p9_s        != null)  L.p9.bodySize = +q.p9_s;
+  if (q.p9_maxLines != null)  L.p9.maxLines = +q.p9_maxLines;
+  ["C","T","R","L"].forEach((k, i) => setBoxPlus(L.p9?.ldrBoxes?.[i], `p9_ldr${k}`, true));
+
+  // Page 10 — leaders (WORK only) tuners (primary: p10_*, fallback: p8_ldr* legacy)
+  setBox(L.p10?.hLdr, "p10_hLdr");
+  if (q.p10_bodySize != null)  L.p10.bodySize = +q.p10_bodySize;
+  if (q.p10_s        != null)  L.p10.bodySize = +q.p10_s;
+  if (q.p10_maxLines != null)  L.p10.maxLines = +q.p10_maxLines;
+  ["C","T","R","L"].forEach((k, i) => {
+    const b = L.p10?.ldrBoxes?.[i];
+    const hasP10 = ["x","y","w","h","size","s","align","max"].some(s => q[`p10_ldr${k}_${s}`] != null);
+    setBoxPlus(b, `p10_ldr${k}`, true);
+    if (!hasP10) setBoxPlus(b, `p8_ldr${k}`, true); // legacy fallback
+  });
 
-  ["C","T","R","L"].forEach((k, i) => applyLeaderBox(i, k));
-
-  // Page 9 — tips/actions (moved)
-  L.p9 = L.p9 || {};
-  setBox(L.p9?.tipsHdr, "p9_tipsHdr");
-  setBox(L.p9?.actsHdr, "p9_actsHdr");
-  setBox(L.p9?.tipsBox, "p9_tipsBox");
-  setBox(L.p9?.actsBox, "p9_actsBox");
+  // Page 11 — tips/actions
+  L.p11 = L.p11 || {};
+  setBox(L.p11?.tipsHdr, "p11_tipsHdr");
+  setBox(L.p11?.actsHdr, "p11_actsHdr");
+  setBox(L.p11?.tipsBox, "p11_tipsBox");
+  setBox(L.p11?.actsBox, "p11_actsBox");
 
   // Page 10 footer/name slot (optional page)
   L.footer = L.footer || {};
   L.footer.n10 = L.footer.n10 || { x: 250, y: 64, w: 400, size: 12, align: "center" };
   if (q.n10x != null) L.footer.n10.x = +q.n10x;
   if (q.n10y != null) L.footer.n10.y = +q.n10y;
   if (q.n10w != null) L.footer.n10.w = +q.n10w;
   if (q.n10s != null) L.footer.n10.size = +q.n10s;
   if (q.n10align)     L.footer.n10.align = String(q.n10align);
+  // Page 11/12 footer slots
+  L.footer.n11 = L.footer.n11 || { x: 250, y: 64, w: 400, size: 12, align: "center" };
+  if (q.n11x != null) L.footer.n11.x = +q.n11x;
+  if (q.n11y != null) L.footer.n11.y = +q.n11y;
+  if (q.n11w != null) L.footer.n11.w = +q.n11w;
+  if (q.n11s != null) L.footer.n11.size = +q.n11s;
+  if (q.n11align)     L.footer.n11.align = String(q.n11align);
+  L.footer.n12 = L.footer.n12 || { x: 250, y: 64, w: 400, size: 12, align: "center" };
+  if (q.n12x != null) L.footer.n12.x = +q.n12x;
+  if (q.n12y != null) L.footer.n12.y = +q.n12y;
+  if (q.n12w != null) L.footer.n12.w = +q.n12w;
+  if (q.n12s != null) L.footer.n12.size = +q.n12s;
+  if (q.n12align)     L.footer.n12.align = String(q.n12align);
 
   return L;
 }
@@
-    const p = (i) => (i < pageCount ? pdf.getPage(i) : null);
-    const p1 = p(0), p2 = p(1), p3 = p(2), p4 = p(3), p5 = p(4),
-          p6 = p(5), p7 = p(6), p8 = p(7), p9 = p(8), p10 = p(9);
+    const p = (i) => (i < pageCount ? pdf.getPage(i) : null);
+    const p1 = p(0),  p2 = p(1),  p3 = p(2),  p4 = p(3),  p5 = p(4),
+          p6 = p(5),  p7 = p(6),  p8 = p(7),  p9 = p(8),  p10 = p(9),
+          p11 = p(10), p12 = p(11);
@@
-    /* ---------------------------- PAGE 7 (Colleagues only) ---------------------------- */
+    /* ---------------------------- PAGE 7 (Colleagues — LOOK only) ---------------------------- */
     if (p7) {
       drawTextBox(p7, Helv, P.n, { ...(L.footer.n7||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
-      // Optional header (hidden by default via size:0)
-      drawTextBox(p7, HelvB, "", { ...L.p7.hCol, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
+      drawTextBox(p7, HelvB, "", { ...L.p7.hCol, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 }); // hidden by default
 
       const order = ["C","T","R","L"];
-      const mk = (e) => {
-        const look = norm(e?.look || "");
-        const work = norm(e?.work || "");
-        // Titles removed — just join bodies
-        return [look, work].filter(Boolean).join("\n\n");
-      };
+      const mkLook = (e) => norm(e?.look || "");
 
       order.forEach((k, i) => {
         const entry = (P.workwcol || []).find(v => v?.their === k);
         const box  = L.p7.colBoxes[i] || L.p7.colBoxes[0];
-        const txt  = mk(entry);
+        const txt  = mkLook(entry);
         if (txt && box?.w > 0) {
           drawTextBox(p7, Helv, txt,
@@
-    /* ---------------------------- PAGE 8 (Leaders moved here) ---------------------------- */
+    /* ---------------------------- PAGE 8 (Colleagues — WORK only) ---------------------------- */
     if (p8) {
-      drawTextBox(p8, Helv, P.n, { ...(L.footer.n8||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
-      // Optional header (hidden by default via size:0)
-      drawTextBox(p8, HelvB, "", { ...L.p8.hLdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
+      drawTextBox(p8, Helv, P.n, { ...(L.footer.n8||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
+      drawTextBox(p8, HelvB, "", { ...L.p8.hCol, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 }); // hidden by default
 
       const order = ["C","T","R","L"];
-      const mk = (e) => {
-        const look = norm(e?.look || "");
-        const work = norm(e?.work || "");
-        return [look, work].filter(Boolean).join("\n\n");
-      };
+      const mkWork = (e) => norm(e?.work || "");
 
       order.forEach((k, i) => {
-        const entry = (P.workwlead || []).find(v => v?.their === k);
-        const box  = L.p8.ldrBoxes[i] || L.p8.ldrBoxes[0];
-        const txt  = mk(entry);
+        const entry = (P.workwcol || []).find(v => v?.their === k);
+        const box  = L.p8.colBoxes[i] || L.p8.colBoxes[0];
+        const txt  = mkWork(entry);
         if (txt && box?.w > 0) {
           drawTextBox(p8, Helv, txt,
@@
-    /* ---------------------------- PAGE 9 (Tips & Actions) ---------------------------- */
+    /* ---------------------------- PAGE 9 (Leaders — LOOK only) ---------------------------- */
     if (p9) {
-      drawTextBox(p9, Helv, P.n, { ...(L.footer.n9||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
-
-      // Headers (set size=0 to hide)
-      drawTextBox(p9, HelvB, "Tips",    { ...L.p9.tipsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
-      drawTextBox(p9, HelvB, "Actions", { ...L.p9.actsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
-
-      // Bullets
-      drawBulleted(p9, Helv, ensureArray(P.tips),
-        { ...L.p9.tipsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 },
-        { maxLines: 26, blockGap: 6 });
-
-      drawBulleted(p9, Helv, ensureArray(P.actions),
-        { ...L.p9.actsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 },
-        { maxLines: 26, blockGap: 6 });
+      drawTextBox(p9, Helv, P.n, { ...(L.footer.n9||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
+      const order = ["C","T","R","L"];
+      const mkLook = (e) => norm(e?.look || "");
+      order.forEach((k, i) => {
+        const entry = (P.workwlead || []).find(v => v?.their === k);
+        const box  = L.p9.ldrBoxes[i] || L.p9.ldrBoxes[0];
+        const txt  = mkLook(entry);
+        if (txt && box?.w > 0) {
+          drawTextBox(p9, Helv, txt,
+            { x: box.x, y: box.y, w: box.w, size: (box.size ?? L.p9.bodySize), align: box.align || "left", color: rgb(0.15,0.14,0.22) },
+            { maxLines: (box.maxLines ?? L.p9.maxLines), ellipsis: true }
+          );
+        }
+      });
     }
 
-    /* ---------------------------- PAGE 10 (optional footer/name) ---------------------------- */
-    if (p10 && L.footer?.n10) {
-      drawTextBox(p10, Helv, P.n, { ...L.footer.n10, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
-    }
+    /* ---------------------------- PAGE 10 (Leaders — WORK only) ---------------------------- */
+    if (p10) {
+      drawTextBox(p10, Helv, P.n, { ...(L.footer.n10||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
+      const order = ["C","T","R","L"];
+      const mkWork = (e) => norm(e?.work || "");
+      order.forEach((k, i) => {
+        const entry = (P.workwlead || []).find(v => v?.their === k);
+        const box  = L.p10.ldrBoxes[i] || L.p10.ldrBoxes[0];
+        const txt  = mkWork(entry);
+        if (txt && box?.w > 0) {
+          drawTextBox(p10, Helv, txt,
+            { x: box.x, y: box.y, w: box.w, size: (box.size ?? L.p10.bodySize), align: box.align || "left", color: rgb(0.15,0.14,0.22) },
+            { maxLines: (box.maxLines ?? L.p10.maxLines), ellipsis: true }
+          );
+        }
+      });
+    }
+
+    /* ---------------------------- PAGE 11 (Tips & Actions) ---------------------------- */
+    if (p11) {
+      drawTextBox(p11, Helv, P.n, { ...(L.footer.n11||{}), color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
+      // Headers (set size=0 to hide)
+      drawTextBox(p11, HelvB, "Tips",    { ...L.p11.tipsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
+      drawTextBox(p11, HelvB, "Actions", { ...L.p11.actsHdr, color: rgb(0.24,0.23,0.35) }, { maxLines: 1 });
+      // Bullets
+      drawBulleted(p11, Helv, ensureArray(P.tips),
+        { ...L.p11.tipsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 },
+        { maxLines: 26, blockGap: 6 });
+      drawBulleted(p11, Helv, ensureArray(P.actions),
+        { ...L.p11.actsBox, color: rgb(0.15,0.14,0.22), indent: 14, gap: 2, bulletRadius: 1.8 },
+        { maxLines: 26, blockGap: 6 });
+    }
+
+    /* ---------------------------- PAGE 12 (optional footer/name) ---------------------------- */
+    if (p12 && L.footer?.n12) {
+      drawTextBox(p12, Helv, P.n, { ...L.footer.n12, color: rgb(0.24,0.23,0.35) }, { maxLines: 1, ellipsis: true });
+    }

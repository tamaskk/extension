// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: paper-plane;

// ─── GridLeads Queue Widget ─────────────────────────────────────
// Today's sending, per sender account, on the iOS home screen.
// Runs in the Scriptable app; it is not part of the web app's build.
// Sizes: small, medium, large + Lock Screen (rectangular, inline, circular).
// API: GET /api/widget/queues

const CONFIG = {
  apiUrl: "https://gridleads-wheat.vercel.app/api/widget/queues",
  appUrl: "https://gridleads-wheat.vercel.app",
  refreshMinutes: 5,      // a request to iOS; the system may refresh less often
  previewSize: "medium",  // shown when run inside the app: small | medium | large
};

// The dashboard's dark tokens (apps/web/app/globals.css, first :root block).
const THEME = {
  bg: "#0b0d12",
  bgEnd: "#0b0d12",
  text: "#e6e8ee",
  muted: "#8b90a0",
  accent: "#6366f1",
  track: "#232838",
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#f43f5e",
};

// Progress bar widths (pt). Adjust here if they are too short or long on your iPhone.
const BAR_WIDTH = { small: 128, medium: 296, large: 296 };
const MAX_ROWS = { medium: 3, large: 5 };

const STATUS = {
  error:   { label: "blocked", color: "error",   order: 0 },
  running: { label: "sending", color: "accent",  order: 1 },
  paused:  { label: "waiting", color: "warning", order: 2 },
  idle:    { label: "idle",    color: "muted",   order: 3 },
  done:    { label: "done",    color: "success", order: 4 },
};

// ─── Main ───────────────────────────────────────────────────────

const family = config.runsInWidget ? config.widgetFamily : CONFIG.previewSize;
const result = await fetchData();
const widget = buildWidget(family, result);
widget.url = CONFIG.appUrl;
widget.refreshAfterDate = new Date(Date.now() + CONFIG.refreshMinutes * 60 * 1000);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else if (family === "small") {
  await widget.presentSmall();
} else if (family === "large") {
  await widget.presentLarge();
} else {
  await widget.presentMedium();
}
Script.complete();

// ─── Data ───────────────────────────────────────────────────────

async function fetchData() {
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.documentsDirectory(), "gridleads-widget-cache.json");

  try {
    const req = new Request(CONFIG.apiUrl);
    req.timeoutInterval = 10;
    const data = await req.loadJSON();
    const code = req.response.statusCode;
    if (code !== 200) throw new Error(`HTTP ${code}`);
    if (!data || !Array.isArray(data.queues)) throw new Error("Unexpected answer");
    fm.writeString(cachePath, JSON.stringify(data));
    return { data, stale: false, error: null };
  } catch (e) {
    if (fm.fileExists(cachePath)) {
      const cached = JSON.parse(fm.readString(cachePath));
      // yesterday's cache is not shown as today's state
      if (cached.date === todayBudapest()) return { data: cached, stale: true, error: String(e) };
    }
    return { data: null, stale: true, error: String(e.message || e) };
  }
}

// ─── Builders ───────────────────────────────────────────────────

function buildWidget(family, { data, stale, error }) {
  if (family === "accessoryRectangular") return buildRectangular(data);
  if (family === "accessoryInline") return buildInline(data);
  if (family === "accessoryCircular") return buildCircular(data);

  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [new Color(THEME.bg), new Color(THEME.bgEnd)];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);

  const queues = data ? sortQueues(data.queues) : [];
  const maxRows = MAX_ROWS[family] || 0;
  const extra = family === "small" ? 0 : Math.max(0, queues.length - maxRows);

  addHeader(w, data, stale, extra);
  w.addSpacer(family === "small" ? 8 : 10);

  if (!data) {
    addError(w, error);
  } else if (family === "small") {
    buildSmall(w, data);
  } else {
    buildList(w, data, queues, family);
  }

  w.addSpacer();
  return w;
}

function addHeader(w, data, stale, extra) {
  const h = w.addStack();
  h.centerAlignContent();

  const title = h.addText("GRIDLEADS");
  title.font = Font.heavySystemFont(11);
  title.textColor = new Color(THEME.accent);

  h.addSpacer();

  const parts = [];
  if (extra > 0) parts.push(`+${extra} more`);
  if (stale && data) parts.push("offline");
  if (data) parts.push(hm(data.generatedAt));

  const right = h.addText(parts.join(" · "));
  right.font = Font.mediumSystemFont(10);
  right.textColor = new Color(stale ? THEME.warning : THEME.muted);
  right.lineLimit = 1;
}

function buildSmall(w, data) {
  const t = data.totals;

  const big = w.addStack();
  big.bottomAlignContent();
  const n = big.addText(String(t.done));
  n.font = Font.boldSystemFont(34);
  n.textColor = new Color(THEME.text);
  n.minimumScaleFactor = 0.6;
  big.addSpacer(4);
  const of = big.addText(`/ ${t.total}`);
  of.font = Font.semiboldSystemFont(14);
  of.textColor = new Color(THEME.muted);

  const label = w.addText("sent today");
  label.font = Font.mediumSystemFont(11);
  label.textColor = new Color(THEME.muted);

  w.addSpacer(10);
  addBar(w, t, BAR_WIDTH.small, 8);
  w.addSpacer(8);

  const s = summaryLine(data);
  const line = w.addText(s.text);
  line.font = Font.semiboldSystemFont(11);
  line.textColor = new Color(s.color);
  line.lineLimit = 1;
}

function buildList(w, data, queues, family) {
  if (queues.length === 0) {
    const e = w.addText("Nothing to send today yet");
    e.font = Font.mediumSystemFont(13);
    e.textColor = new Color(THEME.muted);
    return;
  }

  const large = family === "large";
  if (large) {
    addTotalsRow(w, data);
    w.addSpacer(12);
  }

  queues.slice(0, MAX_ROWS[family]).forEach((q, i) => {
    if (i > 0) w.addSpacer(large ? 9 : 8);
    addQueueRow(w, q, BAR_WIDTH[family], large);
  });
}

function addTotalsRow(w, data) {
  const t = data.totals;
  const row = w.addStack();
  row.bottomAlignContent();

  const n = row.addText(String(t.done));
  n.font = Font.boldSystemFont(28);
  n.textColor = new Color(THEME.text);
  row.addSpacer(5);

  const of = row.addText(`/ ${t.total} sent today`);
  of.font = Font.semiboldSystemFont(13);
  of.textColor = new Color(THEME.muted);

  row.addSpacer();

  const s = summaryLine(data);
  const st = row.addText(s.text);
  st.font = Font.semiboldSystemFont(11);
  st.textColor = new Color(s.color);
  st.lineLimit = 1;

  w.addSpacer(6);
  addBar(w, t, BAR_WIDTH.large, 8);
}

function addQueueRow(w, q, barWidth, detailed) {
  const s = statusInfo(q.status);

  const top = w.addStack();
  top.centerAlignContent();

  const dot = top.addText("●");
  dot.font = Font.systemFont(9);
  dot.textColor = new Color(s.color);
  top.addSpacer(6);

  const name = top.addText(q.name);
  name.font = Font.semiboldSystemFont(13);
  name.textColor = new Color(THEME.text);
  name.lineLimit = 1;

  top.addSpacer();

  if (q.failed > 0) {
    const f = top.addText(`${q.failed}✕`);
    f.font = Font.semiboldMonospacedSystemFont(11);
    f.textColor = new Color(THEME.error);
    top.addSpacer(6);
  }

  const c = top.addText(`${q.done}/${q.total}`);
  c.font = Font.semiboldMonospacedSystemFont(12);
  c.textColor = new Color(q.status === "done" ? THEME.success : THEME.text);

  w.addSpacer(4);
  addBar(w, q, barWidth, 5);

  if (detailed) {
    w.addSpacer(3);
    const sub = w.addText(subtitle(q));
    sub.font = Font.mediumSystemFont(10);
    sub.textColor = new Color(THEME.muted);
    sub.lineLimit = 1;
  }
}

function addError(w, error) {
  const t = w.addText("GridLeads cannot be reached");
  t.font = Font.semiboldSystemFont(13);
  t.textColor = new Color(THEME.text);
  w.addSpacer(4);
  const d = w.addText(error || "Unknown error");
  d.font = Font.mediumSystemFont(10);
  d.textColor = new Color(THEME.error);
  d.lineLimit = 3;
}

// ─── Lock Screen ────────────────────────────────────────────────

function buildRectangular(data) {
  const w = new ListWidget();
  const title = w.addText("GridLeads");
  title.font = Font.boldSystemFont(13);

  if (!data) {
    const e = w.addText("no data");
    e.font = Font.systemFont(12);
    return w;
  }

  const t = data.totals;
  const l1 = w.addText(`${t.done}/${t.total} sent today`);
  l1.font = Font.semiboldSystemFont(13);
  const l2 = w.addText(summaryLine(data).text);
  l2.font = Font.systemFont(12);
  l2.textOpacity = 0.75;
  return w;
}

function buildInline(data) {
  const w = new ListWidget();
  w.addText(data ? `GridLeads ${data.totals.done}/${data.totals.total}` : "GridLeads –");
  return w;
}

function buildCircular(data) {
  const w = new ListWidget();
  w.addAccessoryWidgetBackground = true;
  const t = w.addText(data ? String(data.totals.done) : "–");
  t.font = Font.boldSystemFont(16);
  t.centerAlignText();
  return w;
}

// ─── Helpers ────────────────────────────────────────────────────

function addBar(parent, item, width, height) {
  const total = Math.max(item.total || 0, 1);
  const finished = item.total > 0 && (item.pending || 0) + (item.inProgress || 0) === 0;
  const doneColor = finished ? THEME.success : THEME.accent;

  const img = progressBar(width, height, [
    { value: (item.done || 0) / total, color: doneColor },
    { value: (item.failed || 0) / total, color: THEME.error },
  ]);
  const i = parent.addImage(img);
  i.imageSize = new Size(width, height);
}

function progressBar(width, height, segments) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const r = height / 2;

  const track = new Path();
  track.addRoundedRect(new Rect(0, 0, width, height), r, r);
  ctx.addPath(track);
  ctx.setFillColor(new Color(THEME.track));
  ctx.fillPath();

  let x = 0;
  for (const s of segments) {
    const w = Math.min(width - x, width * s.value);
    if (w <= 0) continue;
    const p = new Path();
    p.addRoundedRect(new Rect(x, 0, Math.max(w, height), height), r, r);
    ctx.addPath(p);
    ctx.setFillColor(new Color(s.color));
    ctx.fillPath();
    x += w;
  }
  return ctx.getImage();
}

function summaryLine(data) {
  const qs = data.queues;
  const t = data.totals;
  if (qs.length === 0 || t.total === 0) return { text: "nothing today yet", color: THEME.muted };

  const running = qs.filter(q => q.status === "running").length;
  const errors = qs.filter(q => q.status === "error").length;

  if (t.pending + t.inProgress === 0 && errors === 0) {
    return { text: "all sent ✓", color: THEME.success };
  }

  const parts = [];
  if (running) parts.push(`${running} sending`);
  if (errors) parts.push(`${errors} blocked`);
  if (t.pending) parts.push(`${t.pending} to go`);
  return { text: parts.join(" · "), color: errors ? THEME.error : THEME.muted };
}

function subtitle(q) {
  const parts = [];
  if (q.status === "done" && q.completedAt) {
    parts.push(`done ${hm(q.completedAt)}`);
  } else {
    parts.push(statusInfo(q.status).label);
    if (q.pending) parts.push(`${q.pending} to go`);
    if (q.nextRunAt) parts.push(`next ${hm(q.nextRunAt)}`);
  }
  if (q.quota) parts.push(`limit ${q.quota.used}/${q.quota.limit}`);
  return parts.join(" · ");
}

function statusInfo(status) {
  const s = STATUS[status] || STATUS.idle;
  return { label: s.label, color: THEME[s.color], order: s.order };
}

function sortQueues(queues) {
  return [...(queues || [])].sort((a, b) => statusInfo(a.status).order - statusInfo(b.status).order);
}

function hm(iso) {
  if (!iso) return "";
  const df = new DateFormatter();
  df.dateFormat = "HH:mm";
  return df.string(new Date(iso));
}

function todayBudapest() {
  const df = new DateFormatter();
  df.dateFormat = "yyyy-MM-dd";
  return df.string(new Date()); // the phone's time zone; in Budapest this is the same day
}

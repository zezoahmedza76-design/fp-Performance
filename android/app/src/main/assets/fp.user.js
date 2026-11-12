// ==UserScript==
// @name         Breadfast Control Room – Control Room Brain (FP · Lead · Coordinator)
// @namespace    https://www.breadfast.com/
// @version      2.3.0
// @description  One dashboard for the whole FP: the FP Brain, the Lead Brain (pickers) and the Control Room Brain (DAs) merged, with a role switcher, an FP Score card (P90 40% · ETA late % 40% · Available status 20%) and a new animated design. Arabic or English. Read-only: it never changes any setting.
// @match        https://www.breadfast.com/dashboard/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      cartocdn.com
// @connect      arcgisonline.com
// @connect      openstreetmap.org
// @connect      openstreetmap.fr
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------------
   * DEFAULT SETTINGS – change them from the brain's Settings page (⚙), saved in this browser
   * ------------------------------------------------------------------ */
  const CFG = {
    SHIFTS: [
      { name: 'Night', from: 0, to: 7 },
      { name: 'Morning', from: 7, to: 15 },
      { name: 'Between', from: 15, to: 24 },
    ],
    // Scorecard targets
    P90_TARGET_MIN: 50,       // P90 incl. forced and P90 NOW (minutes, placed to delivered)
    LATE_TARGET_PCT: 8,       // ETA late % (NOW orders delivered after their ETA ÷ NOW orders delivered, as the official scorecard)
    PPH_OPS_TARGET: 11,       // PPH (Ops): orders ÷ picker active hours (the DM's number, as Tableau)
    DPH_OPS_TARGET: 3.3,      // DPH (Ops): orders ÷ DA active hours (the DM's number, as Tableau)
    PPH_TARGET: 11,           // PPH: hour-by-hour orders per counted picker
    DPH_TARGET: 3.3,          // DPH: hour-by-hour orders per counted DA
    // Every PPH / DPH number puts an order in the clock hour its work started (picker started picking, DA picked it up).
    // PPH / DPH are worked out hour by hour: only pickers who started this many orders (DAs who picked up this many) in the
    // hour count for that hour; the day's value is the average of the hours that have one.
    PPH_MIN_PICKS: 5,
    DPH_MIN_DELIVERIES: 2,
    // Capacity page: each person's own speed = their average in busy hours (the thresholds above) over today and the
    // last CAP_RATE_DAYS saved days. Someone with no busy hour yet counts at these speeds.
    CAP_NEW_PICKER_PPH: 8,
    CAP_NEW_DA_DPH: 2,
    CAP_RATE_DAYS: 14,
    // Pickers / DAs on the ground in an hour (Capacity, Root causes, Scorecard): there at least this many minutes of it
    ON_GROUND_MIN: 15,
    AUTO_ASSIGN_TARGET: 98,   // % of orders not manually assigned
    // FP Score (v2.0): weighted P90 / ETA late % / Available status, each 100 at its target and 0 at its zero point
    SCORE_W: { p90: 40, eta: 40, avail: 20 },
    SCORE_P90_ZERO: 70,       // P90 (min) that scores 0 (100 at P90_TARGET_MIN)
    SCORE_ETA_ZERO: 20,       // ETA late % that scores 0 (100 at LATE_TARGET_PCT)
    AVAIL_TARGET_PCT: 95,     // FP AVAILABLE this share of the recorded time = 100
    SCORE_AVAIL_ZERO: 60,     // Available status % that scores 0
    SCORE_P90_NOW: false,     // score P90 NOW instead of P90 incl. forced
    AUTO_REFRESH_MIN: 2,      // live: reload today's orders this often while the brain is open (0 = off)
    COMPLAINT_TARGET_PCT: 0,   // 0 = no target set
    TAG_MIN_ORDERS: 30,   // Order tags: fewer delivered orders than this = too few to judge (greyed)
    CMP_GAP_MS: 120,   // pause between complaint lookups, per lane (3 lanes)
    // Where "close to target" ends and "missed" begins (amber band)
    WARN: { p90: 60, eta: 10, ppho: 9.5, dpho: 2.9, pph: 9.5, dph: 2.9, auto: 95 },
    // Forced orders: scheduled express is always forced; otherwise the DCM slot / FP status recorded when the order was placed
    // decides. When nothing was recorded then, a scheduled order placed less than this many hours before its slot counts as forced.
    PLANNED_AHEAD_HOURS: 3,
    // Late-cause split: "packed too late" = packed with less time left than the DA needs to reach the customer.
    // 'area' = the usual direct ride to that order's sub-area that day (first drop of a trip, pickup → delivered).
    HANDOFF_MODE: 'area',     // 'area' or 'fixed'
    HANDOFF_MIN: 15,          // fixed minutes (used in 'fixed' mode, or when a sub-area has too few rides)
    HANDOFF_MIN_ORDERS: 5,    // rides a sub-area needs that day before its own time is used (else the FP-wide usual ride)
    HANDOFF_BUFFER_MIN: 5,    // pickup allowance on top of the ride (v1.25: 5 = SOP shelf wait when a DA is at the FP; was 0)
    INCLUDE_SUBORDERS: false, // count sub-orders as orders everywhere: order counts, lateness and P90 (as some central dashboards do)
    LARGE_BASKET_SKUS: 10,   // v1.25: 10 (was 15). Also the size where "Large basket" can become a late reason
    BASKET_HIST_DAYS: 28,   // Basket size page: expected picking time per size group from this many saved days
    PICK_GAP_MAX_MIN: 20,
    // Pickers
    WAIT_TARGET_MIN: 5,       // an order shouldn't wait longer than this for a picker
    HANDLE_TARGET_MIN: 6,     // target picking time per order (start to packed)
    SCHED_READY_MIN: 60,      // scheduled orders count as "ready to pick" this many minutes before their slot
    LONG_HANDLING_MIN: 20,
    LONG_MIN_PER_SKU: 3,
    IDLE_GAP_MIN: 15,
    RANK_WEIGHTS: { skusPerHour: 0.4, minPerSku: 0.3, storeLate: 0.2, attendance: 0.1 },
    // DAs
    PEAKS: [[12, 15], [19, 23]],
    GAP_MIN: 45,
    BREAK_ALERT_MIN: 30,
    HISTORY_CONCURRENCY: 4,
    // Live
    POLL_MIN: 2,              // DA list and picker queue are recorded this often (minutes)
    LIVE_POLL_MIN: 5,         // capacity (DCM) and auto-assign status
    FP_STATUS_POLL_MIN: 5,    // FP open / busy status (decides forced orders while recorded)
    ALERT_QUEUE: 5,           // alert when this many orders wait for a picker
    ALERT_SHELF_MIN: 10,      // alert when a packed order waits this long for a DA
    ALERT_RISK_MIN: 10,       // alert when an order not yet picked up is this close to its ETA
    KEEP_DAYS: 14,            // recordings older than this are deleted
    // Root causes page: when a check counts as a problem
    ROOT_DCM_TOL_PCT: 10,     // DCM sized right = within this % of what the pickers and DAs working that hour could handle
    ROOT_SLOWER_PCT: 20,      // picking this % slower than usual for those basket sizes = slow picking
    ROOT_RIDE_SLOW_MIN: 5,    // a first-drop ride this many minutes over the usual ride to that sub-area = slow ride
    ROOT_FORCED_PCT: 20,      // forced orders this share of a slot's orders (and 3+) = forced orders piled in
    ROOT_BURST_PCT: 40,       // this share of a slot's NOW orders placed within 15 minutes = a burst
    // Does this FP have a coffee bar / a pharmacy? Off = hidden on every page, and no late order is put on it.
    SHOW_COFFEE: true,
    SHOW_PHARMACY: true,
    // Coffee & pharmacy verdicts
    COFFEE_DELAY_MIN: 5,      // a late coffee order that sat this long beyond the picker's part counts as held up by the coffee
    PHARMACY_EXTRA_MIN: 8,    // pharmacy detour used when the day has too few pharmacy orders to measure it
    PHARMACY_SHARE: 0.75,     // a late pharmacy order counts as held up by the pharmacy if its extra time is at least this share of the usual detour
    PHARMACY_MIN_EXTRA: 3,    // ...and at least this many minutes
    CP_STRICT: true,          // blame coffee / pharmacy only when that delay alone explains the lateness
    // Rankings for bonuses (relative weights) and who counts
    // DA ranking: speed (first-drop ride vs the usual ride to that sub-area) leads, then attendance and availability
    DA_RANK_WEIGHTS: { speed: 0.3, attendance: 0.2, idle: 0.2, roadLate: 0.15, dph: 0.1, volume: 0.05 },
    DA_SHIFT_GRACE_MIN: 15,   // minutes before / after a DA's shift that still count (DA shifts)
    // Picker ranking: speed (seconds per SKU, adjusted for basket size) leads; PPH and order count are off by default
    // because they reward whoever got the small baskets or the busy hours.
    PK_RANK_WEIGHTS: { secPerSku: 0.5, slowLate: 0.2, idle: 0.15, attendance: 0.15, pph: 0, volume: 0 },
    PK_SHIFT_GRACE_MIN: 15,   // minutes before / after a picker's shift that still count (finishing an order, early start)
    RANK_MIN_DELIVERIES: { day: 3, period: 25 },
    RANK_MIN_ORDERS: { day: 5, period: 40 },
    RANK_MIN_HOURS: { day: 2, period: 12 },
    WEEK_START_DAY: 6,        // 6 = Saturday, 0 = Sunday
    KEEP_PERSON_DAYS: 120,    // per-DA and per-picker daily records older than this are dropped
    PAGE_SIZE: 100,
  };

  const API_HOST = 'picker.breadfast.com';
  const DCM_BASE = 'https://delivery-capacity.breadfast.com';
  const FLEET_BASE = 'https://fleet.breadfast.com';
  const WH_URL = 'https://www.breadfast.com/warehouses-service/warehouses/listWarehouses';
  const STORE_HISTORY = 'fpx:history:v1';
  const STORE_COORDS = 'fpa:fpcoords:';
  const STORE_DAREC = 'fpx:darec:v1:';
  const STORE_PKREC = 'fpx:pkrec:v1:';
  const STORE_DCM = 'fpx:dcm:v1:';
  const STORE_FPSTAT = 'fpx:fpstat:v1:';
  const STORE_AREAS = 'fpx:areas:v1:';
  const STORE_LOG = 'fpx:log:v1';
  const STORE_PREFS = 'fpx:prefs:v1';
  const MAX_HISTORY_KB = 1500;

  // v2.0 unified: first run copies what the three separate brains saved in this browser (fpb: FP, fpl: Lead, fpc: Coordinator) to fpx:
  (function nxMigrate() {
    try {
      if (localStorage.getItem('fpx:migrated:v1')) return;
      const BASE = ['fpb:', 'fpl:', 'fpc:'];
      const order = (rest) => (/^pkroster/.test(rest) ? ['fpl:', 'fpb:', 'fpc:'] : /^daroster/.test(rest) ? ['fpc:', 'fpb:', 'fpl:'] : BASE);
      const all = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i), m = /^(fp[blc]:)(.+)$/.exec(k || ''); if (m) (all[m[2]] = all[m[2]] || {})[m[1]] = k; }
      Object.keys(all).forEach((rest) => {
        if (localStorage.getItem('fpx:' + rest) != null) return;
        const src = all[rest], pr = order(rest).filter((p) => src[p]);
        let val = null;
        if (rest === 'history:v1' || rest === 'prefs:v1') {
          let out = {};
          pr.slice().reverse().forEach((p) => {
            let j = null; try { j = JSON.parse(localStorage.getItem(src[p])); } catch (e) { j = null; }
            if (!j || typeof j !== 'object') return;
            if (rest === 'prefs:v1') out = Object.assign(out, j, { settings: Object.assign({}, out.settings, j.settings) });
            else Object.keys(j).forEach((d) => { const a = out[d], b = j[d]; out[d] = !a ? b : Object.assign({}, a, b, { das: (b && b.das) || a.das, pickers: (b && b.pickers) || a.pickers, da: (b && b.da) || a.da, pk: (b && b.pk) || a.pk }); });
          });
          if (rest === 'prefs:v1') { delete out.tab; delete out.navShut; }
          val = JSON.stringify(out);
        } else val = localStorage.getItem(src[pr[0]]);
        try { if (val != null) localStorage.setItem('fpx:' + rest, val); } catch (e) { }
      });
      localStorage.setItem('fpx:migrated:v1', String(Date.now()));
    } catch (e) { }
  })();
  const PREFS = (() => { try { return JSON.parse(localStorage.getItem(STORE_PREFS) || '{}'); } catch (e) { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(STORE_PREFS, JSON.stringify(PREFS)); } catch (e) { } };
  // v1.18 network version: core pages only ("Show advanced pages" brings the rest back), short notes, colour only on misses.
  // The team editions set LITE = false and keep their own layout.
  const LITE = false;
  const ADV = () => !LITE || !!PREFS.advanced;
  // v1.16: the fallback cutoff moved from 12 h to 3 h; an old saved 12 h choice is dropped so the new default applies
  if (PREFS.forcedH != null) { delete PREFS.forcedH; savePrefs(); }
  if (PREFS.forcedCut != null && isFinite(PREFS.forcedCut)) CFG.PLANNED_AHEAD_HOURS = +PREFS.forcedCut;


  /* ------------------------------------------------------------------
   * 1. CAPTURE – remember the Control Room's own requests so the brain can
   *    ask the same services the same way. Headers stay in memory only.
   * ------------------------------------------------------------------ */
  const HOSTS = { 'picker.breadfast.com': 'picker', 'fleet.breadfast.com': 'fleet', 'delivery-capacity.breadfast.com': 'dcm', 'www.breadfast.com': 'www' };
  const CAP = { headers: {}, credentials: null, ordersUrl: null, seenAt: null, hostHeaders: {}, hostCreds: {}, mapsKey: null };
  const PW = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  const origFetch = PW.fetch.bind(PW);

  function noteRequest(rawUrl, headers, credentials) {
    let u;
    try { u = new URL(rawUrl, location.href); } catch (e) { return; }
    if (u.hostname === 'maps.googleapis.com') {
      const k = u.searchParams.get('key') || Object.keys(headers || {}).filter((x) => x.toLowerCase() === 'x-goog-api-key').map((x) => headers[x])[0];
      if (k) CAP.mapsKey = k;
      return;
    }
    const tag = HOSTS[u.hostname];
    if (!tag) return;
    if (tag === 'www' && u.pathname.indexOf('/warehouses-service/') !== 0) return;
    const h = {};
    Object.keys(headers || {}).forEach((k) => {
      const lk = k.toLowerCase();
      if (['if-none-match', 'if-modified-since', 'content-length', 'host'].includes(lk)) return;
      h[k] = headers[k];
    });
    if (Object.keys(h).length) CAP.hostHeaders[tag] = Object.assign({}, CAP.hostHeaders[tag], h);
    if (credentials) CAP.hostCreds[tag] = credentials;
    if (tag !== 'picker') return;
    CAP.headers = CAP.hostHeaders.picker || {};
    if (credentials) CAP.credentials = credentials;
    if (/^\/control-room\/orders\/?$/.test(u.pathname) && u.searchParams.get('date')) {
      CAP.ordersUrl = u.toString();
      CAP.seenAt = Date.now();
      if (UI.host) UI.updateButton();
    }
  }
  const isWarehouseList = (url) => /\/warehouses-service\/warehouses\/listWarehouses/.test(String(url || ''));

  PW.fetch = function (input, init) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const src = (init && init.headers) || (typeof PW.Request !== 'undefined' && input instanceof PW.Request ? input.headers : null);
      const h = {};
      if (src) {
        if (typeof PW.Headers !== 'undefined' && src instanceof PW.Headers) src.forEach((v, k) => { h[k] = v; });
        else if (Array.isArray(src)) src.forEach(([k, v]) => { h[k] = v; });
        else Object.assign(h, src);
      }
      const creds = (init && init.credentials) || (typeof PW.Request !== 'undefined' && input instanceof PW.Request ? input.credentials : null);
      noteRequest(url, h, creds);
    } catch (e) { /* never break the page */ }
    const p = origFetch.apply(this, arguments);
    // When the page itself loads the warehouse list (Location vs fence tab), read our FP's zones and status from it.
    if (isWarehouseList(url)) p.then((r) => r.clone().json()).then((j) => FPSTAT.ingest(j, 'page')).catch(() => { });
    return p;
  };

  const XO = PW.XMLHttpRequest.prototype.open;
  const XH = PW.XMLHttpRequest.prototype.setRequestHeader;
  const XS = PW.XMLHttpRequest.prototype.send;
  PW.XMLHttpRequest.prototype.open = function (method, url) {
    this.__fpa = { url: String(url), h: {} };
    return XO.apply(this, arguments);
  };
  PW.XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__fpa) this.__fpa.h[k] = v;
    return XH.apply(this, arguments);
  };
  PW.XMLHttpRequest.prototype.send = function () {
    try {
      if (this.__fpa) {
        noteRequest(this.__fpa.url, this.__fpa.h, this.withCredentials ? 'include' : null);
        if (isWarehouseList(this.__fpa.url)) {
          this.addEventListener('load', function () {
            try { FPSTAT.ingest(this.responseType === 'json' ? this.response : JSON.parse(this.responseText), 'page'); } catch (e) { }
          });
        }
      }
    } catch (e) { }
    return XS.apply(this, arguments);
  };

  /* ------------------------------------------------------------------
   * 2. FETCH – read-only requests. Anything other than GET is refused,
   *    except the warehouse-list lookup, which is a search (POST) that changes nothing.
   * ------------------------------------------------------------------ */
  const NET = {}; // per service: { ok: time, err: message, errAt: time }
  async function apiFetch(url, opts) {
    opts = opts || {};
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && !(method === 'POST' && isWarehouseList(u.pathname))) throw new Error('Blocked: the brain is read-only');
    const tag = HOSTS[u.hostname] || 'picker';
    const own = CAP.hostHeaders[tag];
    const base = own || CAP.headers || {};
    const full = Object.assign({ accept: 'application/json', 'content-type': 'application/json' }, base);
    const auth = Object.keys(base).filter((k) => /^(authorization|x-access-token|token|x-auth-token)$/i.test(k));
    const minimal = { accept: 'application/json', 'content-type': 'application/json' };
    auth.forEach((k) => { minimal[k] = base[k]; });
    const credPref = CAP.hostCreds[tag] || (tag === 'picker' ? CAP.credentials : null);
    const modes = credPref ? [credPref] : ['include', 'same-origin'];
    const attempts = [];
    modes.forEach((m) => { attempts.push([full, m]); if (!own && Object.keys(full).length !== Object.keys(minimal).length) attempts.push([minimal, m]); });
    let lastErr;
    for (const [headers, credentials] of attempts) {
      try {
        const r = await origFetch(url, { method, headers, credentials, cache: 'no-store', body: opts.body ? JSON.stringify(opts.body) : undefined });
        if (r.status === 401 || r.status === 403) throw new Error('Not authorised (' + r.status + '). Refresh the Control Room page and try again.');
        if (!r.ok) throw new Error('Request failed (' + r.status + ')');
        const text = await r.text();
        if (opts.maxBytes && text.length > opts.maxBytes) throw new Error('Response too large');
        const j = text ? JSON.parse(text) : null;
        NET[tag] = { ok: Date.now(), err: null };
        return j;
      } catch (e) { lastErr = e; if (/Not authorised|too large/.test(e.message)) break; }
    }
    NET[tag] = Object.assign({}, NET[tag], { err: lastErr && lastErr.message, errAt: Date.now() });
    throw lastErr;
  }
  const apiGet = (url) => apiFetch(url);

  async function fetchAllOrders(onProgress, dateOverride) {
    const u = new URL(CAP.ordersUrl);
    u.searchParams.set('pending_orders_only', 'false');
    if (dateOverride) u.searchParams.set('date', dateOverride);
    Array.from(u.searchParams.keys()).filter((k) => k.indexOf('filters') === 0).forEach((k) => u.searchParams.delete(k));
    const limit = CFG.PAGE_SIZE;
    let offset = 0, total = Infinity;
    const byId = new Map();
    while (offset < total) {
      u.searchParams.set('page[limit]', String(limit));
      u.searchParams.set('page[offset]', String(offset));
      const j = await apiGet(u.toString());
      const rows = (j && j.data) || [];
      const count = j && j.meta && j.meta.page && j.meta.page.count;
      total = typeof count === 'number' ? count : (rows.length < limit ? offset + rows.length : Infinity);
      rows.forEach((o) => byId.set(o.id, o));
      offset += limit;
      onProgress && onProgress(byId.size, total);
      if (!rows.length) break;
      if (offset > 20000) break; // safety
    }
    return { orders: Array.from(byId.values()), date: u.searchParams.get('date'), fps: u.searchParams.getAll('fps[]') };
  }

  async function getFpCoords(orders) {
    const fpId = orders.find((o) => o.fpId) && orders.find((o) => o.fpId).fpId;
    if (!fpId) return null;
    try {
      const cached = localStorage.getItem(STORE_COORDS + fpId);
      if (cached) return JSON.parse(cached);
    } catch (e) { }
    const z = FPSTAT.loadAreas(fpId);
    if (z && z.location) return { lat: z.location[0], lng: z.location[1] };
    const sample = orders.find((o) => o.fpId === fpId && o.status === 'completed') || orders[0];
    try {
      const j = await apiGet('https://' + API_HOST + '/control-room/orders/' + sample.id);
      const c = j && j.data && j.data.locationsConfigs && j.data.locationsConfigs.fp && j.data.locationsConfigs.fp.facilityCoordinates;
      if (c && c.lat && c.lng) {
        const v = { lat: +c.lat, lng: +c.lng };
        try { localStorage.setItem(STORE_COORDS + fpId, JSON.stringify(v)); } catch (e) { }
        return v;
      }
    } catch (e) { }
    return null;
  }

  /* ---------- small shared helpers ---------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  const dateKeyOf = (ms) => { const d = new Date(ms); return pad2(d.getDate()) + '-' + pad2(d.getMonth() + 1) + '-' + d.getFullYear(); };
  const dayStartOf = (dk) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dk || ''); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : null; };
  const fpIdFromCapture = () => { try { return new URL(CAP.ordersUrl).searchParams.getAll('fps[]')[0] || null; } catch (e) { return null; } };
  const onControlRoom = () => /controlroom/i.test(location.pathname + location.search);
  function pruneStore(prefix) {
    const cutoff = Date.now() - CFG.KEEP_DAYS * 86400000;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(prefix) !== 0) continue;
        const ds = dayStartOf(k.split(':').pop());
        if (ds && ds < cutoff) localStorage.removeItem(k);
      }
    } catch (e) { }
  }

  /* ------------------------------------------------------------------
   * SETTINGS (core): everything dynamic is read from CFG. The Settings page saves
   * changes in this browser (PREFS.settings) and they are applied here at load.
   * ------------------------------------------------------------------ */
  const CFG_DEFAULTS = JSON.parse(JSON.stringify(CFG));
  CFG_DEFAULTS.PLANNED_AHEAD_HOURS = 3;
  const getPath = (o, k) => k.split('.').reduce((x, p) => (x == null ? x : x[p]), o);
  const setPath = (o, k, v) => { const ps = k.split('.'); const last = ps.pop(); const t = ps.reduce((x, p) => (x[p] = x[p] || {}), o); t[last] = v; };
  function validShifts(list) {
    return Array.isArray(list) && list.length > 0 && list.every((s) => s && String(s.name || '').trim() && isFinite(s.from) && isFinite(s.to) && s.from >= 0 && s.from <= 23 && s.to >= 1 && s.to <= 24 && s.from !== s.to);
  }
  // Coffee / pharmacy on or off (Settings: "This FP has coffee" / "This FP has a pharmacy")
  const hasCoffee = () => CFG.SHOW_COFFEE !== false;
  const hasPharma = () => CFG.SHOW_PHARMACY !== false;
  const hasCP = () => hasCoffee() || hasPharma();
  // A column, tile, card or CSV field named after coffee or pharmacy is hidden when that one is off (a combined one when both are off).
  function cpShowLabel(label) {
    const s = String(label == null ? '' : label).replace(/<[^>]*>/g, '').toLowerCase();
    const c = /coffee|barista/.test(s), p = /pharma/.test(s);
    if (c && p) return hasCP();
    if (c) return hasCoffee();
    if (p) return hasPharma();
    return true;
  }
  const cpShowCol = (c) => cpShowLabel(c[0]);
  // an order's type as shown: a coffee / pharmacy order reads as Grocery when the FP has that switched off
  const typeShown = (r) => (cpShowLabel(r.type) ? r.type : 'Grocery');
  // page name for the coffee & pharmacy page, following what the FP has
  const cpTitle = () => (hasCoffee() && hasPharma() ? 'Coffee & pharmacy' : hasCoffee() ? 'Coffee' : 'Pharmacy');
  function applySettings() {
    const s = PREFS.settings || {};
    Object.keys(s).forEach((k) => {
      if (k === 'SHIFTS') { if (validShifts(s.SHIFTS)) CFG.SHIFTS = s.SHIFTS.map((x) => ({ name: String(x.name).trim(), from: +x.from, to: +x.to })); return; }
      if (getPath(CFG_DEFAULTS, k) === undefined) return;
      setPath(CFG, k, s[k]);
    });
  }
  applySettings();
  // A shift can run past midnight (e.g. 22 → 7).
  const inShift = (h, sh) => h != null && (sh.from < sh.to ? h >= sh.from && h < sh.to : h >= sh.from || h < sh.to);
  const shiftRange = (sh) => { const hl = (h) => (h % 12 === 0 ? 12 : h % 12) + (h % 24 < 12 ? ' AM' : ' PM'); return hl(sh.from) + ' – ' + hl(sh.to % 24); };

  /* ---------- per-sub-area "packed too late" threshold + sub-order switch (runs inside analyze, before the day summary) ---------- */
  const HANDOFF = { areas: {}, overall: null, n: 0 };
  /* ---------- forced orders (v1.16) ----------
   * A scheduled order is forced when the customer could not get a NOW delivery at the moment they ordered:
   *  1. scheduled express: always (scheduled, but "deliver as soon as possible");
   *  2. recorded when it was placed (a Control Room tab was open): the NOW slot full in DCM, or the FP not open (busy / delay)
   *     = forced; open with room left = the customer's own choice (preferred);
   *  3. nothing recorded then: placed less than PLANNED_AHEAD_HOURS (3) before its slot = forced. */
  const FORCED_SRC = { express: 'Scheduled express', dcm: 'DCM slot full', status: 'FP BUSY', open: 'Preferred (FP available)', cut: 'Under cutoff', ahead: 'Placed ahead' };
  const forcedSrcTxt = (k) => (k === 'cut' ? 'Under ' + CFG.PLANNED_AHEAD_HOURS + 'h ahead (not recorded)' : k === 'ahead' ? 'Preferred (' + CFG.PLANNED_AHEAD_HOURS + 'h+ ahead)' : FORCED_SRC[k] || '');
  function forcedReader() {
    const fp = fpIdFromCapture();
    const days = {};
    const day = (t) => {
      const dk = dateKeyOf(t);
      if (!(dk in days)) {
        const dcm = fp ? DCM.load(fp, dk) : null, fs = fp ? FPSTAT.load(fp, dk) : null;
        days[dk] = { ev: dcm && Array.isArray(dcm.ev) ? dcm.ev : [], st: fs && Array.isArray(fs.ev) ? fs.ev.slice().sort((a, b) => a[0] - b[0]) : [], seg: fs && Array.isArray(fs.seg) ? fs.seg : [] };
      }
      return days[dk];
    };
    // DCM's NOW slot when the order was placed: full (true), room left (false), not recorded (null). The reading just before wins.
    const dcmFull = (p) => {
      const D = day(p), h = new Date(p).getHours(), win = (CFG.LIVE_POLL_MIN + 1) * MIN;
      let best = null, bk = Infinity;
      D.ev.forEach((e) => { if (+e[1] !== h) return; const d = p - e[0]; if (Math.abs(d) > win) return; const k = d >= 0 ? d : win - d; if (k < bk) { bk = k; best = e; } });
      return best ? best[4] <= 0 : null;
    };
    // FP status when the order was placed: 'open', 'delay' (busy, delay…), or null (not being checked then, or closed)
    const statusAt = (p) => {
      const D = day(p), tol = CFG.FP_STATUS_POLL_MIN * MIN;
      if (!D.seg.some((g) => p >= g[0] - MIN && p <= g[1] + tol)) return null;
      let e = null;
      for (const x of D.st) { if (x[0] <= p) e = x; else break; }
      if (!e) return null;
      const st = String(e[1]).toUpperCase();
      if (st.indexOf('AVAILABLE') === 0) return 'open';
      return /CLOS|OFF|INACTIVE/.test(st) ? null : 'delay';
    };
    return (r) => {
      if (!r.scheduled) return null;
      if (/EXPRESS/.test(r.model || '')) return { forced: true, src: 'express' };
      if (r.placed != null) {
        const full = dcmFull(r.placed), st = statusAt(r.placed);
        if (full === true) return { forced: true, src: 'dcm' };
        if (st === 'delay') return { forced: true, src: 'status' };
        if (full === false || st === 'open') return { forced: false, src: 'open' };
      }
      const ahead = r.shiftHours != null && r.shiftHours >= CFG.PLANNED_AHEAD_HOURS;
      return { forced: !ahead, src: ahead ? 'ahead' : 'cut' };
    };
  }
  // Forced verdict and ETA lateness on normalized rows (also used for the next day's orders placed on this day).
  // ETA late % follows the official scorecard: only NOW orders are judged (late = null for scheduled orders);
  // lateAny keeps "delivered after its ETA" for every order, for the one "incl. forced" view on ETA Late Analysis.
  function forcedAndLate(rows, reader) {
    rows.forEach((r) => {
      const v = reader(r);
      r.forced = !!(v && v.forced); r.forcedSrc = v ? v.src : null;
      if (r.scheduled) r.plannedAhead = !r.forced;
      if (r.lateAny === undefined) { r.lateAny = r.late; r.lateMinAny = r.lateMin; }
      r.late = r.scheduled ? null : r.lateAny;
      r.lateMin = r.late ? r.lateMinAny : null;
    });
  }
  function brainPrep(rows) {
    rows.forEach((r) => { if (r.wasSub == null) r.wasSub = r.subOrder; r.subOrder = CFG.INCLUDE_SUBORDERS ? false : r.wasSub; });
    forcedAndLate(rows, forcedReader());
    // Direct ride = DA pickup → delivered for the first drop of each trip (or a single-drop order).
    const del = rows.filter((r) => !r.wasSub && r.delivered && r.legMin != null && r.legMin > 0 && r.legMin < 120);
    const firsts = [];
    groupBy(del.filter((r) => r.tripId), (r) => String(r.tripId)).forEach((g) => { g.sort((a, b) => a.completed - b.completed); firsts.push(g[0]); });
    del.filter((r) => !r.tripId).forEach((r) => firsts.push(r));
    const areas = {};
    groupBy(firsts, (r) => r.subArea).forEach((g, k) => { areas[k] = { n: g.length, med: median(g.map((r) => r.legMin)), avg: avg(g.map((r) => r.legMin)) }; });
    HANDOFF.areas = areas; HANDOFF.n = firsts.length; HANDOFF.overall = firsts.length >= CFG.HANDOFF_MIN_ORDERS ? median(firsts.map((r) => r.legMin)) : null;
    const H = CFG.HANDOFF_MIN * MIN;
    rows.forEach((r) => {
      const a = areas[r.subArea];
      let base, src;
      if (CFG.HANDOFF_MODE === 'fixed') { base = CFG.HANDOFF_MIN; src = 'fixed'; }
      else if (a && a.n >= CFG.HANDOFF_MIN_ORDERS) { base = a.med + (CFG.HANDOFF_BUFFER_MIN || 0); src = 'sub-area'; }
      else if (HANDOFF.overall != null) { base = HANDOFF.overall + (CFG.HANDOFF_BUFFER_MIN || 0); src = 'FP usual'; }
      else { base = CFG.HANDOFF_MIN; src = 'fixed'; }
      r.handoffMin = Math.round(base * 10) / 10; r.handoffSrc = src;
      r.directLeg = a && a.n >= CFG.HANDOFF_MIN_ORDERS ? a.med : HANDOFF.overall;
      r.causeAny = r.lateAny ? causeOf(r, r.handoffMin * MIN || H) : null;
      r.cause = r.late ? r.causeAny : null;
    });
  }
  function causeOf(r, T) {
    if (r.packed != null && r.packed > r.deadline) return 'Packed after deadline';
    if (r.packed != null && r.deadline - r.packed < T) return 'Packed too late';
    if (r.pickedUp != null && r.deadline - r.pickedUp < T) return 'Awaiting pickup';
    if (r.pickedUp != null || r.packed != null) return 'Ride';
    return 'Unknown';
  }
  // Orders placed on day dk that belong to the next day's slots (from the next day's orders): main orders, not cancelled,
  // with the forced verdict and lateness. P90 incl. forced and forced % go by the day an order was placed.
  function spillRows(orders, dk, coords) {
    const d0 = dayStartOf(dk), d1 = d0 + 24 * 3600000;
    const rows = orders.map((o) => normalize(o, coords)).filter((r) => r.status !== 'cancelled' && r.placed != null && r.placed >= d0 && r.placed < d1);
    rows.forEach((r) => { r.wasSub = r.subOrder; r.subOrder = CFG.INCLUDE_SUBORDERS ? false : r.wasSub; });
    forcedAndLate(rows, forcedReader());
    rows.forEach((r) => {
      const a = HANDOFF.areas[r.subArea], buf = CFG.HANDOFF_BUFFER_MIN || 0;
      const base = CFG.HANDOFF_MODE === 'fixed' ? CFG.HANDOFF_MIN : a && a.n >= CFG.HANDOFF_MIN_ORDERS ? a.med + buf : HANDOFF.overall != null ? HANDOFF.overall + buf : CFG.HANDOFF_MIN;
      r.causeAny = r.lateAny ? causeOf(r, base * MIN) : null;
      r.cause = r.late ? r.causeAny : null;
    });
    return rows.filter((r) => !r.subOrder);
  }
  const handoffOf = (r) => (r && r.handoffMin != null ? r.handoffMin : CFG.HANDOFF_MIN);
  const handoffTxt = () => (CFG.HANDOFF_MODE === 'fixed' ? CFG.HANDOFF_MIN + ' min' : 'the usual ride to its sub-area' + (CFG.HANDOFF_BUFFER_MIN ? ' + ' + CFG.HANDOFF_BUFFER_MIN + ' min' : ''));
  function causeHelp() {
    const t = handoffTxt();
    return '<b>Packed after deadline</b> = still in the FP when the ETA passed. <b>Packed too late</b> = packed with less time left than ' + t + ', so no DA could make it. <b>Awaiting pickup</b> = packed in time, but sat awaiting pickup until less than ' + t + ' was left. <b>Ride</b> = left the FP with more than ' + t + ' to spare and still arrived late (slow route, traffic, or a multi-drop trip).' +
      (CFG.HANDOFF_MODE === 'fixed' ? '' : ' Thresholds per sub-area are on Day Analysis → Late causes.');
  }

  /* ------------------------------------------------------------------
   * PICKER SHIFTS (roster) – who really picked an order on an account.
   * New hires and inventory leads pick on other people's accounts, so an order only counts for the account
   * owner when it was packed inside the owner's shift on a working day. Saved in this browser, per FP.
   *   pickers[key] = { name, hr, id, shift: {from, to} | null, off: [weekday 0-6], excluded: bool, seen: dateKey }
   *   days[dd-mm-yyyy][key] = { off: true } | { from, to }      (that day only: overtime, swapped day off…)
   * A shift that runs past midnight belongs to the day it starts.
   * ------------------------------------------------------------------ */
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const rosterKey = (x) => (x && x.hr ? 'hr:' + String(x.hr) : 'id:' + String(x && x.id));
  function makeRoster(STORE_ROSTER) {
    const self = {
    fp: null, data: null,
    load(fp) {
      fp = fp || self.fp || (typeof fpIdFromCapture === 'function' ? fpIdFromCapture() : null) || 'fp';
      if (self.data && self.fp === fp) return self.data;
      let d = null;
      try { d = JSON.parse(localStorage.getItem(STORE_ROSTER + fp) || 'null'); } catch (e) { d = null; }
      self.fp = fp; self.data = d && d.pickers ? d : { pickers: {}, days: {} };
      if (!self.data.days) self.data.days = {};
      return self.data;
    },
    save() { try { localStorage.setItem(STORE_ROSTER + self.fp, JSON.stringify(self.data)); } catch (e) { } },
    // register every account seen, so the Picker shifts page lists all of them
    see(list, dk) {
      const R = self.load();
      let changed = false;
      list.forEach((x) => {
        if (!x || (!x.hr && !x.id)) return;
        const k = rosterKey(x);
        if (!R.pickers[k]) { R.pickers[k] = { name: x.name, hr: x.hr || null, id: x.id || null, shift: null, off: [], excluded: false, seen: null }; changed = true; }
        const p = R.pickers[k];
        if (x.name && p.name !== x.name) { p.name = x.name; changed = true; }
        if (x.id && !p.id) { p.id = x.id; changed = true; }
        if (dk && (!p.seen || dateKey(dk) > dateKey(p.seen))) { p.seen = dk; changed = true; }
      });
      if (changed) self.save();
    },
    // the plan for one picker on one shift-day: null = not working / no shift set; { from, to } otherwise
    plan(k, dk) {
      const R = self.load(), p = R.pickers[k], o = (R.days[dk] || {})[k];
      if (o && o.off) return { off: true, src: 'day' };
      if (o && o.from != null && o.to != null) return { from: +o.from, to: +o.to, src: 'day' };
      if (!p || !p.shift) return null;
      const wd = new Date(dayStartOf(dk)).getDay();
      if ((p.off || []).includes(wd)) return { off: true, src: 'usual' };
      return { from: +p.shift.from, to: +p.shift.to, src: 'usual' };
    },
    hasShift(k) { const R = self.load(); return !!((R.pickers[k] && R.pickers[k].shift) || Object.values(R.days).some((d) => d[k])); },
    excluded(x) { const R = self.load(); const p = R.pickers[rosterKey(x)]; return !!(p && p.excluded); },
  };
    return self;
  }
  const ROSTER = makeRoster('fpx:pkroster:v1:');   // pickers
  const DAROSTER = makeRoster('fpx:daroster:v1:'); // DAs (same shape: pickers = people)
  const dkShift = (dk, n) => { const t = new Date(dayStartOf(dk)); t.setDate(t.getDate() + n); return pad2(t.getDate()) + '-' + pad2(t.getMonth() + 1) + '-' + t.getFullYear(); };
  // shift windows that touch the date dk: yesterday's (if it runs past midnight) and today's
  function shiftWindows(k, dk, RS) {
    RS = RS || ROSTER;
    const out = [];
    [-1, 0].forEach((n) => {
      const d = dkShift(dk, n), pl = RS.plan(k, d);
      if (!pl) return;
      const ds = dayStartOf(d);
      const from = pl.off ? null : pl.from, to = pl.off ? null : pl.to;
      if (pl.off) {
        // a day off still has the usual hours, used only to explain "packed on a day off"
        const p = RS.load().pickers[k];
        if (p && p.shift) out.push({ off: true, a: ds + p.shift.from * 3600000, b: ds + (p.shift.to <= p.shift.from ? p.shift.to + 24 : p.shift.to) * 3600000, day: d });
        return;
      }
      out.push({ off: false, a: ds + from * 3600000, b: ds + (to <= from ? to + 24 : to) * 3600000, day: d, from, to });
    });
    return out;
  }
  const hhmm = (h) => { const hh = Math.floor(h) % 24, mm = Math.round((h - Math.floor(h)) * 60); return pad2(hh) + ':' + pad2(mm); };
  const shiftTxt = (pl) => (!pl ? 'no shift set' : pl.off ? 'day off' : hhmm(pl.from) + '–' + hhmm(pl.to));

  // Called inside analyzePickers: marks each picked order as counted for the account owner or not; returns the counted ones.
  function pkRosterMark(rows, meta) {
    ROSTER.load(meta && meta.fps && meta.fps[0]);
    const dk = meta.date, G = (CFG.PK_SHIFT_GRACE_MIN || 0) * MIN;
    const seen = new Map();
    rows.forEach((r) => { const k = rosterKey({ hr: r.pickerHr, id: r.pickerId }); r.rosterKey = k; if (!seen.has(k)) seen.set(k, { name: r.pickerName, hr: r.pickerHr, id: r.pickerId }); });
    ROSTER.see(Array.from(seen.values()), dk);
    const winCache = {};
    rows.forEach((r) => {
      const k = r.rosterKey;
      r.rosterOk = true; r.rosterWhy = null;
      if (!ROSTER.hasShift(k)) return;                       // no shift set: everything counts, as before
      const W = winCache[k] || (winCache[k] = shiftWindows(k, dk));
      const t = r.packed;
      if (W.some((w) => !w.off && t >= w.a - G && t <= w.b + G)) return;
      r.rosterOk = false;
      r.rosterWhy = W.some((w) => w.off && t >= w.a - G && t <= w.b + G) || (W.length && W.every((w) => w.off)) ? 'Day off' : 'Outside shift';
    });
    return rows.filter((r) => r.rosterOk);
  }

  // Called after the per-picker list is built: seconds per SKU (raw and adjusted for basket size), shift hours and
  // idle time while orders were waiting during the shift.
  function pkRosterStats(P, meta) {
    const dk = meta.date, t0 = P.dayStart, t1 = t0 + 24 * 3600000, STEP = 5 * MIN;
    const counted = P.list.reduce((a, p) => a.concat(p.rows), []);
    const valid = (r) => r.skus && r.handleMin != null && r.handleMin > 0 && r.startSource !== 'assumed (first order)';
    counted.forEach((r) => { r.secPerSku = valid(r) ? (r.handleMin * 60) / r.skus : null; });
    P.rows.forEach((r) => { if (r.secPerSku === undefined) r.secPerSku = valid(r) ? (r.handleMin * 60) / r.skus : null; });
    // team median seconds per SKU in each basket band: big baskets are naturally faster per SKU (the fixed time per order is spread wider)
    const bandOf = (n) => SKU_BANDS.findIndex((b) => n >= b[0] && n <= b[1]);
    const bandMed = SKU_BANDS.map((b, i) => median(counted.filter((r) => r.secPerSku != null && bandOf(r.skus) === i).map((r) => r.secPerSku)));
    const teamSec = median(counted.map((r) => r.secPerSku));
    counted.forEach((r) => { const m = r.secPerSku != null ? bandMed[bandOf(r.skus)] : null; r.speedIdx = m ? r.secPerSku / m : null; });
    const accRows = groupBy(P.rows, (r) => String(r.pickerId));
    P.list.forEach((p) => {
      const k = rosterKey({ hr: p.hr, id: p.id });
      p.rosterKey = k;
      p.excluded = ROSTER.excluded({ hr: p.hr, id: p.id });
      p.secPerSku = median(p.rows.map((r) => r.secPerSku));
      p.speedIdx = median(p.rows.map((r) => r.speedIdx));
      p.adjSecPerSku = p.speedIdx != null && teamSec != null ? p.speedIdx * teamSec : null;
      p.secN = p.rows.filter((r) => r.secPerSku != null).length;
      const all = accRows.get(p.id) || [];
      p.accountOrders = all.length; p.notCounted = all.length - p.orders;
      p.plan = ROSTER.plan(k, dk);
      const W = ROSTER.hasShift(k) ? shiftWindows(k, dk).filter((w) => !w.off && w.b > t0 && w.a < t1) : [];
      p.shiftSet = W.length > 0;
      const wins = (W.length ? W.map((w) => [Math.max(t0, w.a), Math.min(t1, w.b)]) : [[p.first, p.last]]).filter((w) => w[1] > w[0]);
      p.shiftH = W.length ? wins.reduce((s, w) => s + (w[1] - w[0]) / 3600000, 0) : null;
      p.picksPerShiftH = p.shiftH ? p.orders / p.shiftH : null;
      // v1.26: a picker's own PPH (Ops) = their orders ÷ their active hours (clock hours in which they started 1+ order, inside
      // their shift), the same rule as the FP's PPH (Ops). Before 1.26: ÷ shift hours, else first pick to last pack.
      p.activeH = activeHours(p.rows, () => 'p', pkStartOf, t0, t1);
      p.rateH = p.activeH || null; p.rateSrc = 'active hours';
      p.perHour = p.rateH ? p.orders / p.rateH : null; p.shortSpan = !p.shiftSet && p.spanH < 1;
      // availability: of the shift minutes when orders were waiting for a picker, how many this picker spent not picking
      let waitM = 0, idleM = 0;
      P.grid.forEach((c) => {
        if (!c.waiting || !wins.some((w) => c.t >= w[0] && c.t < w[1])) return;
        waitM += 5;
        if (!all.some((r) => r.start <= c.t && r.packed > c.t)) idleM += 5;
      });
      p.waitInShiftMin = waitM; p.idleWaitMin = idleM; p.idleWaitPct = waitM >= 30 ? (100 * idleM) / waitM : null; p.idleSrc = W.length ? 'shift' : 'first to last pick';
    });
    // scheduled but no picks at all = absent (or picked on someone else's account)
    const R = ROSTER.load();
    const present = new Set(P.list.map((p) => p.rosterKey));
    P.absent = Object.keys(R.pickers).filter((k) => !R.pickers[k].excluded && !present.has(k)).map((k) => ({ k, p: R.pickers[k], plan: ROSTER.plan(k, dk) })).filter((x) => x.plan && !x.plan.off);
    P.team.secPerSku = teamSec; P.team.bandSec = bandMed;
    // seconds per SKU by hour, on the same orders as every other seconds-per-SKU figure (estimated first picks left out)
    P.hours.forEach((x) => { const a = t0 + x.h * 3600000, b = a + 3600000; x.secPerSku = median(P.rows.filter((r) => r.packed >= a && r.packed < b).map((r) => r.secPerSku)); });
    P.team.notCounted = P.rows.filter((r) => r.rosterOk === false).length;
    P.team.notCountedOff = P.rows.filter((r) => r.rosterWhy === 'Day off').length;
    P.meta = meta;
  }

  /* ---------- DAs: same rules. A delivery counts for the DA only if they picked it up inside their shift (± grace) on a working day. ---------- */
  function daRosterApply(A, D, meta) {
    const dk = meta.date, G = (CFG.DA_SHIFT_GRACE_MIN || 0) * MIN, t0 = D.dayStart, t1 = t0 + 24 * 3600000, STEP = 5 * MIN;
    DAROSTER.load(meta && meta.fps && meta.fps[0]);
    DAROSTER.see(D.list.filter((x) => x.hr || x.id).map((x) => ({ name: x.name, hr: x.hr, id: x.id })), dk);
    // orders waiting for a DA (packed, on the shelf) every 5 minutes
    const shelf = A.rows.filter((r) => !r.wasSub && r.packed != null && r.status !== 'cancelled');
    const waitGrid = [];
    for (let t = t0; t < t1; t += STEP) waitGrid.push({ t, n: shelf.filter((r) => r.packed <= t && (r.pickedUp == null ? (r.completed || t1) : r.pickedUp) > t).length });
    const base = (area) => { const a = HANDOFF.areas[area]; return a && a.n >= CFG.HANDOFF_MIN_ORDERS ? a.med : HANDOFF.overall; };
    D.list.forEach((x) => {
      const k = rosterKey({ hr: x.hr, id: x.id });
      x.rosterKey = k; x.excluded = DAROSTER.excluded({ hr: x.hr, id: x.id }); x.plan = DAROSTER.plan(k, dk);
      const has = DAROSTER.hasShift(k);
      const W = has ? shiftWindows(k, dk, DAROSTER) : [];
      const allRows = (x.trips || []).reduce((a, t) => a.concat(t.rows), []);
      allRows.forEach((r) => {
        r.daKey = k; r.daOk = true; r.daWhy = null;
        if (!has) return;
        const t = r.pickedUp != null ? r.pickedUp : r.completed;
        if (W.some((w) => !w.off && t >= w.a - G && t <= w.b + G)) return;
        r.daOk = false;
        r.daWhy = W.some((w) => w.off && t >= w.a - G && t <= w.b + G) || (W.length && W.every((w) => w.off)) ? 'Day off' : 'Outside shift';
      });
      const g = allRows.filter((r) => r.daOk);
      x.accountDeliveries = allRows.length; x.notCounted = allRows.length - g.length;
      if (x.notCounted) {
        // recount this DA's numbers from the deliveries inside the shift
        x.trips = x.trips.map((t) => Object.assign({}, t, { rows: t.rows.filter((r) => r.daOk) })).filter((t) => t.rows.length).map((t) => Object.assign(t, { orders: t.rows.length, late: t.rows.filter((r) => r.late).length, start: Math.min(...t.rows.map((r) => r.pickedUp || r.completed)), end: Math.max(...t.rows.map((r) => r.completed)) }));
        const s = summarize(g);
        x.rows = g; x.deliveries = g.length; x.tripsN = x.trips.length; x.perTrip = x.tripsN ? g.length / x.tripsN : null;
        x.first = x.trips.length ? x.trips[0].start : null; x.last = x.trips.length ? x.trips[x.trips.length - 1].end : null;
        x.spanH = x.first != null ? Math.max((x.last - x.first) / 3600000, 0.25) : null; x.dph = x.spanH ? g.length / x.spanH : null; x.shortSpan = x.spanH != null && x.spanH < 1;
        const busy = x.trips.reduce((t, y) => t + (y.end - y.start) / MIN, 0); x.busyPct = x.spanH ? (100 * busy) / (x.spanH * 60) : null;
        x.medLeg = s.medLeg; x.medDist = median(g.map((r) => r.distKm)); x.late = s.late; x.latePct = s.latePct; x.roadLate = s.causes['Ride'];
        const gaps = []; for (let i = 1; i < x.trips.length; i++) gaps.push((x.trips[i].start - x.trips[i - 1].end) / MIN);
        x.gapsLong = gaps.filter((v) => v >= CFG.GAP_MIN).length; x.longestGap = gaps.length ? Math.max(...gaps) : null;
      }
      // speed: the first drop of each trip (a direct ride) against the usual ride to that sub-area today
      const ratios = [], extras = [];
      x.trips.forEach((t) => {
        const f = t.rows.slice().sort((a, b) => a.completed - b.completed)[0];
        const b = f ? base(f.subArea) : null;
        if (f && f.legMin != null && f.legMin > 0 && f.legMin < 120 && b) { ratios.push(f.legMin / b); extras.push(f.legMin - b); }
      });
      x.rideIdx = median(ratios); x.rideExtra = median(extras); x.rideN = ratios.length;
      // availability: of the shift minutes when packed orders were waiting for a DA, how many this DA spent off a trip
      // (a trip runs from pickup to the last drop, plus the usual ride back to the FP)
      const nonOff = W.filter((w) => !w.off && w.b > t0 && w.a < t1);
      x.shiftSet = nonOff.length > 0;
      const wins = (nonOff.length ? nonOff.map((w) => [Math.max(t0, w.a), Math.min(t1, w.b)]) : x.first != null ? [[x.first, x.last]] : []).filter((w) => w[1] > w[0]);
      x.shiftH = nonOff.length ? wins.reduce((s2, w) => s2 + (w[1] - w[0]) / 3600000, 0) : null;
      const busyWin = (x.trips || []).map((t) => { const lastR = t.rows[t.rows.length - 1]; const back = (lastR && base(lastR.subArea)) || 10; return [t.start, t.end + back * MIN]; });
      let waitM = 0, idleM = 0;
      waitGrid.forEach((c) => {
        if (!c.n || !wins.some((w) => c.t >= w[0] && c.t < w[1])) return;
        waitM += 5;
        if (!busyWin.some((b) => c.t >= b[0] && c.t < b[1])) idleM += 5;
      });
      x.waitInShiftMin = waitM; x.idleWaitMin = idleM; x.idleWaitPct = waitM >= 30 ? (100 * idleM) / waitM : null;
      // v1.26: a DA's own DPH (Ops) = their deliveries ÷ their active hours (clock hours in which they picked up 1+ order, inside
      // their shift), the same rule as the FP's DPH (Ops). Before 1.26: ÷ shift hours, else first pickup to last delivery.
      x.activeH = activeHours((x.trips || []).reduce((a, t) => a.concat(t.rows), []).filter((r) => r.daOk !== false && !r.wasSub), () => 'd', daStartOf, t0, t1);
      x.rateH = x.activeH || null; x.rateSrc = 'active hours';
      x.dph = x.rateH && x.deliveries ? x.deliveries / x.rateH : null; x.shortSpan = !x.shiftSet && x.spanH != null && x.spanH < 1;
    });
    const R = DAROSTER.load();
    const present = new Set(D.list.filter((x) => x.deliveries).map((x) => x.rosterKey));
    D.absent = Object.keys(R.pickers).filter((k) => !R.pickers[k].excluded && !present.has(k)).map((k) => ({ k, p: R.pickers[k], plan: DAROSTER.plan(k, dk) })).filter((y) => y.plan && !y.plan.off);
    D.team.notCounted = D.list.reduce((s, x) => s + (x.notCounted || 0), 0);
    // team totals after the shift filter, so they add up to the DA rows (DPH itself is set by the Scorecard)
    const active = D.list.filter((x) => x.deliveries);
    D.team.activeDAs = active.length; D.team.deliveries = active.reduce((t, x) => t + x.deliveries, 0); D.team.trips = active.reduce((t, x) => t + x.tripsN, 0);
    D.team.perTrip = D.team.trips ? D.team.deliveries / D.team.trips : null;
    D.team.notCountedOff = A.rows.filter((r) => r.daWhy === 'Day off').length;
    D.team.rideBase = HANDOFF.overall;
    D.meta = meta;
  }

  /* ------------------------------------------------------------------
   * 3. ANALYZE – pure functions, no DOM
   * ------------------------------------------------------------------ */
  const MIN = 60000;
  const toMs = (v) => {
    if (v === null || v === undefined || v === '' || v === 0 || v === '0') return null;
    const n = Number(v);
    if (!isFinite(n)) { const p = Date.parse(v); return isFinite(p) ? p : null; }
    return n < 1e11 ? n * 1000 : n;
  };
  const diffMin = (a, b) => (a != null && b != null ? (a - b) / MIN : null);

  function slotHourOf(str) {
    const m = /^(\d{1,2}):\d{2}\s*(AM|PM)/i.exec(String(str || '').trim());
    if (!m) return null;
    return (Number(m[1]) % 12) + (m[2].toUpperCase() === 'PM' ? 12 : 0);
  }
  const hourLabel = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM');
  const slotLabel = (h) => hourLabel(h) + ' – ' + hourLabel((h + 1) % 24);
  const shiftOf = (h) => {
    if (h == null) return 'Unknown';
    const s = CFG.SHIFTS.find((x) => inShift(h, x));
    return s ? s.name : 'Unknown';
  };

  function cleanName(first, last) {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const f = n(first), l = n(last);
    if (!l || f.includes(l)) return f || l;
    if (l.includes(f)) return l;
    return f + ' ' + l;
  }

  function haversineKm(a, b) {
    if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) return null;
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function pct(arr, p) {
    const v = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    return v[Math.max(0, Math.ceil(p * v.length - 1e-9) - 1)]; // 1e-9: 0.9 × 70 is 63.000…01 in floating point
  }
  const median = (arr) => pct(arr, 0.5);
  const avg = (arr) => { const v = arr.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const rate = (n, d) => (d ? (100 * n) / d : null);

  const CAUSES = ['Packed after deadline', 'Packed too late', 'Awaiting pickup', 'Ride', 'Unknown'];
  const IN_STORE = ['Packed after deadline', 'Packed too late'];

  function normalize(o, fpCoords) {
    const a = o.actions || {};
    const placed = toMs(o.placingTime);
    const deadline = toMs(o.deliveryDeadlineTs);
    const packed = toMs(a.packaged);
    const pickedUp = toMs(a.received);
    const arrived = toMs(a.arrived);
    const completed = toMs(a.completed);
    // deliveryDate is the slot's START time, so take its calendar day and add the slot hour once
    const dayStart = (() => { const t = toMs(o.deliveryDate); if (t == null) return null; const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); })();
    let slot = slotHourOf(o.timeSlot);
    if (slot == null && deadline) slot = new Date(deadline - 1).getHours();
    const status = String(o.status || '').replace('_', '-');
    const delivered = status === 'completed' && completed != null;
    const late = delivered && deadline != null ? completed > deadline : null;
    const model = String(o.deliveryModel || '').toUpperCase();
    const scheduled = model.startsWith('SCHEDULED');
    const bagsSum = Array.isArray(o.bags) ? o.bags.reduce((s, b) => s + (Number(b.actualQuantity) || 0), 0) : 0;
    const bags = o.actualBags != null ? Number(o.actualBags) : (bagsSum || null);
    const da = (o.deliveryPersons || [])[0] || null;
    const p = o.picker || {};
    const type = o.hasPharma ? 'Pharmacy' : o.isSubOrder ? 'Sub-order' : o.hasCoffee ? 'Coffee' : 'Grocery';
    const loc = o.addressLocation ? { lat: Number(o.addressLocation.lat), lng: Number(o.addressLocation.lng) } : null;

    let cause = null;
    if (late) {
      const H = CFG.HANDOFF_MIN * MIN;
      if (packed != null && packed > deadline) cause = 'Packed after deadline';
      else if (packed != null && deadline - packed < H) cause = 'Packed too late';
      else if (pickedUp != null && deadline - pickedUp < H) cause = 'Awaiting pickup';
      else if (pickedUp != null || packed != null) cause = 'Ride';
      else cause = 'Unknown';
    }

    const slotStart = dayStart != null && slot != null ? dayStart + slot * 3600000 : null;
    const placedHour = placed != null ? new Date(placed).getHours() : null;
    const shiftHours = scheduled && slotStart != null && placed != null ? (slotStart - placed) / 3600000 : null;
    // Scheduled 12h+ ahead = planned by the customer; anything closer may have been pushed (forced)
    const plannedAhead = shiftHours != null && shiftHours >= CFG.PLANNED_AHEAD_HOURS;

    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status,
      fpName: o.fpName,
      model: model || 'UNKNOWN',
      scheduled,
      slot,
      shift: shiftOf(slot),
      type,
      coffee: !!o.hasCoffee,
      coffeeOnly: !!o.hasCoffee && (o.fulfillmentOrder || []).some((x) => x.typeId === 2) && !(o.fulfillmentOrder || []).some((x) => x.typeId === 1),
      pharma: !!o.hasPharma,
      subOrder: !!o.isSubOrder,
      subType: o.subOrderType || null,
      tags: orderTags(o),
      fpIssues: (o.reportedIssues || []).map((x) => ({ t: x.ticketId || null, r: String(x.reasonName || 'Other'), c: String(x.comment || '').split('\n')[0].slice(0, 40) })),
      parentOrderNumber: o.parentOrderNumber || null,
      placed, deadline, packed, pickedUp, arrived, completed,
      delivered,
      late,
      lateMin: late ? diffMin(completed, deadline) : null,
      cause,
      deliveryMin: delivered ? diffMin(completed, placed) : null,
      prepMin: !scheduled ? diffMin(packed, placed) : null,
      shelfMin: diffMin(pickedUp, packed),
      legMin: diffMin(completed, pickedUp),
      doorMin: diffMin(completed, arrived),
      bufferAtPackMin: diffMin(deadline, packed),
      bags,
      skus: Array.isArray(o.products) ? new Set(o.products.map((x) => x.productId || x.id || x.nameEn)).size : null,
      value: nxOrderValue(o),
      items: nxItems(o),
      pickerId: p.id || null,
      pickerName: p.id ? cleanName(p.firstName, p.lastName) : null,
      pickerHr: p.hrId || null,
      daId: da ? da.id : null,
      daName: da ? String(da.name || '').replace(/\s+/g, ' ').trim() : null,
      daHr: da ? da.hrid || da.hrId || null : null,
      tripId: o.tripData && o.tripData.tripId ? o.tripData.tripId : null,
      assignType: o.daAssignType || null,
      subArea: o.subArea || 'Unknown',
      distKm: haversineKm(fpCoords, loc),
      lat: loc && isFinite(loc.lat) ? loc.lat : null,
      lng: loc && isFinite(loc.lng) ? loc.lng : null,
      placedHour,
      plannedAhead,
      shiftHours,
      slotStart,
      packedHour: packed != null ? new Date(packed).getHours() : null,
    };
  }

  function summarize(rows) {
    // Sub-orders (pharmacy, missing items) close within seconds alongside their parent order,
    // so they are left out of every delivery-time and lateness metric.
    const main = rows.filter((r) => !r.subOrder);
    const delivered = main.filter((r) => r.delivered);
    const late = delivered.filter((r) => r.late);
    const judged = delivered.filter((r) => r.late != null);   // NOW orders delivered (with an ETA)
    const now = delivered.filter((r) => !r.scheduled);
    const sameDaySched = delivered.filter((r) => r.scheduled && !r.plannedAhead);
    const causes = {};
    CAUSES.forEach((c) => { causes[c] = late.filter((r) => r.cause === c).length; });
    // Every count is of real orders: sub-orders are counted apart (subOrders), unless Settings includes them everywhere.
    return {
      orders: main.length,
      delivered: delivered.length,
      late: late.length,
      latePct: rate(late.length, judged.length),
      judged: judged.length,
      cancelled: main.filter((r) => r.status === 'cancelled').length,
      notReceived: main.filter((r) => r.status === 'not-received').length,
      inProgress: main.filter((r) => !['completed', 'cancelled', 'not-received'].includes(r.status)).length,
      subOrders: rows.length - main.length,
      nowCount: main.filter((r) => !r.scheduled).length,
      schedCount: main.filter((r) => r.scheduled).length,
      p90Now: pct(now.map((r) => r.deliveryMin), 0.9),
      p90Proxy: pct(now.concat(sameDaySched).map((r) => r.deliveryMin), 0.9),
      medDelivery: median(now.map((r) => r.deliveryMin)),
      avgBags: avg(main.map((r) => r.bags)),
      avgSkus: avg(main.map((r) => r.skus)),
      largeBaskets: main.filter((r) => r.skus >= CFG.LARGE_BASKET_SKUS).length,
      medShelf: median(delivered.map((r) => r.shelfMin)),
      medLeg: median(delivered.map((r) => r.legMin)),
      medPrepNow: median(now.map((r) => r.prepMin)),
      medLateMin: median(late.map((r) => r.lateMin)),
      causes,
      coffee: main.filter((r) => r.coffee).length,
      coffeeDelivered: judged.filter((r) => r.coffee).length,
      coffeeLate: late.filter((r) => r.coffee).length,
      pharma: main.filter((r) => r.pharma).length,
      pharmaDelivered: judged.filter((r) => r.pharma).length,
      pharmaLate: late.filter((r) => r.pharma).length,
      autoAssigned: main.filter((r) => r.assignType === 'auto').length,
      manualAssigned: main.filter((r) => r.assignType === 'manual').length,
    };
  }

  function groupBy(rows, keyFn) {
    const m = new Map();
    rows.forEach((r) => { const k = keyFn(r); if (k === null || k === undefined) return; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return m;
  }

  function analyze(orders, fpCoords) {
    const all = orders.map((o) => normalize(o, fpCoords));
    // Cancelled orders are counted for reference only and left out of every calculation.
    const cancelledCount = all.filter((r) => r.status === 'cancelled').length;
    const rows = all.filter((r) => r.status !== 'cancelled');
    // Pharmacy items arrive as a sub-order; judge the pharmacy order by its parent's delivery.
    const byNumber = new Map(rows.filter((r) => !r.subOrder).map((r) => [r.orderNumber, r]));
    rows.forEach((r) => {
      if (!r.subOrder || !r.pharma) return;
      const parent = byNumber.get(r.parentOrderNumber);
      if (parent) { parent.pharma = true; parent.type = 'Pharmacy'; r.pharma = false; r.type = 'Sub-order'; r.pharmaSub = true; }
    });
    if (typeof brainPrep === 'function') brainPrep(rows);
    const day = summarize(rows);
    day.cancelled = cancelledCount;
    day.totalWithCancelled = all.length;

    // Shifted-in counts per destination slot
    const sched = rows.filter((r) => r.scheduled && !r.subOrder && r.status !== 'cancelled');

    const slots = [];
    const bySlot = groupBy(rows, (r) => r.slot);
    for (let h = 0; h < 24; h++) {
      const g = bySlot.get(h) || [];
      if (!g.some((r) => !r.subOrder)) continue;   // a slot with only sub-orders has no orders to show
      const s = summarize(g);
      s.slot = h;
      s.label = slotLabel(h);
      s.shift = shiftOf(h);
      s.shiftedIn = g.filter((r) => r.scheduled && !r.plannedAhead && r.status !== 'cancelled').length;
      s.dayBeforeSched = g.filter((r) => r.scheduled && r.plannedAhead && r.status !== 'cancelled').length;
      slots.push(s);
    }

    const shifts = CFG.SHIFTS.map((sh) => {
      const g = rows.filter((r) => r.shift === sh.name);
      const s = summarize(g);
      s.name = sh.name;
      s.range = shiftRange(sh);
      const packs = rows.filter((r) => !r.subOrder && r.pickerId && r.packedHour != null && inShift(r.packedHour, sh));
      s.activePickers = new Set(packs.map((r) => r.pickerId).filter(Boolean)).size;
      s.ordersPerPicker = s.activePickers ? packs.length / s.activePickers : null;
      s.activeDAs = new Set(g.filter((r) => r.delivered && !r.subOrder).map((r) => r.daId).filter(Boolean)).size;
      return s;
    });

    // Pickers
    const pickers = [];
    groupBy(rows.filter((r) => r.pickerId && r.packed != null && !r.subOrder), (r) => r.pickerId).forEach((g) => {
      const packs = g.map((r) => r.packed).sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < packs.length; i++) { const gm = (packs[i] - packs[i - 1]) / MIN; if (gm > 0 && gm <= CFG.PICK_GAP_MAX_MIN) gaps.push(gm); }
      const hours = new Set(packs.map((t) => Math.floor(t / 3600000))).size;
      const shiftCount = {};
      g.forEach((r) => { const s = shiftOf(r.packedHour); shiftCount[s] = (shiftCount[s] || 0) + 1; });
      const mainShift = Object.keys(shiftCount).sort((a, b) => shiftCount[b] - shiftCount[a])[0];
      const del = g.filter((r) => r.delivered);
      pickers.push({
        name: g[0].pickerName, hr: g[0].pickerHr, shift: mainShift,
        orders: g.length,
        bags: g.reduce((s, r) => s + (r.bags || 0), 0),
        avgBags: avg(g.map((r) => r.bags)),
        skus: g.reduce((s, r) => s + (r.skus || 0), 0),
        avgSkus: avg(g.map((r) => r.skus)),
        skusPerHour: hours ? g.reduce((s, r) => s + (r.skus || 0), 0) / hours : null,
        large: g.filter((r) => r.skus >= CFG.LARGE_BASKET_SKUS).length,
        activeHours: hours,
        perHour: hours ? g.length / hours : null,
        medGap: median(gaps),
        packedLate: g.filter((r) => IN_STORE.includes(r.cause)).length,
        late: del.filter((r) => r.late).length,
        latePct: rate(del.filter((r) => r.late).length, del.filter((r) => r.late != null).length),
        firstPack: packs[0], lastPack: packs[packs.length - 1],
      });
    });

    // DAs
    const das = [];
    groupBy(rows.filter((r) => r.daId && r.delivered && !r.subOrder), (r) => r.daId).forEach((g) => {
      const trips = new Set(g.map((r) => r.tripId).filter(Boolean)).size;
      das.push({
        name: g[0].daName, hr: g[0].daHr,
        orders: g.length,
        trips,
        perTrip: trips ? g.length / trips : null,
        medLeg: median(g.map((r) => r.legMin)),
        medDist: median(g.map((r) => r.distKm)),
        late: g.filter((r) => r.late).length,
        latePct: rate(g.filter((r) => r.late).length, g.filter((r) => r.late != null).length),
        roadLate: g.filter((r) => r.cause === 'Ride').length,
      });
    });

    // Sub-areas
    const subAreas = [];
    const mainCount = rows.filter((r) => !r.subOrder).length;
    groupBy(rows, (r) => r.subArea).forEach((g, k) => {
      const s = summarize(g);
      const orders = g.filter((r) => !r.subOrder).length;
      subAreas.push({
        name: k, orders, share: rate(orders, mainCount), delivered: s.delivered, late: s.late, latePct: s.latePct,
        coffee: s.coffee, coffeeLate: s.coffeeLate, pharma: s.pharma, pharmaLate: s.pharmaLate,
        medDist: median(g.map((r) => r.distKm)), farDist: pct(g.map((r) => r.distKm), 0.9),
        medLeg: s.medLeg, p90Now: s.p90Now, p90Proxy: s.p90Proxy,
        roadLate: s.causes['Ride'],
      });
    });

    // Distance bands
    const BANDS = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 99]];
    const distance = BANDS.map(([lo, hi]) => {
      const g = rows.filter((r) => r.distKm != null && r.distKm >= lo && r.distKm < hi);
      const s = summarize(g);
      return { label: hi === 99 ? lo + '+ km' : lo + '–' + hi + ' km', orders: s.orders, delivered: s.delivered, late: s.late, latePct: s.latePct, medLeg: s.medLeg, p90Now: s.p90Now, p90Proxy: s.p90Proxy, roadLate: s.causes['Ride'] };
    }).filter((b) => b.orders);

    // Shift matrix: placing hour -> scheduled slot (same-day only) + day-before row
    const flows = new Map();
    sched.forEach((r) => {
      const from = r.plannedAhead ? 'Preferred' : r.placedHour;
      const k = from + '>' + r.slot;
      flows.set(k, (flows.get(k) || 0) + 1);
    });
    const flowList = Array.from(flows.entries()).map(([k, n]) => {
      const [from, to] = k.split('>');
      return { from: from === 'Preferred' ? 'Preferred' : Number(from), to: Number(to), n };
    });
    const sameDay = sched.filter((r) => !r.plannedAhead);
    const shifted = {
      total: sched.length,
      sameDay: sameDay.length,
      dayBefore: sched.length - sameDay.length,
      over3h: sameDay.filter((r) => r.shiftHours >= 3).length,
      over6h: sameDay.filter((r) => r.shiftHours >= 6).length,
      medShiftH: median(sameDay.map((r) => r.shiftHours)),
      flows: flowList,
    };

    // Types
    const types = ['Grocery', 'Coffee', 'Pharmacy', 'Sub-order'].map((t) => {
      const g = rows.filter((r) => (t === 'Sub-order' ? r.type === t : r.type === 'Sub-order' ? false : t === 'Coffee' ? !!r.coffee : t === 'Pharmacy' ? !!r.pharma : !r.coffee && !r.pharma));
      const s = summarize(g);
      s.type = t;
      if (t === 'Sub-order') s.orders = g.length;   // the sub-order row shows how many there were
      return s;
    }).filter((t) => t.orders);

    const lateOrders = rows.filter((r) => r.late && !r.subOrder).sort((a, b) => b.lateMin - a.lateMin);
    const largeOrders = rows.filter((r) => !r.subOrder && r.skus >= CFG.LARGE_BASKET_SKUS).sort((a, b) => b.skus - a.skus || b.bags - a.bags);

    return { rows, day, slots, shifts, pickers, das, subAreas, distance, shifted, types, lateOrders, largeOrders, hasDistance: !!fpCoords, fp: fpCoords };
  }

  /* ------------------------------------------------------------------
   * 4. HISTORY – one summary per analysed date (KPIs, day, DAs, pickers incl. per-picker totals for the ranking).
   *    On first run it also imports what the separate FP / DA / Picker analyzers saved in this browser.
   * ------------------------------------------------------------------ */
  const dateKey = (s) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s || ''); return m ? m[3] + m[2] + m[1] : s; };
  let HIST_MERGED = false;
  function loadHistory() {
    let h;
    try { h = JSON.parse(localStorage.getItem(STORE_HISTORY) || 'null'); } catch (e) { h = null; }
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } };
    const fresh = !h;
    if (!h && LITE) h = {};   // network version: nothing to import from the old separate analyzers
    if (!h) {
      h = {};
      const fpa = read('fpa:history:v1'), dda = read('dda:history:v1'), pka = read('pka:history:v1');
      Object.keys(Object.assign({}, fpa, dda, pka)).forEach((k) => {
        const f = fpa[k], d = dda[k], p = pka[k];
        const any = f || d || p;
        const rec = { date: any.date, fp: any.fp, savedAt: any.savedAt, imported: true, kpi: {} };
        if (f) { rec.day = f; rec.kpi.p90f = f.p90Proxy; rec.kpi.p90n = f.p90Now; rec.kpi.latePctAll = f.latePct; }
        if (d) { rec.da = d; rec.kpi.dphTeam = d.dph; }
        if (p) { rec.pk = p; rec.kpi.pphTeam = p.perPickerHour; }
        h[k] = rec;
      });
    }
    // Once per page load: pick up per-DA and per-picker daily records saved by the DA / Picker Day Analyzers
    // in this browser, for days the brain hasn't loaded itself, so the rankings include them.
    if (!LITE && (!HIST_MERGED || fresh)) {
      HIST_MERGED = true;
      let changed = fresh;
      const dda = read('dda:history:v1'), pka = read('pka:history:v1');
      Object.keys(dda).forEach((k) => {
        const d = dda[k]; if (!d || !d.das) return;
        const rec = h[k] || (h[k] = { date: d.date, fp: d.fp, savedAt: d.savedAt, imported: true, kpi: {} });
        if (!rec.das) { rec.das = d.das; changed = true; }
        if (d.kpi) ['p90f', 'eta', 'dph', 'auto'].forEach((x) => { if (rec.kpi[x] == null && d.kpi[x] != null) { rec.kpi[x] = d.kpi[x]; changed = true; } });
      });
      Object.keys(pka).forEach((k) => {
        const p = pka[k]; if (!p || !p.pickers || !p.kpi) return;
        const rec = h[k] || (h[k] = { date: p.date, fp: p.fp, savedAt: p.savedAt, imported: true, kpi: {} });
        if (!rec.pickers) { rec.pickers = p.pickers; changed = true; }
        if (rec.kpi.pph == null && p.kpi.pph != null) { rec.kpi.pph = p.kpi.pph; changed = true; }
      });
      if (changed) { try { localStorage.setItem(STORE_HISTORY, JSON.stringify(h)); } catch (e) { } }
    }
    return h;
  }
  function saveHistory(meta, A) {
    const h = loadHistory();
    const d = A.day, S = A.score;
    const rec = {
      date: meta.date, fp: meta.fpNames.join(', '), savedAt: Date.now(),
      // def 4 (v1.26): PPH / DPH put an order in the hour its work started, no quiet-hour exception; PPH (Ops) / DPH (Ops) saved.
      // def 3 (v1.16): ETA late = NOW orders only; forced = express / recorded DCM full or FP not open / under the cutoff, by the day
      // placed; same-DA re-assignments count as auto. def 2 (v1.12): ETA late counted every order. No def: before v1.12.
      kpi: Object.assign({}, S.v, { pphTeam: S.extra.pphTeam, dphTeam: S.extra.dphTeam, latePctAll: d.latePct, forcedH: CFG.PLANNED_AHEAD_HOURS, forcedPct: S.extra.forcedPct, etaF: S.extra.etaF, placedDay: S.pool.state, def: 4 }),
      day: {
        orders: d.orders, delivered: d.delivered, late: d.late, latePct: d.latePct, p90Now: d.p90Now, p90Proxy: d.p90Proxy, cancelled: d.cancelled, notReceived: d.notReceived,
        avgBags: d.avgBags, avgSkus: d.avgSkus, largeBaskets: d.largeBaskets, schedCount: d.schedCount, forced: S.extra.forced,
        coffee: d.coffee, coffeeLatePct: rate(d.coffeeLate, d.coffeeDelivered), pharma: d.pharma, pharmaLatePct: rate(d.pharmaLate, d.pharmaDelivered),
        causes: d.causes, medShelf: d.medShelf, medLeg: d.medLeg, inProgress: d.inProgress,
        reasons: Object.fromEntries(countBy(S.etaLate, whyLate)),
      },
    };
    // the day's orders placed for the next day's slots aren't all delivered yet: keep the placed-day pool so the next day can finish it
    if (S.pool.state !== 'loaded') rec.fpool = poolSave(S.pool);
    if (A.da) {
      const T = A.da.team;
      rec.da = { activeDAs: T.activeDAs, deliveries: T.deliveries, perTrip: T.perTrip, dph: T.dph, manual: T.manual, overrides: T.historyLoaded ? T.overrides : null, recordedMin: A.da.avail ? A.da.avail.recordedMs / 60000 : 0 };
    }
    if (A.pk) {
      const T = A.pk.team;
      rec.pk = {
        pickerCount: T.pickers, orders: T.orders, skus: T.skus, perPickerHour: T.perPickerHour, medWait: T.medWait, medHandle: T.medHandle, medPerSku: T.medPerSku,
        peakQueue: T.peakQueue, storeLate: T.storeLate, queueLate: T.queueLate, slowLate: T.slowLate, recordedShare: T.recorded ? T.recordedShare : 0,
      };
    }
    rec.bk = pickHist(A);   // v1.24: picking times by basket size, for the Basket size page's expected times
    rec.das = A.da ? daDayRecords(A) : null;
    rec.pickers = A.pk ? pkDayRecords(A) : null;
    // busy hours per person (v1.13), for the Capacity page's own speeds
    if (rec.das) rec.das.forEach((r) => { const x = A.da.list.find((q) => q.id === r.id); if (x) { const b = daBusy(x); r.bh = b.bh; r.bw = b.bw; } });
    if (rec.pickers) rec.pickers.forEach((r) => { const p = A.pk.list.find((q) => q.id === r.id); if (p) { const b = pkBusy(p); r.bh = b.bh; r.bw = b.bw; } });
    if (A.cp) rec.cp = { coffee: A.cp.coffee.orders, coffeeLate: A.cp.coffee.late, coffeeCaused: A.cp.coffee.notFp, pharma: A.cp.pharma.orders, pharmaLate: A.cp.pharma.late, pharmaCaused: A.cp.pharma.notFp, etaExCp: A.cp.etaExCp };
    { const X = accountability(A); rec.acc = { store: X.counts[OWN_STORE], dispatch: X.counts[OWN_DISPATCH], cp: X.counts[OWN_CP], basket: X.counts[OWN_BASKET], unclear: X.counts[OWN_UNCLEAR] }; }
    h[meta.date + '|' + meta.fps.join(',')] = rec;
    const cutoff = Date.now() - CFG.KEEP_PERSON_DAYS * 86400000;
    Object.values(h).forEach((x) => { const ds = dayStartOf(x.date); if (ds && ds < cutoff) { delete x.das; delete x.pickers; if (x.pk) delete x.pk.pickers; } });
    // keep the store small: drop the oldest days' per-picker lists first if it grows too big
    let s = JSON.stringify(h);
    if (s.length > MAX_HISTORY_KB * 1024) {
      Object.keys(h).sort((a, b) => (dateKey(h[a].date) < dateKey(h[b].date) ? -1 : 1)).slice(0, 30).forEach((k) => { delete h[k].das; delete h[k].pickers; if (h[k].pk) delete h[k].pk.pickers; });
      s = JSON.stringify(h);
    }
    try { localStorage.setItem(STORE_HISTORY, s); } catch (e) { }
    return h;
  }
  /* ---------- placed-day basis: P90 incl. forced and forced % count an order on the day it was PLACED ----------
   * A past day loads the next day's orders too (A.spill), for the orders placed that evening for the next day's slots. When the
   * next day isn't over yet (or the day is today), the saved day keeps its pool (fpool) and is finished when the next day is loaded. */
  const DAY_ORDERS = { dk: null, res: null, at: 0 };   // the last day fetched, so days loaded in a row are each fetched once
  async function fetchDay(dk, onProgress) {
    const past = dayStartOf(dk) < dayStartOf(dateKeyOf(Date.now()));
    if (past && DAY_ORDERS.dk === dk && Date.now() - DAY_ORDERS.at < 10 * MIN) return DAY_ORDERS.res;
    const res = await fetchAllOrders(onProgress, dk);
    Object.assign(DAY_ORDERS, { dk, res, at: Date.now() });
    return res;
  }
  const shiftDk = (dk, n) => { const t = new Date(dayStartOf(dk)); t.setDate(t.getDate() + n); return dateKeyOf(t.getTime()); };
  // the next day's orders for a past day (null for today or a future day: nothing placed today is delivered tomorrow yet)
  async function fetchNextDay(dk, onProgress) {
    if (dayStartOf(dk) >= dayStartOf(dateKeyOf(Date.now()))) return null;
    try { return await fetchDay(shiftDk(dk, 1), onProgress); } catch (e) { return { failed: e.message, orders: [] }; }
  }
  function makeSpill(dk, next, coords) {
    if (!next) return { state: 'today', rows: [] };
    if (next.failed) return { state: 'failed', rows: [], err: next.failed };
    const rows = spillRows(next.orders, dk, coords);
    const open = rows.filter((r) => !['completed', 'not-received'].includes(r.status)).length;
    return { state: open ? 'partial' : 'loaded', rows, open };
  }
  const r1 = (v) => Math.round(v * 100) / 100;
  function poolSave(PP) {
    return { now: PP.nowDel.map((r) => r1(r.deliveryMin)), forced: PP.forcedDel.map((r) => r1(r.deliveryMin)), del: PP.del.length, judged: PP.judged.length, late: PP.lateF.length,
      ids: PP.spillRows.filter((r) => ['completed', 'not-received'].includes(r.status)).map((r) => String(r.id)) };
  }
  // Loading day X finishes day X-1: its orders placed on X-1 for X's slots are in X's list.
  function finishPrevDay(meta, A) {
    const pk = shiftDk(meta.date, -1) + '|' + meta.fps.join(',');
    const H = loadHistory(), rec = H[pk];
    if (!rec || !rec.fpool || !rec.kpi) return false;
    const ds = dayStartOf(shiftDk(meta.date, -1)), F = rec.fpool, have = new Set(F.ids || []);
    const spill = A.rows.filter((r) => !r.subOrder && r.placed != null && r.placed >= ds && r.placed < ds + 24 * 3600000);
    spill.forEach((r) => {
      if (have.has(String(r.id)) || !['completed', 'not-received'].includes(r.status)) return;
      have.add(String(r.id));
      if (!r.delivered) return;
      F.del++;
      if (!r.scheduled) F.now.push(r1(r.deliveryMin)); else if (r.forced) F.forced.push(r1(r.deliveryMin)); else return;
      if (r.lateAny != null) { F.judged++; if (r.lateAny) F.late++; }
    });
    F.ids = Array.from(have);
    const all = F.now.concat(F.forced);
    rec.kpi.p90f = pct(all, 0.9); rec.kpi.forcedPct = rate(F.forced.length, F.del); rec.kpi.etaF = rate(F.late, F.judged);
    if (rec.day) { rec.day.p90Proxy = rec.kpi.p90f; rec.day.forced = F.forced.length; }
    if (!spill.some((r) => !['completed', 'not-received', 'cancelled'].includes(r.status))) { delete rec.fpool; rec.kpi.placedDay = 'loaded'; }
    try { localStorage.setItem(STORE_HISTORY, JSON.stringify(H)); } catch (e) { }
    return true;
  }

  // The ranking reads per-picker totals from every saved day
  const rankingHistory = (H) => { const o = {}; Object.keys(H).forEach((k) => { const d = H[k]; const pk = d.pickers || (d.pk && d.pk.pickers); if (pk) o[k] = { date: d.date, pickers: pk }; }); return o; };

  /* ------------------------------------------------------------------
   * 5. EXPORT – one row per order (no customer data)
   * ------------------------------------------------------------------ */
  function toCsv(A) {
    const t = (ms) => (ms == null ? '' : new Date(ms).toLocaleString('en-GB', { hour12: false }));
    const n = (v, d) => (v == null || !isFinite(v) ? '' : Number(v).toFixed(d == null ? 1 : d));
    const fence = MAP.fence(A);
    tripContext(A);
    const cols = [
      ['order_number', (r) => r.orderNumber], ['status', (r) => r.status], ['model', (r) => r.model], ['type', (r) => r.type], ['timeslot', (r) => (r.slot == null ? '' : slotLabel(r.slot))],
      ['forced', (r) => (r.scheduled && !r.plannedAhead ? 'yes' : '')], ['forced_reason', (r) => (r.scheduled ? forcedSrcTxt(r.forcedSrc) : '')],
      ['placed', (r) => t(r.placed)], ['eta_or_slot_end', (r) => t(r.deadline)], ['packed', (r) => t(r.packed)], ['da_pickup', (r) => t(r.pickedUp)], ['delivered', (r) => t(r.completed)],
      ['delivery_min', (r) => n(r.deliveryMin)], ['late', (r) => (r.late == null ? '' : r.late ? 'yes' : 'no')], ['min_late', (r) => n(r.lateMin, 0)], ['late_reason', (r) => whyLate(r)],
      ['wait_for_picker_min', (r) => n(r.waitMin)], ['picking_min', (r) => n(r.handleMin)], ['awaiting_pickup_min', (r) => n(r.shelfMin)], ['ride_min', (r) => n(r.legMin)],
      ['unique_skus', (r) => r.skus], ['bags', (r) => r.bags], ...[['coffee', (r) => (r.coffee ? 'yes' : '')], ['pharmacy', (r) => (r.pharma ? 'yes' : '')]].filter(cpShowCol),
      ['picker', (r) => r.pickerName], ['picker_hr', (r) => r.pickerHr], ['da', (r) => r.daName], ['da_hr', (r) => r.daHr], ['trip', (r) => r.tripId], ['assign_type', (r) => r.assignType], ['assign_detail', (r) => (r.assign ? r.assign.cat : '')],
      ['owner_if_late', (r) => (r.late ? ownerOf(r) : '')], ['trip_drop', (r) => (r.tripSize > 1 ? r.dropNo + ' of ' + r.tripSize : r.tripSize === 1 ? 'single' : '')],
      ['sub_area', (r) => r.subArea], ['zone_on_map', (r) => (fence ? areaOf(r, fence) : '')], ['straight_line_km', (r) => n(r.distKm, 2)],
    ];
    const esc2 = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [cols.map((c) => c[0]).join(',')].concat(A.rows.map((r) => cols.map((c) => esc2(c[1](r))).join(','))).join('\n');
  }

  /* ------------------------------------------------------------------
   * 6. UI
   * ------------------------------------------------------------------ */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d) => (v == null || !isFinite(v) ? '–' : Number(v).toFixed(d == null ? 0 : d));
  const fmtPct = (v) => (v == null || !isFinite(v) ? '–' : v.toFixed(1) + '%');
  const fmtTime = (ms) => (ms == null ? '–' : new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }));

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  /* Light theme only. "only light" also stops Chrome's forced dark mode from repainting the panel. */
  .root {
    color-scheme: only light;
    --canvas: #eef1f5; --paper: #ffffff; --paper-2: #f6f8fb; --rule: #C8C9C7; --rule-strong: #C8C9C7;
    --ink: #15233b; --ink-2: #44506a; --ink-3: #66718a;
    --navy: #13263f; --navy-2: #1d3557;
    --accent: #1f6fd1; --accent-soft: #e8f1fc;
    --ontime: #1f6fd1; --late: #c7362f; --muted-bar: #b9c1cc;
    --good: #12722a; --good-bg: #e4f4e8; --good-rule: #2e9e4c;
    --warn: #8a5a00; --warn-bg: #fff2d6; --warn-rule: #e3a008;
    --bad: #a8231f; --bad-bg: #fde8e7; --bad-rule: #d4352e;
    font: 14px/1.5 "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  button { font-family: inherit; }

  /* Launcher */
  .fab { position: fixed; right: 22px; bottom: 22px; z-index: 2147483000; display: flex; align-items: center; gap: 9px;
    background: var(--navy); color: #fff !important; border: 0; border-radius: 999px; padding: 12px 18px; font-weight: 600; font-size: 14px;
    box-shadow: 0 6px 18px rgba(19,38,63,.28); cursor: pointer; }
  .fab:hover { background: var(--navy-2); }
  .fab:focus-visible { outline: 3px solid #8fb8ee; outline-offset: 2px; }
  .fab .dot { width: 9px; height: 9px; border-radius: 50%; background: #f0b429; }
  .fab.ready .dot { background: #46c35f; }

  /* Frame */
  .overlay { position: fixed; inset: 0; z-index: 2147483001; background: var(--canvas); display: none; flex-direction: column; }
  .overlay.open { display: flex; }
  header { background: var(--navy); color: #fff; padding: 14px 24px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  header .ttl { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  header .fp { color: #aebbd0 !important; font-size: 13px; font-weight: 500; }
  header h1 { color: #fff !important; font-size: 21px; margin: 0; font-weight: 650; letter-spacing: -.01em; }
  header .meta { color: #c7d1df !important; font-size: 13px; }
  header .sp { flex: 1; }
  .btn { background: transparent; color: #fff !important; border: 1px solid rgba(255,255,255,.35); border-radius: 8px; padding: 8px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }
  .btn:hover { background: rgba(255,255,255,.1); }
  .btn.primary { background: #fff; color: var(--navy) !important; border-color: #fff; }
  .btn.primary:hover { background: #e7edf6; }
  .btn:disabled { opacity: .55; cursor: default; }
  .btn:focus-visible, aside button:focus-visible, th:focus-visible { outline: 3px solid #8fb8ee; outline-offset: 2px; }
  .body { flex: 1; display: flex; min-height: 0; }
  aside { width: 214px; flex: none; background: var(--paper); border-right: 1px solid var(--rule); overflow-y: auto; padding: 14px 10px 24px; }
  aside .grp { color: var(--ink-3) !important; font-size: 12px; font-weight: 600; padding: 14px 12px 6px; }
  aside .grp:first-child { padding-top: 2px; }
  aside button { display: block; width: 100%; text-align: left; background: none; border: 0; border-radius: 7px; padding: 8px 12px; color: var(--ink-2) !important; font-size: 14px; font-weight: 500; cursor: pointer; }
  aside button:hover { background: var(--paper-2); color: var(--ink) !important; }
  aside button.on { background: var(--accent-soft); color: var(--accent) !important; font-weight: 650; }
  main { flex: 1; overflow: auto; padding: 22px 28px 48px; }
  .page { max-width: 1440px; }
  .page > h2.pt { font-size: 20px; margin: 0 0 4px; color: var(--ink) !important; font-weight: 650; }
  .page > p.pd { color: var(--ink-2) !important; margin: 0 0 18px; max-width: 900px; }
  @media (max-width: 900px) {
    .body { flex-direction: column; }
    aside { width: auto; display: flex; gap: 4px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--rule); padding: 8px; }
    aside .grp { display: none; }
    aside button { width: auto; white-space: nowrap; }
    main { padding: 16px; }
  }

  /* Status / empty */
  .status { padding: 64px 24px; text-align: center; color: var(--ink-2) !important; font-size: 15px; }
  .status .bar { height: 6px; max-width: 380px; margin: 16px auto 0; background: var(--rule); border-radius: 3px; overflow: hidden; }
  .status .bar i { display: block; height: 100%; background: var(--accent); transition: width .2s; }
  .err { color: var(--bad) !important; font-weight: 600; }

  /* Headline KPI strip: one panel, four cells, each topped by its status colour */
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
  .kpi { padding: 16px 20px 16px; border-top: 4px solid var(--rule-strong); }
  .kpi + .kpi { border-left: 1px solid var(--rule); }
  .kpi.good { border-top-color: var(--good-rule); } .kpi.warn { border-top-color: var(--warn-rule); } .kpi.bad { border-top-color: var(--bad-rule); }
  .kpi .k { color: var(--ink-2) !important; font-size: 13px; font-weight: 600; }
  .kpi .v { font-size: 34px; line-height: 1.15; font-weight: 700; letter-spacing: -.02em; margin-top: 4px; font-variant-numeric: tabular-nums; color: var(--ink) !important; }
  .kpi.good .v { color: var(--good) !important; } .kpi.warn .v { color: var(--warn) !important; } .kpi.bad .v { color: var(--bad) !important; }
  .kpi .u { font-size: 15px; font-weight: 600; color: var(--ink-3) !important; margin-left: 4px; letter-spacing: 0; }
  .kpi .s { color: var(--ink-2) !important; font-size: 13px; margin-top: 4px; }
  .kpi .st { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 650; margin-top: 8px; padding: 2px 9px 2px 7px; border-radius: 999px; }
  .kpi .st::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .kpi.good .st { background: var(--good-bg); color: var(--good) !important; }
  .kpi.warn .st { background: var(--warn-bg); color: var(--warn) !important; }
  .kpi.bad .st { background: var(--bad-bg); color: var(--bad) !important; }
  @media (max-width: 1100px) { .kpis { grid-template-columns: repeat(2, 1fr); } .kpi:nth-child(3) { border-left: 0; } .kpi:nth-child(n+3) { border-top-width: 4px; } }

  /* Secondary figures: a quiet ruled row, not more cards */
  .tiles { display: flex; flex-wrap: wrap; gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 12px; margin-bottom: 18px; overflow: hidden; }
  .tile { flex: 1 1 190px; padding: 13px 18px; background: var(--paper); }
  .tile .k { color: var(--ink-2) !important; font-size: 12.5px; font-weight: 600; }
  .tile .v { font-size: 22px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; color: var(--ink) !important; letter-spacing: -.01em; }
  .tile .v .u { font-size: 13px; color: var(--ink-3) !important; font-weight: 600; margin-left: 3px; }
  .tile .s { color: var(--ink-3) !important; font-size: 12.5px; margin-top: 2px; }
  .tile .v .pill { font-size: 17px; }

  /* Sections */
  .card { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 18px 20px; margin-bottom: 18px; }
  .card h2 { font-size: 16px; margin: 0 0 4px; font-weight: 650; color: var(--ink) !important; }
  .card .sub { color: var(--ink-2) !important; font-size: 13px; margin: 0 0 14px; max-width: 980px; }
  .card .sub b { color: var(--ink) !important; }
  .grid { display: grid; gap: 18px; }
  .two { grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); }
  .two > .card { margin-bottom: 0; }
  .two { margin-bottom: 18px; }

  /* Tables */
  .tw { overflow: auto; max-height: 70vh; border: 1px solid var(--rule); border-radius: 8px; }
  table { border-collapse: separate; border-spacing: 0; width: 100%; font-variant-numeric: tabular-nums; font-size: 13.5px; }
  th, td { padding: 9px 12px; text-align: right; border-bottom: 1px solid var(--rule); white-space: nowrap; color: var(--ink) !important; }
  th:first-child, td:first-child { text-align: left; }
  td.l, th.l { text-align: left; }
  th { color: var(--ink-2) !important; font-size: 12.5px; font-weight: 650; position: sticky; top: 0; z-index: 2; background: var(--paper-2); cursor: pointer; user-select: none; white-space: normal; min-width: 78px; line-height: 1.3; vertical-align: bottom; border-bottom: 1px solid var(--rule-strong); }
  th:hover { color: var(--ink) !important; }
  th.sorted { color: var(--accent) !important; }
  th.sorted::after { content: ' ▾'; } th.sorted.asc::after { content: ' ▴'; }
  td:first-child, th:first-child { position: sticky; left: 0; background: var(--paper); z-index: 1; font-weight: 600; }
  th:first-child { z-index: 3; background: var(--paper-2); }
  tbody tr:nth-child(even) td { background: #fafbfd; }
  tbody tr:hover td { background: #eef4fc; }
  tr.total td { font-weight: 700; background: var(--paper-2) !important; border-top: 2px solid var(--rule-strong); border-bottom: 0; }
  tbody tr:last-child td { border-bottom: 0; }
  .pill { display: inline-block; min-width: 56px; padding: 2px 8px; border-radius: 6px; font-weight: 700; text-align: center; font-size: 13px; }
  .pill.good { background: var(--good-bg); color: var(--good) !important; }
  .pill.warn { background: var(--warn-bg); color: var(--warn) !important; }
  .pill.bad { background: var(--bad-bg); color: var(--bad) !important; }
  .muted, .muted * { color: var(--ink-3) !important; font-weight: 400; }

  /* Charts */
  .legend { display: flex; gap: 18px; flex-wrap: wrap; font-size: 13px; color: var(--ink-2) !important; margin: 0 0 10px; }
  .legend b { color: var(--ink) !important; }
  .legend i { display: inline-block; width: 11px; height: 11px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
  svg text { fill: #55607a; font: 12px "Segoe UI", system-ui, sans-serif; }
  svg .grid line { stroke: #e4e8ee; }
  svg rect.hit { fill: transparent; cursor: pointer; }
  svg rect.hit:hover { fill: rgba(170,3,130,.06); }
  .tip { position: fixed; z-index: 2147483002; pointer-events: none; background: var(--navy); color: #fff !important; padding: 9px 12px; border-radius: 8px; font-size: 13px; line-height: 1.55; display: none; max-width: 280px; box-shadow: 0 8px 22px rgba(19,38,63,.3); }
  .tip, .tip * { color: #fff !important; }

  .note { color: var(--ink-2) !important; font-size: 13px; background: var(--paper); border: 1px solid var(--rule); border-left: 4px solid var(--accent); border-radius: 8px; padding: 11px 14px; margin-bottom: 18px; max-width: 1100px; }
  .note b { color: var(--ink) !important; }
  .heat { width: auto; min-width: 50%; }

  /* Map */
  .mapbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  .mapbar .sp { flex: 1; }
  .seg { display: inline-flex; background: var(--paper); border: 1px solid var(--rule-strong); border-radius: 8px; overflow: hidden; }
  .seg button { background: none; border: 0; border-right: 1px solid var(--rule); padding: 7px 12px; font-size: 13px; font-weight: 600; color: var(--ink-2) !important; cursor: pointer; }
  .seg button:last-child { border-right: 0; }
  .seg button.on { background: var(--navy); color: #fff !important; }
  .filebtn, .ghost { display: inline-block; background: var(--paper); border: 1px solid var(--rule-strong); border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 600; color: var(--navy) !important; cursor: pointer; }
  .filebtn:hover, .ghost:hover { background: var(--accent-soft); }
  .mapwrap { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 6px; }
  .map { position: relative; height: 66vh; min-height: 460px; overflow: hidden; border-radius: 8px; background: #F0EFEB; cursor: grab; outline: none; }
  .map.dragging { cursor: grabbing; }
  .map:focus-visible { box-shadow: 0 0 0 3px #8fb8ee; }
  .tiles-l { position: absolute; left: 0; top: 0; pointer-events: none; filter: grayscale(.35) contrast(.97); }
  .heat-c { position: absolute; left: 0; top: 0; pointer-events: none; }
  .mapctl { position: absolute; right: 12px; top: 12px; display: flex; flex-direction: column; background: #fff; border: 1px solid var(--rule-strong); border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(19,38,63,.15); }
  .mapctl button { width: 34px; height: 34px; border: 0; border-bottom: 1px solid var(--rule); background: #fff; font-size: 18px; font-weight: 600; color: var(--navy) !important; cursor: pointer; }
  .mapctl button:last-child { border-bottom: 0; font-size: 15px; }
  .mapctl button:hover { background: var(--accent-soft); }
  .attr { position: absolute; right: 0; bottom: 0; background: rgba(255,255,255,.85); font-size: 11px; padding: 2px 6px; color: var(--ink-2) !important; }
  .attr a { color: var(--accent) !important; }
  .maplegend { position: absolute; left: 12px; bottom: 12px; background: rgba(255,255,255,.95); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 10px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; min-width: 170px; }
  .maplegend b { color: var(--ink) !important; }
  .rampbar { display: block; height: 10px; border-radius: 3px; background: linear-gradient(90deg, #F6D3EA, #D392C6, #C94FA8, #AA0382, #6B185A); }
  .rl { display: flex; justify-content: space-between; color: var(--ink-3) !important; }
  .dotk { color: var(--ink-2) !important; } .dotk i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
  .tilewarn { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); background: var(--warn-bg); color: var(--warn) !important; border: 1px solid var(--warn-rule); border-radius: 8px; padding: 6px 12px; font-size: 12.5px; font-weight: 600; }

  .tier { display: inline-block; font-size: 11px; font-weight: 700; padding: 0 6px; border-radius: 5px; background: var(--accent-soft); color: var(--accent) !important; margin-left: 4px; }
  .st-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; vertical-align: 0; }
  .tlw { max-height: none; }
  svg.tl text.ax { fill: #66718a; font: 11px "Segoe UI", system-ui, sans-serif; }
  svg.tl text.nm { fill: #15233b; font: 600 12px "Segoe UI", system-ui, sans-serif; }
  svg.tl rect[data-tip] { cursor: pointer; }
  input.km { width: 72px; padding: 4px 8px; border: 1px solid var(--rule-strong); border-radius: 6px; font: inherit; font-size: 13px; text-align: right; color: var(--ink); background: #fff; }
  input.km:focus { outline: 2px solid #8fb8ee; border-color: var(--accent); }
  .spread td, .spread th { text-align: center; min-width: 84px; }
  .spread td.l, .spread th.l { text-align: left; }
  .spread .lt { color: var(--bad) !important; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .heat td, .heat th { text-align: center; min-width: 56px; }
  .heat td:first-child { text-align: left; }
  .causebar { display: flex; height: 16px; border-radius: 4px; overflow: hidden; gap: 2px; margin: 8px 0 12px; }
  .causebar span { display: block; height: 100%; }
  ul.flat { margin: 0; padding-left: 20px; } ul.flat li { margin: 5px 0; color: var(--ink) !important; }
  `;

  /* ---------- view helpers ---------- */
  const latePill = (p) => {
    if (p == null || !isFinite(p)) return '<span class="muted">–</span>';
    const c = p <= CFG.LATE_TARGET_PCT ? 'good' : p <= CFG.WARN.eta ? 'warn' : 'bad';
    return LITE && c === 'good' ? '<span class="okv">' + p.toFixed(1) + '%</span>' : '<span class="pill ' + c + '">' + p.toFixed(1) + '%</span>';
  };
  const p90Pill = (v) => {
    if (v == null || !isFinite(v)) return '<span class="muted">–</span>';
    const c = v <= CFG.P90_TARGET_MIN ? 'good' : v <= CFG.WARN.p90 ? 'warn' : 'bad';
    return LITE && c === 'good' ? '<span class="okv">' + Math.round(v) + '</span>' : '<span class="pill ' + c + '">' + Math.round(v) + '</span>';
  };
  const prettyDate = (s) => {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s || '');
    if (!m) return s || '';
    return new Date(+m[3], +m[2] - 1, +m[1]).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  const lateLine = (late, del) => (del ? fmtPct(rate(late, del)) + ' late (' + late + ' of ' + del + ' NOW delivered)' : 'No delivery timing for this date');
  const P90_COLS = [['P90 NOW', (r) => r.p90Now, (r) => p90Pill(r.p90Now)], ['P90 incl. forced', (r) => r.p90Proxy, (r) => p90Pill(r.p90Proxy)]];
  const STATUS_TXT = { good: 'On target', warn: 'Above target', bad: 'Well above target' };
  const statusOf = (v, target, mult) => (v == null || !isFinite(v) ? null : v <= target ? 'good' : v <= (target === CFG.LATE_TARGET_PCT ? CFG.WARN.eta : target === CFG.P90_TARGET_MIN ? CFG.WARN.p90 : target * mult) ? 'warn' : 'bad');
  const kpi = (k, v, unit, s, st) => !cpShowLabel(k) ? '' : '<div class="kpi ' + (st || '') + '"><div class="k">' + k + '</div><div class="v">' + v + (unit ? '<span class="u">' + unit + '</span>' : '') + '</div>' +
    (s ? '<div class="s">' + s + '</div>' : '') + (st ? '<div class="st">' + STATUS_TXT[st] + '</div>' : '') + '</div>';
  const tile = (k, v, s) => !cpShowLabel(k) ? '' : '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  const card = (title, sub, body) => !cpShowLabel(title) ? '' : '<div class="card"><h2>' + title + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + body + '</div>';

  // table(cols, rows, {total}) – cols: [label, valueFn(row)->sortable, renderFn(row)->html, align]
  function table(cols, rows, opts) {
    opts = opts || {};
    cols = cols.filter(cpShowCol);
    const id = 't' + Math.random().toString(36).slice(2, 8);
    const head = '<tr>' + cols.map((c, i) => '<th data-i="' + i + '" class="' + (c[3] === 'l' ? 'l' : '') + '">' + c[0] + '</th>').join('') + '</tr>';
    const body = rows.map((r) => '<tr>' + cols.map((c, i) => {
      const v = c[1](r);
      const html = c[2] ? c[2](r) : (typeof v === 'number' ? fmt(v, Number.isInteger(v) ? 0 : 1) : esc(v));
      return '<td data-v="' + esc(v == null ? '' : v) + '" class="' + (c[3] === 'l' ? 'l' : '') + '">' + html + '</td>';
    }).join('') + '</tr>').join('');
    const foot = opts.total ? '<tr class="total">' + cols.map((c) => { const html = c[2] ? c[2](opts.total) : esc(c[1](opts.total)); return '<td class="' + (c[3] === 'l' ? 'l' : '') + '">' + html + '</td>'; }).join('') + '</tr>' : '';
    return '<div class="tw"><table id="' + id + '" data-sortable="1"><thead>' + head + '</thead><tbody>' + body + '</tbody>' + (foot ? '<tfoot>' + foot + '</tfoot>' : '') + '</table></div>';
  }

  function bindTables(scope) {
    scope.querySelectorAll('table[data-sortable] th').forEach((th) => {
      th.addEventListener('click', () => {
        const t = th.closest('table'), i = +th.dataset.i, tb = t.tBodies[0];
        const asc = th.classList.contains('sorted') && !th.classList.contains('asc');
        t.querySelectorAll('th').forEach((x) => x.classList.remove('sorted', 'asc'));
        th.classList.add('sorted'); if (asc) th.classList.add('asc');
        const rows = Array.from(tb.rows);
        rows.sort((a, b) => {
          const va = a.cells[i].dataset.v, vb = b.cells[i].dataset.v;
          const na = parseFloat(va), nb = parseFloat(vb);
          let r;
          if (va === '' && vb !== '') r = 1; else if (vb === '' && va !== '') r = -1;
          else if (!isNaN(na) && !isNaN(nb)) r = nb - na; else r = String(va).localeCompare(String(vb));
          return asc ? -r : r;
        });
        rows.forEach((r) => tb.appendChild(r));
      });
    });
  }

  function bindTips(scope) {
    const tip = UI.root.querySelector('.tip');
    scope.querySelectorAll('[data-tip]').forEach((el) => {
      el.addEventListener('mousemove', (e) => {
        tip.innerHTML = el.getAttribute('data-tip');
        tip.style.display = 'block';
        const w = tip.offsetWidth, h = tip.offsetHeight;
        let x = e.clientX + 14, y = e.clientY + 14;
        if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
        if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      });
      el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
  }

  // Stacked column chart. series: [{key,label,color}], items: [{label, values:{key:n}, tip}]
  function stackedChart(items, series, opts) {
    opts = opts || {};
    const W = 960, H = opts.h || 230, padL = 36, padR = 8, padT = 10, padB = 34;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const totals = items.map((it) => series.reduce((s, se) => s + (it.values[se.key] || 0), 0));
    const max = opts.max != null ? opts.max : Math.max(1, ...totals);
    const nice = niceMax(max);
    const bw = innerW / Math.max(items.length, 1);
    const barW = Math.min(34, bw * 0.68);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(opts.aria || 'chart') + '">';
    svg += '<g class="grid">';
    const steps = Number.isInteger(nice / 4) || nice < 4 ? 4 : 5;
    for (let i = 0; i <= steps; i++) {
      const v = (nice / steps) * i, y = padT + innerH - (v / nice) * innerH;
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (y + 3.5) + '" text-anchor="end">' + (opts.pct ? +v.toFixed(1) + '%' : +v.toFixed(1)) + '</text>';
    }
    svg += '</g>';
    if (opts.target != null) {
      const y = padT + innerH - (opts.target / nice) * innerH;
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke="var(--ink-3)" stroke-dasharray="4 3" stroke-width="1.2"/>';
      svg += '<text x="' + (W - padR) + '" y="' + (y - 4) + '" text-anchor="end">' + (opts.targetLabel || 'target') + ' ' + opts.target + (opts.pct ? '%' : '') + '</text>';
    }
    items.forEach((it, i) => {
      const cx = padL + bw * i + bw / 2, x = cx - barW / 2;
      let y = padT + innerH;
      const total = totals[i];
      const topY = padT + innerH - (Math.min(total, nice) / nice) * innerH;
      const cid = 'c' + Math.random().toString(36).slice(2, 8);
      svg += '<clipPath id="' + cid + '"><rect x="' + x + '" y="' + topY + '" width="' + barW + '" height="' + (padT + innerH - topY + 6) + '" rx="4"/></clipPath><g clip-path="url(#' + cid + ')">';
      series.forEach((se) => {
        const v = it.values[se.key] || 0;
        if (!v) return;
        const h = (Math.min(v, nice) / nice) * innerH;
        y -= h;
        const color = typeof se.color === 'function' ? se.color(it) : se.color;
        svg += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + h + '" fill="' + color + '" stroke="var(--paper)" stroke-width="1.5"/>';
      });
      svg += '</g>';
      svg += '<text x="' + cx + '" y="' + (H - padB + 14) + '" text-anchor="middle">' + esc(it.short != null ? it.short : it.label) + '</text>';
      svg += '<rect class="hit" data-tip="' + esc(it.tip || '') + '" x="' + (padL + bw * i) + '" y="' + padT + '" width="' + bw + '" height="' + innerH + '"/>';
    });
    svg += '</svg>';
    return svg;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * p;
  }
  const shortHour = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'a' : 'p');

  function causeBar(causes) {
    const total = CAUSES.reduce((s, c) => s + (causes[c] || 0), 0);
    if (!total) return '<p class="muted">No late orders.</p>';
    const bar = '<div class="causebar">' + CAUSES.filter((c) => causes[c]).map((c) => '<span data-tip="' + esc(c + ': ' + causes[c] + ' (' + ((100 * causes[c]) / total).toFixed(0) + '%)') + '" style="width:' + (100 * causes[c]) / total + '%;background:' + CAUSE_COLORS[c] + '"></span>').join('') + '</div>';
    const legend = '<div class="legend">' + CAUSES.filter((c) => causes[c]).map((c) => '<span><i style="background:' + CAUSE_COLORS[c] + '"></i>' + c + ': <b>' + causes[c] + '</b> (' + ((100 * causes[c]) / total).toFixed(0) + '%)</span>').join('') + '</div>';
    return bar + legend;
  }

  const CAUSE_HELP = { toString: () => causeHelp() };

  function slotVolumeChart(A) {
    const items = A.slots.map((s) => ({
      label: s.label, short: shortHour(s.slot),
      values: { ontime: s.delivered - s.late, late: s.late, other: s.notReceived + s.inProgress },
      tip: '<b>' + s.label + '</b><br>' + s.orders + ' orders · ' + s.delivered + ' delivered<br>On time: ' + (s.delivered - s.late) + '<br>Late: ' + s.late + ' (' + fmtPct(s.latePct) + ')<br>Not received / still open: ' + (s.notReceived + s.inProgress),
    }));
    return '<div class="legend"><span><i style="background:var(--ontime)"></i>Delivered on time</span><span><i style="background:var(--late)"></i>Delivered late</span><span><i style="background:var(--muted-bar)"></i>Not received / still open</span></div>' +
      stackedChart(items, [{ key: 'ontime', color: 'var(--ontime)' }, { key: 'late', color: 'var(--late)' }, { key: 'other', color: 'var(--muted-bar)' }], { aria: 'Orders per timeslot' });
  }
  function slotLateChart(A) {
    const items = A.slots.map((s) => ({
      label: s.label, short: shortHour(s.slot), values: { v: s.latePct || 0 }, latePct: s.latePct,
      tip: '<b>' + s.label + '</b><br>Late: ' + fmtPct(s.latePct) + ' (' + s.late + ' of ' + s.delivered + ')',
    }));
    return '<div class="legend"><span><i style="background:var(--late)"></i>Above target</span><span><i style="background:var(--ontime)"></i>At or below target (' + CFG.LATE_TARGET_PCT + '%)</span></div>' +
      stackedChart(items, [{ key: 'v', color: (it) => ((it.latePct || 0) > CFG.LATE_TARGET_PCT ? 'var(--late)' : 'var(--ontime)') }], { pct: true, target: CFG.LATE_TARGET_PCT, max: Math.max(CFG.LATE_TARGET_PCT * 1.5, ...A.slots.map((s) => s.latePct || 0)), h: 190, aria: 'Late percent per timeslot' });
  }

  const roadKey = () => 'fpa:roadkm:' + ((UI.meta && UI.meta.fpNames && UI.meta.fpNames[0]) || 'fp');
  function loadRoadKm() { try { return JSON.parse(localStorage.getItem(roadKey()) || '{}'); } catch (e) { return {}; } }
  function bindRoadKm(scope) {
    scope.querySelectorAll('input.km').forEach((inp) => {
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('change', () => {
        const m = loadRoadKm(); const v = parseFloat(String(inp.value).replace(',', '.'));
        if (isFinite(v) && v > 0) m[inp.dataset.sa] = Math.round(v * 10) / 10; else delete m[inp.dataset.sa];
        try { localStorage.setItem(roadKey(), JSON.stringify(m)); } catch (e) { }
        const y = scope.scrollTop; UI.render(); UI.root.querySelector('main').scrollTop = y;
      });
    });
  }

  /* ------------------------------------------------------------------
   * ZONES MAP – Breadfast's own sub-area shapes (from Location vs fence), order heat, and each zone's
   * share of orders. Background: the Google map the Control Room already loads; if that isn't available,
   * plain map tiles drawn on a canvas; if those are blocked too, zones and orders are still drawn.
   * ------------------------------------------------------------------ */
  const fenceKey = () => 'fpx:fence:' + (fpIdFromCapture() || 'fp');
  function loadKmlFence() { try { return JSON.parse(localStorage.getItem(fenceKey()) || 'null'); } catch (e) { return null; } }
  function saveKmlFence(f) { try { if (f) localStorage.setItem(fenceKey(), JSON.stringify(f)); else localStorage.removeItem(fenceKey()); } catch (e) { } }

  // Reads a Google My Maps KML export: every Placemark polygon becomes a named area.
  function parseKml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not valid KML.');
    const areas = [];
    Array.from(doc.getElementsByTagName('Placemark')).forEach((pm, i) => {
      const nameEl = pm.getElementsByTagName('name')[0];
      const name = (nameEl && nameEl.textContent.trim()) || 'Area ' + (i + 1);
      Array.from(pm.getElementsByTagName('Polygon')).forEach((pg, j) => {
        const outer = pg.getElementsByTagName('outerBoundaryIs')[0] || pg;
        const c = outer.getElementsByTagName('coordinates')[0];
        if (!c) return;
        const ring = c.textContent.trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((p) => isFinite(p[0]) && isFinite(p[1])).map((p) => [p[1], p[0]]);
        if (ring.length >= 3) areas.push({ name: j ? name + ' (' + (j + 1) + ')' : name, ring, enabled: true });
      });
    });
    if (!areas.length) throw new Error('No polygons found. In My Maps, draw the areas as shapes, then export as KML (not KMZ).');
    return areas;
  }
  function inRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i], [yj, xj] = ring[j];
      if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inPx(x, y, path) {
    let inside = false;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
      const [xi, yi] = path[i], [xj, yj] = path[j];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  const OUTSIDE = 'Outside all zones';
  const areaOf = (r, fence) => {
    if (!fence || r.lat == null) return null;
    if (r._zoneOf === fence && r._zone !== undefined) return r._zone;
    const a = fence.areas.find((x) => inRing(r.lat, r.lng, x.ring));
    r._zoneOf = fence; r._zone = a ? a.name : OUTSIDE;
    return r._zone;
  };

  // Background tiles are fetched through Tampermonkey and drawn on a canvas (the site blocks loading map images directly).
  // Several free sources are tried in turn; the first one that answers is used and remembered.
  const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  const TILES = {
    sources: [
      { id: 'esri-gray', label: 'Light grey (Esri)', host: 'server.arcgisonline.com', maxZ: 16, url: (z, x, y) => 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/' + z + '/' + y + '/' + x, attr: 'Tiles © Esri, HERE, Garmin, ' + OSM_ATTR },
      { id: 'esri-street', label: 'Streets (Esri)', host: 'server.arcgisonline.com', url: (z, x, y) => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/' + z + '/' + y + '/' + x, attr: 'Tiles © Esri, HERE, Garmin, ' + OSM_ATTR },
      { id: 'osm', label: 'Streets (OpenStreetMap)', host: 'tile.openstreetmap.org', referer: true, maxZ: 19, url: (z, x, y) => 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png', attr: OSM_ATTR },
      { id: 'osm-fr', label: 'Streets (OSM France)', host: 'tile.openstreetmap.fr', referer: true, url: (z, x, y) => 'https://' + 'abc'[(x + y) % 3] + '.tile.openstreetmap.fr/hot/' + z + '/' + x + '/' + y + '.png', attr: OSM_ATTR + ', tiles OSM France' },
    ],
    src: 0, cache: new Map(), pending: new Map(), health: {}, auto: true,
    init() {
      if (PREFS.mapBg === 'google' || PREFS.mapBg === 'carto') { delete PREFS.mapBg; savePrefs(); }   // removed in v1.23: they didn't load on the FPs' laptops
      const fixed = TILES.sources.findIndex((s) => s.id === PREFS.mapBg);
      const worked = TILES.sources.findIndex((s) => s.id === PREFS.tileWorking);
      TILES.auto = fixed < 0;
      TILES.src = fixed >= 0 ? fixed : worked >= 0 ? worked : 0;
    },
    cur() { return TILES.sources[TILES.src]; },
    h(id) { return TILES.health[id] || (TILES.health[id] = { ok: 0, fail: 0, err: null }); },
    attribution() { return TILES.cur().attr; },
    dead(s) { const h = TILES.h(s.id); return h.ok === 0 && h.fail >= 3; },
    failed() { return TILES.auto ? TILES.sources.every((s) => TILES.dead(s)) : TILES.dead(TILES.cur()); },
    diag() { return TILES.sources.filter((s) => TILES.health[s.id]).map((s) => { const h = TILES.h(s.id); return s.label + ': ' + (h.ok ? 'OK' : h.err || 'no answer'); }).join(' · '); },
    load(url, src) {
      return new Promise((resolve, reject) => {
        const decode = (blob) => (typeof createImageBitmap === 'function' ? createImageBitmap(blob) : Promise.reject(new Error('browser can\'t decode images'))).then(resolve, () => reject(new Error('reply was not an image')));
        if (typeof GM_xmlhttpRequest === 'function') {
          GM_xmlhttpRequest({
            method: 'GET', url, responseType: 'arraybuffer', timeout: 15000, headers: src.referer ? { Referer: 'https://www.breadfast.com/' } : {},
            onload: (r) => {
              if (r.status < 200 || r.status >= 300) return reject(new Error('HTTP ' + r.status));
              const d = r.response;
              if (!d || !(d.byteLength || d.size)) return reject(new Error('empty reply'));
              decode(d instanceof Blob ? d : new Blob([d], { type: /\.png/.test(url) ? 'image/png' : 'image/jpeg' }));
            },
            onerror: (e) => reject(new Error('blocked by Tampermonkey or the network' + (e && e.error ? ' (' + e.error + ')' : ''))),
            ontimeout: () => reject(new Error('timed out (a Tampermonkey permission prompt may be waiting)')),
          });
        } else {
          origFetch(url, { mode: 'cors' }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status)))).then(decode, () => reject(new Error('Tampermonkey request not available, and the site blocks direct loading')));
        }
      });
    },
    // Returns { img, sx, sy, s } to draw, or null while loading. Above a source's max zoom the parent tile is scaled up.
    get(z, x, y, onReady) {
      const src = TILES.cur();
      const mz = src.maxZ || 18;
      const dz = Math.max(0, z - mz);
      const pz = z - dz, px = x >> dz, py = y >> dz;
      const key = src.id + '/' + pz + '/' + px + '/' + py;
      const sub = (img) => { const n = 1 << dz, s = 256 / n; return { img, sx: (x - (px << dz)) * s, sy: (y - (py << dz)) * s, s }; };
      if (TILES.cache.has(key)) return sub(TILES.cache.get(key));
      if (!TILES.pending.has(key)) {
        const h = TILES.h(src.id);
        TILES.pending.set(key, TILES.load(src.url(pz, px, py), src).then((bmp) => {
          h.ok++; h.err = null;
          if (TILES.auto && PREFS.tileWorking !== src.id) { PREFS.tileWorking = src.id; savePrefs(); }
          TILES.cache.set(key, bmp);
          if (TILES.cache.size > 600) TILES.cache.delete(TILES.cache.keys().next().value);
        }).catch((e) => {
          h.fail++; h.err = e.message;
          // In auto mode, move on to the next source that hasn't failed yet.
          if (TILES.auto && TILES.cur() === src && TILES.dead(src)) {
            const next = TILES.sources.findIndex((s) => !TILES.dead(s));
            if (next >= 0) TILES.src = next;
          }
        }).finally(() => { TILES.pending.delete(key); onReady && onReady(); }));
      }
      return null;
    },
  };
  TILES.init();

  /* ---------- Google map (borrowed from the page) ---------- */
  const GMAP = {
    div: null, map: null, ov: null, legend: null, raf: 0, target: null, paintFn: null, hoverFn: null, loading: null, failed: false, fitFn: null,
    ready() { const g = PW.google && PW.google.maps; return !!(g && g.Map && g.OverlayView && g.LatLng && g.Point); },
    findKey() {
      if (CAP.mapsKey) return CAP.mapsKey;
      try {
        const n = performance.getEntriesByType('resource').map((x) => x.name).find((u) => /maps\.googleapis\.com\/maps\/api\/js\?/.test(u) && /[?&]key=/.test(u));
        if (n) return new URL(n).searchParams.get('key');
      } catch (e) { }
      return PREFS.mapsKey || null;
    },
    ensure() {
      if (GMAP.ready()) return Promise.resolve(true);
      if (GMAP.failed || PREFS.noGoogle) return Promise.resolve(false);
      if (GMAP.loading) return GMAP.loading;
      GMAP.loading = new Promise((res) => {
        const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
        const key = GMAP.findKey();
        if (!existing && !key) { GMAP.failed = true; res(false); return; }
        if (!existing) {
          PW.__fpbMapsReady = function () { };
          const s = document.createElement('script');
          s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&v=weekly&callback=__fpbMapsReady';
          s.async = true;
          (document.head || document.documentElement).appendChild(s);
          if (PREFS.mapsKey !== key) { PREFS.mapsKey = key; savePrefs(); }
        }
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (GMAP.ready()) { clearInterval(iv); res(true); } else if (Date.now() - t0 > 8000) { clearInterval(iv); GMAP.failed = true; res(false); }
        }, 200);
      });
      return GMAP.loading;
    },
    mount(target, A, L) {
      const G = PW.google.maps;
      const st = MAP.state;
      if (!GMAP.div) {
        GMAP.div = document.createElement('div');
        GMAP.div.id = 'fpb-gmap';
        GMAP.div.style.cssText = 'position:fixed;z-index:2147483001;display:none;overflow:hidden;border-radius:8px;background:#F0EFEB;';
        document.body.appendChild(GMAP.div);
        GMAP.div.addEventListener('mousemove', (e) => { const r = GMAP.div.getBoundingClientRect(); GMAP.hoverFn && GMAP.hoverFn(e.clientX - r.left, e.clientY - r.top, e.clientX, e.clientY); });
        GMAP.div.addEventListener('mouseleave', () => { const tip = UI.root.querySelector('.tip'); tip.style.display = 'none'; });
      }
      if (!GMAP.map) {
        const v = st.view || { lat: 30.04, lng: 31.35, z: 13 };
        GMAP.map = new G.Map(GMAP.div, {
          center: { lat: v.lat, lng: v.lng }, zoom: v.z, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy',
          styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }, { featureType: 'transit', stylers: [{ visibility: 'off' }] }, { elementType: 'geometry', stylers: [{ saturation: -60 }] }],
        });
        GMAP.ov = GMAP.makeOverlay(G);
        GMAP.ov.setMap(GMAP.map);
        GMAP.legend = document.createElement('div');
        GMAP.legend.style.cssText = 'margin:12px;background:rgba(255,255,255,.95);border:1px solid #C8C9C7;border-radius:8px;padding:8px 10px;font:12px/1.45 "Segoe UI",system-ui,sans-serif;color:#343434;min-width:170px;max-width:280px;display:flex;flex-direction:column;gap:4px;';
        GMAP.map.controls[G.ControlPosition.LEFT_BOTTOM].push(GMAP.legend);
        const fitBtn = document.createElement('button');
        fitBtn.textContent = '⤢ Fit';
        fitBtn.title = 'Fit to orders and zones';
        fitBtn.style.cssText = 'margin:10px;background:#fff;border:1px solid #C8C9C7;border-radius:6px;padding:6px 10px;font:600 13px "Segoe UI",system-ui,sans-serif;color:#343434;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.15);';
        fitBtn.addEventListener('click', () => GMAP.fitFn && GMAP.fitFn());
        GMAP.map.controls[G.ControlPosition.TOP_LEFT].push(fitBtn);
        GMAP.map.addListener('idle', () => { const c = GMAP.map.getCenter(); if (c) st.view = { lat: c.lat(), lng: c.lng(), z: GMAP.map.getZoom() }; GMAP.ov.draw(); });
      }
      GMAP.fitFn = () => {
        const b = MAP.bounds(A, L);
        if (!b) return;
        GMAP.map.fitBounds(new G.LatLngBounds({ lat: b[0], lng: b[1] }, { lat: b[2], lng: b[3] }), 30);
      };
      GMAP.paintFn = (ctx, toPx, W, H, z) => { const out = MAP.paint(ctx, toPx, W, H, z, L, A); GMAP.legend.innerHTML = out.legend; GMAP.last = out; };
      GMAP.hoverFn = (mx, my, cx, cy) => MAP.hover(GMAP.last, L, A, mx, my, cx, cy);
      GMAP.target = target;
      target.classList.add('gm');
      GMAP.div.style.display = 'block';
      GMAP.position();
      if (!st.view) GMAP.fitFn(); else { GMAP.map.setCenter({ lat: st.view.lat, lng: st.view.lng }); GMAP.map.setZoom(st.view.z); }
      GMAP.ov.draw();
      cancelAnimationFrame(GMAP.raf);
      const loop = () => { if (!GMAP.position()) return; GMAP.raf = requestAnimationFrame(loop); };
      GMAP.raf = requestAnimationFrame(loop);
    },
    // Keeps the page-level map exactly over its placeholder inside the panel, clipped to the scrolling area.
    position() {
      const t = GMAP.target;
      if (!t || !t.isConnected || !UI.isOpen()) { GMAP.hide(); return false; }
      const r = t.getBoundingClientRect(), m = UI.root.querySelector('main').getBoundingClientRect();
      const s = GMAP.div.style;
      const w = Math.round(r.width), h = Math.round(r.height);
      if (s.width !== w + 'px' || s.height !== h + 'px') { s.width = w + 'px'; s.height = h + 'px'; GMAP.ov && GMAP.ov.draw(); }
      s.left = r.left + 'px'; s.top = r.top + 'px';
      const top = Math.max(0, m.top - r.top), bottom = Math.max(0, r.bottom - m.bottom), left = Math.max(0, m.left - r.left), right = Math.max(0, r.right - m.right);
      s.visibility = top + bottom >= r.height || left + right >= r.width ? 'hidden' : 'visible';
      s.clipPath = 'inset(' + top + 'px ' + right + 'px ' + bottom + 'px ' + left + 'px round 8px)';
      return true;
    },
    hide() {
      cancelAnimationFrame(GMAP.raf);
      if (GMAP.div) GMAP.div.style.display = 'none';
      GMAP.target = null;
    },
    makeOverlay(G) {
      function Ov() { this.canvas = document.createElement('canvas'); this.canvas.style.cssText = 'position:absolute;pointer-events:none;'; }
      Ov.prototype = new G.OverlayView();
      Ov.prototype.onAdd = function () { this.getPanes().overlayLayer.appendChild(this.canvas); };
      Ov.prototype.onRemove = function () { if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas); };
      Ov.prototype.draw = function () {
        const proj = this.getProjection();
        if (!proj || !GMAP.div || !GMAP.paintFn) return;
        const W = GMAP.div.clientWidth, H = GMAP.div.clientHeight;
        if (!W || !H) return;
        const tl = proj.fromLatLngToDivPixel(proj.fromContainerPixelToLatLng(new G.Point(0, 0)));
        const dpr = window.devicePixelRatio || 1;
        const c = this.canvas;
        c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
        c.style.left = tl.x + 'px'; c.style.top = tl.y + 'px';
        const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
        const toPx = (lat, lng) => { const p = proj.fromLatLngToContainerPixel(new G.LatLng(lat, lng)); return [p.x, p.y]; };
        GMAP.paintFn(ctx, toPx, W, H, GMAP.map.getZoom());
      };
      return new Ov();
    },
  };

  const MAP = {
    state: { filter: 'all', shift: 'all', mode: null, view: null, source: 'auto', bg: 'auto' },
    FILTERS: [['all', 'All orders'], ['late', 'Late orders'], ['coffee', 'Coffee'], ['pharma', 'Pharmacy'], ['large', 'Large baskets']],
    triedAreas: false,
    fence(A) {
      const kml = loadKmlFence();
      const fp = (UI.meta && UI.meta.fps && UI.meta.fps[0]) || fpIdFromCapture();
      const off = fp ? FPSTAT.loadAreas(fp) : null;
      if (MAP.state.source === 'kml' && kml) return { kind: 'kml', label: kml.file || 'your KML', areas: kml.areas };
      if (off) return { kind: 'official', label: 'Breadfast sub-areas (Location vs fence)', areas: off.areas, savedAt: off.savedAt };
      if (kml) return { kind: 'kml', label: kml.file || 'your KML', areas: kml.areas };
      return null;
    },
    points(A) {
      const st = MAP.state;
      return A.rows.filter((r) => !r.subOrder || r.pharma).filter((r) => r.lat != null && isFinite(r.lat) && isFinite(r.lng)).filter((r) => {
        if (st.shift !== 'all' && r.shift !== st.shift) return false;
        if (st.filter === 'late') return r.late;
        if (st.filter === 'coffee') return r.coffee;
        if (st.filter === 'pharma') return r.pharma;
        if (st.filter === 'large') return r.skus >= CFG.LARGE_BASKET_SKUS;
        return true;
      });
    },
    layers(A) {
      const fence = MAP.fence(A);
      const pts = MAP.points(A);
      const byArea = {};
      let shownMain = 0;
      if (fence) pts.forEach((p) => { if (p.subOrder) return; shownMain++; const a = areaOf(p, fence); const s = byArea[a] || (byArea[a] = { n: 0, late: 0 }); s.n++; if (p.late) s.late++; });
      const maxShare = Math.max(0.01, ...Object.keys(byArea).filter((k) => k !== OUTSIDE).map((k) => byArea[k].n / Math.max(1, shownMain)));
      return { fence, pts, byArea, shownMain, maxShare };
    },
    bounds(A, L) {
      const all = A.rows.filter((r) => r.lat != null && isFinite(r.lat));
      let b = null;
      if (all.length) {
        const lats = all.map((r) => r.lat).sort((a, c) => a - c), lngs = all.map((r) => r.lng).sort((a, c) => a - c);
        const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
        b = [q(lats, 0.01), q(lngs, 0.01), q(lats, 0.99), q(lngs, 0.99)];
      }
      if (L.fence) L.fence.areas.forEach((a) => a.ring.forEach(([la, ln]) => { if (!b) b = [la, ln, la, ln]; b[0] = Math.min(b[0], la); b[1] = Math.min(b[1], ln); b[2] = Math.max(b[2], la); b[3] = Math.max(b[3], ln); }));
      return b;
    },
    html(A) {
      const st = MAP.state;
      const fence = MAP.fence(A);
      const kml = loadKmlFence();
      const fp = (UI.meta && UI.meta.fps && UI.meta.fps[0]) || fpIdFromCapture();
      const off = fp ? FPSTAT.loadAreas(fp) : null;
      if (!st.mode) st.mode = fence ? 'areas' : 'heat';
      if (st.mode === 'areas' && !fence) st.mode = 'heat';
      const seg = (name, opts, cur) => '<div class="seg" data-seg="' + name + '">' + opts.map(([k, l]) => '<button data-v="' + k + '" class="' + (cur === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
      const modes = (fence ? [['areas', 'Zone share']] : []).concat([['heat', 'Heat'], ['grid', 'Grid'], ['dots', 'Dots']]);
      let h = '<div class="note"><b>Zone share</b> colours each sub-area by its share of the orders shown, so you can see which zones carry the FP. <b>Heat</b> shows where orders concentrate inside the zones; <b>Grid</b> counts orders in ~200 m squares (zoom in for numbers). Hover a zone or square for its numbers. ' +
        (fence && fence.kind === 'official' ? 'Zone shapes come from Breadfast\'s own sub-areas (the Location vs fence tab), saved ' + new Date(fence.savedAt).toLocaleDateString('en-GB') + '.' : '') + '</div>';
      h += '<div class="mapbar">' + seg('mode', modes, st.mode) + seg('filter', MAP.FILTERS.filter((f) => cpShowLabel(f[1])), st.filter) + seg('shift', [['all', 'All shifts']].concat(CFG.SHIFTS.map((s) => [s.name, s.name])), st.shift) + '<span class="sp"></span>' +
        (off && kml ? seg('source', [['auto', 'Breadfast zones'], ['kml', 'My KML']], st.source === 'kml' ? 'kml' : 'auto') : '') +
        '<button class="ghost" data-act="zones">' + (off ? '↻ Zones' : 'Load Breadfast zones') + '</button>' +
        '<label class="filebtn">' + (kml ? 'Replace KML' : 'Import KML') + '<input type="file" accept=".kml,application/vnd.google-earth.kml+xml" data-act="kml" hidden></label>' +
        (kml ? '<button class="ghost" data-act="clearfence">Remove KML</button>' : '') +
        '<label class="mini bgpick">Background <select class="sel" data-bg>' + [['auto', 'Auto (best available)']].concat(TILES.sources.map((x) => [x.id, x.label])).concat([['none', 'None (zones only)']]).map(([v, l]) => '<option value="' + v + '"' + ((PREFS.mapBg || 'auto') === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label></div>';
      if (!off && FPSTAT.areasErr) h += '<div class="note err">Couldn\'t load Breadfast zones: ' + esc(FPSTAT.areasErr) + '. Open the Location vs fence tab once (the brain reads the zones from it), then come back.</div>';
      h += '<div class="mapwrap"><div class="map" tabindex="0" aria-label="Order map"><canvas class="tiles-l"></canvas><canvas class="heat-c"></canvas><div class="mapctl"><button data-z="1" aria-label="Zoom in">+</button><button data-z="-1" aria-label="Zoom out">−</button><button data-z="0" aria-label="Fit to orders" title="Fit to orders">⤢</button></div><div class="attr"></div><div class="maplegend"></div><div class="tilewarn" hidden></div></div></div>';
      h += '<div class="mapsummary"></div><div class="fence-table"></div>';
      if (!fence) h += card('Zones', '', '<p class="sub" style="margin:0">Press <b>Load Breadfast zones</b> to draw your FP\'s official sub-areas, or open the Location vs fence tab once and the brain picks them up automatically. You can also import your own Google My Maps KML.</p>');
      return h;
    },
    paint(ctx, toPx, W, H, z, L, A) {
      const st = MAP.state, pts = L.pts, fence = L.fence;
      const RAMP = [[244, 211, 226], [211, 146, 198], [184, 81, 163], [166, 37, 140], [107, 24, 90]];
      const rampAt = (t) => { t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1); const i = Math.floor(t), f = t - i; const a = RAMP[i], b = RAMP[Math.min(RAMP.length - 1, i + 1)]; return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)); };
      const rgb = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : a) + ')';
      const cells = [], polys = [];
      let legend = '';
      if (fence) fence.areas.forEach((a) => polys.push({ a, path: a.ring.map(([la, ln]) => toPx(la, ln)) }));
      const tracePath = (p) => { ctx.beginPath(); p.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
      if (st.mode === 'areas' && fence) {
        polys.forEach((p) => {
          const s = L.byArea[p.a.name];
          const share = s ? s.n / Math.max(1, L.shownMain) : 0;
          tracePath(p);
          ctx.fillStyle = share ? rgb(rampAt(share / L.maxShare), 0.45) : 'rgba(255,255,255,0.12)';
          ctx.fill();
        });
        legend = '<b>Share of orders shown, by zone</b><span class="rampbar" style="display:block;height:10px;border-radius:3px;background:linear-gradient(90deg,#F6D3EA,#D392C6,#C94FA8,#AA0382,#6B185A)"></span><span style="display:flex;justify-content:space-between;color:#66718a"><span>0%</span><span>' + fmt(100 * L.maxShare, 0) + '%</span></span>' + (L.byArea[OUTSIDE] ? '<span style="color:#44506a">' + L.byArea[OUTSIDE].n + ' orders outside all zones</span>' : '');
      } else if (st.mode === 'heat' && pts.length) {
        const r = Math.max(10, Math.min(40, 6 * Math.pow(1.45, z - 12)));
        const off = document.createElement('canvas'); off.width = W; off.height = H; const o = off.getContext('2d');
        pts.forEach((p) => { const [x, y] = toPx(p.lat, p.lng); if (x < -r || y < -r || x > W + r || y > H + r) return; const g = o.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(0,0,0,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)'); o.fillStyle = g; o.fillRect(x - r, y - r, 2 * r, 2 * r); });
        const img = o.getImageData(0, 0, W, H), d = img.data;
        let maxA = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > maxA) maxA = d[i];
        maxA = Math.max(maxA, 40);
        for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (!a) continue; const t = a / maxA; const c = rampAt(t); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = Math.round(Math.min(1, 0.25 + t) * 215); }
        o.putImageData(img, 0, 0);
        ctx.drawImage(off, 0, 0, W, H);
        legend = '<b>Order density</b><span style="display:block;height:10px;border-radius:3px;background:linear-gradient(90deg,#F6D3EA,#D392C6,#C94FA8,#AA0382,#6B185A)"></span><span style="display:flex;justify-content:space-between;color:#66718a"><span>fewer</span><span>more</span></span>';
      } else if (st.mode === 'grid' && pts.length) {
        const DLAT = 0.0018, DLNG = 0.0021; // ~200 m
        const bins = new Map();
        pts.forEach((p) => { const k = Math.floor(p.lat / DLAT) + ':' + Math.floor(p.lng / DLNG); const b = bins.get(k) || { n: 0, late: 0, i: Math.floor(p.lat / DLAT), j: Math.floor(p.lng / DLNG) }; b.n++; if (p.late) b.late++; bins.set(k, b); });
        const max = Math.max(...Array.from(bins.values()).map((b) => b.n));
        bins.forEach((b) => {
          const [xa, ya] = toPx((b.i + 1) * DLAT, b.j * DLNG), [xb, yb] = toPx(b.i * DLAT, (b.j + 1) * DLNG);
          const w = xb - xa, hh = yb - ya;
          if (xb < 0 || yb < 0 || xa > W || ya > H) return;
          ctx.fillStyle = rgb(rampAt(b.n / max), 0.72); ctx.fillRect(xa + 0.5, ya + 0.5, w - 1, hh - 1);
          cells.push({ xa, ya, xb, yb, b });
          if (w > 24 && hh > 16) { ctx.fillStyle = b.n / max > 0.55 ? '#fff' : '#383938'; ctx.font = '600 ' + Math.min(14, Math.max(10, w / 4)) + 'px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(b.n), xa + w / 2, ya + hh / 2); }
        });
        legend = '<b>Orders per ~200 m square</b><span style="display:block;height:10px;border-radius:3px;background:linear-gradient(90deg,#F6D3EA,#D392C6,#C94FA8,#AA0382,#6B185A)"></span><span style="display:flex;justify-content:space-between;color:#66718a"><span>1</span><span>' + max + '</span></span>';
      } else if (st.mode === 'dots') {
        pts.forEach((p) => { const [x, y] = toPx(p.lat, p.lng); if (x < -5 || y < -5 || x > W + 5 || y > H + 5) return; ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fillStyle = p.late ? '#E16C6F' : '#1393CD'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); });
        legend = '<b>Orders</b><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:#1393CD"></i>On time / open</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:#E16C6F"></i>Late</span>';
      }
      if (!pts.length) legend = '<b>No orders match this filter</b>';
      // zone outlines and labels
      if (fence) {
        polys.forEach((p) => { tracePath(p); ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(56,57,56,.85)'; ctx.setLineDash(p.a.enabled === false ? [5, 4] : []); ctx.stroke(); });
        ctx.setLineDash([]);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        polys.forEach((p) => {
          // area-weighted centroid in screen space
          let A2 = 0, cx = 0, cy = 0;
          for (let i = 0, j = p.path.length - 1; i < p.path.length; j = i++) { const f = p.path[j][0] * p.path[i][1] - p.path[i][0] * p.path[j][1]; A2 += f; cx += (p.path[j][0] + p.path[i][0]) * f; cy += (p.path[j][1] + p.path[i][1]) * f; }
          const area = Math.abs(A2 / 2);
          if (!A2 || area < 1800) return;
          cx /= 3 * A2; cy /= 3 * A2;
          if (cx < 0 || cy < 0 || cx > W || cy > H) return;
          const s = L.byArea[p.a.name] || { n: 0 };
          const l1 = p.a.name, l2 = s.n + (s.n === 1 ? ' order · ' : ' orders · ') + fmt(rate(s.n, L.shownMain), 0) + '%';
          ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
          const w1 = ctx.measureText(l1).width; ctx.font = '600 11.5px "Segoe UI", system-ui, sans-serif'; const w2 = ctx.measureText(l2).width;
          const bw = Math.max(w1, w2) + 14;
          ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(cx - bw / 2, cy - 17, bw, 34);
          ctx.strokeStyle = 'rgba(56,57,56,.25)'; ctx.lineWidth = 1; ctx.strokeRect(cx - bw / 2, cy - 17, bw, 34);
          ctx.fillStyle = '#383938'; ctx.font = '700 12px "Segoe UI", system-ui, sans-serif'; ctx.fillText(l1, cx, cy - 7);
          ctx.fillStyle = '#606160'; ctx.font = '600 11.5px "Segoe UI", system-ui, sans-serif'; ctx.fillText(l2, cx, cy + 8);
        });
      }
      if (A.fp) { const [x, y] = toPx(A.fp.lat, A.fp.lng); ctx.beginPath(); ctx.arc(x, y, 8, 0, 2 * Math.PI); ctx.fillStyle = '#383938'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#383938'; ctx.font = '700 12px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('FP', x + 12, y + 1); }
      return { cells, polys, legend };
    },
    zoneStats(A, fence) {
      const st = MAP.state;
      const base = A.rows.filter((r) => st.shift === 'all' || r.shift === st.shift);
      const groups = groupBy(base, (r) => areaOf(r, fence));
      const mainTotal = base.filter((r) => !r.subOrder && r.lat != null).length;
      const names = fence.areas.map((a) => a.name).concat(groups.has(OUTSIDE) ? [OUTSIDE] : []);
      return Array.from(new Set(names)).map((n) => {
        const g = groups.get(n) || []; const s = summarize(g); const orders = g.filter((r) => !r.subOrder).length;
        const nowLate = g.filter((r) => !r.subOrder && r.delivered && !r.scheduled);
        return { name: n, orders, share: rate(orders, mainTotal), coffee: s.coffee, coffeeLate: s.coffeeLate, pharma: s.pharma, pharmaLate: s.pharmaLate, delivered: s.delivered, late: s.late, latePct: s.latePct, eta: rate(nowLate.filter((r) => r.late).length, nowLate.length), roadLate: s.causes['Ride'], inStore: s.causes['Packed after deadline'] + s.causes['Packed too late'], waited: s.causes['Awaiting pickup'], medDist: median(g.map((r) => r.distKm)), medLeg: s.medLeg, avgSkus: s.avgSkus, p90Now: s.p90Now, p90Proxy: s.p90Proxy };
      });
    },
    hover(out, L, A, mx, my, cx, cy) {
      const tip = UI.root.querySelector('.tip');
      if (!out) { tip.style.display = 'none'; return; }
      let html = '';
      const c = MAP.state.mode === 'grid' && out.cells.find((k) => mx >= k.xa && mx <= k.xb && my >= k.ya && my <= k.yb);
      if (c) html = '<b>' + c.b.n + ' orders</b> (' + fmtPct(rate(c.b.n, L.pts.length)) + ' of shown)<br>' + c.b.late + ' late';
      const p = out.polys.find((q) => inPx(mx, my, q.path));
      if (p) {
        if (!MAP._zs || MAP._zsKey !== MAP.state.shift + '|' + L.fence.kind) { MAP._zs = MAP.zoneStats(A, L.fence); MAP._zsKey = MAP.state.shift + '|' + L.fence.kind; }
        const z = MAP._zs.find((x) => x.name === p.a.name);
        const s = L.byArea[p.a.name] || { n: 0, late: 0 };
        html += (html ? '<br><br>' : '') + '<b>' + esc(p.a.name) + '</b>' + (p.a.enabled === false ? ' (disabled)' : '') + '<br>Shown: ' + s.n + (s.n === 1 ? ' order (' : ' orders (') + fmtPct(rate(s.n, L.shownMain)) + ')' +
          (z ? '<br>All orders' + (MAP.state.shift !== 'all' ? ' this shift' : '') + ': ' + z.orders + ', ETA late ' + fmtPct(z.eta) + '<br>P90 NOW ' + fmt(z.p90Now) + ' · incl. forced ' + fmt(z.p90Proxy) + ' min' + (hasCP() ? '<br>' + [hasCoffee() ? 'Coffee ' + z.coffee : '', hasPharma() ? 'Pharmacy ' + z.pharma : ''].filter(Boolean).join(' · ') : '') + '<br>Late on ride (stage) ' + z.roadLate + ' · late in FP (stage) ' + z.inStore : '');
      }
      if (!html) { tip.style.display = 'none'; return; }
      tip.innerHTML = html; tip.style.display = 'block';
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = cx + 14, y = cy + 14;
      if (x + w > window.innerWidth - 8) x = cx - w - 14;
      if (y + h > window.innerHeight - 8) y = cy - h - 14;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    },
    mount(scope, A) {
      const el = scope.querySelector('.map');
      if (!el) return;
      MAP._zs = null;
      const L = MAP.layers(A);
      const st = MAP.state;
      // controls shared by both backgrounds
      scope.querySelectorAll('.seg[data-seg]').forEach((sg) => sg.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; st[sg.dataset.seg] = b.dataset.v; if (sg.dataset.seg === 'source') st.view = null; UI.render(); }));
      const kml = scope.querySelector('input[data-act="kml"]');
      if (kml) kml.addEventListener('change', () => {
        const f = kml.files && kml.files[0]; if (!f) return;
        f.text().then((t) => { try { saveKmlFence({ areas: parseKml(t), file: f.name, savedAt: Date.now() }); st.source = 'kml'; st.view = null; UI.render(); } catch (err) { scope.querySelector('.mapsummary').innerHTML = '<div class="note err">' + esc(err.message) + '</div>'; } });
      });
      const cf = scope.querySelector('[data-act="clearfence"]');
      if (cf) cf.addEventListener('click', () => { saveKmlFence(null); st.source = 'auto'; UI.render(); });
      const zb = scope.querySelector('[data-act="zones"]');
      const fp = (UI.meta && UI.meta.fps && UI.meta.fps[0]) || fpIdFromCapture();
      if (zb) zb.addEventListener('click', () => { zb.disabled = true; zb.textContent = 'Loading zones…'; FPSTAT.fetchAreas(fp).then(() => { st.view = null; UI.render(); }); });
      if (!L.fence && fp && !MAP.triedAreas) { MAP.triedAreas = true; FPSTAT.fetchAreas(fp).then((z) => { if (z && UI.tab === 'map') { st.mode = 'areas'; st.view = null; UI.render(); } }); }

      const bgPref = PREFS.mapBg || 'auto';
      const wantGoogle = false;   // the Google background was removed in v1.23 (it didn't load reliably)
      const useGoogle = wantGoogle && GMAP.ready();
      if (useGoogle) GMAP.mount(el, A, L);
      else {
        MAP.mountCanvas(el, A, L);
        if (wantGoogle && !GMAP.failed) GMAP.ensure().then((ok) => { if (ok && UI.tab === 'map' && el.isConnected) UI.render(); });
      }
      // summary + zone table
      const label = MAP.FILTERS.find((f) => f[0] === st.filter)[1] + (st.shift !== 'all' ? ', ' + st.shift + ' shift' : '');
      const bgTxt = useGoogle ? 'Google map' : bgPref === 'none' ? 'none (zones only)' : TILES.cur().label;
      scope.querySelector('.mapsummary').innerHTML = '<p class="sub" style="margin:10px 0 18px">' + L.pts.length + ' orders shown (' + esc(label) + ').' + (A.fp ? ' The dark dot is the FP.' : '') + ' Background: ' + esc(bgTxt) + '.' +
        '</p>';
      const bs = scope.querySelector('select[data-bg]');
      if (bs) bs.addEventListener('change', () => {
        PREFS.mapBg = bs.value === 'auto' ? undefined : bs.value; savePrefs();
        if (TILES.health[bs.value]) delete TILES.health[bs.value];
        if (bs.value === 'google') GMAP.failed = false, GMAP.loading = null;
        TILES.init(); UI.render();
      });
      const ft = scope.querySelector('.fence-table');
      if (ft && L.fence) {
        const rowsT = MAP.zoneStats(A, L.fence);
        const wc = (n, l) => (n ? n + (l ? ' <span class="muted">(' + l + ' late)</span>' : '') : '<span class="muted">0</span>');
        ft.innerHTML = card('Orders by zone', 'Zones: ' + esc(L.fence.label) + ', ' + L.fence.areas.length + ' shapes.' + (st.shift !== 'all' ? ' ' + st.shift + ' shift only.' : '') + ' Each order is placed in a zone by its map pin. Cancelled orders and sub-orders are excluded from Orders and Share.', table([
          ['Zone', (r) => r.name, null, 'l'], ['Orders', (r) => r.orders], ['Share of orders', (r) => r.share, (r) => '<span class="sharebar"><i style="width:' + Math.min(100, (r.share || 0) * 2.5) + '%"></i></span>' + fmtPct(r.share)],
          ['ETA late %', (r) => r.eta, (r) => latePill(r.eta)], ['Late (all)', (r) => r.late], ['Late in FP (stage)', (r) => r.inStore], ['Late awaiting pickup (stage)', (r) => r.waited], ['Late on ride (stage)', (r) => r.roadLate],
          ['Coffee', (r) => r.coffee, (r) => wc(r.coffee, r.coffeeLate)], ['Pharmacy', (r) => r.pharma, (r) => wc(r.pharma, r.pharmaLate)],
          ['Avg SKUs', (r) => r.avgSkus, (r) => fmt(r.avgSkus, 1)], ['Straight-line km (median)', (r) => r.medDist, (r) => fmt(r.medDist, 1)], ['Median ride (min)', (r) => r.medLeg, (r) => fmt(r.medLeg, 1)], ...P90_COLS,
        ], rowsT.sort((a, b) => b.orders - a.orders)));
        bindTables(ft); bindTips(ft); greenPills(ft);
      }
    },
    mountCanvas(el, A, L) {
      const canvas = el.querySelector('canvas.heat-c'), tilesL = el.querySelector('canvas.tiles-l'), legendEl = el.querySelector('.maplegend');
      const TS = 256;
      const proj = (lat, lng, z) => { const s = TS * Math.pow(2, z); const sin = Math.sin((lat * Math.PI) / 180); return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s]; };
      const unproj = (x, y, z) => { const s = TS * Math.pow(2, z); const lng = (x / s) * 360 - 180; const n = Math.PI - (2 * Math.PI * y) / s; return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng]; };
      let W = el.clientWidth, H = el.clientHeight;
      const st = MAP.state;
      const fit = () => {
        const b = MAP.bounds(A, L);
        if (!b) return { lat: 30.04, lng: 31.35, z: 13 };
        let z = 17;
        while (z > 10) { const p1 = proj(b[2], b[1], z), p2 = proj(b[0], b[3], z); if (p2[0] - p1[0] < W - 60 && p2[1] - p1[1] < H - 60) break; z--; }
        return { lat: (b[0] + b[2]) / 2, lng: (b[1] + b[3]) / 2, z };
      };
      if (!st.view) st.view = fit();
      st.view.z = Math.round(st.view.z);
      const drawTiles = () => {
        const z = st.view.z, c = proj(st.view.lat, st.view.lng, z);
        const x0 = c[0] - W / 2, y0 = c[1] - H / 2, n = Math.pow(2, z);
        const dpr = window.devicePixelRatio || 1;
        if (tilesL.width !== W * dpr || tilesL.height !== H * dpr) { tilesL.width = W * dpr; tilesL.height = H * dpr; tilesL.style.width = W + 'px'; tilesL.style.height = H + 'px'; }
        const tctx = tilesL.getContext('2d'); tctx.setTransform(dpr, 0, 0, dpr, 0, 0); tctx.fillStyle = '#F0EFEB'; tctx.fillRect(0, 0, W, H);
        for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x0 + W) / TS); tx++) {
          for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y0 + H) / TS); ty++) {
            if (ty < 0 || ty >= n) continue;
            const wx = ((tx % n) + n) % n;
            if (PREFS.mapBg === 'none') continue;
            const t = TILES.get(z, wx, ty, () => { if (st.view.z === z) requestTiles(); });
            if (t) tctx.drawImage(t.img, t.sx, t.sy, t.s, t.s, Math.round(tx * TS - x0), Math.round(ty * TS - y0), TS, TS);
          }
        }
        const warn = el.querySelector('.tilewarn');
        const bad = PREFS.mapBg !== 'none' && TILES.failed();
        warn.hidden = !bad;
        if (bad) warn.innerHTML = '<b>Map background couldn\'t load.</b> ' + esc(TILES.diag()) + '.<br>Fix: click the Tampermonkey icon; if it asks to allow a site for this script, choose <b>Always allow all domains</b>. Then press ⤢. If it still fails, send these errors to Claude.';
        el.querySelector('.attr').innerHTML = PREFS.mapBg === 'none' ? '' : TILES.attribution();
        return [x0, y0];
      };
      let tilePending = false;
      const requestTiles = () => { if (tilePending) return; tilePending = true; requestAnimationFrame(() => { tilePending = false; if (el.isConnected) drawTiles(); }); };
      let out = null;
      const draw = () => {
        W = el.clientWidth; H = el.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
        const [x0, y0] = drawTiles();
        const z = st.view.z;
        out = MAP.paint(ctx, (lat, lng) => { const p = proj(lat, lng, z); return [p[0] - x0, p[1] - y0]; }, W, H, z, L, A);
        legendEl.innerHTML = out.legend;
      };
      let drag = null;
      el.addEventListener('mousedown', (e) => { if (e.target.closest('.mapctl, .attr')) return; drag = { x: e.clientX, y: e.clientY, c: proj(st.view.lat, st.view.lng, st.view.z) }; el.classList.add('dragging'); });
      const onMove = (e) => {
        if (drag) { const nx = drag.c[0] - (e.clientX - drag.x), ny = drag.c[1] - (e.clientY - drag.y); const ll = unproj(nx, ny, st.view.z); st.view.lat = ll[0]; st.view.lng = ll[1]; draw(); return; }
        if (!el.isConnected) return;
        const rect = el.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom || !e.composedPath().includes(el)) return;
        MAP.hover(out, L, A, e.clientX - rect.left, e.clientY - rect.top, e.clientX, e.clientY);
      };
      const onUp = () => { drag = null; el.classList.remove('dragging'); };
      if (MAP.cleanup) MAP.cleanup();
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
      el.addEventListener('mouseleave', () => { UI.root.querySelector('.tip').style.display = 'none'; });
      MAP.cleanup = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      const zoomAt = (dz, mx, my) => {
        const z = st.view.z, nz = Math.max(10, Math.min(18, z + dz)); if (nz === z) return;
        const c = proj(st.view.lat, st.view.lng, z); const px = c[0] - W / 2 + mx, py = c[1] - H / 2 + my; const ll = unproj(px, py, z);
        const p2 = proj(ll[0], ll[1], nz); const nc = unproj(p2[0] - mx + W / 2, p2[1] - my + H / 2, nz);
        st.view = { lat: nc[0], lng: nc[1], z: nz }; draw();
      };
      el.addEventListener('wheel', (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      el.querySelectorAll('.mapctl button').forEach((b) => b.addEventListener('click', () => { const dz = +b.dataset.z; if (dz === 0) { st.view = fit(); draw(); } else zoomAt(dz, W / 2, H / 2); }));
      el.addEventListener('keydown', (e) => { if (e.key === '+' || e.key === '=') zoomAt(1, W / 2, H / 2); if (e.key === '-') zoomAt(-1, W / 2, H / 2); });
      draw();
    },
  };

  /* ---------- day views ---------- */
  const shiftRate = (A, name, k) => { const x = A.score && A.score.shiftRates && A.score.shiftRates.find((s) => s.name === name); return x ? x[k] : null; };
  const DAY_VIEWS = {
    slots(A) {
      const total = Object.assign({ label: 'Day total', shiftedIn: A.slots.reduce((s, x) => s + x.shiftedIn, 0), dayBeforeSched: A.slots.reduce((s, x) => s + x.dayBeforeSched, 0) }, A.day);
      return card('Timeslot breakdown', '"Shifted in" = forced orders that went into this slot (scheduled express, NOW slot full or FP BUSY when placed, or under ' + CFG.PLANNED_AHEAD_HOURS + 'h ahead when nothing was recorded). "Planned ahead" = the other scheduled orders. ETA late % = NOW orders. ' + CAUSE_HELP,
        table([
          ['Timeslot', (r) => (r.slot == null ? 99 : r.slot), (r) => esc(r.label), 'l'],
          ['Shift', (r) => r.shift || '', null, 'l'],
          ['Orders', (r) => r.orders], ['Delivered', (r) => r.delivered], ['Late', (r) => r.late],
          ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)],
          ['NOW', (r) => r.nowCount], ['Scheduled', (r) => r.schedCount],
          ['Forced in', (r) => r.shiftedIn], ['Preferred', (r) => r.dayBeforeSched],
          ['Coffee', (r) => r.coffee, (r) => r.coffee + (r.coffeeLate ? ' <span class="muted">(' + r.coffeeLate + ' late)</span>' : '')],
          ['Pharmacy', (r) => r.pharma, (r) => r.pharma + (r.pharmaLate ? ' <span class="muted">(' + r.pharmaLate + ' late)</span>' : '')],
          ['Avg SKUs', (r) => r.avgSkus, (r) => fmt(r.avgSkus, 1)], ['Avg bags', (r) => r.avgBags, (r) => fmt(r.avgBags, 1)], ['Large baskets', (r) => r.largeBaskets],
          ['Not rec.', (r) => r.notReceived],
          ...P90_COLS,
          ['Med. prep NOW', (r) => r.medPrepNow, (r) => fmt(r.medPrepNow, 1)],
          ['Med. awaiting pickup', (r) => r.medShelf, (r) => fmt(r.medShelf, 1)],
          ['Med. ride', (r) => r.medLeg, (r) => fmt(r.medLeg, 1)],
          ['Packed after ETA (stage)', (r) => r.causes['Packed after deadline']], ['Packed too late (stage)', (r) => r.causes['Packed too late']], ['Late awaiting pickup (stage)', (r) => r.causes['Awaiting pickup']], ['Late on ride (stage)', (r) => r.causes['Ride']],
        ], A.slots, { total }));
    },

    shifted(A) {
      const S = A.shifted;
      let h = '<div class="note">The system has no "forced" flag, so this compares when each scheduled order was <b>placed</b> with the slot it was <b>scheduled into</b>. Orders scheduled less than ' + CFG.PLANNED_AHEAD_HOURS + ' hours ahead are treated as possible shifts (FP closure, prayer, capacity); orders scheduled further ahead are treated as planned by the customer. Forced and voluntary orders are still mixed in the first group, so read big jumps (e.g. 12 PM → 8 PM) as the forced ones.</div>';
      h += '<div class="tiles">' + tile('Scheduled orders', S.total, '') + tile('Scheduled < ' + CFG.PLANNED_AHEAD_HOURS + 'h ahead', S.sameDay, 'possible shifts') + tile('Planned ' + CFG.PLANNED_AHEAD_HOURS + 'h+ ahead', S.dayBefore, 'likely voluntary') +
        tile('Shifted 3h+', S.over3h, 'out of the possible shifts') + tile('Shifted 6h+', S.over6h, 'out of the possible shifts') + tile('Median shift', fmt(S.medShiftH, 1) + ' h', 'possible shifts only') + '</div>';
      const top = S.flows.filter((f) => f.from !== 'Preferred').sort((a, b) => b.n - a.n).slice(0, 15);
      h += card('Biggest shifts', 'Placed in → scheduled into', top.length ? '<ul class="flat">' + top.map((f) => '<li><b>' + f.n + '</b> orders placed at ' + hourLabel(f.from) + ' → scheduled into ' + slotLabel(f.to) + ' <span class="muted">(' + (((f.to - f.from) + 24) % 24) + 'h later)</span></li>').join('') + '</ul>' : '<p class="muted">None.</p>');
      // Matrix
      const fromKeys = Array.from(new Set(S.flows.map((f) => f.from))).sort((a, b) => (a === 'Preferred' ? -1 : b === 'Preferred' ? 1 : a - b));
      const toKeys = Array.from(new Set(S.flows.map((f) => f.to))).sort((a, b) => a - b);
      const maxN = Math.max(1, ...S.flows.map((f) => f.n));
      const cell = (n) => {
        if (!n) return '<td class="muted">·</td>';
        const a = 0.12 + 0.75 * (n / maxN);
        return '<td style="background:rgba(170,3,130,' + a.toFixed(2) + ');color:' + (a > 0.5 ? '#fff' : 'inherit') + ';font-weight:650">' + n + '</td>';
      };
      let m = '<div class="tw"><table class="heat"><thead><tr><th>Placed ↓ / Scheduled into →</th>' + toKeys.map((t) => '<th style="text-align:center">' + shortHour(t) + '</th>').join('') + '</tr></thead><tbody>';
      fromKeys.forEach((f) => {
        m += '<tr><td>' + (f === 'Preferred' ? 'Preferred' : hourLabel(f)) + '</td>' + toKeys.map((t) => { const x = S.flows.find((z) => z.from === f && z.to === t); return cell(x && x.n); }).join('') + '</tr>';
      });
      m += '</tbody></table></div>';
      h += card('Shift matrix', 'Rows = hour the order was placed. Columns = timeslot it was scheduled into. Darker = more orders.', m);
      return h;
    },

    areas(A) {
      let h = '';
      if (!A.hasDistance) h += '<div class="note">Couldn\'t read the FP\'s coordinates, so distances are blank.</div>';
      const roadKm = loadRoadKm();
      const sa = A.subAreas.map((r) => Object.assign({}, r, { roadKm: roadKm[r.name] != null ? roadKm[r.name] : null }));
      const withCount = (n, late) => (n ? n + (late ? ' <span class="muted">(' + late + ' late)</span>' : '') : '<span class="muted">0</span>');
      const totalRow = {
        name: 'Day total', orders: sa.reduce((t, r) => t + r.orders, 0), share: 100, delivered: A.day.delivered, late: A.day.late, latePct: A.day.latePct,
        coffee: A.day.coffee, coffeeLate: A.day.coffeeLate, pharma: A.day.pharma, pharmaLate: A.day.pharmaLate, roadLate: A.day.causes['Ride'],
        medDist: median(A.rows.map((r) => r.distKm)), farDist: pct(A.rows.map((r) => r.distKm), 0.9), roadKm: null, medLeg: A.day.medLeg, p90Now: A.day.p90Now, p90Proxy: A.day.p90Proxy, isTotal: true,
      };
      h += '<div class="note"><b>How distance is measured:</b> straight-line ("as the crow flies") from the FP\'s coordinates to the customer\'s pin. Real road distance is longer, often 1.5–2× because of one-way streets, U-turns and highways. Type the real road distance for a sub-area into the <b>Road km</b> column (e.g. from Google Maps); it\'s saved in this browser and used for <b>Min per road km</b>. <b>Median ride</b> is the actual time DAs spent from pickup to delivery, so it already reflects real roads and traffic.</div>';
      h += card('Sub-areas', 'Orders and share exclude cancelled orders and sub-orders.' + (hasCP() ? ' ' + cpTitle() + ' show' + (hasCoffee() && hasPharma() ? '' : 's') + ' late orders in brackets.' : ''), table([
        ['Sub-area', (r) => r.name, null, 'l'], ['Orders', (r) => r.orders], ['Share of day', (r) => r.share, (r) => fmtPct(r.share)],
        ['Coffee', (r) => r.coffee, (r) => withCount(r.coffee, r.coffeeLate)], ['Pharmacy', (r) => r.pharma, (r) => withCount(r.pharma, r.pharmaLate)],
        ['Delivered', (r) => r.delivered], ['Late', (r) => r.late], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)], ['Late on ride (stage)', (r) => r.roadLate],
        ['Straight-line km (median)', (r) => r.medDist, (r) => fmt(r.medDist, 1)], ['Straight-line km (far end)', (r) => r.farDist, (r) => fmt(r.farDist, 1)],
        ['Road km', (r) => r.roadKm, (r) => (r.isTotal ? '' : '<input class="km" data-sa="' + esc(r.name) + '" value="' + (r.roadKm != null ? r.roadKm : '') + '" placeholder="–" inputmode="decimal" aria-label="Road km for ' + esc(r.name) + '">')],
        ['Median ride (min)', (r) => r.medLeg, (r) => fmt(r.medLeg, 1)], ['Min per road km', (r) => (r.roadKm && r.medLeg != null ? r.medLeg / r.roadKm : null), (r) => (r.roadKm && r.medLeg != null ? fmt(r.medLeg / r.roadKm, 1) : '<span class="muted">–</span>')],
        ...P90_COLS,
      ], sa.sort((a, b) => b.orders - a.orders), { total: totalRow }));
      if (A.distance.length) {
        h += card('Distance bands (straight-line)', 'How delivery time and lateness change with each extra straight-line km. Road distance is longer, so treat the bands as relative, not exact.', table([
          ['Distance', (r) => r.label, null, 'l'], ['Orders', (r) => r.orders], ['Delivered', (r) => r.delivered], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)],
          ['Late on ride (stage)', (r) => r.roadLate], ['Median ride', (r) => r.medLeg, (r) => fmt(r.medLeg, 1)], ...P90_COLS,
        ], A.distance));
      }
      return h;
    },

    types(A) {
      const T = A.types;
      let h = '<div class="tiles">' + T.filter((t) => cpShowLabel(t.type)).map((t) => tile(t.type, t.orders, t.delivered ? fmtPct(t.latePct) + ' late. P90: ' + fmt(t.p90Now) + ' min NOW, ' + fmt(t.p90Proxy) + ' min incl. forced' : 'No delivery timing for this date')).join('') + '</div>';
      h += '<div class="note">' + (hasCoffee() ? '<b>Coffee</b> = orders with a Breadfast Coffee item (picker + barista). ' : '') + (hasPharma() ? '<b>Pharmacy</b> = orders with a pharmacy sub-order. The sub-order closes within seconds, so lateness is judged on the parent order. If the parent isn\'t on this date, the pharmacy order is counted but has no timing. ' : '') + '<b>Sub-order</b> rows are excluded from all lateness and P90 numbers.</div>';
      h += card('By order type', '', table([
        ['Type', (r) => r.type, null, 'l'], ['Orders', (r) => r.orders], ['Delivered', (r) => r.delivered], ['Late', (r) => r.late], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)],
        ...P90_COLS, ['Med. awaiting pickup', (r) => r.medShelf, (r) => fmt(r.medShelf, 1)], ['Med. ride', (r) => r.medLeg, (r) => fmt(r.medLeg, 1)],
        ['Late in FP (stage)', (r) => r.causes['Packed after deadline'] + r.causes['Packed too late']], ['Late awaiting pickup (stage)', (r) => r.causes['Awaiting pickup']], ['Late on ride (stage)', (r) => r.causes['Ride']],
      ], T.filter((t) => cpShowLabel(t.type))));
      const slotCols = (key, lateKey, delKey) => [
        ['Timeslot', (r) => r.slot, (r) => esc(r.label), 'l'], ['Orders', (r) => r[key]], ['Late', (r) => r[lateKey]],
        ['ETA late %', (r) => rate(r[lateKey], r[delKey]), (r) => latePill(rate(r[lateKey], r[delKey]))], ['Share of slot', (r) => rate(r[key], r.orders), (r) => fmtPct(rate(r[key], r.orders))],
      ];
      h += '<div class="grid two">';
      h += card('Coffee by timeslot', '', table(slotCols('coffee', 'coffeeLate', 'coffeeDelivered'), A.slots.filter((s) => s.coffee)));
      h += card('Pharmacy by timeslot', '', A.slots.some((s) => s.pharma) ? table(slotCols('pharma', 'pharmaLate', 'pharmaDelivered'), A.slots.filter((s) => s.pharma)) : '<p class="muted">No pharmacy orders.</p>');
      h += '</div>';
      return h;
    },

    baskets(A) {
      const main = A.rows.filter((r) => !r.subOrder);
      const SKU_B = [[1, 3], [4, 6], [7, 10], [11, 15], [16, 20], [21, 999]];
      const BAG_B = [[1, 2], [3, 4], [5, 7], [8, 12], [13, 999]];
      const bLabel = ([lo, hi], unit) => (hi === 999 ? lo + '+ ' + unit : lo + '–' + hi + ' ' + unit);
      const inB = (v, [lo, hi]) => v != null && v >= lo && v <= hi;
      const bucketRows = (B, key, unit) => B.map((bk) => {
        const g = main.filter((r) => inB(r[key], bk));
        const s = summarize(g);
        return { label: bLabel(bk, unit), orders: g.length, share: rate(g.length, main.length), latePct: s.latePct, inStore: s.causes['Packed after deadline'] + s.causes['Packed too late'], medBuffer: median(g.map((r) => r.bufferAtPackMin)), medPrep: s.medPrepNow, p90Now: s.p90Now, p90Proxy: s.p90Proxy };
      }).filter((x) => x.orders);
      const bucketCols = (first) => [
        [first, (r) => r.label, null, 'l'], ['Orders', (r) => r.orders], ['Share', (r) => r.share, (r) => fmtPct(r.share)], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)],
        ['Late in FP (stage)', (r) => r.inStore], ['Median prep, NOW (min)', (r) => r.medPrep, (r) => fmt(r.medPrep, 1)], ['Median buffer at pack (min)', (r) => r.medBuffer, (r) => fmt(r.medBuffer, 0)], ...P90_COLS,
      ];
      // Spread per timeslot: each cell = orders in that size band (late in brackets)
      const spread = (B, key, unit) => {
        const bySlot = groupBy(main, (r) => r.slot);
        const slotsSorted = Array.from(bySlot.keys()).filter((h) => h != null).sort((x, y) => x - y);
        const maxCell = Math.max(1, ...slotsSorted.map((h) => Math.max(...B.map((bk) => bySlot.get(h).filter((r) => inB(r[key], bk)).length))));
        const cell = (g) => {
          if (!g.length) return '<td class="muted">·</td>';
          const late = g.filter((r) => r.late).length;
          const a = 0.08 + 0.5 * (g.length / maxCell);
          return '<td data-tip="' + esc(g.length + ' orders, ' + late + ' late') + '" style="background:rgba(170,3,130,' + a.toFixed(2) + ')"><b>' + g.length + '</b>' + (late ? ' <span class="lt">' + late + ' late</span>' : '') + '</td>';
        };
        let t = '<div class="tw"><table class="spread"><thead><tr><th class="l">Timeslot</th>' + B.map((bk) => '<th>' + bLabel(bk, unit) + '</th>').join('') + '<th>Orders</th><th>Avg ' + unit + '</th><th>Late %</th></tr></thead><tbody>';
        slotsSorted.forEach((h) => {
          const g = bySlot.get(h);
          const del = g.filter((r) => r.delivered);
          const lp = rate(del.filter((r) => r.late).length, del.filter((r) => r.late != null).length);
          t += '<tr><td class="l">' + esc(slotLabel(h)) + '</td>' + B.map((bk) => cell(g.filter((r) => inB(r[key], bk)))).join('') +
            '<td><b>' + g.length + '</b></td><td>' + fmt(avg(g.map((r) => r[key])), 1) + '</td><td>' + latePill(lp) + '</td></tr>';
        });
        const totals = '<tr class="total"><td class="l">Day total</td>' + B.map((bk) => { const g = main.filter((r) => inB(r[key], bk)); const late = g.filter((r) => r.late).length; return '<td><b>' + g.length + '</b>' + (late ? ' <span class="lt">' + late + ' late</span>' : '') + '</td>'; }).join('') +
          '<td><b>' + main.length + '</b></td><td>' + fmt(avg(main.map((r) => r[key])), 1) + '</td><td>' + latePill(A.day.latePct) + '</td></tr>';
        return t + '</tbody><tfoot>' + totals + '</tfoot></table></div>';
      };
      let h = '<div class="note">Basket size is measured by <b>unique SKUs</b> (different products in the order), because one bag can hold ten different items. Bags are kept alongside for reference. Unit quantities aren\'t in the Control Room list, so 3 bottles of the same water count as 1 SKU. <b>Buffer at pack</b> = minutes left before the deadline when the order was packed.</div>';
      h += card('Basket size spread per timeslot (unique SKUs)', 'Each cell shows how many orders in that slot fell in that size band, with late orders in red. Darker = more orders.', spread(SKU_B, 'skus', 'SKUs'));
      h += card('Basket size spread per timeslot (bags)', 'Same view by bag count, for reference.', spread(BAG_B, 'bags', 'bags'));
      h += '<div class="grid two">';
      h += card('Lateness by SKU count', '', table(bucketCols('Unique SKUs'), bucketRows(SKU_B, 'skus', 'SKUs')));
      h += card('Lateness by bag count', '', table(bucketCols('Bags'), bucketRows(BAG_B, 'bags', 'bags')));
      h += '</div>';
      h += card('Largest orders (' + CFG.LARGE_BASKET_SKUS + '+ unique SKUs)', 'Change the threshold in the SETTINGS block at the top of the script.', A.largeOrders.length ? table([
        ['Order', (r) => r.orderNumber, null, 'l'], ['Slot', (r) => r.slot, (r) => esc(slotLabel(r.slot)), 'l'], ['Unique SKUs', (r) => r.skus], ['Bags', (r) => r.bags],
        ['Late', (r) => (r.late ? 1 : 0), (r) => (r.late == null ? '–' : r.late ? '<span class="pill bad">late</span>' : '<span class="pill good">on time</span>')],
        ['Cause', (r) => r.cause || '', null, 'l'], ['Picker', (r) => r.pickerName || '', null, 'l'], ['Packed', (r) => r.packed, (r) => fmtTime(r.packed)], ['Buffer at pack (min)', (r) => r.bufferAtPackMin, (r) => fmt(r.bufferAtPackMin, 0)],
      ], A.largeOrders.slice(0, 40)) : '<p class="muted">No orders at or above the threshold.</p>');
      return h;
    },

  };

  /* ------------------------------------------------------------------
   * DA-SPECIFIC DATA: live DA list, availability recorder, assignment logs
   * ------------------------------------------------------------------ */

  async function fetchDAs(fpId) {
    const j = await apiGet('https://' + API_HOST + '/control-room/delivery-associates?fpId=' + encodeURIComponent(fpId) + '&type=grocery');
    return (j && j.data) || [];
  }
  // T = on a trip, L = locked, A = available and waiting, U = unavailable
  const daStatus = (d) => ((d.numberOfAssignedTrips > 0 || d.numberOfAssignedOrders > 0) ? 'T' : d.locked ? 'L' : d.available ? 'A' : 'U');
  const STATUS_INFO = {
    T: { label: 'On a trip', color: '#1393CD' },
    L: { label: 'Locked', color: '#7179B9' },
    A: { label: 'Available, waiting', color: '#46B976' },
    U: { label: 'Unavailable', color: '#C3C4C3' },
  };

  // Records the DAs Availability list every few minutes while the Control Room is open.
  // Only status changes are stored (per FP, per day, in this browser), so it stays small.
  const DAREC = {
    timer: null, last: null, lastError: null, snapshot: null,
    key: (fp, dk) => STORE_DAREC + fp + ':' + dk,
    load(fp, dk) { try { return JSON.parse(localStorage.getItem(DAREC.key(fp, dk)) || 'null'); } catch (e) { return null; } },
    start() {
      if (DAREC.timer) return;
      DAREC.timer = setInterval(DAREC.poll, CFG.POLL_MIN * MIN);
      setTimeout(DAREC.poll, 4000);
    },
    async poll() {
      if (!/controlroom/i.test(location.pathname + location.search)) return;
      const fp = fpIdFromCapture();
      if (!fp) return;
      try {
        const list = await fetchDAs(fp);
        const t = Date.now();
        DAREC.save(fp, list, t);
        DAREC.last = t; DAREC.lastError = null; DAREC.snapshot = { t, fp, list };
        LIVE.refresh();
      } catch (e) { DAREC.lastError = e.message; }
    },
    save(fp, list, t) {
      const dk = dateKeyOf(t);
      const r = DAREC.load(fp, dk) || { das: {}, seg: [] };
      const lastSeg = r.seg[r.seg.length - 1];
      if (lastSeg && t - lastSeg[1] <= CFG.POLL_MIN * MIN * 3) lastSeg[1] = t; else r.seg.push([t, t]);
      list.forEach((d) => {
        const id = String(d.userId);
        const e = r.das[id] || (r.das[id] = { ev: [] });
        e.n = d.name; e.hr = d.hrId; e.tier = d.tierId; e.oc = d.ordersCount; e.fc = d.fixedCost;
        const s = daStatus(d);
        const prev = e.ev[e.ev.length - 1];
        if (!prev || prev[1] !== s) e.ev.push([t, s]);
      });
      try { localStorage.setItem(DAREC.key(fp, dk), JSON.stringify(r)); } catch (e) { }
      DAREC.prune();
    },
    prune() {
      const cutoff = Date.now() - CFG.KEEP_DAYS * 86400000;
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (!k || k.indexOf(STORE_DAREC) !== 0) continue;
          const dk = k.split(':').pop(); const ds = dayStartOf(dk);
          if (ds && ds < cutoff) localStorage.removeItem(k);
        }
      } catch (e) { }
    },
  };

  // Time spent in each status, per DA, inside the recorded windows.
  function availabilityFrom(rec, dayStart) {
    if (!rec || !rec.seg || !rec.seg.length) return null;
    const POLL = CFG.POLL_MIN * MIN;
    const segs = rec.seg.map(([a, b]) => [a, b + POLL]);
    const recordedMs = segs.reduce((s, [a, b]) => s + (b - a), 0);
    const out = {};
    const hourly = Array.from({ length: 24 }, () => ({ T: 0, L: 0, A: 0, U: 0, ms: 0 }));
    const inPeak = (t) => { const h = new Date(t).getHours(); return CFG.PEAKS.some(([a, b]) => h >= a && h < b); };
    Object.keys(rec.das).forEach((id) => {
      const e = rec.das[id];
      const ms = { T: 0, L: 0, A: 0, U: 0 };
      const intervals = [];
      segs.forEach(([a, b]) => {
        let cur = null;
        e.ev.forEach(([t, s]) => { if (t <= a) cur = s; });
        let t0 = a;
        e.ev.filter(([t]) => t > a && t < b).forEach(([t, s]) => { if (cur) intervals.push([t0, t, cur]); cur = s; t0 = t; });
        if (cur) intervals.push([t0, b, cur]);
      });
      intervals.forEach(([a, b, s]) => {
        ms[s] += b - a;
        // split across clock hours for the coverage view
        let t = a;
        while (t < b) {
          const hEnd = Math.min(b, (Math.floor((t - dayStart) / 3600000) + 1) * 3600000 + dayStart);
          const h = Math.floor((t - dayStart) / 3600000);
          if (h >= 0 && h < 24) { hourly[h][s] += hEnd - t; }
          t = hEnd;
        }
      });
      const online = intervals.filter((x) => x[2] !== 'U');
      if (!online.length) { out[id] = { name: e.n, hr: e.hr, tier: e.tier, ms, intervals, online: false }; return; }
      const first = online[0][0], last = online[online.length - 1][1];
      const breaks = [];
      intervals.filter((x) => x[2] === 'U' && x[0] >= first && x[1] <= last).forEach((x) => {
        const prev = breaks[breaks.length - 1];
        if (prev && x[0] - prev[1] < 1000) prev[1] = x[1]; else breaks.push([x[0], x[1]]);
      });
      let peakU = 0;
      breaks.forEach(([a, b]) => { for (let t = a; t < b; t += MIN) if (inPeak(t)) peakU += MIN; });
      out[id] = {
        name: e.n, hr: e.hr, tier: e.tier, ms, intervals, online: true, first, last,
        breaks: breaks.length, longestBreak: breaks.length ? Math.max(...breaks.map(([a, b]) => b - a)) / MIN : 0,
        longBreaks: breaks.filter(([a, b]) => b - a >= CFG.BREAK_ALERT_MIN * MIN).length,
        peakUnavailMin: peakU / MIN, breakList: breaks,
      };
    });
    // recorded milliseconds per clock hour (for averaging DAs online)
    segs.forEach(([a, b]) => {
      let t = a;
      while (t < b) {
        const hEnd = Math.min(b, (Math.floor((t - dayStart) / 3600000) + 1) * 3600000 + dayStart);
        const h = Math.floor((t - dayStart) / 3600000);
        if (h >= 0 && h < 24) hourly[h].ms += hEnd - t;
        t = hEnd;
      }
    });
    return { das: out, segs, recordedMs, hourly };
  }

  /* ---------- assignment history (only for orders flagged as manually assigned) ---------- */
  function parseLogTime(s) {
    const m = /^(\d{1,2}) ([A-Za-z]{3}),? (\d{4}) (\d{1,2}):(\d{2}) ?(AM|PM)$/i.exec(String(s || '').trim());
    if (!m) { const p = Date.parse(s); return isFinite(p) ? p : null; }
    const mon = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2].toLowerCase()) / 3;
    const h = (+m[4] % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
    return new Date(+m[3], mon, +m[1], h, +m[5]).getTime();
  }
  const normName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  function parseAssignLogs(logs) {
    const ev = [];
    (logs || []).forEach((l) => {
      const txt = String(l.logDetails || '').replace(/<br\s*\/?>/gi, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
      const by = String(l.actionByName || '').replace(/\s+/g, ' ').trim();
      const sys = /^system$/i.test(by);
      const m = /assignee changed\s*(.+?)\s+assigned as a? ?delivery person/i.exec(txt);
      if (m) ev.push({ t: parseLogTime(l.logDateTime), to: m[1].trim(), by, sys });
      else if (/(unassign|removed).{0,40}delivery person/i.test(txt)) ev.push({ t: parseLogTime(l.logDateTime), to: null, by, sys, unassign: true });
    });
    return ev.sort((a, b) => (a.t || 0) - (b.t || 0));
  }
  function classifyAssign(ev) {
    if (!ev) return { cat: 'Manual (history not loaded)' };
    const sysEv = ev.filter((e) => e.sys && e.to);
    const human = ev.filter((e) => !e.sys && e.to);
    if (!human.length) return { cat: sysEv.length ? 'Auto, kept' : 'Manual (no assignment in history)', sysDa: sysEv.length ? sysEv[sysEv.length - 1].to : null };
    const firstHuman = human[0], lastHuman = human[human.length - 1];
    const sysBefore = sysEv.filter((e) => (e.t || 0) <= (firstHuman.t || 0)).pop();
    if (!sysBefore) return { cat: 'Manual only', toDa: lastHuman.to, by: lastHuman.by, changes: human.length };
    const changed = normName(lastHuman.to) !== normName(sysBefore.to);
    return {
      cat: changed ? 'Override (different DA)' : 'Re-assigned, same DA',
      sysDa: sysBefore.to, toDa: lastHuman.to, by: lastHuman.by, changes: human.length,
      minutesAfter: lastHuman.t != null && sysBefore.t != null ? (lastHuman.t - sysBefore.t) / MIN : null,
    };
  }
  async function fetchAssignHistory(rows, onProgress) {
    const targets = rows.filter((r) => r.assignType === 'manual' && !r.wasSub);
    const out = new Map();
    let i = 0, done = 0;
    const worker = async () => {
      while (i < targets.length) {
        const r = targets[i++];
        try {
          const j = await apiGet('https://' + API_HOST + '/control-room/orders/' + r.id);
          out.set(r.id, parseAssignLogs(j && j.data && j.data.logs));
        } catch (e) { out.set(r.id, null); }
        done++; onProgress && onProgress(done, targets.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CFG.HISTORY_CONCURRENCY, targets.length) }, worker));
    return out;
  }

  const ASSIGN_CATS = ['Auto, kept', 'Re-assigned, same DA', 'Override (different DA)', 'Manual only', 'Manual (no assignment in history)', 'Manual (history not loaded)'];
  // The three groups the official scorecard uses: auto and same-DA re-assignments count as auto-assigned; the rest is manual.
  const ASSIGN_GROUPS3 = ['Auto-assigned', 'Reassigned (same DA)', 'Manually assigned (different DA)'];
  const assignGroupOf = (cat) => (cat === 'Auto, kept' ? ASSIGN_GROUPS3[0] : cat === 'Re-assigned, same DA' ? ASSIGN_GROUPS3[1] : ASSIGN_GROUPS3[2]);
  const ASSIGN_DETAIL = { 'Override (different DA)': 'replaced the system\'s DA', 'Manual only': 'never auto-assigned', 'Manual (no assignment in history)': 'no assignment in the history', 'Manual (history not loaded)': 'history not read' };

  /* ---------- DA analysis ---------- */
  function analyzeDA(A, meta, assignHist, rec, liveList) {
    const dayStart = dayStartOf(meta.date);
    const rows = A.rows.filter((r) => !r.wasSub);
    // assignment categories
    rows.forEach((r) => {
      if (r.assignType === 'auto') r.assign = { cat: 'Auto, kept' };
      else if (r.assignType === 'manual') r.assign = classifyAssign(assignHist ? assignHist.get(r.id) : null);
      else r.assign = null;
    });
    const live = new Map((liveList || []).map((d) => [String(d.userId), d]));
    const avail = availabilityFrom(rec, dayStart);

    // per DA from orders
    const byDa = groupBy(rows.filter((r) => r.daId && r.delivered), (r) => String(r.daId));
    const das = new Map();
    const ensure = (id, name, hr) => {
      if (!das.has(id)) das.set(id, { id, name: name || '', hr: hr || '', trips: [], rows: [] });
      const d = das.get(id); if (!d.name && name) d.name = name; if (!d.hr && hr) d.hr = hr; return d;
    };
    byDa.forEach((g, id) => {
      const d = ensure(id, g[0].daName, g[0].daHr);
      d.rows = g;
      groupBy(g, (r) => String(r.tripId || ('order-' + r.id))).forEach((tg, tid) => {
        const start = Math.min(...tg.map((r) => r.pickedUp || r.completed));
        const end = Math.max(...tg.map((r) => r.completed));
        d.trips.push({ id: tid, number: tid.indexOf('order-') === 0 ? null : 'TRP-' + tid, start, end, orders: tg.length, late: tg.filter((r) => r.late).length, rows: tg });
      });
      d.trips.sort((a, b) => a.start - b.start);
    });
    // DAs seen in the live list or the recording, even with no deliveries
    live.forEach((v, id) => ensure(id, v.name, v.hrId));
    if (avail) Object.keys(avail.das).forEach((id) => { if (avail.das[id].online) ensure(id, avail.das[id].name, avail.das[id].hr); });

    const list = [];
    das.forEach((d) => {
      const g = d.rows, s = summarize(g);
      const trips = d.trips;
      const first = trips.length ? trips[0].start : null, last = trips.length ? trips[trips.length - 1].end : null;
      const spanH = first != null ? Math.max((last - first) / 3600000, 0.25) : null;
      const gaps = [];
      for (let i = 1; i < trips.length; i++) gaps.push((trips[i].start - trips[i - 1].end) / MIN);
      const busyMin = trips.reduce((t, x) => t + (x.end - x.start) / MIN, 0);
      const shiftCount = {};
      trips.forEach((t) => { const sh = shiftOf(new Date(t.start).getHours()); shiftCount[sh] = (shiftCount[sh] || 0) + 1; });
      const lv = live.get(d.id);
      const av = avail && avail.das[d.id];
      const onlineH = av && av.online ? (av.ms.T + av.ms.L + av.ms.A) / 3600000 : null;
      // only deliveries made while the recording was running count towards online DPH
      const inRec = avail ? g.filter((r) => avail.segs.some(([a, b]) => r.completed >= a && r.completed <= b)).length : 0;
      list.push({
        id: d.id, name: d.name, hr: d.hr, tier: lv ? lv.tierId : (av && av.tier) || '', fc: lv ? lv.fixedCost : null,
        shift: Object.keys(shiftCount).sort((a, b) => shiftCount[b] - shiftCount[a])[0] || '–',
        deliveries: g.length, tripsN: trips.length, perTrip: trips.length ? g.length / trips.length : null,
        first, last, spanH, dph: spanH ? g.length / spanH : null, dphOnline: onlineH && onlineH >= 0.5 ? inRec / onlineH : null, shortSpan: spanH != null && spanH < 1,
        busyPct: spanH ? (100 * busyMin) / (spanH * 60) : null,
        medLeg: s.medLeg, medDist: median(g.map((r) => r.distKm)), late: s.late, latePct: s.latePct, roadLate: s.causes['Ride'],
        gapsLong: gaps.filter((x) => x >= CFG.GAP_MIN).length, longestGap: gaps.length ? Math.max(...gaps) : null,
        takenAway: 0, given: 0, trips, av, onlineH,
      });
    });
    // overrides per DA
    const byName = new Map(list.map((x) => [normName(x.name), x]));
    rows.forEach((r) => {
      if (!r.assign || r.assign.cat !== 'Override (different DA)') return;
      const a = byName.get(normName(r.assign.sysDa)); if (a) a.takenAway++;
      const b = byName.get(normName(r.assign.toDa)); if (b) b.given++;
    });
    list.sort((a, b) => (a.first || 9e15) - (b.first || 9e15) || b.deliveries - a.deliveries);

    // coverage per clock hour (DAs on the road, from trips)
    const coverage = [];
    for (let h = 0; h < 24; h++) {
      const a = dayStart + h * 3600000, b = a + 3600000;
      const onRoad = list.filter((x) => x.trips.some((t) => t.start < b && t.end > a)).length;
      const slot = A.slots.find((s) => s.slot === h);
      const hr = avail && avail.hourly[h];
      const recOk = hr && hr.ms > 0;
      coverage.push({
        h, label: slotLabel(h), orders: slot ? slot.orders : 0, delivered: slot ? slot.delivered : 0, late: slot ? slot.late : 0, latePct: slot ? slot.latePct : null,
        waited: slot ? slot.causes['Awaiting pickup'] : 0, road: slot ? slot.causes['Ride'] : 0, onRoad,
        perDa: onRoad ? (slot ? slot.orders : 0) / onRoad : null,
        recOnline: recOk ? (hr.T + hr.L + hr.A) / hr.ms : null, recTrip: recOk ? hr.T / hr.ms : null, recAvail: recOk ? hr.A / hr.ms : null, recLocked: recOk ? hr.L / hr.ms : null,
      });
    }

    // assignments
    const assignRows = rows.filter((r) => r.assign);
    const catRow = (c, g) => { const s = summarize(g); return { cat: c, orders: g.length, share: rate(g.length, assignRows.length), delivered: s.delivered, late: s.late, latePct: s.latePct, roadLate: s.causes['Ride'], waited: s.causes['Awaiting pickup'], p90Now: s.p90Now, p90Proxy: s.p90Proxy }; };
    const cats = ASSIGN_CATS.map((c) => catRow(c, assignRows.filter((r) => r.assign.cat === c))).filter((c) => c.orders);
    const groups = ASSIGN_GROUPS3.map((c) => catRow(c, assignRows.filter((r) => assignGroupOf(r.assign.cat) === c)));
    const overrides = assignRows.filter((r) => r.assign.cat === 'Override (different DA)').sort((a, b) => (a.slot - b.slot));
    const byActor = new Map();
    assignRows.filter((r) => r.assign.by).forEach((r) => {
      const k = r.assign.by; const x = byActor.get(k) || { name: k, manual: 0, overrides: 0, same: 0, only: 0, late: 0, delivered: 0 };
      x.manual++; if (r.assign.cat === 'Override (different DA)') x.overrides++; if (r.assign.cat === 'Re-assigned, same DA') x.same++; if (r.assign.cat === 'Manual only') x.only++;
      if (r.delivered && r.late != null) { x.delivered++; if (r.late) x.late++; }
      byActor.set(k, x);
    });
    const assignBySlot = [];
    for (let h = 0; h < 24; h++) {
      const g = assignRows.filter((r) => r.slot === h); if (!g.length) continue;
      const c = (k) => g.filter((r) => r.assign.cat === k).length;
      const manual = g.length - c('Auto, kept') - c('Re-assigned, same DA');
      assignBySlot.push({ h, label: slotLabel(h), orders: g.length, auto: c('Auto, kept'), same: c('Re-assigned, same DA'), over: c('Override (different DA)'), only: c('Manual only'), manual, manualPct: rate(manual, g.length), autoPct: rate(g.length - manual, g.length) });
    }

    const active = list.filter((x) => x.deliveries);
    const totalSpan = active.reduce((t, x) => t + (x.spanH || 0), 0);
    const team = {
      activeDAs: active.length, deliveries: active.reduce((t, x) => t + x.deliveries, 0), trips: active.reduce((t, x) => t + x.tripsN, 0),
      dph: totalSpan ? active.reduce((t, x) => t + x.deliveries, 0) / totalSpan : null,
      // manual = given to a different DA by hand (or never auto-assigned); same = re-assigned to the system's DA, counts as auto
      manual: assignRows.filter((r) => assignGroupOf(r.assign.cat) === ASSIGN_GROUPS3[2]).length, same: assignRows.filter((r) => r.assign.cat === 'Re-assigned, same DA').length,
      overrides: overrides.length, assigned: assignRows.length,
      historyLoaded: !!assignHist,
    };
    team.perTrip = team.trips ? team.deliveries / team.trips : null;
    const D = { list, coverage, cats, groups, overrides, actors: Array.from(byActor.values()), assignBySlot, team, avail, dayStart, liveAt: liveList ? (DAREC.snapshot && DAREC.snapshot.t) : null, live: liveList || [] };
    if (typeof daRosterApply === 'function') daRosterApply(A, D, meta);
    return D;
  }

  /* ---------- DA views ---------- */
  const dphPill = (v) => {
    if (v == null || !isFinite(v)) return '<span class="muted">–</span>';
    const c = v >= CFG.DPH_TARGET ? 'good' : v >= CFG.WARN.dph ? 'warn' : 'bad';
    return '<span class="pill ' + c + '">' + v.toFixed(2) + '</span>';
  };
  const tierBadge = (t) => (t ? '<span class="tier">' + esc(t) + '</span>' : '');
  const recNote = (D, M) => {
    if (D.avail) return '<div class="note">Availability for this date was recorded for <b>' + hm(D.avail.recordedMs / MIN) + '</b> (' + D.avail.segs.map(([a, b]) => fmtTime(a) + '–' + fmtTime(b)).join(', ') + '). Times outside these windows are unknown.</div>';
    return '<div class="note">No availability recording for this date. DA times below come from their orders (first pickup to last delivery). To record exact available / unavailable times, keep the Control Room open; the script checks the DAs Availability list every ' + CFG.POLL_MIN + ' minutes.</div>';
  };

  function daTimeline(D) {
    const list = D.list.filter((x) => x.trips.length || (x.av && x.av.online));
    if (!list.length) return '<p class="muted">No DA activity on this date.</p>';
    const ds = D.dayStart;
    let maxT = ds + 24 * 3600000;
    list.forEach((x) => x.trips.forEach((t) => { if (t.end > maxT) maxT = t.end; }));
    maxT = Math.min(maxT, ds + 30 * 3600000);
    const hours = Math.ceil((maxT - ds) / 3600000);
    const L = 190, R = 12, W = 1240, rowH = 30, top = 26;
    const H = top + list.length * rowH + 8;
    const x = (t) => L + ((t - ds) / (hours * 3600000)) * (W - L - R);
    let s = '<svg class="tl" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="DA timeline">';
    // peak bands
    CFG.PEAKS.forEach(([a, b]) => { s += '<rect x="' + x(ds + a * 3600000) + '" y="' + (top - 6) + '" width="' + (x(ds + b * 3600000) - x(ds + a * 3600000)) + '" height="' + (H - top) + '" fill="var(--warn-band)"/>'; });
    for (let h = 0; h <= hours; h++) {
      const xx = x(ds + h * 3600000);
      s += '<line x1="' + xx + '" x2="' + xx + '" y1="' + (top - 6) + '" y2="' + (H - 4) + '" stroke="var(--grid)"/>';
      if (h < hours && h % 1 === 0) s += '<text x="' + (xx + 2) + '" y="14" class="ax">' + shortHour(h % 24) + '</text>';
    }
    list.forEach((d, i) => {
      const y = top + i * rowH;
      if (i % 2) s += '<rect x="0" y="' + (y - 2) + '" width="' + W + '" height="' + rowH + '" fill="var(--band)"/>';
      s += '<text x="8" y="' + (y + 16) + '" class="nm">' + esc((d.name || '').slice(0, 24)) + (d.tier ? ' · ' + esc(d.tier) : '') + '</text>';
      // recorded availability band
      if (d.av && d.av.intervals) d.av.intervals.forEach(([a, b, st]) => {
        if (b <= ds || a >= maxT) return;
        s += '<rect x="' + x(Math.max(a, ds)) + '" y="' + (y + 20) + '" width="' + Math.max(1, x(Math.min(b, maxT)) - x(Math.max(a, ds))) + '" height="5" fill="' + STATUS_INFO[st].color + '" data-tip="' + esc(STATUS_INFO[st].label + ': ' + fmtTime(a) + '–' + fmtTime(b)) + '"/>';
      });
      d.trips.forEach((t) => {
        const xa = x(t.start), xb = Math.max(xa + 3, x(t.end));
        const tip = '<b>' + esc(t.number || 'Single order') + '</b><br>' + fmtTime(t.start) + ' – ' + fmtTime(t.end) + ' (' + hm((t.end - t.start) / MIN) + ')<br>' + t.orders + ' order' + (t.orders > 1 ? 's' : '') + (t.late ? ', <b>' + t.late + ' late</b>' : ', all on time');
        s += '<rect x="' + xa + '" y="' + (y + 3) + '" width="' + (xb - xa) + '" height="14" rx="3" fill="' + (t.late ? '#E16C6F' : '#1393CD') + '" data-tip="' + esc(tip) + '"/>';
      });
    });
    s += '</svg>';
    const legend = '<div class="legend"><span><i style="background:#1393CD"></i>Trip, all on time</span><span><i style="background:#E16C6F"></i>Trip with a late order</span>' +
      Object.keys(STATUS_INFO).map((k) => '<span><i style="background:' + STATUS_INFO[k].color + ';height:5px"></i>' + STATUS_INFO[k].label + ' (recorded)</span>').join('') + '<span><i style="background:var(--warn-band);border:1px solid #f0d9b5"></i>Peak hours</span></div>';
    return legend + '<div class="tw tlw">' + s + '</div>';
  }

  function coverageChart(D) {
    const rec = D.coverage.some((c) => c.recOnline != null);
    const items = D.coverage.filter((c) => c.orders || c.onRoad || c.recOnline).map((c) => ({
      label: c.label, short: shortHour(c.h),
      values: rec ? { t: c.recTrip || 0, l: c.recLocked || 0, a: c.recAvail || 0 } : { r: c.onRoad },
      tip: '<b>' + c.label + '</b><br>' + c.orders + ' orders, ' + c.late + ' late (' + fmtPct(c.latePct) + ')<br>DAs out on trips: ' + c.onRoad + (rec && c.recOnline != null ? '<br>DAs online (recorded): ' + c.recOnline.toFixed(1) + '<br>· on a trip ' + (c.recTrip || 0).toFixed(1) + ', waiting ' + (c.recAvail || 0).toFixed(1) : '') + '<br>Late, awaiting pickup: ' + c.waited,
    }));
    const series = rec ? [{ key: 't', color: STATUS_INFO.T.color }, { key: 'l', color: STATUS_INFO.L.color }, { key: 'a', color: STATUS_INFO.A.color }] : [{ key: 'r', color: '#1393CD' }];
    const legend = rec ? '<div class="legend"><span><i style="background:' + STATUS_INFO.T.color + '"></i>On a trip</span><span><i style="background:' + STATUS_INFO.L.color + '"></i>Locked</span><span><i style="background:' + STATUS_INFO.A.color + '"></i>Available, waiting</span></div>' : '<div class="legend"><span><i style="background:#1393CD"></i>DAs with a trip in this hour</span></div>';
    return legend + stackedChart(items, series, { h: 200, aria: 'DAs per hour' });
  }

  const DA_VIEWS = {
    overview(A, M) {
      const D = A.da, T = D.team, d = A.day;
      let h = '';
      h += '<div class="kpis">' +
        kpi('Active DAs', T.activeDAs, '', (D.list.length - T.activeDAs) ? (D.list.length - T.activeDAs) + ' more on the FP list with no deliveries' : 'DAs with at least one delivery', null) +
        kpi('DPH (Ops)', fmt(T.dpho, 2), '', 'Orders ÷ DA active hours (a DA in a clock hour in which they picked up 1+ order). Target ' + CFG.DPH_OPS_TARGET + '. DPH (hour by hour, DAs with ' + CFG.DPH_MIN_DELIVERIES + '+ pickups): ' + fmt(T.dph, 2), kpiStatus(kpiDef('dpho'), T.dpho)) +
        kpi('ETA late %', fmt(d.latePct, 1) + '%', '', (A.score ? accountability(A).counts[OWN_DISPATCH] + ' owned by logistics · ' : '') + d.causes['Ride'] + ' late on the ride, ' + d.causes['Awaiting pickup'] + ' awaiting pickup (all owners)', statusOf(d.latePct, CFG.LATE_TARGET_PCT, 2)) +
        kpi('Real overrides', T.historyLoaded ? T.overrides : '–', '', T.historyLoaded ? T.manual + ' manually assigned to a different DA, ' + T.overrides + ' of them replaced the system\'s DA' : 'Assignment history not loaded', null) +
        '</div>';
      h += '<div class="tiles">' +
        tile('Deliveries', T.deliveries, T.trips + ' trips') + tile('Orders per trip', fmt(T.perTrip, 2), '') +
        tile('Median ride', fmt(d.medLeg, 1) + '<span class="u">min</span>', 'DA pickup to delivered') + tile('Median awaiting pickup', fmt(d.medShelf, 1) + '<span class="u">min</span>', 'Packed to DA pickup') +
        tile('Auto-assigned', A.score ? fmtPct(A.score.v.auto) : '–', (A.score ? A.score.extra.manualN : T.manual) + ' manual (different DA)' + (T.same ? ', ' + T.same + ' same DA' : '')) +
        tile('Recording', D.avail ? hm(D.avail.recordedMs / MIN) : 'None', D.avail ? 'Availability recorded for this date' : 'Keep the Control Room open to record') + '</div>';
      h += recNote(D, M);
      h += card('Orders per timeslot', '', slotVolumeChart(A));
      h += card(D.avail ? 'DAs online per hour (recorded)' : 'DAs out on trips per hour', 'Compare with the orders above: hours where orders rise but DAs don\'t are where "awaiting pickup" lateness comes from.', coverageChart(D));
      h += card('Hourly coverage', '', table([
        ['Hour', (r) => r.h, (r) => esc(r.label), 'l'], ['Orders', (r) => r.orders], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)],
        ['DAs out on trips', (r) => r.onRoad], ['Orders per DA', (r) => r.perDa, (r) => fmt(r.perDa, 1)],
        ['DAs online (recorded)', (r) => r.recOnline, (r) => (r.recOnline == null ? '<span class="muted">–</span>' : fmt(r.recOnline, 1))],
        ['Waiting, no order (recorded)', (r) => r.recAvail, (r) => (r.recAvail == null ? '<span class="muted">–</span>' : fmt(r.recAvail, 1))],
        ['Late awaiting pickup (stage)', (r) => r.waited], ['Late on ride (stage)', (r) => r.road],
      ], D.coverage.filter((c) => c.orders || c.onRoad)));
      return h;
    },

    das(A) {
      const D = A.da;
      const ridePill = (v) => (v == null ? '<span class="muted">–</span>' : '<span class="pill ' + (v <= 0.95 ? 'good' : v <= 1.1 ? 'warn' : 'bad') + '">' + Math.round(v * 100) + '%</span>');
      const list = D.list.filter((x) => x.deliveries).sort((a, b) => (a.excluded - b.excluded) || ((a.rideIdx == null) - (b.rideIdx == null)) || (a.rideIdx - b.rideIdx));
      let h = '<div class="note"><b>Ride vs usual</b> = the first drop of each trip (a direct ride from the FP) against the usual ride to that sub-area today (100% = usual, lower = faster): the main speed measure, fair across near and far sub-areas. ' +
        '<b>Idle while orders waited</b> = of the minutes in their shift when packed orders were awaiting pickup, the share they were not on a trip (the ride back counts as a trip; their shift from DA shifts, or first pickup to last delivery if none is set). ' +
        '<b>Span</b> = first pickup to last delivery. <b>Active hours</b> = clock hours in which they picked up at least one order. <b>DPH (Ops)</b> = their deliveries ÷ their active hours, the same rule as the FP\'s DPH (Ops)' + (D.avail ? '; <b>DPH (online)</b> = deliveries made while recording ÷ recorded online time' : '') + '. <b>Busy %</b> = share of the span spent on trips. <b>Gaps</b> = breaks of ' + CFG.GAP_MIN + '+ min between one trip ending and the next starting (includes the ride back to the FP). <b>Late on ride (stage)</b> = left the FP with more time than ' + handoffTxt() + ' and still arrived late. <b>Lost / gained</b> = orders the coordinator moved away from / to this DA. ' +
        (D.team.notCounted ? '<b>' + D.team.notCounted + ' deliveries</b> were picked up outside the DA\'s shift (or on their day off) and are not counted for them; see DA shifts.' : 'Set each DA\'s shift on <b>DA shifts</b> so attendance and availability are measured against it.') + '</div>';
      h += card('DA performance', list.length + ' DAs delivered orders on this date, fastest first.', table([
        ['DA', (r) => r.name, (r) => esc(r.name) + ' <span class="muted">' + esc(r.hr || '') + '</span> ' + tierBadge(r.tier) + (r.excluded ? ' <span class="pill na">not ranked</span>' : ''), 'l'],
        ['Shift today', (r) => (r.plan && !r.plan.off ? r.plan.from : 99), (r) => (r.shiftSet ? esc(shiftTxt(r.plan)) : r.plan && r.plan.off ? '<span class="pill warn">day off</span>' : '<span class="muted">not set</span>')],
        ['Ride vs usual', (r) => r.rideIdx, (r) => ridePill(r.rideIdx) + (r.rideExtra != null ? ' <span class="muted">' + (r.rideExtra >= 0 ? '+' : '') + fmt(r.rideExtra, 1) + ' min · ' + r.rideN + ' rides</span>' : '')],
        ['Idle while orders waited', (r) => r.idleWaitPct, (r) => (r.idleWaitPct == null ? '<span class="muted">–</span>' : '<span class="pill ' + (r.idleWaitPct <= 20 ? 'good' : r.idleWaitPct <= 40 ? 'warn' : 'bad') + '">' + Math.round(r.idleWaitPct) + '%</span> <span class="muted">' + r.idleWaitMin + ' min</span>')],
        ['Deliveries', (r) => r.deliveries], ['Not counted', (r) => r.notCounted, (r) => (r.notCounted ? '<span class="pill warn">' + r.notCounted + '</span>' : '0')],
        ['Main shift', (r) => r.shift, null, 'l'], ['First pickup', (r) => r.first, (r) => fmtTime(r.first)], ['Last delivery', (r) => r.last, (r) => fmtTime(r.last)], ['Span (h)', (r) => r.spanH, (r) => fmt(r.spanH, 1)], ['Active hours', (r) => r.activeH],
        ['Trips', (r) => r.tripsN], ['Orders / trip', (r) => r.perTrip, (r) => fmt(r.perTrip, 2)],
        ['DPH (Ops)', (r) => r.dph, (r) => kpiPill('dpho', r.dph)]].concat(D.avail ? [['DPH (online)', (r) => r.dphOnline, (r) => dphPill(r.dphOnline)]] : []).concat([
        ['Busy %', (r) => r.busyPct, (r) => fmtPct(r.busyPct)], ['Median ride', (r) => r.medLeg, (r) => fmt(r.medLeg, 1)], ['Median km', (r) => r.medDist, (r) => fmt(r.medDist, 1)],
        ['Late on ride (stage)', (r) => r.roadLate], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)],
        ['Gaps ' + CFG.GAP_MIN + 'm+', (r) => r.gapsLong], ['Longest gap', (r) => r.longestGap, (r) => hm(r.longestGap)],
        ['Lost', (r) => r.takenAway], ['Gained', (r) => r.given],
      ]), list));
      if (D.absent && D.absent.length) h += card('Scheduled today but no deliveries in their shift · ' + D.absent.length, 'On shift according to DA shifts, but no delivery was picked up inside the shift. Counts as a missed day for attendance.', table([
        ['DA', (r) => r.p.name, (r) => esc(r.p.name) + ' <span class="muted">' + esc(r.p.hr || '') + '</span>', 'l'], ['Shift', (r) => r.plan.from, (r) => esc(shiftTxt(r.plan))],
      ], D.absent));
      return h;
    },

    timeline(A, M) {
      const D = A.da;
      return recNote(D, M) + card('Day timeline', 'One row per DA. Bars are trips (pickup to last delivery); hover a bar for details. The thin line under each row is the recorded status, when available. Shaded columns are peak hours.', daTimeline(D));
    },

    assign(A) {
      const D = A.da, T = D.team;
      let h = '';
      if (!T.historyLoaded) h += '<div class="note">Assignment history wasn\'t loaded, so every manual order counts as manually assigned (different DA). Press Refresh to try again.</div>';
      h += '<div class="note"><b>Auto-assigned</b> = the system chose the DA and nobody changed it. <b>Reassigned (same DA)</b> = assigned again by hand to the DA the system had picked (usually rebuilding a trip); counts as auto. <b>Manually assigned (different DA)</b> = a person chose the DA: they replaced the system\'s DA, or the system never assigned one. Auto-assign rate = the first two ÷ all orders with a DA.</div>';
      const g = (i) => D.groups[i] || { orders: 0 };
      h += '<div class="kpis">' + kpi('Auto-assign rate', A.score ? fmtPct(A.score.v.auto) : fmtPct(rate(T.assigned - T.manual, T.assigned)), '', 'target ' + CFG.AUTO_ASSIGN_TARGET + '%', A.score ? kpiStatus(kpiDef('auto'), A.score.v.auto) : null).replace('>Above target<', '>Just off target<').replace('>Well above target<', '>Missed<') +
        kpi('Auto-assigned', g(0).orders, '', fmtPct(g(0).share) + ' of ' + T.assigned + ' orders with a DA', null) +
        kpi('Reassigned (same DA)', g(1).orders, '', fmtPct(g(1).share) + ' · counts as auto', null) +
        kpi('Manually assigned (different DA)', g(2).orders, '', T.historyLoaded ? T.overrides + ' replaced the system\'s DA, ' + (D.cats.find((c) => c.cat === 'Manual only') || { orders: 0 }).orders + ' never auto-assigned' : 'history not read', null) + '</div>';
      const rows = D.groups.filter((x) => x.orders).concat(D.cats.filter((c) => ASSIGN_DETAIL[c.cat]).map((c) => Object.assign({}, c, { detail: true })));
      h += card('Assignment types', T.assigned + ' delivered or attempted orders with a DA. The indented rows split the manual ones.', table([
        ['Type', (r) => r.cat, (r) => (r.detail ? '<span class="muted">↳ ' + esc(ASSIGN_DETAIL[r.cat]) + '</span>' : '<b>' + esc(r.cat) + '</b>'), 'l'], ['Orders', (r) => r.orders], ['Share', (r) => r.share, (r) => fmtPct(r.share)], ['Delivered', (r) => r.delivered], ['Late', (r) => r.late],
        ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)], ['Late awaiting pickup (stage)', (r) => r.waited], ['Late on ride (stage)', (r) => r.roadLate], ...P90_COLS,
      ], rows));
      h += card('By timeslot', '', D.assignBySlot.length ? table([
        ['Timeslot', (r) => r.h, (r) => esc(r.label), 'l'], ['Orders', (r) => r.orders], ['Auto-assigned', (r) => r.auto], ['Same DA', (r) => r.same], ['Different DA', (r) => r.manual, (r) => r.manual + (r.over ? ' <span class="mini">' + r.over + ' replaced</span>' : '')],
        ['Auto-assign %', (r) => r.autoPct, (r) => (typeof kpiPill === 'function' ? kpiPill('auto', r.autoPct) : fmtPct(r.autoPct))],
      ], D.assignBySlot) : '<p class="muted">No data.</p>');
      h += card('By person assigning', '', D.actors.length ? table([
        ['Assigned by', (r) => r.name, null, 'l'], ['Different DA', (r) => r.overrides + r.only, (r) => (r.overrides + r.only) + (r.overrides ? ' <span class="mini">' + r.overrides + ' replaced</span>' : '')], ['Same DA', (r) => r.same],
        ['Late % of their orders', (r) => rate(r.late, r.delivered), (r) => latePill(rate(r.late, r.delivered))],
      ], D.actors.sort((a, b) => (b.overrides + b.only) - (a.overrides + a.only))) : '<p class="muted">No manual assignments with history.</p>');
      h += card('Every override', 'Orders moved by hand from the system\'s DA to a different DA.', D.overrides.length ? table([
        ['Order', (r) => r.orderNumber, null, 'l'], ['Slot', (r) => r.slot, (r) => esc(slotLabel(r.slot)), 'l'],
        ['System chose', (r) => r.assign.sysDa || '', null, 'l'], ['Assigned to', (r) => r.assign.toDa || '', null, 'l'], ['By', (r) => r.assign.by || '', null, 'l'],
        ['Minutes later', (r) => r.assign.minutesAfter, (r) => fmt(r.assign.minutesAfter, 0)], ['Changes', (r) => r.assign.changes],
        ['Result', (r) => (r.late == null ? -1 : r.late ? 1 : 0), (r) => (r.late == null ? '<span class="muted">' + esc(r.delivered && r.scheduled ? 'scheduled' : r.status) + '</span>' : r.late ? '<span class="pill bad">late ' + fmt(r.lateMin, 0) + 'm</span>' : '<span class="pill good">on time</span>')],
        ['Cause if late', (r) => r.cause || '', null, 'l'], ['Sub-area', (r) => r.subArea, null, 'l'],
      ], D.overrides) : '<p class="muted">No overrides on this date.</p>');
      return h;
    },

    avail(A, M) {
      const D = A.da;
      let h = '';
      if (!D.avail) {
        h += '<div class="note"><b>No recording for this date yet.</b> The DAs Availability list only shows the current moment, so the script records it every ' + CFG.POLL_MIN + ' minutes while the Control Room is open in this browser, even with this panel closed. Leave the Control Room tab open during the shift and this page fills in. Recordings are kept for ' + CFG.KEEP_DAYS + ' days.</div>';
      } else {
        h += recNote(D, M);
        const rows = Object.keys(D.avail.das).map((id) => Object.assign({ id }, D.avail.das[id])).filter((x) => x.online);
        h += card('Availability per DA (recorded)', '<b>Breaks</b> = times a DA switched to unavailable between first and last time online. Peak hours: ' + CFG.PEAKS.map(([a, b]) => hourLabel(a) + '–' + hourLabel(b % 24)).join(', ') + '. Breaks of ' + CFG.BREAK_ALERT_MIN + '+ min are flagged.', table([
          ['DA', (r) => r.name, (r) => esc(r.name) + ' <span class="muted">' + esc(r.hr || '') + '</span> ' + tierBadge(r.tier), 'l'],
          ['First online', (r) => r.first, (r) => fmtTime(r.first)], ['Last online', (r) => r.last, (r) => fmtTime(r.last)],
          ['On trips', (r) => r.ms.T, (r) => hm(r.ms.T / MIN)], ['Waiting', (r) => r.ms.A, (r) => hm(r.ms.A / MIN)], ['Locked', (r) => r.ms.L, (r) => hm(r.ms.L / MIN)],
          ['Utilisation', (r) => rate(r.ms.T + r.ms.L, r.ms.T + r.ms.L + r.ms.A), (r) => fmtPct(rate(r.ms.T + r.ms.L, r.ms.T + r.ms.L + r.ms.A))],
          ['Breaks', (r) => r.breaks], ['Breaks ' + CFG.BREAK_ALERT_MIN + 'm+', (r) => r.longBreaks, (r) => (r.longBreaks ? '<span class="pill warn">' + r.longBreaks + '</span>' : '0')],
          ['Longest break', (r) => r.longestBreak, (r) => hm(r.longestBreak)], ['Unavailable in peak', (r) => r.peakUnavailMin, (r) => (r.peakUnavailMin ? '<span class="pill bad">' + hm(r.peakUnavailMin) + '</span>' : '0m')],
        ], rows.sort((a, b) => a.first - b.first)));
        const breaks = [];
        rows.forEach((r) => r.breakList.forEach(([a, b]) => breaks.push({ name: r.name, a, b, min: (b - a) / MIN })));
        h += card('Every break', 'When each DA went unavailable and came back.', breaks.length ? table([
          ['DA', (r) => r.name, null, 'l'], ['Went unavailable', (r) => r.a, (r) => fmtTime(r.a)], ['Back', (r) => r.b, (r) => fmtTime(r.b)], ['Length', (r) => r.min, (r) => (r.min >= CFG.BREAK_ALERT_MIN ? '<span class="pill warn">' + hm(r.min) + '</span>' : hm(r.min))],
        ], breaks.sort((x, y) => x.a - y.a)) : '<p class="muted">No breaks recorded.</p>');
      }
      const snap = DAREC.snapshot;
      if (snap && snap.list && snap.list.length) {
        const order = { T: 0, L: 1, A: 2, U: 3 };
        h += card('Right now', 'DAs Availability list as of ' + fmtTime(snap.t) + '.', table([
          ['DA', (r) => r.name, (r) => esc(r.name) + ' <span class="muted">' + esc(r.hrId || '') + '</span> ' + tierBadge(r.tierId), 'l'],
          ['Status', (r) => order[daStatus(r)], (r) => '<span class="st-dot" style="background:' + STATUS_INFO[daStatus(r)].color + '"></span>' + STATUS_INFO[daStatus(r)].label, 'l'],
          ['Orders today', (r) => r.ordersCount], ['Assigned orders', (r) => r.numberOfAssignedOrders], ['Assigned trips', (r) => r.numberOfAssignedTrips], ['FC', (r) => r.fixedCost],
        ], snap.list.slice().sort((a, b) => order[daStatus(a)] - order[daStatus(b)] || (b.ordersCount || 0) - (a.ordersCount || 0))));
      }
      return h;
    },

    history() {
      const H = UI.history || loadHistory();
      const list = Object.values(H).sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? 1 : -1));
      if (!list.length) return '<div class="status">No saved days yet.</div>';
      return '<div class="note">Every date you analyse is saved here (summary numbers only, in this browser).</div>' + card('Saved days', '', table([
        ['Date', (r) => dateKey(r.date), (r) => esc(r.date), 'l'], ['Active DAs', (r) => r.activeDAs], ['Deliveries', (r) => r.deliveries], ['Orders / trip', (r) => r.perTrip, (r) => fmt(r.perTrip, 2)],
        ['DPH', (r) => r.dph, (r) => dphPill(r.dph)], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)], ['Late on ride (stage)', (r) => r.roadLate], ['Late awaiting pickup (stage)', (r) => r.waited],
        ['Manual', (r) => r.manual], ['Overrides', (r) => r.overrides], ['Recorded', (r) => r.recordedMin, (r) => (r.recordedMin ? hm(r.recordedMin) : '–')],
      ], list));
    },
  };

  /* ------------------------------------------------------------------
   * PICKER-SPECIFIC: live queue recorder, queue model, picker analysis
   * ------------------------------------------------------------------ */
  const hm = (min) => (min == null || !isFinite(min) ? '–' : Math.round(min) >= 60 ? Math.floor(Math.round(min) / 60) + 'h ' + pad2(Math.round(min) % 60) + 'm' : (min < 10 ? min.toFixed(1) : Math.round(min)) + 'm');   // v1.26.1: 4h 59.6m shows 5h 00m, not 4h 60m
  const pickerPrep = (o) => (o.fulfillmentOrder || []).find((f) => f.typeId === 1 || f.type === 'Picker') || null;

  // Records the live "orders being prepared" list every few minutes while the Control Room is open:
  // when each order first got a picker, when picking started, and how many orders were waiting.
  const PKREC = {
    timer: null, last: null, lastError: null, snapshot: null,
    key: (fp, dk) => STORE_PKREC + fp + ':' + dk,
    load(fp, dk) { try { return JSON.parse(localStorage.getItem(PKREC.key(fp, dk)) || 'null'); } catch (e) { return null; } },
    start() { if (PKREC.timer) return; PKREC.timer = setInterval(PKREC.poll, CFG.POLL_MIN * MIN); setTimeout(PKREC.poll, 5000); },
    async poll() {
      if (!/controlroom/i.test(location.pathname + location.search) || !CAP.ordersUrl) return;
      try {
        const u = new URL(CAP.ordersUrl);
        const fp = u.searchParams.getAll('fps[]')[0]; if (!fp) return;
        const now = Date.now();
        u.searchParams.set('pending_orders_only', 'true');
        u.searchParams.set('date', dateKeyOf(now));
        Array.from(u.searchParams.keys()).filter((k) => k.indexOf('filters') === 0).forEach((k) => u.searchParams.delete(k));
        const rows = [];
        for (let off = 0; off < 500; off += 100) {
          u.searchParams.set('page[limit]', '100'); u.searchParams.set('page[offset]', String(off));
          const j = await apiGet(u.toString()); const d = (j && j.data) || [];
          rows.push(...d);
          const count = j && j.meta && j.meta.page && j.meta.page.count;
          if (d.length < 100 || (count != null && off + 100 >= count)) break;
        }
        PKREC.save(fp, rows, now);
        PKREC.last = now; PKREC.lastError = null; PKREC.snapshot = { t: now, rows };
        LIVE.refresh();
      } catch (e) { PKREC.lastError = e.message; }
    },
    save(fp, rows, t) {
      const dk = dateKeyOf(t);
      const r = PKREC.load(fp, dk) || { o: {}, q: [], seg: [] };
      const lastSeg = r.seg[r.seg.length - 1];
      if (lastSeg && t - lastSeg[1] <= CFG.POLL_MIN * MIN * 3) lastSeg[1] = t; else r.seg.push([t, t]);
      let waiting = 0, assigned = 0, picking = 0;
      const busy = new Set();
      rows.forEach((o) => {
        const f = pickerPrep(o); if (!f) return;
        const st = f.PreparationStatus;
        const id = String(o.id);
        const bar = (o.fulfillmentOrder || []).find((x) => x.typeId === 2 || x.type === 'Barista');
        const DONE = ['ready_for_delivery', 'received', 'ready', 'done', 'completed'];
        const prev = r.o[id];
        if (prev) {
          if (DONE.includes(st) && !prev[4]) prev[4] = t;
          if (bar) { if (!prev[5] && ['assigned', 'picking', 'preparing'].includes(bar.PreparationStatus)) prev[5] = t; if (!prev[6] && DONE.includes(bar.PreparationStatus)) prev[6] = t; if (bar.pickerId) prev[7] = bar.pickerId; }
        }
        if (!['waiting', 'assigned', 'picking'].includes(st)) return;
        // [first seen, assigned at, picker id, picking at, picker done at, coffee started at, coffee ready at, barista id]
        const e = r.o[id] || (r.o[id] = [t, null, null, null, null, null, null, null]);
        if (st === 'waiting') waiting++;
        else {
          if (st === 'assigned') assigned++; else picking++;
          if (f.pickerId) busy.add(f.pickerId);
          if (!e[1]) { e[1] = t; e[2] = f.pickerId || null; }
          if (st === 'picking' && !e[3]) e[3] = t;
        }
      });
      r.q.push([t, waiting, assigned, picking, busy.size]);
      try { localStorage.setItem(PKREC.key(fp, dk), JSON.stringify(r)); } catch (e) { }
      PKREC.prune();
    },
    prune() {
      const cutoff = Date.now() - CFG.KEEP_DAYS * 86400000;
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (!k || k.indexOf(STORE_PKREC) !== 0) continue;
          const ds = dayStartOf(k.split(':').pop());
          if (ds && ds < cutoff) localStorage.removeItem(k);
        }
      } catch (e) { }
    },
  };

  // Basket size groups (v1.26: one set everywhere: Basket size, Basket fairness, the basket-adjusted sec / SKU)
  const SKU_BANDS = [[1, 2], [3, 5], [6, 9], [10, 14], [15, 19], [20, 29], [30, 39], [40, 49], [50, 999]];
  const bandLabel = ([lo, hi]) => (hi === 999 ? lo + '+ SKUs' : lo + '–' + hi + ' SKUs');

  /* ---------- the queue model ----------
   * Orders wait in a store queue until a picker takes them; a picker works on one order at a time.
   *   ready    = when the order could be picked (NOW: when placed; scheduled: slot start − SCHED_READY_MIN, never before placing)
   *   start    = recorded assignment time if available, otherwise max(ready, this picker's previous pack)
   *   wait     = start − ready      (time in the queue before a picker took it)
   *   handling = packed − start     (the picker's own time on the order)
   */
  function analyzePickers(A, meta, rec) {
    const dayStart = dayStartOf(meta.date);
    const recO = rec && rec.o ? rec.o : {};
    const rows = A.rows.filter((r) => !r.wasSub && r.pickerId && r.packed != null);
    rows.forEach((r) => {
      const slotStart = r.slotStart;
      r.ready = r.scheduled && slotStart != null ? Math.max(r.placed || 0, slotStart - CFG.SCHED_READY_MIN * MIN) : r.placed;
      const ro = recO[String(r.id)];
      r.recAssigned = ro && ro[1] && ro[1] <= r.packed ? ro[1] : null;
      r.recPicking = ro && ro[3] && ro[3] <= r.packed ? ro[3] : null;
    });
    const byPicker = groupBy(rows, (r) => String(r.pickerId));
    byPicker.forEach((g) => {
      g.sort((a, b) => a.packed - b.packed);
      let prev = null;
      g.forEach((r) => {
        let start;
        if (r.recAssigned) { start = r.recAssigned; r.startSource = 'recorded'; }
        else { start = Math.max(r.ready || r.packed, prev != null ? prev : -Infinity); r.startSource = 'estimated'; }
        if (start > r.packed) start = r.packed;
        r.start = start;
        r.waitMin = r.ready != null ? Math.max(0, (start - r.ready) / MIN) : null;
        r.handleMin = (r.packed - start) / MIN;
        r.minPerSku = r.skus ? r.handleMin / r.skus : null;
        r.prevPacked = prev;
        r.idleBeforeMin = prev != null ? Math.max(0, (start - prev) / MIN) : null;
        r.longHandling = r.handleMin > CFG.LONG_HANDLING_MIN || (r.skus && r.handleMin / r.skus > CFG.LONG_MIN_PER_SKU && r.handleMin > 8);
        prev = r.packed;
      });
    });
    // First order of a picker's day: we don't know when they arrived, so if the estimate is implausibly long,
    // assume a typical picking time (the picker's own median, or the team's) instead of counting the whole wait as picking.
    const normal = rows.filter((r) => r.prevPacked != null && r.handleMin <= CFG.LONG_HANDLING_MIN).map((r) => r.handleMin);
    const teamMed = median(normal) || CFG.HANDLE_TARGET_MIN;
    byPicker.forEach((g) => {
      const own = median(g.filter((r) => r.prevPacked != null && r.handleMin <= CFG.LONG_HANDLING_MIN).map((r) => r.handleMin)) || teamMed;
      g.forEach((r) => {
        if (r.startSource !== 'estimated' || r.prevPacked != null || r.handleMin <= Math.max(2 * own, CFG.LONG_HANDLING_MIN)) return;
        r.start = r.packed - own * MIN; r.startSource = 'assumed (first order)';
        r.waitMin = r.ready != null ? Math.max(0, (r.start - r.ready) / MIN) : null;
        r.handleMin = own; r.minPerSku = r.skus ? own / r.skus : null; r.longHandling = false;
      });
    });
    // in-store late split: queue vs picking
    rows.forEach((r) => {
      if (!IN_STORE.includes(r.cause)) { r.storeLate = null; return; }
      r.storeLate = (r.waitMin || 0) >= (r.handleMin || 0) ? 'Waited for a picker' : 'Slow picking';
    });

    // store queue over the day (5-minute grid)
    const STEP = 5 * MIN;
    const t0 = dayStart, t1 = dayStart + 24 * 3600000;
    const grid = [];
    for (let t = t0; t < t1; t += STEP) {
      const waiting = rows.filter((r) => r.ready != null && r.ready <= t && r.start > t).length;
      const busy = new Set(rows.filter((r) => r.start <= t && r.packed > t).map((r) => r.pickerId)).size;
      grid.push({ t, waiting, busy });
    }
    // pressure on each order: orders already waiting when it became ready
    rows.forEach((r) => { r.queueAtReady = r.ready != null ? rows.filter((x) => x !== r && x.ready != null && x.ready <= r.ready && x.start > r.ready).length : null; });

    const hours = [];
    for (let h = 0; h < 24; h++) {
      const cells = grid.slice(h * 12, h * 12 + 12);
      const packedH = rows.filter((r) => new Date(r.packed).getHours() === h && r.packed >= t0 && r.packed < t1);
      const readyH = rows.filter((r) => r.ready != null && r.ready >= t0 + h * 3600000 && r.ready < t0 + (h + 1) * 3600000);
      const pickersH = new Set(packedH.map((r) => r.pickerId)).size;
      const late = packedH.filter((r) => r.storeLate);
      hours.push({
        h, label: slotLabel(h), ready: readyH.length, packed: packedH.length, pickers: pickersH,
        avgQueue: avg(cells.map((c) => c.waiting)), maxQueue: Math.max(0, ...cells.map((c) => c.waiting)), avgBusy: avg(cells.map((c) => c.busy)),
        perPicker: pickersH ? packedH.length / pickersH : null,
        medWait: median(packedH.map((r) => r.waitMin)), medHandle: median(packedH.map((r) => r.handleMin)), medPerSku: median(packedH.map((r) => r.minPerSku)),
        skus: packedH.reduce((s, r) => s + (r.skus || 0), 0),
        storeLate: late.length, queueLate: late.filter((r) => r.storeLate === 'Waited for a picker').length, slowLate: late.filter((r) => r.storeLate === 'Slow picking').length,
      });
    }

    // per picker: only orders packed inside the account owner's shift count for them (Pickers → Picker shifts)
    const own = typeof pkRosterMark === 'function' ? pkRosterMark(rows, meta) : rows;
    const list = [];
    groupBy(own, (r) => String(r.pickerId)).forEach((g) => {
      g.sort((a, b) => a.packed - b.packed);
      const first = g[0].start, last = g[g.length - 1].packed;
      const spanH = Math.max((last - first) / 3600000, 0.25);
      const handleTotal = g.reduce((s, r) => s + r.handleMin, 0);
      const shiftCount = {};
      g.forEach((r) => { const s = shiftOf(new Date(r.packed).getHours()); shiftCount[s] = (shiftCount[s] || 0) + 1; });
      const del = g.filter((r) => r.delivered);
      const bands = SKU_BANDS.map((b) => g.filter((r) => r.skus != null && r.skus >= b[0] && r.skus <= b[1]));
      const idleGaps = g.filter((r) => r.idleBeforeMin != null && r.idleBeforeMin >= CFG.IDLE_GAP_MIN);
      list.push({
        id: String(g[0].pickerId), name: g[0].pickerName, hr: g[0].pickerHr,
        shift: Object.keys(shiftCount).sort((a, b) => shiftCount[b] - shiftCount[a])[0],
        first, last, spanH, shortSpan: spanH < 1,
        orders: g.length, skus: g.reduce((s, r) => s + (r.skus || 0), 0), bags: g.reduce((s, r) => s + (r.bags || 0), 0),
        avgSkus: avg(g.map((r) => r.skus)), perHour: g.length / spanH, skusPerHour: g.reduce((s, r) => s + (r.skus || 0), 0) / spanH,
        medHandle: median(g.map((r) => r.handleMin)), p90Handle: pct(g.map((r) => r.handleMin), 0.9), medPerSku: median(g.map((r) => r.minPerSku)),
        longHandling: g.filter((r) => r.longHandling).length, utilisation: Math.min(100, (100 * handleTotal) / (spanH * 60)),
        storeLate: g.filter((r) => r.storeLate).length, slowLate: g.filter((r) => r.storeLate === 'Slow picking').length, queueLate: g.filter((r) => r.storeLate === 'Waited for a picker').length,
        storeLatePct: rate(g.filter((r) => r.storeLate).length, g.length),
        latePct: rate(del.filter((r) => r.late).length, del.filter((r) => r.late != null).length),
        avgQueueAtStart: avg(g.map((r) => grid[Math.max(0, Math.min(grid.length - 1, Math.floor((r.start - t0) / STEP)))].waiting)),
        largeShare: rate(g.filter((r) => r.skus >= CFG.LARGE_BASKET_SKUS).length, g.length),
        bandCounts: bands.map((b) => b.length), bandPerSku: bands.map((b) => median(b.map((r) => r.minPerSku))),
        idleGaps: idleGaps.length, longestIdle: idleGaps.length ? Math.max(...idleGaps.map((r) => r.idleBeforeMin)) : 0,
        idleWhileWaiting: idleGaps.filter((r) => { const c = grid[Math.max(0, Math.floor((r.prevPacked - t0) / STEP))]; return c && c.waiting > 0; }).length,
        recordedShare: rate(g.filter((r) => r.startSource === 'recorded').length, g.length),
        rows: g,
      });
    });
    list.sort((a, b) => b.orders - a.orders);
    const storeLate = rows.filter((r) => r.storeLate);
    const team = {
      orders: rows.length, pickers: list.length, skus: rows.reduce((s, r) => s + (r.skus || 0), 0),
      medWait: median(rows.map((r) => r.waitMin)), p90Wait: pct(rows.map((r) => r.waitMin), 0.9),
      medHandle: median(rows.map((r) => r.handleMin)), medPerSku: median(rows.map((r) => r.minPerSku)),
      medInStore: median(rows.map((r) => (r.ready != null ? (r.packed - r.ready) / MIN : null))),
      storeLate: storeLate.length, queueLate: storeLate.filter((r) => r.storeLate === 'Waited for a picker').length, slowLate: storeLate.filter((r) => r.storeLate === 'Slow picking').length,
      peakQueue: Math.max(0, ...grid.map((c) => c.waiting)), peakQueueAt: (grid.reduce((m, c) => (c.waiting > m.waiting ? c : m), { waiting: -1 }).t) || null,
      perPickerHour: list.reduce((s, x) => s + x.orders, 0) / Math.max(0.25, list.reduce((s, x) => s + x.spanH, 0)),
      recorded: !!(rec && rec.seg && rec.seg.length), recordedShare: rate(rows.filter((r) => r.startSource === 'recorded').length, rows.length),
    };
    const P = { rows, list, hours, grid, team, dayStart, rec };
    if (typeof pkRosterStats === 'function') pkRosterStats(P, meta);
    return P;
  }

  // Picker ranking across every saved day (for tiers and monthly bonuses)
  function rankPickers(hist, fromKey, toKey) {
    const agg = new Map();
    Object.values(hist).forEach((d) => {
      const k = dateKey(d.date); if (fromKey && k < fromKey) return; if (toKey && k > toKey) return;
      (d.pickers || []).forEach((p) => {
        const id = p.hr || p.name; const a = agg.get(id) || { name: p.name, hr: p.hr, days: 0, orders: 0, skus: 0, hours: 0, storeLate: 0, slowLate: 0, longHandling: 0, perSku: [] };
        a.days++; a.orders += p.orders; a.skus += p.skus; a.hours += p.spanH; a.storeLate += p.storeLate; a.slowLate += p.slowLate || 0; a.longHandling += p.longHandling || 0;
        if (p.medPerSku != null) a.perSku.push(p.medPerSku); agg.set(id, a);
      });
    });
    const list = Array.from(agg.values()).map((a) => ({
      ...a, skusPerHour: a.hours ? a.skus / a.hours : null, perHour: a.hours ? a.orders / a.hours : null,
      medPerSku: median(a.perSku), storeLatePct: rate(a.storeLate, a.orders), slowLatePct: rate(a.slowLate, a.orders), longPct: rate(a.longHandling, a.orders),
    }));
    // score: percentile rank on each measure, weighted (weights in SETTINGS)
    const prank = (vals, v, higherBetter) => { const s = vals.filter((x) => x != null).sort((x, y) => x - y); if (v == null || !s.length) return 0.5; const below = s.filter((x) => (higherBetter ? x < v : x > v)).length; return s.length > 1 ? below / (s.length - 1) : 1; };
    const W = CFG.RANK_WEIGHTS;
    list.forEach((p) => {
      p.score = 100 * (
        W.skusPerHour * prank(list.map((x) => x.skusPerHour), p.skusPerHour, true) +
        W.minPerSku * prank(list.map((x) => x.medPerSku), p.medPerSku, false) +
        W.storeLate * prank(list.map((x) => x.slowLatePct), p.slowLatePct, false) +
        W.attendance * prank(list.map((x) => x.days), p.days, true)
      ) / (W.skusPerHour + W.minPerSku + W.storeLate + W.attendance);
    });
    list.sort((a, b) => b.score - a.score);
    list.forEach((p, i) => { p.rank = i + 1; p.tier = i < Math.ceil(list.length * 0.2) ? 'Tier 1' : i < Math.ceil(list.length * 0.5) ? 'Tier 2' : i < Math.ceil(list.length * 0.8) ? 'Tier 3' : 'Tier 4'; });
    return list;
  }

  /* ---------- picker views ---------- */
  const minPill = (v, good, warn) => {
    if (v == null || !isFinite(v)) return '<span class="muted">–</span>';
    const c = v <= good ? 'good' : v <= warn ? 'warn' : 'bad';
    return '<span class="pill ' + c + '">' + (v < 10 ? v.toFixed(1) : Math.round(v)) + '</span>';
  };
  const modelNote = (P) => '<div class="note"><b>How picking time is measured.</b> Orders wait in an FP queue until a picker takes one; each picker works on one order at a time. ' +
    '<b>Wait</b> = from when the order was ready (placed, or ' + CFG.SCHED_READY_MIN + ' min before its slot for scheduled orders) until a picker started it. ' +
    '<b>Picking time</b> = from start to packed. ' + (P.team.recorded ? 'Start times are <b>recorded</b> for ' + fmtPct(P.team.recordedShare) + ' of orders (the Control Room was open); the rest are estimated as the later of "ready" and the picker finishing their previous order. A picker\'s first order of the day gets their typical picking time, since their arrival isn\'t known.' : 'Start times are <b>estimated</b> as the later of "ready" and the picker finishing their previous order. A picker\'s first order of the day gets their typical picking time, since their arrival isn\'t known. Keep the Control Room open during shifts and the script records real start times every ' + CFG.POLL_MIN + ' minutes.') + '</div>';

  function binGrid(grid, mins) {
    const k = mins / 5, out = [];
    for (let i = 0; i < grid.length; i += k) {
      const cells = grid.slice(i, i + k);
      out.push({ t: cells[0].t, waiting: avg(cells.map((c) => c.waiting)), maxWaiting: Math.max(...cells.map((c) => c.waiting)), busy: avg(cells.map((c) => c.busy)) });
    }
    return out;
  }
  // One time axis for the day, two small charts stacked on it (orders waiting, pickers busy): hourly ticks, hover per 15 minutes.
  function timeSeriesChart(bins, key, color, opts) {
    const W = 1200, H = opts.h || 150, L = 40, R = 12, T = 10, B = 24;
    const t0 = bins[0].t, t1 = bins[bins.length - 1].t + 15 * MIN;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const max = niceMax(Math.max(1, ...bins.map((b) => b[key + 'Max'] != null ? b[key + 'Max'] : b[key])));
    const y = (v) => T + (H - T - B) - (Math.min(v, max) / max) * (H - T - B);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(opts.aria) + '"><g class="grid">';
    for (let i = 0; i <= 3; i++) { const v = (max / 3) * i, yy = y(v); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L - 6) + '" y="' + (yy + 3.5) + '" text-anchor="end">' + (+v.toFixed(1)) + '</text>'; }
    s += '</g>';
    const hours = (t1 - t0) / 3600000, every = hours > 16 ? 2 : 1;
    const first = Math.ceil(t0 / 3600000) * 3600000;
    for (let t = first; t <= t1; t += 3600000) {
      const hh = new Date(t).getHours();
      if (Math.round((t - first) / 3600000) % every) continue;
      s += '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '" stroke="var(--ink-3)"/><text x="' + x(t) + '" y="' + (H - 6) + '" text-anchor="middle">' + shortHour(hh) + '</text>';
    }
    const pts = bins.map((b) => [x(b.t + 7.5 * MIN), y(b[key])]);
    s += '<path d="M' + x(t0) + ',' + y(0) + ' L' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L') + ' L' + x(t1) + ',' + y(0) + ' Z" fill="' + color + '" fill-opacity=".22"/>';
    s += '<path d="M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>';
    if (opts.target != null) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(opts.target) + '" y2="' + y(opts.target) + '" stroke="var(--ink-3)" stroke-dasharray="4 3"/>';
    bins.forEach((b) => { s += '<rect class="hit" x="' + x(b.t) + '" y="' + T + '" width="' + Math.max(1, x(b.t + 15 * MIN) - x(b.t)) + '" height="' + (H - T - B) + '" data-tip="' + esc(b.tip) + '"/>'; });
    return s + '</svg>';
  }
  function queueCharts(P) {
    const bins = binGrid(P.grid, 15);
    let a = 0, b = bins.length; while (a < b && !bins[a].waiting && !bins[a].busy) a++; while (b > a && !bins[b - 1].waiting && !bins[b - 1].busy) b--;
    const use = bins.slice(Math.max(0, a - 2), Math.min(bins.length, b + 2));
    if (!use.length) return '';
    use.forEach((c) => { c.waitingMax = c.maxWaiting; c.tip = '<b>' + fmtTime(c.t) + '–' + fmtTime(c.t + 15 * MIN) + '</b><br>Orders waiting: ' + c.waiting.toFixed(1) + ' on average (max ' + c.maxWaiting + ')<br>Pickers busy: ' + c.busy.toFixed(1); });
    return card('Queue and pickers through the day', 'Two charts on the same clock, every 15 minutes (hover for numbers). When the top line rises while the bottom one stays flat, orders were waiting and nobody was free to take them.',
      '<div class="mini" style="margin:6px 0 2px"><b style="color:var(--late) !important">Orders waiting for a picker</b> (average per 15 min)</div>' + timeSeriesChart(use, 'waiting', 'var(--late)', { h: 170, aria: 'Orders waiting for a picker' }) +
      '<div class="mini" style="margin:10px 0 2px"><b style="color:var(--ontime) !important">Pickers busy</b> (with an order in hand)</div>' + timeSeriesChart(use, 'busy', 'var(--ontime)', { h: 140, aria: 'Pickers busy' }));
  }

  function pickerTimeline(P) {
    const list = P.list.slice().sort((a, b) => a.first - b.first);
    if (!list.length) return '<p class="muted">No picks on this date.</p>';
    const ds = P.dayStart;
    let minT = Math.min(...list.map((x) => x.first)), maxT = Math.max(...list.map((x) => x.last));
    minT = Math.max(ds - 2 * 3600000, Math.floor((minT - ds) / 3600000) * 3600000 + ds); maxT = Math.ceil((maxT - ds) / 3600000) * 3600000 + ds;
    const hours = Math.max(1, Math.round((maxT - minT) / 3600000));
    const L = 190, R = 12, W = 1240, rowH = 28, qH = 46, top = 22 + qH;
    const H = top + list.length * rowH + 8;
    const x = (t) => L + ((t - minT) / (maxT - minT)) * (W - L - R);
    let s = '<svg class="tl" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Picker timeline">';
    for (let h = 0; h <= hours; h++) {
      const t = minT + h * 3600000, xx = x(t);
      s += '<line x1="' + xx + '" x2="' + xx + '" y1="18" y2="' + (H - 4) + '" stroke="var(--grid)"/>';
      if (h < hours) s += '<text x="' + (xx + 2) + '" y="13" class="ax">' + shortHour(new Date(t).getHours()) + '</text>';
    }
    // queue strip
    const cells = P.grid.filter((c) => c.t >= minT && c.t < maxT);
    const qmax = Math.max(1, ...cells.map((c) => c.waiting));
    s += '<text x="8" y="' + (22 + qH / 2 + 4) + '" class="nm">Orders waiting</text>';
    cells.forEach((c) => {
      if (!c.waiting) return;
      const hgt = (c.waiting / qmax) * (qH - 8);
      s += '<rect x="' + x(c.t) + '" y="' + (22 + qH - 4 - hgt) + '" width="' + Math.max(1, x(c.t + 5 * MIN) - x(c.t) - 0.5) + '" height="' + hgt + '" fill="rgba(225,108,111,.6)" data-tip="' + esc(fmtTime(c.t) + ': ' + c.waiting + ' orders waiting, ' + c.busy + ' pickers busy') + '"/>';
    });
    list.forEach((p, i) => {
      const y = top + i * rowH;
      if (i % 2 === 0) s += '<rect x="0" y="' + (y - 2) + '" width="' + W + '" height="' + rowH + '" fill="var(--band)"/>';
      s += '<text x="8" y="' + (y + 15) + '" class="nm">' + esc((p.name || '').slice(0, 24)) + '</text>';
      p.rows.forEach((r) => {
        const xa = x(r.start), xb = Math.max(xa + 2, x(r.packed));
        const col = r.storeLate ? '#E16C6F' : r.longHandling ? '#EDC246' : '#1393CD';
        const tip = '<b>' + esc(r.orderNumber) + '</b> · ' + esc(slotLabel(r.slot)) + '<br>' + (r.skus || 0) + ' SKUs, ' + (r.bags || 0) + ' bags<br>Waited ' + hm(r.waitMin) + ', picked in ' + hm(r.handleMin) + (r.minPerSku != null ? ' (' + Math.round(r.minPerSku * 60) + ' sec/SKU)' : '') + '<br>Start ' + fmtTime(r.start) + (r.startSource === 'recorded' ? ' (recorded)' : ' (est.)') + ', packed ' + fmtTime(r.packed) + (r.storeLate ? '<br><b>' + esc(r.storeLate) + '</b>' : '');
        s += '<rect x="' + xa + '" y="' + (y + 3) + '" width="' + (xb - xa) + '" height="16" rx="2" fill="' + col + '" stroke="var(--paper)" stroke-width="0.8" data-tip="' + esc(tip) + '"/>';
      });
    });
    s += '</svg>';
    return '<div class="legend"><span><i style="background:#1393CD"></i>Order picked</span><span><i style="background:#EDC246"></i>Long picking time</span><span><i style="background:#E16C6F"></i>Late because of the FP</span><span><i style="background:rgba(225,108,111,.6)"></i>Orders waiting in the queue</span></div><div class="tw tlw">' + s + '</div>';
  }

  const PK_VIEWS = {
    overview(A, M) {
      const P = A.pk, T = P.team;
      let h = '<div class="kpis">' +
        kpi('Median wait for a picker', fmt(T.medWait, 1), 'min', 'P90 ' + fmt(T.p90Wait, 0) + ' min. Peak queue ' + T.peakQueue + ' orders at ' + fmtTime(T.peakQueueAt), T.medWait == null ? null : T.medWait <= CFG.WAIT_TARGET_MIN ? 'good' : T.medWait <= CFG.WAIT_TARGET_MIN * 2 ? 'warn' : 'bad') +
        kpi('Median picking time', fmt(T.medHandle, 1), 'min', fmt(T.secPerSku, 0) + ' sec per SKU', T.medHandle == null ? null : T.medHandle <= CFG.HANDLE_TARGET_MIN ? 'good' : T.medHandle <= CFG.HANDLE_TARGET_MIN * 1.5 ? 'warn' : 'bad') +
        kpi('Late because of the FP', T.storeLate, '', T.queueLate + ' waited for a picker, ' + T.slowLate + ' slow picking' + (T.heldLate ? ', ' + T.heldLate + ' held for another order' : '') + '. Same as the FP count on ETA Late Analysis.', null) +
        kpi('Orders picked', T.orders.toLocaleString('en-US'), '', T.pickers + ' pickers · PPH (Ops) ' + fmt(T.ppho, 1) + ' · PPH ' + fmt(T.perPickerHour, 1) + (T.notCounted ? '. ' + T.notCounted + ' picked outside the account owner\'s shift' : ''), null) + '</div>';
      h += '<div class="tiles">' + tile('SKUs picked', T.skus.toLocaleString('en-US'), '') + tile('Median time in the FP', fmt(T.medInStore, 1) + '<span class="u">min</span>', 'Ready to packed (wait + picking)') +
        tile('Peak queue', T.peakQueue, T.peakQueueAt ? 'at ' + fmtTime(T.peakQueueAt) : '') + tile('Start times recorded', T.recorded ? fmtPct(T.recordedShare) : 'None', T.recorded ? 'of orders' : 'Keep the Control Room open to record') + '</div>';
      h += modelNote(P);
      h += queueCharts(P);
      h += card('Hour by hour', '<b>PPH (Ops)</b> = orders whose picking started that hour ÷ every picker who started one (<b>pickers active</b>). <b>PPH</b> = the same counting only pickers who started ' + CFG.PPH_MIN_PICKS + '+ that hour (<b>pickers counted</b>). Both are the Scorecard\'s. <b>Orders packed</b>, <b>pickers</b> (who packed that hour) and the late columns go by the hour packed. <b>Avg / max queue</b> = orders waiting for a picker. <b>Queue per picker</b> shows the pressure each picker was under. <b>FP late</b> = late orders the FP owns (as ETA Late Analysis), split into waited for a picker, slow picking and held for another order.', table([
        ['Hour', (r) => r.h, (r) => esc(r.label), 'l'], ['Orders ready', (r) => r.ready], ['Orders packed', (r) => r.packed], ['SKUs', (r) => r.skus], ['Pickers', (r) => r.pickers],
        ['PPH (Ops)', (r) => r.perPickerOps, (r) => (r.perPickerOps == null ? '<span class="muted">–</span>' : kpiPill('ppho', r.perPickerOps))], ['Pickers active', (r) => r.pickersActive],
        ['PPH', (r) => r.perPicker, (r) => (r.perPicker == null ? '<span class="muted">–</span>' : kpiPill('pph', r.perPicker))], ['Pickers counted', (r) => r.pickersCounted],
        ['Avg queue', (r) => r.avgQueue, (r) => fmt(r.avgQueue, 1)], ['Max queue', (r) => r.maxQueue],
        ['Queue per picker', (r) => (r.avgBusy ? r.avgQueue / r.avgBusy : null), (r) => fmt(r.avgBusy ? r.avgQueue / r.avgBusy : null, 1)],
        ['Median wait', (r) => r.medWait, (r) => minPill(r.medWait, CFG.WAIT_TARGET_MIN, CFG.WAIT_TARGET_MIN * 2)], ['Median picking', (r) => r.medHandle, (r) => minPill(r.medHandle, CFG.HANDLE_TARGET_MIN, CFG.HANDLE_TARGET_MIN * 1.5)],
        ['Sec / SKU', (r) => r.secPerSku, (r) => fmt(r.secPerSku, 0)], ['FP late', (r) => r.storeLate], ['Waited for picker', (r) => r.queueLate], ['Slow picking', (r) => r.slowLate], ['Held for another order', (r) => r.heldLate],
      ], P.hours.filter((r) => r.packed || r.ready)));
      return h;
    },

    pickers(A) {
      const P = A.pk;
      const secPill = (v) => { if (v == null || !isFinite(v)) return '<span class="muted">–</span>'; const t = P.team.secPerSku; const c = t == null ? '' : v <= t * 0.9 ? 'good' : v <= t * 1.15 ? 'warn' : 'bad'; return '<span class="pill ' + c + '">' + Math.round(v) + '</span>'; };
      const list = P.list.slice().sort((a, b) => (a.excluded - b.excluded) || ((a.adjSecPerSku == null) - (b.adjSecPerSku == null)) || (a.adjSecPerSku - b.adjSecPerSku));
      let h = '<div class="note"><b>Sec / SKU</b> = picking time (start → packed) ÷ unique SKUs, in seconds: the main speed measure, because it doesn\'t depend on how many orders or how big the baskets were. ' +
        '<b>Sec / SKU, basket-adjusted</b> goes one step further: big baskets are naturally faster per SKU (the fixed time per order is spread over more items), so each order is compared with the team\'s median for that basket size today (team ' + fmt(P.team.secPerSku, 0) + ' sec/SKU) and turned back into seconds. This is the number the ranking uses. ' +
        'A picker\'s first order of the day is left out (their start time isn\'t known). <b>Active hours</b> = clock hours in which they started picking at least one order. <b>PPH (Ops)</b> = their orders ÷ their active hours, the same rule as the FP\'s PPH (Ops). <b>Span</b> = hours from first start to last pack. <b>FP late</b> = their late orders the FP owns, as ETA Late Analysis (an order held for another order is not counted against its own picker). ' +
        '<b>Idle while orders waited</b> = of the minutes in their shift when orders were waiting for a picker, the share they spent not picking (their shift from Picker shifts, or first to last pick if none is set). ' +
        (P.team.notCounted ? '<b>' + P.team.notCounted + ' orders</b> were packed on an account outside its owner\'s shift (or on their day off) and are not counted for anyone here; see Picker shifts. ' : 'Set each picker\'s shift on <b>Picker shifts</b> so orders picked on their account by someone else stop counting for them. ') +
        '<b>Long picks</b> = over ' + CFG.LONG_HANDLING_MIN + ' min, or over ' + Math.round(CFG.LONG_MIN_PER_SKU * 60) + ' sec per SKU.</div>';
      h += card('Picker performance', P.list.length + ' accounts packed orders on this date, fastest first. Click a column to sort.', table([
        ['Picker', (r) => r.name, (r) => esc(r.name) + ' <span class="muted">' + esc(r.hr || '') + '</span>' + (r.excluded ? ' <span class="pill na">not ranked</span>' : ''), 'l'],
        ['Shift today', (r) => (r.plan && !r.plan.off ? r.plan.from : 99), (r) => (r.shiftSet ? esc(shiftTxt(r.plan)) : r.plan && r.plan.off ? '<span class="pill warn">day off</span>' : '<span class="muted">not set</span>')],
        ['Sec / SKU, basket-adjusted', (r) => r.adjSecPerSku, (r) => secPill(r.adjSecPerSku)], ['Sec / SKU', (r) => r.secPerSku, (r) => fmt(r.secPerSku, 0)],
        ['Orders', (r) => r.orders], ['Not counted', (r) => r.notCounted, (r) => (r.notCounted ? '<span class="pill warn">' + r.notCounted + '</span>' : '0')],
        ['SKUs', (r) => r.skus], ['Avg SKUs', (r) => r.avgSkus, (r) => fmt(r.avgSkus, 1)], ['Large baskets', (r) => r.largeShare, (r) => fmtPct(r.largeShare)],
        ['First start', (r) => r.first, (r) => fmtTime(r.first)], ['Last pack', (r) => r.last, (r) => fmtTime(r.last)], ['Span (h)', (r) => r.spanH, (r) => fmt(r.spanH, 1)],
        ['Active hours', (r) => r.activeH], ['PPH (Ops)', (r) => r.perHour, (r) => kpiPill('ppho', r.perHour)],
        ['Median picking', (r) => r.medHandle, (r) => minPill(r.medHandle, CFG.HANDLE_TARGET_MIN, CFG.HANDLE_TARGET_MIN * 1.5)], ['P90 picking', (r) => r.p90Handle, (r) => fmt(r.p90Handle, 1)],
        ['Idle while orders waited', (r) => r.idleWaitPct, (r) => (r.idleWaitPct == null ? '<span class="muted">–</span>' : '<span class="pill ' + (r.idleWaitPct <= 20 ? 'good' : r.idleWaitPct <= 40 ? 'warn' : 'bad') + '">' + Math.round(r.idleWaitPct) + '%</span> <span class="muted">' + r.idleWaitMin + ' min</span>')],
        ['Long picks', (r) => r.longHandling], ['Late from slow picking', (r) => r.slowLate], ['FP late', (r) => r.storeLate],
        ['Avg queue at start', (r) => r.avgQueueAtStart, (r) => fmt(r.avgQueueAtStart, 1)], ['Longest idle', (r) => r.longestIdle, (r) => hm(r.longestIdle)],
      ], list));
      if (P.absent && P.absent.length) h += card('Scheduled today but no picks in their shift · ' + P.absent.length, 'On shift according to Picker shifts, but no order on their account was packed inside the shift. Absent, or picking on someone else\'s account. Counts as a missed day for attendance.', table([
        ['Picker', (r) => r.p.name, (r) => esc(r.p.name) + ' <span class="muted">' + esc(r.p.hr || '') + '</span>', 'l'], ['Shift', (r) => r.plan.from, (r) => esc(shiftTxt(r.plan))],
      ], P.absent));
      return h;
    },

    timeline(A) {
      const P = A.pk;
      return modelNote(P) + card('Picker timeline', 'One row per picker; each bar is one order from start to packed. Hover any bar. The strip at the top shows how many orders were waiting.', pickerTimeline(P));
    },

    queue(A) {
      const P = A.pk;
      const waits = P.rows.filter((r) => r.waitMin != null).sort((a, b) => b.waitMin - a.waitMin).slice(0, 40);
      const slow = P.rows.filter((r) => r.longHandling).sort((a, b) => b.handleMin - a.handleMin).slice(0, 40);
      const model = (r) => (r.scheduled ? '<span class="pill na">Scheduled</span>' : '<span class="pill warn">NOW</span>');
      const yes = (v, label) => (v ? '<b>' + label + '</b>' : '<span class="muted">–</span>');
      const result = (r) => (r.late == null ? '–' : r.late ? '<span class="pill bad">late</span>' : '<span class="pill good">on time</span>');
      return '<div class="note">The two lists to check after a bad hour: orders nobody picked up for a long time (a queue problem: not enough pickers on the floor), and picks that took far longer than the basket needed (a picker problem: stopped mid-order, couldn\'t find items, or on the phone). Scheduled orders count as ready ' + CFG.SCHED_READY_MIN + ' min before their slot.</div>' +
        card('Orders that waited longest for a picker', 'Top 40.', table([
          ['Order', (r) => r.orderNumber, (r) => '<b>' + esc(r.orderNumber) + '</b>', 'l'], ['Type', (r) => (r.scheduled ? 1 : 0), model, 'l'], ['Slot', (r) => r.slot, (r) => esc(slotLabel(r.slot)), 'l'],
          ['Created', (r) => r.placed, (r) => fmtTime(r.placed)], ['Ready', (r) => r.ready, (r) => fmtTime(r.ready)], ['Started', (r) => r.start, (r) => fmtTime(r.start) + (r.startSource === 'recorded' ? '' : ' <span class="muted">est.</span>')],
          ['Waited', (r) => r.waitMin, (r) => hm(r.waitMin)], ['Queue when ready', (r) => r.queueAtReady], ['Picker', (r) => r.pickerName || '', null, 'l'], ['SKUs', (r) => r.skus], ['Result', (r) => (r.late ? 1 : 0), result],
        ], waits)) +
        card('Longest picks', 'Over ' + CFG.LONG_HANDLING_MIN + ' min, or over ' + Math.round(CFG.LONG_MIN_PER_SKU * 60) + ' sec per SKU. Top 40. A long pick on a small basket usually means the picker stopped mid-order or couldn\'t find items' + (CFG.SHOW_COFFEE !== false ? '; on a coffee order, check whether the picker waited for the barista' : '') + '.', slow.length ? table([
          ['Order', (r) => r.orderNumber, (r) => '<b>' + esc(r.orderNumber) + '</b>', 'l'], ['Type', (r) => (r.scheduled ? 1 : 0), model, 'l'], ['Created', (r) => r.placed, (r) => fmtTime(r.placed)],
          ['Coffee', (r) => (r.coffee ? 1 : 0), (r) => yes(r.coffee, r.coffeeOnly ? 'coffee only' : 'coffee')], ['Pharmacy', (r) => (r.pharma ? 1 : 0), (r) => yes(r.pharma, 'pharmacy')],
          ['Picker', (r) => r.pickerName || '', (r) => esc(r.pickerName || '') + (r.rosterOk === false ? '<br><span class="muted">' + esc(r.rosterWhy) + ', not counted</span>' : ''), 'l'],
          ['Started', (r) => r.start, (r) => fmtTime(r.start) + (r.startSource === 'recorded' ? '' : ' <span class="muted">est.</span>')], ['Packed', (r) => r.packed, (r) => fmtTime(r.packed)],
          ['Picking time', (r) => r.handleMin, (r) => hm(r.handleMin)], ['SKUs', (r) => r.skus], ['Sec / SKU', (r) => r.secPerSku, (r) => fmt(r.secPerSku, 0)], ['Result', (r) => (r.late ? 1 : 0), result],
        ], slow) : '<p class="muted">None.</p>');
    },

    baskets(A) {
      const P = A.pk;
      const used = SKU_BANDS.map((b, i) => i).filter((i) => P.list.some((p) => p.bandCounts[i]));   // groups nobody picked are left out
      const BANDS = used.map((i) => SKU_BANDS[i]);
      const cols = [['Picker', (r) => r.name, (r) => esc(r.name), 'l'], ['Orders', (r) => r.orders]].concat(BANDS.map((b, j, _, i = used[j]) => [bandLabel(b), (r) => r.bandCounts[i], (r) => (r.bandCounts[i] ? r.bandCounts[i] + ' <span class="muted">(' + fmtPct(rate(r.bandCounts[i], r.orders)) + ')</span>' : '<span class="muted">0</span>')])).concat([['Avg SKUs', (r) => r.avgSkus, (r) => fmt(r.avgSkus, 1)]]);
      const cols2 = [['Picker', (r) => r.name, (r) => esc(r.name), 'l']].concat(BANDS.map((b, j, _, i = used[j]) => [bandLabel(b), (r) => r.bandPerSku[i], (r) => fmt(r.bandPerSku[i] != null ? r.bandPerSku[i] * 60 : null, 0)])).concat([['Overall', (r) => r.medPerSku, (r) => fmt(r.medPerSku != null ? r.medPerSku * 60 : null, 0)]]);
      const team = BANDS.map((b) => { const g = P.rows.filter((r) => r.skus != null && r.skus >= b[0] && r.skus <= b[1]); return { label: bandLabel(b), orders: g.length, medHandle: median(g.map((r) => r.handleMin)), medPerSku: median(g.map((r) => r.minPerSku)), storeLate: g.filter((r) => r.storeLate).length }; });
      return '<div class="note">Use this before judging a slow picker: someone who got most of the big baskets will have longer picking times. Compare <b>seconds per SKU within the same size group</b>. The groups are the same as on Basket size; groups nobody picked today are left out. <b>FP late</b> = late orders the FP owns (as ETA Late Analysis).</div>' +
        card('Who picked which basket sizes', '', table(cols, P.list)) +
        card('Seconds per SKU by basket size', 'Median seconds per SKU for each picker in each band.', table(cols2, P.list)) +
        card('Team picking time by basket size', '', table([
          ['Basket', (r) => r.label, null, 'l'], ['Orders', (r) => r.orders], ['Median picking time', (r) => r.medHandle, (r) => fmt(r.medHandle, 1)], ['Sec / SKU', (r) => r.medPerSku, (r) => fmt(r.medPerSku != null ? r.medPerSku * 60 : null, 0)], ['FP late', (r) => r.storeLate],
        ], team));
    },

    ranking() {
      const H = rankingHistory(UI.history || loadHistory());
      const keys = Object.values(H).map((d) => dateKey(d.date)).sort();
      if (!keys.length) return '<div class="status">Analyse at least one day to build the ranking.</div>';
      const range = PK_VIEWS._range || 'all';
      const now = new Date(); const ym = now.getFullYear() + pad2(now.getMonth() + 1);
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1); const pym = prev.getFullYear() + pad2(prev.getMonth() + 1);
      const from = range === 'month' ? ym + '01' : range === 'prev' ? pym + '01' : null;
      const to = range === 'prev' ? pym + '31' : null;
      const list = rankPickers(H, from, to);
      const days = keys.filter((k) => (!from || k >= from) && (!to || k <= to)).length;
      const W = CFG.RANK_WEIGHTS;
      return '<div class="mapbar"><div class="seg" data-rank>' + [['all', 'All saved days'], ['month', 'This month'], ['prev', 'Last month']].map(([k, l]) => '<button data-v="' + k + '" class="' + (range === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div></div>' +
        '<div class="note">Built from the ' + days + ' day' + (days === 1 ? '' : 's') + ' you\'ve analysed in this range. <b>Score</b> (0–100) ranks each picker against the others on SKUs per hour (' + Math.round(100 * W.skusPerHour) + '%), minutes per SKU (' + Math.round(100 * W.minPerSku) + '%), share of their orders late because of slow picking (' + Math.round(100 * W.storeLate) + '%; orders that were late only because they waited in the queue don\'t count against the picker) and days worked (' + Math.round(100 * W.attendance) + '%). Tiers: top 20% Tier 1, next 30% Tier 2, next 30% Tier 3, rest Tier 4. Weights are in the SETTINGS block. Analyse every day of the month for a fair ranking.</div>' +
        card('Picker ranking', '', list.length ? table([
          ['Rank', (r) => r.rank], ['Picker', (r) => r.name, (r) => esc(r.name) + ' <span class="muted">' + esc(r.hr || '') + '</span>', 'l'], ['Tier', (r) => r.tier, (r) => '<span class="tier">' + r.tier + '</span>', 'l'], ['Score', (r) => r.score, (r) => fmt(r.score, 0)],
          ['Days', (r) => r.days], ['Orders', (r) => r.orders], ['SKUs', (r) => r.skus], ['Hours', (r) => r.hours, (r) => fmt(r.hours, 1)], ['SKUs / hr', (r) => r.skusPerHour, (r) => fmt(r.skusPerHour, 0)], ['Orders / hr', (r) => r.perHour, (r) => fmt(r.perHour, 1)],
          ['Sec / SKU', (r) => r.medPerSku, (r) => fmt(r.medPerSku != null ? r.medPerSku * 60 : null, 0)], ['Late from slow picking %', (r) => r.slowLatePct, (r) => latePill(r.slowLatePct)], ['FP late %', (r) => r.storeLatePct, (r) => fmtPct(r.storeLatePct)], ['Long picks %', (r) => r.longPct, (r) => fmtPct(r.longPct)],
        ], list) : '<p class="muted">No pickers in this range.</p>');
    },

    live() {
      const snap = PKREC.snapshot;
      if (!snap) return '<div class="status">No live reading yet. It starts automatically a few seconds after the Control Room loads and repeats every ' + CFG.POLL_MIN + ' minutes.</div>';
      const prep = snap.rows.map((o) => ({ o, f: pickerPrep(o) })).filter((x) => x.f && ['waiting', 'assigned', 'picking'].includes(x.f.PreparationStatus));
      const waiting = prep.filter((x) => x.f.PreparationStatus === 'waiting').map((x) => ({ num: x.o.orderNumber, slot: slotHourOf(x.o.timeSlot), placed: toMs(x.o.placingTime), skus: (x.o.products || []).length, model: x.o.deliveryModel }));
      const busy = prep.filter((x) => x.f.PreparationStatus !== 'waiting').map((x) => ({ picker: x.o.picker ? cleanName(x.o.picker.firstName, x.o.picker.lastName) : '–', num: x.o.orderNumber, status: x.f.PreparationStatus, skus: (x.o.products || []).length, slot: slotHourOf(x.o.timeSlot) }));
      return '<div class="tiles">' + tile('Orders waiting', waiting.length, 'No picker yet') + tile('Pickers busy', new Set(busy.map((b) => b.picker)).size, busy.length + ' orders in hand') + tile('As of', fmtTime(snap.t), 'refreshes every ' + CFG.POLL_MIN + ' min') + '</div>' +
        card('Pickers right now', '', busy.length ? table([['Picker', (r) => r.picker, null, 'l'], ['Order', (r) => r.num, null, 'l'], ['Status', (r) => r.status, null, 'l'], ['SKUs', (r) => r.skus], ['Slot', (r) => r.slot, (r) => esc(slotLabel(r.slot)), 'l']], busy) : '<p class="muted">No picker has an order in hand.</p>') +
        card('Orders waiting for a picker', '', waiting.length ? table([['Order', (r) => r.num, null, 'l'], ['Slot', (r) => r.slot, (r) => esc(slotLabel(r.slot)), 'l'], ['Type', (r) => r.model, null, 'l'], ['Placed', (r) => r.placed, (r) => fmtTime(r.placed)], ['Waiting', (r) => (snap.t - r.placed) / MIN, (r) => hm((snap.t - r.placed) / MIN)], ['SKUs', (r) => r.skus]], waiting.sort((a, b) => a.placed - b.placed)) : '<p class="muted">Queue is empty.</p>');
    },

    history() {
      const H = UI.history || loadHistory();
      const list = Object.values(H).sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? 1 : -1));
      if (!list.length) return '<div class="status">No saved days yet.</div>';
      return '<div class="note">Every date you analyse is saved here and feeds the Ranking.</div>' + card('Saved days', '', table([
        ['Date', (r) => dateKey(r.date), (r) => esc(r.date), 'l'], ['Pickers', (r) => r.pickerCount], ['Orders', (r) => r.orders], ['SKUs', (r) => r.skus], ['Orders / picker hr', (r) => r.perPickerHour, (r) => fmt(r.perPickerHour, 1)],
        ['Median wait', (r) => r.medWait, (r) => fmt(r.medWait, 1)], ['Median picking', (r) => r.medHandle, (r) => fmt(r.medHandle, 1)], ['Sec / SKU', (r) => r.medPerSku, (r) => fmt(r.medPerSku != null ? r.medPerSku * 60 : null, 0)],
        ['Peak queue', (r) => r.peakQueue], ['FP late', (r) => r.storeLate], ['Waited for picker', (r) => r.queueLate], ['Slow picking', (r) => r.slowLate], ['Recorded', (r) => r.recordedShare, (r) => (r.recordedShare ? fmtPct(r.recordedShare) : '–')],
      ], list));
    },
  };

  /* ------------------------------------------------------------------
   * LIVE SOURCES: capacity (DCM), auto-assign engine, FP status, official zones.
   * All read-only. Recorded per FP per day in this browser so past days can be reviewed.
   * ------------------------------------------------------------------ */
  const DCM = {
    config: null, configAt: 0, slots: {}, drivers: null, driversAt: 0, engine: null, engineAt: 0, timer: null, err: null,
    async loadConfig(fp, force) {
      if (!force && DCM.config && DCM.config._fp === fp && Date.now() - DCM.configAt < 30 * MIN) return DCM.config;
      const j = await apiGet(DCM_BASE + '/fps/' + fp);
      DCM.config = (j && j.data) || null;
      if (DCM.config) DCM.config._fp = fp;
      DCM.configAt = Date.now();
      return DCM.config;
    },
    timeslots() {
      const ms = (DCM.config && DCM.config.deliveryModels) || [];
      const m = ms.find((d) => d.deliveryConfig && d.deliveryConfig.generateModel && d.deliveryConfig.generateModel.type === 'now') || ms[0];
      return ((m && m.timeslots) || []).map((t) => Object.assign({}, t, { hour: parseInt(String(t.name || '').split(':')[0], 10) })).filter((t) => isFinite(t.hour));
    },
    slotForHour(h) { return DCM.timeslots().find((t) => t.hour === h) || null; },
    async loadSlot(fp, id) {
      const j = await apiGet(DCM_BASE + '/fps/' + fp + '/timeslot/' + id);
      const d = j && j.data;
      if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
      d.t = Date.now();
      d.hour = parseInt(String(d.name || '').split(':')[0], 10);
      DCM.slots[id] = d;
      DCM.record(fp, d);
      return d;
    },
    async loadDrivers(fp, force) {
      if (!force && DCM.drivers && DCM.drivers._fp === fp && Date.now() - DCM.driversAt < 20 * MIN) return DCM.drivers;
      const j = await apiGet(DCM_BASE + '/fps/' + fp + '/drivers');
      DCM.drivers = (j && j.data) || [];
      DCM.drivers._fp = fp;
      DCM.driversAt = Date.now();
      return DCM.drivers;
    },
    async loadEngine(fp) {
      const j = await apiGet(FLEET_BASE + '/v1/auto-assign/engine-status/' + fp);
      DCM.engine = (j && (j.data && typeof j.data === 'object' ? j.data : j)) || null;
      DCM.engineAt = Date.now();
      if (DCM.engine && fp) DCM.recordEngine(fp, DCM.engine);
      return DCM.engine;
    },
    key: (fp, dk) => STORE_DCM + fp + ':' + dk,
    load(fp, dk) { try { return JSON.parse(localStorage.getItem(DCM.key(fp, dk)) || 'null'); } catch (e) { return null; } },
    record(fp, d) {
      const dk = dateKeyOf(d.t);
      const r = DCM.load(fp, dk) || { slots: {}, ev: [], eng: [] };
      const delta = d.meta && d.meta.delta ? Number(d.meta.delta.value) || 0 : 0;
      const prev = r.slots[d.hour] || {};
      r.slots[d.hour] = {
        cap: d.capacity, delta, base: d.capacity - delta, placed: d.ordersPlaced, avail: d.availableCapacity, backlog: d.backlog,
        active: d.activeDAs, availN: d.availableCount, inTrip: d.inTripCount, dph: d.averageDph, t: d.t,
        minAvail: Math.min(prev.minAvail != null ? prev.minAvail : Infinity, d.availableCapacity),
        maxCap: Math.max(prev.maxCap || 0, d.capacity), minCap: Math.min(prev.minCap != null ? prev.minCap : Infinity, d.capacity),
        deltas: Array.from(new Set((prev.deltas || []).concat([delta]))).slice(-8),
      };
      r.ev.push([d.t, d.hour, d.capacity, d.ordersPlaced, d.availableCapacity, d.activeDAs, d.availableCount, d.inTripCount, delta]);
      if (r.ev.length > 600) r.ev = r.ev.slice(-600);
      try { localStorage.setItem(DCM.key(fp, dk), JSON.stringify(r)); } catch (e) { }
    },
    recordEngine(fp, e) {
      const t = Date.now(), dk = dateKeyOf(t);
      const r = DCM.load(fp, dk) || { slots: {}, ev: [], eng: [] };
      r.eng = r.eng || [];
      const s = (e.autoAssignEnabled ? 'A' : '-') + (e.manualAssignEnabled ? 'M' : '-');
      const last = r.eng[r.eng.length - 1];
      if (!last || last[1] !== s) r.eng.push([t, s]);
      try { localStorage.setItem(DCM.key(fp, dk), JSON.stringify(r)); } catch (err) { }
    },
    start() {
      if (DCM.timer) return;
      DCM.timer = setInterval(DCM.poll, CFG.LIVE_POLL_MIN * MIN);
      setTimeout(DCM.poll, 7000);
    },
    async poll() {
      if (!onControlRoom()) return;
      const fp = fpIdFromCapture();
      if (!fp) return;
      try { await DCM.loadEngine(fp); } catch (e) { }
      try {
        await DCM.loadConfig(fp);
        const h = new Date().getHours();
        const cur = DCM.slotForHour(h), next = DCM.slotForHour((h + 1) % 24);
        if (cur) await DCM.loadSlot(fp, cur.id);
        if (next) await DCM.loadSlot(fp, next.id);
        DCM.err = null;
      } catch (e) { DCM.err = e.message; }
      pruneStore(STORE_DCM);
      LIVE.refresh();
    },
    current() {
      const h = new Date().getHours();
      const t = DCM.slotForHour(h);
      const s = t && DCM.slots[t.id];
      return s && Date.now() - s.t < 20 * MIN ? s : null;
    },
  };

  // The DCM reading the brain judges a slot by (v1.17): the last reading's capacity before any manual change (capacity − manual
  // delta), when DCM gave the delta; else the capacity as read. dcmManual says what it was set to by hand.
  const dcmUnadj = (rs) => (!rs ? null : rs.base != null && isFinite(rs.base) ? rs.base : rs.cap);
  const dcmManual = (rs) => (rs && rs.delta ? ' (set to ' + rs.cap + ' by hand, ' + (rs.delta > 0 ? '+' : '−') + Math.abs(rs.delta) + ')' : '');

  /* ---------- FP status and official zones (from the warehouse list) ---------- */
  const FPSTAT = {
    cur: null, at: 0, timer: null, disabled: false, err: null, areasErr: null, loadingAreas: false,
    key: (fp, dk) => STORE_FPSTAT + fp + ':' + dk,
    load(fp, dk) { try { return JSON.parse(localStorage.getItem(FPSTAT.key(fp, dk)) || 'null'); } catch (e) { return null; } },
    loadAreas(fp) { try { return JSON.parse(localStorage.getItem(STORE_AREAS + fp) || 'null'); } catch (e) { return null; } },
    ingest(j, source) {
      const list = Array.isArray(j) ? j : j && (Array.isArray(j.data) ? j.data : Array.isArray(j.warehouses) ? j.warehouses : null);
      if (!list) return false;
      const fp = fpIdFromCapture();
      const w = fp ? list.find((x) => x && String(x._id) === fp) : null;
      if (!w) return false;
      if (w.nowStatus) FPSTAT.setStatus(fp, w.nowStatus);
      if (Array.isArray(w.areas) && w.areas.length) FPSTAT.saveAreas(fp, w);
      return true;
    },
    saveAreas(fp, w) {
      const rings = [];
      w.areas.forEach((a) => {
        const m = a && a.map; if (!m || !m.coordinates) return;
        const name = (a.name && (a.name.en || a.name.ar)) || (typeof a.name === 'string' ? a.name : 'Zone');
        const polys = m.type === 'MultiPolygon' ? m.coordinates : m.type === 'Polygon' ? [m.coordinates] : [];
        polys.forEach((p, i) => {
          const ring = (p[0] || []).map((c) => [Number(c[1]), Number(c[0])]).filter((c) => isFinite(c[0]) && isFinite(c[1]));
          if (ring.length >= 3) rings.push({ name: polys.length > 1 ? name + ' (' + (i + 1) + ')' : name, ring, enabled: a.isEnabled !== false });
        });
      });
      if (!rings.length) return;
      const loc = w.location && w.location.coordinates;
      const v = { areas: rings, savedAt: Date.now(), fpName: w.name, shortName: w.shortName, location: loc ? [Number(loc[1]), Number(loc[0])] : null, shelves: w.settings && w.settings.shelvesCapacity };
      try { localStorage.setItem(STORE_AREAS + fp, JSON.stringify(v)); } catch (e) { }
      if (v.location) { try { if (!localStorage.getItem(STORE_COORDS + fp)) localStorage.setItem(STORE_COORDS + fp, JSON.stringify({ lat: v.location[0], lng: v.location[1] })); } catch (e) { } }
    },
    async fetchAreas(fp) {
      FPSTAT.loadingAreas = true;
      try {
        const j = await apiFetch(WH_URL, { method: 'POST', body: { project: [{ key: 'basicInfo', value: 1 }, { key: 'areas', value: 1 }] } });
        if (!FPSTAT.ingest(j, 'brain')) throw new Error('This FP was not in the warehouse list');
        FPSTAT.areasErr = null;
        return FPSTAT.loadAreas(fp);
      } catch (e) { FPSTAT.areasErr = e.message; return null; } finally { FPSTAT.loadingAreas = false; }
    },
    setStatus(fp, ns) {
      const t = Date.now();
      FPSTAT.cur = { status: ns.status || 'UNKNOWN', forced: !!ns.forced, until: ns.forcedStatusExpiration || null, shift: ns.currentShiftName || null, slot: ns.availableTimeslot || null, t };
      FPSTAT.at = t;
      const dk = dateKeyOf(t);
      const r = FPSTAT.load(fp, dk) || { ev: [] };
      const s = FPSTAT.cur.status + (FPSTAT.cur.forced ? '*' : '');
      const last = r.ev[r.ev.length - 1];
      if (!last || last[1] !== s) r.ev.push([t, s, FPSTAT.cur.until]);
      r.last = t;
      // spans of time the status was being checked (v1.16): forced orders read the status only inside them
      r.seg = r.seg || [];
      const sg = r.seg[r.seg.length - 1];
      if (sg && t - sg[1] <= 2.5 * CFG.FP_STATUS_POLL_MIN * MIN) sg[1] = t; else r.seg.push([t, t]);
      try { localStorage.setItem(FPSTAT.key(fp, dk), JSON.stringify(r)); } catch (e) { }
    },
    start() {
      if (FPSTAT.timer) return;
      FPSTAT.timer = setInterval(FPSTAT.poll, CFG.FP_STATUS_POLL_MIN * MIN);
      setTimeout(FPSTAT.poll, 12000);
    },
    async poll() {
      if (FPSTAT.disabled || !onControlRoom()) return;
      const fp = fpIdFromCapture();
      if (!fp) return;
      try {
        // Basic info only (no zone shapes): a few hundred KB for every FP. Stops itself if that isn't supported.
        const j = await apiFetch(WH_URL, { method: 'POST', body: { project: [{ key: 'basicInfo', value: 1 }] }, maxBytes: 2500000 });
        const list = Array.isArray(j) ? j : j && j.data;
        const w = Array.isArray(list) ? list.find((x) => x && String(x._id) === fp) : null;
        if (!w || !w.nowStatus) { FPSTAT.disabled = true; FPSTAT.err = 'FP status not available from the warehouse list'; return; }
        FPSTAT.setStatus(fp, w.nowStatus);
        FPSTAT.err = null;
        const z = FPSTAT.loadAreas(fp);
        if (!z || Date.now() - z.savedAt > 7 * 86400000) FPSTAT.fetchAreas(fp);
      } catch (e) {
        FPSTAT.err = e.message;
        if (/too large|Blocked|404|405/.test(e.message)) FPSTAT.disabled = true;
      }
      pruneStore(STORE_FPSTAT);
      LIVE.refresh();
    },
  };

  /* ---------- live alerts: what needs attention right now ---------- */
  const LIVE = {
    alerts: [], at: 0,
    refresh() {
      try { LIVE.alerts = LIVE.compute(); LIVE.at = Date.now(); } catch (e) { LIVE.alerts = []; }
      if (UI.root) { UI.updateButton(); if (UI.isOpen() && ['live', 'capacity', 'now'].includes(UI.tab)) UI.render(true); }
    },
    pending() {
      const snap = PKREC.snapshot;
      if (!snap) return null;
      const now = snap.t;
      const rows = snap.rows.filter((o) => !o.isSubOrder && !['cancelled', 'completed'].includes(String(o.status)));
      return rows.map((o) => {
        const f = pickerPrep(o);
        const a = o.actions || {};
        const packed = toMs(a.packaged), picked = toMs(a.received);
        const stage = picked ? 'With DA' : packed ? 'Awaiting pickup' : f && f.PreparationStatus === 'waiting' ? 'Waiting for picker' : f && ['assigned', 'picking'].includes(f.PreparationStatus) ? 'Picking' : 'In the FP';
        const deadline = toMs(o.deliveryDeadlineTs);
        const model = String(o.deliveryModel || '').toUpperCase();
        return {
          num: o.orderNumber, model, now: !model.startsWith('SCHEDULED'), stage, placed: toMs(o.placingTime), packed, picked, deadline,
          left: deadline != null ? (deadline - now) / MIN : null, slot: slotHourOf(o.timeSlot), skus: Array.isArray(o.products) ? o.products.length : null,
          picker: o.picker && o.picker.id ? cleanName(o.picker.firstName, o.picker.lastName) : null,
          da: (o.deliveryPersons || [])[0] ? String(o.deliveryPersons[0].name || '').trim() : null,
          coffee: !!o.hasCoffee, t: now,
        };
      });
    },
    compute() {
      const out = [];
      const add = (level, title, detail, action, tab) => out.push({ level, title, detail, action, tab });
      const P = LIVE.pending();
      const snapAge = PKREC.snapshot ? (Date.now() - PKREC.snapshot.t) / MIN : null;
      if (P) {
        const waiting = P.filter((x) => x.stage === 'Waiting for picker');
        const oldestWait = waiting.length ? Math.max(...waiting.map((x) => (x.t - (x.placed || x.t)) / MIN)) : 0;
        const nowWaiting = waiting.filter((x) => x.now);
        if (nowWaiting.length >= CFG.ALERT_QUEUE || (nowWaiting.length && oldestWait >= CFG.WAIT_TARGET_MIN * 2)) {
          add('bad', nowWaiting.length + ' NOW orders waiting for a picker', 'Oldest has waited ' + hm(oldestWait) + '. ' + new Set(P.filter((x) => x.stage === 'Picking' && x.picker).map((x) => x.picker)).size + ' pickers have an order in hand.', 'Pull someone from restock or receiving onto picking, and check who is on break.', 'live');
        }
        const shelf = P.filter((x) => x.stage === 'Awaiting pickup' && x.packed && (x.t - x.packed) / MIN >= CFG.ALERT_SHELF_MIN);
        const daSnap = DAREC.snapshot;
        const freeDAs = daSnap ? daSnap.list.filter((d) => daStatus(d) === 'A').length : null;
        if (shelf.length) {
          const oldest = Math.max(...shelf.map((x) => (x.t - x.packed) / MIN));
          add(freeDAs ? 'bad' : 'warn', shelf.length + ' packed orders awaiting pickup ' + CFG.ALERT_SHELF_MIN + '+ min', 'Oldest packed ' + hm(oldest) + ' ago.' + (freeDAs != null ? ' ' + freeDAs + ' DAs show as available right now.' : ''),
            freeDAs ? 'DAs are free but orders are not moving: check auto-assign and whether those DAs are really at the FP.' : 'No free DAs: call back DAs on break, or lower DCM capacity for the next slot.', 'live');
        }
        // ETA late % judges NOW orders only (as the official scorecard), so the alert watches NOW orders
        const risk = P.filter((x) => x.now && x.stage !== 'With DA' && x.left != null && x.left <= CFG.ALERT_RISK_MIN);
        if (risk.length) add(risk.some((x) => x.left < 0) ? 'bad' : 'warn', risk.length + ' NOW orders about to miss their ETA', risk.slice(0, 6).map((x) => x.num + ' (' + x.stage.toLowerCase() + ', ' + (x.left < 0 ? Math.round(-x.left) + 'm over' : Math.round(x.left) + 'm left') + ')').join(', ') + (risk.length > 6 ? '…' : ''), 'Push these to the front: picker first, then the next free DA.', 'live');
      }
      if (DCM.engine) {
        if (DCM.engine.autoAssignEnabled === false) add('bad', 'Auto-assign is OFF', 'Every order needs a manual DA assignment, so the auto-assign rate will drop.', 'Turn it back on in Auto-assign settings unless logistics switched it off on purpose.', 'live');
        else if (DCM.engine.manualAssignEnabled) add('info', 'Manual assign mode is on', 'Auto-assign is running, and manual assignment is also enabled.', '', 'live');
      }
      if (FPSTAT.cur && Date.now() - FPSTAT.cur.t < 30 * MIN) {
        const st = FPSTAT.cur;
        if (st.status !== 'AVAILABLE' || st.forced) add('warn', 'FP status: ' + st.status + (st.forced ? ' (forced)' : ''), (st.until ? 'Until ' + fmtTime(toMs(st.until) || Date.parse(st.until)) + '. ' : '') + 'NOW orders are being pushed to later slots; each forced order counts its full wait in P90 incl. forced.', 'Fix the bottleneck that caused it (pickers, DAs or capacity), then reopen as soon as you can.', 'capacity');
      }
      const cur = DCM.current();
      if (cur) {
        if (cur.availableCapacity <= 0) add('warn', 'Current slot is full in DCM', cur.ordersPlaced + ' orders placed for capacity ' + cur.capacity + '. New NOW orders will be pushed to later slots.', 'Check Capacity below: if pickers and DAs can take more, raise it; if not, this is protecting the ETA.', 'capacity');
        if (cur.backlog > 2) add('info', 'Backlog of ' + cur.backlog + ' in DCM', 'Orders carried into this slot from earlier.', '', 'capacity');
      }
      if (snapAge != null && snapAge > 10) add('info', 'Live data is ' + Math.round(snapAge) + ' min old', 'The brain records only while a Control Room tab is open.', 'Keep one Control Room tab open during the shift.', 'live');
      const order = { bad: 0, warn: 1, info: 2 };
      return out.sort((a, b) => order[a.level] - order[b.level]);
    },
  };

  /* ------------------------------------------------------------------
   * SCORECARD: the eight KPIs against target, hour by hour, with the drivers behind each miss
   * ------------------------------------------------------------------ */
  const KPI_DEFS = [
    { key: 'p90f', label: 'P90 incl. forced', unit: 'min', d: 0, lower: true, target: () => CFG.P90_TARGET_MIN, warn: () => CFG.WARN.p90, get def() { return 'Placed to delivered, 90th percentile, NOW orders plus forced orders, by the day the order was placed. Forced = scheduled express, or placed while the NOW slot was full / the FP was not open (recorded), else scheduled under ' + CFG.PLANNED_AHEAD_HOURS + 'h ahead.'; } },
    { key: 'p90n', label: 'P90 NOW', unit: 'min', d: 0, lower: true, target: () => CFG.P90_TARGET_MIN, warn: () => CFG.WARN.p90, def: 'Same, NOW orders only (no scheduled orders).' },
    { key: 'eta', label: 'ETA late %', unit: '%', d: 1, lower: true, target: () => CFG.LATE_TARGET_PCT, warn: () => CFG.WARN.eta, def: 'NOW orders delivered after their ETA ÷ NOW orders delivered, as the official scorecard.' },
    { key: 'ppho', label: 'PPH (Ops)', unit: '', d: 1, lower: false, target: () => CFG.PPH_OPS_TARGET, warn: () => CFG.WARN.ppho, def: 'Orders (completed and not received) ÷ picker active hours. A picker active hour = one picker in one clock hour in which they started picking at least one order. As Tableau\'s PPH (Ops) and Picker Hours.' },
    { key: 'dpho', label: 'DPH (Ops)', unit: '', d: 2, lower: false, target: () => CFG.DPH_OPS_TARGET, warn: () => CFG.WARN.dpho, def: 'Orders (completed and not received) ÷ DA active hours. A DA active hour = one DA in one clock hour in which they picked up at least one order. As Tableau\'s DPH (Ops) and DA Hours.' },
    { key: 'pph', label: 'PPH', unit: '', d: 1, lower: false, target: () => CFG.PPH_TARGET, warn: () => CFG.WARN.pph, get def() { return 'Each clock hour: orders whose picking started that hour, by pickers who started ' + CFG.PPH_MIN_PICKS + '+ that hour, ÷ those pickers. Day = average of those hours.'; } },
    { key: 'dph', label: 'DPH', unit: '', d: 2, lower: false, target: () => CFG.DPH_TARGET, warn: () => CFG.WARN.dph, get def() { return 'Each clock hour: orders picked up that hour, by DAs who picked up ' + CFG.DPH_MIN_DELIVERIES + '+ that hour, ÷ those DAs. Day = average of those hours.'; } },
    { key: 'auto', label: 'Auto-assign rate', unit: '%', d: 1, lower: false, target: () => CFG.AUTO_ASSIGN_TARGET, warn: () => CFG.WARN.auto, def: 'Auto-assigned orders, plus orders re-assigned to the same DA, ÷ orders with a DA. Orders given to a different DA by hand count against it.' },
  ];
  const kpiDef = (k) => KPI_DEFS.find((d) => d.key === k);
  function kpiStatus(def, v) {
    if (v == null || !isFinite(v)) return null;
    const t = def.target(), w = def.warn();
    if (def.lower) return v <= t ? 'good' : v <= w ? 'warn' : 'bad';
    return v >= t ? 'good' : v >= w ? 'warn' : 'bad';
  }
  const kpiFmt = (def, v) => (v == null || !isFinite(v) ? '–' : Number(v).toFixed(def.d) + (def.unit === '%' ? '%' : ''));
  const kpiPill = (key, v) => {
    const def = kpiDef(key), st = kpiStatus(def, v);
    return !st ? '<span class="muted">–</span>' : LITE && st === 'good' ? '<span class="okv">' + kpiFmt(def, v) + '</span>' : '<span class="pill ' + st + '">' + kpiFmt(def, v) + '</span>';
  };

  // Why one late order was late. lateReason = the finer split it starts from (store queue vs pick, shelf, road, coffee / pharmacy).
  const lateReason = (r) => (r.cpVerdict && CP_NOT_FP.includes(r.cpVerdict) ? r.cpVerdict : IN_STORE.includes(r.cause) ? r.storeLate || (r.cause === 'Packed after deadline' ? 'Slow picking' : 'Waited for a picker') : r.cause || 'Unknown');
  // v1.18: ONE vocabulary everywhere (Scorecard, Root causes, ETA Late Analysis, P90, history, team editions): the root-cause
  // categories below. Set on every late order when the day is scored (r.rcCat); whyLate(r) reads it.
  const RC_CATS = ['Picker shortage', 'Slow picking', 'Held for another order', 'DA shortage', 'Free DAs not assigned', 'Slow DA', 'Multi-order trip', 'Far drop / short ETA', 'Large basket', 'Coffee', 'Pharmacy', 'Forced orders', 'Not recorded'];
  const RC_COLORS = {
    'Picker shortage': '#DB3738', 'Slow picking': '#E5813B', 'Held for another order': '#f29b7a', 'Large basket': '#C33F91', 'DA shortage': '#EDC246', 'Free DAs not assigned': '#b8860b', 'Slow DA': '#4D58A7',
    'Multi-order trip': '#7b6fd0', 'Far drop / short ETA': '#1393CD', 'Coffee': '#7A6051', 'Pharmacy': '#00A9A1', 'Forced orders': '#AA0382', 'Not recorded': '#AC9C93',
  };
  const RC_HELP = {
    'Picker shortage': 'packed late because they waited in the queue for a free picker',
    'Slow picking': 'a picker took them on time but the pick itself was slow',
    'Held for another order': 'packed in time, but the DA waited for another order of the same trip that the FP packed later',
    'Large basket': 'a large basket whose ETA was shorter than its usual picking time + pickup + the usual ride: it could not be on time',
    'DA shortage': 'packed in time, then sat awaiting pickup with no DA free',
    'Free DAs not assigned': 'sat awaiting pickup while DAs were recorded free with no order',
    'Slow DA': 'first drop of the trip, but the ride took ' + '{m}+ min longer than the usual ride to that sub-area',
    'Multi-order trip': 'later drops of a multi-drop trip: the earlier drops came first',
    'Far drop / short ETA': 'first drop, normal ride time, still late: the ETA was too short for the distance',
    'Coffee': 'held up by the barista', 'Pharmacy': 'held up by the pharmacy stop',
    'Forced orders': 'pushed into a later slot and waited long before delivery (P90 incl. forced)',
    'Not recorded': 'no packing or pickup time recorded',
  };
  const RC_ACTION = {
    'Picker shortage': 'Put another picker (or a lead) on picking in this hour, and keep breaks out of it.',
    'Slow picking': 'Check who picked slowly in this hour (Pickers → Performance) and why: missing items, big baskets, phone.',
    'Held for another order': 'Pack orders of the same trip together: the DA was waiting for the last one. Check the picker queue in this hour.',
    'Large basket': 'The ETA was too short for the basket: send the order numbers to the ETA / product team.',
    'DA shortage': 'More DAs out on trips in this hour (breaks out of it), or a lower DCM capacity for it.',
    'Free DAs not assigned': 'DAs were free while orders waited: check auto-assign and manual holds with the coordinator.',
    'Slow DA': 'Check which DAs rode slowly (DAs → Performance, ride vs usual) and talk to them.',
    'Multi-order trip': 'Fewer multi-drop trips in this hour, and only pair drops going the same way.',
    'Far drop / short ETA': 'Rides were normal but the ETA was too short for the distance: raise those sub-areas with the ETA / zones team.',
    'Coffee': 'Raise barista cover or speed for this hour with the coffee team.',
    'Pharmacy': 'Escalate the pharmacy delays to the pharmacy partner.',
    'Forced orders': 'Find why the earlier slots were full or the FP was busy (DCM, FP status); every forced order carries its whole wait into P90.',
    'Not recorded': 'Keep the Control Room open during the shift so packing and pickup times are recorded.',
  };
  const REASON_ORDER = RC_CATS.filter((c) => c !== 'Forced orders');
  const REASON_COLORS = RC_COLORS;
  const REASON_VERB = {
    'Picker shortage': 'waited for a free picker', 'Slow picking': 'were picked slowly', 'Held for another order': 'waited for another order of their trip to be packed', 'Large basket': 'were large baskets with too short an ETA', 'DA shortage': 'sat awaiting pickup with no DA free', 'Free DAs not assigned': 'sat awaiting pickup while DAs were free',
    'Slow DA': 'had a slow first ride', 'Multi-order trip': 'were later drops of multi-drop trips', 'Far drop / short ETA': 'had a normal ride but too short an ETA', 'Coffee': 'were held up by the coffee', 'Pharmacy': 'were held up by the pharmacy stop', 'Not recorded': 'have no clear cause',
  };
  /* v1.25: two checks on late NOW orders, before the owner split and the late category.
   * Large basket: LARGE_BASKET_SKUS+ SKUs and the ETA window (placed → ETA) was shorter than the usual picking time for its
   *   size (median, saved days) + the pickup allowance (HANDOFF_BUFFER_MIN) + the usual ride to its sub-area. It could not be on
   *   time even with no queue and no waiting, so it is neither the FP's nor logistics' late (owner "Large basket (ETA too short)").
   * Held for another order: packed in time, but its DA left within 3 min of the FP packing another order of the same trip (packed
   *   after it), and leaving at packing + the allowance would have made its ETA: the DA was waiting for the FP, so it is the FP's. */
  function markLateChecks(A) {
    const M = 60000, buf = CFG.HANDOFF_BUFFER_MIN || 0, L = CFG.LARGE_BASKET_SKUS || 10;
    const typ = basketTypicalPick(A);
    const trips = groupBy(A.rows.filter((r) => !r.wasSub && r.tripId && r.packed != null), (r) => String(r.tripId));
    A.rows.forEach((r) => {
      r.bigBasket = false; r.heldFor = null;
      if (!r.late || r.scheduled) return;
      if (r.skus != null && r.skus >= L && r.placed != null && r.deadline != null && r.directLeg != null) {
        const pick = typ(r.skus);
        if (pick != null) {
          const need = pick + buf + r.directLeg, win = (r.deadline - r.placed) / M;
          if (win < need) { r.bigBasket = true; r.bigNeed = need; r.bigWin = win; return; }
        }
      }
      if ((r.cause === 'Awaiting pickup' || r.cause === 'Ride') && r.tripId && r.pickedUp != null && r.packed != null && r.completed != null) {
        const sib = (trips.get(String(r.tripId)) || []).filter((x) => x !== r && x.packed > r.packed && r.pickedUp >= x.packed && r.pickedUp - x.packed <= 3 * M);
        const lost = r.pickedUp - (r.packed + buf * M);
        if (sib.length && lost > 0 && r.completed - lost <= r.deadline) r.heldFor = sib.sort((a, b) => b.packed - a.packed)[0].orderNumber;
      }
    });
  }
  // v1.26: the picker pages count "FP late" by the ETA Late Analysis owner (late orders the FP owns: not coffee / pharmacy,
  // not large basket). Held for another order is the FP's but not the fault of that order's own picker: it counts for the
  // FP (team totals) and not against the picker (per-picker columns, ranking).
  function pkOwnerSync(A) {
    if (!A.pk || typeof ownerOf !== 'function') return;
    const P = A.pk, HELD = 'Held for another order';
    P.rows.forEach((r) => {
      r.storeLate = null;
      if (!r.late || ownerOf(r) !== OWN_STORE) return;
      r.storeLate = r.heldFor ? HELD : (r.waitMin || 0) >= (r.handleMin || 0) ? 'Waited for a picker' : 'Slow picking';
    });
    const split = (g, withHeld) => { const L = g.filter((r) => r.storeLate && (withHeld || r.storeLate !== HELD)); return { storeLate: L.length, queueLate: L.filter((r) => r.storeLate === 'Waited for a picker').length, slowLate: L.filter((r) => r.storeLate === 'Slow picking').length, heldLate: L.filter((r) => r.storeLate === HELD).length }; };
    P.hours.forEach((x) => { const a = P.dayStart + x.h * 3600000; Object.assign(x, split(P.rows.filter((r) => r.packed >= a && r.packed < a + 3600000), true)); });
    P.list.forEach((p) => { Object.assign(p, split(p.rows, false)); p.storeLatePct = rate(p.storeLate, p.orders); });
    Object.assign(P.team, split(P.rows, true));
  }
  function lateCatOf(r, A) {
    const rs = lateReason(r);
    // coffee / pharmacy comes first, as in the owner split (ETA Late Analysis), so both pages agree
    const cp = rs === 'Coffee (barista)' || rs === 'Pharmacy' || (typeof ownerOf === 'function' && typeof OWN_CP !== 'undefined' && ownerOf(r) === OWN_CP);
    if (!cp && r.bigBasket) return 'Large basket';
    if (!cp && r.heldFor) return 'Held for another order';
    if (rs === 'Waited for a picker') return 'Picker shortage';
    if (rs === 'Slow picking') return 'Slow picking';
    if (rs === 'Coffee (barista)') return 'Coffee';
    if (rs === 'Pharmacy') return 'Pharmacy';
    if (rs === 'Awaiting pickup') {
      const cov = (A && A.da && A.da.coverage) || [], c = cov[r.packed != null ? new Date(r.packed).getHours() : r.slot];
      return c && c.recAvail != null && c.recAvail >= 1 ? 'Free DAs not assigned' : 'DA shortage';
    }
    if (rs === 'Ride') {
      if (r.dropsBefore > 0) return 'Multi-order trip';
      const a = HANDOFF.areas[r.subArea], base = a && a.n >= CFG.HANDOFF_MIN_ORDERS ? a.med : HANDOFF.overall;
      const e = r.legMin != null && base != null ? r.legMin - base : null;
      return e != null && e >= CFG.ROOT_RIDE_SLOW_MIN ? 'Slow DA' : 'Far drop / short ETA';
    }
    return 'Not recorded';
  }
  const whyLate = (r) => (r.late ? r.rcCat || 'Not recorded' : '');
  const ROAD_CATS = ['Slow DA', 'Multi-order trip', 'Far drop / short ETA'];
  function countBy(rows, fn) {
    const m = new Map();
    rows.forEach((r) => { const k = fn(r); if (k == null) return; m.set(k, (m.get(k) || 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }
  const shareTxt = (n, d) => (d ? Math.round((100 * n) / d) + '%' : '–');
  const slotList = (pairs, n) => pairs.slice(0, n || 3).map(([h]) => shortHour(h)).join(', ');
  function overlapH(a, b, from, to) { const x = Math.max(a, from), y = Math.min(b, to); return y > x ? (y - x) / 3600000 : 0; }

  // PPH / DPH: for each clock hour, only the people who did at least `min` that hour count; rate = their work ÷ their number.
  // A day's (or a shift's) rate is the simple average of the hours that have one; hours where nobody reached `min` are left out.
  // ops = all the hour's work ÷ everyone active that hour (the hour's PPH / DPH (Ops)). minFor(h): an hour's own minimum (unused since 1.26).
  function hourlyRates(items, keyOf, timeOf, min, dayStart, minFor) {
    const out = [];
    for (let h = 0; h < 24; h++) {
      const a = dayStart + h * 3600000, b = a + 3600000;
      const by = new Map();
      items.forEach((r) => { const t = timeOf(r); if (t == null || t < a || t >= b) return; const k = keyOf(r); if (k == null) return; by.set(k, (by.get(k) || 0) + 1); });
      const m = (minFor && minFor(h)) || min;
      const counted = Array.from(by.values()).filter((n) => n >= m);
      const work = counted.reduce((s, n) => s + n, 0), all = Array.from(by.values()).reduce((s, n) => s + n, 0);
      out.push({ h, people: counted.length, work, all, active: by.size, rate: counted.length ? work / counted.length : null, ops: by.size ? all / by.size : null });
    }
    return out;
  }
  // ONE RULE for every PPH / DPH number (v1.26): an order belongs to the clock hour its work STARTED: the picker started
  // picking it (recorded start, else estimated; packed time when neither is known), the DA picked it up. PPH, DPH,
  // PPH (Ops), DPH (Ops), per-person rates and busy hours (Capacity) all use it. ("On the ground" is presence, not this rule.)
  const pkStartOf = (r) => (r.start != null ? r.start : r.packed);
  const daStartOf = (r) => r.pickedUp;
  const pkWorkRows = (A) => (A.pk ? A.pk.rows.filter((r) => !r.wasSub && pkStartOf(r) != null && r.pickerId != null) : []);
  const daWorkRows = (A) => A.rows.filter((r) => !r.wasSub && r.daId != null && r.pickedUp != null && r.status !== 'cancelled');
  // Active hours (Tableau's "Picker Hours" / "DA Hours"): one per person per clock hour of the day in which they started 1+ order.
  function activeHours(rows, keyOf, timeOf, from, to) {
    const seen = new Set();
    rows.forEach((r) => { const t = timeOf(r), k = keyOf(r); if (t == null || k == null || t < from || t >= to) return; seen.add(k + '|' + Math.floor((t - from) / 3600000)); });
    return seen.size;
  }
  // Orders for the Ops KPIs: completed and not received (Tableau's "Completed and Not Received Orders"), real orders only.
  const opsOrders = (A) => A.rows.filter((r) => !r.wasSub && (r.delivered || r.status === 'not-received')).length;
  // One person's busy hours: clock hours in which they started at least `min` picks / picked up `min` orders. Hours not over yet are left out.
  function busyHourStats(rows, timeOf, min) {
    const c = new Map(), nowT = Date.now();
    rows.forEach((r) => { const t = timeOf(r); if (t == null) return; const k = Math.floor(t / 3600000); c.set(k, (c.get(k) || 0) + 1); });
    let bh = 0, bw = 0;
    c.forEach((n, k) => { if ((k + 1) * 3600000 > nowT || n < min) return; bh++; bw += n; });
    return { bh, bw };
  }
  const daRowsOf = (x) => (x.trips || []).reduce((a, t) => a.concat(t.rows), []).filter((r) => r.delivered && !r.wasSub);
  const pkBusy = (p) => busyHourStats(p.rows || [], pkStartOf, CFG.PPH_MIN_PICKS || 1);
  const daBusy = (x) => busyHourStats(daRowsOf(x), daStartOf, CFG.DPH_MIN_DELIVERIES || 1);
  // Each person's own speed (Capacity page): busy-hour picks / deliveries over busy hours, the loaded day plus the last
  // CAP_RATE_DAYS saved days. Matched by HR ID, else account ID, else name.
  function ownRateBook(A, kind) {
    const book = [];
    const same = (e, x) => (e.hr && x.hr ? String(e.hr) === String(x.hr) : e.id && x.id ? String(e.id) === String(x.id) : !!(e.name && x.name) && e.name.toLowerCase() === String(x.name).toLowerCase());
    const find = (x) => book.find((e) => same(e, x));
    const add = (x, b, isToday) => {
      let e = find(x);
      if (!e) { e = { hr: x.hr || null, id: x.id || null, name: x.name || '', bh: 0, bw: 0, days: 0, todayH: 0 }; book.push(e); }
      if (!e.hr && x.hr) e.hr = x.hr;
      e.bh += b.bh; e.bw += b.bw;
      if (isToday) e.todayH = b.bh; else if (b.bh) e.days++;
    };
    const dk = UI.meta && UI.meta.date;
    const from = Date.now() - (CFG.CAP_RATE_DAYS || 0) * 86400000;
    Object.values(UI.history || loadHistory()).forEach((d) => {
      const ds = dayStartOf(d.date);
      if (d.date === dk || !ds || ds < from) return;
      const list = kind === 'pk' ? d.pickers || (d.pk && d.pk.pickers) : d.das;
      (list || []).forEach((r) => { if (r.bh) add(r, { bh: r.bh, bw: r.bw || 0 }, false); });
    });
    if (A && kind === 'pk' && A.pk) A.pk.list.forEach((p) => add(p, pkBusy(p), true));
    if (A && kind === 'da' && A.da) A.da.list.forEach((x) => add(x, daBusy(x), true));
    return (x) => {
      const e = find(x);
      if (e && e.bh) return { rate: e.bw / e.bh, hours: e.bh, todayH: e.todayH, days: e.days, own: true };
      return { rate: kind === 'pk' ? CFG.CAP_NEW_PICKER_PPH : CFG.CAP_NEW_DA_DPH, hours: 0, todayH: 0, days: 0, own: false };
    };
  }
  // Who was on the ground each clock hour (v1.17), not only who picked or delivered in it: a quiet night hour with no picks
  // still had its pickers there. Per person, the first source that applies:
  //   pickers: their shift on Picker shifts, else first pick → last pack that day;
  //   DAs: the availability recording (online: free, on a trip or locked) for hours it covers, else their shift on DA shifts,
  //        else first → last trip.
  // Someone counts in an hour they were there for ON_GROUND_MIN (15) minutes or more. DCM's own count of active DAs, when
  // recorded for that hour, is used when it is higher (DAs logged in that the brain couldn't place).
  function onGround(A) {
    if (A && A._onGround) return A._onGround;
    const dk = (A && A.dk) || (UI.meta && UI.meta.date), ds = (A && A.pk && A.pk.dayStart) || dayStartOf(dk);
    const NEED = (CFG.ON_GROUND_MIN || 15) * MIN;
    const H = Array.from({ length: 24 }, (_, h) => ({ h, pk: [], da: [], pkSrc: {}, daSrc: {}, dcmDAs: null }));
    const ov = (wins, a, b) => wins.reduce((t, w) => t + Math.max(0, Math.min(b, w[1]) - Math.max(a, w[0])), 0);
    const put = (h, key, person, src) => { H[h][key].push(person); H[h][key + 'Src'][src] = (H[h][key + 'Src'][src] || 0) + 1; };
    const span = (a, b) => (a != null && b != null ? [[a, Math.max(b, a + NEED)]] : []);
    const rosterWins = (RS, k) => (RS.hasShift(k) ? shiftWindows(k, dk, RS).filter((w) => !w.off).map((w) => [w.a, w.b]) : null);
    // pickers
    const seen = new Set();
    const pkPerson = (p, wins, src) => { for (let h = 0; h < 24; h++) { const a = ds + h * 3600000; if (ov(wins, a, a + 3600000) >= NEED) put(h, 'pk', p, src); } };
    ((A && A.pk && A.pk.list) || []).forEach((p) => {
      const k = rosterKey({ hr: p.hr, id: p.id }); seen.add(k);
      const W = rosterWins(ROSTER, k);
      if (W) pkPerson(p, W, 'shift'); else pkPerson(p, span(p.first, p.last), 'first to last pick');
    });
    const R = ROSTER.load();
    Object.keys(R.pickers).forEach((k) => { if (seen.has(k) || R.pickers[k].excluded) return; const W = rosterWins(ROSTER, k); if (W && W.length) pkPerson(R.pickers[k], W, 'shift'); });
    // DAs
    const av = A && A.da && A.da.avail;
    const recCovers = (a, b) => !!(av && av.segs.some(([x, y]) => Math.min(b, y) - Math.max(a, x) >= NEED));
    const seenDa = new Set();
    ((A && A.da && A.da.list) || []).forEach((x) => {
      const k = rosterKey({ hr: x.hr, id: x.id }); seenDa.add(k);
      const rec = av && av.das[x.id] ? av.das[x.id].intervals.filter((i) => i[2] !== 'U').map((i) => [i[0], i[1]]) : [];
      const W = rosterWins(DAROSTER, k);
      for (let h = 0; h < 24; h++) {
        const a = ds + h * 3600000, b = a + 3600000;
        if (recCovers(a, b)) { if (ov(rec, a, b) >= NEED) put(h, 'da', x, 'recorded online'); }
        else if (W) { if (ov(W, a, b) >= NEED) put(h, 'da', x, 'shift'); }
        else if (ov(span(x.first, x.last), a, b) >= NEED) put(h, 'da', x, 'first to last trip');
      }
    });
    const RD = DAROSTER.load();
    Object.keys(RD.pickers).forEach((k) => {
      if (seenDa.has(k) || RD.pickers[k].excluded) return;
      const W = rosterWins(DAROSTER, k); if (!W || !W.length) return;
      for (let h = 0; h < 24; h++) { const a = ds + h * 3600000, b = a + 3600000; if (!recCovers(a, b) && ov(W, a, b) >= NEED) put(h, 'da', RD.pickers[k], 'shift'); }
    });
    // anyone who picked or delivered in an hour was there, whatever the windows above say
    const addActive = (rows, idOf, timeOf, key, mk) => {
      for (let h = 0; h < 24; h++) {
        const a = ds + h * 3600000, b = a + 3600000, have = new Set(H[h][key].map((x) => String(x.id)));
        const ids = new Map();
        rows.forEach((r) => { const t = timeOf(r), id = idOf(r); if (t != null && t >= a && t < b && id != null && !have.has(String(id))) ids.set(String(id), r); });
        ids.forEach((r, id) => put(h, key, mk(id, r), key === 'pk' ? 'picked that hour' : 'delivered that hour'));
      }
    };
    addActive((A && A.pk && A.pk.rows) || [], (r) => r.pickerId, (r) => r.packed, 'pk', (id, r) => (A.pk.list.find((p) => String(p.id) === id) || { id, hr: r.pickerHr, name: r.pickerName }));
    addActive(((A && A.rows) || []).filter((r) => !r.wasSub && r.delivered), (r) => r.daId, (r) => r.pickedUp, 'da', (id, r) => (((A.da && A.da.list) || []).find((x) => String(x.id) === id) || { id, hr: r.daHr, name: r.daName }));
    addActive(((A && A.rows) || []).filter((r) => !r.wasSub && r.delivered), (r) => r.daId, (r) => r.completed, 'da', (id, r) => (((A.da && A.da.list) || []).find((x) => String(x.id) === id) || { id, hr: r.daHr, name: r.daName }));
    // DCM's count of active DAs, readings taken during that hour
    const fp = (UI.meta && UI.meta.fps && UI.meta.fps[0]) || fpIdFromCapture();
    const rec = fp && dk ? DCM.load(fp, dk) : null;
    if (rec && Array.isArray(rec.ev)) H.forEach((x) => { const v = rec.ev.filter((e) => +e[1] === x.h && new Date(e[0]).getHours() === x.h && e[5] != null).map((e) => +e[5]); if (v.length) x.dcmDAs = median(v); });
    H.forEach((x) => { x.pkN = x.pk.length; x.daN = Math.max(x.da.length, x.dcmDAs != null ? Math.round(x.dcmDAs) : 0); });
    if (A) A._onGround = H;
    return H;
  }
  const srcTxt = (o) => Object.keys(o).map((k) => k + ' ' + o[k]).join(', ');
  // What the team could handle each clock hour: the pickers and DAs on the ground (onGround), each at their own speed
  // (ownRateBook). DAs DCM counted beyond the ones the brain could place count at the others' average speed.
  // Used by Capacity (day table) and Root causes, so both show the same numbers.
  function teamCanDo(A, pkRate, daRate) {
    pkRate = pkRate || ownRateBook(A, 'pk'); daRate = daRate || ownRateBook(A, 'da');
    const G = onGround(A);
    return {
      pk: G.map((x) => ({ n: x.pkN, cap: x.pk.reduce((t, p) => t + pkRate(p).rate, 0), src: srcTxt(x.pkSrc) })),
      da: G.map((x) => {
        const cap = x.da.reduce((t, d) => t + daRate(d).rate, 0);
        const extra = x.daN - x.da.length;
        return { n: x.daN, cap: cap + (extra > 0 ? extra * (x.da.length ? cap / x.da.length : CFG.CAP_NEW_DA_DPH) : 0), src: srcTxt(x.daSrc) + (extra > 0 ? (x.da.length ? ', ' : '') + extra + ' more counted by DCM' : ''), dcm: x.dcmDAs };
      }),
    };
  }
  const avgOfHours = (hours, keep) => avg(hours.filter((x) => x.rate != null && (!keep || keep(x.h))).map((x) => x.rate));

  // Forced KPIs go by the day the order was PLACED, like the official scorecard: an order placed tonight for tomorrow's
  // first slots counts today, one placed yesterday for today's slots counted yesterday. A.spill = this day's orders from
  // the next day's list (loaded with the day). Every other page stays on the slot's day.
  function placedPool(A) {
    const ds = A.dk ? dayStartOf(A.dk) : (A.pk && A.pk.dayStart) || dayStartOf(UI.meta && UI.meta.date);
    const d1 = ds + 24 * 3600000;
    const spill = (A.spill && A.spill.rows) || [];
    const rows = A.rows.filter((r) => !r.subOrder && r.placed != null && r.placed >= ds && r.placed < d1).concat(spill);
    const del = rows.filter((r) => r.delivered);
    const nowDel = del.filter((r) => !r.scheduled), forcedDel = del.filter((r) => r.scheduled && r.forced);
    const both = nowDel.concat(forcedDel), judged = both.filter((r) => r.lateAny != null);
    const prev = A.rows.filter((r) => !r.subOrder && r.scheduled && r.forced && r.placed != null && r.placed < ds);
    return {
      ds, rows, del, nowDel, forcedDel, judged, lateF: judged.filter((r) => r.lateAny),
      p90f: pct(both.map((r) => r.deliveryMin), 0.9), forcedPct: rate(forcedDel.length, del.length), etaF: rate(judged.filter((r) => r.lateAny).length, judged.length),
      state: A.spill ? A.spill.state : 'none', spillN: spill.length, spillRows: spill, spillForced: spill.filter((r) => r.delivered && r.scheduled && r.forced).length,
      prevForced: prev.length, forcedAll: rows.filter((r) => r.scheduled && r.forced).length,
    };
  }
  // Auto-assign: the system's DA kept, or re-assigned by hand to that same DA, counts as auto (as the official scorecard).
  const ASSIGN_GROUPS = [['auto', 'Auto-assigned'], ['same', 'Reassigned (same DA)'], ['manual', 'Manually assigned (different DA)']];
  const assignGroup = (r) => (r.assignType === 'auto' ? 'auto' : r.assignType !== 'manual' ? null : r.assign && r.assign.cat === 'Re-assigned, same DA' ? 'same' : 'manual');
  const autoCount = (rows) => { let a = 0, n = 0; rows.forEach((r) => { const g = assignGroup(r); if (!g) return; n++; if (g !== 'manual') a++; }); return { a, n, m: n - a }; };

  function scoreDay(A) {
    const main = A.rows.filter((r) => !r.subOrder);
    const del = main.filter((r) => r.delivered);
    const nowDel = del.filter((r) => !r.scheduled);
    const PP = placedPool(A);
    const forcedDel = PP.forcedDel;
    const etaLate = del.filter((r) => r.late);   // ETA late: NOW orders only (a scheduled order's late is null), as the official scorecard
    if (A.da) tripContext(A);
    markLateChecks(A);
    pkOwnerSync(A);
    A.rows.forEach((r) => { r.rcCat = r.late ? lateCatOf(r, A) : null; });
    const judged = del.filter((r) => r.late != null);
    const ds0 = (A.pk && A.pk.dayStart) || dayStartOf(UI.meta && UI.meta.date);
    A._onGround = null;
    const G0 = onGround(A);
    const pkW = pkWorkRows(A), daW = daWorkRows(A);
    const pphH = hourlyRates(pkW, (r) => String(r.pickerId), pkStartOf, CFG.PPH_MIN_PICKS || 1, ds0);
    const dphH = hourlyRates(daW, (r) => String(r.daId), daStartOf, CFG.DPH_MIN_DELIVERIES || 1, ds0);
    const opsN = opsOrders(A);
    const pkAH = activeHours(pkW, (r) => String(r.pickerId), pkStartOf, ds0, ds0 + 86400000);
    const daAH = activeHours(daW, (r) => String(r.daId), daStartOf, ds0, ds0 + 86400000);
    const pkList = A.pk ? A.pk.list : [];
    const pkFull = pkList.filter((p) => !p.shortSpan);
    const daList = A.da ? A.da.list.filter((x) => x.deliveries) : [];
    const daFull = daList.filter((x) => !x.shortSpan);
    const AC = autoCount(main);
    const autoN = AC.a, manualN = AC.m;
    const v = {
      p90f: PP.p90f,
      p90n: pct(nowDel.map((r) => r.deliveryMin), 0.9),
      eta: rate(etaLate.length, judged.length),
      ppho: pkAH ? opsN / pkAH : null,
      dpho: daAH ? opsN / daAH : null,
      pph: avgOfHours(pphH),
      dph: avgOfHours(dphH),
      auto: rate(autoN, AC.n),
    };
    const extra = {
      delivered: judged.length, deliveredAll: del.length, nowDelivered: nowDel.length, etaLate: etaLate.length, forced: forcedDel.length, autoN, manualN,
      sameN: main.filter((r) => assignGroup(r) === 'same').length, forcedPct: PP.forcedPct, etaF: PP.etaF, lateF: PP.lateF.length, judgedF: PP.judged.length, poolNow: PP.nowDel.length,
      pphHours: pphH.filter((x) => x.rate != null).length, dphHours: dphH.filter((x) => x.rate != null).length,
      opsOrders: opsN, pkActiveH: pkAH, daActiveH: daAH,
      pickers: pkList.length, pickersFull: pkFull.length, das: daList.length, dasFull: daFull.length,
      latePctAll: A.day.latePct,
    };

    // Hour by hour. P90 / ETA / auto by the order's timeslot; PPH / DPH by the clock hour the work happened.
    const ds = (A.pk && A.pk.dayStart) || dayStartOf(UI.meta && UI.meta.date);
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const g = main.filter((r) => r.slot === h);
      const gDel = g.filter((r) => r.delivered);
      const gNow = gDel.filter((r) => !r.scheduled), gForced = gDel.filter((r) => r.scheduled && !r.plannedAhead);
      const a = ds + h * 3600000, b = a + 3600000;
      const packedH = A.pk ? A.pk.rows.filter((r) => r.packed >= a && r.packed < b).length : 0;
      const pickerH = pkList.reduce((s, p) => s + overlapH(p.first, p.last, a, b), 0);
      const delivH = daList.reduce((s, x) => s + x.trips.reduce((s2, tr) => s2 + tr.rows.filter((r) => r.completed >= a && r.completed < b).length, 0), 0);
      const daH = daList.reduce((s, x) => s + (x.first != null ? overlapH(x.first, x.last, a, b) : 0), 0);
      const gac = autoCount(g), au = gac.a, ma = gac.m;
      const ph = A.pk && A.pk.hours[h];
      if (!g.length && !packedH && !delivH && !dphH[h].all && !pphH[h].all) continue;
      hours.push({
        h, label: slotLabel(h), orders: g.length, nowDel: gNow.length,
        p90f: pct(gNow.concat(gForced).map((r) => r.deliveryMin), 0.9), p90n: pct(gNow.map((r) => r.deliveryMin), 0.9),
        eta: rate(gDel.filter((r) => r.late).length, gDel.filter((r) => r.late != null).length), etaLate: gDel.filter((r) => r.late).length,
        packed: packedH, pickersOn: pickerH, pph: pphH[h].rate, pickersCounted: pphH[h].people, pkGround: G0[h].pkN, ppho: pphH[h].ops, pkActive: pphH[h].active, startedH: pphH[h].all,
        delivered: delivH, dasOn: daH, dph: dphH[h].rate, dasCounted: dphH[h].people, daGround: G0[h].daN, dpho: dphH[h].ops, daActive: dphH[h].active, pickedUpH: dphH[h].all,
        auto: rate(au, au + ma), manual: ma, queue: ph ? ph.avgQueue : null,
        reasons: countBy(gDel.filter((r) => r.late), whyLate),
      });
    }

    const opsOf = (H, sh) => { const hs = H.filter((x) => inShift(x.h, sh)), act = hs.reduce((t, x) => t + x.active, 0); return act ? hs.reduce((t, x) => t + x.all, 0) / act : null; };
    const shiftRates = CFG.SHIFTS.map((sh) => ({ name: sh.name, pph: avgOfHours(pphH, (h) => inShift(h, sh)), dph: avgOfHours(dphH, (h) => inShift(h, sh)), ppho: opsOf(pphH, sh), dpho: opsOf(dphH, sh),
      pkActiveH: pphH.filter((x) => inShift(x.h, sh)).reduce((t, x) => t + x.active, 0), daActiveH: dphH.filter((x) => inShift(x.h, sh)).reduce((t, x) => t + x.active, 0) }));
    // one PPH / DPH everywhere: the people pages, Capacity and the saved history read these
    if (A.pk) { A.pk.team.perPickerHour = v.pph; A.pk.hours.forEach((x) => { const q = pphH[x.h]; x.perPicker = q ? q.rate : null; x.pickersCounted = q ? q.people : 0; x.perPickerOps = q ? q.ops : null; x.pickersActive = q ? q.active : 0; }); }
    if (A.da) { A.da.team.dph = v.dph; A.da.team.dpho = v.dpho; }
    if (A.pk) A.pk.team.ppho = v.ppho;
    extra.pphTeam = v.pph; extra.dphTeam = v.dph;   // kept for saved history
    const S = { v, extra, hours, main, del, judged, nowDel, forcedDel, etaLate, pool: PP, pkFull, daFull, pphH, dphH, shiftRates };
    A.day.p90Proxy = v.p90f;   // the day's P90 incl. forced is the placed-day one everywhere
    S.dx = {
      p90f: dxP90(A, S, true), p90n: dxP90(A, S, false), eta: dxEta(A, S), ppho: dxPph(A, S, 'ppho'), dpho: dxDph(A, S, 'dpho'), pph: dxPph(A, S, 'pph'), dph: dxDph(A, S, 'dph'), auto: dxAuto(A, S),
    };
    return S;
  }

  const ACTION_BY_REASON = {
    'Picker shortage': (ctx) => 'Add picker cover in the ' + ctx.slots + ' slots (check no-shows, breaks and shift start times).',
    'Slow picking': (ctx) => 'Coach ' + (ctx.slowPickers || 'the slowest pickers') + ' on long picks; check out-of-stock searching and SKU locations.',
    'Held for another order': (ctx) => 'DAs waited for the last order of their trip in the ' + ctx.slots + ' slots: pack orders of one trip together and check picker cover.',
    'Large basket': () => 'Some large baskets had an ETA shorter than they need to pick and ride: send the order numbers to the ETA / product team.',
    'DA shortage': (ctx) => 'Check DA cover in the ' + ctx.slots + ' slots (breaks in peak, DAs offline); lower DCM capacity there if DAs stay short.',
    'Free DAs not assigned': (ctx) => 'DAs were free while orders waited in the ' + ctx.slots + ' slots: check auto-assign and manual holds with the coordinator.',
    'Slow DA': (ctx) => 'Check which DAs rode slowly (DAs → Performance, ride vs usual)' + (ctx.areas ? ' to ' + ctx.areas : '') + ' and talk to them.',
    'Multi-order trip': (ctx) => 'Fewer multi-drop trips in the ' + ctx.slots + ' slots, and only pair drops going the same way.',
    'Far drop / short ETA': (ctx) => 'Rides were normal but the ETA was too short' + (ctx.areas ? ' to ' + ctx.areas : '') + ': raise those sub-areas with the ETA / zones team.',
    'Coffee': () => 'Raise barista cover or speed with the coffee team for those hours (see Coffee & pharmacy).',
    'Pharmacy': () => 'Escalate pharmacy delays to the pharmacy partner; they are not the FP\'s (see Coffee & pharmacy).',
    'Not recorded': () => 'Open a few of these orders in the Control Room to see what happened, and keep a Control Room tab open so times get recorded.',
  };
  function reasonCtx(A, rows) {
    const slots = countBy(rows, (r) => r.slot);
    const slow = countBy(rows.filter((r) => whyLate(r) === 'Slow picking' && r.pickerName), (r) => r.pickerName).slice(0, 2).map(([n]) => n.split(' ')[0]);
    const areas = countBy(rows.filter((r) => ROAD_CATS.includes(whyLate(r))), (r) => r.subArea).slice(0, 2).map(([n]) => n);
    return { slots: slotList(slots), slotPairs: slots, slowPickers: slow.join(' and '), areas: areas.join(' and ') };
  }
  function reasonLines(rows) {
    const reasons = countBy(rows, whyLate);
    return reasons.map(([k, n]) => k + ' ' + shareTxt(n, rows.length) + ' (' + n + ')').join(' · ');
  }

  function dxEta(A, S) {
    const L = S.etaLate, N = S.judged;
    if (!N.length) return { drivers: ['No delivered NOW orders on this date.'], actions: [], dm: '' };
    const reasons = countBy(L, whyLate);
    const ctx = reasonCtx(A, L);
    const drivers = [L.length + ' of ' + N.length + ' delivered NOW orders arrived after their ETA.'];
    if (S.extra.etaF != null) drivers.push('With forced orders too: ' + fmt(S.extra.etaF, 1) + '% (' + S.extra.lateF + ' of ' + S.extra.judgedF + ', by the day placed). Details on ETA Late Analysis.');
    if (L.length) {
      drivers.push('Why: ' + reasonLines(L) + '.');
      drivers.push('Worst slots: ' + ctx.slotPairs.slice(0, 3).map(([h, n]) => { const t = N.filter((r) => r.slot === h).length; return shortHour(h) + ' (' + n + ' late of ' + t + ')'; }).join(', ') + '.');
      const areas = countBy(L, (r) => r.subArea).slice(0, 3);
      if (areas.length) drivers.push('Most late by sub-area: ' + areas.map(([k, n]) => k + ' ' + n).join(', ') + '.');
      const cof = L.filter((r) => r.coffee).length, cofAll = N.filter((r) => r.coffee).length;
      if (hasCoffee() && cof && rate(cof, L.length) > rate(cofAll, N.length) * 1.4) drivers.push('Coffee orders are over-represented: ' + shareTxt(cof, L.length) + ' of late vs ' + shareTxt(cofAll, N.length) + ' of delivered NOW orders.');
      const big = L.filter((r) => r.skus >= CFG.LARGE_BASKET_SKUS).length, bigAll = N.filter((r) => r.skus >= CFG.LARGE_BASKET_SKUS).length;
      if (big >= 3 && rate(big, L.length) > rate(bigAll, N.length) * 1.5) drivers.push('Large baskets (' + CFG.LARGE_BASKET_SKUS + '+ SKUs) are over-represented: ' + shareTxt(big, L.length) + ' of late vs ' + shareTxt(bigAll, N.length) + ' of orders.');
    }
    const top = reasons[0];
    const actions = reasons.slice(0, 2).map(([k]) => ACTION_BY_REASON[k](ctx));
    const v = S.v.eta;
    const dm = top ? 'ETA late ' + fmt(v, 1) + '% vs ' + CFG.LATE_TARGET_PCT + '% target. ' + shareTxt(top[1], L.length) + ' of late orders ' + REASON_VERB[top[0]] + ', mostly in the ' + ctx.slots + ' slots. Action: ' + shortAction(top[0], ctx) : 'ETA late ' + fmt(v, 1) + '%, on target.';
    return { drivers, actions, dm, reasons, rows: L };
  }
  function shortAction(reason, ctx) {
    return {
      'Picker shortage': 'more picker cover in those hours.',
      'Slow picking': 'coaching ' + (ctx.slowPickers || 'the slowest pickers') + '.',
      'Held for another order': 'packing orders of one trip together.',
      'Large basket': 'raising the large-basket ETA with the product team.',
      'DA shortage': 'fixing DA cover and breaks in those hours.',
      'Free DAs not assigned': 'getting free DAs sent: check auto-assign and holds.',
      'Slow DA': 'talking to the slow riders' + (ctx.areas ? ' to ' + ctx.areas : '') + '.',
      'Multi-order trip': 'fewer multi-drop trips in those hours.',
      'Far drop / short ETA': 'raising the ETA' + (ctx.areas ? ' to ' + ctx.areas : '') + ' with the zones team.',
      'Coffee': 'raising barista cover with the coffee team.',
      'Pharmacy': 'escalating the pharmacy delays.',
      'Not recorded': 'checking those orders one by one.',
    }[reason] || 'checking those orders.';
  }

  function stageSplit(rows) {
    return {
      store: median(rows.map((r) => diffMin(r.packed, r.placed))),
      shelf: median(rows.map((r) => r.shelfMin)),
      road: median(rows.map((r) => r.legMin)),
      wait: median(rows.map((r) => r.waitMin)), pick: median(rows.map((r) => r.handleMin)),
    };
  }
  function dxP90(A, S, withForced) {
    const pool = withForced ? S.pool.nowDel.concat(S.pool.forcedDel) : S.nowDel;
    const p = withForced ? S.v.p90f : S.v.p90n;
    if (!pool.length || p == null) return { drivers: ['No delivered orders to measure.'], actions: [], dm: '' };
    const tail = pool.filter((r) => r.deliveryMin >= p);
    const drivers = [], actions = [];
    let dm = '';
    if (withForced) {
      const f = tail.filter((r) => r.scheduled);
      drivers.push('P90 incl. forced ' + fmt(p) + ' min vs P90 NOW ' + fmt(S.v.p90n) + ' min. The gap is what forced orders add.');
      const lc = (t) => (/^[A-Z]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
      const src = countBy(S.forcedDel, (r) => forcedSrcTxt(r.forcedSrc)).map(([k, n]) => lc(k) + ' ' + n).join(', ');
      drivers.push(S.forcedDel.length + ' forced orders placed this day (' + fmtPct(S.extra.forcedPct) + ' of delivered; ' + src + '), median ' + fmt(median(S.forcedDel.map((r) => r.deliveryMin))) + ' min from placing to delivery. ' + f.length + ' of the slowest ' + tail.length + ' orders are forced.');
      if (S.pool.state === 'today') drivers.push('Orders placed today for tomorrow\'s slots join this number once they are delivered (load tomorrow, or this day again).');
      if (f.length && f.length >= tail.length * 0.4) {
        const from = countBy(f, (r) => r.placedHour).slice(0, 3).map(([h]) => hourLabel(h));
        const to = countBy(f, (r) => r.slot).slice(0, 3).map(([h]) => shortHour(h));
        drivers.push('Forced orders were mostly placed at ' + from.join(', ') + ' and pushed into the ' + to.join(', ') + ' slots.');
        actions.push('Find why the FP went busy or hit capacity at ' + from.join(', ') + ' (pickers, DAs or a full DCM slot). Each forced order counts its whole wait in this KPI.');
        dm = 'P90 incl. forced ' + fmt(p) + ' vs ' + CFG.P90_TARGET_MIN + '. ' + shareTxt(f.length, tail.length) + ' of the slowest orders were forced shifts placed around ' + from[0] + '. NOW-only P90 is ' + fmt(S.v.p90n) + '. Action: fix capacity at that hour.';
      }
    }
    const tailNow = tail.filter((r) => !r.scheduled), allNow = S.nowDel;
    if (tailNow.length) {
      const a = stageSplit(allNow), t = stageSplit(tailNow);
      const gaps = [['in the FP', (t.store || 0) - (a.store || 0)], ['awaiting pickup', (t.shelf || 0) - (a.shelf || 0)], ['on the ride', (t.road || 0) - (a.road || 0)]].sort((x, y) => y[1] - x[1]);
      drivers.push('Slowest NOW orders vs a typical one: FP ' + fmt(t.store, 0) + ' vs ' + fmt(a.store, 0) + ' min, awaiting pickup ' + fmt(t.shelf, 0) + ' vs ' + fmt(a.shelf, 0) + ', ride ' + fmt(t.road, 0) + ' vs ' + fmt(a.road, 0) + '. Biggest extra time: ' + gaps[0][0] + ' (+' + fmt(gaps[0][1], 0) + ' min).');
      if (t.wait != null && t.pick != null && gaps[0][0] === 'in the FP') drivers.push('Inside the FP they waited ' + fmt(t.wait, 0) + ' min for a picker and took ' + fmt(t.pick, 0) + ' min to pick (typical: ' + fmt(a.wait, 0) + ' and ' + fmt(a.pick, 0) + ').');
      const slots = countBy(tailNow, (r) => r.slot);
      drivers.push('Slowest orders by slot: ' + slots.slice(0, 4).map(([h, n]) => shortHour(h) + ' ' + n).join(', ') + '.');
      const areas = countBy(tailNow, (r) => r.subArea).slice(0, 3);
      if (areas.length) drivers.push('By sub-area: ' + areas.map(([k, n]) => k + ' ' + n).join(', ') + '.');
      const stageAction = { 'in the FP': 'Picker cover and picking speed in the ' + slotList(slots) + ' slots.', 'awaiting pickup': 'DA cover in the ' + slotList(slots) + ' slots; packed orders sat waiting.', 'on the ride': 'Far drops and multi-drop trips' + (areas.length ? ' (' + areas.map(([k]) => k).slice(0, 2).join(', ') + ')' : '') + '.' }[gaps[0][0]];
      actions.push(stageAction);
      if (!dm) dm = (withForced ? 'P90 incl. forced ' : 'P90 NOW ') + fmt(p) + ' vs ' + CFG.P90_TARGET_MIN + '. The slowest orders lost +' + fmt(gaps[0][1], 0) + ' min ' + gaps[0][0] + ', mostly in the ' + slotList(slots) + ' slots. Action: ' + (/^[A-Z]{2}/.test(stageAction) ? stageAction : stageAction.charAt(0).toLowerCase() + stageAction.slice(1));
    }
    return { drivers, actions, dm };
  }

  function dxPph(A, S, key) {
    const P = A.pk, D0 = kpiDef(key || 'pph'), L = D0.label, val = S.v[D0.key];
    if (!P || !P.list.length) return { drivers: ['No picks on this date.'], actions: [], dm: '' };
    const t = D0.target();
    const below = S.pkFull.filter((p) => p.perHour < t).sort((a, b) => a.perHour - b.perHour);
    const drivers = [below.length + ' of ' + S.pkFull.length + ' pickers were under ' + t + ' on their own PPH (Ops)' + (below.length ? ': ' + below.slice(0, 4).map((p) => p.name.split(' ')[0] + ' ' + fmt(p.perHour, 1)).join(', ') : '') + '.'];
    if (D0.key === 'ppho') drivers.push(S.extra.opsOrders + ' orders ÷ ' + S.extra.pkActiveH + ' picker active hours (a picker in a clock hour in which they started 1+ order).');
    // demand-limited or speed-limited? Look at picker-hours spent with an empty queue.
    const staffed = S.hours.filter((h) => h.pickersOn >= 0.5);
    const totalPH = staffed.reduce((s, h) => s + h.pickersOn, 0);
    const idlePH = staffed.filter((h) => (h.queue || 0) < 0.5).reduce((s, h) => s + h.pickersOn, 0);
    const idleShare = totalPH ? (100 * idlePH) / totalPH : 0;
    const quietHours = staffed.filter((h) => (h.queue || 0) < 0.5 && h.pph != null && h.pph < t && h.pickersOn >= 1.5).map((h) => h.h);
    drivers.push(fmt(idleShare, 0) + '% of picker-hours had no queue (under 0.5 orders waiting), so pickers were waiting for orders, not slow.' + (quietHours.length ? ' Quietest staffed hours: ' + quietHours.slice(0, 5).map(shortHour).join(', ') + '.' : ''));
    drivers.push('Median picking time ' + fmt(P.team.medHandle, 1) + ' min (' + fmt(P.team.secPerSku != null ? P.team.secPerSku : P.team.medPerSku != null ? P.team.medPerSku * 60 : null, 0) + ' sec per SKU); average basket ' + fmt(A.day.avgSkus, 1) + ' SKUs.' + (D0.key === 'pph' ? ' PPH is the average of ' + S.extra.pphHours + ' hours, counting pickers who started ' + CFG.PPH_MIN_PICKS + '+ picks in the hour.' : ''));
    const idleWait = P.list.reduce((s, p) => s + p.idleWhileWaiting, 0);
    if (idleWait) drivers.push(idleWait + ' idle gaps of ' + CFG.IDLE_GAP_MIN + '+ min started while orders were already waiting' + (P.list.filter((p) => p.idleWhileWaiting).length ? ' (' + P.list.filter((p) => p.idleWhileWaiting).sort((a, b) => b.idleWhileWaiting - a.idleWhileWaiting).slice(0, 3).map((p) => p.name.split(' ')[0] + ' ' + p.idleWhileWaiting).join(', ') + ')' : '') + '.');
    const actions = [];
    let dm;
    if (idleShare >= 50) {
      actions.push(L + ' is limited by demand: too many pickers rostered for ' + (quietHours.length ? quietHours.slice(0, 4).map(shortHour).join(', ') : 'the quiet hours') + '. Move them to restock or cycle count, or shift start times to the peaks.');
      dm = L + ' ' + fmt(val, 1) + ' vs ' + t + '. ' + fmt(idleShare, 0) + '% of picker-hours had no orders waiting, so it is overstaffing in quiet hours, not slow picking. Action: rebalance the roster.';
    } else {
      actions.push('Speed is the issue: coach ' + (below.slice(0, 2).map((p) => p.name.split(' ')[0]).join(' and ') || 'the slowest pickers') + ' and check idle gaps while orders were waiting.');
      dm = L + ' ' + fmt(val, 1) + ' vs ' + t + '. Orders were waiting most of the time, so this is picking speed: ' + (below.slice(0, 2).map((p) => p.name.split(' ')[0] + ' at ' + fmt(p.perHour, 1)).join(', ') || 'several pickers') + '. Action: coaching and idle-gap follow-up.';
    }
    if (idleWait) actions.push('Follow up the idle gaps that started while orders were waiting (Pickers → Performance).');
    return { drivers, actions, dm };
  }

  function dxDph(A, S, key) {
    const D = A.da, D0 = kpiDef(key || 'dph'), L = D0.label, val = S.v[D0.key];
    if (!D || !S.daFull.length) return { drivers: ['No DA deliveries on this date.'], actions: [], dm: '' };
    const t = D0.target();
    const below = S.daFull.filter((x) => x.dph < t).sort((a, b) => a.dph - b.dph);
    const drivers = [below.length + ' of ' + S.daFull.length + ' DAs were under ' + t + ' on their own DPH (Ops)' + (below.length ? ': ' + below.slice(0, 4).map((x) => (x.name || '').split(' ')[0] + ' ' + fmt(x.dph, 2)).join(', ') : '') + '.'];
    if (D0.key === 'dpho') drivers.push(S.extra.opsOrders + ' orders ÷ ' + S.extra.daActiveH + ' DA active hours (a DA in a clock hour in which they picked up 1+ order).');
    drivers.push('Orders per trip ' + fmt(D.team.perTrip, 2) + '; median ride ' + fmt(A.day.medLeg, 1) + ' min; median awaiting-pickup time ' + fmt(A.day.medShelf, 1) + ' min.');
    const staffed = S.hours.filter((h) => h.dasOn >= 0.5);
    const slack = staffed.filter((h) => h.dph != null && h.dph < t * 0.75 && h.dasOn >= 2).map((h) => h.h);
    if (slack.length) drivers.push('Hours with more DAs than orders to deliver: ' + slack.slice(0, 6).map(shortHour).join(', ') + '.');
    let waitShare = null;
    if (D.avail) {
      let a = 0, on = 0;
      Object.values(D.avail.das).forEach((x) => { if (!x.online) return; a += x.ms.A; on += x.ms.A + x.ms.T + x.ms.L; });
      waitShare = on ? (100 * a) / on : null;
      if (waitShare != null) drivers.push('Recorded: DAs spent ' + fmt(waitShare, 0) + '% of their online time available with no order.');
    }
    const gaps = S.daFull.reduce((s, x) => s + x.gapsLong, 0);
    if (gaps) drivers.push(gaps + ' gaps of ' + CFG.GAP_MIN + '+ min between trips.');
    const actions = [];
    let dm;
    const demandLimited = (waitShare != null && waitShare >= 35) || slack.length >= 3;
    if (demandLimited) {
      actions.push(L + ' is limited by demand: stagger DA shifts or release DAs early in ' + (slack.length ? slack.slice(0, 4).map(shortHour).join(', ') : 'quiet hours') + '.');
      dm = L + ' ' + fmt(val, 2) + ' vs ' + t + '. DAs were waiting for orders' + (slack.length ? ' in ' + slack.slice(0, 3).map(shortHour).join(', ') : '') + ', so it is too many DAs for the volume, not slow DAs. Action: stagger shifts.';
    } else if (D.team.perTrip != null && D.team.perTrip < 1.4) {
      actions.push('Low batching (' + fmt(D.team.perTrip, 2) + ' orders per trip): check max drop-off per tier in auto-assign settings and whether coordinators split trips.');
      dm = L + ' ' + fmt(val, 2) + ' vs ' + t + '. Only ' + fmt(D.team.perTrip, 2) + ' orders per trip, so DAs ride back after almost every drop. Action: more multi-drop trips.';
    } else {
      actions.push('Check the slowest DAs (' + below.slice(0, 2).map((x) => (x.name || '').split(' ')[0]).join(', ') + '): long legs, long gaps between trips.');
      dm = L + ' ' + fmt(val, 2) + ' vs ' + t + '. ' + below.length + ' DAs under target, with long gaps between trips. Action: follow up ' + below.slice(0, 2).map((x) => (x.name || '').split(' ')[0]).join(' and ') + '.';
    }
    return { drivers, actions, dm };
  }

  function dxAuto(A, S) {
    const D = A.da, x = S.extra;
    if (!(x.autoN + x.manualN)) return { drivers: ['No assignment data.'], actions: [], dm: '' };
    const drivers = [x.manualN + ' of ' + (x.autoN + x.manualN) + ' orders were given to a different DA by hand (or never auto-assigned). ' + (x.sameN ? x.sameN + ' re-assigned to the same DA count as auto.' : '')];
    const actions = [];
    let dm = 'Auto-assign ' + fmt(S.v.auto, 1) + '% vs ' + CFG.AUTO_ASSIGN_TARGET + '%: ' + x.manualN + ' orders manually assigned to a different DA.';
    if (D) {
      const c = (k) => (D.cats.find((z) => z.cat === k) || { orders: 0 }).orders;
      if (D.team.historyLoaded) drivers.push('Manually assigned: ' + c('Override (different DA)') + ' replaced the system\'s DA, ' + c('Manual only') + ' were never auto-assigned' + (c('Manual (no assignment in history)') ? ', ' + c('Manual (no assignment in history)') + ' unclear' : '') + '.');
      else drivers.push('Assignment history was not read, so every manual order counts as a different DA. Refresh to read it.');
      const slots = D.assignBySlot.filter((s) => s.manual > 0).sort((a, b) => b.manual - a.manual);
      if (slots.length) drivers.push('Most manual assigning in the ' + slots.slice(0, 3).map((s) => shortHour(s.h) + ' (' + s.manual + ')').join(', ') + ' slots.');
      const actors = D.actors.slice().sort((a, b) => (b.overrides + b.only) - (a.overrides + a.only));
      if (actors.length) drivers.push('By: ' + actors.slice(0, 3).map((a) => a.name + ' ' + (a.overrides + a.only) + (a.overrides ? ' (' + a.overrides + ' replaced the system\'s DA)' : '')).join(', ') + '.');
      if (c('Override (different DA)')) actions.push('Ask ' + (actors[0] ? actors[0].name : 'the coordinator') + ' why the system\'s DA was replaced on ' + c('Override (different DA)') + ' orders. If auto-assign picks badly, report the order numbers instead of overriding.');
      if (c('Manual only')) actions.push(c('Manual only') + ' orders were never auto-assigned (usually no free DA): check DA cover in those slots.');
      if (D.team.historyLoaded && c('Override (different DA)')) dm += ' ' + c('Override (different DA)') + ' replaced the system\'s DA' + (actors[0] ? ', mostly by ' + actors[0].name : '') + '. Action: review them with logistics.';
    }
    if (DCM.engine && DCM.engine.autoAssignEnabled === false) drivers.push('Auto-assign is switched OFF right now.');
    return { drivers, actions, dm };
  }

  /* ---------- KPI log: your root cause, note and action per missed KPI, per day ---------- */
  const LOG = {
    CAUSES: ['Picker shortage / no-shows', 'Picker speed / discipline', 'DA shortage / no-shows', 'DA breaks in peak', 'Peak clustering / demand spike', 'Forced shifts / FP busy', 'Capacity set wrong (DCM)', 'Large baskets', 'Far drops / traffic', 'Logistics / manual assigning', 'Coffee / pharmacy delays', 'Stock / out-of-stock searching', 'System / app issue', 'Weather', 'Other'],
    load() { try { return JSON.parse(localStorage.getItem(STORE_LOG) || '{}'); } catch (e) { return {}; } },
    save(all) { try { localStorage.setItem(STORE_LOG, JSON.stringify(all)); } catch (e) { } },
    day(dk) { return LOG.load()[dk] || null; },
    put(dk, fpName, kpi, entry) {
      const all = LOG.load();
      const d = all[dk] || (all[dk] = { fp: fpName, kpis: {} });
      d.kpis[kpi] = Object.assign({}, d.kpis[kpi], entry, { savedAt: Date.now() });
      LOG.save(all);
    },
    csv() {
      const all = LOG.load();
      const esc2 = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const rows = [['date', 'fp', 'kpi', 'value', 'target', 'status', 'root_cause', 'note', 'action', 'dm_line']];
      Object.keys(all).sort((a, b) => (dateKey(a) < dateKey(b) ? -1 : 1)).forEach((dk) => {
        const d = all[dk];
        Object.keys(d.kpis || {}).forEach((k) => { const e = d.kpis[k]; rows.push([dk, d.fp, (kpiDef(k) || { label: k }).label, e.value, e.target, e.status, e.cause, e.note, e.action, e.dm]); });
      });
      return '﻿' + rows.map((r) => r.map(esc2).join(',')).join('\n');
    },
  };

  /* ------------------------------------------------------------------
   * SHARED WITH THE DAY ANALYZERS: per-person daily records, rankings, coffee & pharmacy, accountability
   * ------------------------------------------------------------------ */
  const KPI_VIEWS = { _period: 'month' };
  /* ---------- per-DA daily record (saved with each day for the ranking) ---------- */
  function daDayRecords(A) {
    const D = A.da;
    const recs = D.list.filter((x) => x.deliveries).map((x) => {
      const rows = x.trips.reduce((a, t) => a.concat(t.rows), []);
      const now = rows.filter((r) => r.late != null);   // ETA late: NOW orders only (v1.16, as the official scorecard)
      const perKm = rows.filter((r) => r.distKm != null && r.distKm >= 0.5 && r.legMin != null).map((r) => r.legMin / r.distKm);
      return {
        id: x.id, name: x.name, hr: x.hr, tier: x.tier || '', deliveries: x.deliveries, trips: x.tripsN, spanH: +(x.spanH || 0).toFixed(3), rateH: +(x.rateH || x.spanH || 0).toFixed(3),
        nowDel: now.length, etaLate: now.filter((r) => r.late).length, roadLate: rows.filter((r) => r.cause === 'Ride' && r.cpVerdict !== 'Pharmacy').length, pharmaStops: rows.filter((r) => r.cpVerdict === 'Pharmacy').length,
        waited: rows.filter((r) => r.cause === 'Awaiting pickup').length, medLeg: x.medLeg != null ? +x.medLeg.toFixed(1) : null, minPerKm: perKm.length ? +median(perKm).toFixed(2) : null,
        gaps: x.gapsLong, lost: x.takenAway, gained: x.given, onlineH: x.onlineH != null ? +x.onlineH.toFixed(2) : null,
        longBreaks: x.av && x.av.online ? x.av.longBreaks : null, peakOffMin: x.av && x.av.online ? Math.round(x.av.peakUnavailMin) : null,
        // v1.10: speed, shift and availability
        rideIdx: x.rideIdx != null ? +x.rideIdx.toFixed(3) : null, rideExtra: x.rideExtra != null ? +x.rideExtra.toFixed(1) : null, rideN: x.rideN || 0,
        scheduled: !!x.shiftSet, dayOff: !!(x.plan && x.plan.off), idleWaitMin: x.idleWaitMin || 0, waitInShiftMin: x.waitInShiftMin || 0, notCounted: x.notCounted || 0, present: true,
      };
    });
    (D.absent || []).forEach((y) => recs.push({ id: y.p.id, name: y.p.name, hr: y.p.hr, tier: '', deliveries: 0, trips: 0, spanH: 0, nowDel: 0, etaLate: 0, roadLate: 0, pharmaStops: 0, waited: 0, medLeg: null, minPerKm: null, gaps: 0, lost: 0, gained: 0, onlineH: null, longBreaks: null, peakOffMin: null,
      rideIdx: null, rideExtra: null, rideN: 0, scheduled: true, dayOff: false, idleWaitMin: 0, waitInShiftMin: 0, notCounted: 0, present: false, absent: true }));
    return recs;
  }

  /* ---------- ranking across days, for bonuses ---------- */
  function periodRange(kind, refKey) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const k = (d) => d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
    const weekStart = (d) => { const x = new Date(d); const back = (x.getDay() - CFG.WEEK_START_DAY + 7) % 7; x.setDate(x.getDate() - back); return x; };
    if (kind === 'day') return { from: refKey, to: refKey, label: 'the loaded day' };
    if (kind === 'week') { const s = weekStart(today); const e = new Date(s); e.setDate(s.getDate() + 6); return { from: k(s), to: k(e), label: 'this week (from ' + s.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ')' }; }
    if (kind === 'lastweek') { const s = weekStart(today); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(s.getDate() + 6); return { from: k(s), to: k(e), label: 'last week (' + s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' – ' + e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ')' }; }
    if (kind === 'month') { const s = new Date(today.getFullYear(), today.getMonth(), 1); const e = new Date(today.getFullYear(), today.getMonth() + 1, 0); return { from: k(s), to: k(e), label: s.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }; }
    if (kind === 'lastmonth') { const s = new Date(today.getFullYear(), today.getMonth() - 1, 1); const e = new Date(today.getFullYear(), today.getMonth(), 0); return { from: k(s), to: k(e), label: s.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }; }
    return { from: null, to: null, label: 'all saved days' };
  }
  function daysInDA(H, from, to) { return Object.values(H).filter((d) => d.das && (!from || dateKey(d.date) >= from) && (!to || dateKey(d.date) <= to)); }
  // DA ranking: speed first (first-drop ride vs the usual ride to that sub-area), then attendance and availability,
  // then road lateness, DPH and volume. Weights in Settings.
  function rankDAs(H, from, to, minDel, minHours) {
    const agg = new Map();
    daysInDA(H, from, to).forEach((d) => d.das.forEach((x) => {
      const id = String(x.hr || x.name);
      const a = agg.get(id) || { name: x.name, hr: x.hr, id: x.id, tier: x.tier, days: 0, scheduledDays: 0, presentScheduled: 0, absentDays: 0, deliveries: 0, trips: 0, hours: 0, dphDel: 0, dphHours: 0, nowDel: 0, etaLate: 0, roadLate: 0, waited: 0, gaps: 0, lost: 0, gained: 0, perKm: [], legs: [], peakOff: 0, longBreaks: 0, recDays: 0, idxSum: 0, idxN: 0, extraSum: 0, idleM: 0, waitM: 0, notCounted: 0, daily: [] };
      if (x.scheduled) { a.scheduledDays++; if (x.present !== false && x.deliveries > 0) a.presentScheduled++; else a.absentDays++; }
      if (x.deliveries > 0) a.days++;
      a.deliveries += x.deliveries; a.trips += x.trips; a.hours += x.spanH || 0;
      const rh = x.rateH != null ? x.rateH : x.spanH || 0;   // shift hours when the shift was entered, else first to last delivery
      if (rh >= 1) { a.dphDel += x.deliveries; a.dphHours += rh; } // a day under 1 hour says little about speed
      a.nowDel += x.nowDel || 0; a.etaLate += x.etaLate || 0; a.roadLate += x.roadLate || 0; a.waited += x.waited || 0;
      a.gaps += x.gaps || 0; a.lost += x.lost || 0; a.gained += x.gained || 0; if (x.minPerKm != null) a.perKm.push(x.minPerKm); if (x.medLeg != null) a.legs.push(x.medLeg);
      if (x.peakOffMin != null) { a.peakOff += x.peakOffMin; a.longBreaks += x.longBreaks || 0; a.recDays++; }
      if (x.rideIdx != null && x.rideN) { a.idxSum += x.rideIdx * x.rideN; a.extraSum += (x.rideExtra || 0) * x.rideN; a.idxN += x.rideN; }
      a.idleM += x.idleWaitMin || 0; a.waitM += x.waitInShiftMin || 0; a.notCounted += x.notCounted || 0;
      a.tier = x.tier || a.tier; a.name = x.name || a.name; a.id = a.id || x.id;
      a.daily.push(Object.assign({ date: d.date }, x));
      agg.set(id, a);
    }));
    const all = Array.from(agg.values());
    const maxDays = Math.max(1, ...all.map((a) => a.days));
    const list = all.map((a) => Object.assign(a, {
      dph: a.dphHours >= 1 ? a.dphDel / a.dphHours : null, perTrip: a.trips ? a.deliveries / a.trips : null,
      roadLatePct: rate(a.roadLate, a.deliveries), etaLatePct: rate(a.etaLate, a.nowDel), minPerKm: median(a.perKm), medLeg: median(a.legs),
      rideIdx: a.idxN ? a.idxSum / a.idxN : null, rideExtra: a.idxN ? a.extraSum / a.idxN : null,
      idlePct: a.waitM >= 60 ? (100 * a.idleM) / a.waitM : null,
      attendance: a.scheduledDays ? (100 * a.presentScheduled) / a.scheduledDays : null, attendVal: a.scheduledDays ? a.presentScheduled / a.scheduledDays : a.days / maxDays,
      excluded: DAROSTER.excluded({ hr: a.hr, id: a.id }),
    }));
    list.forEach((a) => { a.eligible = !a.excluded && a.deliveries >= minDel && a.hours >= (minHours || 0); });
    const el = list.filter((x) => x.eligible);
    const prank = (vals, v, higherBetter) => { const s = vals.filter((x) => x != null).sort((x, y) => x - y); if (v == null || !s.length) return 0.5; const below = s.filter((x) => (higherBetter ? x < v : x > v)).length; return s.length > 1 ? below / (s.length - 1) : 1; };
    const W = CFG.DA_RANK_WEIGHTS, wsum = ['speed', 'attendance', 'idle', 'roadLate', 'dph', 'volume'].reduce((s, k) => s + (W[k] || 0), 0) || 1;
    el.forEach((p) => {
      p.parts = {
        speed: prank(el.map((x) => (x.idxN >= 5 ? x.rideIdx : null)), p.idxN >= 5 ? p.rideIdx : null, false),   // under 5 rides = not enough to judge: middle score attendance: prank(el.map((x) => x.attendVal), p.attendVal, true), idle: prank(el.map((x) => x.idlePct), p.idlePct, false),
        roadLate: prank(el.map((x) => x.roadLatePct), p.roadLatePct, false), dph: prank(el.map((x) => x.dph), p.dph, true), volume: prank(el.map((x) => x.deliveries), p.deliveries, true),
      };
      p.score = (100 * Object.keys(p.parts).reduce((s, k) => s + (W[k] || 0) * p.parts[k], 0)) / wsum;
    });
    el.sort((a, b) => b.score - a.score);
    el.forEach((p, i) => { p.rank = i + 1; p.band = i < Math.ceil(el.length * 0.2) ? 'Tier 1' : i < Math.ceil(el.length * 0.5) ? 'Tier 2' : i < Math.ceil(el.length * 0.8) ? 'Tier 3' : 'Tier 4'; });
    return el.concat(list.filter((x) => !x.eligible).sort((a, b) => (a.excluded - b.excluded) || b.deliveries - a.deliveries));
  }
  function rankingCsvDA(list, label) {
    const n = (v, d) => (v == null || !isFinite(v) ? '' : Number(v).toFixed(d == null ? 1 : d));
    const cols = [['rank', (r) => r.rank || ''], ['tier_band', (r) => r.band || (r.excluded ? 'excluded' : 'not ranked')], ['score', (r) => n(r.score, 0)], ['da', (r) => r.name], ['hr_id', (r) => r.hr], ['dcm_tier', (r) => r.tier], ['days_worked', (r) => r.days],
      ['deliveries', (r) => r.deliveries], ['active_hours', (r) => n(r.hours, 1)], ['dph', (r) => n(r.dph, 2)], ['orders_per_trip', (r) => n(r.perTrip, 2)], ['road_late', (r) => r.roadLate], ['road_late_pct', (r) => n(r.roadLatePct)],
      ['eta_late_pct_own_now_orders', (r) => n(r.etaLatePct)], ['ride_vs_usual_pct', (r) => n(r.rideIdx != null ? r.rideIdx * 100 : null, 0)], ['ride_vs_usual_min', (r) => n(r.rideExtra, 1)], ['idle_while_orders_waited_pct', (r) => n(r.idlePct)], ['attendance_pct', (r) => n(r.attendance)], ['scheduled_days', (r) => r.scheduledDays], ['absent_days', (r) => r.absentDays], ['deliveries_not_counted_outside_shift', (r) => r.notCounted], ['min_per_km', (r) => n(r.minPerKm, 2)], ['gaps_' + CFG.GAP_MIN + 'min_plus', (r) => r.gaps], ['orders_lost_to_override', (r) => r.lost], ['unavailable_in_peak_min_recorded', (r) => (r.recDays ? r.peakOff : '')]];
    const e = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿# DA ranking, ' + label + '\n' + [cols.map((c) => c[0]).join(',')].concat(list.map((r) => cols.map((c) => e(c[1](r))).join(','))).join('\n');
  }

  /* ---------- per-picker daily record (saved with each day for the ranking) ---------- */
  function pkDayRecords(A) {
    const P = A.pk;
    const recs = P.list.map((p) => {
      const now = p.rows.filter((r) => r.delivered && r.late != null);   // ETA late: NOW orders only (v1.16, as the official scorecard)
      return {
        id: p.id, name: p.name, hr: p.hr, orders: p.orders, skus: p.skus, spanH: +p.spanH.toFixed(3), rateH: +(p.rateH || p.spanH).toFixed(3), storeLate: p.storeLate, slowLate: p.slowLate, queueLate: p.queueLate,
        longHandling: p.longHandling, medPerSku: p.medPerSku != null ? +p.medPerSku.toFixed(3) : null, medHandle: p.medHandle != null ? +p.medHandle.toFixed(2) : null,
        idleGaps: p.idleGaps, idleWhileWaiting: p.idleWhileWaiting, large: p.rows.filter((r) => r.skus >= CFG.LARGE_BASKET_SKUS).length,
        nowDel: now.length, etaLate: now.filter((r) => r.late).length, coffeeLate: p.coffeeLate || 0,
        // v1.9: speed, shift and availability
        secPerSku: p.secPerSku != null ? +p.secPerSku.toFixed(1) : null, speedIdx: p.speedIdx != null ? +p.speedIdx.toFixed(3) : null, secN: p.secN || 0, teamSec: P.team.secPerSku != null ? +P.team.secPerSku.toFixed(1) : null,
        shiftH: p.shiftH != null ? +p.shiftH.toFixed(2) : null, scheduled: !!p.shiftSet, dayOff: !!(p.plan && p.plan.off), idleWaitMin: p.idleWaitMin || 0, waitInShiftMin: p.waitInShiftMin || 0,
        notCounted: p.notCounted || 0, present: true,
      };
    });
    (P.absent || []).forEach((x) => recs.push({ id: x.p.id, name: x.p.name, hr: x.p.hr, orders: 0, skus: 0, spanH: 0, storeLate: 0, slowLate: 0, queueLate: 0, longHandling: 0, medPerSku: null, medHandle: null, idleGaps: 0, idleWhileWaiting: 0, large: 0, nowDel: 0, etaLate: 0, coffeeLate: 0,
      secPerSku: null, speedIdx: null, secN: 0, teamSec: null, shiftH: null, scheduled: true, dayOff: false, idleWaitMin: 0, waitInShiftMin: 0, notCounted: 0, present: false, absent: true }));
    return recs;
  }

  /* ---------- ranking across days, for bonuses ---------- */
  function daysInPK(H, from, to) { return Object.values(H).filter((d) => d.pickers && (!from || dateKey(d.date) >= from) && (!to || dateKey(d.date) <= to)); }
  // Ranking: speed first (seconds per SKU adjusted for basket size), then slow-picking lateness, availability
  // (idle while orders waited during the shift) and attendance. PPH and order count carry no weight by default.
  function rankPeriod(H, from, to, minOrders, minHours) {
    const agg = new Map();
    daysInPK(H, from, to).forEach((d) => d.pickers.forEach((x) => {
      const id = String(x.hr || x.name);
      const a = agg.get(id) || { name: x.name, hr: x.hr, id: x.id, days: 0, scheduledDays: 0, presentScheduled: 0, absentDays: 0, orders: 0, skus: 0, hours: 0, pphOrders: 0, pphHours: 0, storeLate: 0, slowLate: 0, queueLate: 0, longHandling: 0, idleWait: 0, large: 0, nowDel: 0, etaLate: 0, perSku: [], idxSum: 0, idxN: 0, secSum: 0, secN: 0, teamSecSum: 0, teamSecN: 0, idleM: 0, waitM: 0, notCounted: 0, daily: [] };
      if (x.scheduled) { a.scheduledDays++; if (x.present !== false && x.orders > 0) a.presentScheduled++; else a.absentDays++; }
      if (x.orders > 0) a.days++;
      a.orders += x.orders; a.skus += x.skus || 0; a.hours += x.spanH || 0;
      const rh = x.rateH != null ? x.rateH : x.spanH || 0;   // shift hours when the shift was entered, else first to last pick
      if (rh >= 1) { a.pphOrders += x.orders; a.pphHours += rh; }
      a.storeLate += x.storeLate || 0; a.slowLate += x.slowLate || 0; a.queueLate += x.queueLate || 0; a.longHandling += x.longHandling || 0; a.idleWait += x.idleWhileWaiting || 0; a.large += x.large || 0;
      a.nowDel += x.nowDel || 0; a.etaLate += x.etaLate || 0; a.notCounted += x.notCounted || 0;
      if (x.medPerSku != null) a.perSku.push(x.medPerSku);
      // seconds per SKU: older saved days only have minutes per SKU; v1.9 days also have the basket-adjusted index
      const n = x.secN || (x.orders || 0);
      const sec = x.secPerSku != null ? x.secPerSku : x.medPerSku != null ? x.medPerSku * 60 : null;
      if (sec != null && n) { a.secSum += sec * n; a.secN += n; }
      if (x.speedIdx != null && n) { a.idxSum += x.speedIdx * n; a.idxN += n; }
      if (x.teamSec != null && n) { a.teamSecSum += x.teamSec * n; a.teamSecN += n; }
      a.idleM += x.idleWaitMin || 0; a.waitM += x.waitInShiftMin || 0;
      a.name = x.name || a.name; a.id = a.id || x.id;
      a.daily.push(Object.assign({ date: d.date }, x));
      agg.set(id, a);
    }));
    const all = Array.from(agg.values());
    const teamSec = (() => { const s = all.reduce((t, a) => t + a.teamSecSum, 0), n = all.reduce((t, a) => t + a.teamSecN, 0); return n ? s / n : null; })();
    const maxDays = Math.max(1, ...all.map((a) => a.days));
    const list = all.map((a) => Object.assign(a, {
      pph: a.pphHours >= 1 ? a.pphOrders / a.pphHours : null, skusPerHour: a.hours >= 1 ? a.skus / a.hours : null,
      slowLatePct: rate(a.slowLate, a.orders), longPct: rate(a.longHandling, a.orders), etaLatePct: rate(a.etaLate, a.nowDel), medPerSku: median(a.perSku),
      secPerSku: a.secN ? a.secSum / a.secN : null, speedIdx: a.idxN ? a.idxSum / a.idxN : null,
      idlePct: a.waitM >= 60 ? (100 * a.idleM) / a.waitM : null,
      attendance: a.scheduledDays ? (100 * a.presentScheduled) / a.scheduledDays : null, attendVal: a.scheduledDays ? a.presentScheduled / a.scheduledDays : a.days / maxDays,
      avgSkus: a.orders ? a.skus / a.orders : null, excluded: ROSTER.excluded({ hr: a.hr, id: a.id }),
    }));
    list.forEach((a) => { a.adjSecPerSku = a.speedIdx != null && teamSec != null ? a.speedIdx * teamSec : a.secPerSku; a.eligible = !a.excluded && a.orders >= minOrders && a.hours >= (minHours || 0); });
    const el = list.filter((x) => x.eligible);
    const prank = (vals, v, higherBetter) => { const s = vals.filter((x) => x != null).sort((x, y) => x - y); if (v == null || !s.length) return 0.5; const below = s.filter((x) => (higherBetter ? x < v : x > v)).length; return s.length > 1 ? below / (s.length - 1) : 1; };
    const W = CFG.PK_RANK_WEIGHTS, ws = (W.secPerSku || 0) + (W.slowLate || 0) + (W.idle || 0) + (W.attendance || 0) + (W.pph || 0) + (W.volume || 0) || 1;
    el.forEach((p) => {
      p.parts = {
        secPerSku: prank(el.map((x) => x.adjSecPerSku), p.adjSecPerSku, false), slowLate: prank(el.map((x) => x.slowLatePct), p.slowLatePct, false),
        idle: prank(el.map((x) => x.idlePct), p.idlePct, false), attendance: prank(el.map((x) => x.attendVal), p.attendVal, true),
        pph: prank(el.map((x) => x.pph), p.pph, true), volume: prank(el.map((x) => x.orders), p.orders, true),
      };
      p.score = (100 * Object.keys(p.parts).reduce((s, k) => s + (W[k] || 0) * p.parts[k], 0)) / ws;
    });
    el.sort((a, b) => b.score - a.score);
    el.forEach((p, i) => { p.rank = i + 1; p.band = i < Math.ceil(el.length * 0.2) ? 'Tier 1' : i < Math.ceil(el.length * 0.5) ? 'Tier 2' : i < Math.ceil(el.length * 0.8) ? 'Tier 3' : 'Tier 4'; });
    const rest = list.filter((x) => !x.eligible).sort((a, b) => (a.excluded - b.excluded) || b.orders - a.orders);
    const out = el.concat(rest);
    out.teamSec = teamSec;
    return out;
  }
  function rankingCsvPK(list, label) {
    const n = (v, d) => (v == null || !isFinite(v) ? '' : Number(v).toFixed(d == null ? 1 : d));
    const cols = [['rank', (r) => r.rank || ''], ['tier_band', (r) => r.band || (r.excluded ? 'excluded' : 'not ranked')], ['score', (r) => n(r.score, 0)], ['picker', (r) => r.name], ['hr_id', (r) => r.hr],
      ['sec_per_sku_basket_adjusted', (r) => n(r.adjSecPerSku, 0)], ['sec_per_sku', (r) => n(r.secPerSku, 0)], ['late_from_slow_picking_pct', (r) => n(r.slowLatePct)], ['idle_while_orders_waited_pct', (r) => n(r.idlePct)],
      ['attendance_pct', (r) => n(r.attendance)], ['scheduled_days', (r) => r.scheduledDays], ['absent_days', (r) => r.absentDays], ['days_worked', (r) => r.days],
      ['orders', (r) => r.orders], ['skus', (r) => r.skus], ['avg_skus', (r) => n(r.avgSkus, 1)], ['hours_active', (r) => n(r.hours, 1)], ['picks_per_hour', (r) => n(r.pph, 1)],
      ['late_from_slow_picking', (r) => r.slowLate], ['long_picks_pct', (r) => n(r.longPct)], ['orders_not_counted_outside_shift', (r) => r.notCounted]];
    const e = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿# Picker ranking, ' + label + '\n' + [cols.map((c) => c[0]).join(',')].concat(list.map((r) => cols.map((c) => e(c[1](r))).join(','))).join('\n');
  }

  Object.assign(KPI_VIEWS, {
    da_ranking(A, M) {
      const H = UI.history || loadHistory();
      const kind = KPI_VIEWS._period || 'month';
      const P = periodRange(kind, dateKey(M.date));
      const minDel = kind === 'day' ? CFG.RANK_MIN_DELIVERIES.day : CFG.RANK_MIN_DELIVERIES.period;
      const minHours = kind === 'day' ? CFG.RANK_MIN_HOURS.day : CFG.RANK_MIN_HOURS.period;
      const list = rankDAs(H, P.from, P.to, minDel, minHours);
      const days = daysInDA(H, P.from, P.to).map((d) => d.date).sort((a, b) => (dateKey(a) < dateKey(b) ? -1 : 1));
      const W = CFG.DA_RANK_WEIGHTS;
      let h = '<div class="mapbar"><div class="seg" data-period>' + [['day', 'Loaded day'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['all', 'All saved']].map(([k, l]) => '<button data-v="' + k + '" class="' + (kind === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div><span class="sp"></span>' +
        (kind !== 'day' && kind !== 'all' ? '<button class="ghost" data-backfill>Fill missing days</button><button class="ghost" data-reload title="Reload every day of the period with today\'s DA shifts">Recalculate with current shifts</button>' : '') + '<button class="ghost" data-rankcsv>Export CSV</button><button class="ghost" data-goto="settings">⚙ Weights</button></div><div class="bfmsg muted"></div>';
      const ws = ['speed', 'attendance', 'idle', 'roadLate', 'dph', 'volume'].reduce((s, k) => s + (W[k] || 0), 0) || 1, wp = (x) => Math.round((100 * (x || 0)) / ws) + '%';
      h += '<div class="note">Ranking for <b>' + esc(P.label) + '</b> from <b>' + days.length + ' saved day' + (days.length === 1 ? '' : 's') + '</b>' + (days.length ? ' (' + esc(days[0]) + (days.length > 1 ? ' to ' + esc(days[days.length - 1]) : '') + ')' : '') + '. <b>Score</b> (0–100) compares each DA with the others on:<br>' +
        '<b>Speed ' + wp(W.speed) + '</b>: the first drop of each trip (a direct ride from the FP) against the usual ride to that sub-area that day. 100% = usual, 90% = 10% faster. Fair across near and far sub-areas. Under 5 rides in the period gets a middle score (greyed).<br>' +
        '<b>Attendance ' + wp(W.attendance) + '</b>: days present ÷ days scheduled on DA shifts (or days worked, where no shift is set).<br>' +
        '<b>Availability ' + wp(W.idle) + '</b>: of their shift minutes when packed orders were awaiting pickup, the share they were not on a trip (the ride back to the FP counts as a trip).<br>' +
        '<b>Late on ride ' + wp(W.roadLate) + '</b>, <b>DPH (Ops) ' + wp(W.dph) + '</b> (deliveries ÷ active hours), <b>deliveries ' + wp(W.volume) + '</b>. DPH (Ops) only counts days with 1+ active hour. Lateness caused by the FP or by waiting for logistics is <b>not</b> counted against the DA.<br>' +
        'Only deliveries picked up inside the DA\'s shift count. DAs marked <b>not ranked</b> on DA shifts are listed but not ranked; so are DAs with fewer than ' + minDel + ' deliveries or ' + minHours + ' hours on the job (span, first to last activity). Days saved before v1.10 have no speed or availability; press <b>Recalculate with current shifts</b> to reload them.</div>';
      const ranked = list.filter((x) => x.eligible);
      const nc = list.reduce((s, x) => s + (x.notCounted || 0), 0);
      if (list.length) h += '<div class="tiles">' + tile('DAs ranked', ranked.length, list.length - ranked.length ? (list.length - ranked.length) + ' not ranked (too few deliveries or hours, or excluded)' : '') + tile('Deliveries', list.reduce((s, x) => s + x.deliveries, 0), nc ? nc + ' more outside the DA\'s shift, not counted' : '') + tile('Team DPH (Ops)', fmt(list.reduce((s, x) => s + (x.dphDel || 0), 0) / Math.max(0.5, list.reduce((s, x) => s + (x.dphHours || 0), 0)), 2), 'deliveries ÷ active hours (days with 1+)') + tile('Late on ride', fmtPct(rate(list.reduce((s, x) => s + x.roadLate, 0), list.reduce((s, x) => s + x.deliveries, 0))), 'of deliveries') + '</div>';
      const partTip = (r) => (r.parts ? esc('Speed ' + Math.round(100 * r.parts.speed) + ' · Attendance ' + Math.round(100 * r.parts.attendance) + ' · Availability ' + Math.round(100 * r.parts.idle) + ' · Late on ride ' + Math.round(100 * r.parts.roadLate) + ' · DPH (Ops) ' + Math.round(100 * r.parts.dph) + ' · Deliveries ' + Math.round(100 * r.parts.volume) + ' (each 0–100 vs the others)') : '');
      const ridePill = (v) => (v == null ? '<span class="muted">–</span>' : '<span class="pill ' + (v <= 0.95 ? 'good' : v <= 1.1 ? 'warn' : 'bad') + '">' + Math.round(v * 100) + '%</span>');
      h += card('DA ranking', 'Click a column to sort. Click a DA\'s name for their day-by-day record. Hover a score for its parts.', list.length ? table([
        ['Rank', (r) => r.rank || 999, (r) => (r.rank ? '<b>' + r.rank + '</b>' : '<span class="muted">–</span>')],
        ['DA', (r) => r.name, (r) => '<a href="#" class="dalink" data-da="' + esc(String(r.hr || r.name)) + '">' + esc(r.name) + '</a> <span class="muted">' + esc(r.hr || '') + '</span> ' + tierBadge(r.tier), 'l'],
        ['Band', (r) => r.band || 'zz', (r) => (r.band ? '<span class="tier">' + r.band + '</span>' : r.excluded ? '<span class="pill na">excluded</span>' : '<span class="muted">not ranked</span>'), 'l'],
        ['Score', (r) => r.score, (r) => (r.score == null ? '–' : '<span data-tip="' + partTip(r) + '" style="cursor:help">' + fmt(r.score, 0) + '</span>')],
        ['Ride vs usual', (r) => r.rideIdx, (r) => (r.idxN && r.idxN < 5 ? '<span class="muted">' + Math.round(r.rideIdx * 100) + '% · ' + r.idxN + ' ride' + (r.idxN > 1 ? 's' : '') + '</span>' : ridePill(r.rideIdx) + (r.rideExtra != null ? ' <span class="muted">' + (r.rideExtra >= 0 ? '+' : '') + fmt(r.rideExtra, 1) + ' min · ' + r.idxN + ' rides</span>' : ''))],
        ['Attendance', (r) => r.attendance, (r) => (r.attendance == null ? '<span class="muted">' + r.days + ' days</span>' : fmtPct(r.attendance) + ' <span class="muted">' + r.presentScheduled + '/' + r.scheduledDays + '</span>')],
        ['Idle while orders waited', (r) => r.idlePct, (r) => (r.idlePct == null ? '<span class="muted">–</span>' : fmtPct(r.idlePct))],
        ['Days worked', (r) => r.days], ['Deliveries', (r) => r.deliveries], ['Span hours', (r) => r.hours, (r) => fmt(r.hours, 1)], ['DPH (Ops)', (r) => r.dph, (r) => dphPill(r.dph)], ['Orders / trip', (r) => r.perTrip, (r) => fmt(r.perTrip, 2)],
        ['Late on ride (stage)', (r) => r.roadLate], ['Late on ride %', (r) => r.roadLatePct, (r) => latePill(r.roadLatePct)], ['Min / km', (r) => r.minPerKm, (r) => fmt(r.minPerKm, 1)],
        ['ETA late % (own orders)', (r) => r.etaLatePct, (r) => fmtPct(r.etaLatePct)], ['Gaps ' + CFG.GAP_MIN + 'm+', (r) => r.gaps], ['Lost to override', (r) => r.lost],
        ['Unavailable in peak', (r) => (r.recDays ? r.peakOff : null), (r) => (r.recDays ? hm(r.peakOff) + ' <span class="muted">(' + r.recDays + 'd rec.)</span>' : '<span class="muted">–</span>')],
        ['Not counted', (r) => r.notCounted, (r) => (r.notCounted ? '<span class="pill warn">' + r.notCounted + '</span>' : '0')],
      ], list) : '<p class="muted">No saved days in this period yet. Load days in the Control Room, or press Fill missing days.</p>');
      const sel = KPI_VIEWS._da && list.find((x) => String(x.hr || x.name) === KPI_VIEWS._da);
      if (sel) h += KPI_VIEWS.daDetail(sel, P);
      return h;
    },

    daDetail(x, P) {
      const rows = x.daily.slice().sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? -1 : 1));
      const items = rows.map((r) => ({ label: r.date, short: r.date.slice(0, 5), values: { v: r.rideIdx != null ? r.rideIdx * 100 : 0 }, idx: r.rideIdx, tip: '<b>' + esc(r.date) + '</b><br>' + (r.absent ? 'Scheduled, no deliveries in the shift' : r.deliveries + ' deliveries in ' + fmt(r.spanH, 1) + ' h<br>Ride vs usual ' + (r.rideIdx != null ? Math.round(r.rideIdx * 100) + '%' : '–') + '<br>DPH ' + fmt(r.spanH >= 0.5 ? r.deliveries / r.spanH : null, 2) + '<br>Ride late ' + r.roadLate) }));
      return '<div class="card" id="dadetail"><h2>' + esc(x.name) + ' <span class="muted" style="font-size:13px">' + esc(x.hr || '') + ' · ' + esc(P.label) + '</span></h2>' +
        '<p class="sub">First-drop ride against the usual ride to that sub-area, by day. 100% = usual; lower is faster.</p>' +
        stackedChart(items, [{ key: 'v', color: (it) => (it.idx != null && it.idx <= 1 ? 'var(--ontime)' : 'var(--late)') }], { target: 100, targetLabel: 'usual', pct: true, h: 170, max: Math.max(140, ...items.map((i) => i.values.v || 0)), aria: 'Ride vs usual by day' }) +
        table([
          ['Date', (r) => dateKey(r.date), (r) => esc(r.date), 'l'], ['Attendance', (r) => (r.absent ? 0 : 1), (r) => (r.absent ? '<span class="pill bad">no deliveries in shift</span>' : r.scheduled ? '<span class="pill good">on shift</span>' : r.dayOff ? '<span class="pill warn">worked day off</span>' : '<span class="muted">no shift set</span>'), 'l'],
          ['Deliveries', (r) => r.deliveries], ['Trips', (r) => r.trips], ['Span (h)', (r) => r.spanH, (r) => fmt(r.spanH, 1)], ['Active hours', (r) => r.rateH, (r) => fmt(r.rateH, 0)],
          ['Ride vs usual', (r) => r.rideIdx, (r) => (r.rideIdx != null ? Math.round(r.rideIdx * 100) + '% <span class="muted">' + (r.rideExtra >= 0 ? '+' : '') + fmt(r.rideExtra, 1) + ' min</span>' : '<span class="muted">–</span>')],
          ['Idle while orders waited', (r) => (r.waitInShiftMin >= 30 ? r.idleWaitMin / r.waitInShiftMin : null), (r) => (r.waitInShiftMin >= 30 ? fmtPct((100 * r.idleWaitMin) / r.waitInShiftMin) + ' <span class="muted">' + r.idleWaitMin + ' min</span>' : '<span class="muted">–</span>')],
          ['DPH (Ops)', (r) => (r.rateH >= 1 ? r.deliveries / r.rateH : null), (r) => (r.rateH >= 1 ? dphPill(r.deliveries / r.rateH) : '<span class="muted">–</span>')],
          ['Late on ride (stage)', (r) => r.roadLate], ['ETA late (own NOW)', (r) => r.etaLate, (r) => r.etaLate + ' <span class="muted">of ' + r.nowDel + '</span>'], ['Late awaiting pickup (stage)', (r) => r.waited], ['Min / km', (r) => r.minPerKm, (r) => fmt(r.minPerKm, 1)],
          ['Gaps', (r) => r.gaps], ['Lost / gained', (r) => r.lost, (r) => (r.lost || 0) + ' / ' + (r.gained || 0)], ['Unavailable in peak', (r) => r.peakOffMin, (r) => (r.peakOffMin == null ? '<span class="muted">–</span>' : hm(r.peakOffMin))], ['Not counted', (r) => r.notCounted || 0],
        ], rows) + '</div>';
    },

    pk_ranking(A, M) {
      const H = UI.history || loadHistory();
      const kind = KPI_VIEWS._period || 'month';
      const P = periodRange(kind, dateKey(M.date));
      const minO = kind === 'day' ? CFG.RANK_MIN_ORDERS.day : CFG.RANK_MIN_ORDERS.period;
      const minH = kind === 'day' ? CFG.RANK_MIN_HOURS.day : CFG.RANK_MIN_HOURS.period;
      const list = rankPeriod(H, P.from, P.to, minO, minH);
      const days = daysInPK(H, P.from, P.to).map((d) => d.date).sort((a, b) => (dateKey(a) < dateKey(b) ? -1 : 1));
      const W = CFG.PK_RANK_WEIGHTS, ws = (W.secPerSku || 0) + (W.slowLate || 0) + (W.idle || 0) + (W.attendance || 0) + (W.pph || 0) + (W.volume || 0) || 1, wp = (x) => Math.round((100 * (x || 0)) / ws) + '%';
      let h = '<div class="mapbar"><div class="seg" data-period>' + [['day', 'Loaded day'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['all', 'All saved']].map(([k, l]) => '<button data-v="' + k + '" class="' + (kind === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div><span class="sp"></span>' +
        (kind !== 'day' && kind !== 'all' ? '<button class="ghost" data-backfill>Fill missing days</button><button class="ghost" data-reload title="Reload every day of the period with today\'s picker shifts">Recalculate with current shifts</button>' : '') + '<button class="ghost" data-rankcsv>Export CSV</button><button class="ghost" data-goto="settings">⚙ Weights</button></div><div class="bfmsg muted"></div>';
      h += '<div class="note">Ranking for <b>' + esc(P.label) + '</b> from <b>' + plural(days.length, 'saved day', 'saved days') + '</b>' + (days.length ? ' (' + esc(days[0]) + (days.length > 1 ? ' to ' + esc(days[days.length - 1]) : '') + ')' : '') + '. <b>Score</b> (0–100) compares each picker with the others on:<br>' +
        '<b>Speed ' + wp(W.secPerSku) + '</b>: seconds per SKU, basket-adjusted (each order compared with the team\'s median for that basket size, so a picker who got the small baskets isn\'t punished).<br>' +
        '<b>Late from slow picking ' + wp(W.slowLate) + '</b>: share of their orders late because the pick itself was slow (late because of the queue' + (CFG.SHOW_COFFEE !== false ? ', coffee' : '') + (CFG.SHOW_PHARMACY !== false ? ', pharmacy' : '') + ' or DAs doesn\'t count).<br>' +
        '<b>Availability ' + wp(W.idle) + '</b>: share of their shift minutes with orders waiting that they spent not picking.<br>' +
        '<b>Attendance ' + wp(W.attendance) + '</b>: days present ÷ days scheduled on Picker shifts (or days worked, where no shift is set).' + (W.pph || W.volume ? '<br><b>PPH (Ops) ' + wp(W.pph) + '</b>, <b>orders ' + wp(W.volume) + '</b>.' : ' PPH (Ops) and order count carry <b>no weight</b>: they reward whoever got the small baskets or the busy hours.') + '<br>' +
        'Only orders packed inside the account owner\'s shift count. Accounts marked <b>not ranked</b> on Picker shifts (resigned, shared) are listed with their orders but not ranked. Pickers with fewer than ' + minO + ' orders or ' + minH + ' hours on the job (span, first to last activity) are listed but not ranked. Days saved before v1.9 have no basket adjustment or availability; press <b>Recalculate with current shifts</b> to reload them.</div>';
      const ranked = list.filter((x) => x.eligible);
      if (list.length) h += '<div class="tiles">' + tile('Pickers ranked', ranked.length, (list.length - ranked.length) ? (list.length - ranked.length) + ' not ranked (too few orders or hours, or excluded)' : '') + tile('Team sec / SKU', fmt(list.teamSec, 0), 'median, basket-adjusted reference') + tile('Orders picked', list.reduce((s, x) => s + x.orders, 0), list.reduce((s, x) => s + x.notCounted, 0) ? list.reduce((s, x) => s + x.notCounted, 0) + ' more outside the owner\'s shift, not counted' : '') + tile('Late from slow picking', fmtPct(rate(list.reduce((s, x) => s + x.slowLate, 0), list.reduce((s, x) => s + x.orders, 0))), 'of orders picked') + '</div>';
      const secCell = (v) => (v == null ? '<span class="muted">–</span>' : '<b>' + Math.round(v) + '</b>');
      const partTip = (r) => (r.parts ? esc('Speed ' + Math.round(100 * r.parts.secPerSku) + ' · Slow-picking late ' + Math.round(100 * r.parts.slowLate) + ' · Availability ' + Math.round(100 * r.parts.idle) + ' · Attendance ' + Math.round(100 * r.parts.attendance) + ' (each 0–100 vs the others)') : '');
      h += card('Picker ranking', 'Click a column to sort. Click a picker\'s name for their day-by-day record. Hover a score for its parts.', list.length ? table([
        ['Rank', (r) => r.rank || 999, (r) => (r.rank ? '<b>' + r.rank + '</b>' : '<span class="muted">–</span>')],
        ['Picker', (r) => r.name, (r) => '<a href="#" class="dalink" data-pk="' + esc(String(r.hr || r.name)) + '">' + esc(r.name) + '</a> <span class="muted">' + esc(r.hr || '') + '</span>', 'l'],
        ['Band', (r) => r.band || 'zz', (r) => (r.band ? '<span class="tier">' + r.band + '</span>' : r.excluded ? '<span class="pill na">excluded</span>' : '<span class="muted">not ranked</span>'), 'l'],
        ['Score', (r) => r.score, (r) => (r.score == null ? '–' : '<span data-tip="' + partTip(r) + '" style="cursor:help">' + fmt(r.score, 0) + '</span>')],
        ['Sec / SKU, adjusted', (r) => r.adjSecPerSku, (r) => secCell(r.adjSecPerSku)], ['Sec / SKU', (r) => r.secPerSku, (r) => fmt(r.secPerSku, 0)],
        ['Slow-picking late %', (r) => r.slowLatePct, (r) => latePill(r.slowLatePct)], ['Idle while orders waited', (r) => r.idlePct, (r) => (r.idlePct == null ? '<span class="muted">–</span>' : fmtPct(r.idlePct))],
        ['Attendance', (r) => r.attendance, (r) => (r.attendance == null ? '<span class="muted">' + r.days + ' days</span>' : fmtPct(r.attendance) + ' <span class="muted">' + r.presentScheduled + '/' + r.scheduledDays + '</span>')],
        ['Days worked', (r) => r.days], ['Orders', (r) => r.orders], ['Avg SKUs', (r) => r.avgSkus, (r) => fmt(r.avgSkus, 1)], ['Span hours', (r) => r.hours, (r) => fmt(r.hours, 1)], ['PPH (Ops)', (r) => r.pph, (r) => fmt(r.pph, 1)],
        ['Late from slow picking', (r) => r.slowLate], ['Long picks %', (r) => r.longPct, (r) => fmtPct(r.longPct)], ['Not counted', (r) => r.notCounted, (r) => (r.notCounted ? '<span class="pill warn">' + r.notCounted + '</span>' : '0')],
      ], list) : '<p class="muted">No saved days in this period yet. Load days in the Control Room, or press Fill missing days.</p>');
      const sel = KPI_VIEWS._pk && list.find((x) => String(x.hr || x.name) === KPI_VIEWS._pk);
      if (sel) h += KPI_VIEWS.pkDetail(sel, P);
      return h;
    },

    pkDetail(x, P) {
      const rows = x.daily.slice().sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? -1 : 1));
      const secOf = (r) => (r.speedIdx != null && r.teamSec != null ? r.speedIdx * r.teamSec : r.secPerSku != null ? r.secPerSku : r.medPerSku != null ? r.medPerSku * 60 : null);
      const ref = x.adjSecPerSku;
      const items = rows.map((r) => ({ label: r.date, short: r.date.slice(0, 5), values: { v: secOf(r) || 0 }, sec: secOf(r), tip: '<b>' + esc(r.date) + '</b><br>' + (r.absent ? 'Scheduled, no picks inside the shift' : r.orders + ' orders, ' + (r.skus || 0) + ' SKUs<br>Sec / SKU adjusted ' + fmt(secOf(r), 0) + ' (raw ' + fmt(r.secPerSku != null ? r.secPerSku : r.medPerSku != null ? r.medPerSku * 60 : null, 0) + ')<br>Late from slow picking ' + (r.slowLate || 0)) }));
      return '<div class="card" id="pkdetail"><h2>' + esc(x.name) + ' <span class="muted" style="font-size:13px">' + esc(x.hr || '') + ' · ' + esc(P.label) + '</span></h2>' +
        '<p class="sub">Seconds per SKU (basket-adjusted) by day. Lower is faster. Dashed line = their average for the period.</p>' +
        stackedChart(items, [{ key: 'v', color: (it) => (it.sec != null && ref != null && it.sec <= ref ? 'var(--ontime)' : 'var(--late)') }], { target: ref != null ? Math.round(ref) : null, targetLabel: 'their average', h: 170, aria: 'Seconds per SKU by day' }) +
        table([
          ['Date', (r) => dateKey(r.date), (r) => esc(r.date), 'l'], ['Attendance', (r) => (r.absent ? 0 : 1), (r) => (r.absent ? '<span class="pill bad">no picks in shift</span>' : r.scheduled ? '<span class="pill good">on shift</span>' : r.dayOff ? '<span class="pill warn">worked day off</span>' : '<span class="muted">no shift set</span>'), 'l'],
          ['Orders', (r) => r.orders], ['SKUs', (r) => r.skus], ['Sec / SKU, adjusted', (r) => secOf(r), (r) => fmt(secOf(r), 0)], ['Sec / SKU', (r) => r.secPerSku, (r) => fmt(r.secPerSku != null ? r.secPerSku : r.medPerSku != null ? r.medPerSku * 60 : null, 0)],
          ['Idle while orders waited', (r) => (r.waitInShiftMin >= 30 ? r.idleWaitMin / r.waitInShiftMin : null), (r) => (r.waitInShiftMin >= 30 ? fmtPct((100 * r.idleWaitMin) / r.waitInShiftMin) + ' <span class="muted">' + r.idleWaitMin + ' min</span>' : '<span class="muted">–</span>')],
          ['Late from slow picking', (r) => r.slowLate], ['Late, waited in queue', (r) => r.queueLate], ['Long picks', (r) => r.longHandling], ['Hours', (r) => r.spanH, (r) => fmt(r.spanH, 1)], ['Not counted', (r) => r.notCounted || 0],
        ], rows) + '</div>';
    },

  });
  /* ---------- rankings, coffee & pharmacy and accountability: brain wiring ---------- */
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const pphPill = (v) => kpiPill('pph', v);
  const rankMin = (kind, what) => (kind === 'day' ? CFG[what].day : CFG[what].period);

  // Fill missing days for the rankings: loads every past day of the period that isn't saved yet (read-only).
  const BACKFILL = {
    running: false,
    async run(from, to, onStep, force) {
      if (BACKFILL.running || !CAP.ordersUrl) return;
      BACKFILL.running = true;
      try {
        const fpParam = new URL(CAP.ordersUrl).searchParams.getAll('fps[]');
        const H = loadHistory();
        const have = new Set(Object.values(H).filter((d) => d.das && d.pickers && d.kpi && d.kpi.eta != null).map((d) => dateKey(d.date)));
        const days = [];
        const t = new Date(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8));
        const yesterday = new Date(); yesterday.setHours(0, 0, 0, 0); yesterday.setDate(yesterday.getDate() - 1);
        const end = new Date(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8));
        while (t <= end && t <= yesterday) { const dk = pad2(t.getDate()) + '-' + pad2(t.getMonth() + 1) + '-' + t.getFullYear(); if (force || !have.has(dateKey(dk))) days.push(dk); t.setDate(t.getDate() + 1); }
        let done = 0;
        for (const dk of days) {
          onStep && onStep('Loading ' + dk + ' (' + (done + 1) + ' of ' + days.length + ')…');
          try {
            const res = await fetchDay(dk);
            if (res.orders.length) {
              const coords = await getFpCoords(res.orders);
              const next = await fetchNextDay(dk);
              const A = analyze(res.orders, coords);
              A.dk = dk;
              A.spill = makeSpill(dk, next, coords);
              const meta = { date: dk, fps: res.fps.length ? res.fps : fpParam, fpNames: Array.from(new Set(res.orders.map((o) => o.fpName).filter(Boolean))), fetchedAt: Date.now() };
              const fp = meta.fps[0];
              A.da = analyzeDA(A, meta, null, fp ? DAREC.load(fp, dk) : null, null);
              A.da.list = A.da.list.filter((x) => x.deliveries || (x.av && x.av.online));
              A.pk = analyzePickers(A, meta, fp ? PKREC.load(fp, dk) : null);
              A.cp = cpAnalysis(A); cpApply(A, A.cp);
              A.score = scoreDay(A);
              saveHistory(meta, A);
              finishPrevDay(meta, A);
            }
          } catch (e) { onStep && onStep('Stopped at ' + dk + ': ' + e.message); return; }
          done++;
        }
        onStep && onStep(days.length ? (force ? 'Recalculated ' : 'Added ') + plural(days.length, 'day', 'days') + '.' : 'No missing days in this period.');
      } finally { BACKFILL.running = false; }
    },
  };

  function bindRank(main, who) {
    main.querySelectorAll('.seg[data-period] button').forEach((b) => b.addEventListener('click', () => { KPI_VIEWS._period = b.dataset.v; KPI_VIEWS._da = null; KPI_VIEWS._pk = null; UI.render(); }));
    main.querySelectorAll('a.dalink').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      if (a.dataset.da) KPI_VIEWS._da = a.dataset.da;
      if (a.dataset.pk) KPI_VIEWS._pk = a.dataset.pk;
      UI.render(true);
      const d = UI.root.querySelector('#dadetail, #pkdetail'); if (d) d.scrollIntoView({ block: 'start' });
    }));
    const csv = main.querySelector('[data-rankcsv]');
    if (csv) csv.addEventListener('click', () => {
      const kind = KPI_VIEWS._period || 'month', P = periodRange(kind, dateKey(UI.meta.date)), H = UI.history || loadHistory();
      if (who === 'da') UI.download(rankingCsvDA(rankDAs(H, P.from, P.to, rankMin(kind, 'RANK_MIN_DELIVERIES'), rankMin(kind, 'RANK_MIN_HOURS')), P.label), 'da-ranking-' + kind + '-' + dateKeyOf(Date.now()) + '.csv');
      else UI.download(rankingCsvPK(rankPeriod(H, P.from, P.to, rankMin(kind, 'RANK_MIN_ORDERS'), rankMin(kind, 'RANK_MIN_HOURS')), P.label), 'picker-ranking-' + kind + '-' + dateKeyOf(Date.now()) + '.csv');
    });
    const go = async (btn, force) => {
      const P = periodRange(KPI_VIEWS._period || 'month', dateKey(UI.meta.date));
      const msg = main.querySelector('.bfmsg');
      main.querySelectorAll('[data-backfill],[data-reload]').forEach((b) => { b.disabled = true; });
      await BACKFILL.run(P.from, P.to, (t) => { if (msg.isConnected) msg.textContent = t; }, force);
      UI.history = loadHistory();
      const keep = msg.textContent;
      UI.render();
      const m2 = UI.root.querySelector('.bfmsg'); if (m2) m2.textContent = keep;
    };
    const bf = main.querySelector('[data-backfill]');
    if (bf) bf.addEventListener('click', () => go(bf, false));
    const rl = main.querySelector('[data-reload]');
    if (rl) rl.addEventListener('click', () => go(rl, true));
  }
  const CP_SCRIPT = 'brain';
  /* ------------------------------------------------------------------
   * COFFEE & PHARMACY – coffee and pharmacy judged separately.
   * Coffee: time the order lost to the barista, in the store (picker done, coffee not ready) and on the shelf
   *   (packed, DA waiting for the coffee). Coffee-only orders: everything beyond a plain order's time is the barista's.
   * Pharmacy: the pharmacy is a separate stop, so pharmacy orders take longer after packing. The usual detour is
   *   measured each day against plain orders to the same sub-areas.
   * ------------------------------------------------------------------ */
  const CP_VERDICTS = ['Coffee (barista)', 'Pharmacy', 'FP: waited for a picker', 'FP: slow picking', 'Logistics / DAs', 'Ride (DA)', 'Unclear'];
  const CP_NOT_FP = ['Coffee (barista)', 'Pharmacy'];
  const CP_COLORS = { 'Coffee (barista)': '#7A6051', 'Pharmacy': '#00A9A1', 'FP: waited for a picker': '#DB3738', 'FP: slow picking': '#E5813B', 'Logistics / DAs': '#EDC246', 'Ride (DA)': '#4D58A7', 'Unclear': '#AC9C93' };
  const CP_DONE = ['ready_for_delivery', 'received', 'ready', 'done', 'completed'];

  function cpAnalysis(A) {
    const P = A.pk;
    const recO = (P.rec && P.rec.o) || {};
    const main = A.rows.filter((r) => !r.subOrder);                       // follows the sub-order setting (for the ETA KPIs)
    const real = A.rows.filter((r) => !(r.wasSub != null ? r.wasSub : r.subOrder)); // real orders only (for coffee / pharmacy)
    const plainNow = real.filter((r) => r.delivered && !r.scheduled && !r.coffee && !r.pharma);
    // when the DA could have left with it: packed, or for scheduled orders not before 15 min ahead of the slot
    const anchor = (r) => (r.packed == null ? null : r.scheduled && r.slotStart != null ? Math.max(r.packed, r.slotStart - 15 * MIN) : r.packed);
    const shelfEff = (r) => (r.pickedUp != null && anchor(r) != null ? Math.max(0, (r.pickedUp - anchor(r)) / MIN) : null);
    const afterPack = (r) => (r.completed != null && anchor(r) != null ? Math.max(0, (r.completed - anchor(r)) / MIN) : null);
    const storeMin = (r) => diffMin(r.packed, r.placed);
    const cache = {};
    const baseBy = (key, pick, val) => { const k = key + '|' + pick; if (!(k in cache)) { const g = plainNow.filter((r) => (key === 'slot' ? r.slot === pick : r.subArea === pick)); cache[k] = median((g.length >= 5 ? g : plainNow).map(val)); } return cache[k]; };
    const storeBase = (r) => baseBy('slot', r.slot, storeMin), shelfBase = (r) => baseBy('slot', r.slot, (x) => x.shelfMin);
    const areaAfter = (r) => baseBy('area', r.subArea, afterPack), roadBase = (r) => baseBy('area', r.subArea, (x) => x.legMin);
    // expected picking time for a basket, from minutes per SKU on plain orders (the picker's own if they had 5+, else the team's)
    const plainPicked = P.rows.filter((r) => !r.coffee && !r.pharma && r.minPerSku != null && r.startSource !== 'assumed (first order)');
    const teamMps = median(plainPicked.map((r) => r.minPerSku)) || 1;
    const pickerMps = {};
    groupBy(plainPicked, (r) => String(r.pickerId)).forEach((g, k) => { if (g.length >= 5) pickerMps[k] = median(g.map((r) => r.minPerSku)); });

    // usual pharmacy detour: extra time after packing vs plain NOW orders to the same sub-area
    const pharmDel = real.filter((r) => r.pharma && r.delivered && afterPack(r) != null && areaAfter(r) != null);
    const pharmExtras = pharmDel.map((r) => afterPack(r) - areaAfter(r));
    const detourMeasured = pharmExtras.length >= 3;
    const detour = detourMeasured ? Math.max(0, median(pharmExtras)) : CFG.PHARMACY_EXTRA_MIN;
    const pharmThr = Math.max(CFG.PHARMACY_MIN_EXTRA, CFG.PHARMACY_SHARE * detour);

    // an FP without coffee / a pharmacy (Settings) never has a late order put on them
    const useC = CFG.SHOW_COFFEE !== false, useP = CFG.SHOW_PHARMACY !== false;
    const rows = real.filter((r) => r.coffee || r.pharma).map((r) => {
      const ro = recO[String(r.id)];
      const pickerDone = ro && ro[4] && (r.packed == null || ro[4] <= r.packed + 2 * MIN) ? ro[4] : null;
      const baristaDone = ro && ro[6] ? ro[6] : null;
      const expHandle = r.handleMin != null ? Math.max(2, (pickerMps[String(r.pickerId)] || teamMps) * (r.skus || 1)) : null;
      const coffeeOnly = !!(r.coffee && (r.coffeeOnly || (!r.pickerId && r.skus != null && r.skus <= 1 && !r.pharma)));
      const pharmOnly = !!(r.pharma && !r.pickerId && r.packed == null);
      // coffee, in the store
      let coffeeWait = null, coffeeSrc = null;
      if (r.coffee && coffeeOnly) { const st = storeMin(r), b = storeBase(r); coffeeWait = st != null && b != null ? Math.max(0, st - b) : null; coffeeSrc = 'coffee only'; }
      else if (r.coffee && pickerDone && r.packed) { coffeeWait = Math.max(0, (Math.min(r.packed, baristaDone || r.packed) - pickerDone) / MIN); coffeeSrc = 'recorded'; }
      else if (r.coffee && r.handleMin != null) { coffeeWait = Math.max(0, r.handleMin - expHandle); coffeeSrc = 'estimated'; }
      // coffee, on the shelf: packed, DA waiting for the barista
      let coffeeShelf = null, shelfSrc = null;
      if (r.coffee && r.packed != null) {
        if (baristaDone && baristaDone > r.packed) { coffeeShelf = (Math.min(baristaDone, r.pickedUp || baristaDone) - r.packed) / MIN; shelfSrc = 'recorded'; }
        else { const se = shelfEff(r), b = shelfBase(r); if (se != null && b != null) { coffeeShelf = Math.max(0, se - b); shelfSrc = 'vs plain orders'; } }
      }
      const coffeeDelay = r.coffee ? (coffeeWait || 0) + (coffeeShelf || 0) : null;
      // pharmacy: extra time after packing vs plain orders to the same sub-area
      const ap = afterPack(r), aBase = areaAfter(r);
      const pharmExtra = r.pharma && ap != null && aBase != null ? ap - aBase : null;
      const road = roadBase(r);
      const explains = (delay) => !CFG.CP_STRICT || (r.lateMin != null && delay >= r.lateMin - 1);
      let verdict = null, note = '';
      if (r.late) {
        const coffeeHit = r.coffee && coffeeDelay != null && coffeeDelay >= CFG.COFFEE_DELAY_MIN && (IN_STORE.includes(r.cause) || r.cause === 'Awaiting pickup') &&
          (coffeeOnly || (coffeeShelf || 0) >= CFG.COFFEE_DELAY_MIN || (coffeeWait || 0) >= (r.waitMin || 0) * 0.5);
        const pharmHit = r.pharma && pharmExtra != null && pharmExtra >= pharmThr && !IN_STORE.includes(r.cause);
        if (pharmOnly && useP) verdict = 'Pharmacy';
        else if (useC && coffeeHit && explains(coffeeDelay)) verdict = 'Coffee (barista)';
        else if (useP && pharmHit && explains(pharmExtra)) verdict = 'Pharmacy';
        else {
          if (useC && coffeeHit) note = 'coffee added ' + Math.round(coffeeDelay) + ' min, still ' + Math.round(r.lateMin - coffeeDelay) + ' late without it';
          else if (useP && pharmHit) note = 'pharmacy added ' + Math.round(pharmExtra) + ' min, still ' + Math.round(r.lateMin - pharmExtra) + ' late without it';
          if (IN_STORE.includes(r.cause)) verdict = r.storeLate === 'Waited for a picker' ? 'FP: waited for a picker' : 'FP: slow picking';
          else if (r.cause === 'Ride' || r.cause === 'Awaiting pickup') verdict = r.cause === 'Awaiting pickup' ? 'Logistics / DAs' : 'Ride (DA)';
          else verdict = 'Unclear';
        }
      }
      return {
        r, type: r.coffee && r.pharma ? 'Coffee + pharmacy' : r.coffee ? 'Coffee' : 'Pharmacy', coffeeOnly, pharmOnly, verdict, note,
        store: storeMin(r), storeBase: storeBase(r), shelf: r.shelfMin, shelfBase: shelfBase(r), road: r.legMin, roadBase: road, roadExtra: r.legMin != null && road != null ? r.legMin - road : null,
        afterPack: ap, afterBase: aBase, pharmExtra, expHandle, coffeeWait, coffeeSrc, coffeeShelf, shelfSrc, coffeeDelay, pickerDone, baristaDone,
      };
    });
    const summary = (pred, label, kind) => {
      const g = rows.filter(pred);
      const del = g.filter((x) => x.r.delivered), now = del.filter((x) => !x.r.scheduled), late = del.filter((x) => x.r.late), judged = del.filter((x) => x.r.late != null);
      const verdicts = {}; CP_VERDICTS.forEach((v) => { verdicts[v] = late.filter((x) => x.verdict === v).length; });
      const own = kind === 'coffee' ? 'Coffee (barista)' : 'Pharmacy';
      return {
        label, kind, orders: g.length, delivered: del.length, nowDel: judged.length, late: late.length, eta: rate(late.length, judged.length), verdicts,
        caused: late.filter((x) => x.verdict === own).length, fp: late.filter((x) => x.verdict && !CP_NOT_FP.includes(x.verdict) && x.verdict !== 'Unclear').length,
        store: median(now.map((x) => x.store)), storeBase: median(now.map((x) => x.storeBase)), shelf: median(now.map((x) => x.shelf)), shelfBase: median(now.map((x) => x.shelfBase)),
        road: median(del.map((x) => x.road)), roadBase: median(del.map((x) => x.roadBase)), afterPack: median(del.map((x) => x.afterPack)), afterBase: median(del.map((x) => x.afterBase)),
        delivery: median(now.map((x) => x.r.deliveryMin)),
        coffeeDelay: median(del.map((x) => x.coffeeDelay)), coffeeWait: median(del.map((x) => x.coffeeWait)), coffeeShelf: median(del.map((x) => x.coffeeShelf)),
        pharmExtra: median(del.map((x) => x.pharmExtra)), recorded: g.filter((x) => x.coffeeSrc === 'recorded' || x.shelfSrc === 'recorded').length,
        coffeeOnly: g.filter((x) => x.coffeeOnly).length, pharmOnly: g.filter((x) => x.pharmOnly).length,
      };
    };
    const coffee = summary((x) => x.r.coffee, 'Coffee (all)', 'coffee');
    const coffeeOnlyS = summary((x) => x.r.coffee && x.coffeeOnly, 'Coffee only', 'coffee');
    const coffeeMix = summary((x) => x.r.coffee && !x.coffeeOnly, 'Coffee + grocery', 'coffee');
    const pharma = summary((x) => x.r.pharma, 'Pharmacy (all)', 'pharma');
    const pharmOnlyS = summary((x) => x.r.pharma && x.pharmOnly, 'Pharmacy only', 'pharma');
    const pharmMix = summary((x) => x.r.pharma && !x.pharmOnly, 'Pharmacy + grocery', 'pharma');
    const plainDel = real.filter((r) => r.delivered && r.late != null && !r.coffee && !r.pharma);
    const plainLate = plainDel.filter((r) => r.late).length;
    const plain = {
      label: 'Plain grocery', kind: 'plain', orders: real.filter((r) => !r.coffee && !r.pharma).length, nowDel: plainDel.length, late: plainLate, eta: rate(plainLate, plainDel.length),
      store: median(plainNow.map(storeMin)), shelf: median(plainNow.map((r) => r.shelfMin)), road: median(plainNow.map((r) => r.legMin)), afterPack: median(plainNow.map(afterPack)), delivery: median(plainNow.map((r) => r.deliveryMin)),
    };
    // pharmacy detour by sub-area
    const pharmAreas = [];
    groupBy(rows.filter((x) => x.r.pharma && x.r.delivered), (x) => x.r.subArea).forEach((g, k) => {
      pharmAreas.push({ area: k, n: g.length, plainN: plainNow.filter((r) => r.subArea === k).length, base: median(g.map((x) => x.afterBase)), pharm: median(g.map((x) => x.afterPack)), extra: median(g.map((x) => x.pharmExtra)), late: g.filter((x) => x.r.late).length, caused: g.filter((x) => x.verdict === 'Pharmacy').length });
    });
    // the FP's own ETA late %: orders late because of coffee or the pharmacy taken out
    // ETA late judges NOW orders only, as the official scorecard (in the FP Brain a scheduled order's late is null)
    const nowDel = main.filter((r) => r.delivered && r.late != null);
    const etaLate = nowDel.filter((r) => r.late).length;
    const notFpNow = rows.filter((x) => x.r.delivered && x.r.late && CP_NOT_FP.includes(x.verdict)).length;
    const slots = [];
    for (let h = 0; h < 24; h++) {
      const g = rows.filter((x) => x.r.slot === h);
      const allRows = real.filter((r) => r.slot === h);
      if (!g.length) continue;
      const c = g.filter((x) => x.r.coffee), p = g.filter((x) => x.r.pharma), both = g;
      const lateN = (arr) => arr.filter((x) => x.r.late && x.r.delivered).length;
      const slotLate = allRows.filter((r) => r.late && r.delivered).length;
      const caused = g.filter((x) => x.r.late && x.r.delivered && CP_NOT_FP.includes(x.verdict)).length;
      slots.push({
        h, label: slotLabel(h), all: allRows.length, slotLate,
        coffee: c.length, coffeeLate: lateN(c), coffeeCaused: c.filter((x) => x.verdict === 'Coffee (barista)').length, coffeeShare: rate(c.length, allRows.length),
        pharma: p.length, pharmaLate: lateN(p), pharmaCaused: p.filter((x) => x.verdict === 'Pharmacy').length, pharmaShare: rate(p.length, allRows.length),
        bothShare: rate(both.length, allRows.length), caused, causedShare: rate(caused, slotLate),
      });
    }
    return {
      rows, coffee, coffeeOnly: coffeeOnlyS, coffeeMix, pharma, pharmOnly: pharmOnlyS, pharmMix, plain, slots, pharmAreas, detour, detourMeasured, pharmThr, pharmN: pharmExtras.length,
      eta: rate(etaLate, nowDel.length), etaExCp: rate(etaLate - notFpNow, nowDel.length - notFpNow), notFpNow, etaLate, nowDel: nowDel.length,
    };
  }

  // Coffee and pharmacy delays shouldn't count against pickers: relabel those orders and recount.
  function cpApply(A, CP) {
    CP.rows.forEach((x) => { x.r.cpVerdict = x.verdict; x.r.cpRow = x; if (x.verdict && CP_NOT_FP.includes(x.verdict) && x.r.storeLate) x.r.storeLate = x.verdict; });
    const P = A.pk;
    P.list.forEach((p) => {
      p.storeLate = p.rows.filter((r) => r.storeLate && !CP_NOT_FP.includes(r.storeLate)).length;
      p.slowLate = p.rows.filter((r) => r.storeLate === 'Slow picking').length;
      p.queueLate = p.rows.filter((r) => r.storeLate === 'Waited for a picker').length;
      p.coffeeLate = p.rows.filter((r) => r.storeLate === 'Coffee (barista)').length;
      p.storeLatePct = rate(p.storeLate, p.orders);
    });
    const sl = P.rows.filter((r) => r.storeLate && !CP_NOT_FP.includes(r.storeLate));
    P.team.storeLate = sl.length; P.team.slowLate = sl.filter((r) => r.storeLate === 'Slow picking').length; P.team.queueLate = sl.filter((r) => r.storeLate === 'Waited for a picker').length;
  }

  function cpBar(counts, total) {
    if (!total) return '<p class="muted">No late orders of this type.</p>';
    const items = CP_VERDICTS.filter((v) => counts[v]);
    return '<div class="causebar">' + items.map((v) => '<span data-tip="' + esc(v + ': ' + counts[v] + ' (' + Math.round((100 * counts[v]) / total) + '%)') + '" style="width:' + (100 * counts[v]) / total + '%;background:' + CP_COLORS[v] + '"></span>').join('') + '</div>' +
      '<div class="legend">' + items.map((v) => '<span><i style="background:' + CP_COLORS[v] + '"></i>' + v + ': <b>' + counts[v] + '</b></span>').join('') + '</div>';
  }

  KPI_VIEWS.coffee = function (A) {
    const C = A.cp;
    const strictTxt = CFG.CP_STRICT ? ' and that delay alone explains how late it was (an order 30 min late with a 10 min coffee wait keeps its normal owner)' : '';
    const sc = CFG.SHOW_COFFEE !== false, sp = CFG.SHOW_PHARMACY !== false;
    let h = '<div class="note">' + (sc ? '<b>Coffee (barista)</b> = a late coffee order that lost ' + CFG.COFFEE_DELAY_MIN + '+ min to the coffee' + strictTxt + '. The coffee time is counted in two places: <b>in the FP</b> (picking took longer than that basket needs, or for coffee-only orders, longer than a plain order) and <b>awaiting pickup</b> (packed, but the DA waited for the barista: awaiting-pickup time beyond plain orders in the same hour)' + (C.coffee.recorded ? '; ' + C.coffee.recorded + ' orders were timed exactly from the live recording' : '') + '.<br>' : '') +
      (sp ? '<b>Pharmacy</b> = a pharmacy-only order, or a late pharmacy order packed in time whose time after packing was at least ' + Math.round(CFG.PHARMACY_SHARE * 100) + '% of the usual pharmacy detour (' + fmt(C.detour, 0) + ' min ' + (C.detourMeasured ? 'today, from ' + C.pharmN + ' orders' : '– default, too few pharmacy orders today') + ', so ' + fmt(C.pharmThr, 0) + '+ min)' + strictTxt.replace('coffee wait', 'detour') + '.<br>' : '') +
      'Every other late coffee or pharmacy order is owned like any other order, by the FP or logistics (ETA Late Analysis). ' + (sc ? 'Coffee delays never count against pickers' : '') + (sc && sp ? ' and ' : '') + (sp ? (sc ? 'p' : 'P') + 'harmacy stops never count against DAs' : '') + ' in the brain (rankings included). Thresholds are in ⚙ Settings.</div>';
    const ownSplit = (k, caused) => { const L = C.rows.filter((x) => x.r[k] && x.r.late && x.r.delivered).map((x) => x.r); const f = L.filter((r) => ownerOf(r) === OWN_STORE).length, l = L.filter((r) => ownerOf(r) === OWN_DISPATCH).length, o = L.filter((r) => ![OWN_STORE, OWN_DISPATCH, OWN_CP].includes(ownerOf(r))).length; return f + ' FP, ' + l + ' logistics' + (o > 0 ? ', ' + o + ' other' : ''); };
    h += '<div class="kpis">' +
      kpi('ETA late %, all orders', fmt(C.eta, 1) + '%', '', C.etaLate + ' of ' + C.nowDel + ' delivered late', statusOf(C.eta, CFG.LATE_TARGET_PCT, 2)) +
      kpi('ETA late %, without coffee / pharmacy delays', fmt(C.etaExCp, 1) + '%', '', 'Leaving out ' + C.notFpNow + ' late orders caused by ' + (sc && sp ? 'coffee or the pharmacy' : sc ? 'the coffee' : 'the pharmacy'), statusOf(C.etaExCp, CFG.LATE_TARGET_PCT, 2)) +
      kpi('Coffee orders late', C.coffee.nowDel ? fmt(C.coffee.eta, 1) + '%' : '–', '', C.coffee.late + ' of ' + C.coffee.nowDel + ' delivered · ' + C.coffee.caused + ' because of coffee, ' + ownSplit('coffee', C.coffee.caused), statusOf(C.coffee.eta, CFG.LATE_TARGET_PCT, 2)) +
      kpi('Pharmacy orders late', C.pharma.nowDel ? fmt(C.pharma.eta, 1) + '%' : '–', '', C.pharma.late + ' of ' + C.pharma.nowDel + ' delivered · ' + C.pharma.caused + ' because of the pharmacy, ' + ownSplit('pharma', C.pharma.caused), statusOf(C.pharma.eta, CFG.LATE_TARGET_PCT, 2)) + '</div>';
    h += '<div class="tiles">' +
      tile('Coffee adds (median)', fmt(C.coffee.coffeeDelay, 1) + '<span class="u">min</span>', fmt(C.coffee.coffeeWait, 1) + ' in the FP + ' + fmt(C.coffee.coffeeShelf, 1) + ' awaiting pickup') +
      tile('Coffee-only orders', C.coffee.coffeeOnly, C.coffeeOnly.nowDel ? fmtPct(C.coffeeOnly.eta) + ' late' : '') +
      tile('Pharmacy detour', fmt(C.detour, 0) + '<span class="u">min</span>', C.detourMeasured ? 'extra after packing vs plain orders to the same sub-areas, ' + C.pharmN + ' orders' : 'default (under 3 pharmacy orders today)') +
      tile('Pharmacy-only orders', C.pharma.pharmOnly, C.pharmOnly.nowDel ? fmtPct(C.pharmOnly.eta) + ' late' : '') + '</div>';
    h += '<div class="grid two">' +
      card('Late coffee orders: whose fault', C.coffee.orders + ' coffee orders, ' + C.coffee.late + ' late.', cpBar(C.coffee.verdicts, C.coffee.late)) +
      card('Late pharmacy orders: whose fault', C.pharma.orders + ' pharmacy orders' + (C.pharma.pharmOnly ? ' (' + C.pharma.pharmOnly + ' pharmacy-only)' : '') + ', ' + C.pharma.late + ' late.', cpBar(C.pharma.verdicts, C.pharma.late)) + '</div>';
    const u = (v, b) => fmt(v, 1) + (b != null ? ' <span class="muted">usual ' + fmt(b, 1) + '</span>' : '');
    h += card('Where the time went', 'Median minutes per stage, NOW orders (a scheduled order\'s wait is planned, so it would skew the times). ETA late % counts NOW orders. <b>Usual</b> = plain grocery orders in the same hours (FP, awaiting pickup) or to the same sub-areas (ride, after packing).', table([
      ['Orders', (r) => r.label, (r) => (r.kind === 'plain' ? '<b>' + r.label + '</b>' : r.label.indexOf('(all)') > 0 ? '<b>' + r.label + '</b>' : '&nbsp;&nbsp;↳ ' + r.label), 'l'], ['Count', (r) => r.orders], ['ETA late %', (r) => r.eta, (r) => latePill(r.eta)],
      ['Caused', (r) => r.caused, (r) => (r.kind === 'plain' ? '<span class="muted">–</span>' : r.caused + ' <span class="muted">of ' + r.late + '</span>')],
      ['FP (placed → packed)', (r) => r.store, (r) => u(r.store, r.storeBase)],
      ['Awaiting pickup', (r) => r.shelf, (r) => u(r.shelf, r.shelfBase)],
      ['Ride', (r) => r.road, (r) => u(r.road, r.roadBase)],
      ['After packing → delivered', (r) => r.afterPack, (r) => u(r.afterPack, r.afterBase)],
      ['Coffee adds', (r) => r.coffeeDelay, (r) => (r.kind === 'coffee' ? fmt(r.coffeeDelay, 1) : '<span class="muted">–</span>')],
      ['Pharmacy adds', (r) => r.pharmExtra, (r) => (r.kind === 'pharma' ? fmt(r.pharmExtra, 1) : '<span class="muted">–</span>')],
      ['Placed → delivered', (r) => r.delivery, (r) => fmt(r.delivery, 0)],
    ], [C.plain, C.coffee, C.coffeeOnly, C.coffeeMix, C.pharma, C.pharmOnly, C.pharmMix].filter((r) => r.orders && (r.kind !== 'coffee' || sc) && (r.kind !== 'pharma' || sp))));
    if (C.pharmAreas.length) h += card('Pharmacy detour by sub-area', 'Time from packing to delivered: pharmacy orders vs plain NOW orders to the same sub-area. The difference is the pharmacy stop.', table([
      ['Sub-area', (r) => r.area, null, 'l'], ['Pharmacy orders', (r) => r.n], ['Plain orders compared', (r) => r.plainN, (r) => (r.plainN >= 5 ? r.plainN : '<span class="muted">' + r.plainN + ' (FP-wide used)</span>')],
      ['Plain, after packing', (r) => r.base, (r) => fmt(r.base, 1)], ['Pharmacy, after packing', (r) => r.pharm, (r) => fmt(r.pharm, 1)],
      ['Extra', (r) => r.extra, (r) => (r.extra == null ? '–' : '<b>' + (r.extra >= 0 ? '+' : '') + fmt(r.extra, 1) + '</b>')], ['Late', (r) => r.late], ['Caused by pharmacy', (r) => r.caused],
    ], C.pharmAreas.sort((a, b) => b.n - a.n)));
    h += card('By timeslot', '<b>Share</b> = share of the slot\'s orders. <b>Caused</b> = late orders ' + (sc && sp ? 'the coffee / the pharmacy' : sc ? 'the coffee' : 'the pharmacy') + ' caused. <b>Of slot\'s late</b> = how much of the slot\'s lateness ' + (sc && sp ? 'coffee and pharmacy explain together' : sc ? 'the coffee explains' : 'the pharmacy explains') + '.', C.slots.length ? table([
      ['Timeslot', (r) => r.h, (r) => esc(r.label), 'l'], ['All orders', (r) => r.all], ['Late', (r) => r.slotLate],
      ['Coffee', (r) => r.coffee], ['Coffee late', (r) => r.coffeeLate], ['Caused by coffee', (r) => r.coffeeCaused], ['Coffee share', (r) => r.coffeeShare, (r) => fmtPct(r.coffeeShare)],
      ['Pharmacy', (r) => r.pharma], ['Pharmacy late', (r) => r.pharmaLate], ['Caused by pharmacy', (r) => r.pharmaCaused], ['Pharmacy share', (r) => r.pharmaShare, (r) => fmtPct(r.pharmaShare)],
      ...(sc && sp ? [['Coffee + pharmacy share', (r) => r.bothShare, (r) => '<b>' + fmtPct(r.bothShare) + '</b>']] : []), ['Of slot\'s late', (r) => r.causedShare, (r) => (r.slotLate ? fmtPct(r.causedShare) : '<span class="muted">–</span>')],
    ], C.slots) : '<p class="muted">No coffee or pharmacy orders on this date.</p>');
    CUR_A = A;
    const byLate = (a, b) => (b.r.lateMin || 0) - (a.r.lateMin || 0);
    const lateC = C.rows.filter((x) => x.r.late && x.r.coffee).sort(byLate), lateP = C.rows.filter((x) => x.r.late && x.r.pharma).sort(byLate);
    h += '<div class="note">' + LIFECYCLE_NOTE + ' The <b>Coffee / pharmacy</b> column shows ' + (sc ? 'the coffee time in the FP and awaiting pickup (rec. = recorded live, est. = estimated)' : '') + (sc && sp ? ', or ' : '') + (sp ? 'the pharmacy\'s extra time' : '') + ', and the verdict.' + (sc && sp ? ' An order with both coffee and pharmacy appears in both tables.' : '') + '</div>';
    h += card('Late coffee orders · ' + lateC.length, '', lifecycleTable(lateC.map((x) => x.r), { reason: true }));
    h += card('Late pharmacy orders · ' + lateP.length, '', lifecycleTable(lateP.map((x) => x.r), { reason: true }));
    if (sc && !C.coffee.recorded && C.coffee.orders) h += '<div class="note">Coffee times are estimated for this date. ' + (CP_SCRIPT !== 'da' ? 'Keep the Control Room open during the shift: the brain then records when each picker finishes and when the coffee is ready, and the coffee verdict becomes exact.' : 'The Picker Day Analyzer records exact coffee times while the Control Room is open; this page uses the estimate.') + '</div>';
    return h;
  };
  /* ------------------------------------------------------------------
   * ACCOUNTABILITY – whose late order was it?
   * Rule both teams work to: an order packed with less time left before its ETA than the DA needs to reach
   * it (the usual ride to its sub-area, or a fixed number – see Settings), or after the ETA, is the store's
   * (inventory lead). Packed with more time than that and still late is dispatch's (coordinator).
   * Orders held up by the coffee or the pharmacy belong to neither.
   * ------------------------------------------------------------------ */
  const OWN_STORE = 'FP (packaging lead)', OWN_DISPATCH = 'Logistics (coordinator)', OWN_CP = 'Coffee / pharmacy', OWN_BASKET = 'Large basket (ETA too short)', OWN_UNCLEAR = 'Unclear';
  const OWNERS = [OWN_STORE, OWN_DISPATCH, OWN_CP, OWN_BASKET, OWN_UNCLEAR];
  const OWNER_COLORS = { [OWN_STORE]: '#DB3738', [OWN_DISPATCH]: '#EDC246', [OWN_CP]: '#00A9A1', [OWN_BASKET]: '#C33F91', [OWN_UNCLEAR]: '#AC9C93' };
  function ownerOf(r) {
    if (r.cpVerdict && CP_NOT_FP.includes(r.cpVerdict)) return OWN_CP;
    if (r.bigBasket) return OWN_BASKET;   // FP Brain v1.25: the ETA was shorter than the basket needs (score.js markLateChecks)
    if (r.heldFor) return OWN_STORE;      // the DA waited for another order of its trip that the FP packed later
    if (IN_STORE.includes(r.cause)) return OWN_STORE;
    if (r.cause === 'Awaiting pickup' || r.cause === 'Ride') return OWN_DISPATCH;
    return OWN_UNCLEAR;
  }
  // Where each order sat in its DA's trip: how many drops the DA made before reaching it, and roughly how much
  // longer its road time was than a direct single-drop ride to the same sub-area.
  function tripContext(A) {
    if (A._tripCtx) return;
    A._tripCtx = true;
    const rows = A.rows.filter((r) => !r.subOrder && r.delivered && r.completed != null);
    const singles = [];
    groupBy(rows.filter((r) => r.tripId), (r) => String(r.tripId)).forEach((g) => {
      g.sort((a, b) => a.completed - b.completed);
      g.forEach((r, i) => {
        r.tripSize = g.length; r.dropNo = i + 1; r.dropsBefore = i;
        r.before = g.slice(0, i).map((x) => ({ t: x.completed, area: x.subArea, num: x.orderNumber }));
      });
      if (g.length === 1 && g[0].legMin != null) singles.push(g[0]);
    });
    rows.filter((r) => !r.tripId).forEach((r) => { r.tripSize = 1; r.dropNo = 1; r.dropsBefore = 0; r.before = []; if (r.legMin != null) singles.push(r); });
    const allDirect = median(singles.map((r) => r.legMin));
    const byArea = {};
    groupBy(singles, (r) => r.subArea).forEach((g, k) => { if (g.length >= 3) byArea[k] = median(g.map((r) => r.legMin)); });
    rows.forEach((r) => {
      if (r.directLeg == null) r.directLeg = byArea[r.subArea] != null ? byArea[r.subArea] : allDirect;
      r.tripExtra = r.dropsBefore && r.legMin != null && r.directLeg != null ? Math.max(0, r.legMin - r.directLeg) : null;
    });
  }
  const tripCell = (r) => {
    if (!r.tripSize) return '<span class="muted">–</span>';
    if (r.tripSize === 1) return '<span class="muted">single drop</span>';
    const tip = '<b>Trip of ' + r.tripSize + '</b><br>' + (r.before.length ? r.before.map((b, i) => 'Drop ' + (i + 1) + ': ' + fmtTime(b.t) + ' · ' + esc(b.area)).join('<br>') + '<br>' : '') + 'This order: drop ' + r.dropNo + ' at ' + fmtTime(r.completed) + ' · ' + esc(r.subArea);
    return '<span data-tip="' + esc(tip) + '" style="cursor:help">' + (r.dropsBefore ? '<b>' + r.dropsBefore + ' before it</b>' : 'first drop') + ' <span class="muted">(' + r.dropNo + ' of ' + r.tripSize + ')</span></span>';
  };
  const extraCell = (r) => (r.tripExtra != null ? (r.tripExtra >= 5 ? '<span class="pill warn">+' + Math.round(r.tripExtra) + '</span>' : '+' + Math.round(r.tripExtra)) : '<span class="muted">–</span>');
  function ownerDetail(r) {
    const o = ownerOf(r);
    if (o === OWN_CP) return r.cpVerdict === 'Pharmacy' ? 'Held up by the pharmacy' : 'Held up by the coffee';
    if (o === OWN_BASKET) return r.skus + ' SKUs: ETA ' + Math.round(r.bigWin) + ' min, needs about ' + Math.round(r.bigNeed) + ' (usual pick + pickup + ride)';
    if (r.heldFor) return 'Packed in time, DA waited for ' + r.heldFor + ' (same trip, packed later)';
    if (o === OWN_STORE) return r.cause === 'Packed after deadline' ? 'Packed after the ETA' + (r.storeLate === 'Waited for a picker' ? ' (waited for a picker)' : r.storeLate === 'Slow picking' ? ' (slow picking)' : '') : 'Packed with ' + Math.max(0, Math.round(r.bufferAtPackMin || 0)) + ' min left, needed ~' + Math.round(handoffOf(r)) + (r.storeLate === 'Waited for a picker' ? ' (waited for a picker)' : r.storeLate === 'Slow picking' ? ' (slow picking)' : '');
    if (o === OWN_DISPATCH) return r.cause === 'Awaiting pickup' ? 'Packed in time, waited for pickup' + (r.dropsBefore ? ' (then drop ' + r.dropNo + ' of ' + r.tripSize + ')' : '') : r.dropsBefore ? 'Packed in time, ' + r.dropsBefore + (r.dropsBefore === 1 ? ' drop' : ' drops') + ' before it in the trip' : 'Packed in time, slow on the ride';
    return 'No packing or pickup time recorded';
  }
  // ETA late = a NOW order delivered after its ETA (as the official scorecard; in the FP Brain a scheduled order's late is null).
  function accountability(A) {
    tripContext(A);
    const late = A.rows.filter((r) => !r.subOrder && r.late).sort((a, b) => (b.lateMin || 0) - (a.lateMin || 0));
    const counts = {}; OWNERS.forEach((o) => { counts[o] = late.filter((r) => ownerOf(r) === o).length; });
    const split = (g) => { const c = {}; OWNERS.forEach((o) => { c[o] = g.filter((r) => ownerOf(r) === o).length; }); return c; };
    const slots = [];
    for (let h = 0; h < 24; h++) { const g = late.filter((r) => r.slot === h); if (g.length) slots.push(Object.assign({ h, label: slotLabel(h), late: g.length }, split(g))); }
    const shifts = CFG.SHIFTS.map((s) => { const g = late.filter((r) => r.shift === s.name); return Object.assign({ name: s.name, range: hourLabel(s.from) + ' – ' + hourLabel(s.to % 24), late: g.length }, split(g)); }).filter((s) => s.late);
    const store = late.filter((r) => ownerOf(r) === OWN_STORE), dispatch = late.filter((r) => ownerOf(r) === OWN_DISPATCH);
    const byPicker = countBy(store.filter((r) => r.pickerName), (r) => r.pickerName);
    const byDa = countBy(dispatch.filter((r) => r.daName), (r) => r.daName);
    const roadLate = dispatch.filter((r) => r.cause === 'Ride');
    return { late, counts, slots, shifts, store, dispatch, cp: late.filter((r) => ownerOf(r) === OWN_CP), basket: late.filter((r) => ownerOf(r) === OWN_BASKET), byPicker, byDa, roadLate, roadMulti: roadLate.filter((r) => r.dropsBefore > 0) };
  }
  // coffee or pharmacy switched on in Settings (both off = an FP without either: no coffee / pharmacy owner shown)
  function cpAnyOn() { return CFG.SHOW_COFFEE !== false || CFG.SHOW_PHARMACY !== false; }
  function ownerBar(counts, total) {
    if (!total) return '<p class="muted">No late orders.</p>';
    const items = OWNERS.filter((o) => counts[o]);
    return '<div class="causebar" style="height:22px">' + items.map((o) => '<span data-tip="' + esc(o + ': ' + counts[o] + ' (' + Math.round((100 * counts[o]) / total) + '%)') + '" style="width:' + (100 * counts[o]) / total + '%;background:' + OWNER_COLORS[o] + '"></span>').join('') + '</div>' +
      '<div class="legend">' + items.map((o) => '<span><i style="background:' + OWNER_COLORS[o] + '"></i>' + o + ': <b>' + counts[o] + '</b> (' + Math.round((100 * counts[o]) / total) + '%)</span>').join('') + '</div>';
  }
  const leftPill = (m, need) => (m == null ? '<span class="muted">–</span>' : '<span class="pill ' + (m < 0 ? 'bad' : m < (need != null ? need : CFG.HANDOFF_MIN) ? 'warn' : 'good') + '">' + (Math.round(m) < 0 ? '−' + Math.round(-m) : Math.max(0, Math.round(m))) + '</span>' + (need != null ? '<br><span class="muted">needed ' + Math.round(need) + '</span>' : ''));


  // One table structure for every late order, whoever owns it: the whole life of the order from creation to delivery.
  const stageCell = (min, t, bad) => (min == null && t == null ? '<span class="muted">–</span>' : (min != null ? (bad ? '<b style="color:var(--bad)">' + fmt(min, 0) + '</b>' : fmt(min, 0)) : '<span class="muted">–</span>') + (t != null ? '<br><span class="muted">' + fmtTime(t) + '</span>' : ''));
  function cpCell(r0) {
    const x = r0.cpRow;
    // only what this FP has (Settings: coffee / pharmacy switches)
    const r = { coffee: r0.coffee && CFG.SHOW_COFFEE !== false, pharma: r0.pharma && CFG.SHOW_PHARMACY !== false, cpVerdict: r0.cpVerdict };
    if (!r.coffee && !r.pharma) return '<span class="muted">–</span>';
    const type = r.coffee && r.pharma ? 'Coffee + pharmacy' : r.coffee ? (x && x.coffeeOnly ? 'Coffee only' : 'Coffee') : (x && x.pharmOnly ? 'Pharmacy only' : 'Pharmacy');
    const bits = [];
    if (x && r.coffee && x.coffeeWait != null) bits.push('FP +' + fmt(x.coffeeWait, 0) + (x.coffeeSrc === 'recorded' ? ' (rec.)' : x.coffeeSrc === 'estimated' ? ' (est.)' : ''));
    if (x && r.coffee && x.coffeeShelf != null) bits.push('awaiting pickup +' + fmt(x.coffeeShelf, 0) + (x.shelfSrc === 'recorded' ? ' (rec.)' : ''));
    if (x && r.pharma && x.pharmExtra != null) bits.push('pharmacy ' + (x.pharmExtra >= 0 ? '+' : '') + fmt(x.pharmExtra, 0) + ' min');
    return '<b>' + type + '</b>' + (bits.length ? '<br><span class="muted">' + bits.join(' · ') + '</span>' : '') + (r.cpVerdict ? '<br><span class="st-dot" style="background:' + (CP_COLORS[r.cpVerdict] || '#AC9C93') + '"></span>' + esc(r.cpVerdict) : '') + (x && x.note ? '<br><span class="muted">' + esc(x.note) + '</span>' : '');
  }
  // opts: { basketFirst: SKUs and bags lead the table (Basket size page), allowOnTime: on-time orders shown too, reason: late reason column at the end }
  const resultCell = (r) => (r.late ? '<b>' + fmt(r.lateMin, 0) + '</b> min late' : r.delivered && r.deadline != null && r.completed != null ? '<span class="pill good">on time</span><br><span class="muted">' + Math.max(0, Math.round((r.deadline - r.completed) / MIN)) + ' min early</span>' : '<span class="muted">' + esc(r.status || '–') + '</span>');
  const reasonCell = (r) => {
    if (!r.late) return '<span class="muted">–</span>';
    const k = typeof whyLate === 'function' ? whyLate(r) : lateReason(r);
    const need = handoffOf(r);
    const why = r.cause === 'Packed too late' ? 'packed with ' + Math.max(0, Math.round(r.bufferAtPackMin)) + ' min left, ride needs ~' + Math.round(need)
      : r.cause === 'Awaiting pickup' ? 'picked up with ' + Math.max(0, Math.round((r.deadline - r.pickedUp) / MIN)) + ' min left, ride needs ~' + Math.round(need)
      : r.cause === 'Packed after deadline' ? 'packed ' + Math.round(-r.bufferAtPackMin) + ' min after the ETA'
      : r.cause === 'Ride' ? 'left with ' + Math.round((r.deadline - r.pickedUp) / MIN) + ' min left, ride took ' + fmt(r.legMin, 0) + (r.directLeg != null ? ' (usual ' + fmt(r.directLeg, 0) + ')' : '') : '';
    return '<span class="reason"><span class="st-dot" style="background:' + (REASON_COLORS[k] || '#AC9C93') + '"></span><b>' + esc(k) + '</b></span>' + (why ? '<br><span class="muted">' + why + '</span>' : '');
  };
  function lifecycleTable(rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<p class="muted">None.</p>';
    if (CUR_A) tripContext(CUR_A);
    const slowShelf = CFG.ALERT_SHELF_MIN || 10, total = (r) => r.deliveryMin;
    const basket = [
      ['SKUs', (r) => r.skus, (r) => '<b>' + (r.skus != null ? r.skus : '–') + '</b>'],
      ['Bags', (r) => r.bags, (r) => (r.bags != null ? r.bags : '–')],
    ];
    const cols = [
      ['Order', (r) => r.orderNumber, (r) => '<b>' + esc(r.orderNumber) + '</b><br><span class="muted">' + esc(r.model || '') + ' · ' + esc(slotLabel(r.slot)) + '</span>', 'l'],
      opts.allowOnTime ? ['Result', (r) => (r.late ? r.lateMin : -1), resultCell] : ['Late by', (r) => r.lateMin, (r) => '<b>' + fmt(r.lateMin, 0) + '</b> min'],
      ['Created', (r) => r.placed, (r) => fmtTime(r.placed) + (r.deadline != null ? '<br><span class="muted">ETA ' + fmtTime(r.deadline) + '</span>' : '')],
      ['Wait for picker', (r) => r.waitMin, (r) => stageCell(r.waitMin, r.start, r.waitMin != null && r.waitMin >= (CFG.WAIT_TARGET_MIN || 5))],
      ['Picking', (r) => r.handleMin, (r) => stageCell(r.handleMin, r.packed, r.handleMin != null && r.handleMin >= (CFG.HANDLE_TARGET_MIN || 6) * 2)],
    ];
    if (opts.basketFirst) cols.push(['Sec per SKU', (r) => r.secPerSku, (r) => (r.secPerSku != null ? fmt(r.secPerSku, 0) : '<span class="muted">–</span>')]);
    cols.push(
      ['Left at packing', (r) => r.bufferAtPackMin, (r) => leftPill(r.bufferAtPackMin, handoffOf(r))],
      ['Awaiting pickup', (r) => r.shelfMin, (r) => stageCell(r.shelfMin, r.pickedUp, r.shelfMin != null && r.shelfMin >= slowShelf)],
      ['Ride', (r) => r.legMin, (r) => stageCell(r.legMin, r.completed, r.tripExtra != null && r.tripExtra >= 5)],
      ['Total', (r) => total(r), (r) => '<b>' + fmt(total(r), 0) + '</b>'],
      ['Trip', (r) => r.dropsBefore, (r) => tripCell(r) + (r.tripExtra != null ? '<br><span class="muted">extra ride </span>' + extraCell(r) : ''), 'l'],
    );
    if (!opts.basketFirst) cols.push(['SKUs / bags', (r) => r.skus, (r) => (r.skus != null ? r.skus : '–') + ' <span class="muted">/ ' + (r.bags != null ? r.bags : '–') + '</span>']);
    cols.push(
      ['Picker', (r) => r.pickerName || '', (r) => esc(r.pickerName || '–'), 'l'],
      ['DA', (r) => r.daName || '', (r) => esc(r.daName || '–') + (r.assign || r.assignType ? '<br><span class="muted">' + esc(r.assign ? r.assign.cat : r.assignType) + (r.assign && r.assign.by ? ' by ' + esc(r.assign.by) : '') + '</span>' : ''), 'l'],
      ['Sub-area', (r) => r.subArea, null, 'l'],
      ['Coffee / pharmacy', (r) => (r.coffee ? 2 : 0) + (r.pharma ? 1 : 0), cpCell, 'l'],
      ['Owner', (r) => (r.late ? ownerOf(r) : ''), (r) => (r.late ? '<span class="st-dot" style="background:' + OWNER_COLORS[ownerOf(r)] + '"></span>' + esc(ownerOf(r)) : '<span class="muted">–</span>'), 'l'],
      ['What happened', (r) => (r.late ? ownerDetail(r) : ''), (r) => (r.late ? esc(ownerDetail(r)) : '<span class="muted">–</span>'), 'l'],
    );
    if (opts.reason) cols.push(['Late reason', (r) => (r.late ? (typeof whyLate === 'function' ? whyLate(r) : lateReason(r)) : ''), reasonCell, 'l']);
    return table(opts.basketFirst ? basket.concat(cols) : cols, rows);
  }
  let CUR_A = null;   // the day being shown, so trip context can be worked out
  const LIFECYCLE_NOTE = { toString: () => 'Every column is one stage of the order\'s life, minutes on top and the clock time it ended underneath: <b>wait for picker</b> (created or ready → a picker started), <b>picking</b> (→ packed), <b>awaiting pickup</b> (packed → DA picked it up), <b>ride</b> (→ delivered). Red minutes = that stage was slow (wait ' + (CFG.WAIT_TARGET_MIN || 5) + '+, picking twice the ' + (CFG.HANDLE_TARGET_MIN || 6) + ' min target, awaiting pickup ' + (CFG.ALERT_SHELF_MIN || 10) + '+, ride 5+ min longer than a direct ride). <b>Left at packing</b>: minutes left before the ETA when it was packed; red = after the ETA, amber = less than the ride needs (' + handoffTxt() + ', shown underneath). <b>Trip</b>: drops the DA made before this order (hover for times). Picking times are estimated unless the Control Room was open while it happened.' };

  KPI_VIEWS.accountability = function (A) {
    CUR_A = A;
    const X = accountability(A);
    const total = X.late.length;
    let h = '<div class="note">ETA late % judges NOW orders, as the official scorecard: every NOW order delivered after its ETA counts. Forced orders are only in the last section, <b>ETA late % incl. forced</b>.</div>';
    h += '<div class="note"><b>The rule:</b> an order packed with less time left before its ETA than <b>' + handoffTxt() + '</b> (or after the ETA) is the <b>FP\'s</b>, so the packaging lead owns it. Packed with more time than that and still late is <b>logistics\'</b>, so the coordinator owns it: it waited for pickup or was slow on the ride. Two exceptions: packed in time but its DA waited for another order of the same trip that the FP packed later = <b>FP</b> (held for another order); ' + CFG.LARGE_BASKET_SKUS + '+ SKUs with an ETA shorter than the usual picking time for its size + pickup + ride = <b>Large basket</b>, neither team\'s.' + (cpAnyOn() ? ' Orders held up by the ' + (CFG.SHOW_COFFEE === false ? 'pharmacy' : CFG.SHOW_PHARMACY === false ? 'coffee' : 'coffee or the pharmacy') + ' belong to neither.' : '') + ' Change the rule in ⚙ Settings only if both teams agree.</div>';
    if (typeof handoffAreasCard === 'function') h += handoffAreasCard(A);   // FP Brain: the per-sub-area thresholds (was the Late causes page)
    h += '<div class="kpis">' + OWNERS.filter((o) => (o !== OWN_CP || cpAnyOn()) && (o !== OWN_BASKET || X.counts[o])).map((o) => '<div class="kpi"><div class="k">' + o + '</div><div class="v" style="color:' + OWNER_COLORS[o] + ' !important">' + X.counts[o] + '</div><div class="s">' + (total ? Math.round((100 * X.counts[o]) / total) + '% of ' + total + ' late orders' : 'no late orders') + '</div></div>').join('') + '</div>';
    h += card('Who owns the late orders', '', ownerBar(X.counts, total));
    if (typeof etaWhatIfCard === 'function' && typeof CP_SCRIPT !== 'undefined' && CP_SCRIPT === 'brain') h += etaWhatIfCard(A);   // FP Brain: end-of-day calculator
    h += '<div class="grid two">';
    h += card('By shift', 'So the lead and coordinator on each shift can see their own share.', X.shifts.length ? table([
      ['Shift', (r) => r.name, (r) => '<b>' + esc(r.name) + '</b><br><span class="mini muted">' + esc(r.range) + '</span>', 'l'], ['Late', (r) => r.late],
      ['FP', (r) => r[OWN_STORE]], ['Logistics', (r) => r[OWN_DISPATCH]], ['Coffee / pharmacy', (r) => r[OWN_CP]], ['Large basket', (r) => r[OWN_BASKET]], ['Unclear', (r) => r[OWN_UNCLEAR]],
    ].filter((c) => (c[0] !== 'Large basket' || X.basket.length) && (c[0] !== 'Unclear' || X.counts[OWN_UNCLEAR])), X.shifts) : '<p class="muted">No late orders.</p>');
    h += card('By timeslot', '', X.slots.length ? table([
      ['Timeslot', (r) => r.h, (r) => esc(r.label), 'l'], ['Late', (r) => r.late], ['FP', (r) => r[OWN_STORE]], ['Logistics', (r) => r[OWN_DISPATCH]], ['Coffee / pharmacy', (r) => r[OWN_CP]], ['Large basket', (r) => r[OWN_BASKET]],
    ].filter((c) => c[0] !== 'Large basket' || X.basket.length), X.slots) : '<p class="muted">No late orders.</p>');
    h += '</div>';
    h += '<div class="note">' + LIFECYCLE_NOTE + '</div>';
    h += card('FP (packaging lead): packed late · ' + X.store.length, 'Packed after the ETA, or with less time left than ' + handoffTxt() + ', or packed in time while its DA waited for another order of the same trip that the FP packed later.' + (X.byPicker.length ? ' Most by picker: ' + X.byPicker.slice(0, 4).map(([k, n]) => esc(k) + ' ' + n).join(', ') + '.' : ''), lifecycleTable(X.store));
    h += card('Logistics (coordinator): late after packing · ' + X.dispatch.length, 'Packed with more time left than ' + handoffTxt() + ' and still late.' + (X.roadLate.length ? ' <b>' + X.roadMulti.length + ' of ' + X.roadLate.length + '</b> orders late on the ride had at least one drop before them.' : '') + (X.byDa.length ? ' Most by DA: ' + X.byDa.slice(0, 4).map(([k, n]) => esc(k) + ' ' + n).join(', ') + '.' : ''), lifecycleTable(X.dispatch));
    { const sc = CFG.SHOW_COFFEE !== false, sp = CFG.SHOW_PHARMACY !== false;
      if (sc || sp) h += card((sc && sp ? 'Coffee / pharmacy: held up by the barista or the pharmacy' : sc ? 'Coffee: held up by the barista' : 'Pharmacy: held up by the pharmacy') + ' · ' + X.cp.length, 'A long <b>awaiting pickup</b> time on these orders usually means ' + (sc ? 'the DA was waiting for the barista' : '') + (sc && sp ? ', or ' : '') + (sp ? 'the order waited while the DA went to the pharmacy for the rest of it' : '') + '. Full analysis on Day Analysis → ' + (sc && sp ? 'Coffee & pharmacy' : sc ? 'Coffee' : 'Pharmacy') + '.', lifecycleTable(X.cp)); }
    if (X.basket.length) h += card('Large basket (ETA too short) · ' + X.basket.length, CFG.LARGE_BASKET_SKUS + '+ SKUs, and the ETA was shorter than the usual picking time for that size + ' + (CFG.HANDOFF_BUFFER_MIN || 0) + ' min pickup + the usual ride to its sub-area: it could not be on time, so neither the FP nor logistics owns it. Send these to the ETA / product team.', lifecycleTable(X.basket, { basketFirst: true, reason: true }));
    const unclear = X.late.filter((r) => ownerOf(r) === OWN_UNCLEAR);
    if (unclear.length) h += card('Unclear · ' + unclear.length, 'No packing or pickup time was recorded, so the brain can\'t say where the time went.', lifecycleTable(unclear));
    if (A.score && A.score.pool) h += etaInclForced(A);
    return h;
  };
  // The one place forced orders count for lateness: NOW + forced orders, by the day placed (a forced order's ETA is its slot end)
  function etaInclForced(A) {
    const S = A.score, PP = S.pool;
    const lateF = PP.lateF.filter((r) => r.scheduled).sort((a, b) => (b.lateMinAny || 0) - (a.lateMinAny || 0));
    const fJudged = PP.judged.filter((r) => r.scheduled).length;
    let b = '<div class="kpis">' +
      kpi('ETA late % incl. forced', fmtPct(PP.etaF), '', PP.lateF.length + ' of ' + PP.judged.length + ' NOW and forced orders delivered after their ETA', kpiStatus(kpiDef('eta'), PP.etaF)) +
      kpi('ETA late % (the KPI)', fmtPct(S.v.eta), '', 'NOW orders only, this day\'s slots', kpiStatus(kpiDef('eta'), S.v.eta)) +
      kpi('Forced orders late', lateF.length, '', 'of ' + fJudged + ' forced delivered (' + fmtPct(rate(lateF.length, fJudged)) + '), after the end of their slot', null) + '</div>';
    b += lateF.length ? table([
      ['Order', (r) => r.orderNumber, (r) => '<b>' + esc(r.orderNumber) + '</b>', 'l'], ['Placed', (r) => r.placed, (r) => fmtTime(r.placed)], ['Slot', (r) => r.slot, (r) => esc(slotLabel(r.slot)), 'l'],
      ['Why forced', (r) => r.forcedSrc || '', (r) => esc(forcedSrcTxt(r.forcedSrc)), 'l'], ['Min late', (r) => r.lateMinAny, (r) => fmt(r.lateMinAny, 0)], ['Placed → delivered', (r) => r.deliveryMin, (r) => fmt(r.deliveryMin, 0)],
      ['Cause', (r) => r.causeAny || '', null, 'l'], ['DA', (r) => r.daName || '', (r) => esc(r.daName || '–'), 'l'], ['Sub-area', (r) => r.subArea, null, 'l'],
    ], lateF) : '<p class="muted">No forced order arrived after the end of its slot.</p>';
    return card('ETA late % incl. forced', 'NOW orders plus forced orders, by the day placed (as P90 incl. forced). For reference only: the KPI everywhere else is NOW orders.' + (PP.state === 'today' ? ' Orders placed today for tomorrow join once delivered.' : ''), b);
  }
  function bindAcc(main) {
    main.querySelectorAll('.seg[data-acc] button').forEach((b) => b.addEventListener('click', () => { KPI_VIEWS._acc = b.dataset.v; UI.render(); }));
  }

  const BRAIN_CSS = `
  ul.rcl { margin: 0; padding-left: 22px; } ul.rcl li { margin: 8px 0; font-size: 15px; line-height: 1.6; color: var(--ink) !important; }
  .fab { background: #13263f !important; }
  .fab .lbl b { font-weight: 700; }
  .fab .badge { background: #d4352e; color: #fff !important; border-radius: 999px; padding: 0 7px; font-size: 12px; font-weight: 700; margin-left: 2px; }
  header .chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .chip { font-size: 12.5px; font-weight: 650; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,.14); color: #fff !important; white-space: nowrap; }
  .chip.good { background: #1e7a3e; } .chip.warn { background: #9a6400; } .chip.bad { background: #b52a24; }
  .sc { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
  .sc .kpi { background: var(--paper); border-left: 0 !important; }
  .sc .kpi.click { cursor: pointer; } .sc .kpi.click:hover { background: var(--paper-2); }
  .sc .kpi .v { font-size: 30px; }
  @media (max-width: 1250px) { .sc { grid-template-columns: repeat(3, 1fr); } }
  .dx { border-left: 5px solid var(--rule-strong); }
  .dx.good { border-left-color: var(--good-rule); } .dx.warn { border-left-color: var(--warn-rule); } .dx.bad { border-left-color: var(--bad-rule); }
  .dx h3 { font-size: 13px; margin: 12px 0 4px; color: var(--ink-2) !important; font-weight: 650; }
  .dx ul { margin: 0 0 6px; padding-left: 20px; } .dx li { margin: 4px 0; color: var(--ink) !important; }
  .dxhead { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .dxhead h2 { margin: 0 !important; }
  .dm { background: #f3f6fb; border: 1px dashed var(--rule-strong); border-radius: 8px; padding: 10px 12px; display: flex; gap: 12px; align-items: flex-start; margin-top: 10px; }
  .dm p { margin: 0; flex: 1; font-weight: 600; color: var(--ink) !important; }
  .dm small { display: block; color: var(--ink-3) !important; font-weight: 500; margin-top: 3px; }
  .ghost.sm { padding: 4px 10px; font-size: 12.5px; }
  .ghost.on { background: var(--navy); color: #fff !important; border-color: var(--navy); }
  .alert { background: var(--paper); border: 1px solid var(--rule); border-left: 5px solid var(--accent); border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; }
  .alert.bad { border-left-color: var(--bad-rule); background: #fff7f6; } .alert.warn { border-left-color: var(--warn-rule); background: #fffaf0; }
  .alert h3 { margin: 0 0 3px; font-size: 15px; color: var(--ink) !important; font-weight: 650; }
  .alert p { margin: 2px 0; color: var(--ink-2) !important; font-size: 13.5px; }
  .alert p.act { color: var(--ink) !important; font-weight: 600; }
  .alert .go { float: right; }
  .okmsg { background: var(--good-bg); color: var(--good) !important; border-radius: 10px; padding: 14px 16px; font-weight: 650; margin-bottom: 14px; }
  input.txt, select.sel, textarea.txt { font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid var(--rule-strong); border-radius: 6px; background: #fff; color: var(--ink) !important; width: 100%; }
  textarea.txt { min-height: 54px; resize: vertical; }
  input.txt:focus, select.sel:focus, textarea.txt:focus { outline: 2px solid #8fb8ee; border-color: var(--accent); }
  input.num { width: 90px; }
  .lrow { display: grid; grid-template-columns: 150px 80px minmax(180px, 230px) 1fr 1fr 74px; gap: 8px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--rule); }
  .lrow:last-child { border-bottom: 0; }
  .lrow .k { font-weight: 650; color: var(--ink) !important; padding-top: 6px; }
  .lrow .val { padding-top: 6px; }
  .lhead { font-size: 12px; font-weight: 650; color: var(--ink-3) !important; }
  @media (max-width: 1100px) { .lrow { grid-template-columns: 1fr 1fr; } }
  .saved { color: var(--good) !important; font-size: 12px; font-weight: 650; }
  .guess { background: #fbfcfe; border: 1px solid var(--rule); border-radius: 8px; padding: 10px 12px; margin-top: 8px; }
  .guess p { margin: 0 0 6px; color: var(--ink-2) !important; font-size: 13px; }
  .guess .row { display: flex; gap: 8px; align-items: flex-start; }
  .guess .mine { margin: 0 0 8px; color: var(--ink) !important; font-size: 13.5px; }
  .sharebar { display: inline-block; width: 60px; height: 8px; background: var(--rule); border-radius: 4px; margin-right: 8px; vertical-align: 0; overflow: hidden; }
  .sharebar i { display: block; height: 100%; background: #e0703a; }
  .map.gm canvas, .map.gm .mapctl, .map.gm .maplegend, .map.gm .attr, .map.gm .tilewarn { display: none !important; }
  .rbar { display: flex; height: 16px; border-radius: 4px; overflow: hidden; gap: 2px; margin: 8px 0 10px; }
  .rbar span { display: block; height: 100%; }
  .src td.l { white-space: normal; }
  .mini { font-size: 12px; color: var(--ink-3) !important; }
  .calib td.hl { background: var(--accent-soft) !important; font-weight: 700; }
  .bgpick { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
  .bgpick select { width: auto; }
  .tilewarn { max-width: 80%; text-align: left; line-height: 1.45; }
  a.dalink { color: var(--accent) !important; text-decoration: none; font-weight: 650; } a.dalink:hover { text-decoration: underline; }
  .bfmsg { margin: -4px 0 12px; font-size: 13px; }
  .pill.na { background: #eef0f3; color: var(--ink-3) !important; }
  .setrow { display: grid; grid-template-columns: minmax(260px, 1.4fr) 220px 1fr; gap: 12px; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--rule); }
  .setrow:last-child { border-bottom: 0; }
  .setrow.chg b { color: var(--accent) !important; }
  .setrow input.num { width: 110px; } .setrow select.sel { width: 210px; }
  .setbar { position: sticky; top: 0; z-index: 3; background: var(--canvas); padding: 8px 0 12px; display: flex; gap: 8px; align-items: center; }
  table.shed input.txt { width: 100%; min-width: 120px; } table.shed input.num { width: 80px; }
  .btn.gear { font-size: 15px; padding-left: 10px; padding-right: 10px; }
  .reason { white-space: nowrap; }
  table.roster input.num { width: 72px; } table.roster select.sel { width: auto; min-width: 110px; } table.roster td { vertical-align: top; } table.roster tr.ex td { opacity: .55; }
  table.roster .rday { margin-top: 6px; }
  aside button.advtoggle { margin: 16px 8px 8px; width: calc(100% - 16px); font-size: 12px; text-align: center; border: 1px dashed var(--aside-grp); border-radius: 8px; opacity: .85; }
  aside button.adv { font-style: italic; }
  aside .sec { padding-bottom: 6px; }
  aside .sec + .sec { border-top: 1px solid var(--aside-line); margin-top: 4px; padding-top: 4px; }
  aside button.grp { display: flex; align-items: center; gap: 6px; padding: 10px 10px 6px; font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--aside-grp) !important; background: none; border-radius: 6px; cursor: pointer; }
  aside button.grp:hover { background: var(--aside-hover); }
  aside button.grp .car { width: 12px; font-size: 10px; opacity: .8; }
  aside button.grp .gl { flex: 1; }
  aside button.grp .cnt { font-size: 10px; font-weight: 700; letter-spacing: 0; padding: 0 6px; border-radius: 8px; background: var(--aside-hover); opacity: .9; }
  aside .sec:first-child button.grp { padding-top: 2px; }
  [dir=rtl] aside button.grp { text-transform: none; letter-spacing: 0; font-size: 12px; }
  .navtgl { font-size: 16px; line-height: 1; padding: 6px 10px; }
  .navhidden aside { display: none; }
  @media (max-width: 900px) { aside .sec { display: contents; } aside button.grp { display: none; } }
  .catchips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 12px; }
  .catchips button.on, .cmpval button.on { background: var(--accent-soft); color: var(--accent) !important; border-color: var(--accent); }
  .cmpl .cmph, .cmpl summary, .cmpd, .cmpval { box-sizing: border-box; }
  .cmpl { overflow-x: auto; border: 1px solid var(--rule); border-radius: 10px; }
  .cmpl .cmph, .cmpl summary { display: grid; grid-template-columns: 112px 48px minmax(150px, 1.5fr) 104px minmax(84px, 1fr) minmax(92px, 1fr) 96px 60px minmax(100px, 1.2fr) 88px 44px; gap: 8px; align-items: center; min-width: 1080px; padding: 9px 12px; }
  .cmpl .cmph { font-size: 12px; font-weight: 650; color: var(--ink-3); border-bottom: 1px solid var(--rule); }
  .cmpl summary { cursor: pointer; list-style: none; font-size: 13px; border-bottom: 1px solid var(--rule); }
  .cmpl summary::-webkit-details-marker { display: none; }
  .cmpl summary:hover { background: var(--paper-2); }
  .cmpl details[open] > summary { background: var(--accent-soft); }
  .cmpl summary > span:last-child { text-align: right; }
  .cmpd { display: grid; grid-template-columns: repeat(3, minmax(240px, 1fr)); gap: 18px; padding: 14px 16px 6px; min-width: 1080px; }
  .cmpd h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); }
  .kv { display: grid; grid-template-columns: 120px 1fr; gap: 4px 10px; margin: 0 0 8px; font-size: 13px; }
  .kv dt { color: var(--ink-3); } .kv dd { margin: 0; }
  .tk { padding: 8px 10px; border: 1px solid var(--rule); border-radius: 8px; margin-bottom: 8px; }
  .tk .kv { margin: 6px 0 0; }
  .cmpval { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 6px 16px 14px; min-width: 1080px; border-bottom: 1px solid var(--rule); }
  .cmpval input { flex: 1; min-width: 220px; max-width: 520px; padding: 6px 10px; border-radius: 7px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); }
  .tkno { display: block; background: none; border: 0; padding: 0; font: inherit; font-size: 12px; color: var(--accent) !important; cursor: copy; text-align: left; font-variant-numeric: tabular-nums; }
  .cmpdiag > summary { cursor: pointer; padding: 2px 0; }
  .bkchart { display: flex; align-items: flex-end; gap: 3px; height: 150px; padding: 8px 0 22px; border-bottom: 1px solid var(--rule); margin-bottom: 12px; }
  .bkb { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; position: relative; min-width: 0; }
  .bkb i { display: block; width: 100%; background: var(--blue, #1393CD); border-radius: 3px 3px 0 0; }
  .bkb.lg i { background: #AA0382; }
  .bkb span { position: absolute; bottom: -18px; font-size: 10.5px; color: var(--ink-3) !important; white-space: nowrap; }
  .bkshare { display: flex; gap: 2px; border-radius: 8px; overflow: hidden; }
  .bkshare span { background: var(--paper-2); padding: 7px 8px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; color: var(--ink-2) !important; }
  .bkshare span.lg { background: rgba(170,3,130,.18); }
  .bkshare b { color: var(--ink) !important; }
  .bklegend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 10px; font-size: 12px; color: var(--ink-2) !important; }
  .bklegend > span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .bklegend > span > i { width: 9px; height: 9px; border-radius: 2px; background: var(--blue, #1393CD); display: inline-block; }
  .bklegend > span.lg > i { background: #AA0382; }
  .bklegend > span.zero { opacity: .55; }
  .bklegend b { color: var(--ink) !important; }
  .bkheat { display: inline-block; min-width: 28px; padding: 2px 6px; border-radius: 5px; color: var(--ink) !important; text-align: center; }
  input.bkexp { width: 64px; padding: 4px 6px; }
  .cmpempty { border: 1px dashed var(--accent); }
  details.more { margin-top: 4px; } details.more > summary { cursor: pointer; font-size: 12px; color: var(--accent) !important; list-style: none; display: inline-block; }
  details.more > summary::-webkit-details-marker { display: none; } details.more[open] > summary { margin-bottom: 4px; }
  .okv { font-variant-numeric: tabular-nums; }
  .tagchip { display: inline-block; padding: 1px 7px; margin: 1px 3px 1px 0; border-radius: 9px; font-size: 11px; background: var(--chip, rgba(127,127,127,.16)); white-space: nowrap; }
  .cmpbar { height: 6px; border-radius: 3px; background: rgba(127,127,127,.2); overflow: hidden; margin: 4px 0 6px; max-width: 420px; }
  .cmpbar i { display: block; height: 100%; background: #AA0382; }
  .setup ol { margin: 0; padding-left: 22px; } .setup li { margin: 12px 0; line-height: 1.55; } .setup .done { color: var(--good) !important; font-weight: 650; }
  .tabcheck td.gap-bad { color: var(--bad) !important; font-weight: 700; } .tabcheck td.gap-ok { color: var(--good) !important; font-weight: 700; } .tabcheck input.num { width: 90px; }
  `;

  /* Breadfast brand themes (Brand Guidelines 2024). The four approved high-contrast pairings from "Color in Type":
       Charcoal       – Charcoal Grey #343434 / Dark Grey #212322 with white and Warm Gray type (dark)
       Classic White  – Classic White #FFFFFF with Charcoal type, Royal Magenta accents (light)
       Warm Gray      – Warm Gray 1C #F0EFEB with Royal Magenta headings and Charcoal type (light, secondary palette)
       Royal Magenta  – Royal Magenta #AA0382 frame with white type, white working area
     Status colours come from the complementary palette (10%). Typeface: Faro (Lucky); Noto Sans for Arabic. */
  const THEMES = [
    { id: 'charcoal', name: 'Charcoal', sub: 'Dark: Charcoal Grey with white type', sw: ['#212322', '#343434', '#AA0382'] },
    { id: 'white', name: 'Classic White', sub: 'Light: white with Charcoal type', sw: ['#FFFFFF', '#343434', '#AA0382'] },
    { id: 'warm', name: 'Warm Gray', sub: 'Light: Warm Gray with magenta headings', sw: ['#F0EFEB', '#AA0382', '#383938'] },
    { id: 'magenta', name: 'Royal Magenta', sub: 'Magenta frame with white type', sw: ['#AA0382', '#FFFFFF', '#343434'] },
  ];
  const DARK_CSS = `
  .root {
    font-family: "Faro", "Lucky", "Noto Sans", "Noto Sans Arabic", "DM Sans", "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
    --magenta: #AA0382; --magenta-2: #85026A; --magenta-3: #C94FA8;
    --ontime: #1393CD; --late: #E16C6F;
  }
  /* ---------- Charcoal (dark) ---------- */
  .root, .root[data-theme="charcoal"] {
    color-scheme: only dark;
    --canvas: #212322; --paper: #343434; --paper-2: #3A3B3A; --rule: #474847; --rule-strong: #5C5D5C;
    --ink: #F0EFEB; --ink-2: #C8C9C7; --ink-3: #A3A4A2; --h-ink: #F0EFEB;
    --navy: #AA0382; --navy-2: #85026A; --accent: #D392C6; --accent-soft: rgba(170,3,130,.24); --on-accent: #FFFFFF;
    --muted-bar: #606160;
    --good: #7ECE9F; --good-bg: rgba(70,185,118,.17); --good-rule: #46B976;
    --warn: #FDDC6A; --warn-bg: rgba(237,194,70,.15); --warn-rule: #EDC246;
    --bad: #E16C6F; --bad-bg: rgba(225,108,111,.18); --bad-rule: #E16C6F;
    --pill-good-bg: rgba(70,185,118,.17); --pill-good: #7ECE9F; --pill-warn-bg: rgba(237,194,70,.15); --pill-warn: #FDDC6A; --pill-bad-bg: rgba(225,108,111,.20); --pill-bad: #F5D4D6;
    --hdr-bg: #212322; --hdr-fg: #FFFFFF; --hdr-fg-2: #C8C9C7; --hdr-line: #AA0382; --hdr-btn-line: rgba(240,239,235,.30); --hdr-btn-hover: rgba(240,239,235,.10);
    --hdr-primary-bg: #AA0382; --hdr-primary-fg: #FFFFFF; --hdr-primary-hover: #85026A; --chip-bg: rgba(240,239,235,.12);
    --aside-bg: #2A2B2A; --aside-line: #474847; --aside-fg: #C8C9C7; --aside-grp: #A3A4A2; --aside-hover: #343434; --aside-on-bg: rgba(170,3,130,.26); --aside-on-fg: #F6D3EA; --aside-on-bar: #AA0382;
    --row-alt: #383938; --row-hover: #44323F; --grid: #474847; --chart-text: #A3A4A2; --hover-fill: rgba(240,239,235,.06);
    --tip-bg: #121312; --tip-fg: #F0EFEB; --tip-line: #5C5D5C; --input-bg: #2A2B2A; --band: rgba(255,255,255,.035); --warn-band: rgba(237,194,70,.09);
    --na-bg: rgba(240,239,235,.10); --na-fg: #C8C9C7; --focus: #D392C6; --map-bg: #2A2B2A;
  }
  /* ---------- Classic White (light) ---------- */
  .root[data-theme="white"] {
    color-scheme: only light;
    --canvas: #F9F9F7; --paper: #FFFFFF; --paper-2: #F9F9F7; --rule: #E6E6E3; --rule-strong: #C8C9C7;
    --ink: #212322; --ink-2: #383938; --ink-3: #606160; --h-ink: #212322;
    --navy: #AA0382; --navy-2: #85026A; --accent: #AA0382; --accent-soft: #F6EAF3; --on-accent: #FFFFFF;
    --muted-bar: #C3C4C3;
    --good: #105C39; --good-bg: #E3F4EA; --good-rule: #46B976;
    --warn: #593826; --warn-bg: #FCF4D6; --warn-rule: #EDC246;
    --bad: #DB3738; --bad-bg: #FDF1E9; --bad-rule: #DB3738;
    --pill-good-bg: #B5E3C8; --pill-good: #105C39; --pill-warn-bg: #FDDC6A; --pill-warn: #593826; --pill-bad-bg: #DB3738; --pill-bad: #FFFFFF;
    --hdr-bg: #FFFFFF; --hdr-fg: #212322; --hdr-fg-2: #606160; --hdr-line: #AA0382; --hdr-btn-line: #C8C9C7; --hdr-btn-hover: #F6EAF3;
    --hdr-primary-bg: #AA0382; --hdr-primary-fg: #FFFFFF; --hdr-primary-hover: #85026A; --chip-bg: #F0EFEB;
    --aside-bg: #FFFFFF; --aside-line: #E6E6E3; --aside-fg: #383938; --aside-grp: #606160; --aside-hover: #F9F9F7; --aside-on-bg: #F6EAF3; --aside-on-fg: #AA0382; --aside-on-bar: #AA0382;
    --row-alt: #FBFBFA; --row-hover: #F6EAF3; --grid: #ECECE9; --chart-text: #606160; --hover-fill: rgba(170,3,130,.06);
    --tip-bg: #343434; --tip-fg: #FFFFFF; --tip-line: #343434; --input-bg: #FFFFFF; --band: rgba(56,57,56,.035); --warn-band: rgba(237,194,70,.14);
    --na-bg: #F0EFEB; --na-fg: #383938; --focus: #AA0382; --map-bg: #F0EFEB;
  }
  /* ---------- Warm Gray (light, secondary palette) ---------- */
  .root[data-theme="warm"] {
    color-scheme: only light;
    --canvas: #F0EFEB; --paper: #FFFFFF; --paper-2: #F9F9F7; --rule: #E2E1DC; --rule-strong: #C8C9C7;
    --ink: #383938; --ink-2: #383938; --ink-3: #606160; --h-ink: #AA0382;
    --navy: #AA0382; --navy-2: #85026A; --accent: #AA0382; --accent-soft: #F4E6F0; --on-accent: #FFFFFF;
    --muted-bar: #C3C4C3;
    --good: #105C39; --good-bg: #E3F4EA; --good-rule: #46B976;
    --warn: #593826; --warn-bg: #FCF4D6; --warn-rule: #EDC246;
    --bad: #DB3738; --bad-bg: #FDF1E9; --bad-rule: #DB3738;
    --pill-good-bg: #B5E3C8; --pill-good: #105C39; --pill-warn-bg: #FDDC6A; --pill-warn: #593826; --pill-bad-bg: #DB3738; --pill-bad: #FFFFFF;
    --hdr-bg: #F0EFEB; --hdr-fg: #AA0382; --hdr-fg-2: #606160; --hdr-line: #C8C9C7; --hdr-btn-line: #C8C9C7; --hdr-btn-hover: #FFFFFF;
    --hdr-primary-bg: #AA0382; --hdr-primary-fg: #FFFFFF; --hdr-primary-hover: #85026A; --chip-bg: #FFFFFF;
    --aside-bg: #F0EFEB; --aside-line: #E2E1DC; --aside-fg: #383938; --aside-grp: #AA0382; --aside-hover: #F9F9F7; --aside-on-bg: #FFFFFF; --aside-on-fg: #AA0382; --aside-on-bar: #AA0382;
    --row-alt: #FAFAF8; --row-hover: #F4E6F0; --grid: #E8E7E3; --chart-text: #606160; --hover-fill: rgba(170,3,130,.06);
    --tip-bg: #383938; --tip-fg: #FFFFFF; --tip-line: #383938; --input-bg: #FFFFFF; --band: rgba(56,57,56,.035); --warn-band: rgba(237,194,70,.14);
    --na-bg: #F0EFEB; --na-fg: #383938; --focus: #AA0382; --map-bg: #F0EFEB;
  }
  /* ---------- Royal Magenta (magenta frame, white working area) ---------- */
  .root[data-theme="magenta"] {
    color-scheme: only light;
    --canvas: #F9F9F7; --paper: #FFFFFF; --paper-2: #F9F9F7; --rule: #E6E6E3; --rule-strong: #C8C9C7;
    --ink: #212322; --ink-2: #383938; --ink-3: #606160; --h-ink: #212322;
    --navy: #AA0382; --navy-2: #85026A; --accent: #AA0382; --accent-soft: #F6EAF3; --on-accent: #FFFFFF;
    --muted-bar: #C3C4C3;
    --good: #105C39; --good-bg: #E3F4EA; --good-rule: #46B976;
    --warn: #593826; --warn-bg: #FCF4D6; --warn-rule: #EDC246;
    --bad: #DB3738; --bad-bg: #FDF1E9; --bad-rule: #DB3738;
    --pill-good-bg: #B5E3C8; --pill-good: #105C39; --pill-warn-bg: #FDDC6A; --pill-warn: #593826; --pill-bad-bg: #DB3738; --pill-bad: #FFFFFF;
    --hdr-bg: #AA0382; --hdr-fg: #FFFFFF; --hdr-fg-2: #F6D3EA; --hdr-line: #85026A; --hdr-btn-line: rgba(255,255,255,.55); --hdr-btn-hover: rgba(255,255,255,.14);
    --hdr-primary-bg: #FFFFFF; --hdr-primary-fg: #AA0382; --hdr-primary-hover: #F9F9F7; --chip-bg: rgba(255,255,255,.18);
    --aside-bg: #AA0382; --aside-line: #85026A; --aside-fg: #FFFFFF; --aside-grp: #F6D3EA; --aside-hover: rgba(255,255,255,.12); --aside-on-bg: #FFFFFF; --aside-on-fg: #AA0382; --aside-on-bar: #FFFFFF;
    --row-alt: #FBFBFA; --row-hover: #F6EAF3; --grid: #ECECE9; --chart-text: #606160; --hover-fill: rgba(170,3,130,.06);
    --tip-bg: #343434; --tip-fg: #FFFFFF; --tip-line: #343434; --input-bg: #FFFFFF; --band: rgba(56,57,56,.035); --warn-band: rgba(237,194,70,.14);
    --na-bg: #F0EFEB; --na-fg: #383938; --focus: #AA0382; --map-bg: #F0EFEB;
  }
  .root { color: var(--ink); }
  /* launcher: always Royal Magenta with white type, bottom-left so it never covers the Control Room's own buttons */
  .fab { left: 22px; right: auto; bottom: 22px; }
  .fab { background: #AA0382 !important; color: #fff !important; box-shadow: 0 6px 18px rgba(33,35,34,.35); }
  .fab:hover { background: #85026A !important; }
  .fab .badge { background: #DB3738; color: #fff !important; }
  /* header */
  header { background: var(--hdr-bg); border-bottom: 3px solid var(--hdr-line); color: var(--hdr-fg); }
  header .fp { color: var(--hdr-fg-2) !important; } header .meta { color: var(--hdr-fg-2) !important; }
  header h1 { color: var(--hdr-fg) !important; letter-spacing: -.015em; }
  .btn { color: var(--hdr-fg) !important; border-color: var(--hdr-btn-line); background: transparent; }
  .btn:hover { background: var(--hdr-btn-hover); }
  .btn.primary { background: var(--hdr-primary-bg); border-color: var(--hdr-primary-bg); color: var(--hdr-primary-fg) !important; }
  .btn.primary:hover { background: var(--hdr-primary-hover); }
  .chip { background: var(--chip-bg); color: var(--hdr-fg) !important; }
  .chip.good { background: #105C39; color: #fff !important; } .chip.warn { background: #EDC246; color: #212322 !important; } .chip.bad { background: #DB3738; color: #fff !important; }
  .btn:focus-visible, aside button:focus-visible, th:focus-visible, .fab:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  /* theme switcher */
  .thm { position: relative; }
  .thm-menu { display: none; position: absolute; right: 0; top: calc(100% + 8px); z-index: 20; width: 270px; background: var(--paper); border: 1px solid var(--rule-strong); border-radius: 10px; padding: 6px; box-shadow: 0 12px 28px rgba(33,35,34,.28); }
  .thm.open .thm-menu { display: block; }
  .thm-menu button { display: flex; align-items: center; gap: 10px; width: 100%; background: none; border: 0; border-radius: 7px; padding: 8px 10px; text-align: left; cursor: pointer; color: var(--ink) !important; font-size: 13.5px; }
  .thm-menu button:hover { background: var(--accent-soft); }
  .thm-menu button.on { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--magenta); }
  .thm-menu b { display: block; color: var(--ink) !important; font-weight: 650; }
  .thm-menu small { display: block; color: var(--ink-3) !important; font-size: 12px; }
  [data-act="theme"] { display: inline-flex; align-items: center; gap: 8px; }
  .thm-ico { display: inline-flex; } .thm-ico i { display: block; width: 12px; height: 12px; border-radius: 50%; margin-right: -4px; border: 1.5px solid var(--hdr-bg); box-shadow: 0 0 0 1px var(--hdr-btn-line); }
  .thm-car { font-size: 10px; opacity: .8; margin-left: 2px; }
  .thm-sw { display: inline-flex; flex: none; border-radius: 6px; overflow: hidden; border: 1px solid var(--rule-strong); }
  .thm-sw i { display: block; width: 12px; height: 26px; }
  /* sidebar */
  aside { background: var(--aside-bg); border-right-color: var(--aside-line); }
  aside .grp { color: var(--aside-grp) !important; }
  aside button { color: var(--aside-fg) !important; }
  aside button:hover { background: var(--aside-hover); color: var(--aside-fg) !important; }
  aside button.on { background: var(--aside-on-bg); color: var(--aside-on-fg) !important; box-shadow: inset 3px 0 0 var(--aside-on-bar); }
  @media (max-width: 900px) { aside { border-bottom-color: var(--aside-line); } }
  /* page */
  .page > h2.pt { color: var(--h-ink) !important; font-weight: 700; }
  .card h2 { color: var(--h-ink) !important; font-weight: 700; }
  h3.sect { font-size: 17px; font-weight: 700; margin: 26px 0 4px; color: var(--h-ink) !important; }
  .note { background: var(--paper); border-color: var(--rule); border-left-color: var(--magenta); }
  .status .bar i { background: var(--magenta); }
  /* tables */
  tbody tr:nth-child(even) td { background: var(--row-alt); }
  tbody tr:hover td { background: var(--row-hover); }
  tr.total td { background: var(--paper-2) !important; }
  .pill { letter-spacing: .01em; }
  .pill.good { background: var(--pill-good-bg); color: var(--pill-good) !important; }
  .pill.warn { background: var(--pill-warn-bg); color: var(--pill-warn) !important; }
  .pill.bad { background: var(--pill-bad-bg); color: var(--pill-bad) !important; }
  .pill.na { background: var(--na-bg) !important; color: var(--na-fg) !important; border: 1px solid var(--rule-strong); }
  .kpi .st { letter-spacing: .01em; }
  .kpi.good .st { background: var(--pill-good-bg); color: var(--pill-good) !important; }
  .kpi.warn .st { background: var(--pill-warn-bg); color: var(--pill-warn) !important; }
  .kpi.bad .st { background: var(--pill-bad-bg); color: var(--pill-bad) !important; }
  .tier { background: var(--accent-soft); color: var(--accent) !important; }
  .muted, .muted * { color: var(--ink-3) !important; }
  /* charts */
  svg text { fill: var(--chart-text); font-family: inherit; }
  svg .grid line { stroke: var(--grid); }
  svg rect.hit:hover { fill: var(--hover-fill); }
  svg.tl text.ax { fill: var(--ink-3); font-family: inherit; } svg.tl text.nm { fill: var(--ink); font-family: inherit; }
  .tip { background: var(--tip-bg); border: 1px solid var(--tip-line); box-shadow: 0 10px 26px rgba(0,0,0,.35); }
  .tip, .tip * { color: var(--tip-fg) !important; }
  .sharebar { background: var(--rule); } .sharebar i { background: var(--magenta-3); }
  /* controls */
  .seg { background: var(--paper); border-color: var(--rule-strong); }
  .seg button { color: var(--ink-2) !important; }
  .seg button.on { background: var(--magenta); color: #fff !important; }
  .filebtn, .ghost { background: var(--paper-2); color: var(--ink) !important; border-color: var(--rule-strong); }
  .filebtn:hover, .ghost:hover { background: var(--accent-soft); }
  .ghost.on { background: var(--magenta); border-color: var(--magenta); color: #fff !important; }
  input.txt, select.sel, textarea.txt, input.km { background: var(--input-bg); border-color: var(--rule-strong); color: var(--ink) !important; }
  input.txt:focus, select.sel:focus, textarea.txt:focus, input.km:focus { outline: 2px solid var(--focus); border-color: var(--magenta); }
  .dm { background: var(--paper-2); border-color: var(--rule-strong); }
  .guess { background: var(--paper-2); border-color: var(--rule); }
  .alert { background: var(--paper); } .alert.bad { background: var(--bad-bg); } .alert.warn { background: var(--warn-bg); }
  .okmsg { background: var(--good-bg); color: var(--good) !important; }
  .calib td.hl { background: var(--accent-soft) !important; }
  .setbar { background: var(--canvas); }
  a.dalink { color: var(--accent) !important; }
  /* map */
  .map { background: var(--map-bg); }
  .mapwrap { background: var(--paper); border-color: var(--rule); }
  .mapctl { background: var(--paper); border-color: var(--rule-strong); }
  .mapctl button { background: var(--paper); color: var(--ink) !important; border-bottom-color: var(--rule); }
  .mapctl button:hover { background: var(--accent-soft); }
  .maplegend { background: var(--paper); border-color: var(--rule-strong); opacity: .97; }
  .maplegend b, .maplegend span { color: var(--ink) !important; }
  .attr { background: var(--paper); color: var(--ink-2) !important; opacity: .9; }
  .status .bar { background: var(--rule); }
  `;

  const CAUSE_COLORS = { 'Packed after deadline': '#DB3738', 'Packed too late': '#E5813B', 'Awaiting pickup': '#EDC246', 'Ride': '#4D58A7', 'Unknown': '#AC9C93' };
  const NO_DATA_TABS = ['live', 'capacity', 'now', 'log', 'history', 'da_tiers', 'setup', 'settings'];

  const UI = {
    host: null, root: null, data: null, meta: null, raw: null, assignHist: null, tab: 'x_score', busy: false, history: null,

    init() {
      if (UI.host || !document.body) return;
      UI.host = document.createElement('div');
      UI.host.id = 'fp-unified';
      document.body.appendChild(UI.host);
      const sr = UI.host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<style>' + CSS + BRAIN_CSS + DARK_CSS + LAYOUT_CSS + LEAD_CSS + NX_CSS + '</style><div class="root">' +
        '<button class="fab" title="Open the Control Room Brain"><span class="nx-fmark"></span><span class="dot"></span><span class="lbl"><b>Control Room Brain</b></span><span class="nx-fs" style="display:none"></span></button>' +
        '<div class="overlay"><header><button class="btn navtgl" data-act="nav" title="Hide the menu" aria-label="Menu">☰</button><span class="nx-logo" role="img" aria-label="Breadfast"></span><div class="ttl"><span class="fp">Control Room Brain</span><h1>Loading…</h1></div><span class="meta"></span><span class="nx-role" role="tablist"></span><span class="nx-hscore" style="display:none" title="FP Score"></span><span class="nx-live" style="display:none"></span><span class="chips"></span><span class="sp"></span>' +
        '<span class="thm"><button class="btn" data-act="theme" title="Switch style (Breadfast brand themes)" aria-haspopup="true"><span class="thm-ico"></span><span class="thm-name"></span> <span class="thm-car">▾</span></button><div class="thm-menu" role="menu">' + THEMES.map((t) => '<button data-theme-pick="' + t.id + '" role="menuitemradio"><span class="thm-sw">' + t.sw.map((c) => '<i style="background:' + c + '"></i>').join('') + '</span><span><b>' + t.name + '</b><small>' + t.sub + '</small></span></button>').join('') + '</div></span>' +
        '<button class="btn gear" data-act="settings" title="Settings">⚙ Settings</button><button class="btn" data-act="lang">English</button><button class="btn" data-act="motion" title="Animations">✦</button><button class="btn" data-act="csv" title="Export the day&#39;s orders as CSV">⤓ CSV</button><button class="btn primary" data-act="refresh">↻ Refresh</button><button class="btn" data-act="close">✕ Close</button></header>' +
        '<div class="body"><aside></aside><main></main></div></div><div class="tip"></div></div>';
      UI.root = sr.querySelector('.root');
      UI.setTheme(PREFS.theme || 'charcoal', true);
      leadApplyLang();
      NX.paintRole();
      UI.root.querySelector('.fab').addEventListener('click', () => UI.open());
      UI.root.querySelector('header').addEventListener('click', (e) => {
        const pick = e.target.closest('[data-theme-pick]');
        if (pick) { UI.setTheme(pick.dataset.themePick); UI.root.querySelector('.thm').classList.remove('open'); return; }
        const rl = e.target.closest('[data-role]');
        if (rl) { NX.setRole(rl.dataset.role); return; }
        if (e.target.closest('.nx-hscore')) { UI.tab = 'x_score'; UI.render(); return; }
        if (e.target.closest('.nx-live')) { LIVE2.toggle(); return; }
        const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
        if (act === 'lang') { LANG.cur = LANG.cur === 'ar' ? 'en' : 'ar'; PREFS.lang = LANG.cur; savePrefs(); leadApplyLang(); UI.render(true); return; }
        if (act === 'theme') { UI.root.querySelector('.thm').classList.toggle('open'); return; }
        if (act === 'motion') { PREFS.motion = !NX.motion(); savePrefs(); NX.paintRole(); UI.render(); return; }
        if (act === 'close') UI.close();
        if (act === 'nav') { PREFS.navHidden = !PREFS.navHidden; savePrefs(); UI.renderNav(); return; }
        if (act === 'refresh') UI.run();
        if (act === 'csv') UI.exportCsv();
        if (act === 'settings') { UI.tab = 'settings'; UI.render(); }
      });
      UI.root.querySelector('aside').addEventListener('click', (e) => {
        if (e.target.closest('[data-advtoggle]')) { PREFS.advanced = !PREFS.advanced; savePrefs(); UI.render(true); return; }
        const gb = e.target.closest('[data-grp]');
        if (gb) { const g = gb.dataset.grp; PREFS.navShut = Object.assign({}, PREFS.navShut); if (PREFS.navShut[g]) delete PREFS.navShut[g]; else PREFS.navShut[g] = 1; savePrefs(); UI.renderNav(); return; }
        const b = e.target.closest('button[data-tab]');
        if (b) { UI.tab = b.dataset.tab; UI.render(); }
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.isOpen()) { const m = UI.root.querySelector('.thm.open'); if (m) m.classList.remove('open'); else UI.close(); } });
      UI.root.addEventListener('click', (e) => { const m = UI.root.querySelector('.thm.open'); if (m && !e.target.closest('.thm')) m.classList.remove('open'); });
      UI.updateButton();
      setInterval(UI.updateButton, 2000);
      DAREC.start(); PKREC.start(); DCM.start(); FPSTAT.start();
    },
    setTheme(id, quiet) {
      const t = THEMES.find((x) => x.id === id) || THEMES[0];
      UI.root.dataset.theme = t.id;
      UI.root.querySelector('.thm-name').textContent = t.name;
      UI.root.querySelector('.thm-ico').innerHTML = t.sw.map((c) => '<i style="background:' + c + '"></i>').join('');
      UI.root.querySelectorAll('[data-theme-pick]').forEach((b) => { b.classList.toggle('on', b.dataset.themePick === t.id); b.setAttribute('aria-checked', b.dataset.themePick === t.id ? 'true' : 'false'); });
      if (!quiet) { PREFS.theme = t.id; savePrefs(); }
    },
    isOpen() { return !!(UI.root && UI.root.querySelector('.overlay').classList.contains('open')); },
    close() { UI.root.querySelector('.overlay').classList.remove('open'); GMAP.hide(); UI.root.querySelector('.tip').style.display = 'none'; },

    updateButton() {
      if (!UI.root) return;
      const fab = UI.root.querySelector('.fab');
      fab.style.display = onControlRoom() ? 'flex' : 'none';
      fab.classList.toggle('ready', !!CAP.ordersUrl);
      const bad = LIVE.alerts.filter((a) => a.level === 'bad').length;
      fab.querySelector('.lbl').innerHTML = '<b>Control Room Brain</b>' + (bad ? ' <span class="badge">' + bad + '</span>' : '');
      fab.title = bad ? bad + ' live alert' + (bad > 1 ? 's' : '') + ' – open the brain' : CAP.ordersUrl ? 'Open the Control Room Brain' : 'Waiting for the Control Room to load orders – refresh the page if this stays yellow';
      // header chips
      const chips = [];
      if (FPSTAT.cur && Date.now() - FPSTAT.cur.t < 30 * MIN) {
        const s = FPSTAT.cur;
        chips.push('<span class="chip ' + (s.status === 'AVAILABLE' && !s.forced ? 'good' : 'warn') + '" title="FP status, checked ' + fmtTime(s.t) + '">FP ' + esc(s.status === 'AVAILABLE' ? 'open' : s.status.toLowerCase()) + (s.forced ? ' · forced' : '') + '</span>');
      }
      if (DCM.engine) chips.push('<span class="chip ' + (DCM.engine.autoAssignEnabled ? 'good' : 'bad') + '">Auto-assign ' + (DCM.engine.autoAssignEnabled ? 'on' : 'OFF') + '</span>');
      const cur = DCM.current();
      if (cur) chips.push('<span class="chip ' + (cur.availableCapacity <= 0 ? 'warn' : '') + '" title="Current DCM slot">' + shortHour(cur.hour) + ' slot ' + cur.ordersPlaced + '/' + cur.capacity + '</span>');
      if (PKREC.last) chips.push('<span class="chip" title="Live queue and DA list are recorded while this tab is open">Live ' + Math.max(0, Math.round((Date.now() - PKREC.last) / MIN)) + 'm ago</span>');
      const el = UI.root.querySelector('header .chips');
      const html = chips.join('');
      if (el.innerHTML !== html) el.innerHTML = html;
    },

    open() {
      UI.root.querySelector('.overlay').classList.add('open');
      const capturedDate = CAP.ordersUrl ? new URL(CAP.ordersUrl).searchParams.get('date') : null;
      if (CAP.ordersUrl && (!UI.data || (UI.meta && UI.meta.date !== capturedDate))) UI.run();
      else UI.render();
    },

    setStatus(html) { if (UI.quiet) return; UI.renderNav(); UI.root.querySelector('main').innerHTML = '<div class="status' + (UI.busy ? ' busy' : '') + '">' + html + '</div>'; },

    async run() {
      if (UI.busy) return;
      if (!CAP.ordersUrl) {
        if (NO_DATA_TABS.includes(UI.tab)) { UI.render(); return; }
        UI.setStatus('No orders request seen yet.<br><br>Select a date in the Control Room (or refresh the page with this script on), wait for the orders to load, then press <b>Refresh</b>.');
        return;
      }
      UI.busy = true;
      UI.root.querySelector('[data-act="refresh"]').disabled = true;
      UI.setStatus(LT('loading') + '<div class="bar"><i style="width:2%"></i></div>');
      try {
        const res = await fetchAllOrders((n, total) => {
          const p = isFinite(total) && total ? Math.min(100, (100 * n) / total) : 30;
          UI.setStatus(LT('loading') + ' ' + n + (isFinite(total) ? ' / ' + total : '') + '<div class="bar"><i style="width:' + p + '%"></i></div>');
        });
        if (!res.orders.length) { UI.setStatus('No orders found for ' + esc(res.date) + '.'); return; }
        Object.assign(DAY_ORDERS, { dk: res.date, res, at: Date.now() });
        // P90 incl. forced goes by the day placed: a past day also needs the next day's orders (placed this evening for tomorrow's slots)
        UI.rawNext = await fetchNextDay(res.date, (n, total) => UI.setStatus(LT('loading') + ' ' + n + (isFinite(total) ? ' / ' + total : '')));
        UI.raw = res;
        UI.assignHist = null;
        await UI.build(false);
        LIVE2.loaded();
        UI.render();
      } catch (e) {
        UI.setStatus('<span class="err">Could not load orders: ' + esc(e.message) + '</span><br><br>Refresh the Control Room page, wait for the orders to load, then try again.');
      } finally {
        UI.busy = false;
        UI.root.querySelector('[data-act="refresh"]').disabled = false;
      }
    },

    // Runs every analysis on the loaded orders. reuse = keep the assignment history already read (used when a setting changes).
    async build(reuse) {
      const res = UI.raw;
      UI.setStatus(LT('crunch'));
      const coords = await getFpCoords(res.orders);
      Object.assign(NX_VAL, { field: null, seen: 0, found: 0, keys: null });
      const A = analyze(res.orders, coords);
      A.dk = res.date;
      A.spill = makeSpill(res.date, UI.rawNext && UI.rawNext !== res ? UI.rawNext : null, coords);
      const fpNames = Array.from(new Set(res.orders.map((o) => o.fpName).filter(Boolean)));
      UI.meta = { date: res.date, fps: res.fps, fpNames, fetchedAt: Date.now() };
      const fp = res.fps[0];
      if (!reuse || !UI.assignHist) {
        try {
          UI.assignHist = await fetchAssignHistory(A.rows, (n, t) => UI.setStatus('Reading assignment history… ' + n + ' / ' + t + ' manual orders<div class="bar"><i style="width:' + (t ? (100 * n) / t : 100) + '%"></i></div>'));
        } catch (e) { UI.assignHist = null; }
      }
      let liveList = DAREC.snapshot && DAREC.snapshot.fp === fp ? DAREC.snapshot.list : null;
      if (fp && !reuse) {
        try { liveList = await fetchDAs(fp); const t = Date.now(); DAREC.save(fp, liveList, t); DAREC.snapshot = { t, fp, list: liveList }; } catch (e) { }
      }
      const isToday = res.date === dateKeyOf(Date.now());
      A.da = analyzeDA(A, UI.meta, UI.assignHist, fp ? DAREC.load(fp, res.date) : null, liveList);
      if (!isToday) A.da.list = A.da.list.filter((x) => x.deliveries || (x.av && x.av.online));
      A.pk = analyzePickers(A, UI.meta, fp ? PKREC.load(fp, res.date) : null);
      A.cp = cpAnalysis(A); cpApply(A, A.cp);
      A.score = scoreDay(A);
      A.isToday = isToday;
      UI.data = A;
      UI.history = saveHistory(UI.meta, A);
      if (finishPrevDay(UI.meta, A)) UI.history = loadHistory();
      UI.root.querySelector('header .fp').textContent = (fpNames.join(', ') || 'FP') + ' · Control Room Brain';
      UI.root.querySelector('header h1').textContent = leadDate(res.date);
      UI.root.querySelector('header .meta').textContent = A.day.orders + ' orders' + (A.day.subOrders && !CFG.INCLUDE_SUBORDERS ? ' (+' + A.day.subOrders + ' sub-orders)' : CFG.INCLUDE_SUBORDERS ? ' incl. sub-orders' : '') + ' · ' + A.pk.team.pickers + ' pickers · ' + A.da.team.activeDAs + ' DAs · loaded ' + fmtTime(Date.now());
      // capacity and DA tiers load in the background
      if (fp) {
        Promise.allSettled([DCM.loadConfig(fp), DCM.loadDrivers(fp), DCM.loadEngine(fp)]).then(() => { UI.updateButton(); if (UI.isOpen() && ['now', 'da_tiers'].includes(UI.tab)) UI.render(true); });
      }
    },
    async reanalyze() {
      if (!UI.raw || UI.busy) return;
      UI.busy = true;
      try { await UI.build(true); } finally { UI.busy = false; }
      UI.render();
    },

    exportCsv() {
      if (!UI.data) return;
      UI.download(toCsv(UI.data), 'fp-orders-' + (UI.meta.fpNames[0] || 'fp').replace(/[^\w]+/g, '-') + '-' + UI.meta.date + '.csv');
    },
    download(text, name) {
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },

    // [key, label, advanced?] – advanced pages show only with "Show advanced pages" (Settings, or the bottom of this menu)
    groups: [
      ['Now', [['scorecard', 'KPI Scorecard'], ['rootcause', 'Root causes'], ['p90', 'P90 Analysis'], ['accountability', 'ETA Late Analysis'], ['now', 'Live & capacity']]],
      ['Day Analysis', [['slots', 'Timeslots'], ['shifted', 'Forced & shifted'], ['coffee', 'Coffee & pharmacy'], ['tags', 'Order tags'], ['baskets', 'Basket size'], ['types', 'Order types', 1]]],
      ['Pickers', [['pk_shifts', 'Picker shifts'], ['pk_overview', 'Picking overview'], ['pk_pickers', 'Performance'], ['pk_timeline', 'Timeline'], ['pk_queue', 'Longest waits & picks', 1], ['pk_baskets', 'Basket fairness', 1], ['pk_ranking', 'Ranking & bonuses', 1]]],
      ['DAs', [['da_shifts', 'DA shifts'], ['da_overview', 'Coverage'], ['da_das', 'Performance'], ['da_timeline', 'Timeline'], ['da_avail', 'Availability'], ['da_assign', 'Manual assignments'], ['da_ranking', 'Ranking & bonuses', 1], ['da_tiers', 'Tiers & DCM', 1]]],
      ['Areas', [['map', 'Zones map'], ['areas', 'Sub-areas']]],
      ['Plan & learn', [['demand', 'Demand'], ['history', 'History'], ['log', 'KPI log & patterns', 1]]],
      ['Brain', [['setup', 'Start here'], ['settings', 'Settings']]],
    ],
    renderNav() {
      let title = '';
      const advN = UI.groups.reduce((t, g) => t + g[1].filter((x) => x[2]).length, 0);
      const shut = PREFS.navShut || {};
      UI.root.classList.toggle('navhidden', !!PREFS.navHidden);
      const nb = UI.root.querySelector('[data-act="nav"]'); if (nb) nb.title = PREFS.navHidden ? 'Show the menu' : 'Hide the menu';
      UI.root.querySelector('aside').innerHTML = LEAD_GROUPS().map(([g, items]) => {
        const vis = items.filter(([k, , adv]) => (k !== 'coffee' || hasCP()) && (!adv || ADV() || UI.tab === k));
        if (!vis.length) return '';
        const closed = !!shut[g];
        const btns = vis.map(([k, l, adv]) => {
          if (k === 'coffee') l = cpTitle();
          if (UI.tab === k) title = l;
          if (closed && UI.tab !== k) return '';
          return '<button data-tab="' + k + '" class="' + (UI.tab === k ? 'on' : '') + (adv ? ' adv' : '') + '">' + l + '</button>';
        }).join('');
        return '<div class="sec' + (closed ? ' closed' : '') + '"><button class="grp" data-grp="' + esc(g) + '" aria-expanded="' + !closed + '" title="' + (closed ? 'Show' : 'Hide') + ' these pages"><span class="car">' + (closed ? '▸' : '▾') + '</span><span class="gl">' + g + '</span>' + (closed ? '<span class="cnt">' + vis.length + '</span>' : '') + '</button>' + btns + '</div>';
      }).join('') + (LITE ? '<button class="advtoggle" data-advtoggle>' + (PREFS.advanced ? 'Hide advanced pages' : 'Show advanced pages (' + advN + ')') + '</button>' : '');
      NX.navDecor();
      return title;
    },

    render(soft) {
      if (!UI.root) return;
      if (soft) {
        const ae = UI.root.getRootNode().activeElement;
        if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return; // don't wipe something being typed
      }
      GMAP.hide();
      if (MAP.cleanup) { MAP.cleanup(); MAP.cleanup = null; }
      // pages merged into others in v1.26: a link or a saved choice that still names one opens its new home
      const MOVED = { live: 'now', capacity: 'now', overview: 'slots', shifts: 'slots', late: 'accountability' };
      if (LITE && MOVED[UI.tab]) UI.tab = MOVED[UI.tab];
      const title = UI.renderNav();
      const main = UI.root.querySelector('main');
      const keep = soft ? main.scrollTop : 0;
      if (!UI.data && !NO_DATA_TABS.includes(UI.tab)) {
        main.innerHTML = '<div class="status">' + (UI.busy ? LT('loading') : CAP.ordersUrl ? LT('press') : LT('choose')) + '</div>';
        return;
      }
      let body;
      try { body = VIEW(UI.tab)(UI.data, UI.meta); } catch (e) { body = '<div class="note err">This page hit an error: ' + esc(e.message) + '</div>'; console.error('[FP Brain]', e); }
      if (LITE) body = compactText(body);
      main.innerHTML = '<div class="page"><h2 class="pt">' + title + '</h2><p class="pd">' + (PAGE_DESC[UI.tab] || '') + '</p>' + body + '</div>';
      main.scrollTop = keep;
      bindTables(main);
      bindTips(main);
      main.querySelectorAll('.seg[data-rank] button').forEach((b) => b.addEventListener('click', () => { PK_VIEWS._range = b.dataset.v; UI.render(); }));
      main.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.p90v) BRAIN_VIEWS._p90 = b.dataset.p90v; UI.tab = b.dataset.goto; UI.render(); }));
      if (UI.tab === 'map' && UI.data) MAP.mount(main, UI.data);
      if (UI.tab === 'areas') bindRoadKm(main);
      if (BIND[UI.tab]) BIND[UI.tab](main);
      wiBind(main);
      greenPills(main);
      NX.afterRender(main, soft);
    },
  };

  const PAGE_DESC = {
    complaints: 'Customer complaints on this day\'s orders, by category, with what the complained orders had in common. Runs only when you press Check complaints: one read-only lookup per order.',
    tags: 'The Control Room icons (frozen, fragile, cannot scan, new customer…) and how those orders did on ETA late % and P90.',
    scorecard: 'Every KPI against its target for the loaded date, hour by hour, with what drove each miss and a one-line explanation for your DM.',
    live: 'What needs attention right now, from the live order queue, DA list, auto-assign and DCM. Refreshes on its own every few minutes.',
    capacity: 'What the FP can really handle this hour, from both your pickers and your DAs, against the capacity DCM set. Tells you whether to add or remove orders. Read-only: change capacity in DCM yourself.',
    slots: 'Every timeslot side by side.',
    shifted: 'Which scheduled orders count as forced and why (scheduled express, DCM slot full or FP BUSY when placed, else under the cutoff), and what was recorded.',
    get types() { return 'Grocery' + (hasCoffee() ? ', coffee' : '') + (hasPharma() ? ', pharmacy' : '') + ' and sub-orders side by side, and how counting sub-orders changes your lateness and P90.'; },
    p90: 'Every delivered order from fastest to slowest, the exact order sitting at P90, its neighbours, and how many orders stood between the day and the target.',
    get coffee() { return hasCoffee() && hasPharma() ? 'Coffee and pharmacy separately: how much time each adds, and which late orders they caused.' : hasCoffee() ? 'How much time the coffee adds, and which late orders it caused.' : 'How much time the pharmacy adds, and which late orders it caused.'; },
    get accountability() { return 'Every late order from creation to delivery: who picked it, how long each stage took, who delivered it, and who owns the delay: the FP, logistics' + (hasCP() ? ', the ' + cpTitle().toLowerCase().replace(' & ', ' / ') : '') + ', or a large basket with an ETA too short for it.'; },
    da_ranking: 'Each DA\'s record over a day, week or month, ranked on speed, attendance and availability first, then ride lateness, DPH and deliveries.',
    baskets: 'How the day\'s orders split by basket size (unique SKUs), the share of large baskets, the expected picking time for each size from your own history, and whether each size was picked and packed in time.',
    pk_overview: 'How fast orders got a picker, how long picking took, and where the FP fell behind.',
    pk_pickers: 'Speed per picker in seconds per SKU (adjusted for basket size), with workload, idle time and lateness. Only orders inside each picker\'s shift count.',
    pk_queue: 'The orders that waited longest for a picker, and the picks that took longest.',
    pk_timeline: 'Every order each picker worked on, from start to packed.',
    pk_baskets: 'Who got the big baskets, so pickers are compared fairly.',
    pk_ranking: 'Each picker\'s record over a day, week or month, ranked on speed, slow-picking lateness, availability and attendance.',
    da_overview: 'How the DA team covered the day, hour by hour.',
    da_das: 'Speed per DA (first-drop ride vs the usual ride to that sub-area), availability, output and lateness. Only deliveries inside each DA\'s shift count.',
    da_timeline: 'Every DA\'s trips across the day, with recorded availability underneath.',
    da_avail: 'When each DA was available, on a trip, or unavailable (recorded while the Control Room is open).',
    da_assign: 'Which orders were assigned by hand, and whether it helped.',
    da_tiers: 'DA tiers, overrides and rolling metrics from DCM, next to today\'s numbers.',
    map: 'Where orders come from, by Breadfast zone.',
    areas: 'Sub-areas as written on each order, with distance and road time.',
    demand: 'Any range of past days: orders and basket size per hour by weekday, pickers and DAs needed per timeslot at your PPH (Ops) / DPH (Ops) targets, what stands out, and one CSV of every order (no customer data).',
    log: 'Your root causes and actions per missed KPI, and the patterns they add up to.',
    history: 'Every date analysed in this browser, KPI by KPI.',
  };

  /* ------------------------------------------------------------------
   * BRAIN VIEWS: scorecard, live, capacity, tiers, KPI log, history
   * ------------------------------------------------------------------ */
  function VIEW(tab) {
    if (typeof KPI_VIEWS[tab] === 'function') return KPI_VIEWS[tab];
    if (BRAIN_VIEWS[tab]) return BRAIN_VIEWS[tab];
    if (tab.indexOf('pk_') === 0) return PK_VIEWS[tab.slice(3)];
    if (tab.indexOf('da_') === 0) return DA_VIEWS[tab.slice(3)];
    return DAY_VIEWS[tab];
  }
  const SUGGEST = {
    'Picker shortage': 'Picker shortage / no-shows', 'Slow picking': 'Picker speed / discipline', 'DA shortage': 'DA shortage / no-shows', 'Free DAs not assigned': 'Logistics / manual assigning', 'Held for another order': 'Picker shortage / no-shows', 'Large basket': 'Large baskets',
    'Slow DA': 'Far drops / traffic', 'Multi-order trip': 'Logistics / manual assigning', 'Far drop / short ETA': 'Far drops / traffic', 'Coffee': 'Coffee / pharmacy delays', 'Pharmacy': 'Coffee / pharmacy delays', 'Not recorded': 'Other',
  };
  function suggestCause(key, A) {
    const S = A.score, dx = S.dx[key];
    if (key === 'eta' && dx.reasons && dx.reasons[0]) return SUGGEST[dx.reasons[0][0]];
    if (key === 'p90f' && S.extra.forced && /forced shifts/.test(dx.dm)) return 'Forced shifts / FP busy';
    if (key === 'p90f' || key === 'p90n') { const r = countBy(S.etaLate, whyLate)[0]; return r ? SUGGEST[r[0]] : 'Other'; }
    if (key === 'pph') return /overstaffing/.test(dx.dm) ? 'Overstaffed for demand' : 'Picker speed / discipline';
    if (key === 'dph') return /too many DAs/.test(dx.dm) ? 'Overstaffed for demand' : /multi-drop/.test(dx.dm) ? 'Logistics / manual assigning' : 'DA breaks in peak';
    if (key === 'auto') return 'Logistics / manual assigning';
    return 'Other';
  }
  if (!LOG.CAUSES.includes('Overstaffed for demand')) LOG.CAUSES.splice(LOG.CAUSES.length - 1, 0, 'Overstaffed for demand');

  function reasonBar(rows) {
    const reasons = countBy(rows, whyLate);
    const total = rows.length;
    if (!total) return '<p class="muted">No late orders.</p>';
    const ordered = REASON_ORDER.map((k) => [k, (reasons.find((x) => x[0] === k) || [k, 0])[1]]).filter((x) => x[1]);
    return '<div class="rbar">' + ordered.map(([k, n]) => '<span data-tip="' + esc(k + ': ' + n + ' (' + shareTxt(n, total) + ')') + '" style="width:' + (100 * n) / total + '%;background:' + REASON_COLORS[k] + '"></span>').join('') + '</div>' +
      '<div class="legend">' + ordered.map(([k, n]) => '<span><i style="background:' + REASON_COLORS[k] + '"></i>' + k + ': <b>' + n + '</b> (' + shareTxt(n, total) + ')</span>').join('') + '</div>';
  }

  // Forced orders: how they're counted, and the cutoff used when nothing was recorded, checked against the official P90 incl. forced
  function forcedCalibHtml(A, dk) {
      // forced: fallback cutoff + calibration (placed-day pool; orders decided by express or a recording keep their verdict)
      const S = A.score, x = S.extra, PP = S.pool, pDel = PP.del, nowD = PP.nowDel;
      const TH = [1, 2, 3, 4, 6, 12];
      const official = (PREFS.officialP90 || {})[dk];
      const fixedSrc = (r) => ['express', 'dcm', 'status', 'open'].includes(r.forcedSrc);
      const forcedAt = (r, t) => r.scheduled && (fixedSrc(r) ? r.forced : r.shiftHours == null || r.shiftHours < t);
      const calib = TH.map((t) => ({ t, p: pct(nowD.concat(pDel.filter((r) => forcedAt(r, t))).map((r) => r.deliveryMin), 0.9), n: pDel.filter((r) => forcedAt(r, t)).length }));
      const best = official != null ? calib.reduce((b, c) => (c.p != null && (b == null || Math.abs(c.p - official) < Math.abs(b.p - official)) ? c : b), null) : null;
      const bySrc = countBy(PP.del.filter((r) => r.scheduled), (r) => r.forcedSrc);
      const srcN = (k) => (bySrc.find((z) => z[0] === k) || [k, 0])[1];
      return '<details class="card calib"><summary><b>How "forced" is counted</b> <span class="mini">· ' + x.forced + ' forced, placed this day: ' + ['express', 'dcm', 'status', 'cut'].filter((k) => srcN(k)).map((k) => forcedSrcTxt(k) + ' ' + srcN(k)).join(' · ') + '. Open to check the cutoff against your official scorecard.</span></summary>' +
        '<p class="sub" style="margin-top:10px"><b>Scheduled express</b> is always forced. Otherwise, when a Control Room tab was open as the order was placed, the brain uses what it recorded: the NOW slot <b>full in DCM</b> or the <b>FP BUSY</b> = forced, open with room = the customer\'s choice. Only when nothing was recorded at that minute does the <b>cutoff</b> decide: placed less than ' + CFG.PLANNED_AHEAD_HOURS + ' hours before the slot = forced. Orders count on the day they were <b>placed</b>' + (PP.spillN ? ' (' + PP.spillN + ' placed this day for the next day\'s slots are included)' : '') + '. Type the official P90 incl. forced for this date to see which cutoff fits; the choice is saved in this browser and used everywhere.</p>' +
        '<div class="tw" style="max-width:760px"><table class="calib"><thead><tr><th class="l">Cutoff (nothing recorded)</th>' + calib.map((c) => '<th>' + c.t + 'h</th>').join('') + '</tr></thead><tbody>' +
        '<tr><td class="l">P90 incl. forced</td>' + calib.map((c) => '<td class="' + (best && best.t === c.t ? 'hl' : '') + '">' + fmt(c.p) + '</td>').join('') + '</tr>' +
        '<tr><td class="l">Forced orders</td>' + calib.map((c) => '<td>' + c.n + '</td>').join('') + '</tr>' +
        '<tr><td class="l">Use</td>' + calib.map((c) => '<td><button class="ghost sm ' + (CFG.PLANNED_AHEAD_HOURS === c.t ? 'on' : '') + '" data-forced="' + c.t + '">' + c.t + 'h</button></td>').join('') + '</tr></tbody></table></div>' +
        '<p class="sub" style="margin:12px 0 0">Official P90 incl. forced for ' + esc(dk) + ': <input class="txt num" data-official value="' + (official != null ? official : '') + '" inputmode="decimal" placeholder="e.g. 58"> ' + (best ? '<span class="mini">Closest: ' + best.t + 'h (' + fmt(best.p) + ' min)</span>' : '') + '</p></details>';

  }

  function bindCalib(main, dk) {
    main.querySelectorAll('[data-forced]').forEach((b) => b.addEventListener('click', () => { CFG.PLANNED_AHEAD_HOURS = +b.dataset.forced; PREFS.forcedCut = CFG.PLANNED_AHEAD_HOURS; savePrefs(); UI.reanalyze(); }));
    const off = main.querySelector('[data-official]');
    if (off) off.addEventListener('change', () => { const v = parseFloat(off.value); PREFS.officialP90 = PREFS.officialP90 || {}; if (isFinite(v)) PREFS.officialP90[dk] = v; else delete PREFS.officialP90[dk]; savePrefs(); setTimeout(() => { UI.render(); const d2 = UI.root.querySelector('main details.calib'); if (d2) d2.open = true; }, 0); });
  }
  const BRAIN_VIEWS = {
    map(A) { return MAP.html(A); },

    scorecard(A, M) {
      const S = A.score, v = S.v, x = S.extra;
      const dk = M.date;
      const log = LOG.day(dk) || { kpis: {} };
      let h = '';
      if (A.day.inProgress) h += '<div class="note">' + A.day.inProgress + ' orders are still open, so today\'s numbers will move.</div>';
      const sub = {
        p90f: 'Target ' + CFG.P90_TARGET_MIN + ' min · ' + x.forced + ' forced (' + fmtPct(x.forcedPct) + ' of delivered)',
        p90n: 'Target ' + CFG.P90_TARGET_MIN + ' min · ' + x.nowDelivered + ' NOW delivered',
        eta: x.etaLate + ' of ' + x.delivered + ' NOW delivered late · target ' + CFG.LATE_TARGET_PCT + '%',
        ppho: 'Target ' + CFG.PPH_OPS_TARGET + ' · ' + x.opsOrders + ' orders ÷ ' + x.pkActiveH + ' picker active hours',
        dpho: 'Target ' + CFG.DPH_OPS_TARGET + ' · ' + x.opsOrders + ' orders ÷ ' + x.daActiveH + ' DA active hours',
        pph: 'Target ' + CFG.PPH_TARGET + ' · average of ' + x.pphHours + ' hours · pickers who started ' + CFG.PPH_MIN_PICKS + '+',
        dph: 'Target ' + CFG.DPH_TARGET + ' · average of ' + x.dphHours + ' hours · DAs with ' + CFG.DPH_MIN_DELIVERIES + '+ pickups',
        auto: x.manualN + ' to a different DA of ' + (x.autoN + x.manualN) + ' · target ' + CFG.AUTO_ASSIGN_TARGET + '%',
      };
      h += '<div class="sc">' + KPI_DEFS.map((d) => {
        const st = kpiStatus(d, v[d.key]);
        return '<div class="kpi click ' + (st || '') + '" data-jump="' + d.key + '" title="' + esc(d.def) + '"><div class="k">' + d.label + '</div><div class="v">' + kpiFmt(d, v[d.key]).replace('%', '') + (d.unit ? '<span class="u">' + d.unit + '</span>' : '') + '</div><div class="s">' + sub[d.key] + '</div>' + (st ? '<div class="st">' + (st === 'good' ? 'On target' : st === 'warn' ? 'Just off target' : 'Missed') + '</div>' : '') + '</div>';
      }).join('') +
        '</div>';
      { const X = accountability(A); if (X.late.length) h += '<div class="note" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span><b>Late orders by owner:</b> FP (packaging lead) <b>' + X.counts[OWN_STORE] + '</b> · Logistics (coordinator) <b>' + X.counts[OWN_DISPATCH] + '</b>' + (hasCP() ? ' · ' + cpTitle().toLowerCase() + ' <b>' + X.counts[OWN_CP] + '</b>' : '') + (X.counts[OWN_BASKET] ? ' · large basket (ETA too short) <b>' + X.counts[OWN_BASKET] + '</b>' : '') + (X.roadMulti.length ? ' · ' + X.roadMulti.length + ' of ' + X.roadLate.length + ' ride-late orders had earlier drops in their trip' : '') + '</span><button class="ghost sm" data-goto="accountability">See each order</button></div>'; }

      if (!LITE) h += forcedCalibHtml(A, dk);   // network version: under Settings → Check against Tableau

      // hour by hour
      const reasonCell = (r) => (r.reasons[0] ? '<span class="mini">' + esc(r.reasons[0][0]) + ' (' + r.reasons[0][1] + ')</span>' : '');
      h += card('Hour by hour vs target', 'P90, ETA late and auto-assign by the order\'s timeslot. PPH and DPH put each order in the hour its work started: the picker started picking it, the DA picked it up. <b>PPH (Ops)</b> = orders started that hour ÷ every picker who started one (<b>active</b>). <b>PPH</b> = the same, counting only pickers who started ' + CFG.PPH_MIN_PICKS + '+ that hour (<b>counted</b>). <b>DPH (Ops)</b> and <b>DPH</b> work the same way with pickups (' + CFG.DPH_MIN_DELIVERIES + '+ to count). Hours where nobody counts show no PPH / DPH and are left out of the day\'s average. <b>On ground</b> = everyone there ' + CFG.ON_GROUND_MIN + '+ min of the hour, busy or not (their shift, the DA availability recording or DCM\'s active DAs, else first to last activity): a quiet hour with 0 counted and 3 on the ground was overstaffed, not empty.', table([
        ['Hour', (r) => r.h, (r) => esc(r.label), 'l'], ['Orders', (r) => r.orders],
        ['P90 incl. forced', (r) => r.p90f, (r) => kpiPill('p90f', r.p90f)], ['P90 NOW', (r) => r.p90n, (r) => kpiPill('p90n', r.p90n)],
        ['ETA late %', (r) => r.eta, (r) => kpiPill('eta', r.eta) + (r.etaLate ? ' <span class="mini">' + r.etaLate + '</span>' : '')],
        ['PPH (Ops)', (r) => r.ppho, (r) => kpiPill('ppho', r.ppho)], ['PPH', (r) => r.pph, (r) => kpiPill('pph', r.pph)],
        ['Pickers active / counted / on ground', (r) => r.pkActive, (r) => r.pkActive + ' <span class="muted">/ ' + r.pickersCounted + ' / ' + r.pkGround + '</span>'],
        ['DPH (Ops)', (r) => r.dpho, (r) => kpiPill('dpho', r.dpho)], ['DPH', (r) => r.dph, (r) => kpiPill('dph', r.dph)],
        ['DAs active / counted / on ground', (r) => r.daActive, (r) => r.daActive + ' <span class="muted">/ ' + r.dasCounted + ' / ' + r.daGround + '</span>'],
        ['Auto-assign', (r) => r.auto, (r) => kpiPill('auto', r.auto)], ['Top late reason', (r) => (r.reasons[0] ? r.reasons[0][0] : ''), reasonCell, 'l'],
      ], S.hours));

      // diagnosis per KPI, misses first
      const rank = { bad: 0, warn: 1, good: 2, null: 3 };
      const keys = KPI_DEFS.map((d) => d.key).sort((a, b) => rank[kpiStatus(kpiDef(a), v[a])] - rank[kpiStatus(kpiDef(b), v[b])]);
      keys.forEach((k) => {
        const d = kpiDef(k), st = kpiStatus(d, v[k]), dx = S.dx[k];
        let body = '<h3>What drove it</h3><ul>' + dx.drivers.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
        if (k === 'eta' && S.etaLate.length) body += reasonBar(S.etaLate);
        if (dx.actions.length) body += '<h3>What to do</h3><ul>' + dx.actions.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
        const line = dx.dm || (v[k] == null ? '' : d.label + ' ' + kpiFmt(d, v[k]) + (d.unit === 'min' ? ' min' : '') + ' vs ' + d.target() + (d.unit === '%' ? '%' : d.unit === 'min' ? ' min' : '') + (st === 'good' ? ', on target.' : '.'));
        if (line) body += '<div class="dm"><p><b>In one line:</b> ' + esc(line) + '</p></div>';
        h += '<div class="card dx ' + (st || '') + '" id="dx-' + k + '"><div class="dxhead"><h2>' + d.label + ': ' + kpiFmt(d, v[k]) + (d.unit === 'min' ? ' min' : '') + '</h2><span class="mini">target ' + d.target() + (d.unit === '%' ? '%' : d.unit === 'min' ? ' min' : '') + ' · ' + esc(d.def) + '</span>' + (k === 'p90f' || k === 'p90n' ? '<span class="sp" style="flex:1"></span><button class="ghost sm" data-goto="p90" data-p90v="' + (k === 'p90f' ? 'forced' : 'now') + '">P90 Analysis →</button>' : '') + '</div>' + body + '</div>';
      });

      // log form (network version: with the advanced pages)
      if (!ADV()) return h;
      const misses = KPI_DEFS.filter((d) => ['bad', 'warn'].includes(kpiStatus(d, v[d.key])));
      h += card('Log today\'s misses', 'Saved per date in this browser and summarised under Plan & learn → KPI log & patterns. The cause is pre-filled with the brain\'s best guess; change it to what you found on the floor.', misses.length ?
        '<div class="lrow lhead"><span>KPI</span><span>Value</span><span>Root cause</span><span>What you found</span><span>Action / owner</span><span></span></div>' + misses.map((d) => {
          const e = log.kpis[d.key] || {};
          const cause = e.cause || suggestCause(d.key, A);
          return '<div class="lrow" data-logrow="' + d.key + '"><span class="k">' + d.label + '</span><span class="val">' + kpiPill(d.key, v[d.key]) + '</span>' +
            '<select class="sel" data-f="cause">' + LOG.CAUSES.filter((c) => c === cause || cpShowLabel(c)).map((c) => '<option' + (c === cause ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
            '<textarea class="txt" data-f="note" placeholder="e.g. 2 DAs no-show, 1 on break 9 PM">' + esc(e.note || '') + '</textarea>' +
            '<textarea class="txt" data-f="action" placeholder="e.g. Called backup DA; talk to Hassan about breaks">' + esc(e.action || '') + '</textarea>' +
            '<span><button class="ghost" data-savelog="' + d.key + '">Save</button>' + (e.savedAt ? '<br><span class="saved">Saved ' + fmtTime(e.savedAt) + '</span>' : '') + '</span></div>';
        }).join('') : '<div class="okmsg">Every KPI the brain can measure is on target for this date.</div>');
      return h;
    },

    live() {
      const P = LIVE.pending();
      let h = '';
      const alerts = LIVE.alerts;
      if (!PKREC.snapshot && !DAREC.snapshot && !DCM.engine) h += '<div class="note">No live reading yet. It starts a few seconds after the Control Room loads and repeats every ' + CFG.POLL_MIN + ' minutes while a Control Room tab is open.</div>';
      if (alerts.length) h += alerts.map((a) => '<div class="alert ' + a.level + '">' + (a.tab && a.tab !== 'live' ? '<button class="ghost sm go" data-goto="' + a.tab + '">Open</button>' : '') + '<h3>' + esc(a.title) + '</h3><p>' + esc(a.detail) + '</p>' + (a.action ? '<p class="act">→ ' + esc(a.action) + '</p>' : '') + '</div>').join('');
      else if (PKREC.snapshot) h += '<div class="okmsg">Nothing needs attention right now.</div>';
      if (P) {
        const c = (s) => P.filter((x) => x.stage === s).length;
        const das = DAREC.snapshot ? DAREC.snapshot.list : [];
        const dc = (s) => das.filter((d) => daStatus(d) === s).length;
        h += '<div class="tiles">' + tile('Waiting for a picker', c('Waiting for picker'), 'NOW + due scheduled') + tile('Being picked', c('Picking'), new Set(P.filter((x) => x.stage === 'Picking' && x.picker).map((x) => x.picker)).size + ' pickers busy') +
          tile('Awaiting pickup', c('Awaiting pickup'), '') + tile('With a DA', c('With DA'), '') +
          (das.length ? tile('DAs', dc('T') + ' on trip · ' + dc('A') + ' free', dc('L') + ' locked · ' + dc('U') + ' off') : '') +
          tile('As of', fmtTime(PKREC.snapshot.t), 'refreshes every ' + CFG.POLL_MIN + ' min') + '</div>';
        const open = P.filter((x) => x.stage !== 'With DA' || (x.left != null && x.left < 15));
        const order = { 'Waiting for picker': 0, 'Picking': 1, 'In the FP': 2, 'Awaiting pickup': 3, 'With DA': 4 };
        h += card('Orders in the FP', 'Sorted by time left to the ETA (NOW) or slot end (scheduled). Red = already past it.', open.length ? table([
          ['Order', (r) => r.num, null, 'l'], ['Type', (r) => r.model, null, 'l'], ['Stage', (r) => order[r.stage], (r) => esc(r.stage), 'l'],
          ['Time left', (r) => r.left, (r) => (r.left == null ? '–' : '<span class="pill ' + (r.left < 0 ? 'bad' : r.left < CFG.ALERT_RISK_MIN ? 'warn' : 'good') + '">' + (r.left < 0 ? '−' + hm(-r.left) : hm(r.left)) + '</span>')],
          ['Placed', (r) => r.placed, (r) => fmtTime(r.placed)], ['Packed', (r) => r.packed, (r) => fmtTime(r.packed)], ['SKUs', (r) => r.skus], ['Picker', (r) => r.picker || '', null, 'l'], ['DA', (r) => r.da || '', null, 'l'],
        ], open.sort((a, b) => (a.left == null ? 1e9 : a.left) - (b.left == null ? 1e9 : b.left))) : '<p class="muted">No orders in the FP.</p>');
      }
      const snap = DAREC.snapshot;
      if (snap && snap.list.length) {
        const order = { T: 0, A: 1, L: 2, U: 3 };
        const drv = new Map((DCM.drivers || []).map((d) => [String(d.userId), d]));
        h += card('DAs right now', 'From the DAs Availability list at ' + fmtTime(snap.t) + '.', table([
          ['DA', (r) => r.name, (r) => esc(r.name) + ' <span class="muted">' + esc(r.hrId || '') + '</span> ' + tierBadge((drv.get(String(r.userId)) || {}).tier ? drv.get(String(r.userId)).tier.effectiveTier : r.tierId), 'l'],
          ['Status', (r) => order[daStatus(r)], (r) => '<span class="st-dot" style="background:' + STATUS_INFO[daStatus(r)].color + '"></span>' + STATUS_INFO[daStatus(r)].label, 'l'],
          ['Orders today', (r) => r.ordersCount], ['Assigned orders', (r) => r.numberOfAssignedOrders], ['Assigned trips', (r) => r.numberOfAssignedTrips],
        ], snap.list.filter((d) => daStatus(d) !== 'U' || d.ordersCount).sort((a, b) => order[daStatus(a)] - order[daStatus(b)] || (b.ordersCount || 0) - (a.ordersCount || 0))));
      }
      // data sources
      const ago = (t) => (t ? hm((Date.now() - t) / MIN) + ' ago' : '–');
      const src = [
        { s: 'Orders, picker queue, DA list', f: 'Alerts, orders in the FP, DAs right now, picking speed', t: PKREC.last || DAREC.last, e: PKREC.lastError || DAREC.lastError, n: NET.picker },
        { s: 'Capacity (DCM)', f: 'Capacity section, full-slot and forced-order alerts', t: Object.values(DCM.slots).reduce((m, x) => Math.max(m, x.t || 0), 0) || DCM.configAt, e: DCM.err, n: NET.dcm },
        { s: 'Auto-assign status', f: 'Alert when the auto-assign engine is off', t: DCM.engineAt, e: NET.fleet && NET.fleet.err, n: NET.fleet },
        { s: 'FP status', f: 'Open / busy / closed chip and alerts', t: FPSTAT.at, e: FPSTAT.err, n: NET.www },
        { s: 'Zones', f: 'Zones map', t: (FPSTAT.loadAreas(fpIdFromCapture() || '') || {}).savedAt, e: FPSTAT.areasErr, n: null },
      ];
      h += card('Data sources', 'Where each part of this page comes from and when the brain last read it. <b>Last read</b> = how long ago it fetched that source; if it says more than a few minutes while the Control Room is open, that part of the page is stale. <b>Problem</b> = the error the source returned (usually an expired login: refresh the Control Room page). The brain only reads; it never changes anything.', table([
        ['Source', (r) => r.s, null, 'l'], ['Feeds', (r) => r.f, null, 'l'], ['Last read', (r) => r.t || 0, (r) => ago(r.t)], ['Problem', (r) => r.e || '', (r) => (r.e ? '<span class="err">' + esc(r.e) + '</span>' : '<span class="muted">–</span>'), 'l'],
      ], src));
      return h;
    },

    capacity(A) {
      const fp = fpIdFromCapture() || (UI.meta && UI.meta.fps[0]);
      let h = '';
      const now = new Date();
      const cur = DCM.current();
      const nextT = DCM.slotForHour((now.getHours() + 1) % 24);
      const next = nextT && DCM.slots[nextT.id] && Date.now() - DCM.slots[nextT.id].t < 20 * MIN ? DCM.slots[nextT.id] : null;
      h += '<div class="mapbar"><button class="ghost" data-dcmload>↻ Read DCM now</button><span class="mini">' + (DCM.err ? '<span class="err">' + esc(DCM.err) + '</span>' : cur ? 'Read at ' + fmtTime(cur.t) : 'Not read yet') + '</span></div>';
      h += '<div class="note"><b>How DCM sets capacity:</b> it takes the average DPH of the DAs available and multiplies by how many there are (plus any manual change you made). <b>It ignores pickers completely.</b> So when you are short of pickers DCM keeps letting orders in and they queue in the FP; when pickers are free but DAs are few, DCM is the right limit. Below, the brain adds up the speed of every picker and DA working now, each at their own PPH / DPH, and tells you what to set: the lower of the two sides. The brain never changes DCM.</div>';
      const slotTiles = (s, label) => '<div class="tiles">' +
        tile(label, shortHour(s.hour) + ' slot', s.name) +
        tile('DCM capacity', s.capacity, (s.meta && s.meta.delta && s.meta.delta.value ? (s.meta.delta.value > 0 ? '+' : '−') + Math.abs(s.meta.delta.value) + ' manual' : 'no manual change')) +
        tile('Orders placed', s.ordersPlaced, s.backlog ? s.backlog + ' backlog' : '') + tile('Still open', s.availableCapacity, s.availableCapacity <= 0 ? 'slot is full' : '') +
        tile('DAs (DCM)', s.activeDAs, s.availableCount + ' available · ' + s.inTripCount + ' on a trip') + tile('DCM average DPH', fmt(s.averageDph, 2), '') + '</div>';
      if (cur) h += slotTiles(cur, 'Current');
      if (next) h += slotTiles(next, 'Next');
      // ---- what the store can really handle: every picker and DA working now, each at their own speed ----
      const P = LIVE.pending();
      const pkRate = ownRateBook(A, 'pk'), daRate = ownRateBook(A, 'da');
      const pkList = A && A.pk ? A.pk.list : [];
      const sameName = (a, b) => !!(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
      // pickers: picking now (live queue) or packed an order in the last 45 min
      const pkAct = new Map();
      if (P) P.filter((x) => x.stage === 'Picking' && x.picker).forEach((x) => pkAct.set(x.picker.toLowerCase(), { name: x.picker, now: true }));
      if (A && A.isToday) pkList.forEach((p) => { if (p.last && Date.now() - p.last < 45 * MIN) { const k = String(p.name || p.id).toLowerCase(); pkAct.set(k, Object.assign(pkAct.get(k) || {}, { name: p.name })); } });
      // and pickers whose shift on Picker shifts covers now, picks or not (quiet hours)
      if (A && A.isToday) {
        const nowT = Date.now(), R = ROSTER.load();
        Object.keys(R.pickers).forEach((k) => {
          const q = R.pickers[k]; if (q.excluded || !ROSTER.hasShift(k)) return;
          if (!shiftWindows(k, UI.meta.date).some((w) => !w.off && nowT >= w.a && nowT < w.b)) return;
          const key = String(q.name || q.id).toLowerCase();
          pkAct.set(key, Object.assign({ hr: q.hr, id: q.id }, pkAct.get(key) || {}, { name: q.name, onShift: true }));
        });
      }
      const pkRows = Array.from(pkAct.values()).map((x) => {
        const p = pkList.find((q) => sameName(q.name, x.name));
        const y = Object.assign({}, x, p ? { hr: p.hr, id: p.id, last: p.last, sec: p.secPerSku, orders: p.orders } : {});
        y.r = pkRate(y); return y;
      }).sort((a, b) => b.r.rate - a.r.rate);
      const pkCap = pkRows.reduce((t, x) => t + x.r.rate, 0);
      // DAs: the DAs DCM lists for the slot, each at their own DPH
      const daList = A && A.da ? A.da.list : [];
      const daRowsFor = (s) => ((s && s.deliveryAssociates && s.deliveryAssociates.length ? s.deliveryAssociates : (cur && cur.deliveryAssociates) || [])).map((d) => {
        const y = Object.assign({}, d, { hr: d.hrId });
        const x = daList.find((q) => (q.hr && d.hrId ? String(q.hr) === String(d.hrId) : sameName(q.name, d.name)));
        y.today = x ? x.deliveries : 0; y.r = daRate({ hr: d.hrId, id: x ? x.id : null, name: d.name });
        return y;
      }).sort((a, b) => b.r.rate - a.r.rate);
      const manualTxt = (s) => (s.meta && s.meta.delta && s.meta.delta.value ? ' ' + (s.meta.delta.value > 0 ? '+' : '−') + Math.abs(s.meta.delta.value) + ' manual' : '');
      const verdictCard = (s, label, minsLeft, waiting) => {
        const das = daRowsFor(s);
        const x = Math.round(pkCap), y = Math.round(das.reduce((t, d) => t + d.r.rate, 0)), Z = s.capacity;
        const known = pkRows.length > 0 && das.length > 0;
        const best = Math.min(x, y), limit = x <= y ? 'pickers' : 'DAs';
        const diff = Z - best;
        let verdict;
        if (!pkRows.length) verdict = '<b>Check the floor.</b> No picker packed an order in the last 45 min and none has a shift on Picker shifts covering now, so the brain can\'t judge picking capacity. Your DAs can deliver <b>' + y + '</b> orders an hour; DCM is set to <b>' + Z + '</b>.';
        else if (!das.length) verdict = '<b>Can\'t judge the DA side:</b> DCM lists no DAs for this slot. Your pickers can prepare <b>' + x + '</b> orders an hour; DCM is set to <b>' + Z + '</b>.';
        else {
          verdict = 'Your pickers can prepare <b>' + x + '</b> orders an hour. Your DAs can deliver <b>' + y + '</b>. DCM is set to <b>' + Z + '</b>. ' +
            (Math.abs(diff) <= 2 ? '<span class="pill good">Keep it at ' + Z + '</span>' : '<span class="pill ' + (diff > 0 ? 'bad' : 'good') + '">Set it to ' + best + ': ' + (diff > 0 ? 'lower by ' + diff : 'raise by ' + (-diff)) + '</span>') +
            ' <span class="muted">The limit is the ' + limit + '.</span>';
        }
        let rest = '';
        if (known && minsLeft < 60) {
          const room = Math.max(0, Math.round((best * minsLeft) / 60 - (waiting || 0)));
          rest = '<p class="mini" style="margin-top:8px">Rest of this slot (' + minsLeft + ' min left): DCM still accepts <b>' + Math.max(0, s.availableCapacity) + '</b> more; your team can handle about <b>' + room + '</b>' + (waiting ? ' after the ' + waiting + ' waiting for a picker' : '') + '.</p>';
        }
        const rows = [
          { k: 'Pickers can prepare', n: pkRows.length, cap: pkRows.length ? x : null, src: 'each picker\'s own PPH, added up (list below)' },
          { k: 'DAs can deliver', n: das.length, cap: das.length ? y : null, src: 'each DA\'s own DPH, added up (list below)' },
          { k: 'You should take', n: null, cap: known ? best : null, src: known ? 'the lower of the two: the ' + limit : '' },
          { k: 'DCM is set to', n: s.activeDAs, cap: Z, src: 'DCM: its DAs × its average DPH ' + fmt(s.averageDph, 2) + manualTxt(s) },
        ];
        return card(label + ' slot (' + shortHour(s.hour) + '): ' + (known ? 'take ' + best + ' orders' : 'can\'t judge'), 'Orders per hour, with the people working now. ' + (minsLeft < 60 ? minsLeft + ' min of this slot left.' : 'Full hour, assuming the same people.'),
          '<p style="margin:0 0 12px;font-size:15px;line-height:1.6">' + verdict + '</p>' + table([
            ['', (r) => r.k, (r) => '<b>' + esc(r.k) + '</b>', 'l'], ['People', (r) => r.n, (r) => (r.n == null ? '' : r.n)],
            ['Orders per hour', (r) => r.cap, (r) => (r.cap == null ? '<span class="muted">–</span>' : '<b>' + r.cap + '</b>')], ['Based on', (r) => r.src, null, 'l'],
          ], rows) + rest);
      };
      const ownCell = (r, unit) => (r.own ? r.todayH + ' today · ' + (r.hours - r.todayH) + ' saved' + (r.days ? ' (' + r.days + (r.days === 1 ? ' day)' : ' days)') : '') : '<span class="pill warn">new: ' + fmt(r.rate, 1) + ' ' + unit + '</span>');
      if (cur) {
        const waiting = P ? P.filter((x) => x.stage === 'Waiting for picker').length : 0;
        h += verdictCard(cur, 'Current', Math.max(5, 60 - now.getMinutes()), waiting);
        if (next) h += verdictCard(next, 'Next', 60, 0);
      } else if (!DCM.err) h += '<div class="status">Reading DCM… if this stays empty, open the DCM page once in this browser so the brain can see how it is accessed, then press Read DCM now.</div>';
      if (pkRows.length) {
        h += card('Pickers counted now', 'Picking now, packed an order in the last 45 min, or on shift now (Picker shifts). <b>Own PPH</b> = their picks ÷ their busy hours (clock hours in which they started ' + CFG.PPH_MIN_PICKS + '+ picks), today plus the last ' + CFG.CAP_RATE_DAYS + ' saved days. A picker with no busy hour yet counts as new at ' + CFG.CAP_NEW_PICKER_PPH + ' PPH. ' + settingsLink('Change these'), table([
          ['Picker', (r) => r.name, (r) => esc(r.name) + (r.hr ? ' <span class="muted">' + esc(r.hr) + '</span>' : ''), 'l'],
          ['Own PPH', (r) => r.r.rate, (r) => '<b>' + fmt(r.r.rate, 1) + '</b>'], ['Busy hours', (r) => r.r.hours, (r) => ownCell(r.r, 'PPH'), 'l'],
          ['Sec / SKU today', (r) => r.sec, (r) => (r.sec == null ? '<span class="muted">–</span>' : Math.round(r.sec))], ['Picks today', (r) => r.orders || 0],
          ['Last pick', (r) => r.last || 0, (r) => (r.now ? 'picking now' : r.last ? fmtTime(r.last) + (r.onShift && Date.now() - r.last >= 45 * MIN ? ' · on shift' : '') : r.onShift ? 'on shift, no pick yet' : '–'), 'l'],
        ], pkRows));
      }
      if (cur && cur.deliveryAssociates && cur.deliveryAssociates.length) {
        const drv = new Map((DCM.drivers || []).map((d) => [String(d.userId), d]));
        h += card('DAs counted in the current slot', 'The DAs DCM lists for this slot. <b>Own DPH</b> = their deliveries ÷ their busy hours (clock hours in which they picked up ' + CFG.DPH_MIN_DELIVERIES + '+ orders), today plus the last ' + CFG.CAP_RATE_DAYS + ' saved days; a DA with no busy hour yet counts as new at ' + CFG.CAP_NEW_DA_DPH + ' DPH. <b>DCM capacity</b> is what DCM adds for them this hour.', table([
          ['DA', (r) => r.name, (r) => esc(r.name) + ' <span class="muted">' + esc(r.hrId || '') + '</span> ' + tierBadge(drv.get(String(r.id)) && drv.get(String(r.id)).tier ? drv.get(String(r.id)).tier.effectiveTier : ''), 'l'],
          ['Status', (r) => r.status, (r) => esc(String(r.status || '').replace('_', ' ')), 'l'],
          ['Own DPH', (r) => r.r.rate, (r) => '<b>' + fmt(r.r.rate, 2) + '</b>'], ['Busy hours', (r) => r.r.hours, (r) => ownCell(r.r, 'DPH'), 'l'],
          ['DCM capacity', (r) => r.capacity], ['Override', (r) => r.capacityOverride], ['Delivered today', (r) => r.today], ['Delivered this slot', (r) => r.fulfilledOrders], ['In progress', (r) => r.inProgressOrders], ['Room left', (r) => r.remainingCapacity],
        ], daRowsFor(cur)));
      }

      // the day: capacity vs what happened
      const dk = UI.meta ? UI.meta.date : dateKeyOf(Date.now());
      const rec = fp ? DCM.load(fp, dk) : null;
      const base = DCM.timeslots();
      if (base.length || rec) {
        const rows = [];
        // each hour: the pickers and DAs on the ground, each at their own speed (shared with Root causes)
        const TC = teamCanDo(A, pkRate, daRate);
        const pkByH = TC.pk, daByH = TC.da;
        for (let hh = 0; hh < 24; hh++) {
          const b = base.find((t) => t.hour === hh), r = rec && rec.slots[hh], s = A && A.slots.find((x) => x.slot === hh);
          const sh = A && A.score.hours.find((x) => x.h === hh);
          if (!b && !r && !s) continue;
          rows.push({ h: hh, base: b ? b.capacity : null, cap: r ? dcmUnadj(r) : null, capSet: r ? r.cap : null, deltas: r ? r.deltas : [], placed: r ? r.placed : null, minAvail: r ? r.minAvail : null, active: r ? r.active : null, orders: s ? s.orders : null, shiftedIn: s ? s.shiftedIn : null, eta: sh ? sh.eta : null, pkN: pkByH[hh].n, daN: daByH[hh].n, pkSrc: pkByH[hh].src, daSrc: daByH[hh].src, pkCap: pkByH[hh].n ? pkByH[hh].cap : null, daCap: daByH[hh].n ? daByH[hh].cap : null });
          const z = rows[rows.length - 1]; z.store = z.pkCap != null && z.daCap != null ? Math.min(z.pkCap, z.daCap) : null; z.limit = z.store == null ? '' : z.pkCap <= z.daCap ? 'Pickers' : 'DAs';
        }
        h += card('Capacity vs what happened, ' + esc(dk), '<b>Base</b> = DCM\'s default per DA in that hour. <b>Capacity</b>, <b>placed</b> and <b>lowest room left</b> are recorded every ' + CFG.LIVE_POLL_MIN + ' min while a Control Room tab is open (blank = not recorded). <b>Capacity</b> is the last reading in the hour before any manual change (what it was set to by hand is shown next to it). A slot that hit 0 room left pushed orders to later slots (forced). <b>Pickers / DAs could do</b> = the pickers and DAs on the ground that hour (number in brackets; hover for where each count comes from), each at their own PPH / DPH as above. On the ground = their shift on Picker / DA shifts, the DA availability recording, or first to last activity, ' + CFG.ON_GROUND_MIN + '+ min in the hour, so quiet night hours still count the people there; DCM\'s own count of active DAs is used when higher; <b>FP could do</b> is the lower of the two. <b>DCM vs FP</b> shows where DCM let in more orders than the FP could handle (too high) or held back orders it could have taken (too low).', table([
          ['Hour', (r) => r.h, (r) => esc(slotLabel(r.h)), 'l'], ['Base / DA', (r) => r.base], ['Capacity', (r) => r.cap, (r) => (r.cap == null ? '' : r.capSet !== r.cap ? r.cap + ' <span class="muted">set to ' + r.capSet + '</span>' : r.cap)], ['Manual deltas', (r) => (r.deltas.length ? r.deltas.join(', ') : ''), (r) => (r.deltas.filter((x) => x).length ? r.deltas.join(', ') : '<span class="muted">–</span>')],
          ['Placed', (r) => r.placed], ['Lowest room left', (r) => r.minAvail, (r) => (r.minAvail == null ? '<span class="muted">–</span>' : r.minAvail <= 0 ? '<span class="pill warn">full</span>' : r.minAvail)], ['Active DAs', (r) => r.active],
          ['Orders in slot', (r) => r.orders], ['Forced into slot', (r) => r.shiftedIn],
          ['Pickers could do', (r) => r.pkCap, (r) => (r.pkCap == null ? '<span class="muted">–</span>' : '<span data-tip="' + esc(r.pkN + ' on the ground: ' + r.pkSrc) + '">' + fmt(r.pkCap, 0) + ' <span class="muted">(' + r.pkN + ')</span></span>')], ['DAs could do', (r) => r.daCap, (r) => (r.daCap == null ? '<span class="muted">–</span>' : '<span data-tip="' + esc(r.daN + ' on the ground: ' + r.daSrc) + '">' + fmt(r.daCap, 0) + ' <span class="muted">(' + r.daN + ')</span></span>')], ['FP could do', (r) => r.store, (r) => (r.store == null ? '<span class="muted">–</span>' : '<b>' + fmt(r.store, 0) + '</b>')], ['Limit', (r) => r.limit, null, 'l'],
          ['DCM vs FP', (r) => (r.cap != null && r.store != null ? r.cap - r.store : null), (r) => (r.cap == null || r.store == null ? '<span class="muted">–</span>' : r.cap - r.store > 2 ? '<span class="pill bad">' + Math.round(r.cap - r.store) + ' too high</span>' : r.store - r.cap > 2 ? '<span class="pill warn">' + Math.round(r.store - r.cap) + ' too low</span>' : '<span class="pill good">fits</span>')],
          ['ETA late %', (r) => r.eta, (r) => kpiPill('eta', r.eta)],
        ], rows));
      }
      return h;
    },

    da_tiers(A) {
      const list = DCM.drivers;
      if (!list) return '<div class="status">Loading DA tiers from DCM… <br><br><button class="ghost" data-drvload>Try again</button>' + (NET.dcm && NET.dcm.err ? '<br><br><span class="err">' + esc(NET.dcm.err) + '</span><br>Open the DCM page once in this browser, then try again.' : '') + '</div>';
      const today = new Map(((A && A.da && A.da.list) || []).map((x) => [String(x.hr), x]));
      const rows = list.map((d) => {
        const t = d.tier || {}, m = t.metrics || {}, td = today.get(String(d.hrId));
        return { name: d.name, hr: d.hrId, status: d.status, locked: d.locked, eff: t.effectiveTier, orig: t.originalTier, over: t.isOverridden, reason: t.overriddenReason, dpi: m.dpi, dph: m.dph, ldr: m.ldr, sr: m.successRate, cr: m.complaintRate, todayDel: td ? td.deliveries : null, todayDph: td && !td.shortSpan ? td.dph : null };
      });
      const W = DCM.config && DCM.config.tierConfig ? DCM.config.tierConfig.dpiWeights : null;
      const bands = DCM.config && DCM.config.tierConfig ? DCM.config.tierConfig.tiers : null;
      const overN = rows.filter((r) => r.over).length;
      let h = '<div class="note"><b>Tier</b> sets each DA\'s capacity in DCM and max drops per trip in auto-assign. The <b>DPI</b> score' + (W ? ' weighs DPH ' + W.dph + '%, late delivery rate ' + W.ldr + '%, complaint rate ' + W.cr + '%, success rate ' + W.sr + '%' : '') + (bands ? '; tiers: ' + bands.map((b) => b.code + ' ' + b.label + ' ' + b.minRate + (b.maxRate != null ? '–' + b.maxRate : '+')).join(', ') : '') + '. Metrics are DCM\'s own (rolling), not today\'s. <b>Complaint rate</b> here is the only complaints data the brain can see.</div>';
      h += '<div class="tiles">' + tile('DAs on the FP', rows.length, '') + ['T0', 'T1', 'T2', 'T3'].map((t) => tile(t, rows.filter((r) => r.eff === t).length, '')).join('') + tile('Overridden', overN, 'tier set by hand') + '</div>';
      h += card('DA tiers', 'Sorted by DPI. LDR = late delivery rate.', table([
        ['DA', (r) => r.name, (r) => esc(r.name) + ' <span class="muted">' + esc(r.hr || '') + '</span>', 'l'], ['Status', (r) => r.status, (r) => esc(r.status || '') + (r.locked ? ' · locked' : ''), 'l'],
        ['Tier', (r) => r.eff, (r) => tierBadge(r.eff) + (r.over ? ' <span class="mini">was ' + esc(r.orig || '?') + (r.reason ? ', ' + esc(r.reason) : '') + '</span>' : ''), 'l'],
        ['DPI', (r) => r.dpi, (r) => fmt(r.dpi, 2)], ['DPH (DCM)', (r) => r.dph, (r) => dphPill(r.dph)], ['LDR', (r) => r.ldr, (r) => fmtPct(r.ldr != null ? r.ldr * 100 : null)],
        ['Success rate', (r) => r.sr, (r) => fmtPct(r.sr != null ? r.sr * 100 : null)], ['Complaint rate', (r) => r.cr, (r) => (r.cr ? '<span class="pill ' + (r.cr >= 0.02 ? 'bad' : 'warn') + '">' + fmtPct(r.cr * 100) + '</span>' : '<span class="muted">0%</span>')],
        ['Delivered today', (r) => r.todayDel], ['DPH (Ops) today', (r) => r.todayDph, (r) => dphPill(r.todayDph)],
      ], rows.sort((a, b) => (b.dpi || 0) - (a.dpi || 0))));
      return h;
    },

    shifted(A, M) {
      let h = DAY_VIEWS.shifted(A, M);
      const fp = M.fps[0];
      const rec = fp ? FPSTAT.load(fp, M.date) : null;
      if (rec && rec.ev.length) {
        h += card('FP status changes (recorded)', 'Checked every ' + CFG.FP_STATUS_POLL_MIN + ' min while a Control Room tab was open. * = forced.', table([
          ['Time', (r) => r[0], (r) => fmtTime(r[0]), 'l'], ['Status', (r) => r[1], (r) => '<span class="pill ' + (/^AVAILABLE$/.test(r[1]) ? 'good' : 'warn') + '">' + esc(r[1]) + '</span>', 'l'], ['Until', (r) => r[2] || '', (r) => (r[2] ? esc(String(r[2])) : '<span class="muted">–</span>'), 'l'],
        ], rec.ev));
      } else h += '<div class="note">No FP status recorded for this date. While a Control Room tab is open, the brain checks whether the FP is open, busy or forced every ' + CFG.FP_STATUS_POLL_MIN + ' min, so next time you\'ll see exactly when it closed.</div>';
      return h;
    },

    log() {
      const all = LOG.load();
      const H = UI.history || loadHistory();
      const entries = [];
      Object.keys(all).forEach((dk) => Object.keys(all[dk].kpis || {}).forEach((k) => entries.push(Object.assign({ dk, kpi: k }, all[dk].kpis[k]))));
      let h = '<div class="mapbar"><button class="ghost" data-logcsv>Export log (CSV)</button><span class="mini">Stored in this browser only. Export it now and then as a backup.</span></div>';
      // v1.26.1: the brain's guess is saved with each entry; it was right when you kept it as the root cause (before, nothing filled "score")
      const scored = entries.filter((e) => e.guess && e.cause);
      const hit = scored.length ? (100 * scored.filter((e) => e.cause === e.guess).length) / scored.length : null;
      h += '<div class="tiles">' + tile('Days logged', Object.keys(all).length, '') + tile('Misses logged', entries.filter((e) => e.cause).length, '') + tile('Guesses scored', scored.length, 'saved with the brain\'s guess') + tile('Guess accuracy', hit != null ? fmt(hit, 0) + '%' : '–', 'your root cause = the brain\'s guess') + '</div>';
      // pattern matrix
      const keys = KPI_DEFS.map((d) => d.key);
      const causes = LOG.CAUSES.filter((c) => entries.some((e) => e.cause === c));
      if (causes.length) {
        h += card('Root causes by KPI', 'How often each cause came up when a KPI missed. The biggest cells are your recurring problems: fix the system behind them, not just the day.', '<div class="tw"><table class="heat"><thead><tr><th class="l">Root cause</th>' + keys.map((k) => '<th>' + kpiDef(k).label + '</th>').join('') + '<th>Total</th></tr></thead><tbody>' +
          causes.map((c) => { const row = keys.map((k) => entries.filter((e) => e.cause === c && e.kpi === k).length); const tot = row.reduce((a, b) => a + b, 0); const mx = Math.max(1, ...causes.map((cc) => entries.filter((e) => e.cause === cc).length)); return '<tr><td class="l">' + esc(c) + '</td>' + row.map((n) => (n ? '<td style="background:rgba(170,3,130,' + (0.12 + 0.6 * (n / mx)).toFixed(2) + ');font-weight:650">' + n + '</td>' : '<td class="muted">·</td>')).join('') + '<td><b>' + tot + '</b></td></tr>'; }).join('') + '</tbody></table></div>');
      }
      // misses per KPI across saved days
      const days = Object.values(H).sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? 1 : -1));
      const missRows = keys.map((k) => {
        const d = kpiDef(k);
        const vals = days.map((x) => ({ date: x.date, v: x.kpi ? x.kpi[k] : null })).filter((x) => x.v != null);
        const miss = vals.filter((x) => ['bad', 'warn'].includes(kpiStatus(d, x.v)));
        const logged = miss.filter((x) => all[x.date] && all[x.date].kpis && all[x.date].kpis[k] && all[x.date].kpis[k].cause).length;
        let streak = 0; for (const x of vals) { if (['bad', 'warn'].includes(kpiStatus(d, x.v))) streak++; else break; }
        return { label: d.label, days: vals.length, miss: miss.length, logged, streak, avg: avg(vals.map((x) => x.v)), key: k };
      });
      h += card('Misses across saved days', '<b>Streak</b> = days in a row the KPI has missed, counting back from the latest saved day.', table([
        ['KPI', (r) => r.label, null, 'l'], ['Days measured', (r) => r.days], ['Missed', (r) => r.miss], ['Miss rate', (r) => rate(r.miss, r.days), (r) => fmtPct(rate(r.miss, r.days))], ['Current streak', (r) => r.streak, (r) => (r.streak >= 3 ? '<span class="pill bad">' + r.streak + ' days</span>' : r.streak)],
        ['Average', (r) => r.avg, (r) => kpiPill(r.key, r.avg)], ['Misses you logged', (r) => r.logged],
      ], missRows));
      h += card('Every entry', '', entries.length ? table([
        ['Date', (r) => dateKey(r.dk), (r) => esc(r.dk), 'l'], ['KPI', (r) => (kpiDef(r.kpi) || { label: r.kpi }).label, null, 'l'], ['Value', (r) => r.value, (r) => (r.value != null ? kpiPill(r.kpi, r.value) : '–')],
        ['Root cause', (r) => r.cause || '', null, 'l'],
        ['What you found', (r) => r.note || '', (r) => '<span style="white-space:normal">' + esc(r.note || '') + '</span>', 'l'], ['Action', (r) => r.action || '', (r) => '<span style="white-space:normal">' + esc(r.action || '') + '</span>', 'l'],
      ], entries.sort((a, b) => (dateKey(a.dk) < dateKey(b.dk) ? 1 : -1))) : '<p class="muted">Nothing logged yet. Use "Log today\'s misses" at the bottom of the Scorecard.</p>');
      return h;
    },

    history() {
      const H = UI.history || loadHistory();
      const list = Object.values(H).sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? 1 : -1));
      if (!list.length) return '<div class="status">No saved days yet. Every date you load is saved here.</div>';
      const k = BRAIN_VIEWS._hk || 'eta';
      const d = kpiDef(k);
      const val = (x, key) => { const q = x.kpi || {}; if (q[key] != null) return q[key]; if (key === 'pph') return q.pphTeam; if (key === 'dph') return q.dphTeam; return null; };
      // ≈ = saved with an older rule: v1.12–1.15 ETA late counted every order; before v1.16 forced was "under 12 h ahead" by slot day and
      // auto-assign counted same-DA re-assignments as manual; before v1.12 PPH / DPH were per-person averages. Also imported team rates,
      // and a day whose orders placed for the next day weren't delivered yet when it was saved.
      const approx = (x, key) => {
        const q = x.kpi || {};
        if (q[key] == null) return (key === 'pph' && q.pphTeam != null) || (key === 'dph' && q.dphTeam != null);
        if (key === 'eta') return q.def === 2;
        if (key === 'p90f') return (q.def || 0) < 3 || !!x.fpool;
        if (key === 'auto') return (q.def || 0) < 3;
        if (key === 'pph' || key === 'dph') return (q.def || 0) < 4;   // v1.26: one start-hour rule, no quiet-hour exception
        return false;
      };
      const chrono = list.slice().reverse().slice(-31);
      const items = chrono.map((x) => { const v = val(x, k); return { label: x.date, short: x.date.slice(0, 5), values: { v: v || 0 }, v, tip: '<b>' + esc(x.date) + '</b><br>' + d.label + ': ' + kpiFmt(d, v) + (approx(x, k) ? ' (≈ older rule)' : '') + '<br>' + ((x.day && x.day.orders) || '–') + ' orders' }; });
      const maxV = Math.max(d.target() * 1.3, ...items.map((i) => i.v || 0));
      let h = '<div class="mapbar"><div class="seg" data-hk>' + KPI_DEFS.map((x) => '<button data-v="' + x.key + '" class="' + (x.key === k ? 'on' : '') + '">' + x.label + '</button>').join('') + '</div></div>';
      h += card(d.label + ' by day', d.def + ' Dashed line = target.', stackedChart(items, [{ key: 'v', color: (it) => (kpiStatus(d, it.v) === 'good' ? 'var(--ontime)' : kpiStatus(d, it.v) === 'warn' ? '#EDC246' : 'var(--late)') }], { target: d.target(), max: maxV, pct: d.unit === '%', h: 210, aria: d.label + ' by day' }));
      const logs = LOG.load();
      h += card('Saved days', '<b>≈</b> = saved with an older way of counting; load that date again to recalculate it. Also shown while P90 incl. forced waits for the orders placed that day for the next day.', table([
        ['Date', (r) => dateKey(r.date), (r) => esc(r.date), 'l'], ['Orders', (r) => r.day && r.day.orders],
        ...KPI_DEFS.map((x) => [x.label, (r) => val(r, x.key), (r) => kpiPill(x.key, val(r, x.key)) + (approx(r, x.key) ? ' <span class="mini">≈</span>' : '')]),
        ['Pickers', (r) => r.pk && r.pk.pickerCount], ['DAs', (r) => r.da && r.da.activeDAs],
        ['Top late reason', (r) => { const q = r.day && r.day.reasons; if (!q) return ''; const t = Object.keys(q).sort((a, b) => q[b] - q[a])[0]; return t ? t + ' (' + q[t] + ')' : ''; }, null, 'l'],
        ['Logged', (r) => (logs[r.date] ? Object.keys(logs[r.date].kpis || {}).length : 0), (r) => (logs[r.date] ? '<span class="pill good">' + Object.keys(logs[r.date].kpis || {}).length + '</span>' : '<span class="muted">–</span>')],
        ['Status', (r) => (r.day && r.day.inProgress ? 'open' : 'final'), (r) => (r.day && r.day.inProgress ? '<span class="pill warn">' + r.day.inProgress + ' open</span>' : '<span class="muted">final</span>'), 'l'],
      ], list));
      return h;
    },
  };

  // Event wiring for brain pages (after render)
  const BIND = {
    scorecard(main) {
      const A = UI.data, M = UI.meta, dk = M.date;
      main.querySelectorAll('[data-jump]').forEach((el) => el.addEventListener('click', () => { const t = main.querySelector('#dx-' + el.dataset.jump); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
      bindCalib(main, dk);
      const entryBase = (k) => { const d = kpiDef(k); const v = A.score.v[k]; return { value: v != null ? +Number(v).toFixed(d.d) : null, target: d.target(), status: kpiStatus(d, v), dm: A.score.dx[k].dm }; };
      main.querySelectorAll('[data-savelog]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.savelog, row = main.querySelector('[data-logrow="' + k + '"]');
        const f = (n) => row.querySelector('[data-f="' + n + '"]').value.trim();
        LOG.put(dk, M.fpNames.join(', '), k, Object.assign(entryBase(k), { cause: f('cause'), note: f('note'), action: f('action'), guess: suggestCause(k, A) }));   // guess: the brain's pre-filled cause, for Guess accuracy
        b.blur(); UI.render(true);
      }));
    },
    live(main) { },
    capacity(main) {
      const b = main.querySelector('[data-dcmload]');
      if (b) b.addEventListener('click', () => { b.disabled = true; b.textContent = 'Reading…'; const fp = fpIdFromCapture(); if (fp) DCM.loadConfig(fp, true).catch(() => { }).then(() => DCM.poll()).then(() => UI.render(true)); });
      if (!DCM.current() && !DCM.err && !BIND._capTried) { BIND._capTried = true; DCM.poll().then(() => { if (UI.tab === 'now') UI.render(true); }); }
    },
    da_tiers(main) {
      const b = main.querySelector('[data-drvload]');
      const fp = fpIdFromCapture();
      const go = () => fp && Promise.allSettled([DCM.loadDrivers(fp, true), DCM.loadConfig(fp)]).then(() => { if (UI.tab === 'da_tiers') UI.render(true); });
      if (b) b.addEventListener('click', go);
      if (!DCM.drivers && !BIND._drvTried) { BIND._drvTried = true; go(); }
    },
    log(main) {
      const b = main.querySelector('[data-logcsv]');
      if (b) b.addEventListener('click', () => UI.download(LOG.csv(), 'kpi-log-' + dateKeyOf(Date.now()) + '.csv'));
    },
    accountability(main) { bindAcc(main); },
    da_ranking(main) { bindRank(main, 'da'); },
    pk_ranking(main) { bindRank(main, 'pk'); },
    history(main) {
      main.querySelectorAll('.seg[data-hk] button').forEach((b) => b.addEventListener('click', () => { BRAIN_VIEWS._hk = b.dataset.v; UI.render(); }));
    },
  };

  /* ------------------------------------------------------------------
   * ROOT CAUSES – executive overview, timeslot by timeslot: what went wrong and why.
   * Rules (agreed 19 Oct 2026):
   *  - every timeslot in one table; a full breakdown for each slot that missed ETA late % or P90;
   *  - main root cause = the cause behind most of the slot's late orders, the others listed as contributing;
   *    a slot on target for ETA late % that missed P90: forced orders (P90 incl. forced only) or the stage that added
   *    the most minutes to its slowest NOW orders;
   *  - DCM opened the slot right = its capacity within ROOT_DCM_TOL_PCT of what the pickers and DAs on the ground that hour
   *    could handle, each at their own speed (the same numbers as Capacity).
   * ------------------------------------------------------------------ */
  const rcDot = (c) => '<span class="st-dot" style="background:' + (RC_COLORS[c] || '#AC9C93') + '"></span>';
  const rcHelp = (c) => (RC_HELP[c] || '').replace('{m}', CFG.ROOT_RIDE_SLOW_MIN);

  function rootCauses(A) {
    tripContext(A);
    const S = A.score, T = CFG;
    const fp = fpIdFromCapture() || (UI.meta && UI.meta.fps[0]);
    const dk = UI.meta ? UI.meta.date : dateKeyOf(Date.now());
    const ds0 = (A.pk && A.pk.dayStart) || dayStartOf(dk);
    const dcmRec = fp ? DCM.load(fp, dk) : null;
    const TC = teamCanDo(A);
    const cov = (A.da && A.da.coverage) || [];
    const recAvailH = (h) => { const c = cov[h]; return c && c.recAvail != null ? c.recAvail : null; };
    const main = S.main;
    const nowDel = main.filter((r) => r.delivered && !r.scheduled);
    const usual = {
      wait: median(nowDel.map((r) => r.waitMin)), handle: median(nowDel.map((r) => r.handleMin)), shelf: median(nowDel.map((r) => r.shelfMin)), leg: median(nowDel.map((r) => r.legMin)),
      skus: avg(main.map((r) => r.skus).filter((v) => v != null)), stacked: rate(main.filter((r) => r.delivered && r.dropsBefore > 0).length, main.filter((r) => r.delivered).length),
    };
    const rideBase = (area) => { const a = HANDOFF.areas[area]; return a && a.n >= CFG.HANDOFF_MIN_ORDERS ? a.med : HANDOFF.overall; };
    const rideExtra = (r) => { const b = rideBase(r.subArea); return r.legMin != null && b != null ? r.legMin - b : null; };
    // FP status changes recorded while a Control Room tab was open
    const fs = fp ? FPSTAT.load(fp, dk) : null;
    const fsEv = fs && fs.ev ? fs.ev.slice().sort((a, b) => a[0] - b[0]) : [];
    const statusIn = (a, b) => {
      if (!fsEv.length) return null;
      const out = [];
      fsEv.forEach((e, i) => {
        const s0 = e[0], s1 = i + 1 < fsEv.length ? fsEv[i + 1][0] : Math.max(fs.last || s0, s0);
        if (String(e[1]).indexOf('AVAILABLE') === 0 || s1 <= a || s0 >= b) return;
        out.push({ s: String(e[1]).replace('*', ' (forced)'), from: Math.max(s0, a), to: Math.min(s1, b) });
      });
      return out;
    };
    const covered = (a, b) => fsEv.length && fsEv[0][0] <= b && (fs.last || 0) >= a;

    // the cause of one late order: the same category every page shows (lateCatOf in score.js)
    const catOf = (r) => lateCatOf(r, A);
    const order = (a, b) => b[1] - a[1] || RC_CATS.indexOf(a[0]) - RC_CATS.indexOf(b[0]);
    const tolOf = (v) => Math.max(1, (T.ROOT_DCM_TOL_PCT / 100) * v);

    const slots = S.hours.filter((x) => x.orders).map((x) => {
      const h = x.h, a = ds0 + h * 3600000, b = a + 3600000;
      const g = main.filter((r) => r.slot === h);
      const del = g.filter((r) => r.delivered), late = del.filter((r) => r.late);
      const cats = {};
      late.forEach((r) => { const c = catOf(r); r.rcCat = c; cats[c] = (cats[c] || 0) + 1; });
      const causeList = Object.entries(cats).sort(order);
      const miss = { eta: x.eta != null && x.eta > T.LATE_TARGET_PCT, p90n: x.p90n != null && x.p90n > T.P90_TARGET_MIN, p90f: x.p90f != null && x.p90f > T.P90_TARGET_MIN };
      const missed = miss.eta || miss.p90n || miss.p90f;
      const forcedIn = g.filter((r) => r.scheduled && !r.plannedAhead);
      const forcedDel = forcedIn.filter((r) => r.delivered);
      // main root cause
      let cause = null, causeN = 0, causeWhy = '', causeBy = 'late';
      if (missed && miss.eta && causeList.length) { cause = causeList[0][0]; causeN = causeList[0][1]; causeWhy = causeN + ' of ' + late.length + ' late orders'; }
      else if (missed && (miss.p90n || miss.p90f)) {
        causeBy = 'p90';
        if (miss.p90f && !miss.p90n) {
          cause = 'Forced orders'; causeN = forcedDel.length;
          causeWhy = forcedDel.length + ' forced orders, median ' + fmt(median(forcedDel.map((r) => r.deliveryMin)), 0) + ' min from placing to delivery; NOW orders alone were ' + fmt(x.p90n) + ' min';
        } else {
          // the stage that added the most minutes to the slowest NOW orders
          const nd = del.filter((r) => !r.scheduled && r.deliveryMin != null);
          const slow = nd.filter((r) => r.deliveryMin >= x.p90n);
          const ex = (f, u) => median(slow.map(f).filter((v) => v != null).map((v) => v - (u || 0)));
          const stages = [
            ['Picker shortage', ex((r) => r.waitMin, usual.wait), 'waiting for a picker'],
            ['Slow picking', ex((r) => r.handleMin, usual.handle), 'picking'],
            [recAvailH(h) != null && recAvailH(h) >= 1 ? 'Free DAs not assigned' : 'DA shortage', ex((r) => r.shelfMin, usual.shelf), 'awaiting pickup'],
            [slow.filter((r) => r.dropsBefore > 0).length > slow.length / 2 ? 'Multi-order trip' : 'Slow DA', ex(rideExtra, 0), 'on the ride'],
          ].filter((s) => s[1] != null).sort((p, q) => q[1] - p[1]);
          if (stages.length && stages[0][1] > 0) { cause = stages[0][0]; causeN = slow.length; causeWhy = 'its slowest NOW orders lost +' + fmt(stages[0][1], 0) + ' min ' + stages[0][2] + ' vs a usual order today'; }
          else { cause = 'No clear cause'; causeWhy = 'no stage stood out'; }
        }
      }
      // capacity: DCM (last reading before any manual change) vs what the team on the ground that hour could handle
      const pk = TC.pk[h], da = TC.da[h];
      const could = pk.n && da.n ? Math.min(pk.cap, da.cap) : null;
      const limit = could == null ? null : pk.cap <= da.cap ? 'pickers' : 'DAs';
      const rs = dcmRec && dcmRec.slots ? dcmRec.slots[h] : null;
      const cap = dcmUnadj(rs);   // last reading, before any manual change
      let dcm = cap == null ? 'not recorded' : could == null ? 'no team data' : cap > could + tolOf(could) ? 'too high' : cap < could - tolOf(could) ? 'too low' : 'right';
      const full = !!(rs && rs.minAvail != null && rs.minAvail <= 0);
      const capTxt = cap == null ? null : cap + dcmManual(rs);
      // evidence
      const ph = A.pk && A.pk.hours ? A.pk.hours[h] : null;
      const pkRowsH = A.pk ? A.pk.rows.filter((r) => r.packed >= a && r.packed < b) : [];
      const spIdx = median(pkRowsH.map((r) => r.speedIdx).filter((v) => v != null));
      const secH = median(pkRowsH.map((r) => r.secPerSku).filter((v) => v != null));
      const shelfH = median(del.map((r) => r.shelfMin));
      const firstDrops = del.filter((r) => !r.dropsBefore);
      const rideH = median(firstDrops.map(rideExtra).filter((v) => v != null));
      const stacked = del.filter((r) => r.dropsBefore > 0).length;
      const skusH = avg(g.map((r) => r.skus).filter((v) => v != null));
      const large = g.filter((r) => r.skus >= T.LARGE_BASKET_SKUS).length;
      const nowPlaced = g.filter((r) => !r.scheduled && r.placed != null).map((r) => r.placed).sort((p, q) => p - q);
      let burst = 0, burstAt = null;
      for (let i = 0, j = 0; j < nowPlaced.length; j++) { while (nowPlaced[j] - nowPlaced[i] >= 15 * MIN) i++; if (j - i + 1 > burst) { burst = j - i + 1; burstAt = nowPlaced[i]; } }
      const burstPct = nowPlaced.length ? (100 * burst) / nowPlaced.length : null;
      const cv = cov[h] || {};
      const st = statusIn(a, b);
      const checks = [];
      const add = (k, bad, txt, short) => checks.push({ k, bad, txt, short });
      add('Orders', could != null && x.orders > could + tolOf(could), x.orders + ' orders (' + g.filter((r) => !r.scheduled).length + ' NOW, ' + g.filter((r) => r.scheduled).length + ' scheduled)' + (could != null ? '; the team on the ground could handle about ' + Math.round(could) + ' (limited by the ' + limit + ')' : ''), could != null && x.orders > could + tolOf(could) ? (x.orders - Math.round(could)) + ' over what the team could do' : '');
      add('DCM capacity', dcm === 'too high' || dcm === 'too low' ? true : dcm === 'right' ? false : null,
        dcm === 'not recorded' ? 'Not recorded for this hour (the Control Room wasn\'t open then).' : dcm === 'no team data' ? 'DCM opened ' + capTxt + '; no picker or DA on the ground to compare with.' :
          'DCM opened <b>' + capTxt + '</b>; the team on the ground could handle about <b>' + Math.round(could) + '</b> (' + pk.n + ' pickers → ' + Math.round(pk.cap) + ', ' + da.n + ' DAs → ' + Math.round(da.cap) + '): ' + (dcm === 'right' ? 'sized right' : dcm === 'too high' ? '<b>' + Math.round(cap - could) + ' too high</b>' : '<b>' + Math.round(could - cap) + ' too low</b>') + '.' + (full ? ' The slot hit 0 room left: later orders were pushed to other slots.' : ''),
        dcm === 'too high' ? 'DCM ' + Math.round(cap - could) + ' too high' : dcm === 'too low' ? 'DCM ' + Math.round(could - cap) + ' too low' : '');
      add('Forced orders', forcedIn.length >= 3 && (100 * forcedIn.length) / x.orders >= T.ROOT_FORCED_PCT, forcedIn.length ? forcedIn.length + ' forced orders moved into this slot (' + fmtPct(rate(forcedIn.length, x.orders)) + ' of its orders)' + (forcedDel.length ? ', median ' + fmt(median(forcedDel.map((r) => r.deliveryMin)), 0) + ' min from placing to delivery' : '') + '.' : 'None.', forcedIn.length >= 3 && (100 * forcedIn.length) / x.orders >= T.ROOT_FORCED_PCT ? forcedIn.length + ' forced in' : '');
      if (st) add('FP status', st.length ? true : covered(a, b) ? false : null, st.length ? 'The FP was ' + st.map((s) => s.s.toLowerCase() + ' ' + fmtTime(s.from) + '–' + fmtTime(s.to)).join(', ') + ': NOW orders were pushed to later slots.' : covered(a, b) ? 'Open all hour.' : 'Not recorded for this hour.', st.length ? 'FP ' + st[0].s.toLowerCase() : '');
      if (ph) add('Pickers', (ph.medWait != null && ph.medWait > T.WAIT_TARGET_MIN) || (cats['Picker shortage'] || 0) >= 2,
        pk.n + ' pickers on the ground (could do about ' + Math.round(pk.cap) + ' an hour). Queue: average ' + fmt(ph.avgQueue, 1) + ', max ' + ph.maxQueue + '. Median wait for a picker ' + fmt(ph.medWait, 1) + ' min (target ' + T.WAIT_TARGET_MIN + ').' + (cats['Picker shortage'] ? ' <b>' + cats['Picker shortage'] + '</b> late orders waited for a picker.' : ''),
        ph.medWait != null && ph.medWait > T.WAIT_TARGET_MIN ? 'picker wait ' + fmt(ph.medWait, 0) + ' min' : (cats['Picker shortage'] || 0) >= 2 ? cats['Picker shortage'] + ' waited for a picker' : '');
      if (ph) add('Picking speed', (spIdx != null && spIdx >= 1 + T.ROOT_SLOWER_PCT / 100) || (cats['Slow picking'] || 0) >= 2,
        'Median ' + (secH != null ? Math.round(secH) + ' sec per SKU' : '– sec per SKU') + (spIdx != null ? ', ' + (spIdx >= 1 ? Math.round((spIdx - 1) * 100) + '% slower' : Math.round((1 - spIdx) * 100) + '% faster') + ' than usual for those basket sizes' : '') + '; median picking ' + fmt(ph.medHandle, 1) + ' min.' + (cats['Slow picking'] ? ' <b>' + cats['Slow picking'] + '</b> late orders from slow picking.' : ''),
        spIdx != null && spIdx >= 1 + T.ROOT_SLOWER_PCT / 100 ? 'picking ' + Math.round((spIdx - 1) * 100) + '% slower' : (cats['Slow picking'] || 0) >= 2 ? cats['Slow picking'] + ' picked slowly' : '');
      const shelfBad = shelfH != null && usual.shelf != null && shelfH >= usual.shelf * 1.5 && shelfH - usual.shelf >= 3;
      add('DAs', shelfBad || (cats['DA shortage'] || 0) >= 2,
        da.n + ' DAs on the ground (could do about ' + Math.round(da.cap) + ' an hour). Median awaiting pickup ' + fmt(shelfH, 1) + ' min (usual ' + fmt(usual.shelf, 1) + ').' + (cv.recOnline != null ? ' Recorded: ' + fmt(cv.recOnline, 1) + ' DAs online, ' + fmt(cv.recAvail, 1) + ' free with no order.' : '') + (cats['DA shortage'] ? ' <b>' + cats['DA shortage'] + '</b> late orders sat awaiting pickup.' : ''),
        shelfBad ? 'awaiting-pickup time ' + fmt(shelfH, 0) + ' min' : (cats['DA shortage'] || 0) >= 2 ? cats['DA shortage'] + ' waited for pickup' : '');
      if (cats['Free DAs not assigned']) add('Logistics', true, '<b>' + cats['Free DAs not assigned'] + '</b> late orders sat awaiting pickup while about ' + fmt(recAvailH(h), 1) + ' DAs were recorded free with no order.', cats['Free DAs not assigned'] + ' waited with DAs free');
      add('DA ride', (rideH != null && rideH >= T.ROOT_RIDE_SLOW_MIN) || (cats['Slow DA'] || 0) >= 2,
        'First drops: median ' + (rideH == null ? '–' : (rideH >= 0 ? '+' : '−') + fmt(Math.abs(rideH), 1) + ' min') + ' vs the usual ride to the same sub-area.' + (cats['Slow DA'] ? ' <b>' + cats['Slow DA'] + '</b> late from slow rides.' : '') + (cats['Far drop / short ETA'] ? ' <b>' + cats['Far drop / short ETA'] + '</b> late with a normal ride (ETA too short for the distance).' : ''),
        rideH != null && rideH >= T.ROOT_RIDE_SLOW_MIN ? 'rides +' + fmt(rideH, 0) + ' min' : (cats['Slow DA'] || 0) >= 2 ? cats['Slow DA'] + ' slow rides' : '');
      add('Trips', (cats['Multi-order trip'] || 0) >= 2, stacked + ' of ' + del.length + ' deliveries were a 2nd+ drop (' + fmtPct(rate(stacked, del.length)) + ', day ' + fmtPct(usual.stacked) + ').' + (cats['Multi-order trip'] ? ' <b>' + cats['Multi-order trip'] + '</b> late because earlier drops came first.' : ''), (cats['Multi-order trip'] || 0) >= 2 ? cats['Multi-order trip'] + ' late in stacked trips' : '');
      add('Baskets', skusH != null && usual.skus && skusH >= usual.skus * 1.25, 'Average ' + fmt(skusH, 1) + ' SKUs per order (day ' + fmt(usual.skus, 1) + '); ' + large + ' large basket' + (large === 1 ? '' : 's') + ' (' + T.LARGE_BASKET_SKUS + '+ SKUs).', skusH != null && usual.skus && skusH >= usual.skus * 1.25 ? 'big baskets' : '');
      add('Arrival', nowPlaced.length >= 8 && burstPct >= T.ROOT_BURST_PCT, nowPlaced.length ? 'Busiest 15 min (from ' + fmtTime(burstAt) + ') had ' + burst + ' of ' + nowPlaced.length + ' NOW orders (' + fmtPct(burstPct) + '; spread evenly would be 25%).' : 'No NOW orders.', nowPlaced.length >= 8 && burstPct >= T.ROOT_BURST_PCT ? 'burst ' + fmtPct(burstPct) + ' in 15 min' : '');
      const flags = checks.filter((c) => c.bad && c.short).map((c) => c.short);
      return { h, label: x.label, orders: x.orders, delivered: del.length, late: late.length, eta: x.eta, p90n: x.p90n, p90f: x.p90f, miss, missed, cause, causeN, causeWhy, causeBy, causeList, cats,
        pk, da, could, limit, cap, capTxt, dcm, full, forcedIn: forcedIn.length, checks, flags, few: x.orders < 10 };
    });

    // the day
    const allLate = {};
    slots.forEach((s) => Object.keys(s.cats).forEach((c) => { allLate[c] = (allLate[c] || 0) + s.cats[c]; }));
    const missed = slots.filter((s) => s.missed);
    const asMain = {};
    missed.forEach((s) => { if (s.cause) (asMain[s.cause] = asMain[s.cause] || []).push(s); });
    const dcmN = { right: [], 'too high': [], 'too low': [], 'not recorded': [], 'no team data': [] };
    slots.forEach((s) => dcmN[s.dcm].push(s));
    return { slots, missed, allLate, asMain, dcmN, lateTotal: S.etaLate.length };
  }

  function rcBar(counts, total) {
    if (!total) return '<p class="muted">No late orders.</p>';
    const items = Object.entries(counts).filter((e) => e[1]).sort((a, b) => b[1] - a[1] || RC_CATS.indexOf(a[0]) - RC_CATS.indexOf(b[0]));
    return '<div class="causebar" style="height:22px">' + items.map(([c, n]) => '<span data-tip="' + esc(c + ': ' + n + ' (' + Math.round((100 * n) / total) + '%), ' + rcHelp(c)) + '" style="width:' + (100 * n) / total + '%;background:' + RC_COLORS[c] + '"></span>').join('') + '</div>' +
      '<div class="legend">' + items.map(([c, n]) => '<span><i style="background:' + RC_COLORS[c] + '"></i>' + c + ': <b>' + n + '</b> (' + Math.round((100 * n) / total) + '%)</span>').join('') + '</div>';
  }

  BRAIN_VIEWS.rootcause = function (A) {
    const R = rootCauses(A), T = CFG;
    const sl = (list) => list.map((s) => shortHour(s.h)).join(', ');
    const top = Object.entries(R.allLate).sort((a, b) => b[1] - a[1] || RC_CATS.indexOf(a[0]) - RC_CATS.indexOf(b[0]));
    const recorded = R.slots.filter((s) => s.dcm === 'right' || s.dcm === 'too high' || s.dcm === 'too low');
    let h = '<div class="note"><b>How this page decides.</b> Each timeslot\'s <b>root cause</b> is the cause behind most of its late orders; the others are listed as contributing. A slot on target for ETA late % that missed P90 gets the stage that added the most minutes to its slowest orders, or <b>forced orders</b> when only P90 incl. forced missed. <b>DCM sized right</b> = within ' + T.ROOT_DCM_TOL_PCT + '% of what the pickers and DAs on the ground that hour could handle, each at their own speed (the same numbers as Capacity). On the ground = their shift, the DA availability recording, or first to last activity; quiet hours count too. DCM capacity = the last reading in the hour before any manual change, known only for hours when a Control Room tab was open. ' + settingsLink('Change the thresholds') + '</div>';
    // headline
    const lines = [];
    if (!R.missed.length) lines.push('Every timeslot was on target. Nothing to fix today.');
    else {
      lines.push('<b>' + R.missed.length + ' of ' + R.slots.length + '</b> timeslots missed target (' + sl(R.missed) + ').');
      if (top.length) {
        const [c1, n1] = top[0];
        const m1 = R.asMain[c1] || [];
        lines.push('The main root cause was <b>' + c1 + '</b>: ' + n1 + ' of ' + R.lateTotal + ' late orders' + (m1.length ? ', the root cause in ' + m1.length + (m1.length === 1 ? ' slot' : ' slots') + ' (' + sl(m1) + ')' : '') + '. ' + rcHelp(c1).charAt(0).toUpperCase() + rcHelp(c1).slice(1) + '.');
        if (top[1]) lines.push('Next: <b>' + top[1][0] + '</b> (' + top[1][1] + ' late)' + (top[2] ? ', then <b>' + top[2][0] + '</b> (' + top[2][1] + ')' : '') + '.');
      }
      const pOnly = R.missed.filter((s) => s.causeBy === 'p90');
      if (pOnly.length) lines.push(pOnly.length + (pOnly.length === 1 ? ' slot' : ' slots') + ' missed only on P90 (' + pOnly.map((s) => shortHour(s.h) + ': ' + s.cause.toLowerCase()).join(', ') + ').');
      if (recorded.length) {
        const hi = R.dcmN['too high'], lo = R.dcmN['too low'], ok = R.dcmN.right;
        lines.push('DCM opened slots at the right size in <b>' + ok.length + ' of ' + recorded.length + '</b> recorded slots' + (hi.length ? '; <b>too high</b> in ' + sl(hi) + ' (DCM allowed ' + Math.round(hi.reduce((t, s) => t + s.cap - s.could, 0)) + ' orders more than the team could handle, in total)' : '') + (lo.length ? '; too low in ' + sl(lo) : '') + '.');
        const okMissed = R.missed.filter((s) => s.dcm === 'right');
        if (okMissed.length) lines.push('In <b>' + okMissed.length + '</b> of the missed slots DCM was sized right, so capacity wasn\'t the problem there: ' + okMissed.map((s) => shortHour(s.h) + ' ' + (s.cause || '').toLowerCase() + (s.flags.length ? ' (' + s.flags.slice(0, 2).join(', ') + ')' : '')).join('; ') + '.');
      } else lines.push('DCM capacity wasn\'t recorded for this date, so the page can\'t say whether DCM opened the slots right. Keep a Control Room tab open during the shift.');
      if (top.length) lines.push('<b>Biggest lever:</b> ' + RC_ACTION[top[0][0]]);
    }
    const c1 = top.length ? top[0][0] : null;
    h += '<div class="kpis">' +
      kpi('Timeslots that missed', R.missed.length + ' <span class="u">of ' + R.slots.length + '</span>', '', 'ETA late % over ' + T.LATE_TARGET_PCT + '% or P90 over ' + T.P90_TARGET_MIN + ' min', R.missed.length ? (R.missed.length > R.slots.length / 4 ? 'bad' : 'warn') : 'good') +
      kpi('Late orders', R.lateTotal, '', fmtPct(A.score.v.eta) + ' of NOW orders delivered (target ' + T.LATE_TARGET_PCT + '%)', statusOf(A.score.v.eta, T.LATE_TARGET_PCT, T.WARN.eta / T.LATE_TARGET_PCT)) +
      kpi('Main root cause', c1 ? rcDot(c1) + '<span style="font-size:20px">' + esc(c1) + '</span>' : '–', '', c1 ? R.allLate[c1] + ' of ' + R.lateTotal + ' late orders' : 'no late orders', null) +
      kpi('DCM sized right', recorded.length ? R.dcmN.right.length + ' <span class="u">of ' + recorded.length + '</span>' : '–', '', recorded.length ? R.dcmN['too high'].length + ' too high, ' + R.dcmN['too low'].length + ' too low' : 'DCM not recorded for this date', recorded.length ? (R.dcmN['too high'].length ? 'warn' : 'good') : null) + '</div>';
    h += card('In one look', '', '<ul class="rcl">' + lines.map((l) => '<li>' + l + '</li>').join('') + '</ul>');
    h += card('Late orders by root cause', 'Every late order of the day, by what made it late. Hover a part of the bar for what it means.', rcBar(R.allLate, R.lateTotal));
    // every slot
    const dcmCell = (s) => (s.cap == null ? '<span class="muted">not recorded</span>' : s.capTxt + ' ' + (s.dcm === 'right' ? '<span class="pill good">right</span>' : s.dcm === 'too high' ? '<span class="pill bad">' + Math.round(s.cap - s.could) + ' too high</span>' : s.dcm === 'too low' ? '<span class="pill warn">' + Math.round(s.could - s.cap) + ' too low</span>' : ''));
    h += card('Every timeslot', 'One line per slot; under each missed slot\'s root cause, the checks that failed. <b>Team could do</b> = the pickers and DAs who worked that hour, each at their own speed, limited by the lower side (hover for both). The full story of each missed slot is below.', table([
      ['Timeslot', (s) => s.h, (s) => '<b>' + esc(s.label) + '</b>', 'l'], ['Orders', (s) => s.orders], ['ETA late %', (s) => s.eta, (s) => latePill(s.eta)],
      ['P90 NOW', (s) => s.p90n, (s) => p90Pill(s.p90n)], ['P90 incl. forced', (s) => s.p90f, (s) => p90Pill(s.p90f)],
      ['Root cause', (s) => (s.cause || ''), (s) => (s.missed ? (s.cause ? rcDot(s.cause) + '<b>' + esc(s.cause) + '</b>' + (s.causeBy === 'late' ? ' <span class="muted">' + s.causeN + ' of ' + s.late + ' late</span>' : ' <span class="muted">(P90)</span>') : '<span class="muted">–</span>') + (s.flags.length ? '<div class="mini" style="white-space:normal;min-width:260px;max-width:380px;margin-top:3px">' + esc(s.flags.join(' · ')) + '</div>' : '') : '<span class="pill good">on target</span>'), 'l'],
      ['DCM', (s) => (s.cap == null ? -1 : s.cap), dcmCell, 'l'],
      ['Team could do', (s) => s.could, (s) => (s.could == null ? '<span class="muted">–</span>' : '<span data-tip="' + esc(s.pk.n + ' pickers on the ground → ' + Math.round(s.pk.cap) + ' an hour (' + s.pk.src + ') · ' + s.da.n + ' DAs → ' + Math.round(s.da.cap) + ' an hour (' + s.da.src + ')') + '">' + Math.round(s.could) + ' <span class="muted">' + s.limit + '</span></span>')],
      ['Forced in', (s) => s.forcedIn],
    ], R.slots));
    // a card per missed slot
    R.missed.forEach((s) => {
      const p = [];
      p.push('<b>' + s.late + ' of ' + s.delivered + '</b> delivered late (' + fmtPct(s.eta) + '), P90 NOW <b>' + fmt(s.p90n) + '</b>, incl. forced <b>' + fmt(s.p90f) + '</b> min.');
      if (s.cause) p.push('Root cause: ' + rcDot(s.cause) + '<b>' + s.cause + '</b>, ' + s.causeWhy + (s.causeBy === 'late' ? ' (' + rcHelp(s.cause) + ')' : '') + '.');
      const contrib = s.causeList.filter(([c]) => c !== s.cause);
      if (contrib.length) p.push('Also: ' + contrib.map(([c, n]) => c + ' ' + n).join(', ') + '.');
      const over = s.could != null && s.orders > s.could + Math.max(1, (CFG.ROOT_DCM_TOL_PCT / 100) * s.could);
      const overTxt = 'the slot still got <b>' + s.orders + '</b> orders' + (s.forcedIn ? ' (' + s.forcedIn + ' forced in from earlier slots)' : '') + ', more than the about ' + Math.round(s.could || 0) + ' the team could handle, so the extra orders queued for the <b>' + s.limit + '</b>';
      const exec = s.flags.filter((f) => !/^DCM |over what the team/.test(f));
      const execTxt = exec.length ? exec.join(', ') : 'see the checks below';
      if (s.dcm === 'too high') p.push('DCM opened <b>' + s.capTxt + '</b> orders but the ' + s.pk.n + ' pickers and ' + s.da.n + ' DAs on the ground could handle about <b>' + Math.round(s.could) + '</b>: DCM let in too many, and the extra orders queued for the <b>' + s.limit + '</b>.');
      else if (s.dcm === 'right') p.push('DCM opened the slot right (' + s.capTxt + ' vs about ' + Math.round(s.could) + ' the team could handle), ' + (over ? 'but ' + overTxt + '.' : 'so capacity wasn\'t the problem. It went wrong in execution: ' + execTxt + '.'));
      else if (s.dcm === 'too low') p.push('DCM opened only ' + s.capTxt + ' while the team could handle about ' + Math.round(s.could) + (s.full ? ' (the slot filled up and later orders were pushed to other slots)' : '') + '. ' + (over ? 'Even so, ' + overTxt + '.' : 'So volume wasn\'t the problem: ' + execTxt + '.'));
      else p.push('DCM capacity wasn\'t recorded for this hour' + (s.could != null ? (over ? '; ' + overTxt : '; the team could handle about ' + Math.round(s.could) + ' and got ' + s.orders + ' orders, so it went wrong in execution: ' + execTxt) : '') + '.');
      const body = '<p style="margin:0 0 12px;line-height:1.6">' + p.join(' ') + '</p>' +
        table([
          ['Check', (c) => c.k, (c) => '<b>' + esc(c.k) + '</b>', 'l'],
          ['', (c) => (c.bad ? 2 : c.bad === false ? 1 : 0), (c) => (c.bad ? '<span class="pill bad">problem</span>' : c.bad === false ? '<span class="pill good">OK</span>' : '<span class="muted">–</span>')],
          ['What happened', (c) => c.txt.replace(/<[^>]*>/g, ''), (c) => '<div style="white-space:normal;min-width:360px;line-height:1.5">' + c.txt + '</div>', 'l'],
        ], s.checks) +
        (s.late ? '<p class="mini" style="margin:14px 0 6px">The ' + s.late + ' late order' + (s.late === 1 ? '' : 's') + ' in this slot, by cause' + (s.causeBy === 'p90' ? ' (the root cause above comes from P90, not from these)' : '') + ':</p>' + rcBar(s.cats, s.late) : '') +
        (s.cause ? '<p style="margin:12px 0 0"><b>Next time:</b> ' + RC_ACTION[s.cause] + ' <button class="ghost sm" data-goto="accountability">See each late order</button></p>' : '');
      h += card(esc(s.label) + ' · ' + (s.cause ? s.cause : 'missed') + (s.few ? ' <span class="muted">(only ' + s.orders + ' orders)</span>' : ''), '', body);
    });
    return h;
  };
  PAGE_DESC.rootcause = 'Timeslot by timeslot: what went wrong, the root cause, whether DCM opened the slot on the right capacity, and if it did, why the KPI still dropped.';

  /* ------------------------------------------------------------------
   * DAY ANALYSIS overrides: forced & shifted, order types, the per-sub-area threshold card
   * ------------------------------------------------------------------ */
  const settingsLink = (txt) => '<button class="ghost sm" data-goto="settings">⚙ ' + (txt || 'Settings') + '</button>';

  // How "packed too late" is judged, per sub-area (v1.26: on ETA Late Analysis, folded; the Late causes page was removed)
  function handoffAreasCard(A) {
    const main = A.rows.filter((r) => !r.subOrder);
    const areas = [];
    groupBy(main, (r) => r.subArea).forEach((g, k) => {
      const a = HANDOFF.areas[k] || {};
      const lt = g.filter((r) => r.late);
      areas.push({ area: k, orders: g.length, rides: a.n || 0, med: a.med, avg: a.avg, thr: g[0] ? handoffOf(g[0]) : null, src: g[0] ? g[0].handoffSrc : '', late: lt.length, ptl: lt.filter((r) => r.cause === 'Packed too late').length, wda: lt.filter((r) => r.cause === 'Awaiting pickup').length, road: lt.filter((r) => r.cause === 'Ride').length });
    });
    const mode = CFG.HANDOFF_MODE === 'fixed';
    return '<details class="card"><summary><b>How "packed too late" is judged · ' + (mode ? 'fixed ' + CFG.HANDOFF_MIN + ' min' : 'per sub-area') + '</b> <span class="mini">· the time each sub-area\'s orders needed to be packed by</span></summary><p class="sub">' +
      (mode ? 'Every order uses ' + CFG.HANDOFF_MIN + ' min. Switch to per sub-area in Settings.' :
        '<b>Usual ride</b> = median minutes from DA pickup to delivered on the first drop of each trip (a direct ride), today. The median is used, not the average, so one DA who forgot to press "delivered" doesn\'t move the bar; the average is shown for comparison. Sub-areas with under ' + CFG.HANDOFF_MIN_ORDERS + ' rides use the FP-wide usual ride (' + fmt(HANDOFF.overall, 1) + ' min). <b>Threshold</b> = usual ride' + (CFG.HANDOFF_BUFFER_MIN ? ' + ' + CFG.HANDOFF_BUFFER_MIN + ' pickup minutes' : '') + '. The last three columns are timing stages of the late orders (where the time ran out), not owners. ' + settingsLink('Change')) + '</p>' +
      table([
        ['Sub-area', (r) => r.area, null, 'l'], ['Orders', (r) => r.orders], ['Direct rides', (r) => r.rides],
        ['Usual ride (median)', (r) => r.med, (r) => fmt(r.med, 1)], ['Average ride', (r) => r.avg, (r) => fmt(r.avg, 1)],
        ['Threshold used', (r) => r.thr, (r) => '<b>' + fmt(r.thr, 1) + '</b> <span class="muted">' + esc(r.src) + '</span>'],
        ['Late', (r) => r.late], ['Stage: packed too late', (r) => r.ptl], ['Stage: awaiting pickup', (r) => r.wda], ['Stage: ride', (r) => r.road],
      ], areas.sort((a, b) => b.orders - a.orders)) + '</details>';
  }

  BRAIN_VIEWS.shifted = function (A, M) {
    const X = CFG.PLANNED_AHEAD_HOURS;
    const sched = A.rows.filter((r) => r.scheduled && !r.subOrder);
    const forced = sched.filter((r) => r.forced), planned = sched.filter((r) => !r.forced);
    const known = sched.filter((r) => r.shiftHours != null);
    const PP = A.score.pool;
    const srcN = (k) => sched.filter((r) => r.forcedSrc === k).length;
    let h = '<div class="note">A scheduled order counts as <b>forced</b> when the customer couldn\'t get NOW: <b>scheduled express</b> always; otherwise what the brain recorded when the order was placed (a Control Room tab open): the NOW slot <b>full in DCM</b> or the <b>FP BUSY</b> = forced, open with room = the customer\'s choice. When nothing was recorded at that minute, an order placed less than <b>' + X + ' h</b> before its slot counts as forced (' + settingsLink('change') + '). ' +
      'This page shows the scheduled orders in this day\'s slots. <b>P90 incl. forced</b> and <b>forced %</b> count orders on the day they were <b>placed</b>, like the official scorecard.</div>';
    h += '<div class="tiles">' + tile('Scheduled orders', sched.length, 'in this day\'s slots') + tile('Forced', forced.length, planned.length + ' not forced') +
      tile('Scheduled express', srcN('express'), 'always forced') + tile('DCM slot full', srcN('dcm'), 'recorded when placed') + tile('FP BUSY', srcN('status'), 'recorded when placed') +
      tile('Under ' + X + ' h ahead', srcN('cut'), 'nothing recorded then') + '</div>';
    const st = PP.state === 'loaded' ? 'the next day\'s orders are in' : PP.state === 'partial' ? 'the next day\'s orders are in, ' + (A.spill.open || 0) + ' still open' : PP.state === 'today' ? 'orders placed today for tomorrow join once delivered' : PP.state === 'failed' ? 'the next day\'s orders could not be loaded' : '';
    h += '<div class="tiles">' + tile('Forced, placed this day', PP.forcedDel.length, 'delivered · ' + fmtPct(PP.forcedPct) + ' of ' + PP.del.length + ' delivered') +
      tile('Placed this day for the next day', PP.spillForced, 'forced and delivered · ' + st) + tile('Placed the day before', PP.prevForced, 'forced orders in this day\'s slots, counted on the day before') +
      tile('P90 incl. forced', fmt(PP.p90f) + '<span class="u">min</span>', 'by the day placed') + '</div>';
    // why each scheduled order counts as forced or not
    const SRC = ['express', 'dcm', 'status', 'cut', 'open', 'ahead'];
    const srcRows = SRC.map((k) => { const g = sched.filter((r) => r.forcedSrc === k), del = g.filter((r) => r.delivered); return { k, label: forcedSrcTxt(k), forced: ['express', 'dcm', 'status', 'cut'].includes(k), n: g.length, del: del.length, med: median(del.map((r) => r.deliveryMin)), over: del.filter((r) => r.deliveryMin > CFG.P90_TARGET_MIN).length }; }).filter((x) => x.n);
    h += card('Why each scheduled order counts as forced or not', 'Orders in this day\'s slots.', table([
      ['Reason', (r) => r.label, null, 'l'], ['Counts as', (r) => (r.forced ? 1 : 0), (r) => '<span class="pill ' + (r.forced ? 'warn' : 'good') + '">' + (r.forced ? 'Forced' : 'Preferred') + '</span>', 'l'],
      ['Orders', (r) => r.n], ['Delivered', (r) => r.del], ['Placed → delivered (median)', (r) => r.med, (r) => fmt(r.med, 0)], ['Over ' + CFG.P90_TARGET_MIN + ' min', (r) => r.over],
    ], srcRows));
    // hours-ahead distribution
    const edges = Array.from(new Set([0, 1, 3, 6, X, 12, 24, 48].filter((e) => e <= 48))).sort((a, b) => a - b);
    const bands = [{ lo: -Infinity, hi: 0, label: 'Placed after slot start' }].concat(edges.map((e, i) => ({ lo: e, hi: i + 1 < edges.length ? edges[i + 1] : Infinity, label: i + 1 < edges.length ? e + '–' + edges[i + 1] + ' h' : e + '+ h' })));
    const bandRows = bands.map((b) => {
      const g = known.filter((r) => r.shiftHours >= b.lo && r.shiftHours < b.hi);
      const del = g.filter((r) => r.delivered);
      return { label: b.label, n: g.length, forced: g.filter((r) => r.forced).length, del: del.length, med: median(del.map((r) => r.deliveryMin)) };
    }).filter((b) => b.n);
    h += card('How far ahead scheduled orders were placed', 'Hours ahead = slot start − placed time, across midnight. With nothing recorded, under ' + X + ' h counts as forced.', table([
      ['Hours ahead', (r) => r.label, null, 'l'], ['Orders', (r) => r.n], ['Forced', (r) => r.forced], ['Delivered', (r) => r.del], ['Placed → delivered (median)', (r) => r.med, (r) => fmt(r.med, 0)],
    ], bandRows));
    // biggest shifts: placing hour → slot, forced only
    const flows = new Map();
    forced.filter((r) => r.placedHour != null).forEach((r) => { const k = r.placedHour + '>' + r.slot; const f = flows.get(k) || { from: r.placedHour, to: r.slot, rows: [] }; f.rows.push(r); flows.set(k, f); });
    const top = Array.from(flows.values()).map((f) => Object.assign(f, { n: f.rows.length, hrs: median(f.rows.map((r) => r.shiftHours)) })).sort((a, b) => b.n - a.n || b.hrs - a.hrs).slice(0, 15);
    h += card('Biggest shifts', 'Forced orders, grouped by the hour they were placed and the slot they went into. Hours = slot start − placed (median).', top.length ? '<ul class="flat">' + top.map((f) => '<li><b>' + f.n + '</b> order' + (f.n > 1 ? 's' : '') + ' placed at ' + hourLabel(f.from) + ' → scheduled into ' + esc(slotLabel(f.to)) + ' <span class="muted">(' + fmt(f.hrs, 1) + ' h later)</span></li>').join('') + '</ul>' : '<p class="muted">None.</p>');
    // matrix
    const PL = 'Preferred';
    const cells = new Map();
    known.forEach((r) => { const from = r.forced ? r.placedHour : PL; const k = from + '>' + r.slot; cells.set(k, (cells.get(k) || 0) + 1); });
    const fromKeys = [PL].filter(() => planned.some((r) => r.shiftHours != null)).concat(Array.from(new Set(forced.filter((r) => r.shiftHours != null).map((r) => r.placedHour))).sort((a, b) => a - b));
    const toKeys = Array.from(new Set(known.map((r) => r.slot))).sort((a, b) => a - b);
    const maxN = Math.max(1, ...cells.values());
    const cell = (n) => { if (!n) return '<td class="muted">·</td>'; const a = 0.12 + 0.75 * (n / maxN); return '<td style="background:rgba(170,3,130,' + a.toFixed(2) + ');color:' + (a > 0.5 ? '#fff' : 'inherit') + ';font-weight:650">' + n + '</td>'; };
    let m = '<div class="tw"><table class="heat"><thead><tr><th>Placed ↓ / Scheduled into →</th>' + toKeys.map((t) => '<th style="text-align:center">' + shortHour(t) + '</th>').join('') + '</tr></thead><tbody>';
    fromKeys.forEach((f) => { m += '<tr><td>' + (f === PL ? PL : hourLabel(f)) + '</td>' + toKeys.map((t) => cell(cells.get(f + '>' + t))).join('') + '</tr>'; });
    h += card('Shift matrix', 'Rows = hour a forced order was placed (orders not forced in one row). Columns = timeslot it went into. Darker = more orders.', m + '</tbody></table></div>');
    // every forced order
    h += card('Every forced order · ' + forced.length, 'In this day\'s slots. Those placed this day are inside P90 incl. forced once delivered.', forced.length ? table([
      ['Order', (r) => r.orderNumber, (r) => '<b>' + esc(r.orderNumber) + '</b>', 'l'], ['Placed', (r) => r.placed, (r) => fmtTime(r.placed) + (r.placed < PP.ds ? ' <span class="mini">day before</span>' : '')], ['Slot', (r) => r.slot, (r) => esc(slotLabel(r.slot)), 'l'],
      ['Hours ahead', (r) => r.shiftHours, (r) => fmt(r.shiftHours, 1)], ['Why forced', (r) => r.forcedSrc || '', (r) => esc(forcedSrcTxt(r.forcedSrc)), 'l'], ['Type', (r) => typeShown(r), null, 'l'], ['Sub-area', (r) => r.subArea, null, 'l'],
      ['Status', (r) => r.status, (r) => (r.delivered ? '<span class="muted">delivered</span>' : '<span class="muted">' + esc(r.status) + '</span>'), 'l'],
      ['Placed → delivered', (r) => r.deliveryMin, (r) => fmt(r.deliveryMin, 0)], ['Over P90 target', (r) => (r.deliveryMin != null && r.deliveryMin > CFG.P90_TARGET_MIN ? 1 : 0), (r) => (r.deliveryMin == null ? '–' : r.deliveryMin > CFG.P90_TARGET_MIN ? '<span class="pill bad">yes</span>' : '<span class="muted">no</span>')]
    ], forced.sort((a, b) => a.placed - b.placed)) : '<p class="muted">None.</p>');
    // what was recorded: DCM's NOW slot full, and the FP status
    const fp = M.fps[0];
    const dcm = fp ? DCM.load(fp, M.date) : null;
    const full = dcm && Array.isArray(dcm.ev) ? dcm.ev.filter((e) => +e[1] === new Date(e[0]).getHours() && e[4] <= 0) : [];
    if (dcm && dcm.ev && dcm.ev.length) {
      const spans = [];
      full.sort((a, b) => a[0] - b[0]).forEach((e) => { const l = spans[spans.length - 1]; if (l && e[0] - l.to <= (CFG.LIVE_POLL_MIN + 1) * MIN && l.h === +e[1]) { l.to = e[0]; l.n++; } else spans.push({ h: +e[1], from: e[0], to: e[0], n: 1, cap: e[2], placed: e[3] }); });
      h += card('DCM: NOW slot full (recorded)', 'Readings every ' + CFG.LIVE_POLL_MIN + ' min while a Control Room tab was open. Scheduled orders placed in these spans count as forced.', spans.length ? table([
        ['Slot', (r) => r.h, (r) => esc(slotLabel(r.h)), 'l'], ['From', (r) => r.from, (r) => fmtTime(r.from)], ['To', (r) => r.to, (r) => fmtTime(r.to)], ['Readings', (r) => r.n], ['Capacity', (r) => r.cap], ['Placed', (r) => r.placed],
      ], spans) : '<p class="muted">The NOW slot was never full in the recorded readings.</p>');
    }
    const rec = fp ? FPSTAT.load(fp, M.date) : null;
    if (rec && rec.ev.length) {
      const seg = (rec.seg || []).map(([a, b]) => fmtTime(a) + '–' + fmtTime(b)).join(', ');
      h += card('FP status changes (recorded)', 'Checked every ' + CFG.FP_STATUS_POLL_MIN + ' min while a Control Room tab was open. * = forced by a manager. ' + (seg ? 'Checked: ' + seg + '.' : 'No check times saved for this day, so it is not used to decide forced orders.'), table([
        ['Time', (r) => r[0], (r) => fmtTime(r[0]), 'l'], ['Status', (r) => r[1], (r) => '<span class="pill ' + (/^AVAILABLE/.test(r[1]) ? 'good' : 'warn') + '">' + esc(r[1]) + '</span>', 'l'], ['Until', (r) => r[2] || '', (r) => (r[2] ? esc(String(r[2])) : '<span class="muted">–</span>'), 'l'],
      ], rec.ev));
    } else h += '<div class="note">No FP status recorded for this date. While a Control Room tab is open, the brain checks whether the FP is open every ' + CFG.FP_STATUS_POLL_MIN + ' min and DCM every ' + CFG.LIVE_POLL_MIN + ' min, and uses that to decide forced orders.</div>';
    return h;
  };

  BRAIN_VIEWS.types = function (A) {
    const T = A.types;
    const T2 = T.filter((t) => cpShowLabel(t.type));
    let h = '<div class="tiles">' + T2.map((t) => tile(t.type, t.orders, t.delivered ? fmtPct(t.latePct) + ' late. P90: ' + fmt(t.p90Now) + ' min NOW, ' + fmt(t.p90Proxy) + ' min incl. forced' : 'No delivery timing for this date')).join('') + '</div>';
    // with vs without sub-orders
    const clone = (r) => Object.assign({}, r, { subOrder: false });
    const sets = [['Without sub-orders', A.rows.filter((r) => !r.wasSub).map(clone), !CFG.INCLUDE_SUBORDERS], ['With sub-orders', A.rows.map(clone), CFG.INCLUDE_SUBORDERS]];
    const stat = ([label, rows, on]) => {
      const s = summarize(rows);
      return { label, on, orders: rows.length, cnr: rows.filter((r) => r.status === 'completed' || r.status === 'not-received').length, delivered: s.delivered, late: s.late, latePct: s.latePct, p90Now: s.p90Now, p90Proxy: s.p90Proxy };
    };
    const S = sets.map(stat);
    const subs = A.rows.filter((r) => r.wasSub);
    const metric = (label, fn, f) => ({ label, a: fn(S[0]), b: fn(S[1]), f });
    const rowsM = [
      metric('Orders (excl. cancelled)', (s) => s.orders), metric('Completed + not received', (s) => s.cnr), metric('Delivered', (s) => s.delivered),
      metric('Late', (s) => s.late), metric('ETA late %', (s) => s.latePct, latePill),
      metric('P90 NOW', (s) => s.p90Now, p90Pill), metric('P90 incl. forced', (s) => s.p90Proxy, p90Pill),
    ];
    const hd = (s) => s.label + (s.on ? ' <span class="pill good">in use</span>' : '');
    h += card('Sub-orders: why your numbers can differ from the central dashboard', subs.length + ' sub-orders today (' + (hasPharma() ? subs.filter((r) => r.pharmaSub).length + ' pharmacy, ' + subs.filter((r) => !r.pharmaSub).length + ' other, e.g. pickup / missing items' : 'pickup / missing items') + '). A sub-order closes within seconds of its parent, so the brain counts the parent once by default. Some dashboards count every order ID. If the dashboard\'s order count matches the right-hand column, sub-orders explain the gap. ' + settingsLink('Switch'),
      '<div class="tw"><table><thead><tr><th class="l">Metric</th><th>' + hd(S[0]) + '</th><th>' + hd(S[1]) + '</th><th>Difference</th></tr></thead><tbody>' +
      rowsM.map((m) => { const df = m.a != null && m.b != null ? m.b - m.a : null; return '<tr><td class="l">' + m.label + '</td><td>' + (m.f ? m.f(m.a) : fmt(m.a, 0)) + '</td><td>' + (m.f ? m.f(m.b) : fmt(m.b, 0)) + '</td><td>' + (df == null ? '–' : (df > 0 ? '+' : '') + fmt(df, Number.isInteger(df) ? 0 : 1)) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="sub">If the gap to the dashboard is in P90 rather than in the order count, sub-orders are not the main reason; check which orders the dashboard treats as forced, and the cut-off time of its day.</p>');
    const bothN = A.rows.filter((r) => !r.wasSub && r.coffee && r.pharma).length;
    h += '<div class="note">' + (hasCoffee() ? '<b>Coffee</b> = every order with a Breadfast Coffee item (picker + barista), as on Timeslots and Coffee & pharmacy. ' : '') + (hasPharma() ? '<b>Pharmacy</b> = every order with a pharmacy part; lateness is judged on the parent order. ' : '') + (hasCoffee() && hasPharma() && bothN ? bothN + ' order' + (bothN === 1 ? ' has' : 's have') + ' both, so ' + (bothN === 1 ? 'it is' : 'they are') + ' in both rows. ' : '') + '<b>Grocery</b> = neither. ' + '<b>Sub-order</b> rows are ' + (CFG.INCLUDE_SUBORDERS ? '<b>included</b> in lateness and P90 (Settings)' : 'left out of every order count, lateness and P90 (change in Settings)') + '.</div>';
    h += card('By order type', '', table([
      ['Type', (r) => r.type, null, 'l'], ['Orders', (r) => r.orders], ['Delivered', (r) => r.delivered], ['Late', (r) => r.late], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)],
      ...P90_COLS, ['Med. awaiting pickup', (r) => r.medShelf, (r) => fmt(r.medShelf, 1)], ['Med. ride', (r) => r.medLeg, (r) => fmt(r.medLeg, 1)],
      ['Late in FP (stage)', (r) => r.causes['Packed after deadline'] + r.causes['Packed too late']], ['Late awaiting pickup (stage)', (r) => r.causes['Awaiting pickup']], ['Late on ride (stage)', (r) => r.causes['Ride']],
    ], T2));
    return h + (hasCP() ? '<div class="note">' + cpTitle() + ' by timeslot, with what ' + (hasCoffee() && hasPharma() ? 'each one' : 'it') + ' caused, ' + (hasCoffee() && hasPharma() ? 'are' : 'is') + ' on ' + '<button class="ghost sm" data-goto="coffee">' + cpTitle() + '</button>.</div>' : '');
  };

  // Basket size page: brain_parts/baskets.js (v1.24)

  /* ------------------------------------------------------------------
   * BASKET SIZE (v1.24, core page): how the day's orders split by basket size (unique SKUs), the share of large baskets,
   * the expected picking time for each size group (from this FP's own saved days) and whether each group was picked in time.
   * Picking time = picker started → packed (the same "Picking" as everywhere). Placed → packed and "packed too late" are shown too.
   * ------------------------------------------------------------------ */
  // Size groups (v1.24.1): fixed, all the way to 50+ SKUs, whatever the large-basket threshold. Groups starting at or above
  // the threshold (Settings → Orders) are marked large; the Large % itself counts every order at or above the threshold.
  const BK_CUTS = SKU_BANDS.map((b) => b[0]);   // the same groups as Basket fairness and the basket-adjusted sec / SKU
  function basketBands() {
    const L = Math.max(2, CFG.LARGE_BASKET_SKUS || 10);
    const B = BK_CUTS.map((lo, i) => ({ lo, hi: i + 1 < BK_CUTS.length ? BK_CUTS[i + 1] - 1 : Infinity }));
    B.forEach((b) => { b.large = b.lo >= L; });
    B.forEach((b) => { b.key = b.lo + '-' + (b.hi === Infinity ? 'up' : b.hi); b.label = b.hi === Infinity ? b.lo + '+ SKUs' : b.lo === b.hi ? b.lo + ' SKU' + (b.lo === 1 ? '' : 's') : b.lo + '–' + b.hi + ' SKUs'; });
    return B;
  }
  const bandOf = (B, n) => (n == null ? null : B.find((b) => n >= b.lo && n <= b.hi) || null);
  const BK_BIN = 2;   // picking-time histogram: half-minute bins
  const BK_CAP_SKU = 50, BK_CAP_BIN = 120;   // 50+ SKUs together (40+ before 1.24.1); 60+ min together
  // Compact picking-time record for saved history: { skus: { bin: count } }
  function pickHist(A) {
    const out = {};
    A.rows.filter((r) => !r.wasSub && r.skus != null && r.handleMin != null && r.handleMin >= 0).forEach((r) => {
      const k = Math.min(BK_CAP_SKU, r.skus), b = Math.min(BK_CAP_BIN, Math.round(r.handleMin * BK_BIN));
      const m = out[k] || (out[k] = {}); m[b] = (m[b] || 0) + 1;
    });
    return out;
  }
  // Expected picking time per size group = the time 3 in 4 orders of that size were picked within (75th percentile) on this FP's
  // saved days (last BASKET_HIST_DAYS, the loaded day left out). A median would make half the orders "slow" on a normal day.
  // Groups with fewer than 20 saved orders fall back to the loaded day itself.
  function basketExpected(A, B) {
    const H = loadHistory(), key = '|' + ((UI.meta && UI.meta.fps) || []).join(',');
    const dk = UI.meta && UI.meta.date, d0 = dayStartOf(dk) || Date.now();
    const days = Object.keys(H).filter((k) => k.endsWith(key) && H[k].bk && H[k].date !== dk && dayStartOf(H[k].date) && dayStartOf(H[k].date) < d0 + 86400000 && dayStartOf(H[k].date) >= d0 - (CFG.BASKET_HIST_DAYS || 28) * 86400000).map((k) => H[k]);
    const today = pickHist(A);
    const BK_Q = 0.75;
    const medOf = (hists) => {
      const c = {}; let n = 0;
      hists.forEach((h) => Object.keys(h).forEach((b) => { c[b] = (c[b] || 0) + h[b]; n += h[b]; }));
      if (!n) return { n: 0, med: null };
      const bins = Object.keys(c).map(Number).sort((x, y) => x - y); let acc = 0;
      for (const b of bins) { acc += c[b]; if (acc >= n * BK_Q - 1e-9) return { n, med: b / BK_BIN }; }
      return { n, med: null };
    };
    const histFor = (src, b) => Object.keys(src).map(Number).filter((s) => s >= b.lo && s <= b.hi).map((s) => src[s]);
    const out = {};
    B.forEach((b) => {
      const own = PREFS.bkTarget && PREFS.bkTarget[b.key];
      const hist = medOf(days.reduce((a, d) => a.concat(histFor(d.bk, b)), []));
      const tod = medOf(histFor(today, b));
      if (own != null && own !== '') out[b.key] = { min: +own, src: 'yours' };
      else if (hist.n >= 20) out[b.key] = { min: hist.med, src: days.length + ' saved day' + (days.length === 1 ? '' : 's') + ', ' + hist.n + ' orders', auto: hist.med };
      else if (tod.n) out[b.key] = { min: tod.med, src: 'this day (not enough saved days yet)', auto: tod.med };
      else out[b.key] = { min: null, src: 'no data' };
      if (out[b.key].auto == null) out[b.key].auto = hist.n >= 20 ? hist.med : tod.n ? tod.med : null;
    });
    return { E: out, days: days.length };
  }

  // Typical picking time for a basket size (v1.25), used to decide whether a late order was a "Large basket" one:
  // the median (not the 75th percentile, and never a target you typed) picking time of its size group on saved days
  // (20+ orders), else on the loaded day. Returns a function skus → minutes (null when there is no data).
  function basketTypicalPick(A) {
    const B = basketBands(), today = pickHist(A);
    let days = [];
    try {
      const H = loadHistory(), key = '|' + ((UI.meta && UI.meta.fps) || []).join(',');
      const dk = UI.meta && UI.meta.date, d0 = dayStartOf(dk) || Date.now();
      days = Object.keys(H).filter((k) => k.endsWith(key) && H[k].bk && H[k].date !== dk && dayStartOf(H[k].date) && dayStartOf(H[k].date) < d0 + 86400000 && dayStartOf(H[k].date) >= d0 - (CFG.BASKET_HIST_DAYS || 28) * 86400000).map((k) => H[k].bk);
    } catch (e) { days = []; }
    const q = (hists) => {
      const c = {}; let n = 0;
      hists.forEach((h) => Object.keys(h).forEach((b) => { c[b] = (c[b] || 0) + h[b]; n += h[b]; }));
      if (!n) return { n: 0, v: null };
      const bins = Object.keys(c).map(Number).sort((x, y) => x - y); let acc = 0;
      for (const b of bins) { acc += c[b]; if (acc >= n * 0.5 - 1e-9) return { n, v: b / BK_BIN }; }
      return { n, v: null };
    };
    const histFor = (src, b) => Object.keys(src).map(Number).filter((s) => s >= b.lo && s <= b.hi).map((s) => src[s]);
    const typ = {};
    B.forEach((b) => {
      const h = q(days.reduce((a, d) => a.concat(histFor(d, b)), []));
      typ[b.key] = h.n >= 20 ? h.v : q(histFor(today, b)).v;
    });
    return (skus) => { const b = bandOf(B, Math.min(BK_CAP_SKU, skus)); return b ? typ[b.key] : null; };
  }

  BRAIN_VIEWS.baskets = function (A) {
    CUR_A = A;
    const B = basketBands(), L = CFG.LARGE_BASKET_SKUS;
    const main = A.rows.filter((r) => !r.subOrder && r.status !== 'cancelled');
    const sized = main.filter((r) => r.skus != null);
    const { E, days } = basketExpected(A, B);
    // 75% within expected = a normal day (the expected time is what 3 in 4 orders made on saved days)
    const withinCls = (w) => (w >= 75 ? 'good' : w >= 60 ? 'warn' : 'bad');
    const withinPill = (w, txt) => '<span class="pill ' + withinCls(w) + '">' + (txt ? (w >= 75 ? 'as usual or better' : w >= 60 ? 'a bit slow' : 'slow day') : fmtPct(w)) + '</span>';
    const okPick = (r) => { const b = bandOf(B, r.skus), e = b && E[b.key].min; return e == null || r.handleMin == null ? null : r.handleMin <= e + 1e-9; };
    const fpLate = (r) => r.late && (r.cause === 'Packed after deadline' || r.cause === 'Packed too late');
    const rows = B.map((b) => {
      const g = sized.filter((r) => r.skus >= b.lo && r.skus <= b.hi);
      const timed = g.filter((r) => r.handleMin != null);
      const judged = timed.filter((r) => okPick(r) != null), within = judged.filter((r) => okPick(r));
      const del = g.filter((r) => r.delivered), now = del.filter((r) => !r.scheduled), etaJ = del.filter((r) => r.late != null);
      const e = E[b.key];
      const over = judged.filter((r) => !okPick(r));
      return {
        b, n: g.length, share: rate(g.length, sized.length), avgSku: avg(g.map((r) => r.skus)), avgBags: avg(g.map((r) => r.bags).filter((x) => x != null)),
        exp: e.min, expSrc: e.src, expAuto: e.auto, pick: median(timed.map((r) => r.handleMin)), p75: pct(timed.map((r) => r.handleMin), 0.75),
        within: rate(within.length, judged.length), overN: over.length, overBy: median(over.map((r) => r.handleMin - e.min)),
        perSku: median(timed.map((r) => r.secPerSku)), store: median(now.map((r) => r.prepMin)),
        fpLate: g.filter(fpLate).length, short: g.filter((r) => r.bigBasket).length, eta: rate(etaJ.filter((r) => r.late).length, etaJ.length), p90: pct(now.map((r) => r.deliveryMin), 0.9),
      };
    });
    const large = sized.filter((r) => r.skus >= L);
    const allJudged = sized.filter((r) => r.handleMin != null && okPick(r) != null), allWithin = allJudged.filter((r) => okPick(r));
    const est = sized.filter((r) => r.handleMin != null && r.startSource && r.startSource !== 'recorded').length;
    let h = '<div class="kpis">' +
      kpi('Orders', sized.length, '', 'real orders with a basket size' + (main.length > sized.length ? ' (' + (main.length - sized.length) + ' without)' : ''), null) +
      kpi('Average basket', fmt(avg(sized.map((r) => r.skus)), 1), 'SKUs', 'median ' + fmt(median(sized.map((r) => r.skus)), 0) + ' · ' + fmt(avg(sized.map((r) => r.bags).filter((x) => x != null)), 1) + ' bags on average', null) +
      kpi('Large baskets', fmtPct(rate(large.length, sized.length)), '', large.length + ' orders with ' + L + '+ SKUs', null) +
      kpi('Picked within expected time', fmtPct(rate(allWithin.length, allJudged.length)), '', allWithin.length + ' of ' + allJudged.length + ' orders, each against its size group. A normal day is about 75%.' + (rate(allWithin.length, allJudged.length) == null ? '' : ' ' + withinPill(rate(allWithin.length, allJudged.length), true)), null) +
      kpi('Packed too late (FP)', sized.filter(fpLate).length, '', 'late orders the FP owns, any size', sized.filter(fpLate).length ? 'bad' : 'good') + '</div>';

    // distribution by exact SKU count
    const maxS = BK_CAP_SKU;   // always 1 … 49 and 50+, so the spread is visible all the way up
    const cnt = Array.from({ length: maxS + 1 }, (_, i) => sized.filter((r) => (i < maxS ? r.skus === i : r.skus >= maxS)).length);
    const top = Math.max(1, ...cnt);
    const bars = cnt.map((n, i) => (i === 0 ? '' : '<div class="bkb' + (i >= L ? ' lg' : '') + '" data-tip="' + esc((i < maxS ? i : maxS + '+') + ' SKUs: ' + n + ' orders (' + fmtPct(rate(n, sized.length)) + ')') + '"><i style="height:' + Math.max(n ? 2 : 0, Math.round((100 * n) / top)) + '%"></i>' + (i === 1 || i % 5 === 0 ? '<span>' + (i < maxS ? i : maxS + '+') + '</span>' : '') + '</div>')).join('');
    h += card('How the day\'s baskets split', 'Orders by number of unique SKUs (different products; 3 bottles of the same water count as 1). Pink = large baskets (' + L + '+ SKUs, ' + settingsLink('change in Settings') + '). Hover a bar for its count.',
      '<div class="bkchart">' + bars + '</div>' +
      '<div class="bkshare">' + rows.filter((x) => x.n).map((x) => '<span style="flex:' + x.n + '" class="' + (x.b.large ? 'lg' : '') + '" data-tip="' + esc(x.b.label + ': ' + x.n + ' orders (' + fmtPct(x.share) + ')') + '">' + (x.share >= 8 ? '<b>' + fmtPct(x.share) + '</b> ' + esc(x.b.label) : x.share >= 3 ? '<b>' + fmtPct(x.share) + '</b>' : '') + '</span>').join('') + '</div>' +
      '<div class="bklegend">' + rows.map((x) => '<span class="' + (x.b.large ? 'lg' : '') + (x.n ? '' : ' zero') + '"><i></i>' + esc(x.b.label) + ' <b>' + x.n + '</b> <span class="muted">' + (x.n ? fmtPct(x.share) : '') + '</span></span>').join('') + '</div>');

    // the main table
    const expCell = (x) => '<input class="txt num bkexp" type="number" min="0" step="0.5" data-bkexp="' + x.b.key + '" value="' + (PREFS.bkTarget && PREFS.bkTarget[x.b.key] != null ? PREFS.bkTarget[x.b.key] : '') + '" placeholder="' + (x.expAuto != null ? fmt(x.expAuto, 1) : '–') + '" title="' + esc('From ' + x.expSrc + '. Type your own target, or leave empty for the history.') + '"> <span class="muted">min</span>';
    const pickCell = (x) => (x.pick == null ? '–' : x.exp == null ? fmt(x.pick, 1) : '<span class="pill ' + (x.pick <= x.exp ? 'good' : x.pick <= x.exp * 1.25 ? 'warn' : 'bad') + '">' + fmt(x.pick, 1) + '</span>');
    const withinCell = (x) => (x.within == null ? '–' : withinPill(x.within));
    h += card('Basket size groups: expected vs actual picking time', 'Expected = the picking time (picker started → packed) 3 in 4 orders of that size made on your last ' + (CFG.BASKET_HIST_DAYS || 28) + ' saved days' + (days ? ' (' + days + ' found)' : ' (none saved yet, so this day is used)') + '; type your own target in a box to replace it. <b>Within expected</b> = orders picked in that time or less: about 75% on a normal day. Placed → packed, packed too late, ETA late % and P90 show what each size did to the customer. <b>Late: ETA too short</b> = late orders whose ETA was shorter than the usual picking time for their size + ' + (CFG.HANDOFF_BUFFER_MIN || 0) + ' min pickup + the usual ride (owner: Large basket).' +
      (est ? ' ' + est + ' picking times are estimates (no Control Room tab open to record the start).' : ''), table([
      ['Basket size', (x) => x.b.lo, (x) => '<b>' + esc(x.b.label) + '</b>' + (x.b.large ? ' <span class="tagchip">large</span>' : ''), 'l'],
      ['Orders', (x) => x.n], ['% of orders', (x) => x.share, (x) => '<span class="sharebar"><i style="width:' + Math.min(100, x.share || 0) + '%"></i></span>' + fmtPct(x.share)],
      ['Avg SKUs', (x) => x.avgSku, (x) => fmt(x.avgSku, 1)], ['Avg bags', (x) => x.avgBags, (x) => fmt(x.avgBags, 1)],
      ['Expected picking', (x) => x.exp, (x) => expCell(x)],
      ['Median picking', (x) => x.pick, (x) => pickCell(x)], ['Slowest quarter from', (x) => x.p75, (x) => fmt(x.p75, 1)],
      ['Within expected', (x) => x.within, (x) => withinCell(x)], ['Over expected', (x) => x.overN, (x) => (x.overN ? x.overN + (x.overBy != null ? ' <span class="muted">by ' + fmt(x.overBy, 1) + ' min</span>' : '') : '0')],
      ['Sec per SKU', (x) => x.perSku, (x) => fmt(x.perSku, 0)], ['Placed → packed, NOW', (x) => x.store, (x) => fmt(x.store, 1)],
      ['Packed too late (FP)', (x) => x.fpLate, (x) => (x.fpLate ? '<b style="color:var(--bad)">' + x.fpLate + '</b>' : '0')],
      ['Late: ETA too short', (x) => x.short, (x) => (x.short ? '<b style="color:#C33F91">' + x.short + '</b>' : '0')],
      ['ETA late %', (x) => x.eta, (x) => latePill(x.eta)], ['P90 NOW', (x) => x.p90, (x) => p90Pill(x.p90)],
    ], rows.filter((x) => x.n)) + '<p class="mini" style="margin-top:6px">' + (PREFS.bkTarget && Object.keys(PREFS.bkTarget).length ? '<a href="#" data-bkreset>Use the history for every group</a> · ' : '') + 'Targets you type are saved in this browser.</p>');

    // by timeslot
    const bySlot = groupBy(sized, (r) => r.slot);
    const slots = Array.from(bySlot.keys()).filter((x) => x != null).sort((x, y) => x - y);
    const slotRows = slots.map((s) => {
      const g = bySlot.get(s), j = g.filter((r) => r.handleMin != null && okPick(r) != null);
      const o = { s, n: g.length, avgSku: avg(g.map((r) => r.skus)), large: g.filter((r) => r.skus >= L).length, within: rate(j.filter((r) => okPick(r)).length, j.length), fpLate: g.filter(fpLate).length };
      B.forEach((b) => { o[b.key] = g.filter((r) => r.skus >= b.lo && r.skus <= b.hi).length; });
      return o;
    });
    const maxCell = Math.max(1, ...slotRows.map((o) => Math.max(...B.map((b) => o[b.key]))));
    const heat = (n) => (n ? '<span class="bkheat" style="background:rgba(170,3,130,' + (0.1 + 0.6 * (n / maxCell)).toFixed(2) + ')">' + n + '</span>' : '<span class="muted">·</span>');
    h += card('By timeslot', 'Orders in each size group per timeslot (darker = more), the share of large baskets, and the share picked within the expected time for their size (about 75% is normal).', table([
      ['Timeslot', (o) => o.s, (o) => esc(slotLabel(o.s)), 'l'], ['Orders', (o) => o.n],
    ].concat(B.filter((b) => sized.some((r) => r.skus >= b.lo && r.skus <= b.hi)).map((b) => [b.label, (o) => o[b.key], (o) => heat(o[b.key])])).concat([
      ['Avg SKUs', (o) => o.avgSku, (o) => fmt(o.avgSku, 1)], ['Large %', (o) => rate(o.large, o.n), (o) => fmtPct(rate(o.large, o.n))],
      ['Within expected', (o) => o.within, (o) => (o.within == null ? '–' : withinPill(o.within))],
      ['Packed too late (FP)', (o) => o.fpLate, (o) => (o.fpLate ? '<b style="color:var(--bad)">' + o.fpLate + '</b>' : '0')],
    ]), slotRows));

    // orders furthest over their expected time
    const overList = sized.filter((r) => okPick(r) === false).map((r) => { const b = bandOf(B, r.skus); return { r, b, e: E[b.key].min, by: r.handleMin - E[b.key].min }; }).sort((a, b) => b.by - a.by).slice(0, 25);
    if (overList.length) h += card('Picked slowest for their size · top ' + overList.length, 'Orders whose picking took longest beyond the expected time for their basket size. Check the picker, the items (out of stock, cannot scan, frozen) and the time of day.', table([
      ['Order', (x) => x.r.orderNumber, null, 'l'], ['Slot', (x) => x.r.slot, (x) => esc(slotLabel(x.r.slot)), 'l'], ['SKUs', (x) => x.r.skus], ['Bags', (x) => x.r.bags],
      ['Expected', (x) => x.e, (x) => fmt(x.e, 1)], ['Picking', (x) => x.r.handleMin, (x) => fmt(x.r.handleMin, 1) + (x.r.startSource && x.r.startSource !== 'recorded' ? ' <span class="muted">est.</span>' : '')],
      ['Over by', (x) => x.by, (x) => '<b style="color:var(--bad)">+' + fmt(x.by, 1) + '</b>'], ['Picker', (x) => x.r.pickerName || '', null, 'l'],
      ['Tags', (x) => (x.r.tags || []).length, (x) => tagChips(x.r), 'l'],
      ['Result', (x) => (x.r.late ? 1 : 0), (x) => (x.r.late ? '<b style="color:var(--bad)">late</b>' + (fpLate(x.r) ? ' (FP)' : '') : x.r.delivered ? 'on time' : esc(x.r.status)), 'l'],
    ], overList));

    h += '<div class="note">' + LIFECYCLE_NOTE + '</div>';
    h += card('Large baskets (' + L + '+ SKUs) · ' + A.largeOrders.length, 'Every large order, late or on time, biggest first. ' + settingsLink('Change the ' + L + ' SKUs'),
      A.largeOrders.length ? lifecycleTable(A.largeOrders, { basketFirst: true, allowOnTime: true, reason: true }) : '<p class="muted">No orders at or above the threshold.</p>');
    return h;
  };
  BIND.baskets = function (main) {
    main.querySelectorAll('input[data-bkexp]').forEach((inp) => inp.addEventListener('change', () => {
      const v = inp.value.trim();
      PREFS.bkTarget = Object.assign({}, PREFS.bkTarget);
      if (v === '' || !isFinite(+v) || +v <= 0) delete PREFS.bkTarget[inp.dataset.bkexp]; else PREFS.bkTarget[inp.dataset.bkexp] = Math.round(+v * 10) / 10;
      savePrefs(); setTimeout(() => UI.render(), 0);
    }));
    const r = main.querySelector('[data-bkreset]');
    if (r) r.addEventListener('click', (e) => { e.preventDefault(); PREFS.bkTarget = {}; savePrefs(); UI.render(); });
  };

  /* ------------------------------------------------------------------
   * SETTINGS PAGE – targets, shifts, thresholds. Saved in this browser only; the brain never writes to Breadfast systems.
   * ------------------------------------------------------------------ */
  // [key, label, help, kind ('num' | 'bool' | options array), step]
  const SET_GROUPS = [
    ['KPI targets', 'Green at or better than the target, amber up to the amber limit, red beyond it.', [
      ['P90_TARGET_MIN', 'P90 target (min)', 'P90 NOW and P90 incl. forced', 'num', 1], ['WARN.p90', 'P90 amber up to (min)', '', 'num', 1],
      ['LATE_TARGET_PCT', 'ETA late target (%)', 'NOW orders delivered after their ETA, as the official scorecard', 'num', 0.1], ['WARN.eta', 'ETA late amber up to (%)', '', 'num', 0.1],
      ['PPH_OPS_TARGET', 'PPH (Ops) target', 'orders ÷ picker active hours, as Tableau', 'num', 0.1], ['WARN.ppho', 'PPH (Ops) amber down to', '', 'num', 0.1],
      ['DPH_OPS_TARGET', 'DPH (Ops) target', 'orders ÷ DA active hours, as Tableau', 'num', 0.1], ['WARN.dpho', 'DPH (Ops) amber down to', '', 'num', 0.1],
      ['PPH_TARGET', 'PPH target', 'hour by hour, orders per counted picker', 'num', 0.1], ['WARN.pph', 'PPH amber down to', '', 'num', 0.1],
      ['PPH_MIN_PICKS', 'PPH: orders a picker must start in an hour to count', 'each hour, pickers who started fewer are left out of that hour', 'num', 1],
      ['DPH_TARGET', 'DPH target', 'hour by hour, orders per counted DA', 'num', 0.1], ['WARN.dph', 'DPH amber down to', '', 'num', 0.1],
      ['DPH_MIN_DELIVERIES', 'DPH: orders a DA must pick up in an hour to count', 'each hour, DAs who picked up fewer are left out of that hour', 'num', 1],
      ['AUTO_ASSIGN_TARGET', 'Auto-assign target (%)', 'orders not assigned by hand', 'num', 0.1], ['WARN.auto', 'Auto-assign amber down to (%)', '', 'num', 0.1],
    ]],
    ['Capacity', 'How the Capacity section (Live & capacity) works out what your pickers and DAs can handle: each person\'s own speed in the hours they were busy.', [
      ['CAP_RATE_DAYS', 'Saved days to use', 'each person\'s speed = today plus this many saved days', 'num', 1],
      ['CAP_NEW_PICKER_PPH', 'New picker PPH', 'used for a picker with no busy hour yet', 'num', 0.5],
      ['CAP_NEW_DA_DPH', 'New DA DPH', 'used for a DA with no busy hour yet', 'num', 0.5],
      ['ON_GROUND_MIN', 'On the ground from (min in the hour)', 'a picker or DA counts as on the ground in an hour they were there this long: their shift, the availability recording, or first to last activity', 'num', 5],
    ]],
    ['Orders', '', [
      ['INCLUDE_SUBORDERS', 'Count sub-orders as orders everywhere', 'Off = the brain\'s default: sub-orders are left out of every order count, lateness and P90 (a sub-order closes with its parent, so it\'s counted once). On = every order ID counts everywhere, like some central dashboards. Compare both on Day Analysis → Order types.', 'bool'],
      ['LARGE_BASKET_SKUS', 'Large basket from (unique SKUs)', 'Large % on Basket size. A late order this big counts as "Large basket" only when its ETA was shorter than the usual picking time for its size + the pickup minutes + the usual ride', 'num', 1],
      ['BASKET_HIST_DAYS', 'Expected picking time from (saved days)', 'Basket size: expected picking time per size group = the time 3 in 4 orders made on this many saved days', 'num', 1],
    ]],
    ['Packed too late', 'The time a DA needs from FP pickup to the customer. Packed with less than this left = the FP\'s; more than this left and still late = logistics\'.', [
      ['HANDOFF_MODE', 'Threshold', '"Per sub-area" uses the usual direct ride to each sub-area that day (first drop of a trip). "Fixed" uses one number for every order.', [['area', 'Per sub-area (usual ride)'], ['fixed', 'Fixed minutes']]],
      ['HANDOFF_MIN', 'Fixed minutes', 'used in fixed mode, or when the day has too few rides to measure', 'num', 1],
      ['HANDOFF_MIN_ORDERS', 'Rides needed per sub-area', 'below this the FP-wide usual ride is used', 'num', 1],
      ['HANDOFF_BUFFER_MIN', 'Pickup minutes on top', 'time a DA at the FP needs to collect the order (SOP: shelf wait up to 5 min). Packed with less than ride + this left = the FP\'s', 'num', 1],
    ]],
    ['Pickers', '', [
      ['WAIT_TARGET_MIN', 'Max wait for a picker (min)', '', 'num', 1], ['HANDLE_TARGET_MIN', 'Picking time target (min)', 'start to packed', 'num', 1],
      ['SCHED_READY_MIN', 'Scheduled orders ready (min before slot)', '', 'num', 5],
      ['PK_SHIFT_GRACE_MIN', 'Shift grace (min)', 'orders packed this close before or after a picker\'s shift still count for them (Picker shifts)', 'num', 5],
    ]],
    ['Picker ranking weights', 'Relative weights; they don\'t need to add up to 1. 0 = not used.', [
      ['PK_RANK_WEIGHTS.secPerSku', 'Speed: seconds per SKU, basket-adjusted', '', 'num', 0.05],
      ['PK_RANK_WEIGHTS.slowLate', 'Late orders from slow picking', '', 'num', 0.05],
      ['PK_RANK_WEIGHTS.idle', 'Availability: idle while orders waited', '', 'num', 0.05],
      ['PK_RANK_WEIGHTS.attendance', 'Attendance: days present ÷ scheduled', '', 'num', 0.05],
      ['PK_RANK_WEIGHTS.pph', 'PPH (Ops)', 'orders ÷ active hours; rewards whoever got small baskets or busy hours', 'num', 0.05],
      ['PK_RANK_WEIGHTS.volume', 'Number of orders', 'same problem as picks per hour', 'num', 0.05],
    ]],
    ['DA ranking weights', 'Relative weights; they don\'t need to add up to 1. 0 = not used.', [
      ['DA_RANK_WEIGHTS.speed', 'Speed: first-drop ride vs usual', '', 'num', 0.05],
      ['DA_RANK_WEIGHTS.attendance', 'Attendance: days present ÷ scheduled', '', 'num', 0.05],
      ['DA_RANK_WEIGHTS.idle', 'Availability: off a trip while orders waited', '', 'num', 0.05],
      ['DA_RANK_WEIGHTS.roadLate', 'Late on the ride', '', 'num', 0.05],
      ['DA_RANK_WEIGHTS.dph', 'DPH (Ops)', 'deliveries ÷ active hours', 'num', 0.05],
      ['DA_RANK_WEIGHTS.volume', 'Number of deliveries', '', 'num', 0.05],
      ['DA_SHIFT_GRACE_MIN', 'DA shift grace (min)', 'deliveries picked up this close before or after a DA\'s shift still count for them (DA shifts)', 'num', 5],
    ]],
    ['Coffee & pharmacy', 'Turn off what this FP doesn\'t have: it disappears from every page, and no late order is put on it. Save to apply.', [
      ['SHOW_COFFEE', 'This FP has coffee', 'a Breadfast Coffee bar (barista)', 'bool'],
      ['SHOW_PHARMACY', 'This FP has a pharmacy', 'pharmacy orders and the pharmacy stop', 'bool'],
      ['COFFEE_DELAY_MIN', 'Coffee delay that counts (min)', 'extra time in the FP or awaiting pickup beyond a plain order', 'num', 1, () => hasCoffee()],
      ['PHARMACY_SHARE', 'Pharmacy detour share', 'a late pharmacy order counts as the pharmacy\'s if its extra time is at least this share of the usual detour (0.75 = 75%)', 'num', 0.05, () => hasPharma()],
      ['PHARMACY_MIN_EXTRA', 'Pharmacy extra at least (min)', '', 'num', 1, () => hasPharma()],
      ['PHARMACY_EXTRA_MIN', 'Pharmacy detour if not measurable (min)', 'used when the day has under 3 pharmacy orders', 'num', 1, () => hasPharma()],
      ['CP_STRICT', 'Blame coffee / pharmacy only if it explains the whole delay', 'On = an order 30 min late with a 10 min coffee wait keeps its normal owner (FP or logistics). Off = any order with that delay goes to coffee / pharmacy.', 'bool', null, () => hasCP()],
    ]],
    ['Root causes', 'When the Root causes page calls a check a problem.', [
      ['ROOT_DCM_TOL_PCT', 'DCM sized right within (%)', 'of what the pickers and DAs working that hour could handle, each at their own speed', 'num', 1],
      ['ROOT_SLOWER_PCT', 'Slow picking from (% slower)', 'than usual for those basket sizes', 'num', 5],
      ['ROOT_RIDE_SLOW_MIN', 'Slow ride from (min over usual)', 'a first drop this much longer than the usual ride to that sub-area', 'num', 1],
      ['ROOT_FORCED_PCT', 'Forced orders piled in from (% of the slot)', 'and at least 3 forced orders', 'num', 5],
      ['ROOT_BURST_PCT', 'Burst from (% of NOW orders in 15 min)', 'spread evenly would be 25%', 'num', 5],
    ]],
    ['Alerts on Live & capacity', '', [
      ['ALERT_QUEUE', 'Orders waiting for a picker', '', 'num', 1], ['ALERT_SHELF_MIN', 'Packed order awaiting pickup (min)', 'also the "slow pickup" mark in lifecycle tables', 'num', 1],
      ['ALERT_RISK_MIN', 'Order this close to its ETA (min)', 'NOW orders not picked up yet', 'num', 1],
    ]],
  ];

  BRAIN_VIEWS.settings = function () {
    const saved = PREFS.settings || {};
    const changed = (k) => k in saved && JSON.stringify(saved[k]) !== JSON.stringify(getPath(CFG_DEFAULTS, k));
    const field = ([k, label, help, kind, step]) => {
      const v = getPath(CFG, k), d = getPath(CFG_DEFAULTS, k);
      let input;
      if (kind === 'bool') input = '<label class="bgpick"><input type="checkbox" data-set="' + k + '" data-kind="bool"' + (v ? ' checked' : '') + '> ' + (v ? 'On' : 'Off') + '</label>';
      else if (Array.isArray(kind)) input = '<select class="sel" data-set="' + k + '" data-kind="sel">' + kind.map(([o, l]) => '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
      else input = '<input class="txt num" type="number" step="' + (step || 1) + '" data-set="' + k + '" data-kind="num" value="' + esc(v) + '">';
      const dTxt = kind === 'bool' ? (d ? 'On' : 'Off') : Array.isArray(kind) ? (kind.find((o) => o[0] === d) || [d, d])[1] : d;
      return '<div class="setrow' + (changed(k) ? ' chg' : '') + '"><div><b>' + label + '</b>' + (help ? '<div class="mini">' + help + '</div>' : '') + '</div><div>' + input + '</div><div class="mini">default ' + esc(dTxt) + '</div></div>';
    };
    let h = '<div class="note">Changes are saved in this browser only and apply to every page of the brain as soon as you press <b>Save</b> (the loaded day is re-analysed, no reload needed). Nothing here changes anything in the Control Room or DCM.</div>';
    h += '<div class="setbar"><button class="btn primary" data-setsave>Save and re-analyse</button> <button class="ghost" data-setreset>Reset all to defaults</button> <span class="saved" data-setmsg></span></div>';
    // shifts
    const sh = BRAIN_VIEWS._pendShifts || CFG.SHIFTS;
    h += card('Shifts', 'Each order belongs to the shift its timeslot falls in. A shift can run past midnight (e.g. 22 → 7). Every hour should belong to exactly one shift.',
      '<div class="tw"><table class="shed"><thead><tr><th class="l">Shift name</th><th>From (hour)</th><th>To (hour)</th><th class="l">Covers</th><th></th></tr></thead><tbody>' +
      sh.map((s, i) => '<tr data-sh="' + i + '"><td class="l"><input class="txt" data-shf="name" value="' + esc(s.name) + '"></td><td><input class="txt num" type="number" min="0" max="23" data-shf="from" value="' + s.from + '"></td><td><input class="txt num" type="number" min="1" max="24" data-shf="to" value="' + s.to + '"></td><td class="l mini">' + esc(shiftRange(s)) + '</td><td><button class="ghost sm" data-shdel="' + i + '">Remove</button></td></tr>').join('') +
      '</tbody></table></div><p><button class="ghost sm" data-shadd>+ Add shift</button> <span class="mini" data-shcheck>' + shiftCheck(sh) + '</span></p>');
    // forced
    h += card('Forced orders', 'Scheduled express is always forced. Otherwise, when a Control Room tab was open as the order was placed, the brain uses what it recorded: the NOW slot full in DCM, or the FP BUSY, = forced. When nothing was recorded then, a scheduled order placed less than this many hours before its slot counts as forced.',
      '<div class="setrow"><div><b>Forced if scheduled under (hours)</b></div><div><input class="txt num" type="number" step="0.5" min="0.5" max="48" data-forcedh value="' + CFG.PLANNED_AHEAD_HOURS + '"></div><div class="mini">only when nothing was recorded · default ' + CFG_DEFAULTS.PLANNED_AHEAD_HOURS + '</div></div>');
    // a row with a 6th item shows only when that returns true (e.g. pharmacy thresholds only for an FP with a pharmacy);
    // the group title is kept even when it names coffee / pharmacy, so the switches can always be turned back on
    SET_GROUPS.forEach(([title, sub, fields]) => { h += '<div class="card"><h2>' + title + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + fields.filter((f) => !f[5] || f[5]()).map(field).join('') + '</div>'; });
    return h;
  };
  function shiftCheck(list) {
    const cover = Array(24).fill(0);
    list.forEach((s) => { for (let h = 0; h < 24; h++) if (inShift(h, s)) cover[h]++; });
    const gaps = cover.map((c, h) => (c ? null : h)).filter((x) => x != null), over = cover.map((c, h) => (c > 1 ? h : null)).filter((x) => x != null);
    const hl = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm');
    if (!gaps.length && !over.length) return '<span style="color:var(--good)">✓ Every hour is covered once.</span>';
    return '<span style="color:var(--warn)">' + (gaps.length ? 'Not in any shift: ' + gaps.map(hl).join(', ') + '. ' : '') + (over.length ? 'In two shifts (first one wins): ' + over.map(hl).join(', ') + '.' : '') + '</span>';
  }
  BIND.settings = function (main) {
    const msg = main.querySelector('[data-setmsg]');
    const readShifts = () => Array.from(main.querySelectorAll('tr[data-sh]')).map((tr) => ({ name: tr.querySelector('[data-shf="name"]').value.trim(), from: parseInt(tr.querySelector('[data-shf="from"]').value, 10), to: parseInt(tr.querySelector('[data-shf="to"]').value, 10) }));
    main.querySelectorAll('tr[data-sh] input').forEach((el) => el.addEventListener('input', () => {
      const list = readShifts();
      main.querySelector('[data-shcheck]').innerHTML = validShifts(list) ? shiftCheck(list) : '<span style="color:var(--bad)">Each shift needs a name, a start 0–23 and an end 1–24.</span>';
    }));
    main.querySelectorAll('[data-set][data-kind="bool"]').forEach((el) => el.addEventListener('change', () => { el.parentNode.lastChild.textContent = el.checked ? ' On' : ' Off'; }));
    const keepShifts = (list) => { BRAIN_VIEWS._pendShifts = list; UI.render(); };
    main.querySelector('[data-shadd]').addEventListener('click', () => { const l = readShifts(); l.push({ name: 'New shift', from: 0, to: 1 }); keepShifts(l); });
    main.querySelectorAll('[data-shdel]').forEach((b) => b.addEventListener('click', () => { const l = readShifts(); l.splice(+b.dataset.shdel, 1); if (l.length) keepShifts(l); }));
    main.querySelector('[data-setsave]').addEventListener('click', async () => {
      const next = Object.assign({}, PREFS.settings || {});
      let bad = '';
      main.querySelectorAll('[data-set]').forEach((el) => {
        const k = el.dataset.set, kind = el.dataset.kind;
        let v = kind === 'bool' ? el.checked : kind === 'sel' ? el.value : parseFloat(el.value);
        if (kind === 'num' && !isFinite(v)) { bad = 'Check the number for "' + k + '".'; return; }
        if (JSON.stringify(v) === JSON.stringify(getPath(CFG_DEFAULTS, k))) delete next[k]; else next[k] = v;
        setPath(CFG, k, v);
      });
      const shifts = readShifts();
      if (!validShifts(shifts)) bad = 'Each shift needs a name, a start 0–23 and an end 1–24.';
      if (bad) { msg.style.color = 'var(--bad)'; msg.textContent = bad; return; }
      CFG.SHIFTS = shifts; BRAIN_VIEWS._pendShifts = null;
      if (JSON.stringify(shifts) === JSON.stringify(CFG_DEFAULTS.SHIFTS)) delete next.SHIFTS; else next.SHIFTS = shifts;
      const fh = parseFloat(main.querySelector('[data-forcedh]').value);
      if (isFinite(fh) && fh > 0) { CFG.PLANNED_AHEAD_HOURS = fh; if (fh === CFG_DEFAULTS.PLANNED_AHEAD_HOURS) delete PREFS.forcedCut; else PREFS.forcedCut = fh; }
      PREFS.settings = next; savePrefs();
      msg.style.color = ''; msg.textContent = 'Saved.';
      if (UI.raw) await UI.reanalyze(); else UI.render();
    });
    main.querySelector('[data-setreset]').addEventListener('click', async () => {
      PREFS.settings = {}; delete PREFS.forcedCut; savePrefs(); BRAIN_VIEWS._pendShifts = null;
      const d = JSON.parse(JSON.stringify(CFG_DEFAULTS));
      Object.keys(d).forEach((k) => { CFG[k] = d[k]; });
      if (UI.raw) await UI.reanalyze(); else UI.render();
    });
  };
  PAGE_DESC.settings = 'Targets, shift hours and the thresholds behind every verdict in the brain. Saved in this browser.';
  if (NO_DATA_TABS.indexOf('settings') < 0) NO_DATA_TABS.push('settings');

  /* ------------------------------------------------------------------
   * PICKERS → PICKER SHIFTS page
   * ------------------------------------------------------------------ */
  // One page for both teams. C = what differs between pickers and DAs.
  const ROSTER_PAGES = {
    pk: {
      RS: () => ROSTER, who: 'picker', Who: 'Picker', grace: 'PK_SHIFT_GRACE_MIN', hist: (d) => (d.pickers || []).filter((x) => x.orders > 0), noun: 'orders', verb: 'picked', recalcOn: 'Ranking &amp; bonuses (Pickers)',
      rows: (A) => (A && A.pk ? A.pk.rows : null), key: (r) => r.rosterKey, ok: (r) => r.rosterOk, why: (r) => r.rosterWhy, ta: (r) => r.start, tb: (r) => r.packed,
      intro: 'New hires and packaging leads often pick on someone else\'s account. Set each picker\'s <b>usual shift</b> and <b>day off</b> once; on any day you can change <b>that day only</b> (overtime, swapped day off, sent home). An order then counts for the account owner only if it was packed inside their shift',
      team: (A) => A.pk.team, stat: 'Not counted', ncTitle: 'Orders not counted for the account owner', ncSub: 'Packed outside the owner\'s shift or on their day off: most likely a packaging lead or a new hire on that account. They stay in the FP\'s queue, lateness and picking-time numbers.',
    },
    da: {
      RS: () => DAROSTER, who: 'DA', Who: 'DA', grace: 'DA_SHIFT_GRACE_MIN', hist: (d) => (d.das || []).filter((x) => x.deliveries > 0), noun: 'deliveries', verb: 'delivered', recalcOn: 'Ranking &amp; bonuses (DAs)',
      rows: (A) => (A && A.da ? A.rows.filter((r) => r.daKey) : null),
      key: (r) => r.daKey, ok: (r) => r.daOk, why: (r) => r.daWhy, ta: (r) => (r.pickedUp != null ? r.pickedUp : r.completed), tb: (r) => r.completed,
      intro: 'Set each DA\'s <b>usual shift</b> and <b>day off</b> once; on any day you can change <b>that day only</b> (overtime, swapped day off, sent home). Attendance and availability in the ranking are measured against these shifts, and a delivery counts for the DA only if they picked it up inside their shift',
      team: (A) => A.da.team, stat: 'Not counted', ncTitle: 'Deliveries not counted for the DA', ncSub: 'Picked up outside the DA\'s shift or on their day off (overtime you didn\'t enter, or someone else on the account). They stay in the FP\'s numbers.',
    },
  };
  function rosterPage(kind, A, M) {
    const C = ROSTER_PAGES[kind], RS = C.RS();
    const R = RS.load(M && M.fps && M.fps[0]);
    // every account seen in saved days too
    const H = UI.history || loadHistory();
    Object.values(H).forEach((d) => { const l = C.hist(d); if (l.length) RS.see(l.map((x) => ({ name: x.name, hr: x.hr, id: x.id })), d.date); });
    const dk = M && M.date, rowsAll = C.rows(A);
    const acc = new Map();
    if (rowsAll) groupBy(rowsAll.filter((r) => C.key(r)), C.key).forEach((g, k) => acc.set(k, { n: g.length, ok: g.filter(C.ok).length, first: Math.min(...g.map(C.ta)), last: Math.max(...g.map(C.tb)) }));
    const keys = Object.keys(R.pickers).sort((a, b) => {
      const x = R.pickers[a], y = R.pickers[b];
      return (x.excluded - y.excluded) || ((acc.has(b) ? 1 : 0) - (acc.has(a) ? 1 : 0)) || ((y.seen ? dateKey(y.seen) : '') > (x.seen ? dateKey(x.seen) : '') ? 1 : -1) || String(x.name).localeCompare(String(y.name));
    });
    const nSet = keys.filter((k) => R.pickers[k].shift).length, nEx = keys.filter((k) => R.pickers[k].excluded).length;
    const dayLbl = dk ? new Date(dayStartOf(dk)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
    const T = rowsAll ? C.team(A) : null;
    let h = '<div class="note">' + C.intro + ' (± ' + CFG[C.grace] + ' min) on a working day; the rest stays in the FP\'s numbers but not in that ' + C.who + '\'s performance or ranking. ' +
      'A shift that runs past midnight (e.g. 22 → 7) belongs to the day it starts. ' + C.Who + 's with no shift set count everything, as before. <b>Not ranked</b> = resigned or shared accounts: their ' + C.noun + ' still show, but they never enter the ranking. ' +
      'Saved in this browser. Changes apply to the loaded day when you press Save; to apply them to past days, use <b>Recalculate with current shifts</b> on ' + C.recalcOn + '.</div>';
    h += '<div class="tiles">' + tile(C.Who + ' accounts', keys.length, 'seen on analysed days') + tile('Usual shift set', nSet, keys.length - nSet ? (keys.length - nSet) + ' without (everything counts)' : 'all set') +
      tile('Not ranked', nEx, 'resigned or shared accounts') + (T ? tile('Not counted on ' + esc(dayLbl), T.notCounted || 0, T.notCountedOff ? T.notCountedOff + ' on a day off, ' + (T.notCounted - T.notCountedOff) + ' outside shift' : 'outside the shift') : '') + '</div>';
    h += '<div class="setbar"><button class="btn primary" data-rsave>Save and recalculate</button><span class="saved" data-rmsg></span></div>';
    const num = (attr, v, ph) => '<input class="txt num" type="number" min="0" max="24" step="0.5" ' + attr + ' value="' + (v == null ? '' : v) + '" placeholder="' + (ph || '') + '">';
    let t = '<div class="tw"><table class="roster"><thead><tr><th class="l">' + C.Who + '</th><th class="l">Ranking</th><th>Usual shift (from → to, hour)</th><th class="l">Day off</th>' + (dk ? '<th class="l">On ' + esc(dayLbl) + '</th><th class="l">On their account that day</th>' : '') + '</tr></thead><tbody>';
    keys.forEach((k) => {
      const p = R.pickers[k], a = acc.get(k), o = dk ? (R.days[dk] || {})[k] : null, pl = dk ? RS.plan(k, dk) : null;
      const mode = o ? (o.off ? 'off' : 'custom') : 'usual';
      const usualToday = p.shift && dk ? ((p.off || []).includes(new Date(dayStartOf(dk)).getDay()) ? 'usual: day off' : 'usual: ' + hhmm(p.shift.from) + '–' + hhmm(p.shift.to)) : 'no usual shift';
      t += '<tr data-rk="' + esc(k) + '"' + (p.excluded ? ' class="ex"' : '') + '><td class="l"><b>' + esc(p.name || '–') + '</b> <span class="muted">' + esc(p.hr || '') + '</span>' + (p.seen ? '<br><span class="mini">last ' + C.verb + ' ' + esc(p.seen) + '</span>' : '') + '</td>' +
        '<td class="l"><select class="sel" data-rex><option value="0">Ranked</option><option value="1"' + (p.excluded ? ' selected' : '') + '>Not ranked</option></select></td>' +
        '<td>' + num('data-ruf', p.shift ? p.shift.from : null, 'from') + ' → ' + num('data-rut', p.shift ? p.shift.to : null, 'to') + '</td>' +
        '<td class="l"><select class="sel" data-roff><option value="">None</option>' + WEEKDAYS.map((w, i) => '<option value="' + i + '"' + ((p.off || []).includes(i) ? ' selected' : '') + '>' + w + '</option>').join('') + '</select></td>';
      if (dk) {
        t += '<td class="l"><select class="sel" data-rdm><option value="usual"' + (mode === 'usual' ? ' selected' : '') + '>As usual (' + esc(usualToday.replace('usual: ', '')) + ')</option><option value="custom"' + (mode === 'custom' ? ' selected' : '') + '>Different hours</option><option value="off"' + (mode === 'off' ? ' selected' : '') + '>Day off / absent</option></select>' +
          '<div class="rday"' + (mode === 'custom' ? '' : ' style="display:none"') + '>' + num('data-rdf', o && o.from != null ? o.from : p.shift ? p.shift.from : null, 'from') + ' → ' + num('data-rdt', o && o.to != null ? o.to : p.shift ? p.shift.to : null, 'to') + '</div></td>';
        t += '<td class="l">' + (a ? '<b>' + a.n + '</b> ' + C.noun + (a.n !== a.ok ? ', <span class="pill warn">' + (a.n - a.ok) + ' not counted</span>' : '') + '<br><span class="mini">' + C.verb + ' ' + fmtTime(a.first) + '–' + fmtTime(a.last) + (pl ? ' · counted shift ' + esc(shiftTxt(pl)) : '') + '</span>' : pl && !pl.off ? '<span class="pill bad">none in shift</span> <span class="mini">shift ' + esc(shiftTxt(pl)) + '</span>' : '<span class="muted">–</span>') + '</td>';
      }
      t += '</tr>';
    });
    t += '</tbody></table></div>';
    h += card(C.Who + ' shifts', 'Hours in 24 h format, half hours allowed (7.5 = 07:30). Leave both empty for "no shift set".', keys.length ? t : '<p class="muted">No ' + C.who + ' accounts yet. Load a day in the Control Room and press Refresh.</p>');
    if (rowsAll) {
      const nc = rowsAll.filter((r) => C.ok(r) === false).sort((a, b) => C.tb(a) - C.tb(b));
      const res = (r) => (r.late == null ? '–' : r.late ? '<span class="pill bad">late</span>' : '<span class="pill good">on time</span>');
      const cols = kind === 'pk' ? [
        ['Order', (r) => r.orderNumber, (r) => '<b>' + esc(r.orderNumber) + '</b>', 'l'], ['Account', (r) => r.pickerName || '', (r) => esc(r.pickerName || '') + ' <span class="muted">' + esc(r.pickerHr || '') + '</span>', 'l'],
        ['Why', C.why, (r) => '<span class="pill warn">' + esc(C.why(r)) + '</span>', 'l'], ['Owner\'s shift', C.key, (r) => esc(shiftTxt(RS.plan(C.key(r), dk)))],
        ['Started', (r) => r.start, (r) => fmtTime(r.start)], ['Packed', (r) => r.packed, (r) => fmtTime(r.packed)], ['SKUs', (r) => r.skus], ['Sec / SKU', (r) => r.secPerSku, (r) => fmt(r.secPerSku, 0)], ['Result', (r) => (r.late ? 1 : 0), res],
      ] : [
        ['Order', (r) => r.orderNumber, (r) => '<b>' + esc(r.orderNumber) + '</b>', 'l'], ['DA', (r) => r.daName || '', (r) => esc(r.daName || '') + ' <span class="muted">' + esc(r.daHr || '') + '</span>', 'l'],
        ['Why', C.why, (r) => '<span class="pill warn">' + esc(C.why(r)) + '</span>', 'l'], ['DA\'s shift', C.key, (r) => esc(shiftTxt(RS.plan(C.key(r), dk)))],
        ['Picked up', (r) => r.pickedUp, (r) => fmtTime(r.pickedUp)], ['Delivered', (r) => r.completed, (r) => fmtTime(r.completed)], ['Sub-area', (r) => r.subArea, null, 'l'], ['Result', (r) => (r.late ? 1 : 0), res],
      ];
      h += card(C.ncTitle + ' · ' + nc.length, C.ncSub, nc.length ? table(cols, nc) : '<p class="muted">None: everything was inside the shift' + (nSet ? '' : ' (no shifts set yet)') + '.</p>');
    }
    return h;
  }
  BRAIN_VIEWS.pk_shifts = function (A, M) { return rosterPage('pk', A, M); };
  BRAIN_VIEWS.da_shifts = function (A, M) { return rosterPage('da', A, M); };
  function rosterBind(kind, main) {
    const C = ROSTER_PAGES[kind], RS = C.RS();
    main.querySelectorAll('select[data-rdm]').forEach((s) => s.addEventListener('change', () => { s.parentNode.querySelector('.rday').style.display = s.value === 'custom' ? '' : 'none'; }));
    const btn = main.querySelector('[data-rsave]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const R = RS.load(), dk = UI.meta && UI.meta.date, msg = main.querySelector('[data-rmsg]');
      const hr = (el) => { const v = parseFloat(el && el.value); return isFinite(v) && v >= 0 && v <= 24 ? v : null; };
      let bad = '';
      main.querySelectorAll('tr[data-rk]').forEach((tr) => {
        const k = tr.dataset.rk, p = R.pickers[k];
        if (!p) return;
        p.excluded = tr.querySelector('[data-rex]').value === '1';
        const f = hr(tr.querySelector('[data-ruf]')), t = hr(tr.querySelector('[data-rut]'));
        if (f != null && t != null && f !== t) p.shift = { from: f, to: t };
        else if (f == null && t == null) p.shift = null;
        else bad = 'Check the usual shift for ' + p.name + ' (both hours, and not the same).';
        const off = tr.querySelector('[data-roff]').value;
        p.off = off === '' ? [] : [+off];
        if (!dk) return;
        const m = tr.querySelector('[data-rdm]').value;
        const day = R.days[dk] || (R.days[dk] = {});
        if (m === 'usual') delete day[k];
        else if (m === 'off') day[k] = { off: true };
        else {
          const df = hr(tr.querySelector('[data-rdf]')), dt = hr(tr.querySelector('[data-rdt]'));
          if (df != null && dt != null && df !== dt) day[k] = { from: df, to: dt };
          else bad = 'Check the hours for ' + p.name + ' on this day.';
        }
        if (!Object.keys(day).length) delete R.days[dk];
      });
      // keep a year of day changes at most
      const cut = dateKeyOf(Date.now() - 400 * 86400000);
      Object.keys(R.days).forEach((d) => { if (dateKey(d) < dateKey(cut)) delete R.days[d]; });
      RS.save();
      if (bad) { msg.style.color = 'var(--bad)'; msg.textContent = 'Saved, but: ' + bad; } else { msg.style.color = ''; msg.textContent = 'Saved.'; }
      if (UI.raw) { await UI.reanalyze(); const m2 = UI.root.querySelector('[data-rmsg]'); if (m2 && bad) { m2.style.color = 'var(--bad)'; m2.textContent = 'Saved, but: ' + bad; } else if (m2) m2.textContent = 'Saved and recalculated.'; }
    });
  };
  BIND.pk_shifts = (main) => rosterBind('pk', main);
  BIND.da_shifts = (main) => rosterBind('da', main);
  PAGE_DESC.da_shifts = 'Each DA\'s shift and day off, changeable day by day, so attendance and availability are judged against the real roster. Also where resigned accounts are taken out of the ranking.';
  if (NO_DATA_TABS.indexOf('da_shifts') < 0) NO_DATA_TABS.push('da_shifts');
  PAGE_DESC.pk_shifts = 'Each picker\'s shift and day off, changeable day by day, so orders picked on their account by someone else don\'t count for them. Also where resigned accounts are taken out of the ranking.';
  if (NO_DATA_TABS.indexOf('pk_shifts') < 0) NO_DATA_TABS.push('pk_shifts');

  /* ------------------------------------------------------------------
   * P90 DEEP DIVE – every order from fastest to slowest, the exact P90 order,
   * how close the neighbours are, and how many orders stood between the day and the target.
   * Percentiles use the nearest-rank method (the same as the scorecard): P90 = the order at rank ⌈0.9 × n⌉.
   * ------------------------------------------------------------------ */
  const P90_TYPE = { now: { label: 'NOW, on time', color: '#1393CD' }, late: { label: 'NOW, late', color: '#E16C6F' }, forced: { label: 'Forced (scheduled)', color: '#EDC246' } };
  const orderType = (r) => (r.scheduled ? 'forced' : r.late ? 'late' : 'now');
  function p90Pool(A, withForced) {
    // incl. forced: NOW + forced orders by the day placed (same pool as the scorecard); NOW: NOW orders of this day's slots
    const PP = withForced ? (A.score && A.score.pool) || placedPool(A) : null;
    const pool = (withForced ? PP.nowDel.concat(PP.forcedDel) : A.rows.filter((r) => !r.subOrder && r.delivered && !r.scheduled)).filter((r) => r.deliveryMin != null);
    const s = pool.slice().sort((a, b) => a.deliveryMin - b.deliveryMin);
    const n = s.length;
    const rankAt = (p) => Math.min(n, Math.max(1, Math.ceil((p * n) / 100 - 1e-9)));
    const at = (p) => (n ? s[rankAt(p) - 1] : null);
    const T = CFG.P90_TARGET_MIN;
    const k90 = rankAt(90);
    const over = s.filter((r) => r.deliveryMin > T).length;
    const allowed = n - k90; // orders that may sit above the P90 order
    const toFix = Math.max(0, over - allowed);
    // P90 if the j slowest orders had been delivered within target
    const ifFixed = (j) => { const v = s.map((r) => r.deliveryMin); const keep = v.slice(0, Math.max(0, n - j)).concat(Array(Math.min(j, n)).fill(Math.min(T, v[0] || T))); keep.sort((a, b) => a - b); return keep[k90 - 1]; };
    // P90 if j more orders had come in very slow
    const ifWorse = (j) => { const v = s.map((r) => r.deliveryMin).concat(Array(j).fill(9999)); v.sort((a, b) => a - b); return v[p90Rank(v.length) - 1]; };
    return { s, n, at, rankAt, k90, p90: at(90), over, allowed, toFix, T, ifFixed, ifWorse, withForced };
  }

  // nearest-rank position of P90 among N orders (1-based); 1e-9 keeps 0.9 × 70 from rounding up to 64
  const p90Rank = (N) => Math.max(1, Math.ceil(0.9 * N - 1e-9));
  const p90Allowed = (N) => N - p90Rank(N); // how many orders may sit above target with P90 still on target

  // Typical orders for a full day at this FP, from saved history: same weekday first, else the last 7 days.
  // Only days saved after 23:30 count, so a day left open at 6pm doesn't drag the average down.
  function typicalDayOrders(A) {
    const H = loadHistory(), key = '|' + ((UI.meta && UI.meta.fps) || []).join(',');
    const today = UI.meta && UI.meta.date;
    const full = Object.keys(H).filter((k) => k.endsWith(key)).map((k) => H[k])
      .filter((x) => x.date !== today && x.day && x.day.orders && dayStartOf(x.date) && x.savedAt >= dayStartOf(x.date) + 23.5 * 3600000)
      .sort((a, b) => dayStartOf(b.date) - dayStartOf(a.date));
    const wd = new Date(dayStartOf(today) || Date.now()).getDay();
    const same = full.filter((x) => new Date(dayStartOf(x.date)).getDay() === wd).slice(0, 4);
    const use = same.length >= 2 ? same : full.slice(0, 7);
    if (!use.length) return null;
    return { orders: Math.round(use.reduce((a, x) => a + x.day.orders, 0) / use.length), days: use.length, basis: same.length >= 2 ? 'the last ' + use.length + ' ' + ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][wd] : 'the last ' + use.length + ' full days' };
  }

  // End-of-day plan for one pool: what is already lost, what can still be saved, and how many more
  // orders must land under target for P90 to finish the day on target.
  function p90Plan(A, P) {
    const T = P.T, now = Date.now();
    const ds = A.dk ? dayStartOf(A.dk) : dayStartOf(UI.meta && UI.meta.date), d1 = ds + 24 * 3600000;
    const inPool = (r) => !r.subOrder && (!r.scheduled || (P.withForced && r.forced && r.placed >= ds && r.placed < d1));
    const open = A.rows.filter((r) => inPool(r) && !['completed', 'cancelled', 'not-received'].includes(r.status) && r.placed != null)
      .map((r) => ({ r, age: (now - r.placed) / 60000 }));
    const lost = open.filter((x) => x.age > T);                // already past target: will finish over it
    const savable = open.filter((x) => x.age <= T).sort((a, b) => b.age - a.age);
    const O = P.over + lost.length, n = P.n + lost.length;
    // more orders needed, all under target, before P90 is back on target
    let clean = 0; while (O > p90Allowed(n + clean) && clean < 100000) clean++;
    // expected orders still to come today, in this pool
    const typ = typicalDayOrders(A);
    const placedSoFar = A.day.orders || A.rows.filter((r) => !r.subOrder).length;
    const poolShare = A.rows.filter((r) => !r.subOrder).length ? A.rows.filter(inPool).length / A.rows.filter((r) => !r.subOrder).length : 1;
    const estNew = typ ? Math.max(0, Math.round((typ.orders - placedSoFar) * poolShare)) : null;
    const userNew = BRAIN_VIEWS._p90E && BRAIN_VIEWS._p90E[P.withForced ? 'f' : 'n'];
    const newLeft = userNew != null ? userNew : estNew;
    const F = newLeft == null ? null : newLeft + savable.length;           // orders still to deliver today
    const budget = F == null ? null : p90Allowed(n + F) - O;               // how many of those may still go over target
    // projection: future orders take today's typical on-time and late times
    const v = P.s.map((r) => r.deliveryMin);
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : null; };
    const cleanMed = med(v.filter((m) => m <= T)) || T * 0.6, lateMed = med(v.filter((m) => m > T)) || T + 15;
    const project = (lateShare) => {
      if (F == null) return null;
      const k = Math.round(lateShare * F);
      const all = v.concat(lost.map((x) => Math.max(x.age, lateMed)), Array(k).fill(lateMed), Array(Math.max(0, F - k)).fill(cleanMed)).sort((a, b) => a - b);
      return { over: O + k, p90: all[p90Rank(all.length) - 1] };
    };
    const recent = P.s.filter((r) => r.completed != null && now - r.completed <= 2 * 3600000);
    const shareOf = (a) => (a.length ? a.filter((r) => r.deliveryMin > T).length / a.length : null);
    return { O, n, lost, savable, clean, typ, estNew, newLeft, F, budget, project, rToday: shareOf(P.s), r2h: shareOf(recent), n2h: recent.length, cleanMed, lateMed };
  }

  function p90PlanCard(A, P) {
    const T = P.T, key = P.withForced ? 'f' : 'n';
    const X = p90Plan(A, P);
    if (!A.isToday) return card('What would have changed P90', '', '<p class="pd" style="font-size:15px;margin:2px 0 6px">' + (P.toFix ? '<b style="color:var(--bad)">' + P.toFix + ' fewer order' + (P.toFix === 1 ? '' : 's') + ' over ' + T + ' min</b> would have put P90 on target.' : '<b style="color:var(--good)">P90 finished on target.</b> ' + Math.max(0, P.allowed - P.over) + ' more orders over ' + T + ' min would still have been on target.') + '</p>' + p90WhatIf(A, P, X));
    const pctOk = X.F ? Math.max(0, Math.min(100, ((X.F - Math.max(0, X.budget)) / X.F) * 100)) : null;
    let head;
    if (X.O <= p90Allowed(X.n)) head = '<b style="color:var(--good)">On target now.</b> ' + (X.budget != null ? 'You can afford <b>' + Math.max(0, X.budget) + '</b> more orders over ' + T + ' min for the rest of the day.' : 'Every order over ' + T + ' min from here uses up the margin.');
    else if (X.F != null && X.clean > X.F) head = '<b style="color:var(--bad)">Not reachable today.</b> P90 needs <b>' + X.clean + '</b> more orders under ' + T + ' min, but only about <b>' + X.F + '</b> are left to deliver today. Best possible finish: ' + p90Pill(X.project(0).p90) + '.';
    else head = 'Deliver the next <b style="font-size:20px;color:var(--ink)">' + X.clean + '</b> orders under ' + T + ' min and P90 is back on target.' + (X.budget != null ? ' With about ' + X.F + ' orders left today, at most <b>' + Math.max(0, X.budget) + '</b> of them can go over ' + T + ' min, so at least <b>' + fmt(pctOk, 0) + '%</b> must be on target.' : '');
    let h = '<p class="pd" style="font-size:15px;margin:2px 0 12px">' + head + '</p>';
    h += '<div class="kpis">' +
      kpi('Over ' + T + ' min', X.O, '', P.over + ' delivered + ' + X.lost.length + ' still open and already past ' + T, X.O <= p90Allowed(X.n) ? 'good' : 'bad') +
      kpi('Allowed over now', p90Allowed(X.n), '', 'of ' + X.n + ' orders (10%, nearest rank)', null) +
      kpi('Orders under ' + T + ' needed', X.clean, '', X.clean ? 'in a row, before P90 is on target' : 'already on target', X.clean ? 'bad' : 'good') +
      kpi('Still savable', X.savable.length, '', 'open orders under ' + T + ' min old', null) + '</div>';
    const estTxt = X.typ ? 'Estimate: ' + X.estNew + ' (a typical day here is ' + X.typ.orders + ' orders, from ' + esc(X.typ.basis) + ', minus ' + (A.day.orders || 0) + ' placed so far, times this pool\'s share).' : 'No full past days saved yet, so type your own estimate.';
    h += '<div class="mapbar" style="gap:10px;flex-wrap:wrap"><span><b>New orders still to come today</b> (this pool)</span><input class="txt num" type="number" min="0" step="1" data-p90e="' + key + '" value="' + (X.newLeft != null ? X.newLeft : '') + '" placeholder="type"><span class="mini">' + estTxt + (BRAIN_VIEWS._p90E && BRAIN_VIEWS._p90E[key] != null ? ' <a href="#" data-p90e-reset>use estimate</a>' : '') + '</span></div>';
    if (X.F != null) {
      const sc = [['Every order on target', 0], ['5% over target', 0.05]];
      if (X.r2h != null && X.n2h >= 5) sc.push(['Same as the last 2 hours (' + fmtPct(X.r2h * 100) + ' over)', X.r2h]);
      if (X.rToday != null) sc.push(['Same as today so far (' + fmtPct(X.rToday * 100) + ' over)', X.rToday]);
      const rows = sc.map(([label, r]) => Object.assign({ label, r }, X.project(r)));
      h += table([
        ['If the rest of the day goes', (x) => x.r, (x) => esc(x.label), 'l'], ['Over ' + T + ' by end of day', (x) => x.over, (x) => x.over + ' / ' + (X.n + X.F)],
        ['P90 at end of day', (x) => x.p90, (x) => p90Pill(x.p90)], ['On target?', (x) => x.p90, (x) => (x.p90 <= T ? '<b style="color:var(--good)">Yes</b>' : '<b style="color:var(--bad)">No</b>')],
      ], rows);
      h += '<p class="mini" style="margin-top:6px">Projection assumes orders from here take today\'s typical times: ' + Math.round(X.cleanMed) + ' min when on target, ' + Math.round(X.lateMed) + ' min when over.</p>';
    }
    if (X.savable.length) {
      const stage = (r) => (r.pickedUp != null ? 'Out for delivery' : r.packed != null ? 'Awaiting pickup' : 'In the FP');
      h += '<h3 class="sect" style="margin-top:14px">Save these first: open orders closest to ' + T + ' min</h3>';
      h += table([
        ['Order', (x) => x.r.orderNumber, null, 'l'], ['Age', (x) => x.age, (x) => Math.round(x.age) + ' min'],
        ['Min left', (x) => T - x.age, (x) => '<b style="color:' + (T - x.age <= 10 ? '#E16C6F' : T - x.age <= 20 ? '#EDC246' : '#7ECE9F') + '">' + Math.max(0, Math.round(T - x.age)) + '</b>'],
        ['Stage', (x) => stage(x.r), (x) => stage(x.r), 'l'], ['Picker', (x) => x.r.pickerName || '', null, 'l'], ['DA', (x) => x.r.daName || '', null, 'l'], ['Sub-area', (x) => x.r.subArea, null, 'l'],
      ], X.savable.slice(0, 10));
    }
    if (X.lost.length) h += '<p class="mini" style="margin-top:8px">' + X.lost.length + ' open order' + (X.lost.length > 1 ? 's are' : ' is') + ' already past ' + T + ' min and counted as over: ' + X.lost.slice(0, 8).map((x) => esc(x.r.orderNumber) + ' (' + Math.round(x.age) + ' min)').join(', ') + (X.lost.length > 8 ? '…' : '') + '.</p>';
    h += p90WhatIf(A, P, X);
    return card('Fix it by end of day', 'Counts open orders too: the ones already past ' + T + ' min will finish over it. "Orders under ' + T + ' needed" is how many more deliveries in a row must be on target; the late budget is how many of the rest of today\'s orders may still go over.', h);
  }

  /* ---------- What-if calculators (v1.23): P90 Analysis and ETA Late Analysis, any day ----------
   * Two numbers to play with: more orders that make it, more orders that don't. Today they start from the orders still
   * expected (open orders + a typical day's orders not placed yet); on a closed day from zero, to see what would have changed it. */
  const WI = { p90: {}, eta: {} }, WI_CALC = {};
  function whatIfBox(kind, labelG, labelB, g0, b0) {
    return '<div class="wi"><div class="wi-in"><label>' + labelG + '<input class="txt num" type="number" min="0" step="1" data-wi="' + kind + '" data-wik="g" value="' + g0 + '"></label>' +
      '<label>' + labelB + '<input class="txt num" type="number" min="0" step="1" data-wi="' + kind + '" data-wik="b" value="' + b0 + '"></label></div>' +
      '<div class="wi-res" data-wires="' + kind + '">' + WI_CALC[kind](g0, b0) + '</div></div>';
  }
  function wiBind(main) {
    main.querySelectorAll('input[data-wi]').forEach((inp) => inp.addEventListener('input', () => {
      const kind = inp.dataset.wi, box = inp.closest('.wi');
      const val = (k) => Math.max(0, parseInt(box.querySelector('input[data-wik="' + k + '"]').value, 10) || 0);
      const g = val('g'), b = val('b');
      WI[kind] = { g, b, d: UI.meta && UI.meta.date };
      const res = box.querySelector('[data-wires]'); if (res && WI_CALC[kind]) res.innerHTML = WI_CALC[kind](g, b);
    }));
    const ee = main.querySelector('input[data-etae]');
    if (ee) ee.addEventListener('change', () => { BRAIN_VIEWS._etaE = ee.value === '' ? null : Math.max(0, Math.round(+ee.value)); WI.eta = {}; setTimeout(() => UI.render(), 0); });
    const er = main.querySelector('[data-etae-reset]');
    if (er) er.addEventListener('click', (e) => { e.preventDefault(); BRAIN_VIEWS._etaE = null; WI.eta = {}; UI.render(); });
  }
  const wiStart = (kind, g) => { const w = WI[kind]; return w && w.d === (UI.meta && UI.meta.date) ? w : { g, b: 0 }; };

  // P90: the day's delivered orders (+ today's open orders already past target), plus g more at a typical on-time time and b more at a typical late time
  function p90WhatIf(A, P, X) {
    const T = P.T;
    const base = P.s.map((r) => r.deliveryMin).concat(X.lost.map((x) => Math.max(x.age, X.lateMed)));
    WI_CALC.p90 = (g, b) => {
      const all = base.concat(Array(b).fill(X.lateMed), Array(g).fill(X.cleanMed)).sort((p, q) => p - q);
      if (!all.length) return '–';
      const p = all[p90Rank(all.length) - 1], over = X.O + b, allowed = p90Allowed(all.length);
      return '<p class="lres">P90 would end the day at ' + p90Pill(p) + ' <span class="pill ' + (p <= T ? 'good' : 'bad') + '">' + (p <= T ? 'On target' : 'Over target') + '</span></p>' +
        '<p class="mini">' + over + ' of ' + all.length + ' orders over ' + T + ' min; up to ' + allowed + ' can be over and P90 still hits ' + T + '. ' +
        (over <= allowed ? 'Room for <b>' + (allowed - over) + '</b> more over ' + T + ' min.' : '<b>' + (over - allowed) + '</b> too many over ' + T + ' min.') + '</p>';
    };
    const W = wiStart('p90', A.isToday && X.F != null ? X.F : 0);
    return '<h3 class="sect" style="margin-top:18px">Play with the numbers</h3><p class="mini" style="margin:0 0 8px">' +
      (A.isToday ? 'Starts from the orders still expected today. ' : 'This day is closed: add orders to see what would have changed it. ') +
      'New orders take today\'s typical times: ' + Math.round(X.cleanMed) + ' min when on target, ' + Math.round(X.lateMed) + ' min when over.</p>' +
      whatIfBox('p90', 'More orders under ' + T + ' min', 'More orders over ' + T + ' min', W.g, W.b);
  }

  // ETA late %: NOW orders. L late of D delivered (today: + open NOW orders already past their ETA, which will be late).
  function etaPlan(A) {
    const S = A.score, t = CFG.LATE_TARGET_PCT / 100, now = Date.now();
    const open = A.isToday ? A.rows.filter((r) => !r.subOrder && !r.scheduled && !['completed', 'cancelled', 'not-received'].includes(r.status)) : [];
    const openLate = open.filter((r) => r.deadline != null && r.deadline < now), savable = open.filter((r) => r.deadline == null || r.deadline >= now);
    const L = S.extra.etaLate + openLate.length, D = S.extra.delivered + openLate.length;
    const allowed = Math.floor(t * D + 1e-9), onTarget = D ? L <= t * D + 1e-9 : true;
    const need = onTarget ? 0 : Math.max(0, Math.ceil(L / t - D - 1e-9));
    const typ = A.isToday ? typicalDayOrders(A) : null;
    const nowShare = A.day.orders ? A.day.nowCount / A.day.orders : 1;
    const estNew = typ ? Math.max(0, Math.round((typ.orders - (A.day.orders || 0)) * nowShare)) : null;
    const userNew = BRAIN_VIEWS._etaE;
    const newLeft = A.isToday ? (userNew != null ? userNew : estNew) : 0;
    const F = newLeft == null ? null : newLeft + savable.length;
    const budget = F == null ? null : Math.floor(t * (D + F) + 1e-9) - L;
    const nowDel = S.nowDel.filter((r) => r.late != null);
    const recent = nowDel.filter((r) => r.completed != null && now - r.completed <= 2 * 3600000);
    const shareOf = (a) => (a.length ? a.filter((r) => r.late).length / a.length : null);
    const project = (share) => { if (F == null) return null; const k = Math.round(share * F); return { late: L + k, of: D + F, eta: (100 * (L + k)) / Math.max(1, D + F) }; };
    return { t, L, D, open, openLate, savable, allowed, onTarget, need, typ, estNew, newLeft, F, budget, project, rToday: shareOf(nowDel), r2h: shareOf(recent), n2h: recent.length };
  }
  function etaWhatIfCard(A) {
    if (!A.score) return '';
    const E = etaPlan(A), T = CFG.LATE_TARGET_PCT, Tx = fmt(T, T % 1 ? 1 : 0) + '%';
    WI_CALC.eta = (g, b) => {
      const of = E.D + g + b, e = of ? (100 * (E.L + b)) / of : null, ok = e != null && e <= T + 1e-9;
      const maxLate = Math.floor(E.t * of + 1e-9) - E.L;
      return '<p class="lres">ETA late % would end the day at ' + kpiPill('eta', e) + ' <span class="pill ' + (ok ? 'good' : 'bad') + '">' + (ok ? 'On target' : 'Over target') + '</span></p>' +
        '<p class="mini">' + (E.L + b) + ' late of ' + of + ' NOW orders delivered. ' + (maxLate >= 0 ? (maxLate - b >= 0 ? 'Room for <b>' + (maxLate - b) + '</b> more late.' : '<b>' + (b - maxLate) + '</b> too many late.') : 'Even with every new order on time, ' + Tx + ' needs <b>' + Math.max(0, Math.ceil(E.L / E.t - E.D - g - 1e-9)) + '</b> more on-time orders.') + '</p>';
    };
    let h;
    if (!A.isToday) {
      const fewer = E.onTarget ? 0 : E.L - E.allowed;
      h = '<p class="pd" style="font-size:15px;margin:2px 0 6px">' + (E.onTarget ? '<b style="color:var(--good)">Finished on target.</b> ' + (E.allowed - E.L) + ' more late orders would still have been on target.'
        : '<b style="color:var(--bad)">' + fewer + ' fewer late order' + (fewer === 1 ? '' : 's') + '</b> would have put ETA late % on ' + Tx + ' (' + E.L + ' late of ' + E.D + '; ' + E.allowed + ' allowed).') + '</p>';
    } else {
      let head;
      if (E.onTarget) head = '<b style="color:var(--good)">On target now.</b> ' + (E.budget != null ? 'You can afford <b>' + Math.max(0, E.budget) + '</b> more late NOW orders for the rest of the day.' : 'Every late order from here uses up the margin.');
      else if (E.F != null && E.need > E.F) head = '<b style="color:var(--bad)">Not reachable today.</b> ' + Tx + ' needs <b>' + E.need + '</b> more on-time NOW deliveries, but only about <b>' + E.F + '</b> are left today. Best possible finish: ' + kpiPill('eta', E.project(0).eta) + '.';
      else head = 'Deliver the next <b style="font-size:20px">' + E.need + '</b> NOW orders on time and ETA late % is back on ' + Tx + '.' + (E.budget != null ? ' With about ' + E.F + ' left today, at most <b>' + Math.max(0, E.budget) + '</b> of them can be late.' : '');
      h = '<p class="pd" style="font-size:15px;margin:2px 0 12px">' + head + '</p>';
      h += '<div class="kpis">' +
        kpi('Late now', E.L, '', (E.L - E.openLate.length) + ' delivered late + ' + E.openLate.length + ' open and already past their ETA', E.onTarget ? 'good' : 'bad') +
        kpi('Allowed late now', E.allowed, '', 'of ' + E.D + ' NOW orders (' + Tx + ')', null) +
        kpi('On time needed', E.need, '', E.need ? 'NOW deliveries in a row before ' + Tx : 'already on target', E.need ? 'bad' : 'good') +
        kpi('Still savable', E.savable.length, '', 'open NOW orders not past their ETA yet', null) + '</div>';
      const estTxt = E.typ ? 'Estimate: ' + E.estNew + ' (a typical day here is ' + E.typ.orders + ' orders, from ' + esc(E.typ.basis) + ', minus ' + (A.day.orders || 0) + ' placed so far, times the NOW share).' : 'No full past days saved yet, so type your own estimate.';
      h += '<div class="mapbar" style="gap:10px;flex-wrap:wrap"><span><b>New NOW orders still to come today</b></span><input class="txt num" type="number" min="0" step="1" data-etae value="' + (E.newLeft != null ? E.newLeft : '') + '" placeholder="type"><span class="mini">' + estTxt + (BRAIN_VIEWS._etaE != null ? ' <a href="#" data-etae-reset>Use the estimate</a>' : '') + '</span></div>';
      if (E.F != null) {
        const sc = [['Every order on time', 0], [Tx + ' late', E.t]];
        if (E.r2h != null && E.n2h >= 5) sc.push(['Same as the last 2 hours (' + fmtPct(E.r2h * 100) + ' late)', E.r2h]);
        if (E.rToday != null) sc.push(['Same as today so far (' + fmtPct(E.rToday * 100) + ' late)', E.rToday]);
        h += table([
          ['If the rest of the day goes', (x) => x.r, (x) => esc(x.label), 'l'], ['Late by end of day', (x) => x.late, (x) => x.late + ' / ' + x.of],
          ['ETA late % at end of day', (x) => x.eta, (x) => kpiPill('eta', x.eta)], ['On target?', (x) => x.eta, (x) => (x.eta <= T + 1e-9 ? '<b style="color:var(--good)">Yes</b>' : '<b style="color:var(--bad)">No</b>')],
        ], sc.map(([label, r]) => Object.assign({ label, r }, E.project(r))));
      }
    }
    const W = wiStart('eta', A.isToday && E.F != null ? E.F : 0);
    h += '<h3 class="sect" style="margin-top:18px">Play with the numbers</h3><p class="mini" style="margin:0 0 8px">' + (A.isToday ? 'Starts from the NOW orders still expected today.' : 'This day is closed: add orders to see what would have changed it.') + ' ETA late % counts NOW orders only.</p>' +
      whatIfBox('eta', 'More NOW orders on time', 'More NOW orders late', W.g, W.b);
    return card(A.isToday ? 'Fix ETA late % by end of day' : 'What would have changed ETA late %', A.isToday ? 'Counts open NOW orders too: the ones already past their ETA will be late.' : '', h);
  }

  function p90Chart(P) {
    const W = 1100, H = 380, padL = 52, padR = 16, padT = 18, padB = 40;
    const iw = W - padL - padR, ih = H - padT - padB;
    const v = P.s.map((r) => r.deliveryMin);
    const p98 = v[P.rankAt(98) - 1] || 0;
    const yMax = Math.ceil(Math.max(P.T * 1.6, (P.p90 ? P.p90.deliveryMin : 0) * 1.15, p98 * 1.05) / 50) * 50;
    const x = (pc) => padL + (pc / 100) * iw;
    const y = (m) => padT + ih - (Math.min(m, yMax) / yMax) * ih;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Every order by percentile">';
    // grid
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const m = (yMax / steps) * i, yy = y(m);
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--grid)"/><text x="' + (padL - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + Math.round(m) + '</text>';
    }
    for (let pc = 0; pc <= 100; pc += 10) svg += '<line x1="' + x(pc) + '" x2="' + x(pc) + '" y1="' + padT + '" y2="' + (padT + ih) + '" stroke="var(--grid)"/><text x="' + x(pc) + '" y="' + (H - padB + 18) + '" text-anchor="middle">P' + pc + '</text>';
    svg += '<text x="6" y="' + (padT + ih / 2) + '" transform="rotate(-90 12 ' + (padT + ih / 2) + ')" text-anchor="middle">minutes, placed to delivered</text>';
    // the band of orders allowed above P90 (the slowest 10%)
    svg += '<rect x="' + x(90) + '" y="' + padT + '" width="' + (x(100) - x(90)) + '" height="' + ih + '" fill="rgba(170,3,130,.10)"/>';
    svg += '<text x="' + ((x(90) + x(100)) / 2) + '" y="' + (padT + 14) + '" text-anchor="middle" style="fill:var(--accent)">slowest 10%</text>';
    // target
    const ty = y(P.T);
    svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ty + '" y2="' + ty + '" stroke="var(--good-rule)" stroke-dasharray="6 4" stroke-width="1.5"/>';
    svg += '<text x="' + (padL + 6) + '" y="' + (ty - 6) + '" style="fill:var(--good)">target ' + P.T + ' min</text>';
    // curve
    const pts = P.s.map((r, i) => [x(((i + 1) / P.n) * 100), y(r.deliveryMin)]);
    if (pts.length) svg += '<polyline points="' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" fill="none" stroke="var(--ink-3)" stroke-width="1.2" opacity=".55"/>';
    const rad = P.n > 600 ? 2.2 : P.n > 250 ? 3 : 3.8;
    P.s.forEach((r, i) => {
      const t = orderType(r), pc = ((i + 1) / P.n) * 100;
      const tip = '<b>Rank ' + (i + 1) + ' of ' + P.n + ' · P' + pc.toFixed(1) + '</b><br>' + esc(r.orderNumber) + ' · ' + esc(slotLabel(r.slot)) + '<br><b>' + Math.round(r.deliveryMin) + ' min</b> placed to delivered<br>' + P90_TYPE[t].label + (r.late ? ' · ' + esc(whyLate(r)) : '') + '<br>' + esc(r.subArea || '') + (r.pickerName ? '<br>Picker: ' + esc(r.pickerName) : '') + (r.daName ? '<br>DA: ' + esc(r.daName) : '');
      if (r.deliveryMin > yMax) svg += '<path d="M' + (pts[i][0] - 4) + ',' + (padT + 7) + ' L' + pts[i][0] + ',' + (padT + 1) + ' L' + (pts[i][0] + 4) + ',' + (padT + 7) + 'Z" fill="' + P90_TYPE[t].color + '" data-tip="' + esc(tip + '<br><i>off the chart</i>') + '"/>';
      else svg += '<circle cx="' + pts[i][0].toFixed(1) + '" cy="' + pts[i][1].toFixed(1) + '" r="' + rad + '" fill="' + P90_TYPE[t].color + '" data-tip="' + esc(tip) + '"/>';
    });
    // the P90 order
    if (P.p90) {
      const px = x((P.k90 / P.n) * 100), py = y(P.p90.deliveryMin);
      svg += '<line x1="' + px + '" x2="' + px + '" y1="' + padT + '" y2="' + (padT + ih) + '" stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="3 3"/>';
      svg += '<circle cx="' + px + '" cy="' + py + '" r="' + (rad + 4) + '" fill="none" stroke="var(--ink)" stroke-width="2"/>';
      const label = 'P90 = ' + Math.round(P.p90.deliveryMin) + ' min · ' + P.p90.orderNumber;
      const lx = Math.min(px - 8, W - padR - 8), anchor = 'end';
      svg += '<rect x="' + (lx - label.length * 6.6 - 10) + '" y="' + (py - 30) + '" width="' + (label.length * 6.6 + 16) + '" height="22" rx="5" fill="var(--paper)" stroke="var(--rule-strong)"/>';
      svg += '<text x="' + (lx - 2) + '" y="' + (py - 15) + '" text-anchor="' + anchor + '" style="fill:var(--ink);font-weight:700">' + esc(label) + '</text>';
      const p50 = P.at(50);
      if (p50) svg += '<text x="' + x(50) + '" y="' + (y(p50.deliveryMin) - 10) + '" text-anchor="middle" style="fill:var(--ink-2)">P50 ' + Math.round(p50.deliveryMin) + '</text>';
    }
    svg += '</svg>';
    return '<div class="legend">' + Object.keys(P90_TYPE).filter((k) => P.withForced || k !== 'forced').map((k) => '<span><i style="background:' + P90_TYPE[k].color + ';border-radius:50%"></i>' + P90_TYPE[k].label + '</span>').join('') + '<span><i style="background:rgba(170,3,130,.35)"></i>The slowest 10% (allowed above P90)</span><span><i style="background:#7ECE9F;height:3px"></i>Target</span></div>' + svg;
  }

  BRAIN_VIEWS.p90 = function (A) {
    const which = BRAIN_VIEWS._p90 || 'forced';
    const P = p90Pool(A, which === 'forced');
    const other = p90Pool(A, which !== 'forced');
    const fmtM = (r) => (r ? Math.round(r.deliveryMin) : '–');
    let h = '<div class="mapbar"><div class="seg" data-p90>' + [['forced', 'P90 incl. forced'], ['now', 'P90 NOW']].map(([k, l]) => '<button data-v="' + k + '" class="' + (which === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div><span class="mini">' + (which === 'forced' ? 'NOW orders plus forced orders, by the day placed (see How "forced" is counted on the Scorecard). P90 NOW is ' + fmtM(other.p90) + ' min.' : 'NOW orders only. P90 incl. forced is ' + fmtM(other.p90) + ' min.') + '</span></div>';
    if (!P.n) return h + '<div class="status">No delivered orders in this pool.</div>';
    const p89 = P.at(89), p91 = P.at(91);
    const st = statusOf(P.p90.deliveryMin, P.T, 1.2);
    h += '<div class="kpis">' +
      kpi(which === 'forced' ? 'P90 incl. forced' : 'P90 NOW', fmtM(P.p90), 'min', 'Order ' + esc(P.p90.orderNumber) + ', rank ' + P.k90 + ' of ' + P.n, st) +
      kpi('P89 → P91', fmtM(p89) + '–' + fmtM(p91), 'min', 'One rank either side moves P90 by up to ' + Math.round(Math.max(P.p90.deliveryMin - p89.deliveryMin, p91.deliveryMin - P.p90.deliveryMin)) + ' min', null) +
      kpi('Orders over ' + P.T + ' min', P.over, '', 'of ' + P.n + '. Up to ' + P.allowed + ' can be over target and P90 still hits it', P.over <= P.allowed ? 'good' : 'bad') +
      kpi('Orders to fix', P.toFix, '', P.toFix ? P.toFix + ' fewer orders over ' + P.T + ' min and P90 would have hit target' : 'P90 is within target', P.toFix ? 'bad' : 'good') + '</div>';
    h += p90PlanCard(A, P);
    h += card('Every order, fastest to slowest', 'Each dot is one delivered order, placed on the x-axis by how many orders were faster (its percentile) and on the y-axis by minutes from placing to delivery. The circled dot is the P90 order. Everything right of P90 is the slowest 10%: the KPI only moves when an order crosses from that band into the rest, or back. Hover any dot for the order. Orders above the chart are shown as ▲.', p90Chart(P));
    // percentile ladder
    const LADDER = [10, 20, 30, 40, 50, 60, 70, 75, 80, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100];
    const ladder = LADDER.map((p) => { const r = P.at(p); return { p, r, k: P.rankAt(p) }; });
    h += '<div class="grid two">';
    h += card('Percentile ladder', 'Minutes at each percentile, and the order sitting there. The P89 to P91 rows show how much the KPI could swing on one or two orders.', table([
      ['Percentile', (x) => x.p, (x) => '<b' + (x.p === 90 ? ' style="color:var(--accent)"' : '') + '>P' + x.p + '</b>', 'l'], ['Rank', (x) => x.k, (x) => x.k + ' / ' + P.n],
      ['Minutes', (x) => x.r.deliveryMin, (x) => (x.p === 90 ? p90Pill(x.r.deliveryMin) : fmt(x.r.deliveryMin, 0))], ['vs P90', (x) => x.r.deliveryMin - P.p90.deliveryMin, (x) => (x.p === 90 ? '<span class="muted">–</span>' : (x.r.deliveryMin >= P.p90.deliveryMin ? '+' : '') + Math.round(x.r.deliveryMin - P.p90.deliveryMin))],
      ['Order', (x) => x.r.orderNumber, null, 'l'], ['Type', (x) => orderType(x.r), (x) => '<span class="st-dot" style="background:' + P90_TYPE[orderType(x.r)].color + '"></span>' + P90_TYPE[orderType(x.r)].label, 'l'],
    ], ladder));
    // what if
    const fixes = Array.from(new Set([1, 2, 3, 5, 10, P.toFix].filter((j) => j > 0 && j <= P.n))).sort((a, b) => a - b);
    const whatIf = fixes.map((j) => ({ label: 'The ' + j + ' slowest delivered within ' + P.T + ' min', v: P.ifFixed(j), j })).concat([1, 3].map((j) => ({ label: j + ' more very slow order' + (j > 1 ? 's' : ''), v: P.ifWorse(j), j: -j })));
    h += card('What would have moved it', 'P90 recalculated if the slowest orders had been fixed, or if a few more had gone badly. ' + (P.toFix ? '<b>' + P.toFix + '</b> fixed orders is exactly what hitting ' + P.T + ' min needed.' : 'Already within target.'), table([
      ['If', (x) => x.j, (x) => esc(x.label), 'l'], ['P90 would be', (x) => x.v, (x) => p90Pill(x.v)], ['Change', (x) => x.v - P.p90.deliveryMin, (x) => (x.v - P.p90.deliveryMin > 0 ? '+' : '') + Math.round(x.v - P.p90.deliveryMin) + ' min'],
    ], whatIf));
    h += '</div>';
    // around the P90 order
    const lo = Math.max(0, P.k90 - 7), hi = Math.min(P.n, P.k90 + 6);
    const near = P.s.slice(lo, hi).map((r, i) => ({ r, k: lo + i + 1 }));
    tripContext(A);
    h += card('The orders around P90', 'Ranks ' + (lo + 1) + '–' + hi + '. The highlighted row is the P90 order. Each step up or down this list is what one order more or one order less in the slowest 10% would do.', table([
      ['Rank', (x) => x.k, (x) => (x.k === P.k90 ? '<b style="color:var(--accent)">' + x.k + ' · P90</b>' : String(x.k)), 'l'], ['Percentile', (x) => (x.k / P.n) * 100, (x) => 'P' + ((x.k / P.n) * 100).toFixed(1)],
      ['Minutes', (x) => x.r.deliveryMin, (x) => (x.k === P.k90 ? p90Pill(x.r.deliveryMin) : fmt(x.r.deliveryMin, 0))], ['vs P90', (x) => x.r.deliveryMin - P.p90.deliveryMin, (x) => (x.k === P.k90 ? '–' : (x.r.deliveryMin >= P.p90.deliveryMin ? '+' : '') + fmt(x.r.deliveryMin - P.p90.deliveryMin, 1))],
      ['Order', (x) => x.r.orderNumber, null, 'l'], ['Type', (x) => orderType(x.r), (x) => P90_TYPE[orderType(x.r)].label, 'l'], ['Slot', (x) => x.r.slot, (x) => esc(slotLabel(x.r.slot)), 'l'],
      ['FP', (x) => diffMin(x.r.packed, x.r.placed), (x) => fmt(diffMin(x.r.packed, x.r.placed), 0)], ['Awaiting pickup', (x) => x.r.shelfMin, (x) => fmt(x.r.shelfMin, 0)], ['Ride', (x) => x.r.legMin, (x) => fmt(x.r.legMin, 0)],
      ['Late because', (x) => whyLate(x.r), (x) => (x.r.late ? esc(whyLate(x.r)) : '<span class="muted">on time</span>'), 'l'], ['Owner', (x) => (x.r.late ? ownerOf(x.r) : ''), (x) => (x.r.late ? esc(ownerOf(x.r)) : ''), 'l'],
      ['Picker', (x) => x.r.pickerName || '', null, 'l'], ['DA', (x) => x.r.daName || '', null, 'l'], ['Sub-area', (x) => x.r.subArea, null, 'l'],
    ], near));
    // what the slowest 10% is made of
    const tail = P.s.slice(P.k90 - 1);
    const tailRows = (fn) => countBy(tail, fn).map(([k, n]) => ({ k, n, share: rate(n, tail.length) }));
    const small = (title, rows, label) => card(title, '', table([[label, (x) => x.k, (x) => esc(String(x.k)), 'l'], ['Orders', (x) => x.n], ['Share', (x) => x.share, (x) => '<span class="sharebar"><i style="width:' + Math.min(100, x.share) + '%"></i></span>' + fmtPct(x.share)]], rows));
    const stageA = stageSplit(P.s.filter((r) => !r.scheduled)), stageT = stageSplit(tail.filter((r) => !r.scheduled));
    h += '<h3 class="sect">What the slowest 10% is made of</h3><p class="pd">' + tail.length + ' orders at or above P90 (' + Math.round(P.p90.deliveryMin) + '+ min). ' + (stageT.store != null ? 'NOW orders in it spent ' + fmt(stageT.store, 0) + ' min in the FP (typical ' + fmt(stageA.store, 0) + '), ' + fmt(stageT.shelf, 0) + ' awaiting pickup (' + fmt(stageA.shelf, 0) + ') and ' + fmt(stageT.road, 0) + ' on the ride (' + fmt(stageA.road, 0) + ').' : '') + '</p>';
    h += '<div class="grid two">' +
      small('By type', tailRows((r) => P90_TYPE[orderType(r)].label), 'Type') +
      small('By why it was slow', tailRows((r) => (r.late ? whyLate(r) : r.scheduled ? 'Forced: waited for its slot' : 'On time, long ETA')), 'Reason') +
      small('By timeslot', tailRows((r) => slotLabel(r.slot)).sort((a, b) => b.n - a.n).slice(0, 8), 'Timeslot') +
      small('By sub-area', tailRows((r) => r.subArea).slice(0, 8), 'Sub-area') + '</div>';
    return h;
  };
  BIND.p90 = function (main) {
    main.querySelectorAll('.seg[data-p90] button').forEach((b) => b.addEventListener('click', () => { BRAIN_VIEWS._p90 = b.dataset.v; UI.render(); }));
    main.querySelectorAll('input[data-p90e]').forEach((inp) => inp.addEventListener('change', () => {
      const v = inp.value === '' ? null : Math.max(0, Math.round(+inp.value));
      BRAIN_VIEWS._p90E = Object.assign({}, BRAIN_VIEWS._p90E, { [inp.dataset.p90e]: v }); setTimeout(() => UI.render(), 0);
    }));
    main.querySelectorAll('[data-p90e-reset]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); BRAIN_VIEWS._p90E = {}; UI.render(); }));
  };

  /* ------------------------------------------------------------------
   * DEMAND – load any range of past days (read-only, one Control Room day at a time): orders and basket size per hour
   * by weekday, pickers and DAs needed per timeslot at the PPH (Ops) / DPH (Ops) targets, what stands out, and one CSV of every order.
   * The CSV has no customer data and no staff names (HR IDs only).
   * Hourly totals per day are kept in this browser so the table builds up over time.
   * ------------------------------------------------------------------ */
  const STORE_DEMAND = 'fpx:demand:v1:';
  const DEM = { running: false, msg: '', rows: null, range: null };
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WD_ORDER = [6, 0, 1, 2, 3, 4, 5];   // Sat first, as the Egyptian week runs

  function demLoad(fp) { try { return JSON.parse(localStorage.getItem(STORE_DEMAND + fp) || '{}'); } catch (e) { return {}; } }
  function demSave(fp, o) {
    const keys = Object.keys(o).sort((a, b) => dateKey(a) < dateKey(b) ? -1 : 1);
    while (keys.length > 120) delete o[keys.shift()];   // about four months of hourly totals
    try { localStorage.setItem(STORE_DEMAND + fp, JSON.stringify(o)); } catch (e) { }
  }
  // Orders the store handles in each hour: NOW orders by the hour placed, scheduled orders by their slot hour.
  function demHourly(A) {
    const z = () => Array(24).fill(0);
    const now = z(), sched = z(), forced = z(), skus = z(), skN = z(), large = z();
    A.rows.filter((r) => !r.wasSub && r.status !== 'cancelled').forEach((r) => {
      const h = !r.scheduled ? r.placedHour : r.slot != null ? r.slot % 24 : null;
      if (h == null) return;
      if (!r.scheduled) now[h]++; else { sched[h]++; if (!r.plannedAhead) forced[h]++; }
      if (r.skus != null) { skus[h] += r.skus; skN[h]++; if (r.skus >= CFG.LARGE_BASKET_SKUS) large[h]++; }
    });
    return { now, sched, forced, total: now.map((v, h) => v + sched[h]), skus, skN, large, v: 2 };
  }
  const demIso = (ms) => { if (ms == null) return ''; const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };
  const DEM_COLS = [
    ['date', (r, dk) => dk], ['weekday', (r, dk) => WD[new Date(dayStartOf(dk)).getDay()]],
    ['order_number', (r) => r.orderNumber], ['status', (r) => r.status], ['type', (r) => r.type], ['sub_order', (r) => (r.wasSub ? 'yes' : '')],
    ['scheduled', (r) => (r.scheduled ? 'yes' : '')], ['forced', (r) => (r.scheduled && !r.plannedAhead ? 'yes' : '')], ['slot_hour', (r) => (r.slot == null ? '' : r.slot)],
    ['placed', (r) => demIso(r.placed)], ['placed_hour', (r) => (r.placedHour == null ? '' : r.placedHour)],
    ['packed', (r) => demIso(r.packed)], ['da_pickup', (r) => demIso(r.pickedUp)], ['delivered', (r) => demIso(r.completed)],
    ['delivery_min', (r) => (r.deliveryMin == null ? '' : r.deliveryMin.toFixed(1))], ['late', (r) => (r.late == null ? '' : r.late ? 'yes' : 'no')],
    ['unique_skus', (r) => (r.skus == null ? '' : r.skus)], ['bags', (r) => (r.bags == null ? '' : r.bags)], ['coffee', (r) => (r.coffee ? 'yes' : '')], ['pharmacy', (r) => (r.pharma ? 'yes' : '')],
    ['sub_area', (r) => r.subArea], ['km', (r) => (r.distKm == null ? '' : r.distKm.toFixed(2))], ['picker_hr', (r) => r.pickerHr || ''], ['da_hr', (r) => r.daHr || ''], ['trip', (r) => r.tripId || ''],
  ];
  function demCsv(rows) {
    const e = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const cols = DEM_COLS.filter(cpShowCol);
    return '﻿' + [cols.map((c) => c[0]).join(',')].concat(rows.map(([r, dk]) => cols.map((c) => e(c[1](r, dk))).join(','))).join('\n');
  }
  const demDk = (t) => pad2(t.getDate()) + '-' + pad2(t.getMonth() + 1) + '-' + t.getFullYear();
  const demFromInput = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const demToInput = (t) => t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());

  async function demRun(from, to, onStep) {
    if (DEM.running || !CAP.ordersUrl) return;
    DEM.running = true;
    const out = [];
    const fp = new URL(CAP.ordersUrl).searchParams.getAll('fps[]')[0] || 'fp';
    const store = demLoad(fp);
    try {
      const days = [];
      const yesterday = new Date(); yesterday.setHours(0, 0, 0, 0); yesterday.setDate(yesterday.getDate() - 1);
      for (const t = new Date(from); t <= to && t <= yesterday; t.setDate(t.getDate() + 1)) days.push(demDk(t));
      let coords = null;
      for (let i = 0; i < days.length; i++) {
        const dk = days[i];
        onStep('Loading ' + dk + ' (' + (i + 1) + ' of ' + days.length + ')…');
        let res;
        try { res = await fetchAllOrders((n, tot) => onStep('Loading ' + dk + ' (' + (i + 1) + ' of ' + days.length + '): ' + n + (isFinite(tot) ? ' / ' + tot : '') + ' orders'), dk); }
        catch (e) { onStep('Stopped at ' + dk + ': ' + e.message + '. Everything before it is kept.'); break; }
        if (!res.orders.length) continue;
        if (!coords) coords = await getFpCoords(res.orders);
        const A = analyze(res.orders, coords);
        A.rows.filter((r) => r.status !== 'cancelled').forEach((r) => out.push([r, dk]));
        store[dk] = Object.assign(demHourly(A), { orders: A.rows.filter((r) => !r.wasSub && r.status !== 'cancelled').length, savedAt: Date.now() });
      }
      demSave(fp, store);
      DEM.rows = out; DEM.range = [days[0], days[days.length - 1]];
      onStep('Loaded ' + plural(new Set(out.map((x) => x[1])).size, 'day', 'days') + ', ' + out.length + ' orders. The CSV is downloading.');
      if (out.length) UI.download(demCsv(out), 'demand-' + ((UI.meta && UI.meta.fpNames[0]) || 'fp').replace(/[^\w]+/g, '-') + '-' + DEM.range[0] + '-to-' + DEM.range[1] + '.csv');
    } finally { DEM.running = false; }
  }

  // Heat colours, white → Breadfast pink: six clear steps so the busiest cells stand out at a glance
  const HEAT = ['#FFFFFF', '#FBE3EF', '#F4BCD9', '#E57FB8', '#C33F91', '#8E1C6F'];
  const heatCell = (v, t, txt) => {
    if (v == null) return '<td class="hm-c" style="background:#F0EFEB;color:#8a8b89 !important">–</td>';
    const i = Math.max(0, Math.min(HEAT.length - 1, Math.round(t * (HEAT.length - 1))));
    return '<td class="hm-c" style="background:' + HEAT[i] + ';color:' + (i >= 3 ? '#fff' : '#343434') + ' !important">' + txt + '</td>';
  };
  const heatLegend = (lo, hi, unit) => '<div class="hm-leg"><span>' + lo + '</span>' + HEAT.map((c) => '<i style="background:' + c + '"></i>').join('') + '<span>' + hi + (unit ? ' ' + unit : '') + '</span></div>';
  const DEM_CSS = '<style>.hm{border-collapse:separate;border-spacing:3px;width:100%}.hm th{font-size:12px;font-weight:600;color:var(--ink-2);padding:4px 6px;text-align:center}.hm th.l,.hm td.l{text-align:left;white-space:nowrap}.hm td.hm-c{text-align:center;font-weight:650;font-size:13px;padding:7px 4px;border-radius:5px;min-width:44px;border:1px solid rgba(0,0,0,.06)}.hm td.x{text-align:right;padding:4px 8px;font-size:13px;white-space:nowrap}.hm td.l.x{text-align:left;font-weight:600}.hm-leg{display:flex;align-items:center;gap:4px;margin:10px 0 0;font-size:12px;color:var(--ink-2)}.hm-leg i{display:inline-block;width:28px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.08)}.dem-ins li{margin:6px 0;line-height:1.55}</style>';
  const demRange = () => {
    const y = new Date(); y.setHours(0, 0, 0, 0); y.setDate(y.getDate() - 1);
    const f0 = new Date(y); f0.setDate(f0.getDate() - 13);
    return { from: DEM.from || f0, to: DEM.to || y };
  };
  const ceilNeed = (orders, rate) => (orders > 0 && rate > 0 ? Math.ceil(orders / rate - 1e-9) : 0);

  BRAIN_VIEWS.demand = function (A) {
    const fp = (UI.meta && UI.meta.fps && UI.meta.fps[0]) || 'fp';
    const S = demLoad(fp);
    if (UI.meta && UI.meta.date && A && A.rows) { const dk = UI.meta.date, cur = S[dk]; if (!A.isToday && (!cur || cur.orders < A.rows.length * 0.5 || !cur.skus)) { S[dk] = Object.assign(demHourly(A), { orders: A.rows.filter((r) => !r.wasSub && r.status !== 'cancelled').length, savedAt: Date.now() }); demSave(fp, S); } }
    const RG = demRange();
    let h = DEM_CSS + '<div class="mapbar" style="gap:10px;flex-wrap:wrap"><span>From</span><input class="txt" style="width:150px" type="date" data-demfrom value="' + demToInput(RG.from) + '"><span>to</span><input class="txt" style="width:150px" type="date" data-demto value="' + demToInput(RG.to) + '">' +
      '<button class="btn" data-demrun' + (DEM.running ? ' disabled' : '') + '>' + (DEM.running ? 'Loading…' : 'Load these days and export CSV') + '</button><span class="mini demmsg">' + esc(DEM.msg || 'Shows the days already loaded in this range. Loading reads one day at a time from the Control Room (read-only); keep this tab open.') + '</span></div>';
    const inRange = (dk) => { const t = dayStartOf(dk); return t != null && t >= RG.from.getTime() && t <= RG.to.getTime(); };
    const days = Object.keys(S).filter((k) => S[k] && S[k].total && inRange(k)).sort((a, b) => dateKey(a) < dateKey(b) ? -1 : 1);
    const stored = Object.keys(S).filter((k) => S[k] && S[k].total).length;
    if (!days.length) return h + '<div class="status">No days loaded in this range yet' + (stored ? ' (' + stored + ' days saved outside it)' : '') + '. Pick the range and press <b>Load these days and export CSV</b>.</div>';
    const D = days.map((dk) => Object.assign({ dk, wd: new Date(dayStartOf(dk)).getDay() }, S[dk]));
    const pctl = (a, p) => { const v = a.slice().sort((x, z) => x - z); return v.length ? v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length - 1e-9) - 1))] : null; };
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const byWd = {}; D.forEach((d) => { (byWd[d.wd] = byWd[d.wd] || []).push(d); });
    const wds = WD_ORDER.filter((w) => byWd[w]);
    const basketD = D.filter((d) => d.skus);
    const hrs = Array.from({ length: 24 }, (_, hr) => {
      const all = D.map((d) => d.total[hr]);
      const o = { hr, avg: mean(all), p80: pctl(all, 0.8), max: Math.max.apply(null, all), sched: mean(D.map((d) => d.sched[hr])) };
      o.sd = Math.sqrt(mean(all.map((v) => (v - o.avg) ** 2)) || 0);
      const n = basketD.reduce((t, d) => t + d.skN[hr], 0);
      o.sku = n ? basketD.reduce((t, d) => t + d.skus[hr], 0) / n : null; o.skN = n; o.largeSh = n ? (100 * basketD.reduce((t, d) => t + d.large[hr], 0)) / n : null;
      WD_ORDER.forEach((w) => {
        const g = byWd[w] || [];
        o['w' + w] = g.length ? mean(g.map((d) => d.total[hr])) : null;
        const gb = g.filter((d) => d.skus), m = gb.reduce((t, d) => t + d.skN[hr], 0);
        o['b' + w] = m ? gb.reduce((t, d) => t + d.skus[hr], 0) / m : null; o['bn' + w] = m;
      });
      return o;
    });
    const open = hrs.filter((x) => x.avg >= 0.5);
    const dayTot = D.map((d) => ({ dk: d.dk, wd: WD[d.wd], n: d.orders || d.total.reduce((a, b) => a + b, 0), sku: d.skus ? d.skus.reduce((a, b) => a + b, 0) / Math.max(1, d.skN.reduce((a, b) => a + b, 0)) : null }));
    const avgDay = mean(dayTot.map((x) => x.n));
    const allSku = basketD.length ? basketD.reduce((t, d) => t + d.skus.reduce((a, b) => a + b, 0), 0) / Math.max(1, basketD.reduce((t, d) => t + d.skN.reduce((a, b) => a + b, 0), 0)) : null;
    const peak = hrs.slice().sort((a, b) => (b.p80 || 0) - (a.p80 || 0))[0];
    const busiest = dayTot.slice().sort((a, b) => b.n - a.n)[0];
    h += '<div class="kpis">' + kpi('Orders per day', fmt(avgDay, 0), '', 'average of ' + days.length + ' days (' + esc(days[0] + ' to ' + days[days.length - 1]) + '), without cancelled and sub-orders', null) +
      kpi('Busiest day', busiest.n, '', esc(busiest.dk + ' (' + busiest.wd + ')'), null) +
      kpi('Peak hour, busy day', peak.p80, 'orders', esc(hourLabel(peak.hr)) + ' · the 80th-percentile day', null) +
      kpi('Average basket', allSku != null ? fmt(allSku, 1) : '–', 'SKUs', basketD.length < D.length ? basketD.length + ' of ' + D.length + ' days have basket sizes (reload older days)' : 'unique SKUs per order', null) + '</div>';

    // ---- what stands out ----
    const ins = [];
    const top = open.slice().sort((a, b) => b.avg - a.avg).slice(0, 3);
    if (top.length && avgDay) ins.push('<b>Peak hours:</b> ' + top.map((x) => hourLabel(x.hr) + ' (' + fmt(x.avg, 1) + ' a day)').join(', ') + '. Together ' + Math.round((100 * top.reduce((t, x) => t + x.avg, 0)) / avgDay) + '% of the day\'s orders.');
    const wdAvg = wds.map((w) => ({ w, n: mean(byWd[w].map((d) => d.orders || d.total.reduce((a, b) => a + b, 0))), k: byWd[w].length }));
    if (wdAvg.length >= 2) {
      const s2 = wdAvg.slice().sort((a, b) => b.n - a.n), hi = s2[0], lo = s2[s2.length - 1];
      ins.push('<b>Weekdays:</b> ' + WD[hi.w] + ' is the busiest (' + fmt(hi.n, 0) + ' orders a day), ' + WD[lo.w] + ' the quietest (' + fmt(lo.n, 0) + ', ' + Math.round((100 * (hi.n - lo.n)) / Math.max(1, hi.n)) + '% fewer than ' + WD[hi.w] + ').' + (s2.some((x) => x.k < 2) ? ' Some weekdays have only one day loaded, so treat this as a first read.' : ''));
      const we = wdAvg.filter((x) => x.w === 5 || x.w === 6), wk = wdAvg.filter((x) => x.w !== 5 && x.w !== 6);
      if (we.length && wk.length) { const a = mean(we.map((x) => x.n)), b2 = mean(wk.map((x) => x.n)); ins.push('<b>Weekend (Fri–Sat) vs weekdays:</b> ' + fmt(a, 0) + ' vs ' + fmt(b2, 0) + ' orders a day (' + (a >= b2 ? '+' : '') + Math.round((100 * (a - b2)) / Math.max(1, b2)) + '%).'); }
    }
    if (allSku != null) {
      const big = open.filter((x) => x.sku != null && x.skN >= 10 && x.sku >= allSku * 1.15).sort((a, b) => b.sku - a.sku);
      const small = open.filter((x) => x.sku != null && x.skN >= 10 && x.sku <= allSku * 0.85).sort((a, b) => a.sku - b.sku);
      if (big.length) ins.push('<b>Bigger baskets</b> at ' + big.slice(0, 4).map((x) => hourLabel(x.hr) + ' (' + fmt(x.sku, 1) + ')').join(', ') + ' vs ' + fmt(allSku, 1) + ' SKUs on average: those hours need more picking time per order than the order count says.');
      if (small.length) ins.push('<b>Smaller baskets</b> at ' + small.slice(0, 3).map((x) => hourLabel(x.hr) + ' (' + fmt(x.sku, 1) + ')').join(', ') + ': quick picks, so DAs are more likely the limit there than pickers.');
    }
    const vol = open.filter((x) => x.avg >= 5 && D.length >= 5 && x.sd / x.avg >= 0.4).sort((a, b) => b.sd / b.avg - a.sd / a.avg);
    if (vol.length) ins.push('<b>Hard to plan:</b> ' + vol.slice(0, 3).map((x) => hourLabel(x.hr) + ' (' + fmt(x.avg - x.sd, 0) + '–' + fmt(x.avg + x.sd, 0) + ' on most days)').join(', ') + (vol.length > 1 ? ' swing' : ' swings') + ' the most from day to day. Staff those for the busy day, not the average.');
    const sh = open.filter((x) => x.avg >= 3).map((x) => ({ hr: x.hr, s: x.sched / x.avg })).sort((a, b) => b.s - a.s)[0];
    if (sh && sh.s >= 0.2) ins.push('<b>Scheduled orders</b> are ' + Math.round(sh.s * 100) + '% of ' + hourLabel(sh.hr) + '\'s orders, the highest share of any hour: that load is known ahead, so it can be planned.');
    if (dayTot.length >= 10) {
      const last = mean(dayTot.slice(-7).map((x) => x.n)), prev = mean(dayTot.slice(-14, -7).map((x) => x.n));
      if (prev) ins.push('<b>Trend:</b> the last 7 days averaged ' + fmt(last, 0) + ' orders a day vs ' + fmt(prev, 0) + ' the ' + Math.min(7, dayTot.length - 7) + ' days before (' + (last >= prev ? '+' : '') + Math.round((100 * (last - prev)) / prev) + '%).');
    }
    h += card('What stands out', 'From the ' + days.length + ' days in this range. NOW orders count in the hour they were placed, scheduled orders in their slot hour (when the work happens).', '<ul class="dem-ins">' + ins.map((l) => '<li>' + l + '</li>').join('') + '</ul>');

    // ---- staff needed per timeslot ----
    const basis = BRAIN_VIEWS._demB || 'busy';
    const buf = PREFS.demBuf != null ? PREFS.demBuf : 0;
    const ordersOf = (x) => (basis === 'avg' ? x.avg : basis === 'busy' ? x.p80 : x['w' + basis.slice(1)]);
    const label = basis === 'avg' ? 'an average day' : basis === 'busy' ? 'a busy day (80th percentile)' : 'an average ' + WD[+basis.slice(1)];
    const need = hrs.map((x) => { const o = ordersOf(x) || 0; return { hr: x.hr, o, sku: x.sku, pk: ceilNeed(o * (1 + buf / 100), CFG.PPH_OPS_TARGET), da: ceilNeed(o * (1 + buf / 100), CFG.DPH_OPS_TARGET) }; }).filter((x) => x.o > 0);
    const segB = '<div class="seg" data-demb>' + [['busy', 'Busy day'], ['avg', 'Average day']].concat(wds.map((w) => ['w' + w, WD[w]])).map(([k, l]) => '<button data-v="' + k + '" class="' + (basis === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    const segF = '<div class="seg" data-dembuf>' + [0, 10, 15, 20].map((v) => '<button data-v="' + v + '" class="' + (buf === v ? 'on' : '') + '">' + (v ? '+' + v + '%' : 'No buffer') + '</button>').join('') + '</div>';
    const shiftRows = CFG.SHIFTS.map((sh0) => {
      const g = need.filter((x) => inShift(x.hr, sh0));
      if (!g.length) return null;
      const pk = g.slice().sort((a, b) => b.pk - a.pk)[0], da = g.slice().sort((a, b) => b.da - a.da)[0];
      return { name: sh0.name, range: shiftRange(sh0), pk: pk.pk, pkAt: pk.hr, da: da.da, daAt: da.hr, pkH: g.reduce((t, x) => t + x.pk, 0), daH: g.reduce((t, x) => t + x.da, 0), orders: g.reduce((t, x) => t + x.o, 0) };
    }).filter(Boolean);
    const SHIFT_TBL = shiftRows.length ? table([
      ['Shift', (r) => r.name, (r) => '<b>' + esc(r.name) + '</b> <span class="muted">' + esc(r.range) + '</span>', 'l'], ['Orders', (r) => r.orders, (r) => fmt(r.orders, 0)],
      ['Pickers to roster', (r) => r.pk, (r) => '<b>' + r.pk + '</b> <span class="muted">peak ' + shortHour(r.pkAt) + '</span>'], ['DAs to roster', (r) => r.da, (r) => '<b>' + r.da + '</b> <span class="muted">peak ' + shortHour(r.daAt) + '</span>'],
      ['Picker-hours', (r) => r.pkH], ['DA-hours', (r) => r.daH],
    ], shiftRows) + '<p class="mini" style="margin-top:8px"><b>To roster</b> = the busiest hour\'s need in that shift: with everyone on the same hours, that many people cover the peak. <b>Picker-hours / DA-hours</b> = the sum over the shift\'s hours: the least you need if you stagger start times. Any hour with orders needs at least one person.</p>' : '';
    h += card('Pickers and DAs needed per timeslot', 'Orders ÷ your PPH (Ops) target (' + CFG.PPH_OPS_TARGET + ') for pickers and ÷ your DPH (Ops) target (' + CFG.DPH_OPS_TARGET + ') for DAs, rounded up, for ' + label + (buf ? ', plus a ' + buf + '% buffer for absences and no-shows' : '') + '. Targets come from Settings.',
      '<div class="mapbar" style="gap:10px;flex-wrap:wrap">' + segB + segF + '</div>' + SHIFT_TBL +
      '<h3 style="margin:18px 0 8px;font-size:14px">Per timeslot</h3>' + table([
        ['Hour', (r) => r.hr, (r) => esc(slotLabel(r.hr)), 'l'], ['Orders', (r) => r.o, (r) => fmt(r.o, 1)], ['Basket (SKUs)', (r) => r.sku, (r) => fmt(r.sku, 1)],
        ['Pickers needed', (r) => r.pk, (r) => '<b>' + r.pk + '</b>'], ['DAs needed', (r) => r.da, (r) => '<b>' + r.da + '</b>'],
      ], need));

    // ---- heat maps ----
    const maxW = Math.max(1, ...hrs.map((x) => Math.max(...wds.map((w) => x['w' + w] || 0))));
    let m = '<div class="tw"><table class="hm"><thead><tr><th class="l">Hour</th>' + wds.map((w) => '<th>' + WD[w] + ' <span class="muted">(' + byWd[w].length + ')</span></th>').join('') + '<th>Average</th><th>Busy day</th><th>Highest</th><th>Scheduled</th></tr></thead><tbody>';
    hrs.filter((x) => x.max > 0).forEach((x) => { m += '<tr><td class="l x">' + esc(hourLabel(x.hr)) + '</td>' + wds.map((w) => heatCell(x['w' + w], (x['w' + w] || 0) / maxW, fmt(x['w' + w], 0))).join('') + '<td class="x">' + fmt(x.avg, 1) + '</td><td class="x"><b>' + x.p80 + '</b></td><td class="x">' + x.max + '</td><td class="x">' + fmt(x.sched, 1) + '</td></tr>'; });
    m += '</tbody></table></div>' + heatLegend(0, Math.round(maxW), 'orders');
    h += card('Orders per hour by weekday', 'Average orders in each hour on each weekday (number of days in brackets). Darker = more orders. <b>Busy day</b> = the 80th percentile across all days in the range: the level to staff for. Cancelled orders and sub-orders are left out.', m);
    const bv = []; hrs.forEach((x) => wds.forEach((w) => { if (x['b' + w] != null && x['bn' + w] >= 3) bv.push(x['b' + w]); }));
    if (bv.length) {
      const bs = bv.slice().sort((p, q) => p - q), lo = bs[Math.floor(0.1 * (bs.length - 1))], hi = bs[Math.ceil(0.9 * (bs.length - 1))];
      let b2 = '<div class="tw"><table class="hm"><thead><tr><th class="l">Hour</th>' + wds.map((w) => '<th>' + WD[w] + '</th>').join('') + '<th>All days</th><th>Large baskets</th></tr></thead><tbody>';
      hrs.filter((x) => x.skN >= 3).forEach((x) => { b2 += '<tr><td class="l x">' + esc(hourLabel(x.hr)) + '</td>' + wds.map((w) => (x['b' + w] != null && x['bn' + w] >= 3 ? heatCell(x['b' + w], hi > lo ? Math.max(0, Math.min(1, (x['b' + w] - lo) / (hi - lo))) : 0.5, fmt(x['b' + w], 1)) : heatCell(null))).join('') + '<td class="x"><b>' + fmt(x.sku, 1) + '</b></td><td class="x">' + fmtPct(x.largeSh) + '</td></tr>'; });
      b2 += '</tbody></table></div>' + heatLegend(fmt(lo, 1) + ' or less', fmt(hi, 1) + '+', 'SKUs');
      h += card('Basket size per hour by weekday', 'Average unique SKUs per order. Darker = bigger baskets (one odd cell does not set the scale: it runs from the 10th to the 90th percentile of the cells here). Cells with under 3 orders are left blank. <b>Large baskets</b> = share of orders with ' + CFG.LARGE_BASKET_SKUS + '+ SKUs.', b2);
    } else h += '<div class="note">Basket sizes aren\'t saved for these days yet. Press <b>Load these days</b> to add them.</div>';
    h += card('Orders per day', '', table([['Date', (x) => dayStartOf(x.dk), (x) => esc(x.dk), 'l'], ['Weekday', (x) => x.wd, null, 'l'], ['Orders', (x) => x.n], ['Basket (SKUs)', (x) => x.sku, (x) => fmt(x.sku, 1)]], dayTot.slice().reverse()));
    return h;
  };
  BIND.demand = function (main) {
    main.querySelectorAll('.seg[data-demb] button').forEach((x) => x.addEventListener('click', () => { BRAIN_VIEWS._demB = x.dataset.v; UI.render(true); }));
    main.querySelectorAll('.seg[data-dembuf] button').forEach((x) => x.addEventListener('click', () => { PREFS.demBuf = +x.dataset.v; savePrefs(); UI.render(true); }));
    ['[data-demfrom]', '[data-demto]'].forEach((sel) => { const el = main.querySelector(sel); if (el) el.addEventListener('change', () => { const f = demFromInput(main.querySelector('[data-demfrom]').value), t = demFromInput(main.querySelector('[data-demto]').value); if (f && t && f <= t) { DEM.from = f; DEM.to = t; DEM.msg = ''; UI.render(true); } }); });
    const b = main.querySelector('[data-demrun]');
    if (b) b.addEventListener('click', async () => {
      const f = demFromInput(main.querySelector('[data-demfrom]').value), t = demFromInput(main.querySelector('[data-demto]').value);
      if (!f || !t || f > t) { DEM.msg = 'Pick a start date before the end date.'; UI.render(); return; }
      DEM.from = f; DEM.to = t; DEM.msg = '';
      b.disabled = true; b.textContent = 'Loading…';
      await demRun(f, t, (m) => { DEM.msg = m; const s = UI.root.querySelector('main .demmsg'); if (s) s.textContent = m; });
      UI.render();
    });
  };

  /* ------------------------------------------------------------------
   * COMPLAINTS (on demand) and ORDER TAGS (automatic).
   * Order tags = the icons next to each order in the Control Room. They come with the order list, so they cost nothing.
   * Complaints = the Freshdesk tickets the Control Room shows under an order's details. The order list does not say
   * which orders have tickets, so finding them means one read-only lookup per order: it only runs when someone
   * presses "Check complaints". Each answer is cut down at once to the ticket's work fields (type, status, time,
   * category from the title and tags, refund, business unit). Customer name, phone, email and the message are
   * never kept. Results are saved per day in this browser.
   * ------------------------------------------------------------------ */
  const STORE_CMP = 'fpx:cmp:v1:';
  const CMP_URL = 'https://www.breadfast.com/wp-json/freshdesk/v1/freshdesk-wrapper?endpoint=';
  const cmpSleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const CMP = { busy: false, stop: false, dk: null, done: 0, total: 0, failed: 0, msg: '' };

  // [key, label, test on the raw Control Room order, colour]
  const TAG_DEFS = [
    ['frozen', 'Frozen', (o) => o.hasFrozen, '#1393CD'],
    ['fragile', 'Fragile', (o) => o.hasFragile, '#AA0382'],
    ['care', 'Handle with care', (o) => o.handleWithCare, '#E16C6F'],
    ['unscan', 'Cannot scan item', (o) => o.hasUnscannable, '#EDC246'],
    ['newcust', 'New customer', (o) => o.firstOrder, '#2BB5A3'],
    ['gift', 'Gift order', (o) => o.isGiftOrder, '#8a8b89'],
    ['hotfood', 'Hot food', (o) => o.hasHotfood, '#C33F91'],
    ['coffee', 'Coffee', (o) => o.hasCoffee, '#8E5B3E'],
    ['pharma', 'Pharmacy', (o) => o.hasPharma, '#5c9e5c'],
  ];
  function orderTags(o) { return TAG_DEFS.filter(([, , f]) => !!f(o)).map(([k]) => k); }
  const tagShown = (k) => (k === 'coffee' ? hasCoffee() : k === 'pharma' ? hasPharma() : true);
  const tagLabel = (k) => { const d = TAG_DEFS.find((x) => x[0] === k); return d ? d[1] : k; };
  const tagChips = (r) => (r && r.tags ? r.tags.filter(tagShown).map((k) => '<span class="tagchip">' + esc(tagLabel(k)) + '</span>').join('') : '');

  /* ---------- the saved results, per FP and day ---------- */
  const cmpKey = (dk) => STORE_CMP + (((UI.meta && UI.meta.fps) || []).join(',') || 'fp') + ':' + dk;
  function cmpLoad(dk) { try { return JSON.parse(localStorage.getItem(cmpKey(dk)) || 'null') || { v: 1, ck: {}, t: {} }; } catch (e) { return { v: 1, ck: {}, t: {} }; } }
  function cmpSave(dk, S) { S.at = Date.now(); try { localStorage.setItem(cmpKey(dk), JSON.stringify(S)); } catch (e) { } }

  // Category from the ticket title: "(chatbot) Quality - damaged - pickup + refund - Order #…" → Quality › damaged, action "pickup + refund".
  const CMP_ACTION = /refund|wallet|pick ?up|replace|compens|redeliver|voucher|credit|cash|resend|re-?deliver/i;
  function cmpParse(subject, type) {
    let s = String(subject || '').replace(/\(chatbot\)/i, '').replace(/reported by .*$/i, '').trim();
    const br = /\[([^\]]+)\]/.exec(s);
    if (type !== 'Complaints' && br) return { cat: br[1].trim(), sub: '', act: '' };
    s = s.replace(/-?\s*(Order\s*)?#\s*\d{2,4}-\d{6,9}.*$/i, '').replace(/#\d{2,4}-\d{6,9}/g, '').trim();
    const parts = s.split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
    const cat = (parts.shift() || 'Other').replace(/\s*B#\d+\s*$/i, '').trim() || 'Other';
    const act = parts.filter((x) => CMP_ACTION.test(x));
    const sub = parts.filter((x) => !CMP_ACTION.test(x));
    return { cat: cat.slice(0, 40), sub: sub.join(' · ').slice(0, 40), act: act.join(' · ').slice(0, 40) };
  }
  // Keep only work fields. Never keep requester, name, email, phone, description or attachments.
  function cmpPick(t) {
    const cf = t.custom_fields || {};
    const num = (v) => (parseFloat(v) || 0);
    const bu = Object.keys(cf).filter((k) => k.indexOf('cf_business_unit') === 0).map((k) => cf[k]).filter(Boolean)[0] || '';
    const p = cmpParse(t.subject, t.type);
    return {
      id: t.id, ty: String(t.type || ''), st: t.status, c: Date.parse(t.created_at) || null, src: t.source,
      cat: p.cat, sub: p.sub, act: p.act, bu: String(bu).slice(0, 30),
      cx: String(cf.cf_cx_action_taken || '').slice(0, 40), ia: String(cf.cf_action_taken || '').split('\n')[0].slice(0, 40),
      egp: num(cf.cf_refund_amount) + num(cf.cf_compensation_amount),
      tg: (t.tags || []).map(String).filter((x) => /^[\w\- ]{1,40}$/.test(x)).slice(0, 12),
      items: Array.isArray(cf.cf_products_ids) ? cf.cf_products_ids.length : 0,
    };
  }
  const isComplaint = (t) => t.ty === 'Complaints';
  const CMP_STATUS = { 2: 'Open', 3: 'Pending', 4: 'Resolved', 5: 'Closed' };

  /* ---------- the on-demand check ---------- */
  const cmpOrders = (A) => A.rows.filter((r) => !r.wasSub && r.id != null && (r.delivered || r.status === 'not-received'));
  const CMP_AGAIN_H = 48;   // complaints keep arriving for about two days after delivery
  function cmpQueue(A, S, all) {
    const now = Date.now();
    return cmpOrders(A).filter((r) => {
      if (all) return true;
      const t = S.ck[r.id];
      if (!t) return true;
      const ref = r.completed || r.deadline || 0;
      return t - ref < CMP_AGAIN_H * 3600000 && now - t > 3600000;   // last look was early, and not in the last hour
    });
  }
  async function cmpLookup(id) {
    const ep = encodeURIComponent('search/tickets/?query="cf_order_id:' + id + '"');
    // A plain GET with the browser's own login, exactly as the Control Room asks when you open an order's details.
    const r = await origFetch(CMP_URL + ep, { method: 'GET', credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) throw new Error('Not authorised');
    if (r.status === 429) throw new Error('429');
    if (!r.ok) throw new Error('Request failed (' + r.status + ')');
    let j = null;
    try { j = await r.json(); } catch (e) { throw new Error('Not authorised'); }   // a login page instead of JSON
    NET.www = { ok: Date.now(), err: null };
    if (!j || !Array.isArray(j.results)) throw new Error('Unexpected answer from the ticket lookup');
    return j.results.map(cmpPick);   // the raw answer (with customer details) is dropped here
  }
  async function cmpRun(A, dk, all) {
    if (CMP.busy) return;
    const S = cmpLoad(dk);
    const q = cmpQueue(A, S, all);
    Object.assign(CMP, { busy: true, stop: false, dk, done: 0, total: q.length, failed: 0, msg: '' });
    if (UI.tab === 'complaints') UI.render(); else cmpPaint();
    let i = 0, streak = 0, sinceSave = 0, lastErr = '';
    const worker = async () => {
      while (i < q.length && !CMP.stop) {
        const r = q[i++];
        let ok = false;
        for (let a = 0; a < 2 && !ok && !CMP.stop; a++) {
          try {
            const T = await cmpLookup(r.id);
            if (T.length) S.t[r.id] = T; else delete S.t[r.id];
            S.ck[r.id] = Date.now(); ok = true; streak = 0;
          } catch (e) {
            const m = String(e && e.message); lastErr = m;
            if (/Not authorised/.test(m)) { CMP.stop = true; CMP.msg = 'The ticket lookup says you are not logged in. Refresh the Control Room page, then try again.'; break; }
            if (/429/.test(m) && a === 0) { CMP.msg = 'Asked too fast, waiting 20 s…'; cmpPaint(); await cmpSleep(20000); CMP.msg = ''; continue; }
            if (a === 1 || !/429/.test(m)) break;
          }
        }
        if (!ok && !CMP.stop) { CMP.failed++; if (++streak >= 10) { CMP.stop = true; CMP.msg = '10 lookups in a row failed. Stopped; try again later.'; } }
        CMP.done++;
        if (++sinceSave >= 25) { cmpSave(dk, S); sinceSave = 0; }
        cmpPaint();
        await cmpSleep(CFG.CMP_GAP_MS);
      }
    };
    try { await Promise.all([worker(), worker(), worker()]); } finally {
      S.run = { at: Date.now(), asked: CMP.total, done: CMP.done, failed: CMP.failed, err: CMP.failed ? lastErr.slice(0, 120) : '' };
      cmpSave(dk, S);
      if (CMP.stop && !CMP.msg) CMP.msg = 'Stopped. ' + CMP.done + ' of ' + CMP.total + ' orders checked; press Check complaints to carry on.';
      CMP.busy = false;
      if (UI.tab === 'complaints' && UI.meta && UI.meta.date === dk) UI.render(); else cmpPaint();
    }
  }
  function cmpPaint() {
    const el = UI.root && UI.root.querySelector('main [data-cmpprog]');
    if (!el) return;
    const pctDone = CMP.total ? Math.round((100 * CMP.done) / CMP.total) : 0;
    el.innerHTML = CMP.busy ? '<div class="cmpbar"><i style="width:' + pctDone + '%"></i></div>Checking order ' + CMP.done + ' of ' + CMP.total + (CMP.failed ? ' · ' + CMP.failed + ' failed' : '') + (CMP.msg ? ' · ' + esc(CMP.msg) : '') : esc(CMP.msg || '');
  }

  /* ---------- Complaints page: every complained order, opened up for checking ---------- */
  const STORE_CMPVAL = 'fpx:cmpval:v1:';
  const cmpValKey = (dk) => STORE_CMPVAL + (((UI.meta && UI.meta.fps) || []).join(',') || 'fp') + ':' + dk;
  function cmpValLoad(dk) { try { return JSON.parse(localStorage.getItem(cmpValKey(dk)) || '{}') || {}; } catch (e) { return {}; } }
  function cmpValSave(dk, V) { try { localStorage.setItem(cmpValKey(dk), JSON.stringify(V)); } catch (e) { } }
  const CMP_VAL = [['ok', 'Confirmed', 'bad', 'The complaint is real and on the FP'], ['no', 'Rejected', 'good', 'Not valid, or not the FP\'s doing'], ['later', 'Check later', 'warn', 'Still checking']];
  const CMPV = { show: null, cat: 'all', sort: 'time', open: new Set() };
  const cmpCatOf = (T) => { const t = T.find(isComplaint) || T[0]; return t ? t.cat + (t.sub ? ' › ' + t.sub : '') : ''; };

  function cmpItems(A, S) {
    const byId = new Map(A.rows.map((r) => [String(r.id), r]));
    const items = [];
    Object.keys(S.t).forEach((id) => {
      const T = S.t[id] || [];
      if (!T.some(isComplaint)) return;
      const r = byId.get(String(id)) || null;
      const c = T.filter(isComplaint);
      items.push({ id: String(id), r, T, kind: 'cmp', cat: cmpCatOf(T), c, at: Math.min.apply(null, c.map((t) => t.c || Infinity)), egp: c.reduce((a, t) => a + (t.egp || 0), 0) });
    });
    const have = new Set(items.map((x) => x.id));
    A.rows.filter((r) => !r.wasSub && r.fpIssues && r.fpIssues.length && !have.has(String(r.id))).forEach((r) => {
      const T = S.t[r.id] || [];
      items.push({ id: String(r.id), r, T, kind: 'fp', cat: r.fpIssues[0].r, c: [], at: null, egp: 0 });
      have.add(String(r.id));
    });
    Object.keys(S.t).forEach((id) => {
      if (have.has(String(id)) || !(S.t[id] || []).length) return;
      const T = S.t[id];
      items.push({ id: String(id), r: byId.get(String(id)) || null, T, kind: 'other', cat: (T[0].ty || 'No type') + ' · ' + T[0].cat, c: [], at: Math.min.apply(null, T.map((t) => t.c || Infinity)), egp: 0 });
    });
    return items;
  }
  const plN = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  // every ticket number on the order: Freshdesk tickets found by the check, plus the ones the FP raised from the Control Room
  const cmpTicketIds = (x) => {
    const own = (x.kind === 'cmp' ? x.c : x.T).map((t) => t.id);
    const fp = x.r && x.r.fpIssues ? x.r.fpIssues.map((f) => f.t).filter(Boolean) : [];
    return Array.from(new Set(own.concat(x.kind === 'cmp' ? [] : fp).map(String)));
  };
  const tm = (ms) => (ms == null ? '–' : fmtTime(ms));
  const mn = (v) => (v == null ? '–' : fmt(v, 0) + ' min');
  const kv = (rows) => '<dl class="kv">' + rows.filter((x) => x && x[1] != null && x[1] !== '').map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>';
  function cmpDelivery(r) {
    if (!r) return '<span class="muted">not in this day\'s orders</span>';
    if (r.status === 'not-received') return '<b style="color:var(--bad)">Not received</b>';
    if (!r.delivered) return esc(r.status || '');
    if (r.late) return '<b style="color:var(--bad)">Late ' + fmt(r.lateMin, 0) + ' min</b>';
    if (r.scheduled) return 'Scheduled' + (r.plannedAhead ? '' : ' (forced)');
    return 'On time · ' + fmt(r.deliveryMin, 0) + ' min';
  }
  function cmpDetail(x, A, V, dk) {
    const r = x.r || {};
    const raw = UI.raw && UI.raw.orders ? UI.raw.orders.find((o) => String(o.id) === x.id) : null;
    const items = raw && Array.isArray(raw.products) ? raw.products.map((p) => p.nameEn || p.nameAr || '').filter(Boolean) : [];
    const subs = r.orderNumber ? A.rows.filter((s) => s.wasSub && s.parentOrderNumber === r.orderNumber) : [];
    const life = kv([
      ['Placed', tm(r.placed)], ['ETA', tm(r.deadline)], ['Picker started', tm(r.start)], ['Packed', tm(r.packed)], ['DA picked up', tm(r.pickedUp)], ['Delivered', tm(r.completed)],
      ['Wait for picker', mn(r.waitMin)], ['Picking', mn(r.handleMin) + (r.minPerSku != null ? ' <span class="muted">(' + fmt(r.minPerSku * 60, 0) + ' s/SKU)</span>' : '')],
      ['Awaiting pickup', mn(r.shelfMin)], ['Ride', mn(r.legMin)], ['Placed → delivered', mn(r.deliveryMin)], ['Result', cmpDelivery(x.r)],
    ]);
    const ord = kv([
      ['Order', esc(r.orderNumber || x.id) + ' <button class="ghost sm" data-cmpcopy="' + esc(r.orderNumber || x.id) + '">Copy</button>'],
      ['Type', esc(r.model || '') + (r.scheduled ? (r.plannedAhead ? ' · planned ahead' : ' · forced') : '')], ['Timeslot', r.slot != null ? esc(slotLabel(r.slot)) : '–'],
      ['Picker', r.pickerName ? esc(r.pickerName) + ' <span class="muted">' + esc(r.pickerHr || '') + '</span>' : '–'],
      ['DA', r.daName ? esc(r.daName) + ' <span class="muted">' + esc(r.daHr || '') + '</span>' : '–'],
      ['Trip', r.tripSize > 1 ? 'drop ' + r.dropNo + ' of ' + r.tripSize : r.tripId ? 'single drop' : '–'],
      ['Sub-area', esc(r.subArea || '–') + (r.distKm != null ? ' · ' + fmt(r.distKm, 1) + ' km' : '')],
      ['Basket', (r.skus != null ? plN(r.skus, 'SKU') : '–') + (r.bags != null ? ' · ' + plN(r.bags, 'bag') : '')], ['Tags', tagChips(r) || '–'],
    ]);
    const tk = x.T.slice().sort((a, b) => (a.c || 0) - (b.c || 0)).map((t) => '<div class="tk"><b>' + esc(t.cat) + (t.sub ? ' › ' + esc(t.sub) : '') + '</b> <span class="muted">' + esc(t.ty || 'No type') + '</span>' +
      kv([['Opened', t.c ? tm(t.c) + (new Date(t.c).toDateString() !== new Date(dayStartOf(dk)).toDateString() ? ' ' + new Date(t.c).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '') : null],
        ['Status', esc(CMP_STATUS[t.st] || String(t.st || ''))], ['Action', esc(t.act || t.ia || '')], ['CX action', esc(t.cx)], ['Refund', t.egp ? fmt(t.egp, 0) + ' EGP' : null],
        ['Items in ticket', t.items || null], ['Business unit', esc(t.bu)], ['Ticket', t.id]]) + '</div>').join('');
    const fp = r.fpIssues && r.fpIssues.length ? '<div class="tk"><b>Reported by the FP</b>' + kv(r.fpIssues.map((f) => [esc(f.r), esc(f.c || '–') + (f.t ? ' <span class="muted">· ticket ' + esc(String(f.t)) + '</span>' : '')])) + '</div>' : '';
    const so = subs.length ? '<div class="tk"><b>Sub-orders created</b>' + kv(subs.map((s) => [esc((s.subType || 'sub-order').replace(/^./, (c) => c.toUpperCase())), esc(s.status) + (s.completed ? ' · ' + tm(s.completed) : '')])) + '</div>' : '';
    const v = V[x.id] || {};
    const val = '<div class="cmpval">' + CMP_VAL.map(([k, l, , tip]) => '<button class="ghost sm' + (v.v === k ? ' on' : '') + '" data-cmpv="' + k + '" data-oid="' + x.id + '" title="' + tip + '">' + l + '</button>').join('') +
      '<input data-cmpnote="' + x.id + '" placeholder="Note (what you found)" value="' + esc(v.n || '') + '" maxlength="200"></div>';
    return '<div class="cmpd"><div><h4>Timeline</h4>' + life + '</div><div><h4>Order</h4>' + ord +
      (items.length ? '<details class="more"><summary>' + plN(items.length, 'item') + ' ›</summary><div class="mini">' + items.map(esc).join(' · ') + '</div></details>' : '') + '</div>' +
      '<div><h4>' + (x.T.length ? 'Tickets' : 'Issues') + '</h4>' + (tk || '<span class="muted">No tickets found on this order' + (x.kind === 'fp' ? ' (or complaints not checked yet)' : '') + '.</span>') + fp + so + '</div></div>' + val;
  }

  BRAIN_VIEWS.complaints = function (A) {
    const dk = UI.meta.date, S = cmpLoad(dk), V = cmpValLoad(dk);
    const orders = cmpOrders(A);
    const checked = orders.filter((r) => S.ck[r.id]).length;
    const q = cmpQueue(A, S, false).length;
    const mins = Math.max(1, Math.round((q * 0.7) / 3 / 60));
    const lastAt = S.at ? fmtTime(S.at) + (new Date(S.at).toDateString() !== new Date().toDateString() ? ' on ' + new Date(S.at).toLocaleDateString() : '') : null;
    const runBtn = CMP.busy ? '<button class="btn" data-cmpstop>Stop</button>' :
      '<button class="btn' + (checked ? '' : ' primary') + '" data-cmprun' + (q ? '' : ' disabled') + '>' + (q ? 'Check complaints · ' + q + ' orders, about ' + mins + ' min' : 'All orders checked') + '</button>' +
      (checked ? ' <button class="ghost sm" data-cmpall>Check all ' + orders.length + ' again</button>' : '');
    let h = '<div class="mapbar" style="gap:10px;flex-wrap:wrap;align-items:center">' + runBtn +
      '<span class="mini">' + (checked ? checked + ' of ' + orders.length + ' delivered orders checked' + (lastAt ? ', last at ' + lastAt : '') + '. ' : '') +
      'One lookup per order, only when you press the button. Complaints keep arriving for about 2 days after delivery, so check again later.</span></div>' +
      '<div class="mini" data-cmpprog style="margin:-6px 0 12px"></div>';

    const main = A.rows.filter((r) => !r.wasSub && r.status !== 'cancelled');
    const del = main.filter((r) => r.delivered);
    const items = cmpItems(A, S);
    const cmpI = items.filter((x) => x.kind === 'cmp');
    if (!checked && !CMP.busy) h += '<div class="card cmpempty"><h2>Complaints not checked yet for this day</h2><p class="sub">Press <b>Check complaints</b> to find every customer complaint on this day\'s ' + orders.length + ' delivered orders (about ' + mins + ' min). Until then, this page shows only what your team reported from the Control Room.</p>' + runBtn + '</div>';
    else {
      const n = cmpI.length, tgt = CFG.COMPLAINT_TARGET_PCT, pAll = rate(n, main.length), pDel = rate(n, del.length);
      const tickets = cmpI.reduce((a, x) => a + x.c.length, 0), egp = cmpI.reduce((a, x) => a + x.egp, 0);
      const lateN = del.filter((r) => r.late).length, onN = del.filter((r) => r.late === false).length;
      const cLate = cmpI.filter((x) => x.r && x.r.late).length, cOn = cmpI.filter((x) => x.r && x.r.late === false).length;
      const nv = cmpI.filter((x) => V[x.id] && V[x.id].v).length, ok = cmpI.filter((x) => V[x.id] && V[x.id].v === 'ok').length, no = cmpI.filter((x) => V[x.id] && V[x.id].v === 'no').length;
      const partial = checked < orders.length;
      h += '<div class="kpis">' +
        kpi('Complaint % of all orders', fmt(pAll, 2), '%', n + ' of ' + main.length + ' orders' + (tgt ? ' · target ' + tgt + '%' : '') + (partial ? ' · ' + (orders.length - checked) + ' not checked yet' : ''), tgt && pAll != null ? (pAll <= tgt ? 'good' : pAll <= tgt * 1.3 ? 'warn' : 'bad') : null) +
        kpi('Of delivered orders', fmt(pDel, 2), '%', n + ' of ' + del.length + ' delivered', null) +
        kpi('Complaints', n, '', tickets === n ? 'orders with a complaint' : tickets + ' tickets on ' + n + ' orders', null) +
        kpi('Refunds', fmt(egp, 0), 'EGP', 'refund + compensation', null) +
        kpi('Late vs on time', lateN ? fmt(rate(cLate, lateN), 1) + '% · ' + fmt(rate(cOn, onN), 1) + '%' : '–', '', 'complaint rate on late NOW orders vs on-time ones', null) +
        kpi('Checked by you', nv + ' / ' + n, '', ok + ' confirmed · ' + no + ' rejected', n && nv === n ? 'good' : null) + '</div>';
    }
    if (checked) {
      // what the check found: every ticket type, so nothing is hidden by the "Complaints" filter
      const byType = new Map();
      Object.keys(S.t).forEach((id) => (S.t[id] || []).forEach((t) => { const k = t.ty || 'No type'; const g = byType.get(k) || { k, n: 0, o: new Set() }; g.n++; g.o.add(id); byType.set(k, g); }));
      const withT = Object.keys(S.t).filter((id) => (S.t[id] || []).length).length;
      const R = S.run;
      h += '<details class="card more cmpdiag"' + (cmpI.length ? '' : ' open') + '><summary><b>What the check found</b> · ' + withT + ' of ' + checked + ' checked orders have a ticket' + (R && R.failed ? ' · <span style="color:var(--bad)">' + R.failed + ' lookups failed</span>' : '') + ' ›</summary>' +
        '<p class="sub">Every ticket the Control Room\'s ticket lookup returned, by type. Only type <b>Complaints</b> counts in Complaint %. ' +
        (R ? 'Last run ' + fmtTime(R.at) + ': ' + R.done + ' of ' + R.asked + ' orders asked' + (R.failed ? ', ' + R.failed + ' failed (' + esc(R.err || 'no answer') + '); failed orders are asked again next time' : '') + '.' : '') + '</p>' +
        (byType.size ? table([['Ticket type', (x) => x.k, (x) => esc(x.k), 'l'], ['Tickets', (x) => x.n], ['Orders', (x) => x.o.size], ['In Complaint %', (x) => (x.k === 'Complaints' ? 1 : 0), (x) => (x.k === 'Complaints' ? 'Yes' : 'No')]], Array.from(byType.values()).sort((a, b) => b.n - a.n)) : '<div class="status">The lookup returned no tickets at all for these orders.</div>') + '</details>';
    }

    // the list: filters, then one row per order, click to open
    const fpN = items.filter((x) => x.kind === 'fp').length, otN = items.filter((x) => x.kind === 'other').length;
    const show = CMPV.show || (cmpI.length || !fpN ? 'cmp' : 'fp');   // until you pick a view: complaints, or the FP's reports when there are none yet
    const shown0 = items.filter((x) => show === 'all' || x.kind === show);
    const cats = countBy(shown0, (x) => x.cat);
    if (CMPV.cat !== 'all' && !cats.some(([k]) => k === CMPV.cat)) CMPV.cat = 'all';
    const shown = shown0.filter((x) => CMPV.cat === 'all' || x.cat === CMPV.cat);
    const SORTS = { time: (a, b) => (b.at || b.r && b.r.completed || 0) - (a.at || a.r && a.r.completed || 0), cat: (a, b) => a.cat.localeCompare(b.cat), picker: (a, b) => String(a.r && a.r.pickerName || '~').localeCompare(String(b.r && b.r.pickerName || '~')), da: (a, b) => String(a.r && a.r.daName || '~').localeCompare(String(b.r && b.r.daName || '~')), todo: (a, b) => (V[a.id] && V[a.id].v ? 1 : 0) - (V[b.id] && V[b.id].v ? 1 : 0) };
    shown.sort(SORTS[CMPV.sort] || SORTS.time);
    if (items.length) {
      const seg = (attr, cur, opts) => '<div class="seg" ' + attr + '>' + opts.map(([k, l]) => '<button data-v="' + esc(k) + '" class="' + (cur === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
      h += '<div class="card"><h2>Every order</h2><p class="sub">Click an order to open it: timeline, picker and DA, basket, tags, every ticket, what your team reported, sub-orders, and your own verdict.</p>' +
        '<div class="mapbar" style="gap:10px;flex-wrap:wrap">' + seg('data-cmpshow', show, [['cmp', 'Customer complaints (' + cmpI.length + ')'], ['fp', 'Reported by the FP only (' + fpN + ')'], ['other', 'Other tickets (' + otN + ')'], ['all', 'All']]) +
        seg('data-cmpsort', CMPV.sort, [['time', 'Newest'], ['cat', 'Category'], ['picker', 'Picker'], ['da', 'DA'], ['todo', 'Not checked first']]) + '</div>' +
        '<div class="catchips">' + [['all', 'All', shown0.length]].concat(cats.map(([k, c]) => [k, k, c])).map(([k, l, c]) => '<button class="ghost sm' + (CMPV.cat === k ? ' on' : '') + '" data-cmpcat="' + esc(k) + '">' + esc(l) + ' <span class="muted">' + c + '</span></button>').join('') + '</div>' +
        '<div class="cmpl"><div class="cmph"><span>Order</span><span>Opened</span><span>Complaint / issue</span><span>Delivery</span><span>Picker</span><span>DA</span><span>Ticket</span><span>Basket</span><span>Tags</span><span>Your check</span><span>EGP</span></div>' +
        (shown.length ? shown.map((x) => {
          const r = x.r || {}, v = V[x.id] && CMP_VAL.find((c) => c[0] === V[x.id].v);
          const t0 = x.c[0] || x.T[0];
          return '<details class="cmpo" data-oid="' + x.id + '"' + (CMPV.open.has(x.id) ? ' open' : '') + '><summary>' +
            '<span><b>' + esc(r.orderNumber || x.id) + '</b></span>' +
            '<span>' + (x.at && isFinite(x.at) ? tm(x.at) : '<span class="muted">–</span>') + '</span>' +
            '<span><b>' + esc(x.cat) + '</b>' + (t0 && t0.act ? '<br><span class="muted">' + esc(t0.act) + '</span>' : x.kind === 'fp' && r.fpIssues[0].c ? '<br><span class="muted">' + esc(r.fpIssues[0].c) + '</span>' : '') + (x.kind === 'cmp' && r.fpIssues && r.fpIssues.length ? '<br><span class="tagchip">FP reported: ' + esc(r.fpIssues[0].r) + '</span>' : '') + '</span>' +
            '<span>' + cmpDelivery(x.r) + '</span>' +
            '<span>' + esc(r.pickerName || '–') + '</span><span>' + esc(r.daName || '–') + (r.tripSize > 1 ? '<br><span class="muted">drop ' + r.dropNo + ' of ' + r.tripSize + '</span>' : '') + '</span>' +
            '<span>' + (cmpTicketIds(x).map((id) => '<button class="tkno" data-cmpcopy="' + esc(id) + '" title="Copy the ticket number">#' + esc(id) + '</button>').join('') || '<span class="muted">–</span>') + '</span>' +
            '<span>' + (r.skus != null ? plN(r.skus, 'SKU') : '–') + (r.bags != null ? '<br><span class="muted">' + plN(r.bags, 'bag') + '</span>' : '') + '</span>' +
            '<span>' + (tagChips(r) || '<span class="muted">–</span>') + '</span>' +
            '<span>' + (v ? '<span class="pill ' + v[2] + '">' + v[1] + '</span>' : '<span class="muted">Not checked</span>') + '</span>' +
            '<span>' + (x.egp ? fmt(x.egp, 0) : '') + '</span></summary>' + (CMPV.open.has(x.id) ? cmpDetail(x, A, V, dk) : '<div class="cmpd-slot"></div>') + '</details>';
        }).join('') : '<div class="status">Nothing in this view.</div>') + '</div></div>';
    }

    if (cmpI.length) {
      // by category, and the people on complained orders
      const g = new Map();
      cmpI.forEach((x) => {
        const c = g.get(x.cat) || { k: x.cat, n: 0, egp: 0, late: 0, multi: 0, tags: {} };
        c.n++; c.egp += x.egp;
        if (x.r) { if (x.r.late) c.late++; if (x.r.tripSize > 1) c.multi++; (x.r.tags || []).filter(tagShown).forEach((t) => { c.tags[t] = (c.tags[t] || 0) + 1; }); }
        g.set(x.cat, c);
      });
      const catRows = Array.from(g.values()).sort((a, b) => b.n - a.n).map((c) => { const top = Object.entries(c.tags).sort((a, b) => b[1] - a[1])[0]; return Object.assign(c, { share: rate(c.n, cmpI.length), top: top ? tagLabel(top[0]) + ' ' + top[1] + '/' + c.n : '' }); });
      h += card('By category', 'What the complained orders had in common.', table([
        ['Category', (x) => x.k, (x) => esc(x.k), 'l'], ['Complaints', (x) => x.n], ['Share', (x) => x.share, (x) => fmtPct(x.share)],
        ['Delivered late', (x) => x.late], ['Multi-order trip', (x) => x.multi], ['Most common tag', (x) => x.top, (x) => esc(x.top), 'l'], ['EGP', (x) => x.egp, (x) => fmt(x.egp, 0)],
      ], catRows));
      const people = (key, hr, name) => {
        const m = new Map();
        cmpI.filter((x) => x.r && x.r[key]).forEach((x) => { const id = x.r[key]; const p = m.get(id) || { name: x.r[name] || '', hr: x.r[hr] || '', n: 0, cats: {}, ok: 0 }; p.n++; p.cats[x.cat] = (p.cats[x.cat] || 0) + 1; if (V[x.id] && V[x.id].v === 'ok') p.ok++; m.set(id, p); });
        return Array.from(m.values()).sort((a, b) => b.n - a.n).map((p) => Object.assign(p, { what: Object.entries(p.cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + (v > 1 ? ' ×' + v : '')).join(', ') }));
      };
      const pcols = [['Name', (x) => x.name, null, 'l'], ['HR ID', (x) => x.hr, null, 'l'], ['Complaints', (x) => x.n], ['Confirmed', (x) => x.ok], ['What', (x) => x.what, (x) => esc(x.what), 'l']];
      h += '<div class="grid two">' + card('Pickers on complained orders', 'Who picked the order. Not a verdict until you confirm it: a missing item can be a stock problem.', table(pcols, people('pickerId', 'pickerHr', 'pickerName'))) +
        card('DAs on complained orders', 'Who delivered the order.', table(pcols, people('daId', 'daHr', 'daName'))) + '</div>';
      if (S.del !== del.length) { S.del = del.length; S.all = main.length; try { localStorage.setItem(cmpKey(dk), JSON.stringify(S)); } catch (e) { } }
    }
    const subs = A.rows.filter((r) => r.wasSub && r.subType);
    if (subs.length) h += card('Sub-orders in this day\'s list', 'Follow-ups the Control Room created: pickups and replacements usually follow a complaint, redeliveries follow a failed drop.', table([
      ['Type', (x) => x.k, (x) => esc(x.k), 'l'], ['Sub-orders', (x) => x.n],
    ], countBy(subs, (r) => r.subType.charAt(0).toUpperCase() + r.subType.slice(1)).map(([k, n]) => ({ k, n }))));
    return h;
  };
  BIND.complaints = function (main) {
    const dk = UI.meta && UI.meta.date;
    const run = (all) => { if (UI.data && UI.meta) cmpRun(UI.data, UI.meta.date, all); };
    main.querySelectorAll('[data-cmprun]').forEach((a) => a.addEventListener('click', () => run(false)));
    const b = main.querySelector('[data-cmpall]'); if (b) b.addEventListener('click', () => run(true));
    const c = main.querySelector('[data-cmpstop]'); if (c) c.addEventListener('click', () => { CMP.stop = true; c.disabled = true; c.textContent = 'Stopping…'; });
    main.querySelectorAll('.seg[data-cmpshow] button').forEach((x) => x.addEventListener('click', () => { CMPV.show = x.dataset.v; CMPV.cat = 'all'; UI.render(); }));
    main.querySelectorAll('.seg[data-cmpsort] button').forEach((x) => x.addEventListener('click', () => { CMPV.sort = x.dataset.v; UI.render(); }));
    main.querySelectorAll('[data-cmpcat]').forEach((x) => x.addEventListener('click', () => { CMPV.cat = x.dataset.cmpcat; UI.render(); }));
    main.querySelectorAll('details.cmpo').forEach((d) => d.addEventListener('toggle', () => {
      const id = d.dataset.oid;
      if (d.open) {
        CMPV.open.add(id);
        const slot = d.querySelector('.cmpd-slot');
        if (slot && UI.data) {
          const x = cmpItems(UI.data, cmpLoad(dk)).find((y) => y.id === id);
          if (x) { slot.outerHTML = cmpDetail(x, UI.data, cmpValLoad(dk), dk); bindDetail(d); }
        }
      } else CMPV.open.delete(id);
    }));
    const bindDetail = (scope) => {
      scope.querySelectorAll('[data-cmpv]').forEach((x) => x.addEventListener('click', (e) => {
        e.preventDefault();
        const V = cmpValLoad(dk), id = x.dataset.oid, cur = V[id] || {};
        V[id] = Object.assign({}, cur, { v: cur.v === x.dataset.cmpv ? null : x.dataset.cmpv, at: Date.now() });
        cmpValSave(dk, V); UI.render();
      }));
      scope.querySelectorAll('[data-cmpnote]').forEach((x) => x.addEventListener('change', () => {
        const V = cmpValLoad(dk), id = x.dataset.cmpnote; V[id] = Object.assign({}, V[id] || {}, { n: x.value.slice(0, 200), at: Date.now() }); cmpValSave(dk, V);
      }));
      scope.querySelectorAll('.cmpd [data-cmpcopy]').forEach((x) => x.addEventListener('click', (e) => {
        e.preventDefault();
        try { navigator.clipboard.writeText(x.dataset.cmpcopy).then(() => { x.textContent = 'Copied'; }, () => { }); } catch (err) { }
      }));
    };
    main.querySelectorAll('details.cmpo[open]').forEach(bindDetail);
    main.querySelectorAll('summary .tkno').forEach((x) => x.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { navigator.clipboard.writeText(x.dataset.cmpcopy).then(() => { const t = x.textContent; x.textContent = 'Copied'; setTimeout(() => { x.textContent = t; }, 1200); }, () => { }); } catch (err) { }
    }));
    if (CMP.busy) cmpPaint();
  };

  /* ---------- Order tags page ---------- */
  BRAIN_VIEWS.tags = function (A) {
    const main = A.rows.filter((r) => !r.subOrder && r.status !== 'cancelled');
    const del = main.filter((r) => r.delivered);
    const S = cmpLoad(UI.meta.date), checked = Object.keys(S.ck).length;
    const compIds = new Set(Object.keys(S.t).filter((id) => (S.t[id] || []).some(isComplaint)));
    const stat = (label, g, key) => {
      const d = g.filter((r) => r.delivered), now = d.filter((r) => !r.scheduled), judged = d.filter((r) => r.late != null);
      const ck = d.filter((r) => S.ck[r.id]);
      return {
        label, key, orders: g.length, share: rate(g.length, main.length), small: d.length < CFG.TAG_MIN_ORDERS,
        eta: judged.length ? rate(judged.filter((r) => r.late).length, judged.length) : null,
        p90: pct(now.map((r) => r.deliveryMin), 0.9),
        skus: avg(g.map((r) => r.skus).filter((x) => x != null)),
        wait: median(d.map((r) => r.shelfMin)), ride: median(d.map((r) => r.legMin)),
        cmp: checked && ck.length ? rate(ck.filter((r) => compIds.has(String(r.id))).length, ck.length) : null,
      };
    };
    const rows = [stat('All orders', main, '')].concat(TAG_DEFS.filter(([k]) => tagShown(k)).map(([k, l]) => stat(l, main.filter((r) => (r.tags || []).includes(k)), k)).filter((x) => x.orders));
    const base = rows[0];
    // under TAG_MIN_ORDERS delivered orders a percentage swings on one or two orders: shown greyed, no colour
    const few = (x, html) => (x.small ? '<span class="muted" title="Only a few delivered orders with this tag: read with care">' + String(html).replace(/<[^>]+>/g, '') + '</span>' : html);
    const cols = [
      ['Tag', (x) => (x.key ? x.label : ''), (x) => (x.key ? '<span class="tagchip">' + esc(x.label) + '</span>' : '<b>All orders</b>'), 'l'],
      ['Orders', (x) => x.orders], ['Share', (x) => x.share, (x) => fmtPct(x.share)],
      ['ETA late %', (x) => x.eta, (x) => few(x, latePill(x.eta))], ['P90 NOW', (x) => x.p90, (x) => few(x, p90Pill(x.p90))],
      ['Avg SKUs', (x) => x.skus, (x) => fmt(x.skus, 1)], ['Awaiting pickup (median)', (x) => x.wait, (x) => fmt(x.wait, 1)], ['Ride (median)', (x) => x.ride, (x) => fmt(x.ride, 1)],
    ];
    let h = '<div class="kpis">' + rows.slice(1, 5).map((x) => kpi(x.label, x.orders, '', fmtPct(x.share) + ' of orders' + (x.eta != null && base.eta != null ? ' · ETA late ' + fmt(x.eta, 1) + '% vs ' + fmt(base.eta, 1) + '%' : ''), null)).join('') + '</div>';
    h += card('Every tag', 'The icons next to each order in the Control Room. An order can have several tags. Tags with under ' + CFG.TAG_MIN_ORDERS + ' delivered orders show grey: too few to judge. Compare each row with All orders: a tag with clearly worse ETA late % or P90 is worth a look.', table(cols, rows));
    // late NOW orders by tag
    const late = del.filter((r) => r.late);
    if (late.length) {
      const lt = TAG_DEFS.filter(([k]) => tagShown(k)).map(([k, l]) => ({ l, n: late.filter((r) => (r.tags || []).includes(k)).length, all: del.filter((r) => (r.tags || []).includes(k)).length })).filter((x) => x.n);
      if (lt.length) h += card('Late orders by tag', late.length + ' late NOW orders. "Expected" = how many would be late if this tag were late as often as every other order. Under 5 expected is too few to tell (grey).', table([
        ['Tag', (x) => x.l, (x) => '<span class="tagchip">' + esc(x.l) + '</span>', 'l'], ['Late', (x) => x.n],
        ['Expected', (x) => (x.all * late.length) / del.length, (x) => fmt((x.all * late.length) / del.length, 1)],
        ['Late ÷ expected', (x) => x.n / ((x.all * late.length) / del.length), (x) => { const e = (x.all * late.length) / del.length, v = x.n / e; if (e < 5) return '<span class="muted" title="Too few to tell">×' + fmt(v, 1) + '</span>'; return v >= 1.5 ? '<span class="pill bad">×' + fmt(v, 1) + '</span>' : v >= 1.2 ? '<span class="pill warn">×' + fmt(v, 1) + '</span>' : '×' + fmt(v, 1); }],
      ], lt.sort((a, b) => b.n - a.n)));
    }
    return h;
  };

  /* ------------------------------------------------------------------
   * NETWORK VERSION (v1.18, LITE): the simpler layout sent to every FP.
   *  - Timeslots = the day at a glance (tiles, two charts, one slot table, shifts); every old column under "Every column".
   *  - Live & capacity on one page.
   *  - Start here: first-run setup for a new FP.
   *  - Settings: check against Tableau (incl. the forced cutoff), peak hours, pages, back up / restore.
   *  - Long notes and card subtitles show their first sentence; the rest opens under "More".
   * The team editions set LITE = false, so none of this changes them.
   * ------------------------------------------------------------------ */

  // ---------- short text: first sentence, the rest under "More" ----------
  function splitFirst(html, minLen) {
    const plain = html.replace(/<[^>]*>/g, '');
    if (plain.length < minLen) return null;
    const re = /\.(?:<\/b>)?\s+(?=[A-Z<"(])/g;
    let m;
    while ((m = re.exec(html))) {
      const head = html.slice(0, m.index + m[0].length).trim();
      const rest = html.slice(m.index + m[0].length).trim();
      const hp = head.replace(/<[^>]*>/g, '');
      if (hp.length < 40) continue;
      const open = (t) => (head.match(new RegExp('<' + t + '[\\s>]', 'g')) || []).length, close = (t) => (head.match(new RegExp('</' + t + '>', 'g')) || []).length;
      if (['b', 'span', 'a', 'i', 'button'].some((t) => open(t) !== close(t))) continue;
      if (rest.replace(/<[^>]*>/g, '').trim().length < 25) return null;
      return [head, rest];
    }
    return null;
  }
  // A column that shows any amber/red pill also gets green pills on its good values, so good vs bad is easy to see.
  function greenPills(scope) {
    if (!LITE || !scope) return;
    scope.querySelectorAll('table').forEach((t) => {
      const rows = Array.from(t.rows), cols = new Set();
      rows.forEach((r) => Array.from(r.cells).forEach((c, i) => { if (c.querySelector('.pill.warn, .pill.bad')) cols.add(i); }));
      if (!cols.size) return;
      rows.forEach((r) => Array.from(r.cells).forEach((c, i) => {
        if (!cols.has(i)) return;
        c.querySelectorAll('.okv').forEach((el) => { el.className = 'pill good'; });
      }));
    });
  }
  function compactText(html) {
    html = html.replace(/<p class="sub">([\s\S]*?)<\/p>/g, (all, inner) => {
      if (/<p[\s>]|<div|<table|<details/.test(inner)) return all;
      const sp = splitFirst(inner, 150);
      return sp ? '<p class="sub">' + sp[0] + '</p><details class="more"><summary>More ›</summary><p class="sub">' + sp[1] + '</p></details>' : all;
    });
    html = html.replace(/<div class="note">([\s\S]*?)<\/div>/g, (all, inner) => {
      if (/<div|<table|<details|<ul|<ol/.test(inner)) return all;
      const sp = splitFirst(inner, 220);
      return sp ? '<div class="note">' + sp[0] + '<details class="more"><summary>More ›</summary>' + sp[1] + '</details></div>' : all;
    });
    return html;
  }

  // ---------- Timeslots: the day at a glance ----------
  const _daySlots = DAY_VIEWS.slots;
  BRAIN_VIEWS.slots = function (A, M) {
    if (!LITE) return _daySlots(A, M);
    const d = A.day, S = A.score;
    const subN = A.rows.filter((r) => r.wasSub).length;
    let h = '<div class="tiles">' +
      tile('Orders', d.orders.toLocaleString('en-US'), d.delivered + ' delivered · ' + d.cancelled + ' cancelled (left out)' + (subN && !CFG.INCLUDE_SUBORDERS ? ' · +' + subN + ' sub-orders' : '')) +
      tile('Scheduled', d.schedCount, S.extra.forced + ' forced (placed this day)') +
      tile('Coffee orders', d.coffee, lateLine(d.coffeeLate, d.coffeeDelivered)) + tile('Pharmacy orders', d.pharma, lateLine(d.pharmaLate, d.pharmaDelivered)) +
      tile('Average basket', fmt(d.avgSkus, 1) + '<span class="u">SKUs</span>', d.largeBaskets + ' with ' + CFG.LARGE_BASKET_SKUS + '+ SKUs') +
      tile('Awaiting pickup · ride', fmt(d.medShelf, 1) + ' · ' + fmt(d.medLeg, 1) + '<span class="u">min</span>', 'medians: packed → pickup · pickup → delivered') + '</div>';
    h += '<div class="grid two">' + card('Orders per timeslot', 'Scheduled orders count in the slot they were scheduled into.', slotVolumeChart(A)) + card('ETA late % per timeslot', 'NOW orders.', slotLateChart(A)) + '</div>';
    const top = (s) => { const x = S.hours.find((q) => q.h === s.slot); return x && x.reasons[0] ? x.reasons[0] : null; };
    const total = Object.assign({ label: 'Day total', shiftedIn: A.slots.reduce((t, x) => t + x.shiftedIn, 0) }, d);
    h += card('Every timeslot', 'ETA late % = NOW orders. Forced in = forced orders that went into this slot. Top cause = the root cause behind most of its late orders.', table([
      ['Timeslot', (r) => (r.slot == null ? 99 : r.slot), (r) => esc(r.label), 'l'],
      ['Orders', (r) => r.orders], ['NOW', (r) => r.nowCount], ['Scheduled', (r) => r.schedCount], ['Forced in', (r) => r.shiftedIn],
      ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)], ['Late', (r) => r.late],
      ['Top cause', (r) => { const t = r.slot == null ? null : top(r); return t ? t[0] : ''; }, (r) => { const t = r.slot == null ? null : top(r); return t ? '<span class="reason"><span class="st-dot" style="background:' + (REASON_COLORS[t[0]] || '#AC9C93') + '"></span>' + esc(t[0]) + ' <span class="muted">' + t[1] + '</span></span>' : ''; }, 'l'],
      ...P90_COLS, ['Avg SKUs', (r) => r.avgSkus, (r) => fmt(r.avgSkus, 1)],
    ], A.slots, { total }));
    h += card('By shift', 'Orders, lateness, P90 and baskets by the order\'s timeslot. Pickers and orders per picker by the hour packed. <b>PPH (Ops)</b> / <b>DPH (Ops)</b> = orders started in the shift\'s clock hours ÷ the active hours in them; <b>PPH</b> / <b>DPH</b> = the average of the shift\'s hours, as on the Scorecard. ' + settingsLink('Edit shifts'), table([
      ['Shift', (r) => r.name, (r) => '<b>' + esc(r.name) + '</b><br><span class="mini muted">' + esc(r.range) + '</span>', 'l'], ['Orders', (r) => r.orders], ['Delivered', (r) => r.delivered], ['Late', (r) => r.late], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)],
      ...P90_COLS,
      ['Coffee late %', (r) => rate(r.coffeeLate, r.coffeeDelivered), (r) => (r.coffee ? latePill(rate(r.coffeeLate, r.coffeeDelivered)) + ' <span class="muted">' + r.coffee + '</span>' : '–')],
      ['Pharmacy late %', (r) => rate(r.pharmaLate, r.pharmaDelivered), (r) => (r.pharma ? latePill(rate(r.pharmaLate, r.pharmaDelivered)) + ' <span class="muted">' + r.pharma + '</span>' : '–')],
      ['Avg SKUs', (r) => r.avgSkus, (r) => fmt(r.avgSkus, 1)], ['Avg bags', (r) => r.avgBags, (r) => fmt(r.avgBags, 1)], ['Large baskets', (r) => r.largeBaskets],
      ['Pickers', (r) => r.activePickers], ['Orders / picker', (r) => r.ordersPerPicker, (r) => fmt(r.ordersPerPicker, 1)],
      ['PPH (Ops)', (r) => shiftRate(A, r.name, 'ppho'), (r) => kpiPill('ppho', shiftRate(A, r.name, 'ppho'))], ['PPH', (r) => shiftRate(A, r.name, 'pph'), (r) => kpiPill('pph', shiftRate(A, r.name, 'pph'))],
      ['DAs', (r) => r.activeDAs], ['DPH (Ops)', (r) => shiftRate(A, r.name, 'dpho'), (r) => kpiPill('dpho', shiftRate(A, r.name, 'dpho'))], ['DPH', (r) => shiftRate(A, r.name, 'dph'), (r) => kpiPill('dph', shiftRate(A, r.name, 'dph'))],
      ['Med. awaiting pickup', (r) => r.medShelf, (r) => fmt(r.medShelf, 1)], ['Med. ride', (r) => r.medLeg, (r) => fmt(r.medLeg, 1)],
    ], A.shifts.filter((s) => s.orders)));
    h += '<details class="card"><summary><b>Every column</b> <span class="mini">· the full timeslot table with every column</span></summary>' + _daySlots(A, M) + '</details>';
    return h;
  };

  // ---------- Live & capacity ----------
  BRAIN_VIEWS.now = function (A, M) {
    const live = BRAIN_VIEWS.live(A, M).replace(/<button class="ghost sm go" data-goto="(capacity|now)">Open<\/button>/g, '');
    // alerts and queue first, then capacity, then the order and DA lists (folded: long) and the data sources
    const cut = ['<div class="card"><h2>Orders in the FP</h2>', '<div class="card"><h2>DAs right now</h2>', '<div class="card"><h2>Data sources</h2>'].map((t) => live.indexOf(t)).filter((i) => i >= 0);
    const at = cut.length ? Math.min.apply(null, cut) : live.length;
    let rest = live.slice(at);
    ['DAs right now', 'Data sources'].forEach((t) => { const i = rest.indexOf('<div class="card"><h2>' + t + '</h2>'); if (i < 0) return; const j = rest.indexOf('<div class="card"><h2>', i + 10), part = rest.slice(i, j < 0 ? rest.length : j); rest = rest.slice(0, i) + '<details class="card"><summary><b>' + t + '</b></summary>' + part.replace('<div class="card"><h2>' + t + '</h2>', '').replace(/<\/div>$/, '') + '</details>' + rest.slice(i + part.length); });
    return live.slice(0, at) + '<h2 class="pt" style="margin-top:26px">Capacity</h2>' + BRAIN_VIEWS.capacity(A, M) + '<h2 class="pt" style="margin-top:26px">Orders and DAs</h2>' + rest;
  };
  BIND.now = function (main) { if (BIND.live) BIND.live(main); if (BIND.capacity) BIND.capacity(main); };

  // ---------- Start here ----------
  const peaksTxt = () => (CFG.PEAKS || []).map(([a, b]) => a + '-' + b).join(', ');
  function parsePeaks(txt) {
    const out = [];
    String(txt || '').split(/[,;]/).forEach((p) => { const m = /^\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*$/.exec(p); if (m && +m[1] >= 0 && +m[1] <= 23 && +m[2] >= 1 && +m[2] <= 24 && +m[1] !== +m[2]) out.push([+m[1], +m[2]]); });
    return out;
  }
  function savePeaks(list) { CFG.PEAKS = list; PREFS.settings = PREFS.settings || {}; if (JSON.stringify(list) === JSON.stringify(CFG_DEFAULTS.PEAKS)) delete PREFS.settings.PEAKS; else PREFS.settings.PEAKS = list; savePrefs(); }
  BRAIN_VIEWS.setup = function () {
    const fp = fpIdFromCapture() || (UI.meta && UI.meta.fps && UI.meta.fps[0]);
    const dk = dateKeyOf(Date.now());
    const pkSet = Object.keys(ROSTER.load().pickers).filter((k) => ROSTER.hasShift(k)).length, pkAll = Object.keys(ROSTER.load().pickers).length;
    const daSet = Object.keys(DAROSTER.load().pickers).filter((k) => DAROSTER.hasShift(k)).length, daAll = Object.keys(DAROSTER.load().pickers).length;
    const rec = fp ? DCM.load(fp, dk) : null, fs = fp ? FPSTAT.load(fp, dk) : null;
    const recOk = !!((rec && rec.ev && rec.ev.length) || (fs && fs.seg && fs.seg.length) || PKREC.last);
    const off = PREFS.official || {};
    const checked = Object.keys(off).some((k) => off[k] && Object.values(off[k]).some((v) => v != null));
    const ok = (b) => (b ? '<span class="done">✓ </span>' : '');
    const step = (done, title, body) => '<li>' + ok(done) + '<b>' + title + '</b><br>' + body + '</li>';
    let h = '<div class="note">About 15 minutes. Everything is saved in this browser only, and the brain never changes anything in the Control Room or DCM.</div>';
    h += '<div class="card setup"><ol>' +
      step(PREFS.setupCP, 'Coffee and pharmacy', 'Does this FP have them? Switched off = hidden everywhere, and no late order is blamed on them.<br>' +
        '<label style="margin-right:18px"><input type="checkbox" data-su="SHOW_COFFEE"' + (hasCoffee() ? ' checked' : '') + '> This FP has coffee</label><label><input type="checkbox" data-su="SHOW_PHARMACY"' + (hasPharma() ? ' checked' : '') + '> This FP has a pharmacy</label>') +
      step(PREFS.settings && PREFS.settings.SHIFTS, 'Shift hours', 'Now: ' + CFG.SHIFTS.map((s) => esc(s.name) + ' ' + esc(shiftRange(s))).join(' · ') + '. ' + settingsLink('Change them in Settings')) +
      step(PREFS.setupPeaks, 'Peak hours', 'Used to flag DA breaks in peak. <input class="txt" style="width:160px" data-supeaks value="' + esc(peaksTxt()) + '"> <span class="mini">e.g. 12-15, 19-23</span> <button class="ghost sm" data-supeaksave>Save</button>') +
      step(pkSet > 0, 'Picker shifts', (pkSet ? pkSet + ' of ' + pkAll + ' picker accounts have a shift.' : 'No picker has a shift yet.') + ' Without shifts, quiet hours undercount who was on the floor and orders picked on someone else\'s account count for them. <button class="ghost sm" data-goto="pk_shifts">Open Picker shifts</button>') +
      step(daSet > 0, 'DA shifts', (daSet ? daSet + ' of ' + daAll + ' DAs have a shift.' : 'No DA has a shift yet.') + ' Same reason, for DAs. <button class="ghost sm" data-goto="da_shifts">Open DA shifts</button>') +
      step(recOk, 'Keep one Control Room tab open during every shift', 'The brain records DCM capacity, the FP status, the picker queue and DA availability every few minutes while a Control Room tab is open. Forced orders, Capacity, Root causes and Availability are only as good as these recordings. ' + (recOk ? 'Recording today.' : 'Nothing recorded today yet.')) +
      step(checked, 'Check one day against Tableau', 'Load a finished day, then type Tableau\'s P90, ETA late %, PPH (Ops), DPH (Ops), PPH and auto-assign for it under Settings → Check against Tableau. Gaps shown in red need a look before you trust the numbers. ' + settingsLink('Open Settings')) +
      '</ol><p style="margin:14px 0 0"><button class="btn primary" data-sudone>Done, open the Scorecard</button> <span class="mini">You can come back here any time (Brain → Start here). Back up your settings in Settings once you\'re set up.</span></p></div>';
    return h;
  };
  BIND.setup = function (main) {
    main.querySelectorAll('[data-su]').forEach((c) => c.addEventListener('change', async () => {
      PREFS.settings = PREFS.settings || {};
      const k = c.dataset.su;
      if (c.checked) delete PREFS.settings[k]; else PREFS.settings[k] = false;
      CFG[k] = c.checked; PREFS.setupCP = true; savePrefs();
      if (UI.raw) await UI.reanalyze(); else UI.render(true);
    }));
    const ps = main.querySelector('[data-supeaksave]');
    if (ps) ps.addEventListener('click', () => { const list = parsePeaks(main.querySelector('[data-supeaks]').value); if (list.length) { savePeaks(list); PREFS.setupPeaks = true; savePrefs(); } UI.render(true); });
    const dn = main.querySelector('[data-sudone]');
    if (dn) dn.addEventListener('click', () => { PREFS.setupDone = true; savePrefs(); UI.tab = 'scorecard'; UI.render(); });
  };

  // ---------- Settings: check against Tableau, peak hours, pages, back up / restore ----------
  // [key, label, tolerance]. PPH / DPH tolerances from the 1, 2, 4, 16 Oct 2026 check (v1.26): Tableau's picker / DA hours come
  // from Breadfast's own records, the brain counts hours from the orders, so small gaps are normal.
  const TAB_KPIS = [['p90f', 'P90 incl. forced', 2], ['p90n', 'P90 NOW', 2], ['eta', 'ETA late %', 1], ['ppho', 'PPH (Ops)', 1], ['dpho', 'DPH (Ops)', 0.2], ['pph', 'PPH', 1], ['auto', 'Auto-assign rate', 1]];
  function tableauCheckHtml(A, M) {
    if (!A || !A.score || !M) return card('Check against Tableau', '', '<p class="muted">Load a finished day first (select a date in the Control Room, then press Refresh).</p>');
    const dk = M.date, off = (PREFS.official || {})[dk] || {};
    if (off.p90f == null && PREFS.officialP90 && PREFS.officialP90[dk] != null) off.p90f = PREFS.officialP90[dk];
    const rows = TAB_KPIS.map(([k, label, tol]) => {
      const d = kpiDef(k), b = A.score.v[k], o = off[k];
      const gap = b != null && o != null ? b - o : null;
      return { k, label, b, o, gap, tol, unit: d.unit, d: d.d };
    });
    const cell = (r) => (r.gap == null ? '<td class="muted">–</td>' : '<td class="' + (Math.abs(r.gap) > r.tol ? 'gap-bad' : 'gap-ok') + '">' + (Math.abs(r.gap) < 0.05 ? '0' : (r.gap > 0 ? '+' : '') + r.gap.toFixed(r.d === 0 ? 1 : r.d)) + (r.unit === '%' ? ' pts' : r.unit === 'min' ? ' min' : '') + '</td>');
    const t = '<div class="tw tabcheck"><table><thead><tr><th class="l">KPI</th><th>FP Brain</th><th>Tableau</th><th>Gap</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td class="l"><b>' + r.label + '</b></td><td>' + kpiFmt(kpiDef(r.k), r.b) + '</td><td><input class="txt num" inputmode="decimal" data-tabk="' + r.k + '" value="' + (r.o != null ? r.o : '') + '" placeholder="Tableau"></td>' + cell(r) + '</tr>').join('') +
      '</tbody></table></div>';
    const bad = rows.filter((r) => r.gap != null && Math.abs(r.gap) > r.tol);
    const msg = rows.every((r) => r.gap == null) ? 'Type Tableau\'s numbers for ' + esc(dk) + '; they are saved in this browser.' :
      bad.length ? '<b>Check:</b> ' + bad.map((r) => r.label + ' (more than ' + r.tol + (r.unit === 'min' ? ' min' : r.unit === '%' ? ' pt' : '') + ')').join(', ') + '. Usual reasons: a day not finished when it was loaded, the next day not loaded yet (P90 incl. forced), or no Control Room recording that day (forced orders fall back to the cutoff below).' :
      '<span class="done">✓</span> Within tolerance of Tableau for ' + esc(dk) + ' (P90 2 min, ETA late and auto-assign 1 pt, PPH 1, DPH 0.2).';
    return card('Check against Tableau · ' + esc(dk), 'Compare one finished day with the official scorecard before trusting the numbers at a new FP. Tableau shows PPH, PPH (Ops) and DPH (Ops); it has no hour-by-hour DPH to compare.', t + '<p class="sub" style="margin-top:10px">' + msg + '</p>') + forcedCalibHtml(A, dk);
  }
  const BACKUP_SKIP = ['pkrec:', 'darec:', 'dcm:', 'fpstat:'];   // recordings: large, and only useful for the last 14 days
  function backupHtml() {
    return card('Back up and restore', 'Everything the brain keeps is in this browser only: a Chrome reset or a new laptop loses it. Download a backup after setting up, and now and then.',
      '<p><button class="btn" data-bkdown>Download backup</button> <label class="mini" style="margin-left:10px"><input type="checkbox" data-bkrec> include recordings (bigger file)</label></p>' +
      '<p style="margin-top:12px"><b>Restore</b> <span class="mini">(replaces what this browser has for the items in the file)</span><br><input type="file" accept=".json,application/json" data-bkfile> <span class="mini bkmsg"></span></p>');
  }
  const _settingsView = BRAIN_VIEWS.settings, _settingsBind = BIND.settings;
  BRAIN_VIEWS.settings = function (A, M) {
    const base = _settingsView.call(BRAIN_VIEWS, A, M);
    if (!LITE) return base;
    const top = card('Pages', '', '<label><input type="checkbox" data-advpages' + (PREFS.advanced ? ' checked' : '') + '> Show advanced pages</label> <span class="mini">Overview, Shifts, Late causes, Order types, Basket size, Longest waits & picks, Basket fairness, rankings & bonuses, Tiers & DCM, KPI log, and Live alerts / Capacity on their own.</span>') +
      card('Peak hours', 'Used to flag DA breaks taken in peak (Availability). Hours in 24 h, e.g. 12-15, 19-23.', '<input class="txt" style="width:200px" data-peaks value="' + esc(peaksTxt()) + '"> <button class="ghost sm" data-peaksave>Save</button>');
    return '<div id="tabcheck">' + tableauCheckHtml(A, UI.meta) + '</div>' + top + base + backupHtml();
  };
  BIND.settings = function (main) {
    if (_settingsBind) _settingsBind(main);
    if (!LITE) return;
    const dk = UI.meta && UI.meta.date;
    if (dk) bindCalib(main, dk);
    main.querySelectorAll('[data-tabk]').forEach((inp) => inp.addEventListener('change', () => {
      const v = parseFloat(inp.value), k = inp.dataset.tabk;
      PREFS.official = PREFS.official || {}; const o = PREFS.official[dk] = PREFS.official[dk] || {};
      if (isFinite(v)) o[k] = v; else delete o[k];
      if (k === 'p90f') { PREFS.officialP90 = PREFS.officialP90 || {}; if (isFinite(v)) PREFS.officialP90[dk] = v; else delete PREFS.officialP90[dk]; }
      savePrefs();
      setTimeout(() => { const sc = UI.root.querySelector('main').scrollTop; UI.render(); UI.root.querySelector('main').scrollTop = sc; }, 0);
    }));
    const adv = main.querySelector('[data-advpages]');
    if (adv) adv.addEventListener('change', () => { PREFS.advanced = adv.checked; savePrefs(); UI.render(true); });
    const pk = main.querySelector('[data-peaksave]');
    if (pk) pk.addEventListener('click', () => { const list = parsePeaks(main.querySelector('[data-peaks]').value); if (list.length) savePeaks(list); UI.render(true); });
    const dn = main.querySelector('[data-bkdown]');
    if (dn) dn.addEventListener('click', () => {
      const rec = main.querySelector('[data-bkrec]').checked, keys = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('fpx:') !== 0) continue;
        if (!rec && BACKUP_SKIP.some((p) => k.indexOf('fpx:' + p) === 0)) continue;
        keys[k] = localStorage.getItem(k);
      }
      const name = ((UI.meta && UI.meta.fpNames && UI.meta.fpNames[0]) || 'fp').replace(/[^\w]+/g, '-');
      const blob = new Blob([JSON.stringify({ app: 'fp-brain', version: '1.0.0', savedAt: new Date().toISOString(), keys })], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fp-brain-backup-' + name + '-' + dateKeyOf(Date.now()) + '.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    const fi = main.querySelector('[data-bkfile]'), msg = main.querySelector('.bkmsg');
    if (fi) fi.addEventListener('change', () => {
      const f = fi.files && fi.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        let j = null; try { j = JSON.parse(rd.result); } catch (e) { j = null; }
        if (!j || j.app !== 'fp-brain' || !j.keys || typeof j.keys !== 'object') { msg.textContent = 'That file is not an FP Brain backup.'; return; }
        let n = 0;
        Object.keys(j.keys).forEach((k0) => { const k = k0.replace(/^fp[bcl]:/, 'fpx:'); if (k.indexOf('fpx:') !== 0 || typeof j.keys[k0] !== 'string') return; try { localStorage.setItem(k, j.keys[k0]); n++; } catch (e) { } });
        msg.innerHTML = 'Restored ' + n + ' items from ' + esc(String(j.savedAt || '').slice(0, 10)) + '. <button class="ghost sm" data-bkreload>Reload the page to use them</button>';
        const rl = msg.querySelector('[data-bkreload]'); if (rl) rl.addEventListener('click', () => location.reload());
      };
      rd.readAsText(f);
    });
  };

  if (LITE) Object.assign(PAGE_DESC, {
    now: 'What needs attention right now, then what the FP can really handle this hour against DCM. Refreshes on its own every few minutes.',
    setup: 'First-time setup for this FP: seven steps, once.',
    slots: 'The day at a glance: volume, lateness and its top cause per timeslot, and your shifts side by side.',
  });

  /* ---------- page layout (v1.23): balanced rows of cards and tiles at any screen width ---------- */
  const LAYOUT_CSS = `
  main { container-type: inline-size; container-name: pg; }
  .page { max-width: 1560px; }
  .page > p.pd { max-width: 1100px; }
  .note { max-width: none; }
  /* cards side by side: two per row; three or four on one row when there is room */
  .grid { margin-bottom: 18px; }
  .grid > .card { margin-bottom: 0; min-width: 0; }
  .two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid:has(> :nth-child(3):last-child) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid:has(> :nth-child(4):last-child) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @container pg (min-width: 1280px) { .grid:has(> :nth-child(4):last-child) { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  @container pg (max-width: 980px) { .grid:has(> :nth-child(3):last-child) { grid-template-columns: 1fr; } }
  @container pg (max-width: 820px) { .two, .grid:has(> :nth-child(4):last-child) { grid-template-columns: 1fr; } }
  /* headline tiles and secondary tiles: every row full, no tile left alone on a row */
  .kpis, .tiles { display: grid; gap: 0; background: var(--paper); grid-template-columns: repeat(4, minmax(0, 1fr)); }
  /* lines between tiles drawn by each tile (right + bottom, the outer ones clipped), so a short last row leaves no grey block */
  .kpis > .kpi, .tiles > .tile { min-width: 0; background: transparent; border-left: 0 !important; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin: 0 -1px -1px 0; }
  .kpis:has(> :nth-child(1):last-child), .tiles:has(> :nth-child(1):last-child) { grid-template-columns: minmax(0, 1fr); }
  .kpis:has(> :nth-child(2):last-child), .tiles:has(> :nth-child(2):last-child) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpis:has(> :nth-child(3):last-child), .tiles:has(> :nth-child(3):last-child) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .kpis:has(> :nth-child(5):last-child), .tiles:has(> :nth-child(5):last-child) { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .kpis:has(> :nth-child(6):last-child), .tiles:has(> :nth-child(6):last-child) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .kpis:has(> :nth-child(7):last-child), .tiles:has(> :nth-child(7):last-child),
  .kpis:has(> :nth-child(8):last-child), .tiles:has(> :nth-child(8):last-child) { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  @container pg (min-width: 1100px) { .kpis:has(> :nth-child(6):last-child), .tiles:has(> :nth-child(6):last-child) { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
  @container pg (min-width: 1450px) { .kpis:has(> :nth-child(7):last-child), .tiles:has(> :nth-child(7):last-child) { grid-template-columns: repeat(7, minmax(0, 1fr)); } }
  @container pg (max-width: 900px) {
    .kpis:has(> :nth-child(4)), .tiles:has(> :nth-child(4)) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .kpis:has(> :nth-child(5):last-child), .tiles:has(> :nth-child(5):last-child), .kpis:has(> :nth-child(6):last-child), .tiles:has(> :nth-child(6):last-child) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  .kpis { margin-bottom: 18px; }
  /* Scorecard KPI tiles (v1.26: eight KPIs): same per-tile lines, four per row (two on narrow screens), no grey block */
  .sc { gap: 0; background: var(--paper); grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .sc > .kpi { min-width: 0; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin: 0 -1px -1px 0; }
  .sc:has(> :nth-child(6):last-child) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  @container pg (min-width: 1100px) { .sc:has(> :nth-child(6):last-child) { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
  @container pg (max-width: 900px) { .sc { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  /* what-if calculators */
  .wi { display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--rule); border-radius: 10px; background: var(--paper-2); }
  .wi-in { display: flex; gap: 18px; flex-wrap: wrap; }
  .wi-in label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; color: var(--ink-2) !important; font-size: 13px; }
  .wi-in input.num { width: 120px; font-size: 18px; font-weight: 700; padding: 7px 10px; }
  .wi-res { flex: 1; min-width: 260px; }
  .wi-res p.lres { font-size: 17px; margin: 2px 0 6px; color: var(--ink) !important; }
  .card > .tw:last-child, .card > table:last-child { margin-bottom: 0; }
  `;


  /* ------------------------------------------------------------------
   * TEAM EDITIONS – shared part of the Lead Brain (inventory lead) and the Coordinator Brain (dispatch coordinator).
   * Same engine and rules as the FP Brain. Shared here: language switch (Arabic / English), the KPI pages
   *   KPI scorecard (all KPIs by timeslot) · P90 (orders needed to hit target, what-if) · ETA late % (store vs dispatch, what-if),
   * the team-only Settings page and the CSS. Each edition file (ed_lead.js, ed_coord.js) adds its own pages, text and settings as ED.
   * Arabic or English: only the language is translated. KPI names, Breadfast terms and table columns stay as they are.
   * ------------------------------------------------------------------ */
  const LANG = { cur: PREFS.lang === 'en' ? 'en' : 'ar' };
  const LT_TXT = {
    ar: {
      g_kpi: "الـ KPIs",
      t_score: "KPI Scorecard بالساعة",
      t_p90: "P90",
      t_eta: "ETA late %",
      d_score: "كل الـ KPIs النهارده قصاد الهدف، ومقسمة على كل timeslot.",
      d_p90: "الـ P90 دلوقتي، محتاجين كام أوردر عشان نوصل للهدف، ولو عملنا كذا أوردر الـ P90 هيبقى كام آخر اليوم.",
      d_eta: "الـ ETA late %، مين السبب في كل أوردر متأخر (الـ FP ولا الـ Logistics)، ومحتاجين كام أوردر في الوقت عشان نوصل للهدف.",
      refresh: "↻ تحديث",
      close: "✕ قفل",
      lang: "English",
      loading: "بيحمّل الأوردرات…",
      crunch: "بيحسب الأرقام…",
      press: "اضغط <b>تحديث</b> عشان تحمّل اليوم اللي اخترته.",
      choose: "اختار يوم في الكنترول روم واستنى الأوردرات تحمّل، وبعدين اضغط <b>تحديث</b>.",
      good: "على الهدف",
      warn: "قريب من الهدف",
      bad: "بعيد عن الهدف",
      target: "الهدف",
      min: "دقيقة",
      k_sub_p90f: "الهدف {t} دقيقة · {n} أوردر NOW و forced",
      k_sub_p90n: "الهدف {t} دقيقة · {n} أوردر NOW",
      k_sub_eta: "{n} من {d} أوردر NOW اتسلموا اتأخروا · الهدف {t}٪",
      k_sub_pph: "الهدف {t} · {n} picker",
      k_sub_ppho: "الهدف {t} · {o} أوردر ÷ {h} active hours",
      k_sub_dpho: "الهدف {t} · {o} أوردر ÷ {h} active hours",
      k_sub_dph: "الهدف {t} · {n} DA",
      k_sub_auto: "الهدف {t}٪ · {n} manual",
      kp_title: "أهم الملاحظات",
      kp_owner: "من {total} أوردر متأخر: <b>{store}</b> بسبب الـ FP، و<b>{dis}</b> بسبب الـ Logistics، و{cp} بسبب القهوة أو الصيدلية.",
      kp_owner_nocp: "من {total} أوردر متأخر: <b>{store}</b> بسبب الـ FP، و<b>{dis}</b> بسبب الـ Logistics.",
      kp_basket: "<b>{n}</b> Large basket: الـ ETA كان أقصر من وقت التحضير المعتاد لحجم السلة + الاستلام + الـ ride. مش ذنب الـ FP ولا الـ Logistics.",
      kp_none: "مفيش أوردرات متأخرة. شغل ممتاز.",
      by_slot: "كل timeslot",
      by_slot_sub: "الـ P90 والـ ETA late % محسوبين على timeslot الأوردر. الـ PPH والـ DPH على الساعة اللي الشغل بدأ فيها (الـ picker بدأ يجهز، الـ DA استلم): الـ PPH (Ops) والـ DPH (Ops) بيحسبوا كل اللي بدأ أوردر في الساعة، والـ PPH والـ DPH بس الـ pickers اللي بدأوا {p}+ والـ DAs اللي استلموا {d}+.",
      p90_now: "الـ P90 دلوقتي",
      p90_over: "أوردرات فوق {t} دقيقة",
      p90_allowed: "مسموح فوق {t} دقيقة",
      p90_need: "محتاجين أوردرات تحت {t} دقيقة",
      p90_over_s: "{a} اتسلموا + {b} لسه مفتوحين وعدّوا {t} دقيقة",
      p90_allowed_s: "من {n} أوردر (10٪)",
      p90_need_s: "ورا بعض، كلهم تحت {t} دقيقة",
      p90_ok: "إحنا على الهدف دلوقتي. ممكن <b>{b}</b> أوردر كمان بس يعدّوا {t} دقيقة لحد آخر اليوم.",
      p90_ok2: "إحنا على الهدف دلوقتي. أي أوردر يعدّي {t} دقيقة من هنا بياكل من الهامش.",
      p90_fix: "عشان نرجع للهدف: لازم الـ <b>{n}</b> أوردر الجايين كلهم يتسلموا في أقل من {t} دقيقة.",
      p90_left: "متوقع لسه حوالي <b>{f}</b> أوردر النهارده، يعني أقصى حاجة <b>{b}</b> منهم ممكن يعدّوا {t} دقيقة.",
      wi_title: "لو حصل كده، هنقفل اليوم على كام؟",
      wi_good: "أوردرات كمان هتتسلم في الوقت",
      wi_bad: "أوردرات كمان هتتأخر",
      wi_good_p90: "أوردرات كمان تحت {t} دقيقة",
      wi_bad_p90: "أوردرات كمان فوق {t} دقيقة",
      wi_res_p90: "الـ P90 آخر اليوم هيبقى حوالي <b>{v} دقيقة</b>",
      wi_res_eta: "الـ ETA late % آخر اليوم هيبقى <b>{v}٪</b>",
      wi_on: "على الهدف ✓",
      wi_off: "مش على الهدف",
      wi_hint: "غيّر الأرقام وشوف النتيجة. الأرقام اللي فوق متحسبة من أوقات النهارده.",
      wi_maxbad_p90: "بالأرقام دي، أقصى عدد ممكن يعدّي {t} دقيقة: <b>{m}</b>.",
      wi_maxbad_eta: "بالأرقام دي، أقصى عدد ممكن يتأخر: <b>{m}</b>.",
      slow_title: "الأوردرات اللي عدّت {t} دقيقة",
      slow_sub: "دي الأوردرات اللي بتعلّي الـ P90. السبب على مين وليه.",
      eta_now: "الـ ETA late % دلوقتي",
      eta_late: "أوردرات متأخرة",
      eta_store: "متأخر بسبب الـ FP",
      eta_dis: "متأخر بسبب الـ Logistics",
      eta_late_s: "من {d} أوردر NOW اتسلموا",
      eta_store_s: "{p} من الأوردرات المتأخرة",
      eta_dis_s: "{p} من الأوردرات المتأخرة · قهوة/صيدلية {cp}",
      eta_dis_s_nocp: "{p} من الأوردرات المتأخرة",
      eta_ok: "إحنا على الهدف دلوقتي.",
      eta_fix: "عشان نوصل للهدف: محتاجين <b>{n}</b> أوردر كمان يتسلموا في الوقت من غير ولا أوردر متأخر.",
      eta_open: "{n} أوردر NOW لسه مفتوحين وعدّوا الـ ETA بتاعهم، ومحسوبين متأخرين.",
      eta_left: "لو جه حوالي <b>{f}</b> أوردر NOW كمان النهارده، أقصى حاجة <b>{b}</b> منهم ممكن يتأخروا.",
      eta_slot_t: "كل timeslot: الـ FP ولا الـ Logistics",
      eta_slot_s: "الأوردرات المتأخرة في كل timeslot، ومين السبب.",
      eta_orders_t: "كل أوردر متأخر",
      eta_orders_s: "كل مرحلة من عمر الأوردر بالدقايق، والأحمر = المرحلة دي كانت بطيئة. الـ FP = الأوردر اتجهز متأخر. الـ Logistics = اتجهز في الوقت واتأخر بعد كده.",
      f_all: "الكل",
      f_store: "الـ FP",
      f_dis: "الـ Logistics",
      f_cp: "قهوة / صيدلية",
      none: "مفيش.",
      closed: "اليوم ده خلص. الأرقام دي لو كان فيه أوردرات زيادة.",
      g_set: "الإعدادات",
      settings_btn: "⚙ الإعدادات",
    },
    en: {
      g_kpi: "KPIs",
      t_score: "KPI Scorecard",
      t_p90: "P90",
      t_eta: "ETA late %",
      d_score: "Every KPI today against target, broken down by timeslot.",
      d_p90: "P90 now, how many orders it takes to hit target, and what P90 will be at the end of the day if we do X.",
      d_eta: "ETA late %, whose fault each late order was (FP or logistics), and how many on-time orders it takes to hit target.",
      refresh: "↻ Refresh",
      close: "✕ Close",
      lang: "عربي",
      loading: "Loading orders…",
      crunch: "Crunching the numbers…",
      press: "Press <b>Refresh</b> to load the selected date.",
      choose: "Choose a date in the Control Room, wait for the orders to load, then press <b>Refresh</b>.",
      good: "On target",
      warn: "Close to target",
      bad: "Off target",
      target: "Target",
      min: "min",
      k_sub_p90f: "Target {t} min · {n} NOW and forced orders",
      k_sub_p90n: "Target {t} min · {n} NOW orders",
      k_sub_eta: "{n} of {d} NOW orders delivered late · target {t}%",
      k_sub_pph: "Target {t} · {n} pickers",
      k_sub_ppho: "Target {t} · {o} orders ÷ {h} picker active hours",
      k_sub_dpho: "Target {t} · {o} orders ÷ {h} DA active hours",
      k_sub_dph: "Target {t} · {n} DAs",
      k_sub_auto: "Target {t}% · {n} manual",
      kp_title: "Key points",
      kp_owner: "Of {total} late orders: <b>{store}</b> were the FP's, <b>{dis}</b> logistics', {cp} the coffee or pharmacy.",
      kp_owner_nocp: "Of {total} late orders: <b>{store}</b> were the FP's, <b>{dis}</b> logistics'.",
      kp_basket: "<b>{n}</b> Large basket: the ETA was shorter than the usual picking time for that size + pickup + the ride. Neither the FP nor logistics owns these.",
      kp_none: "No late orders. Great work.",
      by_slot: "By timeslot",
      by_slot_sub: "P90 and ETA late % by the order's timeslot. PPH and DPH by the clock hour the work started (picker started picking, DA picked up): PPH (Ops) / DPH (Ops) count everyone who started an order that hour, PPH / DPH only pickers with {p}+ and DAs with {d}+ in that hour.",
      p90_now: "P90 now",
      p90_over: "Orders over {t} min",
      p90_allowed: "Allowed over {t} min",
      p90_need: "Orders under {t} min needed",
      p90_over_s: "{a} delivered + {b} still open and past {t} min",
      p90_allowed_s: "of {n} orders (10%)",
      p90_need_s: "in a row, all under {t} min",
      p90_ok: "We're on target now. Up to <b>{b}</b> more orders can go over {t} min for the rest of the day.",
      p90_ok2: "We're on target now. Every order over {t} min from here uses up the margin.",
      p90_fix: "To get back on target: the next <b>{n}</b> orders must all be delivered in under {t} min.",
      p90_left: "About <b>{f}</b> more orders are expected today, so at most <b>{b}</b> of them can go over {t} min.",
      wi_title: "If this happens, where do we end the day?",
      wi_good: "More orders delivered on time",
      wi_bad: "More orders late",
      wi_good_p90: "More orders under {t} min",
      wi_bad_p90: "More orders over {t} min",
      wi_res_p90: "P90 at the end of the day would be about <b>{v} min</b>",
      wi_res_eta: "ETA late % at the end of the day would be <b>{v}%</b>",
      wi_on: "On target ✓",
      wi_off: "Not on target",
      wi_hint: "Change the numbers and see the result. Times are based on today's orders.",
      wi_maxbad_p90: "With these numbers, at most <b>{m}</b> can go over {t} min.",
      wi_maxbad_eta: "With these numbers, at most <b>{m}</b> can be late.",
      slow_title: "Orders over {t} min",
      slow_sub: "These are the orders pushing P90 up. Whose fault, and why.",
      eta_now: "ETA late % now",
      eta_late: "Late orders",
      eta_store: "Late because of the FP",
      eta_dis: "Late because of logistics",
      eta_late_s: "of {d} NOW orders delivered",
      eta_store_s: "{p} of late orders",
      eta_dis_s: "{p} of late orders · coffee/pharmacy {cp}",
      eta_dis_s_nocp: "{p} of late orders",
      eta_ok: "We're on target now.",
      eta_fix: "To hit target: <b>{n}</b> more orders must be delivered on time with none late.",
      eta_open: "{n} NOW orders are still open and already past their ETA; they count as late.",
      eta_left: "If about <b>{f}</b> more NOW orders come in today, at most <b>{b}</b> of them can be late.",
      eta_slot_t: "By timeslot: FP or logistics",
      eta_slot_s: "Late orders in each timeslot, and whose fault.",
      eta_orders_t: "Every late order",
      eta_orders_s: "Each stage of the order's life in minutes; red = that stage was slow. FP = the order was packed late. Logistics = packed on time, late after that.",
      f_all: "All",
      f_store: "FP",
      f_dis: "Logistics",
      f_cp: "Coffee / pharmacy",
      none: "None.",
      closed: "This day is over. These numbers show what extra orders would have done.",
      g_set: "Settings",
      settings_btn: "⚙ Settings",
    },
  };
  function LT(k, vars) {
    let s = (LT_TXT[LANG.cur] && LT_TXT[LANG.cur][k]) || LT_TXT.en[k] || k;
    if (vars) Object.keys(vars).forEach((v) => { s = s.split('{' + v + '}').join(vars[v]); });
    // inside Arabic text, keep English terms (ETA late %, P90 NOW, SKUs…) in their own direction
    if (LANG.cur === 'ar') s = s.split(/(<[^>]+>)/).map((p) => (p.charAt(0) === '<' ? p : p.replace(/\(?[A-Za-z][A-Za-z0-9 %./()+\-]*[A-Za-z0-9%)]|[A-Za-z]/g, '<bdi>$&</bdi>'))).join('');
    return s;
  }
  const isAr = () => LANG.cur === 'ar';
  // Arabic for the text inside the reused FP Brain pages (columns and Breadfast terms are left in English on purpose); editions push their own
  const AR_UI = [
    ['>not ranked<', '>مش في الترتيب<'], ['>not set<', '>مش متحدد<'], ['>day off<', '>أجازة<'],
    // shifts page
    ['>Save and recalculate<', '>حفظ وإعادة الحساب<'], ['<h2>Picker shifts</h2>', '<h2>شيفتات الـ pickers</h2>'],
    ['Hours in 24 h format, half hours allowed (7.5 = 07:30). Leave both empty for "no shift set".', 'الساعات بنظام 24 ساعة، ونص الساعة مسموح (7.5 = 07:30). سيبهم فاضيين لو مفيش شيفت.'],
    ['<div class="k">Picker accounts</div>', '<div class="k">أكونتات الـ pickers</div>'], ['seen on analysed days', 'اللي ظهروا في الأيام اللي اتحمّلت'], ['<div class="k">Usual shift set</div>', '<div class="k">ليهم شيفت عادي</div>'],
    [/(\d+) without \(everything counts\)/, '$1 من غير شيفت (كل حاجة بتتحسب)'], ['>all set<', '>كلهم متحددين<'], ['<div class="k">Not ranked</div>', '<div class="k">مش في الترتيب</div>'], ['resigned or shared accounts', 'أكونتات مستقيلين أو مشتركة'],
    [/<div class="k">Not counted on ([^<]*)<\/div>/, '<div class="k">مش محسوبين يوم $1</div>'], ['outside the shift', 'برّه الشيفت'], [/(\d+) on a day off, (\d+) outside shift/, '$1 في يوم أجازة، $2 برّه الشيفت'],
    ['>Ranked<', '>في الترتيب<'], ['>Not ranked<', '>مش في الترتيب<'], ['>None<', '>مفيش<'], ['>Different hours<', '>ساعات مختلفة<'], ['>Day off / absent<', '>أجازة / غياب<'],
    [/>As usual \(([^)]*)\)</g, '>زي العادي ($1)<'], ['no usual shift', 'مفيش شيفت'], ['day off)', 'أجازة)'],
    ['>none in shift<', '>ولا أوردر جوه الشيفت<'], [/<span class="mini">shift ([^<]*)<\/span>/g, '<span class="mini">الشيفت $1</span>'],
    ['None: everything was inside the shift', 'مفيش: كل حاجة كانت جوه الشيفت'], [' (no shifts set yet)', ' (لسه مفيش شيفتات متحددة)'], ['>Outside shift<', '>برّه الشيفت<'], ['>Day off<', '>أجازة<'], ['>no shift set<', '>مفيش شيفت<'], ['>day off<', '>أجازة<'],
    [/, not counted<\/span>/g, '، مش محسوب</span>'], ['<p class="muted">None.</p>', '<p class="muted">مفيش.</p>'],
    // ranking & bonuses
    ['>Loaded day<', '>اليوم المحمّل<'], ['>This week<', '>الأسبوع ده<'], ['>Last week<', '>الأسبوع اللي فات<'], ['>This month<', '>الشهر ده<'], ['>Last month<', '>الشهر اللي فات<'], ['>All saved<', '>كل الأيام المتسجلة<'],
    ['>Fill missing days<', '>كمّل الأيام الناقصة<'], ['>Recalculate with current shifts<', '>إعادة الحساب بالشيفتات الحالية<'], ['>Export CSV<', '>تحميل CSV<'], ['>⚙ Weights<', '>⚙ الأوزان<'],
    ['>excluded<', '>مستبعد<'],
    [/<p class="muted">No saved days in this period yet\.[^<]*<\/p>/, '<p class="muted">لسه مفيش أيام متسجلة في الفترة دي. حمّل أيام من الكنترول روم، أو اضغط كمّل الأيام الناقصة.</p>'],
    ['>no picks in shift<', '>مجهزش جوه الشيفت<'], ['>on shift<', '>في الشيفت<'], ['>worked day off<', '>اشتغل يوم أجازته<'], [/>their average (\d+)</, '>متوسطه $1<'],
    // settings
    ['>Save and re-analyse<', '>حفظ وإعادة الحساب<'], ['>Reset all to defaults<', '>رجّع كل حاجة للأصل<'], [/<div class="mini">default /g, '<div class="mini">الأصلي '],
  ];
  function trAr(html) {
    if (!isAr()) return html;
    AR_UI.forEach(([a, b]) => { html = typeof a === 'string' ? html.split(a).join(b) : html.replace(a, b); });
    return html;
  }
  const swapNote = (html, note) => html.replace(/<div class="note">[\s\S]*?<\/div>/, '<div class="note">' + note + '</div>');

  // header, language, date
  function leadDate(dk) { const t = dayStartOf(dk); return t == null ? dk : new Date(t).toLocaleDateString(isAr() ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  const TH_AR = { charcoal: ['فحمي', 'غامق: رمادي فحمي وكلام أبيض'], white: ['أبيض', 'فاتح: أبيض وكلام فحمي'], warm: ['رمادي دافي', 'فاتح: رمادي دافي وعناوين ماجنتا'], magenta: ['ماجنتا', 'إطار ماجنتا وكلام أبيض'] };
  function leadThemeNames() {
    if (!UI.root) return;
    const nm = (t) => (isAr() && TH_AR[t.id] ? TH_AR[t.id] : [t.name, t.sub]);
    const t = THEMES.find((x) => x.id === (UI.root.dataset.theme || 'charcoal')) || THEMES[0];
    const el = UI.root.querySelector('.thm-name'); if (el) el.textContent = nm(t)[0];
    UI.root.querySelectorAll('[data-theme-pick]').forEach((b) => { const x = THEMES.find((y) => y.id === b.dataset.themePick); if (!x) return; b.querySelector('b').textContent = nm(x)[0]; b.querySelector('small').textContent = nm(x)[1]; });
  }
  const _setTheme = UI.setTheme;
  UI.setTheme = function (id, quiet) { _setTheme.call(UI, id, quiet); leadThemeNames(); };
  function leadApplyLang() {
    if (!UI.root) return;
    UI.root.setAttribute('dir', isAr() ? 'rtl' : 'ltr');
    UI.root.setAttribute('lang', LANG.cur);
    const set = (sel, k) => { const el = UI.root.querySelector(sel); if (el) el.innerHTML = LT(k); };
    set('[data-act="settings"]', 'settings_btn'); set('[data-act="refresh"]', 'refresh'); set('[data-act="close"]', 'close'); set('[data-act="lang"]', 'lang');
    leadThemeNames();
    const h1 = UI.root.querySelector('header h1'); if (h1 && UI.meta && UI.meta.date) h1.textContent = leadDate(UI.meta.date);
  }
  const LEAD_GROUPS = () => ED.groups();
  // page descriptions follow the language; called by the edition file once ED exists
  function edBoot() { Object.keys(ED.desc).forEach((k) => Object.defineProperty(PAGE_DESC, k, { get: () => LT(ED.desc[k]), configurable: true, enumerable: true })); }

  const N = (v, d) => (v == null || !isFinite(v) ? '–' : Number(v).toFixed(d || 0));
  const pctTxt = (n, d) => (d ? Math.round((100 * n) / d) + '%' : '–');
  const slotTxt = (h) => slotLabel(h);
  const stPill = (st) => (st ? '<div class="st">' + LT(st) + '</div>' : '');
  const bigKpi = (k, v, u, s, st) => '<div class="kpi ' + (st || '') + '"><div class="k">' + k + '</div><div class="v">' + v + (u ? '<span class="u">' + u + '</span>' : '') + '</div><div class="s">' + s + '</div>' + stPill(st) + '</div>';
  const ownKey = (r) => { const o = ownerOf(r); return o === OWN_STORE ? 'store' : o === OWN_DISPATCH ? 'dis' : o === OWN_CP ? 'cp' : o === OWN_BASKET ? 'basket' : 'unclear'; };
  const LEAD_CALC = {};

  /* ---------- KPI scorecard ---------- */
  BRAIN_VIEWS.l_score = function (A) {
    CUR_A = A;
    const S = A.score, v = S.v, T = A.pk.team;
    const X = accountability(A);
    const st = (k) => kpiStatus(kpiDef(k), v[k]);
    let h = '<div class="sc">' +
      bigKpi('P90 incl. forced', N(v.p90f), 'min', LT('k_sub_p90f', { t: CFG.P90_TARGET_MIN, n: S.nowDel.length + S.forcedDel.length }), st('p90f')) +
      bigKpi('P90 NOW', N(v.p90n), 'min', LT('k_sub_p90n', { t: CFG.P90_TARGET_MIN, n: S.nowDel.length }), st('p90n')) +
      bigKpi('ETA late %', N(v.eta, 1), '%', LT('k_sub_eta', { n: S.extra.etaLate, d: S.extra.delivered, t: CFG.LATE_TARGET_PCT }), st('eta')) +
      bigKpi('PPH (Ops)', N(v.ppho, 1), '', LT('k_sub_ppho', { t: CFG.PPH_OPS_TARGET, o: S.extra.opsOrders, h: S.extra.pkActiveH }), st('ppho')) +
      bigKpi('DPH (Ops)', N(v.dpho, 2), '', LT('k_sub_dpho', { t: CFG.DPH_OPS_TARGET, o: S.extra.opsOrders, h: S.extra.daActiveH }), st('dpho')) +
      bigKpi('PPH', N(v.pph, 1), '', LT('k_sub_pph', { t: CFG.PPH_TARGET, n: T.pickers }), st('pph')) +
      bigKpi('DPH', N(v.dph, 2), '', LT('k_sub_dph', { t: CFG.DPH_TARGET, n: S.extra.das }), st('dph')) +
      bigKpi('Auto-assign', N(v.auto, 1), '%', LT('k_sub_auto', { t: CFG.AUTO_ASSIGN_TARGET, n: S.extra.manualN }), st('auto')) + '</div>';
    // key points
    const total = X.late.length, pts = [];
    if (!total) pts.push(LT('kp_none'));
    else {
      pts.push(LT(hasCP() ? 'kp_owner' : 'kp_owner_nocp', { total, store: X.counts[OWN_STORE], dis: X.counts[OWN_DISPATCH], cp: X.counts[OWN_CP] }));
      if (X.counts[OWN_BASKET]) pts.push(LT('kp_basket', { n: X.counts[OWN_BASKET] }));
      ED.keyPoints(A, X).forEach((p) => pts.push(p));
    }
    h += card(LT('kp_title'), '', '<ul class="lpts">' + pts.map((p) => '<li>' + p + '</li>').join('') + '</ul>');
    const lateBy = (slot, k) => X.late.filter((r) => r.slot === slot && ownKey(r) === k).length;
    h += card(LT('by_slot'), LT('by_slot_sub', { p: CFG.PPH_MIN_PICKS, d: CFG.DPH_MIN_DELIVERIES }), table([
      ['Timeslot', (r) => r.h, (r) => esc(r.label), 'l'], ['Orders', (r) => r.orders],
      ['P90 incl. forced', (r) => r.p90f, (r) => kpiPill('p90f', r.p90f)], ['P90 NOW', (r) => r.p90n, (r) => kpiPill('p90n', r.p90n)],
      ['ETA late %', (r) => r.eta, (r) => kpiPill('eta', r.eta) + (r.etaLate ? ' <span class="mini">' + r.etaLate + '</span>' : '')],
      ['Late: FP', (r) => lateBy(r.h, 'store'), (r) => { const n = lateBy(r.h, 'store'); return n ? '<b style="color:var(--bad)">' + n + '</b>' : '0'; }],
      ['Late: logistics', (r) => lateBy(r.h, 'dis')], ['Late: coffee / pharmacy', (r) => lateBy(r.h, 'cp')],
    ].concat(ED.slotCols(A, X)), S.hours));
    return h;
  };

  /* ---------- P90 ---------- */
  BRAIN_VIEWS.l_p90 = function (A) {
    CUR_A = A;
    const which = BRAIN_VIEWS._lp90 || 'forced', withForced = which === 'forced';
    const P = p90Pool(A, withForced), X = p90Plan(A, P), T = P.T;
    const onTarget = X.O <= p90Allowed(X.n);
    const p90v = P.p90 ? P.p90.deliveryMin : null;
    let h = '<div class="mapbar"><div class="seg" data-lp90>' + [['forced', 'P90 incl. forced'], ['now', 'P90 NOW']].map(([k, l]) => '<button data-v="' + k + '" class="' + (which === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div></div>';
    h += '<div class="kpis">' +
      bigKpi(LT('p90_now'), N(p90v), 'min', LT('k_sub_p90' + (withForced ? 'f' : 'n'), { t: T, n: P.n }), p90v == null ? null : p90v <= T ? 'good' : p90v <= CFG.WARN.p90 ? 'warn' : 'bad') +
      bigKpi(LT('p90_over', { t: T }), X.O, '', LT('p90_over_s', { a: P.over, b: X.lost.length, t: T }), onTarget ? 'good' : 'bad') +
      bigKpi(LT('p90_allowed', { t: T }), p90Allowed(X.n), '', LT('p90_allowed_s', { n: X.n }), null) +
      bigKpi(LT('p90_need', { t: T }), onTarget ? 0 : X.clean, '', LT('p90_need_s', { t: T }), onTarget ? 'good' : 'bad') + '</div>';
    const lines = [onTarget ? (X.budget != null ? LT('p90_ok', { b: Math.max(0, X.budget), t: T }) : LT('p90_ok2', { t: T })) : LT('p90_fix', { n: X.clean, t: T })];
    if (X.F != null && !onTarget) lines.push(LT('p90_left', { f: X.F, b: Math.max(0, X.budget), t: T }));
    h += card(LT('kp_title'), '', '<ul class="lpts">' + lines.map((l) => '<li>' + l + '</li>').join('') + '</ul>');
    // what-if
    const base = P.s.map((r) => r.deliveryMin).concat(X.lost.map((x) => Math.max(x.age, X.lateMed)));
    LEAD_CALC.p90 = (good, bad) => {
      const all = base.concat(Array(bad).fill(X.lateMed), Array(good).fill(X.cleanMed)).sort((a, b) => a - b);
      if (!all.length) return '–';
      const p = all[p90Rank(all.length) - 1], ok = p <= T;
      const maxBad = p90Allowed(all.length) - X.O;
      return '<p class="lres">' + LT('wi_res_p90', { v: N(p) }) + ' <span class="pill ' + (ok ? 'good' : 'bad') + '">' + LT(ok ? 'wi_on' : 'wi_off') + '</span></p><p class="mini">' + LT('wi_maxbad_p90', { m: Math.max(0, maxBad), t: T }) + '</p>';
    };
    const W = BRAIN_VIEWS._lw90 || {}, g0 = W.g != null ? W.g : X.F != null ? X.F : 0, b0 = W.b != null ? W.b : 0;
    h += card(LT('wi_title'), (A.isToday ? '' : LT('closed') + ' ') + LT('wi_hint'),
      '<div class="lwi"><label>' + LT('wi_good_p90', { t: T }) + '<input class="txt num" type="number" min="0" step="1" data-lw="g" value="' + g0 + '"></label><label>' + LT('wi_bad_p90', { t: T }) + '<input class="txt num" type="number" min="0" step="1" data-lw="b" value="' + b0 + '"></label></div><div data-lwres>' + LEAD_CALC.p90(g0, b0) + '</div>');
    // by timeslot + slow orders
    h += card(LT('by_slot'), '', table([
      ['Timeslot', (r) => r.slot, (r) => esc(r.label), 'l'], ['Orders', (r) => r.orders], ['P90 NOW', (r) => r.p90Now, (r) => p90Pill(r.p90Now)], ['P90 incl. forced', (r) => r.p90Proxy, (r) => p90Pill(r.p90Proxy)],
      ['Over ' + T + ' min', (r) => P.s.filter((x) => x.slot === r.slot && x.deliveryMin > T).length], ['Median delivery', (r) => r.medDelivery, (r) => fmt(r.medDelivery, 0)],
    ], A.slots.filter((s) => s.orders)));
    const slow = P.s.filter((r) => r.deliveryMin > T).sort((a, b) => b.deliveryMin - a.deliveryMin);
    h += card(LT('slow_title', { t: T }) + ' · ' + slow.length, LT('slow_sub'), slow.length ? leadOrderTable(slow, true) : '<p class="muted">' + LT('none') + '</p>');
    return h;
  };

  // one order table for both KPI tabs: lifecycle with owner and reason
  function leadOrderTable(rows, withTotal) {
    tripContext(CUR_A);
    return table([
      ['Order', (r) => r.orderNumber, (r) => '<b>' + esc(r.orderNumber) + '</b><br><span class="muted">' + (r.scheduled ? 'Scheduled' : 'NOW') + ' · ' + esc(slotLabel(r.slot)) + '</span>', 'l'],
      withTotal ? ['Delivery time', (r) => r.deliveryMin, (r) => '<b>' + fmt(r.deliveryMin, 0) + '</b> min'] : ['Late by', (r) => r.lateMin, (r) => '<b>' + fmt(r.lateMin, 0) + '</b> min'],
      ['Owner', (r) => ownKey(r), (r) => (r.late ? '<span class="pill ' + ({ store: 'bad', dis: 'warn' }[ownKey(r)] || 'na') + '">' + { store: 'FP', dis: 'Logistics', cp: 'Coffee / pharmacy', basket: 'Large basket', unclear: 'Unclear' }[ownKey(r)] + '</span>' : '<span class="muted">on time vs ETA</span>'), 'l'],
      ['Reason', (r) => whyLate(r), reasonCell, 'l'],
      ['Created', (r) => r.placed, (r) => fmtTime(r.placed)],
      ['Wait for picker', (r) => r.waitMin, (r) => stageCell(r.waitMin, r.start, r.waitMin != null && r.waitMin >= (CFG.WAIT_TARGET_MIN || 5))],
      ['Picking', (r) => r.handleMin, (r) => stageCell(r.handleMin, r.packed, r.handleMin != null && r.handleMin >= (CFG.HANDLE_TARGET_MIN || 6) * 2)],
      ['Awaiting pickup', (r) => r.shelfMin, (r) => stageCell(r.shelfMin, r.pickedUp, r.shelfMin != null && r.shelfMin >= (CFG.ALERT_SHELF_MIN || 10))],
      ['Ride', (r) => r.legMin, (r) => stageCell(r.legMin, r.completed, r.tripExtra != null && r.tripExtra >= 5)],
      ['SKUs / bags', (r) => r.skus, (r) => (r.skus != null ? r.skus : '–') + ' <span class="muted">/ ' + (r.bags != null ? r.bags : '–') + '</span>'],
      ['Picker', (r) => r.pickerName || '', (r) => esc(r.pickerName || '–'), 'l'], ['DA', (r) => r.daName || '', (r) => esc(r.daName || '–'), 'l'], ['Sub-area', (r) => r.subArea, null, 'l'],
    ], rows);
  }

  /* ---------- ETA late % ---------- */
  BRAIN_VIEWS.l_eta = function (A) {
    CUR_A = A;
    const S = A.score, t = CFG.LATE_TARGET_PCT / 100, now = Date.now();
    const X = accountability(A);
    const d = S.extra.delivered, late = S.extra.etaLate;   // NOW orders only, as the official scorecard
    const open = A.rows.filter((r) => !r.subOrder && !r.scheduled && !['completed', 'cancelled', 'not-received'].includes(r.status));
    const openLate = open.filter((r) => r.deadline != null && r.deadline < now).length;
    const L = late + openLate, D = d + openLate;
    const need = L / Math.max(D, 1) <= t ? 0 : Math.max(0, Math.ceil(L / t - D));
    // orders still to deliver today: the typical day's orders not placed yet, plus open orders not yet past their ETA
    const typ = typicalDayOrders(A);
    const nowShare = A.day.orders ? A.day.nowCount / A.day.orders : 1;
    const F = typ ? Math.round(Math.max(0, typ.orders - (A.day.orders || 0)) * nowShare) + open.filter((r) => r.deadline == null || r.deadline >= now).length : null;
    const store = X.counts[OWN_STORE], dis = X.counts[OWN_DISPATCH], cp = X.counts[OWN_CP];
    let h = '<div class="kpis">' +
      bigKpi(LT('eta_now'), N(S.v.eta, 1), '%', LT('k_sub_eta', { n: late, d, t: CFG.LATE_TARGET_PCT }), kpiStatus(kpiDef('eta'), S.v.eta)) +
      bigKpi(LT('eta_late'), late, '', LT('eta_late_s', { d }), null) +
      bigKpi(LT('eta_store'), store, '', LT('eta_store_s', { p: pctTxt(store, X.late.length) }), store ? 'bad' : 'good') +
      bigKpi(LT('eta_dis'), dis, '', LT(hasCP() ? 'eta_dis_s' : 'eta_dis_s_nocp', { p: pctTxt(dis, X.late.length), cp }), null) + '</div>';
    const lines = [need ? LT('eta_fix', { n: need }) : LT('eta_ok')];
    if (openLate) lines.push(LT('eta_open', { n: openLate }));
    if (F != null) lines.push(LT('eta_left', { f: F, b: Math.max(0, Math.floor(t * (D + F) - L)) }));
    h += card(LT('kp_title'), '', '<ul class="lpts">' + lines.map((l) => '<li>' + l + '</li>').join('') + '</ul>');
    LEAD_CALC.eta = (good, bad) => {
      const tot = D + good + bad, e = tot ? (100 * (L + bad)) / tot : null, ok = e != null && e <= CFG.LATE_TARGET_PCT;
      return '<p class="lres">' + LT('wi_res_eta', { v: N(e, 1) }) + ' <span class="pill ' + (ok ? 'good' : 'bad') + '">' + LT(ok ? 'wi_on' : 'wi_off') + '</span></p><p class="mini">' + LT('wi_maxbad_eta', { m: Math.max(0, Math.floor(t * (D + good + bad) - L)) }) + '</p>';
    };
    const W = BRAIN_VIEWS._lweta || {}, g0 = W.g != null ? W.g : F != null ? F : 0, b0 = W.b != null ? W.b : 0;
    h += card(LT('wi_title'), (A.isToday ? '' : LT('closed') + ' ') + LT('wi_hint'),
      '<div class="lwi"><label>' + LT('wi_good') + '<input class="txt num" type="number" min="0" step="1" data-lw="g" value="' + g0 + '"></label><label>' + LT('wi_bad') + '<input class="txt num" type="number" min="0" step="1" data-lw="b" value="' + b0 + '"></label></div><div data-lwres>' + LEAD_CALC.eta(g0, b0) + '</div>');
    const slots = [];
    for (let x = 0; x < 24; x++) {
      const g = X.late.filter((r) => r.slot === x), sl = A.slots.find((s) => s.slot === x);
      const nowDel = sl ? A.rows.filter((r) => !r.subOrder && r.slot === x && r.delivered && r.late != null).length : 0;
      if (!nowDel && !g.length) continue;
      slots.push({ h: x, nowDel, late: g.length, store: g.filter((r) => ownKey(r) === 'store').length, dis: g.filter((r) => ownKey(r) === 'dis').length, cp: g.filter((r) => ownKey(r) === 'cp').length });
    }
    h += card(LT('eta_slot_t'), LT('eta_slot_s'), table([
      ['Timeslot', (r) => r.h, (r) => esc(slotLabel(r.h)), 'l'], ['Delivered', (r) => r.nowDel], ['Late', (r) => r.late], ['ETA late %', (r) => rate(r.late, r.nowDel), (r) => latePill(rate(r.late, r.nowDel))],
      ['FP', (r) => r.store, (r) => (r.store ? '<b style="color:var(--bad)">' + r.store + '</b>' : '0')], ['Logistics', (r) => r.dis], ['Coffee / pharmacy', (r) => r.cp],
    ], slots));
    const f = BRAIN_VIEWS._lef || ED.etaFilter || 'all';
    const rows = X.late.filter((r) => f === 'all' || ownKey(r) === f);
    const cnt = { all: X.late.length, store, dis, cp };
    h += '<div class="mapbar"><div class="seg" data-lef>' + ['all', 'store', 'dis'].concat(hasCP() ? ['cp'] : []).map((k) => '<button data-v="' + k + '" class="' + (f === k ? 'on' : '') + '">' + LT('f_' + k) + ' (' + cnt[k] + ')</button>').join('') + '</div></div>';
    h += card(LT('eta_orders_t') + ' · ' + rows.length, LT('eta_orders_s'), rows.length ? leadOrderTable(rows, false) : '<p class="muted">' + LT('none') + '</p>');
    return h;
  };

  // ranking pages: the period name in Arabic, used in the note and the day-by-day card
  const AR_PERIOD = { day: 'اليوم المحمّل', week: 'الأسبوع ده', lastweek: 'الأسبوع اللي فات', month: 'الشهر ده', lastmonth: 'الشهر اللي فات', all: 'كل الأيام المتسجلة' };
  const rankRange = (days) => (days.length ? ' (' + esc(days[0]) + (days.length > 1 ? ' → ' + esc(days[days.length - 1]) : '') + ')' : '');
  function rankAr(h, kind, P, note) { const lbl = AR_PERIOD[kind] || esc(P.label); return trAr(swapNote(h, note).split(' · ' + esc(P.label) + '</span></h2>').join(' · ' + lbl + '</span></h2>')); }

  /* ---------- settings: only the team's own settings (ED.settings) ---------- */
  const L2 = (en, ar) => (isAr() ? ar : en);
  // KPI targets: the same targets and amber limits as the FP Brain (Settings → KPI targets), editable per FP (saved in this browser)
  const KPI_TARGET_SET = () => [L2('KPI targets', 'أهداف الـ KPIs'), L2('Your FP\'s targets. Green at or better than the target, amber up to the amber limit, red beyond it. Use the same numbers as the FP Brain and your DM.',
      'أهداف الـ FP بتاعك. أخضر لو على الهدف أو أحسن، أصفر لحد حد الأصفر، وأحمر بعد كده. استخدم نفس الأرقام اللي في الـ FP Brain وعند الـ DM.'), [
    ['P90_TARGET_MIN', L2('P90 target (min)', 'هدف الـ P90 (دقيقة)'), L2('P90 NOW and P90 incl. forced', 'P90 NOW و P90 incl. forced'), 'num', 1], ['WARN.p90', L2('P90 amber up to (min)', 'الـ P90 أصفر لحد (دقيقة)'), '', 'num', 1],
    ['LATE_TARGET_PCT', L2('ETA late target (%)', 'هدف الـ ETA late (%)'), L2('NOW orders delivered after their ETA', 'أوردرات NOW اتوصلت بعد الـ ETA'), 'num', 0.1], ['WARN.eta', L2('ETA late amber up to (%)', 'الـ ETA late أصفر لحد (%)'), '', 'num', 0.1],
    ['PPH_OPS_TARGET', L2('PPH (Ops) target', 'هدف الـ PPH (Ops)'), L2('orders ÷ picker active hours', 'الأوردرات ÷ active hours بتاعة الـ pickers'), 'num', 0.1], ['WARN.ppho', L2('PPH (Ops) amber down to', 'الـ PPH (Ops) أصفر لحد'), '', 'num', 0.1],
    ['DPH_OPS_TARGET', L2('DPH (Ops) target', 'هدف الـ DPH (Ops)'), L2('orders ÷ DA active hours', 'الأوردرات ÷ active hours بتاعة الـ DAs'), 'num', 0.1], ['WARN.dpho', L2('DPH (Ops) amber down to', 'الـ DPH (Ops) أصفر لحد'), '', 'num', 0.1],
    ['PPH_TARGET', L2('PPH target', 'هدف الـ PPH'), L2('hour by hour, orders per counted picker', 'ساعة بساعة: أوردرات لكل picker محسوب'), 'num', 0.1], ['WARN.pph', L2('PPH amber down to', 'الـ PPH أصفر لحد'), '', 'num', 0.1],
    ['PPH_MIN_PICKS', L2('PPH: orders a picker must start in an hour to count', 'الـ PPH: أقل أوردرات يبدأها الـ picker في الساعة عشان يتحسب'), '', 'num', 1],
    ['DPH_TARGET', L2('DPH target', 'هدف الـ DPH'), L2('hour by hour, orders per counted DA', 'ساعة بساعة: أوردرات لكل DA محسوب'), 'num', 0.1], ['WARN.dph', L2('DPH amber down to', 'الـ DPH أصفر لحد'), '', 'num', 0.1],
    ['DPH_MIN_DELIVERIES', L2('DPH: orders a DA must pick up in an hour to count', 'الـ DPH: أقل أوردرات يعملها الـ DA pickup في الساعة عشان يتحسب'), '', 'num', 1],
    ['AUTO_ASSIGN_TARGET', L2('Auto-assign target (%)', 'هدف الـ Auto-assign (%)'), L2('orders not assigned by hand', 'أوردرات متعملهاش assign بالإيد'), 'num', 0.1], ['WARN.auto', L2('Auto-assign amber down to (%)', 'الـ Auto-assign أصفر لحد (%)'), '', 'num', 0.1],
  ]];
  const _settings = BRAIN_VIEWS.settings;
  BRAIN_VIEWS.settings = function (A, M) {
    SET_GROUPS.splice(0, SET_GROUPS.length, ...ED.settings());
    let h = _settings.call(BRAIN_VIEWS, A, M);
    // the shift-hours and forced-order cards stay in the page (save reads them) but are hidden: they are not team settings
    if (ED.hideCore) h = h.replace('<div class="card"><h2>Shifts</h2>', '<div class="card" style="display:none"><h2>Shifts</h2>').replace('<div class="card"><h2>Forced orders</h2>', '<div class="card" style="display:none"><h2>Forced orders</h2>');
    return trAr(swapNote(h, LT('n_settings')));
  };

  // worst timeslot for one owner ('store' or 'dis'), for the key points
  function worstSlot(X, k) { const by = {}; X.late.filter((r) => ownKey(r) === k).forEach((r) => { by[r.slot] = (by[r.slot] || 0) + 1; }); const w = Object.keys(by).sort((a, b) => by[b] - by[a])[0]; return w == null ? null : { h: slotTxt(+w), n: by[w] }; }

  /* ---------- bindings ---------- */
  function bindWhatIf(main, key, store) {
    const inp = main.querySelectorAll('input[data-lw]'), res = main.querySelector('[data-lwres]');
    const upd = () => {
      const g = Math.max(0, parseInt(main.querySelector('input[data-lw="g"]').value, 10) || 0), b = Math.max(0, parseInt(main.querySelector('input[data-lw="b"]').value, 10) || 0);
      BRAIN_VIEWS[store] = { g, b };
      if (res && LEAD_CALC[key]) res.innerHTML = LEAD_CALC[key](g, b);
    };
    inp.forEach((el) => el.addEventListener('input', upd));
  }
  BIND.l_p90 = function (main) {
    main.querySelectorAll('.seg[data-lp90] button').forEach((b) => b.addEventListener('click', () => { BRAIN_VIEWS._lp90 = b.dataset.v; BRAIN_VIEWS._lw90 = null; UI.render(); }));
    bindWhatIf(main, 'p90', '_lw90');
  };
  BIND.l_eta = function (main) {
    main.querySelectorAll('.seg[data-lef] button').forEach((b) => b.addEventListener('click', () => { BRAIN_VIEWS._lef = b.dataset.v; UI.render(true); }));
    bindWhatIf(main, 'eta', '_lweta');
  };

  const LEAD_CSS = `
  .root header .meta { display: none; }
  .root .page > p.pd { font-size: 15px; }
  ul.lpts { margin: 0; padding-inline-start: 22px; } ul.lpts li { margin: 8px 0; font-size: 15.5px; line-height: 1.6; color: var(--ink) !important; }
  .lwi { display: flex; gap: 24px; flex-wrap: wrap; margin: 4px 0 12px; }
  .lwi label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; color: var(--ink-2) !important; font-size: 13.5px; }
  .lwi input.num { width: 130px; font-size: 18px; font-weight: 700; padding: 8px 10px; }
  p.lres { font-size: 18px; margin: 4px 0; color: var(--ink) !important; } p.lres b { font-size: 22px; }
  aside button { font-size: 15px; padding: 10px 14px; }
  main .btn.primary { background: var(--magenta); border-color: var(--magenta); color: #fff !important; }
  /* right to left (Arabic) */
  .root[dir="rtl"] { font-family: "Noto Sans Arabic", "Segoe UI", "Faro", "Lucky", "Noto Sans", Tahoma, Arial, sans-serif; }
  .root[dir="rtl"] th, .root[dir="rtl"] td { text-align: left; }
  .root[dir="rtl"] th:first-child, .root[dir="rtl"] td:first-child, .root[dir="rtl"] td.l, .root[dir="rtl"] th.l { text-align: right; }
  .root[dir="rtl"] td:first-child, .root[dir="rtl"] th:first-child { left: auto; right: 0; }
  .root[dir="rtl"] aside { border-right: 0; border-left: 1px solid var(--aside-line); }
  .root[dir="rtl"] aside button { text-align: right; }
  .root[dir="rtl"] aside button.on { box-shadow: inset -3px 0 0 var(--aside-on-bar); }
  .root[dir="rtl"] .kpi + .kpi { border-left: 0; border-right: 1px solid var(--rule); }
  .root[dir="rtl"] .note { border-left: 1px solid var(--rule); border-right: 4px solid var(--magenta); }
  .root[dir="rtl"] .seg button { border-right: 0; border-left: 1px solid var(--rule); } .root[dir="rtl"] .seg button:last-child { border-left: 0; }
  .root[dir="rtl"] .thm-menu { right: auto; left: 0; } .root[dir="rtl"] .thm-menu button { text-align: right; }
  .root[dir="rtl"] .thm-menu button.on { box-shadow: inset -3px 0 0 var(--magenta); }
  .root[dir="rtl"] .legend i { margin-right: 0; margin-left: 6px; } .root[dir="rtl"] .st-dot { margin-right: 0; margin-left: 7px; }
  .root[dir="rtl"] svg { direction: ltr; }
  /* mixed Arabic / English: each line takes the direction of its first word, so "ETA late %" and "12 AM – 1 AM" read correctly */
  .root[dir="rtl"] td, .root[dir="rtl"] th, .root[dir="rtl"] .kpi .k, .root[dir="rtl"] .kpi .s, .root[dir="rtl"] .kpi .v, .root[dir="rtl"] aside button, .root[dir="rtl"] h2, .root[dir="rtl"] .pill,
  .root[dir="rtl"] .sub, .root[dir="rtl"] .mini, .root[dir="rtl"] .lwi label, .root[dir="rtl"] .seg button, .root[dir="rtl"] .legend span, .root[dir="rtl"] .tile .k, .root[dir="rtl"] .tile .s { unicode-bidi: plaintext; }
  .root[dir="rtl"] .kpi .k, .root[dir="rtl"] .kpi .s, .root[dir="rtl"] .kpi .v, .root[dir="rtl"] h2, .root[dir="rtl"] .sub, .root[dir="rtl"] .tile .k, .root[dir="rtl"] .tile .s, .root[dir="rtl"] aside button { text-align: right; }
  `;

  /* ================= LEAD EDITION (pickers) ================= */
  /* ------------------------------------------------------------------
   * LEAD BRAIN – the inventory lead's edition (on top of edition_core.js).
   *   KPIs:     KPI scorecard · P90 · ETA late %
   *   Pickers:  Picker shifts · Picking overview · Performance & speed · Longest waits & picks · Timeline & breaks · Basket fairness · Ranking & bonuses
   *   Settings: picker settings only (wait / picking targets, shift grace, breaks, long picks, ranking weights, who gets ranked)
   * ------------------------------------------------------------------ */
  Object.assign(LT_TXT.ar, {
    g_pk: "الـ pickers",
    t_shifts: "شيفتات الـ pickers",
    t_perf: "أداء وسرعة الـ pickers",
    t_timeline: "التايملاين والبريكات",
    t_baskets: "توزيع الأوردرات على الـ pickers",
    d_shifts: "دخّل شيفت وأجازة كل picker. الأوردرات اللي اتعملت برّه الشيفت مش بتتحسب عليه.",
    d_perf: "سرعة كل picker وأداؤه، محسوبة على الأوردرات اللي جوه شيفته بس.",
    d_timeline: "كل أوردر اشتغل عليه كل picker، وأي بريك أو وقت فاضي بين الأوردرات.",
    d_baskets: "مين أخد الأوردرات الكبيرة ومين أخد الصغيرة، بالـ SKUs وبالـ bags، عشان المقارنة تبقى عادلة.",
    kp_worst: "أسوأ timeslot للـ FP: <b>{h}</b> ({n} أوردر متأخر بسبب الـ FP).",
    kp_queue: "أغلب تأخير الـ FP كان إن الأوردر مستني picker ({q})، مش بطء في التجهيز ({s}): مكانش فيه pickers فاضيين كفاية. راجع البريكات وعدد الـ pickers في الساعات دي.",
    kp_slow: "أغلب تأخير الـ FP كان بطء في التجهيز نفسه ({s} أوردر). شوف صفحة أداء وسرعة الـ pickers.",
    br_title: "البريكات والوقت الفاضي",
    br_sub: "أي وقت فاضي {g} دقيقة أو أكتر بين أوردر والتاني جوه الشيفت. \"أوردرات مستنية\" = كام أوردر كانوا مستنيين picker أول ما البريك بدأ.",
    br_start: "بدأ متأخر عن الشيفت",
    br_end: "خلص بدري عن الشيفت",
    br_gap: "وقت فاضي بين أوردرين",
    bag_title: "مين أخد كام bag",
    bag_sub: "عدد الأوردرات لكل picker في كل حجم bags.",
    n_perf: "<b>Sec / SKU</b> = الوقت اللي الـ picker بياخده في كل صنف بالثواني. ده أهم رقم للسرعة لأنه مش بيتأثر بعدد الأوردرات ولا حجمها. <b>Sec / SKU, basket-adjusted</b> = نفس الرقم بعد ما نعدّله حسب حجم الأوردر، عشان الأوردرات الكبيرة طبيعي أسرع في الصنف الواحد. كل ما الرقم يقل يبقى الـ picker أسرع. الأوردرات اللي اتعملت برّه شيفت الـ picker مش بتتحسب عليه. <b>Active hours</b> = الساعات اللي بدأ يجهز فيها أوردر واحد على الأقل، و<b>PPH (Ops)</b> = أوردراته ÷ الـ active hours بتاعته، نفس قاعدة الـ PPH (Ops) بتاع الـ FP. <b>FP late</b> = أوردراته المتأخرة اللي على الـ FP زي صفحة ETA Late Analysis.",
    n_timeline: "كل صف = picker، وكل مستطيل = أوردر من أول ما بدأ لحد ما اتجهز. المسافة الفاضية بين مستطيلين = وقت مكانش الـ picker شغال فيه أوردر (بريك، أو مفيش أوردرات). الشريط اللي فوق = كام أوردر كانوا مستنيين picker. لو فيه أوردرات مستنية والـ picker فاضي، ده لازم يتسأل عليه. عدّي بالماوس على أي مستطيل.",
    n_baskets: "قبل ما تحكم إن picker بطيء: اللي أخد أغلب الأوردرات الكبيرة طبيعي ياخد وقت أطول. قارن الـ seconds per SKU جوه نفس الحجم. المجموعات هي نفس مجموعات صفحة Basket size.",
    t_overview: "نظرة عامة على التجهيز",
    t_queue: "أطول انتظار وأطول تجهيز",
    t_rank: "ترتيب الـ pickers والبونص",
    t_settings: "الإعدادات",
    d_overview: "الطابور والـ pickers طول اليوم: الأوردرات استنت قد إيه لحد ما picker مسكها، والتجهيز أخد قد إيه، كل ساعة.",
    d_queue: "أطول أوردرات استنت picker، وأطول أوردرات أخدت وقت في التجهيز. دول اللي تسأل عليهم بعد أي ساعة وحشة.",
    d_rank: "ترتيب كل picker على يوم أو أسبوع أو شهر: السرعة، التأخير بسبب بطء التجهيز، التواجد والحضور.",
    d_settings: "أهداف الـ KPIs بتاعة الـ FP، وإعدادات الـ pickers: أهداف الانتظار والتجهيز، سماح الشيفت، البريكات وأوزان الترتيب. بتتحفظ على المتصفح ده.",
    ov_wait: "انتظار الأوردر لحد ما picker يمسكه (median)",
    ov_wait_s: "P90 {p} دقيقة · أكبر طابور {q} أوردر الساعة {t}",
    ov_pick: "وقت التجهيز (median)",
    ov_pick_s: "{s} ثانية لكل SKU",
    ov_late: "متأخر بسبب الـ FP",
    ov_late_s: "{q} استنوا picker، {s} تجهيز بطيء",
    ov_orders: "أوردرات اتجهزت",
    ov_orders_s: "{n} picker، {r} picks لكل ساعة picker",
    ov_nc: " · {n} اتجهزوا برّه شيفت صاحب الأكونت",
    ov_skus: "SKUs اتجهزت",
    ov_instore: "الوقت جوه الـ FP (median)",
    ov_instore_s: "من ready لحد packed (انتظار + تجهيز)",
    ov_peak: "أكبر طابور",
    ov_at: "الساعة {t}",
    ov_rec: "Start times متسجلة",
    ov_rec_s: "من الأوردرات",
    ov_rec_none: "مفيش",
    ov_rec_hint: "سيب الكنترول روم مفتوح عشان يتسجل",
    ov_hour: "كل ساعة",
    ov_hour_s: "<b>Avg / max queue</b> = أوردرات مستنية picker. <b>Queue per picker</b> = الضغط اللي كان على كل picker. الأوردرات المتأخرة بسبب الـ FP متقسمة: استنت picker، ولا التجهيز كان بطيء.",
    n_overview: "<b>Wait</b> = من أول ما الأوردر بقى جاهز (اتعمل، أو قبل الـ slot بـ {r} دقيقة للأوردرات الـ Scheduled) لحد ما picker بدأ فيه. <b>Picking time</b> = من البداية لحد packed. {rec}",
    n_ov_rec: "الـ start times متسجلة فعلًا لـ {p} من الأوردرات (الكنترول روم كان مفتوح)، والباقي متقدّر.",
    n_ov_est: "الـ start times متقدّرة. سيب الكنترول روم مفتوح وقت الشيفت عشان السكريبت يسجل الأوقات الحقيقية كل {m} دقايق.",
    n_queue: "القايمتين دول تبصلهم بعد أي ساعة وحشة: أوردرات محدش مسكها لفترة طويلة (مشكلة طابور: مفيش pickers كفاية على الأرض)، وتجهيز أخد وقت أطول بكتير من حجم الأوردر (مشكلة picker: وقف في نص الأوردر، مش لاقي أصناف، أو على الموبايل). الأوردرات الـ Scheduled بتتحسب جاهزة قبل الـ slot بـ {r} دقيقة.",
    n_rank: "الترتيب لـ <b>{label}</b> من <b>{days}</b> يوم متسجل{range}. الـ <b>Score</b> (من 0 لـ 100) بيقارن كل picker بالباقيين على:<br><b>السرعة {w1}</b>: seconds per SKU بعد تعديل حجم الأوردر (كل أوردر بيتقارن بالـ median بتاع الفريق لنفس الحجم، فاللي أخد أوردرات صغيرة مش بيتظلم).<br><b>التأخير بسبب بطء التجهيز {w2}</b>: نسبة أوردراته اللي اتأخرت عشان التجهيز نفسه كان بطيء (التأخير بسبب الطابور{cpx} أو الـ DAs مش بيتحسب عليه).<br><b>التواجد {w3}</b>: نسبة دقايق شيفته اللي كان فيها أوردرات مستنية وهو مش بيجهّز.<br><b>الحضور {w4}</b>: أيام الحضور ÷ أيام الشغل في شيفتات الـ pickers (أو الأيام اللي اشتغلها لو مفيش شيفت).{extra}<br>الأوردرات بتتحسب بس لو اتجهزت جوه شيفت صاحب الأكونت. الأكونتات المعلّمة <b>مش في الترتيب</b> في شيفتات الـ pickers (مستقيلين أو مشتركة) بتظهر بأوردراتها بس مش بتترتب. أي picker أقل من {minO} أوردر أو {minH} ساعات شغل بيظهر بس مش بيترتب. لو فيه أيام ناقصة اضغط <b>كمّل الأيام الناقصة</b>، ولو غيّرت الشيفتات اضغط <b>إعادة الحساب بالشيفتات الحالية</b>.",
    n_rank_w: "<br><b>PPH {w5}</b>، <b>عدد الأوردرات {w6}</b>.",
    n_rank_now: " الـ PPH وعدد الأوردرات <b>ملهمش وزن</b>: لأنهم بيكافئوا اللي أخد الأوردرات الصغيرة أو الساعات الزحمة.",
    n_settings: "التغييرات بتتحفظ على المتصفح ده بس، وبتتطبق على كل صفحات الـ Lead Brain أول ما تضغط <b>حفظ</b> (اليوم المحمّل بيتحسب تاني من غير ريلود). مفيش حاجة هنا بتغيّر أي حاجة في الكنترول روم أو الـ DCM. أهداف الـ KPIs بتتظبط من كارت <b>أهداف الـ KPIs</b>: خليها نفس أرقام الـ FP Brain.",
    n_shifts: "دخّل <b>الشيفت العادي</b> و<b>يوم الأجازة</b> لكل picker مرة واحدة. وفي أي يوم تقدر تغيّر <b>لليوم ده بس</b> (أوفر تايم، بدّل أجازته، روّح بدري). الأوردر بيتحسب على صاحب الأكونت بس لو اتجهز جوه شيفته (± {g} دقيقة) في يوم شغل. الشيفت اللي بيعدّي نص الليل (زي 22 → 7) تابع لليوم اللي بدأ فيه. الـ picker اللي ملوش شيفت بيتحسب عليه كل حاجة. الإعدادات بتتسجل على المتصفح ده.",
  });
  Object.assign(LT_TXT.en, {
    g_pk: "Pickers",
    t_shifts: "Picker shifts",
    t_perf: "Performance & speed",
    t_timeline: "Timeline & breaks",
    t_baskets: "Basket fairness (SKUs & bags)",
    d_shifts: "Enter each picker's shift and day off. Orders picked outside the shift don't count for them.",
    d_perf: "Each picker's speed and performance, counting only orders inside their shift.",
    d_timeline: "Every order each picker worked on, and every break or idle gap between orders.",
    d_baskets: "Who got the big orders and who got the small ones, by SKUs and by bags, so pickers are compared fairly.",
    kp_worst: "Worst timeslot for the FP: <b>{h}</b> ({n} orders late because of the FP).",
    kp_queue: "Most FP lateness was orders waiting for a picker ({q}), not slow picking ({s}): not enough free pickers. Check breaks and how many pickers were on in those hours.",
    kp_slow: "Most FP lateness was slow picking ({s} orders). See Performance & speed.",
    br_title: "Breaks and idle time",
    br_sub: "Every gap of {g}+ min between two orders inside the shift. \"Orders waiting\" = orders waiting for a picker when the break started.",
    br_start: "Started late for the shift",
    br_end: "Finished early for the shift",
    br_gap: "Gap between two orders",
    bag_title: "Who got how many bags",
    bag_sub: "Orders per picker in each bag size.",
    n_perf: "<b>Sec / SKU</b> = the seconds a picker spends on each item: the main speed number, because it doesn't depend on how many orders or how big they were. <b>Sec / SKU, basket-adjusted</b> = the same, adjusted for basket size, since big orders are naturally faster per item. Lower is faster. Orders picked outside the picker's shift don't count for them. <b>Active hours</b> = clock hours in which they started picking at least one order; <b>PPH (Ops)</b> = their orders ÷ their active hours, the same rule as the FP's PPH (Ops). <b>FP late</b> = their late orders the FP owns, as on ETA Late Analysis.",
    n_timeline: "Each row is a picker; each bar is one order from start to packed. The empty space between two bars = time the picker had no order in hand (a break, or no orders). The strip at the top = orders waiting for a picker. Orders waiting while a picker is free should be asked about. Hover any bar.",
    n_baskets: "Before calling a picker slow: whoever got most of the big orders will take longer. Compare seconds per SKU within the same size group (the Basket size groups).",
    t_overview: "Picking overview",
    t_queue: "Longest waits & picks",
    t_rank: "Ranking & bonuses",
    t_settings: "Settings",
    d_overview: "The queue and the pickers through the day: how long orders waited for a picker, how long picking took, hour by hour.",
    d_queue: "The orders that waited longest for a picker and the picks that took longest. The ones to ask about after a bad hour.",
    d_rank: "Each picker's record over a day, week or month, ranked on speed, slow-picking lateness, availability and attendance.",
    d_settings: "Your FP's KPI targets, and picker settings: wait and picking targets, shift grace, breaks and ranking weights. Saved in this browser.",
    ov_wait: "Median wait for a picker",
    ov_wait_s: "P90 {p} min. Peak queue {q} orders at {t}",
    ov_pick: "Median picking time",
    ov_pick_s: "{s} sec per SKU",
    ov_late: "Late because of the FP",
    ov_late_s: "{q} waited for a picker, {s} slow picking",
    ov_orders: "Orders picked",
    ov_orders_s: "{n} pickers, {r} picks per picker hour",
    ov_nc: ". {n} picked outside the account owner's shift",
    ov_skus: "SKUs picked",
    ov_instore: "Median time in the FP",
    ov_instore_s: "Ready to packed (wait + picking)",
    ov_peak: "Peak queue",
    ov_at: "at {t}",
    ov_rec: "Start times recorded",
    ov_rec_s: "of orders",
    ov_rec_none: "None",
    ov_rec_hint: "Keep the Control Room open to record",
    ov_hour: "Hour by hour",
    ov_hour_s: "<b>Avg / max queue</b> = orders waiting for a picker. <b>Queue per picker</b> shows the pressure each picker was under. In-FP late orders are split into waiting for a picker vs slow picking.",
    n_settings: "Changes are saved in this browser only and apply to every page of the Lead Brain as soon as you press <b>Save</b> (the loaded day is re-analysed, no reload needed). Nothing here changes anything in the Control Room or DCM. Set your FP's KPI targets under <b>KPI targets</b>: use the same numbers as the FP Brain.",
    n_shifts: "Set each picker's <b>usual shift</b> and <b>day off</b> once; on any day you can change <b>that day only</b> (overtime, swapped day off, sent home). An order counts for the account owner only if it was packed inside their shift (± {g} min) on a working day. A shift that runs past midnight (e.g. 22 → 7) belongs to the day it starts. Pickers with no shift count everything. Saved in this browser.",
  });
  AR_UI.push(
    ['<h2>Picker performance</h2>', '<h2>أداء الـ pickers</h2>'], ['<h2>Picker timeline</h2>', '<h2>تايملاين الـ pickers</h2>'],
    ['<h2>Who picked which basket sizes</h2>', '<h2>مين أخد أنهي حجم أوردرات (SKUs)</h2>'], ['<h2>Seconds per SKU by basket size</h2>', '<h2>Seconds per SKU لكل حجم أوردر</h2>'], ['<h2>Team picking time by basket size</h2>', '<h2>وقت التجهيز للفريق لكل حجم أوردر</h2>'],
    ['Median seconds per SKU for each picker in each band.', 'متوسط الـ seconds per SKU لكل picker في كل حجم.'],
    [/<p class="sub">(\d+) accounts packed orders on this date, fastest first\. Click a column to sort\.<\/p>/, '<p class="sub">$1 أكونت جهّزوا أوردرات اليوم ده، الأسرع الأول. اضغط على أي عمود عشان ترتّب.</p>'],
    [/<p class="sub">One row per picker; each bar is one order[^<]*<\/p>/, ''],
    [/<h2>Scheduled today but no picks in their shift · (\d+)<\/h2>/, '<h2>عندهم شيفت النهارده ومجهزوش ولا أوردر جوه الشيفت · $1</h2>'],
    ['On shift according to Picker shifts, but no order on their account was packed inside the shift. Absent, or picking on someone else\'s account. Counts as a missed day for attendance.', 'ليهم شيفت في شيفتات الـ pickers، بس مفيش ولا أوردر على الأكونت بتاعهم اتجهز جوه الشيفت: غايب، أو بيشتغل على أكونت حد تاني.'],
    ['<i style="background:#1393CD"></i>Order picked', '<i style="background:#1393CD"></i>أوردر اتجهز'], ['Long picking time</span>', 'وقت تجهيز طويل</span>'], ['Late because of the FP</span>', 'متأخر بسبب الـ FP</span>'], ['Orders waiting in the queue</span>', 'أوردرات مستنية picker</span>'],
    ['class="nm">Orders waiting</text>', 'class="nm">مستني picker</text>'],
    [/<span class="mini">last picked ([^<]*)<\/span>/g, '<span class="mini">آخر تجهيز $1</span>'], [/ orders, <span class="pill warn">(\d+) not counted<\/span>/g, ' أوردر، <span class="pill warn">$1 مش محسوبين</span>'], [/<b>(\d+)<\/b> orders<br>/g, '<b>$1</b> أوردر<br>'],
    [/<span class="mini">picked ([^<·]*)( · counted shift ([^<]*))?<\/span>/g, (m, a, b, c) => '<span class="mini">جهّز ' + a + (c ? ' · الشيفت المحسوب ' + c : '') + '</span>'],
    [/<h2>Orders not counted for the account owner · (\d+)<\/h2>/, '<h2>أوردرات مش محسوبة على صاحب الأكونت · $1</h2>'],
    ['Packed outside the owner\'s shift or on their day off: most likely a packaging lead or a new hire on that account. They stay in the FP\'s queue, lateness and picking-time numbers.', 'اتجهزت برّه شيفت صاحب الأكونت أو في يوم أجازته: غالبًا packaging lead أو picker جديد شغال على الأكونت ده. بتفضل محسوبة في أرقام الـ FP.'],
    [/<p class="muted">No picker accounts yet\.[^<]*<\/p>/, '<p class="muted">لسه مفيش أكونتات pickers. حمّل يوم من الكنترول روم واضغط تحديث.</p>'],
    // queue charts (overview)
    ['<h2>Queue and pickers through the day</h2>', '<h2>الطابور والـ pickers طول اليوم</h2>'],
    [/<p class="sub">Two charts on the same clock[^<]*<\/p>/, '<p class="sub">رسمتين على نفس الساعة، كل 15 دقيقة (عدّي بالماوس عشان تشوف الأرقام). لما الخط اللي فوق يعلى والخط اللي تحت ثابت، يبقى فيه أوردرات مستنية ومفيش picker فاضي ياخدها.</p>'],
    ['>Orders waiting for a picker</b> (average per 15 min)', '>أوردرات مستنية picker</b> (متوسط كل 15 دقيقة)'], ['>Pickers busy</b> (with an order in hand)', '>pickers شغالين</b> (ماسكين أوردر)'],
    [/Orders waiting: ([\d.]+) on average \(max (\d+)\)/g, 'أوردرات مستنية: $1 في المتوسط (أقصى $2)'], [/Pickers busy: /g, 'pickers شغالين: '],
    // longest waits & picks
    ['<h2>Orders that waited longest for a picker</h2><p class="sub">Top 40.</p>', '<h2>الأوردرات اللي استنت picker أطول وقت</h2><p class="sub">أعلى 40.</p>'],
    [/<h2>Longest picks<\/h2><p class="sub">Over (\d+) min, or over (\d+) sec per SKU\. Top 40\.[^<]*<\/p>/, (m, a, b) => '<h2>أطول تجهيز</h2><p class="sub">أكتر من ' + a + ' دقيقة، أو أكتر من ' + b + ' ثانية لكل SKU. أعلى 40. التجهيز الطويل لأوردر صغير غالبًا معناه إن الـ picker وقف في النص أو مش لاقي أصناف.' + (CFG.SHOW_COFFEE !== false ? ' لو الأوردر فيه قهوة، شوف هل الـ picker كان مستني الباريستا.' : '') + '</p>'],
    ['<div class="k">Pickers ranked</div>', '<div class="k">pickers في الترتيب</div>'], [/(\d+) not ranked \(too few orders or hours, or excluded\)/, '$1 مش في الترتيب (أوردرات أو ساعات قليلة، أو مستبعدين)'],
    ['<div class="k">Team sec / SKU</div>', '<div class="k">Sec / SKU للفريق</div>'], ['median, basket-adjusted reference', 'median بعد تعديل حجم الأوردر'],
    ['<div class="k">Orders picked</div>', '<div class="k">أوردرات اتجهزت</div>'], [/(\d+) more outside the owner's shift, not counted/, '$1 كمان برّه شيفت صاحب الأكونت، مش محسوبين'],
    ['<div class="k">Late from slow picking</div>', '<div class="k">متأخر بسبب بطء التجهيز</div>'], ['>of orders picked<', '>من الأوردرات اللي اتجهزت<'],
    [/<h2>Picker ranking<\/h2><p class="sub">[^<]*<\/p>/, '<h2>ترتيب الـ pickers</h2><p class="sub">اضغط على أي عمود عشان ترتّب. اضغط على اسم الـ picker عشان تشوف أداؤه يوم بيوم. عدّي بالماوس على الـ Score عشان تشوف تفاصيله.</p>'],
    ['<p class="sub">Seconds per SKU (basket-adjusted) by day. Lower is faster. Dashed line = their average for the period.</p>', '<p class="sub">الـ Seconds per SKU (بعد تعديل حجم الأوردر) كل يوم. كل ما يقل يبقى أسرع. الخط المتقطع = متوسطه في الفترة دي.</p>'],
  );
  /* ---------- pickers ---------- */
  BRAIN_VIEWS.l_perf = (A) => trAr(swapNote(PK_VIEWS.pickers(A), LT('n_perf')));
  BRAIN_VIEWS.l_timeline = function (A) {
    const P = A.pk;
    let h = trAr(swapNote(PK_VIEWS.timeline(A), LT('n_timeline')));
    const G = CFG.IDLE_GAP_MIN, t0 = P.dayStart, t1 = t0 + 24 * 3600000, out = [];
    const waitingAt = (t) => { const c = P.grid[Math.max(0, Math.min(P.grid.length - 1, Math.floor((t - t0) / (5 * MIN))))]; return c ? c.waiting : 0; };
    P.list.forEach((p) => {
      const rows = p.rows.slice().sort((a, b) => a.start - b.start);
      for (let i = 1; i < rows.length; i++) {
        const gap = (rows[i].start - rows[i - 1].packed) / MIN;
        if (gap >= G) out.push({ name: p.name, kind: 'br_gap', a: rows[i - 1].packed, b: rows[i].start, m: gap, w: waitingAt(rows[i - 1].packed) });
      }
      const W = p.rosterKey && ROSTER.hasShift(p.rosterKey) ? shiftWindows(p.rosterKey, UI.meta.date).filter((w) => !w.off && w.b > t0 && w.a < t1) : [];
      if (W.length && rows.length) {
        const sStart = Math.max(t0, Math.min(...W.map((w) => w.a))), sEnd = Math.min(t1, Math.max(...W.map((w) => w.b)));
        const lateStart = (rows[0].start - sStart) / MIN, early = (sEnd - rows[rows.length - 1].packed) / MIN;
        if (lateStart >= G) out.push({ name: p.name, kind: 'br_start', a: sStart, b: rows[0].start, m: lateStart, w: waitingAt(sStart) });
        if (early >= G && sEnd <= Date.now()) out.push({ name: p.name, kind: 'br_end', a: rows[rows.length - 1].packed, b: sEnd, m: early, w: waitingAt(rows[rows.length - 1].packed) });
      }
    });
    out.sort((a, b) => b.m - a.m);
    h += card(LT('br_title') + ' · ' + out.length, LT('br_sub', { g: G }), out.length ? table([
      ['Picker', (r) => r.name, (r) => '<b>' + esc(r.name) + '</b>', 'l'], ['Type', (r) => r.kind, (r) => LT(r.kind), 'l'], ['From', (r) => r.a, (r) => fmtTime(r.a)], ['To', (r) => r.b, (r) => fmtTime(r.b)],
      ['Minutes', (r) => r.m, (r) => '<b>' + Math.round(r.m) + '</b>'], ['Orders waiting', (r) => r.w, (r) => (r.w ? '<b style="color:var(--bad)">' + r.w + '</b>' : '0')],
    ], out) : '<p class="muted">' + LT('none') + '</p>');
    return h;
  };
  BRAIN_VIEWS.l_baskets = function (A) {
    const P = A.pk;
    let h = trAr(swapNote(PK_VIEWS.baskets(A), LT('n_baskets')));
    const BAG_B = [[1, 2], [3, 4], [5, 7], [8, 999]], bl = ([lo, hi]) => (hi === 999 ? lo + '+ bags' : lo + '–' + hi + ' bags');
    const rows = P.list.map((p) => ({ name: p.name, orders: p.orders, bags: p.bags, avg: avg(p.rows.map((r) => r.bags)), c: BAG_B.map((b) => p.rows.filter((r) => r.bags != null && r.bags >= b[0] && r.bags <= b[1]).length) }));
    h += card(LT('bag_title'), LT('bag_sub'), table([['Picker', (r) => r.name, (r) => esc(r.name), 'l'], ['Orders', (r) => r.orders], ['Bags', (r) => r.bags]]
      .concat(BAG_B.map((b, i) => [bl(b), (r) => r.c[i], (r) => (r.c[i] ? r.c[i] + ' <span class="muted">(' + fmtPct(rate(r.c[i], r.orders)) + ')</span>' : '<span class="muted">0</span>')]))
      .concat([['Avg bags', (r) => r.avg, (r) => fmt(r.avg, 1)]]), rows));
    return h;
  };
  const _pkShifts = BRAIN_VIEWS.pk_shifts;
  BRAIN_VIEWS.pk_shifts = (A, M) => trAr(swapNote(_pkShifts(A, M), LT('n_shifts', { g: CFG.PK_SHIFT_GRACE_MIN })));

  // Picking overview: the FP Brain's page, with its text in the lead's language
  BRAIN_VIEWS.l_overview = function (A) {
    const P = A.pk, T = P.team;
    const lvl = (v, a, b) => (v == null ? null : v <= a ? 'good' : v <= b ? 'warn' : 'bad');
    let h = '<div class="kpis">' +
      bigKpi(LT('ov_wait'), fmt(T.medWait, 1), 'min', LT('ov_wait_s', { p: fmt(T.p90Wait, 0), q: T.peakQueue, t: fmtTime(T.peakQueueAt) }), lvl(T.medWait, CFG.WAIT_TARGET_MIN, CFG.WAIT_TARGET_MIN * 2)) +
      bigKpi(LT('ov_pick'), fmt(T.medHandle, 1), 'min', LT('ov_pick_s', { s: fmt(T.secPerSku, 0) }), lvl(T.medHandle, CFG.HANDLE_TARGET_MIN, CFG.HANDLE_TARGET_MIN * 1.5)) +
      bigKpi(LT('ov_late'), T.storeLate, '', LT('ov_late_s', { q: T.queueLate, s: T.slowLate }), null) +
      bigKpi(LT('ov_orders'), T.orders.toLocaleString('en-US'), '', LT('ov_orders_s', { n: T.pickers, r: fmt(T.perPickerHour, 1) }) + (T.notCounted ? LT('ov_nc', { n: T.notCounted }) : ''), null) + '</div>';
    h += '<div class="tiles">' + tile(LT('ov_skus'), T.skus.toLocaleString('en-US'), '') + tile(LT('ov_instore'), fmt(T.medInStore, 1) + '<span class="u">min</span>', LT('ov_instore_s')) +
      tile(LT('ov_peak'), T.peakQueue, T.peakQueueAt ? LT('ov_at', { t: fmtTime(T.peakQueueAt) }) : '') +
      tile(LT('ov_rec'), T.recorded ? fmtPct(T.recordedShare) : LT('ov_rec_none'), T.recorded ? LT('ov_rec_s') : LT('ov_rec_hint')) + '</div>';
    h += isAr() ? '<div class="note">' + LT('n_overview', { r: CFG.SCHED_READY_MIN, rec: T.recorded ? LT('n_ov_rec', { p: fmtPct(T.recordedShare) }) : LT('n_ov_est', { m: CFG.POLL_MIN }) }) + '</div>' : modelNote(P);
    h += trAr(queueCharts(P));
    h += card(LT('ov_hour'), LT('ov_hour_s'), table([
      ['Hour', (r) => r.h, (r) => esc(r.label), 'l'], ['Orders ready', (r) => r.ready], ['Orders packed', (r) => r.packed], ['SKUs', (r) => r.skus], ['Pickers', (r) => r.pickers],
      ['Picks / picker', (r) => r.perPicker, (r) => fmt(r.perPicker, 1)], ['Avg queue', (r) => r.avgQueue, (r) => fmt(r.avgQueue, 1)], ['Max queue', (r) => r.maxQueue],
      ['Queue per picker', (r) => (r.avgBusy ? r.avgQueue / r.avgBusy : null), (r) => fmt(r.avgBusy ? r.avgQueue / r.avgBusy : null, 1)],
      ['Median wait', (r) => r.medWait, (r) => minPill(r.medWait, CFG.WAIT_TARGET_MIN, CFG.WAIT_TARGET_MIN * 2)], ['Median picking', (r) => r.medHandle, (r) => minPill(r.medHandle, CFG.HANDLE_TARGET_MIN, CFG.HANDLE_TARGET_MIN * 1.5)],
      ['Sec / SKU', (r) => r.medPerSku, (r) => fmt(r.medPerSku != null ? r.medPerSku * 60 : null, 0)], ['FP late', (r) => r.storeLate], ['Waited for picker', (r) => r.queueLate], ['Slow picking', (r) => r.slowLate],
    ], P.hours.filter((r) => r.packed || r.ready)));
    return h;
  };

  // Longest waits & picks
  BRAIN_VIEWS.l_queue = (A) => { const h = PK_VIEWS.queue(A); return isAr() ? trAr(swapNote(h, LT('n_queue', { r: CFG.SCHED_READY_MIN }))) : h; };

  // Ranking & bonuses: the FP Brain's ranking (Fill missing days, Recalculate, CSV, day-by-day record), text translated
  const _pkRank = KPI_VIEWS.pk_ranking;
  KPI_VIEWS.pk_ranking = function (A, M) {
    const h = _pkRank.call(KPI_VIEWS, A, M);
    if (!isAr()) return h;
    const kind = KPI_VIEWS._period || 'month', P = periodRange(kind, dateKey(M.date)), H = UI.history || loadHistory();
    const days = daysInPK(H, P.from, P.to).map((d) => d.date).sort((a, b) => (dateKey(a) < dateKey(b) ? -1 : 1));
    const W = CFG.PK_RANK_WEIGHTS, ws = (W.secPerSku || 0) + (W.slowLate || 0) + (W.idle || 0) + (W.attendance || 0) + (W.pph || 0) + (W.volume || 0) || 1, wp = (x) => Math.round((100 * (x || 0)) / ws) + '%';
    return rankAr(h, kind, P, LT('n_rank', {
      label: AR_PERIOD[kind] || esc(P.label), days: days.length, range: rankRange(days),
      w1: wp(W.secPerSku), w2: wp(W.slowLate), w3: wp(W.idle), w4: wp(W.attendance),
      cpx: (hasCoffee() ? ' أو القهوة' : '') + (hasPharma() ? ' أو الصيدلية' : ''),
      extra: W.pph || W.volume ? LT('n_rank_w', { w5: wp(W.pph), w6: wp(W.volume) }) : LT('n_rank_now'),
      minO: kind === 'day' ? CFG.RANK_MIN_ORDERS.day : CFG.RANK_MIN_ORDERS.period, minH: kind === 'day' ? CFG.RANK_MIN_HOURS.day : CFG.RANK_MIN_HOURS.period,
    }));
  };

  /* ---------- settings: picker settings only ---------- */
  const LEAD_SET = () => [
    [L2('This FP', 'الـ FP ده'), L2('Off = hidden on every page, and no late order is put on the coffee or the pharmacy.', 'لو مقفول: مش هيظهر في أي صفحة، ومفيش أوردر متأخر هيتحسب على القهوة أو الصيدلية.'), [
      ['SHOW_COFFEE', L2('This FP has coffee', 'الـ FP ده فيه قهوة'), '', 'bool'],
      ['SHOW_PHARMACY', L2('This FP has a pharmacy', 'الـ FP ده فيه صيدلية'), '', 'bool'],
    ]],
    KPI_TARGET_SET(),
    [L2('Pickers', 'الـ pickers'), '', [
      ['WAIT_TARGET_MIN', L2('Max wait for a picker (min)', 'أقصى انتظار لحد ما picker يمسك الأوردر (دقيقة)'), L2('longer waits show amber, then red', 'لو استنى أكتر من كده بيظهر أصفر وبعدين أحمر'), 'num', 1],
      ['HANDLE_TARGET_MIN', L2('Picking time target (min)', 'هدف وقت التجهيز (دقيقة)'), L2('start to packed', 'من البداية لحد packed'), 'num', 1],
      ['SCHED_READY_MIN', L2('Scheduled orders ready (min before slot)', 'الأوردر الـ Scheduled بيبقى جاهز قبل الـ slot بـ (دقيقة)'), '', 'num', 5],
      ['PK_SHIFT_GRACE_MIN', L2('Shift grace (min)', 'سماح الشيفت (دقيقة)'), L2('orders packed this close before or after a picker\'s shift still count for them', 'الأوردرات اللي اتجهزت قبل الشيفت أو بعده بالمدة دي لسه بتتحسب على الـ picker'), 'num', 5],
      ['IDLE_GAP_MIN', L2('Break / idle gap from (min)', 'البريك أو الوقت الفاضي من (دقيقة)'), L2('a gap this long between two orders shows on Timeline & breaks', 'أي وقت فاضي بالطول ده بين أوردرين بيظهر في التايملاين والبريكات'), 'num', 1],
      ['LONG_HANDLING_MIN', L2('Long pick over (min)', 'تجهيز طويل لو أكتر من (دقيقة)'), L2('shown on Longest waits & picks and the timeline', 'بيظهر في أطول انتظار وتجهيز وفي التايملاين'), 'num', 1],
    ]],
    [L2('Picker ranking weights', 'أوزان ترتيب الـ pickers'), L2('Relative weights; they don\'t need to add up to 1. 0 = not used.', 'أوزان نسبية، مش لازم مجموعها يبقى 1. صفر = مش مستخدم.'), [
      ['PK_RANK_WEIGHTS.secPerSku', L2('Speed: seconds per SKU, basket-adjusted', 'السرعة: seconds per SKU بعد تعديل حجم الأوردر'), '', 'num', 0.05],
      ['PK_RANK_WEIGHTS.slowLate', L2('Late orders from slow picking', 'أوردرات متأخرة بسبب بطء التجهيز'), '', 'num', 0.05],
      ['PK_RANK_WEIGHTS.idle', L2('Availability: idle while orders waited', 'التواجد: فاضي وفيه أوردرات مستنية'), '', 'num', 0.05],
      ['PK_RANK_WEIGHTS.attendance', L2('Attendance: days present ÷ scheduled', 'الحضور: أيام الحضور ÷ أيام الشغل'), '', 'num', 0.05],
      ['PK_RANK_WEIGHTS.pph', L2('PPH (Ops)', 'PPH (Ops)'), L2('rewards whoever got small baskets or busy hours', 'بيكافئ اللي أخد أوردرات صغيرة أو ساعات زحمة'), 'num', 0.05],
      ['PK_RANK_WEIGHTS.volume', L2('Number of orders', 'عدد الأوردرات'), L2('same problem as picks per hour', 'نفس مشكلة الـ Picks / hr'), 'num', 0.05],
    ]],
    [L2('Who gets ranked', 'مين يدخل الترتيب'), L2('Pickers below these are listed but not ranked.', 'الـ picker اللي أقل من كده بيظهر بس مش بيترتب.'), [
      ['RANK_MIN_ORDERS.day', L2('Min orders, one day', 'أقل عدد أوردرات، يوم واحد'), '', 'num', 1],
      ['RANK_MIN_HOURS.day', L2('Min active hours, one day', 'أقل ساعات شغل، يوم واحد'), '', 'num', 0.5],
      ['RANK_MIN_ORDERS.period', L2('Min orders, week or month', 'أقل عدد أوردرات، أسبوع أو شهر'), '', 'num', 1],
      ['RANK_MIN_HOURS.period', L2('Min active hours, week or month', 'أقل ساعات شغل، أسبوع أو شهر'), '', 'num', 0.5],
    ]],
  ];

  const ED_LEAD = {
    groups: () => [
      [LT('g_kpi'), [['l_score', LT('t_score')], ['l_p90', LT('t_p90')], ['l_eta', LT('t_eta')]]],
      [LT('g_pk'), [['pk_shifts', LT('t_shifts')], ['l_overview', LT('t_overview')], ['l_perf', LT('t_perf')], ['l_queue', LT('t_queue')], ['l_timeline', LT('t_timeline')], ['l_baskets', LT('t_baskets')], ['pk_ranking', LT('t_rank')]]],
      [LT('g_set'), [['settings', LT('t_settings')]]],
    ],
    desc: { l_score: 'd_score', l_p90: 'd_p90', l_eta: 'd_eta', pk_shifts: 'd_shifts', l_overview: 'd_overview', l_perf: 'd_perf', l_queue: 'd_queue', l_timeline: 'd_timeline', l_baskets: 'd_baskets', pk_ranking: 'd_rank', settings: 'd_settings' },
    settings: LEAD_SET,
    // scorecard key points after "who owns the late orders": the store's worst timeslot, and queue vs slow picking
    keyPoints(A, X) {
      const T = A.pk.team, out = [], w = worstSlot(X, 'store');
      if (w) out.push(LT('kp_worst', w));
      if (T.queueLate + T.slowLate) out.push(T.queueLate >= T.slowLate ? LT('kp_queue', { q: T.queueLate, s: T.slowLate }) : LT('kp_slow', { s: T.slowLate }));
      return out;
    },
    slotCols: () => [
      ['PPH (Ops)', (r) => r.ppho, (r) => kpiPill('ppho', r.ppho)], ['PPH', (r) => r.pph, (r) => kpiPill('pph', r.pph)], ['Pickers active', (r) => r.pkActive], ['Pickers counted', (r) => r.pickersCounted], ['Pickers on ground', (r) => r.pkGround],
      ['DPH', (r) => r.dph, (r) => kpiPill('dph', r.dph)], ['Auto-assign', (r) => r.auto, (r) => kpiPill('auto', r.auto)],
    ],
  };
  /* ================= COORDINATOR EDITION (DAs) ================= */
  /* ------------------------------------------------------------------
   * COORDINATOR BRAIN – the dispatch coordinator's edition (on top of edition_core.js).
   *   KPIs:     KPI scorecard · P90 · ETA late % (opens on dispatch's late orders)
   *   DAs:      DA shifts · Coverage · Performance & speed · Timeline & gaps · Availability · Manual assignments · Ranking & bonuses · Tiers & DCM
   *   Settings: DA settings only (shift grace, gaps, breaks, shelf wait, peak hours, ranking weights, who gets ranked)
   * ------------------------------------------------------------------ */
  Object.assign(LT_TXT.ar, {
    g_da: 'الـ DAs',
    t_dashifts: 'شيفتات الـ DAs', t_cover: 'التغطية كل ساعة', t_daperf: 'أداء وسرعة الـ DAs', t_datl: 'التايملاين والوقت الفاضي', t_avail: 'التواجد والبريكات',
    t_assign: 'الـ Manual assignments', t_darank: 'ترتيب الـ DAs والبونص', t_tiers: 'الـ Tiers والـ DCM', t_settings: 'الإعدادات', settings_btn: '⚙ الإعدادات',
    d_dashifts: 'دخّل شيفت وأجازة كل DA. التوصيلات اللي اتعملت برّه الشيفت مش بتتحسب عليه، والحضور والتواجد بيتقاسوا على الشيفت.',
    d_cover: 'كام DA كانوا موجودين كل ساعة قصاد عدد الأوردرات، وفين الأوردرات استنت DA.',
    d_daperf: 'سرعة كل DA (Ride vs usual)، والوقت اللي كان فاضي فيه والأوردرات مستنية، والتوصيلات والتأخير. محسوبة على التوصيلات اللي جوه شيفته بس.',
    d_datl: 'كل رحلات كل DA طول اليوم، وأي وقت فاضي طويل بين رحلتين وكام أوردر كانوا awaiting pickup ساعتها.',
    d_avail: 'كل DA كان Available أو في رحلة أو Unavailable إمتى، وكل بريك أخده (بيتسجل طول ما الكنترول روم مفتوح).',
    d_assign: 'الأوردرات اللي اتعملت assign بالإيد، مين عملها، وهل ده ساعد ولا لأ.',
    d_darank: 'ترتيب كل DA على يوم أو أسبوع أو شهر: السرعة والحضور والتواجد الأول، وبعدين الـ ride late والـ DPH والتوصيلات.',
    d_tiers: 'الـ Tier بتاع كل DA والأرقام بتاعته من الـ DCM، جنب أرقام النهارده.',
    d_settings: 'أهداف الـ KPIs بتاعة الـ FP، وإعدادات الـ DAs: سماح الشيفت، الوقت الفاضي، البريكات، Awaiting pickup، ساعات الذروة وأوزان الترتيب. بتتحفظ على المتصفح ده.',
    kp_worst_dis: 'أسوأ timeslot للـ Logistics: <b>{h}</b> ({n} أوردر متأخر بسبب الـ Logistics).',
    kp_wait_da: 'أغلب تأخير الـ Logistics كان إن الأوردر اتجهز وفضل awaiting pickup ({w})، مش الـ ride ({r}): مكانش فيه DAs فاضيين كفاية. راجع البريكات وعدد الـ DAs في الساعات دي.',
    kp_road: 'أغلب تأخير الـ Logistics كان على الـ ride ({r} أوردر): الـ DA خرج في الوقت ووصل متأخر. شوف صفحة أداء وسرعة الـ DAs (Ride vs usual) والرحلات اللي فيها أكتر من drop.',
    kp_auto: 'الـ Auto-assign <b>{v}٪</b> (الهدف {t}٪): {m} أوردر اتعملهم assign بالإيد لـ DA تاني{o}. شوف صفحة الـ Manual assignments.', kp_auto_o: '، منهم {o} غيّروا الـ DA اللي السيستم اختاره',
    cv_active: 'DAs شغالين', cv_active_s: '{n} كمان على ليستة الـ FP ومعملوش ولا توصيلة', cv_active_s0: 'DAs عملوا توصيلة واحدة على الأقل',
    cv_dph_s: 'الأوردرات ÷ active hours للـ DAs · الهدف {t} · DPH {d}', cv_eta_s: '{r} late on ride، {w} awaiting pickup',
    cv_over: 'Overrides حقيقية', cv_over_s: '{m} اتعملهم assign بالإيد لـ DA تاني، منهم {o} غيّروا الـ DA اللي السيستم اختاره', cv_over_none: 'الـ assignment history محمّلش',
    cv_del: 'توصيلات', cv_del_s: '{n} رحلة', cv_trip: 'أوردرات في الرحلة', cv_leg: 'وقت الـ ride (median)', cv_leg_s: 'من الـ pickup لحد التسليم', cv_shelf: 'Awaiting pickup (median)', cv_shelf_s: 'من packed لحد الـ pickup',
    cv_auto: 'Auto-assigned', cv_auto_s: '{m} manual (DA تاني)', cv_rec: 'التسجيل', cv_rec_s: 'التواجد اتسجل لليوم ده', cv_rec_none: 'مفيش', cv_rec_hint: 'سيب الكنترول روم مفتوح عشان يتسجل',
    cv_slots: 'الأوردرات في كل timeslot', cv_chart: 'الـ DAs الـ online كل ساعة (متسجل)', cv_chart2: 'الـ DAs out on trips كل ساعة', cv_chart_s: 'قارن بالأوردرات اللي فوق: الساعات اللي الأوردرات فيها بتزيد والـ DAs لأ، هي اللي بييجي منها تأخير "awaiting pickup".',
    cv_hourly: 'التغطية كل ساعة',
    n_rec: 'التواجد لليوم ده اتسجل لمدة <b>{h}</b> ({w}). أي وقت برّه الفترات دي مش معروف.',
    n_norec: 'مفيش تسجيل للتواجد لليوم ده. أوقات الـ DAs هنا جاية من أوردراتهم (من أول pickup لآخر توصيلة). عشان تتسجل الأوقات بالظبط (Available / Unavailable)، سيب الكنترول روم مفتوح: السكريبت بيبص على ليستة الـ DAs Availability كل {m} دقايق.',
    n_avail_none: '<b>لسه مفيش تسجيل لليوم ده.</b> ليستة الـ DAs Availability بتوري اللحظة الحالية بس، فالسكريبت بيسجلها كل {m} دقايق طول ما الكنترول روم مفتوح على المتصفح ده، حتى لو الشاشة دي مقفولة. سيب تاب الكنترول روم مفتوح طول الشيفت والصفحة دي هتتملي. التسجيلات بتفضل {k} يوم.',
    n_daperf: '<b>Active hours</b> = الساعات اللي استلم فيها أوردر واحد على الأقل، و<b>DPH (Ops)</b> = توصيلاته ÷ الـ active hours بتاعته، نفس قاعدة الـ DPH (Ops) بتاع الـ FP. <b>Span</b> = من أول pickup لآخر توصيلة. <b>Ride vs usual</b> = أول drop في كل رحلة (ride مباشر من الـ FP) قصاد الـ ride المعتاد لنفس الـ sub-area النهارده. 100% = المعتاد، وكل ما يقل يبقى أسرع. ده أهم رقم للسرعة لأنه عادل بين المناطق القريبة والبعيدة. ' +
      '<b>Idle while orders waited</b> = من دقايق شيفته اللي كان فيها أوردرات packed مستنية DA، نسبة الوقت اللي مكانش فيه في رحلة (الرجوع للـ FP محسوب رحلة). ' +
      '<b>Gaps</b> = وقت فاضي {g} دقيقة أو أكتر بين رحلة والتانية (بما فيه الرجوع للـ FP). <b>Late on ride (stage)</b> = خرج من الـ FP بوقت أكتر من {h} ووصل متأخر برضه. <b>Lost / gained</b> = أوردرات الـ coordinator شالها من الـ DA ده أو إداهاله. {nc}',
    n_daperf_nc: 'فيه <b>{n} توصيلة</b> اتعملت برّه شيفت الـ DA (أو في يوم أجازته) ومش محسوبة عليه، شوف شيفتات الـ DAs.', n_daperf_set: 'دخّل شيفت كل DA في <b>شيفتات الـ DAs</b> عشان الحضور والتواجد يتقاسوا عليه.',
    dt_title: 'تايملاين اليوم', dt_sub: 'كل صف = DA. كل مستطيل = رحلة (من الـ pickup لآخر توصيلة)، عدّي بالماوس عليه. الخط الرفيع تحت كل صف = الحالة المتسجلة لو موجودة. الأعمدة المضللة = ساعات الذروة.',
    gp_title: 'الوقت الفاضي الطويل', gp_sub: 'أي وقت {g} دقيقة أو أكتر بين رحلة والتانية (بما فيه الرجوع للـ FP)، وبداية متأخرة أو نهاية بدري عن الشيفت. "أوردرات awaiting pickup" = أكبر عدد أوردرات packed كانت مستنية DA في الوقت ده.',
    gp_gap: 'وقت فاضي بين رحلتين', gp_start: 'بدأ متأخر عن الشيفت', gp_end: 'خلص بدري عن الشيفت',
    n_assign: '<b>Auto-assigned</b> = السيستم اختار الـ DA ومحدش غيّره. <b>Reassigned (same DA)</b> = حد عمل assign تاني بإيده لنفس الـ DA اللي السيستم اختاره (غالبًا بيبني رحلة)، وبيتحسب auto. <b>Manually assigned (different DA)</b> = حد اختار الـ DA بإيده: غيّر الـ DA اللي السيستم اختاره، أو السيستم ماعملش assign خالص. الـ Auto-assign rate = أول اتنين ÷ كل الأوردرات اللي ليها DA.',
    n_darank: 'الترتيب لـ <b>{label}</b> من <b>{days}</b> يوم متسجل{range}. الـ <b>Score</b> (من 0 لـ 100) بيقارن كل DA بالباقيين على:<br>' +
      '<b>السرعة {w1}</b>: أول drop في كل رحلة (ride مباشر من الـ FP) قصاد الـ ride المعتاد لنفس الـ sub-area في اليوم ده. 100% = المعتاد، 90% = أسرع بـ 10%. عادل بين المناطق القريبة والبعيدة. أقل من 5 رحلات في الفترة بياخد درجة في النص (رمادي).<br>' +
      '<b>الحضور {w2}</b>: أيام الحضور ÷ أيام الشغل في شيفتات الـ DAs (أو الأيام اللي اشتغلها لو مفيش شيفت).<br>' +
      '<b>التواجد {w3}</b>: من دقايق شيفته اللي كان فيها أوردرات packed مستنية DA، نسبة الوقت اللي مكانش فيه في رحلة (الرجوع للـ FP محسوب رحلة).<br>' +
      '<b>Late on ride {w4}</b>، <b>DPH {w5}</b>، <b>التوصيلات {w6}</b>. الـ DPH بيتحسب بس في الأيام اللي فيها ساعة شغل أو أكتر. التأخير بسبب الـ FP أو استنى الـ Logistics <b>مش</b> بيتحسب على الـ DA.<br>' +
      'التوصيلات بتتحسب بس لو اتعمل pickup جوه شيفت الـ DA. الـ DAs المعلّمين <b>مش في الترتيب</b> في شيفتات الـ DAs بيظهروا بس مش بيترتبوا، وكمان أي DA أقل من {minD} توصيلة أو {minH} ساعات شغل. لو فيه أيام ناقصة اضغط <b>كمّل الأيام الناقصة</b>، ولو غيّرت الشيفتات اضغط <b>إعادة الحساب بالشيفتات الحالية</b>.',
    n_tiers: 'الـ <b>Tier</b> بيحدد الـ capacity بتاعة كل DA في الـ DCM وأقصى عدد drops في الرحلة في الـ auto-assign. الـ <b>DPI</b> score{w}{b}. الأرقام دي بتاعة الـ DCM نفسه (rolling)، مش بتاعة النهارده. الـ <b>Complaint rate</b> هنا هو بيانات الـ complaints الوحيدة اللي السكريبت شايفها.',
    n_tiers_w: ' بيدّي DPH {dph}٪، late delivery rate {ldr}٪، complaint rate {cr}٪، success rate {sr}٪', n_tiers_b: '. الـ Tiers: {b}',
    n_dashifts: 'دخّل <b>الشيفت العادي</b> و<b>يوم الأجازة</b> لكل DA مرة واحدة. وفي أي يوم تقدر تغيّر <b>لليوم ده بس</b> (أوفر تايم، بدّل أجازته، روّح بدري). الحضور والتواجد في الترتيب بيتقاسوا على الشيفتات دي، والتوصيلة بتتحسب على الـ DA بس لو عمل pickup جوه شيفته (± {g} دقيقة) في يوم شغل. الشيفت اللي بيعدّي نص الليل (زي 22 → 7) تابع لليوم اللي بدأ فيه. الـ DA اللي ملوش شيفت بيتحسب عليه كل حاجة. <b>مش في الترتيب</b> = مستقيلين أو أكونتات مشتركة. الإعدادات بتتسجل على المتصفح ده.',
    n_settings: 'التغييرات بتتحفظ على المتصفح ده بس، وبتتطبق على كل صفحات الـ Coordinator Brain أول ما تضغط <b>حفظ</b> (اليوم المحمّل بيتحسب تاني من غير ريلود). مفيش حاجة هنا بتغيّر أي حاجة في الكنترول روم أو الـ DCM. أهداف الـ KPIs بتتظبط من كارت <b>أهداف الـ KPIs</b>: خليها نفس أرقام الـ FP Brain.',
  });
  Object.assign(LT_TXT.en, {
    g_da: 'DAs',
    t_dashifts: 'DA shifts', t_cover: 'Coverage', t_daperf: 'Performance & speed', t_datl: 'Timeline & gaps', t_avail: 'Availability & breaks',
    t_assign: 'Manual assignments', t_darank: 'Ranking & bonuses', t_tiers: 'Tiers & DCM', t_settings: 'Settings', settings_btn: '⚙ Settings',
    d_dashifts: 'Enter each DA\'s shift and day off. Deliveries outside the shift don\'t count for them, and attendance and availability are measured against it.',
    d_cover: 'How many DAs were out each hour against the orders, and where orders waited for pickup.',
    d_daperf: 'Each DA\'s speed (ride vs usual), time off a trip while orders waited, output and lateness. Only deliveries inside each DA\'s shift count.',
    d_datl: 'Every DA\'s trips across the day, every long gap between two trips, and how many orders were awaiting pickup at the time.',
    d_avail: 'When each DA was available, on a trip or unavailable, and every break (recorded while the Control Room is open).',
    d_assign: 'Which orders were assigned by hand, by whom, and whether it helped.',
    d_darank: 'Each DA\'s record over a day, week or month, ranked on speed, attendance and availability first, then ride lateness, DPH and deliveries.',
    d_tiers: 'Each DA\'s tier and metrics from DCM, next to today\'s numbers.',
    d_settings: 'Your FP\'s KPI targets, and DA settings: shift grace, gaps, breaks, awaiting-pickup time, peak hours and ranking weights. Saved in this browser.',
    kp_worst_dis: 'Worst timeslot for logistics: <b>{h}</b> ({n} orders late because of logistics).',
    kp_wait_da: 'Most logistics lateness was packed orders awaiting pickup for a DA ({w}), not the ride ({r}): not enough free DAs. Check breaks and how many DAs were out in those hours.',
    kp_road: 'Most logistics lateness was on the ride ({r} orders): the DA left in time and arrived late. See Performance & speed (ride vs usual) and trips with several drops.',
    kp_auto: 'Auto-assign <b>{v}%</b> (target {t}%): {m} orders manually assigned to a different DA{o}. See Manual assignments.', kp_auto_o: ', {o} of them replaced the system\'s DA',
    cv_active: 'Active DAs', cv_active_s: '{n} more on the FP list with no deliveries', cv_active_s0: 'DAs with at least one delivery',
    cv_dph_s: 'Orders ÷ DA active hours · target {t} · DPH {d}', cv_eta_s: '{r} late on the ride, {w} awaiting pickup',
    cv_over: 'Real overrides', cv_over_s: '{m} manually assigned to a different DA, {o} of them replaced the system\'s DA', cv_over_none: 'Assignment history not loaded',
    cv_del: 'Deliveries', cv_del_s: '{n} trips', cv_trip: 'Orders per trip', cv_leg: 'Median ride', cv_leg_s: 'DA pickup to delivered', cv_shelf: 'Median awaiting pickup', cv_shelf_s: 'Packed to DA pickup',
    cv_auto: 'Auto-assigned', cv_auto_s: '{m} manual (different DA)', cv_rec: 'Recording', cv_rec_s: 'Availability recorded for this date', cv_rec_none: 'None', cv_rec_hint: 'Keep the Control Room open to record',
    cv_slots: 'Orders per timeslot', cv_chart: 'DAs online per hour (recorded)', cv_chart2: 'DAs out on trips per hour', cv_chart_s: 'Compare with the orders above: hours where orders rise but DAs don\'t are where "awaiting pickup" lateness comes from.',
    cv_hourly: 'Hourly coverage',
    n_rec: 'Availability for this date was recorded for <b>{h}</b> ({w}). Times outside these windows are unknown.',
    n_norec: 'No availability recording for this date. DA times below come from their orders (first pickup to last delivery). To record exact available / unavailable times, keep the Control Room open; the script checks the DAs Availability list every {m} minutes.',
    n_daperf: '<b>Active hours</b> = clock hours in which they picked up at least one order; <b>DPH (Ops)</b> = their deliveries ÷ their active hours, the same rule as the FP\'s DPH (Ops). <b>Span</b> = first pickup to last delivery. <b>Ride vs usual</b> = the first drop of each trip (a direct ride from the FP) against the usual ride to that sub-area today. 100% = usual; lower is faster. The main speed number, fair across near and far sub-areas. ' +
      '<b>Idle while orders waited</b> = of the minutes in their shift when packed orders were awaiting pickup, the share they were not on a trip (the ride back counts as a trip). ' +
      '<b>Gaps</b> = {g}+ min between one trip ending and the next starting (includes the ride back). <b>Late on ride (stage)</b> = left the FP with more time than {h} and still arrived late. <b>Lost / gained</b> = orders the coordinator moved away from / to this DA. {nc}',
    n_daperf_nc: '<b>{n} deliveries</b> were picked up outside the DA\'s shift (or on their day off) and are not counted for them; see DA shifts.', n_daperf_set: 'Set each DA\'s shift on <b>DA shifts</b> so attendance and availability are measured against it.',
    dt_title: 'Day timeline', dt_sub: 'One row per DA. Bars are trips (pickup to last delivery); hover a bar for details. The thin line under each row is the recorded status, when available. Shaded columns are peak hours.',
    gp_title: 'Long gaps', gp_sub: 'Every gap of {g}+ min between two trips (includes the ride back to the FP), and late starts or early finishes against the shift. "Orders awaiting pickup" = the most packed orders awaiting pickup during that time.',
    gp_gap: 'Gap between two trips', gp_start: 'Started late for the shift', gp_end: 'Finished early for the shift',
    n_settings: 'Changes are saved in this browser only and apply to every page of the Coordinator Brain as soon as you press <b>Save</b> (the loaded day is re-analysed, no reload needed). Nothing here changes anything in the Control Room or DCM. Set your FP\'s KPI targets under <b>KPI targets</b>: use the same numbers as the FP Brain.',
  });
  AR_UI.push(
    // DA shifts
    ['<h2>DA shifts</h2>', '<h2>شيفتات الـ DAs</h2>'], ['<div class="k">DA accounts</div>', '<div class="k">أكونتات الـ DAs</div>'],
    [/<span class="mini">last delivered ([^<]*)<\/span>/g, '<span class="mini">آخر توصيل $1</span>'], [/ deliveries, <span class="pill warn">(\d+) not counted<\/span>/g, ' توصيلة، <span class="pill warn">$1 مش محسوبين</span>'], [/<b>(\d+)<\/b> deliveries<br>/g, '<b>$1</b> توصيلة<br>'],
    [/<span class="mini">delivered ([^<·]*)( · counted shift ([^<]*))?<\/span>/g, (m, a, b, c) => '<span class="mini">وصّل ' + a + (c ? ' · الشيفت المحسوب ' + c : '') + '</span>'],
    [/<h2>Deliveries not counted for the DA · (\d+)<\/h2>/, '<h2>توصيلات مش محسوبة على الـ DA · $1</h2>'],
    [/<p class="sub">Picked up outside the DA's shift[^<]*<\/p>/, '<p class="sub">اتعمل pickup برّه شيفت الـ DA أو في يوم أجازته (أوفر تايم متدخلش، أو حد تاني على الأكونت). بتفضل محسوبة في أرقام المخزن.</p>'],
    [/<p class="muted">No DA accounts yet\.[^<]*<\/p>/, '<p class="muted">لسه مفيش أكونتات DAs. حمّل يوم من الكنترول روم واضغط تحديث.</p>'],
    // coverage
    ['</i>Delivered on time</span>', '</i>اتسلم في الوقت</span>'], ['</i>Delivered late</span>', '</i>اتسلم متأخر</span>'], ['</i>Not received / still open</span>', '</i>متسلمش / لسه مفتوح</span>'],
    ['</i>On a trip</span>', '</i>في رحلة</span>'], ['</i>Locked</span>', '</i>Locked</span>'], ['</i>Available, waiting</span>', '</i>Available، مستني</span>'], ['</i>DAs with a trip in this hour</span>', '</i>DAs عندهم رحلة في الساعة دي</span>'],
    // performance
    ['<h2>DA performance</h2>', '<h2>أداء الـ DAs</h2>'], [/<p class="sub">(\d+) DAs delivered orders on this date, fastest first\.<\/p>/, '<p class="sub">$1 DA وصّلوا أوردرات اليوم ده، الأسرع الأول. اضغط على أي عمود عشان ترتّب.</p>'],
    [/<h2>Scheduled today but no deliveries in their shift · (\d+)<\/h2>/, '<h2>عندهم شيفت النهارده ومعملوش ولا توصيلة جوه الشيفت · $1</h2>'],
    ['On shift according to DA shifts, but no delivery was picked up inside the shift. Counts as a missed day for attendance.', 'ليهم شيفت في شيفتات الـ DAs، بس معملوش ولا pickup جوه الشيفت: غايب، أو شغال على أكونت حد تاني. بيتحسب يوم غياب في الحضور.'],
    // timeline
    ['</i>Trip, all on time</span>', '</i>رحلة، كلها في الوقت</span>'], ['</i>Trip with a late order</span>', '</i>رحلة فيها أوردر متأخر</span>'],
    [/<\/i>(On a trip|Locked|Available, waiting|Unavailable) \(recorded\)<\/span>/g, '</i>$1 (متسجل)</span>'], ['</i>Peak hours</span>', '</i>ساعات الذروة</span>'],
    ['<p class="muted">No DA activity on this date.</p>', '<p class="muted">مفيش نشاط للـ DAs في اليوم ده.</p>'],
    // availability
    ['<h2>Availability per DA (recorded)</h2>', '<h2>تواجد كل DA (متسجل)</h2>'],
    [/<p class="sub"><b>Breaks<\/b> = times a DA switched to unavailable between first and last time online\. Peak hours: ([^.]*)\. Breaks of (\d+)\+ min are flagged\.<\/p>/, '<p class="sub"><b>Breaks</b> = المرات اللي الـ DA عمل نفسه unavailable بين أول وآخر مرة كان online. ساعات الذروة: $1. البريك $2 دقيقة أو أكتر بيتعلّم.</p>'],
    ['<h2>Every break</h2><p class="sub">When each DA went unavailable and came back.</p>', '<h2>كل البريكات</h2><p class="sub">كل DA عمل نفسه unavailable إمتى ورجع إمتى.</p>'],
    [/<h2>Right now<\/h2><p class="sub">DAs Availability list as of ([^.]*)\.<\/p>/, '<h2>دلوقتي</h2><p class="sub">ليستة الـ DAs Availability الساعة $1.</p>'],
    ['<p class="muted">No breaks recorded.</p>', '<p class="muted">مفيش بريكات متسجلة.</p>'],
    // manual assignments
    ['Assignment history wasn\'t loaded, so every manual order counts as manually assigned (different DA). Press Refresh to try again.', 'الـ assignment history محمّلش، فكل أوردر manual بيتحسب Manually assigned (different DA). اضغط تحديث وجرّب تاني.'],
    ['<h2>Assignment types</h2>', '<h2>أنواع الـ assignment</h2>'], [/<p class="sub">(\d+) delivered or attempted orders with a DA\. The indented rows split the manual ones\.<\/p>/, '<p class="sub">$1 أوردر اتسلم أو اتحاول يتسلم مع DA. الصفوف اللي تحت بتقسّم الـ manual.</p>'],
    ['↳ replaced the system&#39;s DA', '↳ غيّروا الـ DA اللي السيستم اختاره'], [/>target (\d+(?:\.\d+)?)%</, '>الهدف $1٪<'], ['>Just off target<', '>قريب من الهدف<'], ['>On target<', '>على الهدف<'], ['>Missed<', '>بعيد عن الهدف<'], ['↳ never auto-assigned', '↳ السيستم ماعملش assign'], ['↳ no assignment in the history', '↳ مفيش assignment في الـ history'], ['↳ history not read', '↳ الـ history ماتقراش'],
    [/ replaced<\/span>/g, ' غيّروا الـ DA</span>'], [/>(\d+(?:\.\d)?%) of (\d+) orders with a DA</, '>$1 من $2 أوردر ليهم DA<'], ['· counts as auto', '· بيتحسب auto'],
    [/(\d+) replaced the system's DA, (\d+) never auto-assigned/, '$1 غيّروا الـ DA اللي السيستم اختاره، $2 السيستم ماعملش لهم assign'], ['>history not read<', '>الـ history ماتقراش<'],
    ['<h2>By timeslot</h2>', '<h2>كل timeslot</h2>'], ['<h2>By person assigning</h2>', '<h2>حسب الشخص اللي عمل assign</h2>'],
    ['<h2>Every override</h2><p class="sub">Orders moved by hand from the system\'s DA to a different DA.</p>', '<h2>كل الـ overrides</h2><p class="sub">أوردرات الـ coordinator نقلها من الـ DA اللي السيستم اختاره لـ DA تاني.</p>'],
    ['<p class="muted">No data.</p>', '<p class="muted">مفيش بيانات.</p>'], ['<p class="muted">No manual assignments with history.</p>', '<p class="muted">مفيش manual assignments ليها history.</p>'], ['<p class="muted">No overrides on this date.</p>', '<p class="muted">مفيش overrides في اليوم ده.</p>'],
    // ranking
    ['<div class="k">DAs ranked</div>', '<div class="k">DAs في الترتيب</div>'], [/(\d+) not ranked \(too few deliveries or hours, or excluded\)/, '$1 مش في الترتيب (توصيلات أو ساعات قليلة، أو مستبعدين)'],
    ['<div class="k">Deliveries</div>', '<div class="k">توصيلات</div>'], [/(\d+) more outside the DA's shift, not counted/, '$1 كمان برّه شيفت الـ DA، مش محسوبين'],
    ['<div class="k">Team DPH</div>', '<div class="k">DPH للفريق</div>'], ['deliveries ÷ active hours', 'التوصيلات ÷ ساعات الشغل'], ['<div class="k">Ride late</div>', '<div class="k">Ride late</div>'], ['>of deliveries<', '>من التوصيلات<'],
    [/<h2>DA ranking<\/h2><p class="sub">[^<]*<\/p>/, '<h2>ترتيب الـ DAs</h2><p class="sub">اضغط على أي عمود عشان ترتّب. اضغط على اسم الـ DA عشان تشوف أداؤه يوم بيوم. عدّي بالماوس على الـ Score عشان تشوف تفاصيله.</p>'],
    ['<p class="sub">First-drop ride against the usual ride to that sub-area, by day. 100% = usual; lower is faster.</p>', '<p class="sub">أول drop قصاد الـ ride المعتاد لنفس الـ sub-area، كل يوم. 100% = المعتاد، وكل ما يقل يبقى أسرع.</p>'],
    ['>no deliveries in shift<', '>معملش توصيلات جوه الشيفت<'], [/>usual 100%</, '>المعتاد 100%<'],
    // tiers & DCM
    ['<div class="k">DAs on the FP</div>', '<div class="k">الـ DAs على الـ FP</div>'], ['<div class="k">Overridden</div>', '<div class="k">Overridden</div>'], ['>tier set by hand<', '>الـ tier اتحدد بالإيد<'],
    ['<h2>DA tiers</h2><p class="sub">Sorted by DPI. LDR = late delivery rate.</p>', '<h2>الـ DA tiers</h2><p class="sub">مترتبين بالـ DPI. LDR = late delivery rate.</p>'],
    ['Loading DA tiers from DCM…', 'بيحمّل الـ DA tiers من الـ DCM…'], ['>Try again<', '>جرّب تاني<'], ['Open the DCM page once in this browser, then try again.', 'افتح صفحة الـ DCM مرة على المتصفح ده، وبعدين جرّب تاني.'],
  );

  /* ---------- DA pages ---------- */
  const recNoteLT = (D) => '<div class="note">' + (D.avail ? LT('n_rec', { h: hm(D.avail.recordedMs / MIN), w: D.avail.segs.map(([a, b]) => fmtTime(a) + '–' + fmtTime(b)).join(', ') }) : LT('n_norec', { m: CFG.POLL_MIN })) + '</div>';
  const _daShifts = BRAIN_VIEWS.da_shifts;
  BRAIN_VIEWS.da_shifts = (A, M) => trAr(swapNote(_daShifts(A, M), LT('n_dashifts', { g: CFG.DA_SHIFT_GRACE_MIN })));

  // Coverage: the FP Brain's page, with its text in the coordinator's language
  BRAIN_VIEWS.c_cover = function (A) {
    const D = A.da, T = D.team, d = A.day;
    let h = '<div class="kpis">' +
      bigKpi(LT('cv_active'), T.activeDAs, '', D.list.length - T.activeDAs ? LT('cv_active_s', { n: D.list.length - T.activeDAs }) : LT('cv_active_s0'), null) +
      bigKpi('DPH (Ops)', fmt(T.dpho, 2), '', LT('cv_dph_s', { t: CFG.DPH_OPS_TARGET, d: fmt(T.dph, 2) }), kpiStatus(kpiDef('dpho'), T.dpho)) +
      bigKpi('ETA late %', fmt(d.latePct, 1), '%', LT('cv_eta_s', { r: d.causes['Ride'], w: d.causes['Awaiting pickup'] }), statusOf(d.latePct, CFG.LATE_TARGET_PCT, 2)) +
      bigKpi(LT('cv_over'), T.historyLoaded ? T.overrides : '–', '', T.historyLoaded ? LT('cv_over_s', { m: T.manual, o: T.overrides }) : LT('cv_over_none'), null) + '</div>';
    h += '<div class="tiles">' + tile(LT('cv_del'), T.deliveries, LT('cv_del_s', { n: T.trips })) + tile(LT('cv_trip'), fmt(T.perTrip, 2), '') +
      tile(LT('cv_leg'), fmt(d.medLeg, 1) + '<span class="u">min</span>', LT('cv_leg_s')) + tile(LT('cv_shelf'), fmt(d.medShelf, 1) + '<span class="u">min</span>', LT('cv_shelf_s')) +
      tile(LT('cv_auto'), T.assigned ? fmtPct(rate(T.assigned - T.manual, T.assigned)) : '–', LT('cv_auto_s', { m: T.manual })) +
      tile(LT('cv_rec'), D.avail ? hm(D.avail.recordedMs / MIN) : LT('cv_rec_none'), D.avail ? LT('cv_rec_s') : LT('cv_rec_hint')) + '</div>';
    h += recNoteLT(D);
    h += card(LT('cv_slots'), '', trAr(slotVolumeChart(A)));
    h += card(D.avail ? LT('cv_chart') : LT('cv_chart2'), LT('cv_chart_s'), trAr(coverageChart(D)));
    h += card(LT('cv_hourly'), '', table([
      ['Hour', (r) => r.h, (r) => esc(r.label), 'l'], ['Orders', (r) => r.orders], ['ETA late %', (r) => r.latePct, (r) => latePill(r.latePct)],
      ['DAs out on trips', (r) => r.onRoad], ['Orders per DA', (r) => r.perDa, (r) => fmt(r.perDa, 1)],
      ['DAs online (recorded)', (r) => r.recOnline, (r) => (r.recOnline == null ? '<span class="muted">–</span>' : fmt(r.recOnline, 1))],
      ['Waiting, no order (recorded)', (r) => r.recAvail, (r) => (r.recAvail == null ? '<span class="muted">–</span>' : fmt(r.recAvail, 1))],
      ['Late awaiting pickup (stage)', (r) => r.waited], ['Late on ride (stage)', (r) => r.road],
    ], D.coverage.filter((c) => c.orders || c.onRoad)));
    return h;
  };

  BRAIN_VIEWS.c_perf = function (A) {
    const D = A.da;
    return trAr(swapNote(DA_VIEWS.das(A), LT('n_daperf', { g: CFG.GAP_MIN, h: isAr() ? (CFG.HANDOFF_MODE === 'fixed' ? CFG.HANDOFF_MIN + ' دقيقة' : 'الـ ride المعتاد للـ sub-area بتاعته' + (CFG.HANDOFF_BUFFER_MIN ? ' + ' + CFG.HANDOFF_BUFFER_MIN + ' دقيقة' : '')) : esc(handoffTxt()), nc: D.team.notCounted ? LT('n_daperf_nc', { n: D.team.notCounted }) : LT('n_daperf_set') })));
  };

  // Timeline, plus every long gap between trips and the orders waiting on the shelf meanwhile
  BRAIN_VIEWS.c_timeline = function (A) {
    const D = A.da, G = CFG.GAP_MIN, t0 = D.dayStart, t1 = t0 + 24 * 3600000, out = [];
    let h = recNoteLT(D) + card(LT('dt_title'), LT('dt_sub'), trAr(daTimeline(D)));
    const shelf = A.rows.filter((r) => !r.wasSub && r.packed != null && r.status !== 'cancelled');
    const onShelf = (t) => shelf.filter((r) => r.packed <= t && (r.pickedUp == null ? (r.completed || t1) : r.pickedUp) > t).length;
    const maxShelf = (a, b) => { let m = 0; for (let t = a; t <= b; t += 5 * MIN) m = Math.max(m, onShelf(t)); return m; };
    D.list.forEach((x) => {
      const trips = (x.trips || []).slice().sort((a, b) => a.start - b.start);
      for (let i = 1; i < trips.length; i++) {
        const gap = (trips[i].start - trips[i - 1].end) / MIN;
        if (gap >= G) out.push({ name: x.name, hr: x.hr, kind: 'gp_gap', a: trips[i - 1].end, b: trips[i].start, m: gap, w: maxShelf(trips[i - 1].end, trips[i].start) });
      }
      const W = x.rosterKey && DAROSTER.hasShift(x.rosterKey) ? shiftWindows(x.rosterKey, UI.meta.date, DAROSTER).filter((w) => !w.off && w.b > t0 && w.a < t1) : [];
      if (W.length && trips.length) {
        const sStart = Math.max(t0, Math.min(...W.map((w) => w.a))), sEnd = Math.min(t1, Math.max(...W.map((w) => w.b)));
        const lateStart = (trips[0].start - sStart) / MIN, early = (sEnd - trips[trips.length - 1].end) / MIN;
        if (lateStart >= G) out.push({ name: x.name, hr: x.hr, kind: 'gp_start', a: sStart, b: trips[0].start, m: lateStart, w: maxShelf(sStart, trips[0].start) });
        if (early >= G && sEnd <= Date.now()) out.push({ name: x.name, hr: x.hr, kind: 'gp_end', a: trips[trips.length - 1].end, b: sEnd, m: early, w: maxShelf(trips[trips.length - 1].end, sEnd) });
      }
    });
    out.sort((a, b) => b.w - a.w || b.m - a.m);
    h += card(LT('gp_title') + ' · ' + out.length, LT('gp_sub', { g: G }), out.length ? table([
      ['DA', (r) => r.name, (r) => '<b>' + esc(r.name) + '</b> <span class="muted">' + esc(r.hr || '') + '</span>', 'l'], ['Type', (r) => r.kind, (r) => LT(r.kind), 'l'], ['From', (r) => r.a, (r) => fmtTime(r.a)], ['To', (r) => r.b, (r) => fmtTime(r.b)],
      ['Minutes', (r) => r.m, (r) => '<b>' + Math.round(r.m) + '</b>'], ['Orders awaiting pickup', (r) => r.w, (r) => (r.w ? '<b style="color:var(--bad)">' + r.w + '</b>' : '0')],
    ], out) : '<p class="muted">' + LT('none') + '</p>');
    return h;
  };

  BRAIN_VIEWS.c_avail = function (A, M) {
    const D = A.da, h = DA_VIEWS.avail(A, M);
    return trAr(swapNote(h, D.avail ? LT('n_rec', { h: hm(D.avail.recordedMs / MIN), w: D.avail.segs.map(([a, b]) => fmtTime(a) + '–' + fmtTime(b)).join(', ') }) : LT('n_avail_none', { m: CFG.POLL_MIN, k: CFG.KEEP_DAYS })));
  };
  BRAIN_VIEWS.c_assign = function (A) {
    let h = DA_VIEWS.assign(A);
    if (isAr()) h = h.replace(/<div class="note"><b>Auto-assigned<\/b>[\s\S]*?<\/div>/, '<div class="note">' + LT('n_assign') + '</div>');
    return trAr(h);
  };

  // Ranking & bonuses: the FP Brain's DA ranking (Fill missing days, Recalculate, CSV, day-by-day record), text translated
  const _daRank = KPI_VIEWS.da_ranking;
  KPI_VIEWS.da_ranking = function (A, M) {
    const h = _daRank.call(KPI_VIEWS, A, M);
    if (!isAr()) return h;
    const kind = KPI_VIEWS._period || 'month', P = periodRange(kind, dateKey(M.date)), H = UI.history || loadHistory();
    const days = daysInDA(H, P.from, P.to).map((d) => d.date).sort((a, b) => (dateKey(a) < dateKey(b) ? -1 : 1));
    const W = CFG.DA_RANK_WEIGHTS, ws = ['speed', 'attendance', 'idle', 'roadLate', 'dph', 'volume'].reduce((s, k) => s + (W[k] || 0), 0) || 1, wp = (x) => Math.round((100 * (x || 0)) / ws) + '%';
    return rankAr(h, kind, P, LT('n_darank', {
      label: AR_PERIOD[kind] || esc(P.label), days: days.length, range: rankRange(days),
      w1: wp(W.speed), w2: wp(W.attendance), w3: wp(W.idle), w4: wp(W.roadLate), w5: wp(W.dph), w6: wp(W.volume),
      minD: kind === 'day' ? CFG.RANK_MIN_DELIVERIES.day : CFG.RANK_MIN_DELIVERIES.period, minH: kind === 'day' ? CFG.RANK_MIN_HOURS.day : CFG.RANK_MIN_HOURS.period,
    }));
  };

  // Tiers & DCM (read-only, from DCM)
  const _daTiers = BRAIN_VIEWS.da_tiers;
  BRAIN_VIEWS.da_tiers = function (A, M) {
    const h = _daTiers.call(BRAIN_VIEWS, A, M);
    if (!isAr()) return h;
    const tc = DCM.config && DCM.config.tierConfig, W = tc ? tc.dpiWeights : null, bands = tc ? tc.tiers : null;
    const note = LT('n_tiers', { w: W ? LT('n_tiers_w', { dph: W.dph, ldr: W.ldr, cr: W.cr, sr: W.sr }) : '', b: bands ? LT('n_tiers_b', { b: bands.map((x) => x.code + ' ' + x.label + ' ' + x.minRate + (x.maxRate != null ? '–' + x.maxRate : '+')).join('، ') }) : '' });
    return trAr(h.indexOf('<div class="note">') >= 0 ? swapNote(h, note) : h);
  };

  /* ---------- settings: DA settings only ---------- */
  const COORD_SET = () => [
    [L2('This FP', 'الـ FP ده'), L2('Off = hidden on every page, and no late order is put on the coffee or the pharmacy.', 'لو مقفول: مش هيظهر في أي صفحة، ومفيش أوردر متأخر هيتحسب على القهوة أو الصيدلية.'), [
      ['SHOW_COFFEE', L2('This FP has coffee', 'الـ FP ده فيه قهوة'), '', 'bool'],
      ['SHOW_PHARMACY', L2('This FP has a pharmacy', 'الـ FP ده فيه صيدلية'), '', 'bool'],
    ]],
    KPI_TARGET_SET(),
    [L2('DAs', 'الـ DAs'), '', [
      ['DA_SHIFT_GRACE_MIN', L2('Shift grace (min)', 'سماح الشيفت (دقيقة)'), L2('deliveries picked up this close before or after a DA\'s shift still count for them', 'التوصيلات اللي اتعمل لها pickup قبل الشيفت أو بعده بالمدة دي لسه بتتحسب على الـ DA'), 'num', 5],
      ['GAP_MIN', L2('Long gap between trips from (min)', 'وقت فاضي طويل بين رحلتين من (دقيقة)'), L2('includes the ride back to the FP; shown on Performance and Timeline & gaps', 'بما فيه الرجوع للـ FP، بيظهر في الأداء والتايملاين'), 'num', 5],
      ['BREAK_ALERT_MIN', L2('Long break from (min)', 'بريك طويل من (دقيقة)'), L2('unavailable this long is flagged on Availability', 'لو فضل unavailable المدة دي بيتعلّم في صفحة التواجد'), 'num', 5],
      ['ALERT_SHELF_MIN', L2('Slow awaiting pickup from (min)', 'Awaiting pickup طويل من (دقيقة)'), L2('a packed order waiting this long for a DA shows red in the order tables', 'الأوردر الـ packed لو استنى DA المدة دي بيظهر أحمر في جداول الأوردرات'), 'num', 1],
      ['PEAKS.0.0', L2('Lunch peak from (hour)', 'ذروة الضهر من (ساعة)'), L2('24 h format', 'بنظام 24 ساعة'), 'num', 1], ['PEAKS.0.1', L2('Lunch peak to (hour)', 'ذروة الضهر لحد (ساعة)'), '', 'num', 1],
      ['PEAKS.1.0', L2('Evening peak from (hour)', 'ذروة بالليل من (ساعة)'), L2('used for "unavailable in peak"', 'بتستخدم في "Unavailable in peak"'), 'num', 1], ['PEAKS.1.1', L2('Evening peak to (hour)', 'ذروة بالليل لحد (ساعة)'), '', 'num', 1],
    ]],
    [L2('DA ranking weights', 'أوزان ترتيب الـ DAs'), L2('Relative weights; they don\'t need to add up to 1. 0 = not used.', 'أوزان نسبية، مش لازم مجموعها يبقى 1. صفر = مش مستخدم.'), [
      ['DA_RANK_WEIGHTS.speed', L2('Speed: first-drop ride vs usual', 'السرعة: أول drop قصاد الـ ride المعتاد'), '', 'num', 0.05],
      ['DA_RANK_WEIGHTS.attendance', L2('Attendance: days present ÷ scheduled', 'الحضور: أيام الحضور ÷ أيام الشغل'), '', 'num', 0.05],
      ['DA_RANK_WEIGHTS.idle', L2('Availability: off a trip while orders waited', 'التواجد: مش في رحلة وفيه أوردرات مستنية'), '', 'num', 0.05],
      ['DA_RANK_WEIGHTS.roadLate', L2('Late on the ride', 'Ride late: التأخير في الـ ride'), '', 'num', 0.05],
      ['DA_RANK_WEIGHTS.dph', L2('DPH (Ops)', 'DPH (Ops)'), '', 'num', 0.05],
      ['DA_RANK_WEIGHTS.volume', L2('Number of deliveries', 'عدد التوصيلات'), '', 'num', 0.05],
    ]],
    [L2('Who gets ranked', 'مين يدخل الترتيب'), L2('DAs below these are listed but not ranked.', 'الـ DA اللي أقل من كده بيظهر بس مش بيترتب.'), [
      ['RANK_MIN_DELIVERIES.day', L2('Min deliveries, one day', 'أقل عدد توصيلات، يوم واحد'), '', 'num', 1],
      ['RANK_MIN_HOURS.day', L2('Min active hours, one day', 'أقل ساعات شغل، يوم واحد'), '', 'num', 0.5],
      ['RANK_MIN_DELIVERIES.period', L2('Min deliveries, week or month', 'أقل عدد توصيلات، أسبوع أو شهر'), '', 'num', 1],
      ['RANK_MIN_HOURS.period', L2('Min active hours, week or month', 'أقل ساعات شغل، أسبوع أو شهر'), '', 'num', 0.5],
    ]],
  ];

  const ED_COORD = {
    etaFilter: 'dis',
    groups: () => [
      [LT('g_kpi'), [['l_score', LT('t_score')], ['l_p90', LT('t_p90')], ['l_eta', LT('t_eta')]]],
      [LT('g_da'), [['da_shifts', LT('t_dashifts')], ['c_cover', LT('t_cover')], ['c_perf', LT('t_daperf')], ['c_timeline', LT('t_datl')], ['c_avail', LT('t_avail')], ['c_assign', LT('t_assign')], ['da_ranking', LT('t_darank')], ['da_tiers', LT('t_tiers')]]],
      [LT('g_set'), [['settings', LT('t_settings')]]],
    ],
    desc: { l_score: 'd_score', l_p90: 'd_p90', l_eta: 'd_eta', da_shifts: 'd_dashifts', c_cover: 'd_cover', c_perf: 'd_daperf', c_timeline: 'd_datl', c_avail: 'd_avail', c_assign: 'd_assign', da_ranking: 'd_darank', da_tiers: 'd_tiers', settings: 'd_settings' },
    settings: COORD_SET,
    // scorecard key points after "who owns the late orders": dispatch's worst timeslot, shelf wait vs road, manual assigning
    keyPoints(A, X) {
      const out = [], w = worstSlot(X, 'dis');
      if (w) out.push(LT('kp_worst_dis', w));
      const dis = X.late.filter((r) => ownKey(r) === 'dis'), wa = dis.filter((r) => lateReason(r) === 'Awaiting pickup').length, rd = dis.filter((r) => lateReason(r) === 'Ride').length;
      if (wa + rd) out.push(wa >= rd ? LT('kp_wait_da', { w: wa, r: rd }) : LT('kp_road', { r: rd }));
      const v = A.score.v.auto, T = A.da.team;
      if (v != null && v < CFG.AUTO_ASSIGN_TARGET) out.push(LT('kp_auto', { v: N(v, 1), t: CFG.AUTO_ASSIGN_TARGET, m: T.manual, o: T.historyLoaded && T.overrides ? LT('kp_auto_o', { o: T.overrides }) : '' }));
      return out;
    },
    slotCols: (A) => {
      const cov = (h) => (A.da.coverage || []).find((c) => c.h === h) || {};
      return [
        ['DPH (Ops)', (r) => r.dpho, (r) => kpiPill('dpho', r.dpho)], ['DPH', (r) => r.dph, (r) => kpiPill('dph', r.dph)], ['DAs active', (r) => r.daActive], ['DAs counted', (r) => r.dasCounted], ['DAs on ground', (r) => r.daGround],
        ['Late awaiting pickup (stage)', (r) => cov(r.h).waited, (r) => cov(r.h).waited || 0], ['Late on ride (stage)', (r) => cov(r.h).road, (r) => cov(r.h).road || 0],
        ['Auto-assign', (r) => r.auto, (r) => kpiPill('auto', r.auto)], ['PPH', (r) => r.pph, (r) => kpiPill('pph', r.pph)],
      ];
    },
  };

  /* ==================================================================
   * UNIFIED BRAIN – FP Brain + Lead Brain + Coordinator Brain in ONE dashboard
   *   · Role switcher in the header: All · FP · Lead · Coordinator (each keeps its own menu; All = everything, no duplicates)
   *   · FP Score card: P90 40% · ETA late % 40% · Available status 20% (weights and scales in Settings → FP Score)
   *   · New look: aurora background, glass header, animated cards, count-up numbers, ring gauges, motion off switch
   * ================================================================== */

  /* ---------- text ---------- */
  Object.assign(LT_TXT.ar, {
    t_settings: 'الإعدادات',
    d_settings: 'كل الإعدادات في مكان واحد: أهداف الـ KPIs، الـ FP Score، الـ pickers، الـ DAs، الشيفتات والـ forced orders. بتتحفظ على المتصفح ده.',
    n_settings: 'التغييرات بتتحفظ على المتصفح ده بس، وبتتطبق على كل الصفحات أول ما تضغط <b>حفظ</b>. مفيش حاجة هنا بتغيّر أي حاجة في الكنترول روم أو الـ DCM.',
    t_xscore: 'الـ FP Score', d_xscore: 'سكور واحد من 100 لليوم: الـ P90 بـ 40٪، والـ ETA late % بـ 40٪، والـ Available status بـ 20٪. وفين راحت النقط وإزاي نرجّعها.',
    g_over: 'نظرة عامة', close: '✕',
    t_xorders: 'الأوردرات والسلة', d_xorders: 'عملنا كام أوردر، متوسط حجم السلة، متوسط وإجمالي قيمة الأوردر، ووقت التجهيز: لليوم ولكل شيفت ولكل timeslot.',
  });
  Object.assign(LT_TXT.en, {
    t_settings: 'Settings',
    d_settings: 'Every setting in one place: KPI targets, FP Score, pickers, DAs, shifts and forced orders. Saved in this browser.',
    n_settings: 'Changes are saved in this browser only and apply to every page as soon as you press <b>Save</b>. Nothing here changes anything in the Control Room or the DCM.',
    t_xscore: 'FP Score', d_xscore: 'One score out of 100 for the day: P90 40%, ETA late % 40%, Available status 20%. Where the points went and how to win them back.',
    g_over: 'Overview', close: '✕',
    t_xorders: 'Orders & basket', d_xorders: 'How many orders we did, the average basket size, the average and total order value, and packing time: for the day, each shift and each timeslot.',
  });

  /* ---------- FP Score engine ---------- */
  const NXS = {
    fp() { return (UI.meta && UI.meta.fps && UI.meta.fps[0]) || fpIdFromCapture(); },
    // 100 at `good`, 0 at `zero`, straight line between (works for lower-is-better and higher-is-better)
    lin(v, good, zero) {
      if (v == null || !isFinite(v) || good == null || zero == null) return null;
      if (good === zero) return v === good ? 100 : 0;
      return Math.max(0, Math.min(100, (100 * (v - zero)) / (good - zero)));
    },
    manKey: (fp, dk) => (fp || 'fp') + '|' + dk,
    manual(fp, dk) { const m = PREFS.availManual || {}; const v = m[NXS.manKey(fp, dk)]; return v == null || !isFinite(v) ? null : +v; },
    setManual(fp, dk, v) { PREFS.availManual = Object.assign({}, PREFS.availManual); if (v == null) delete PREFS.availManual[NXS.manKey(fp, dk)]; else PREFS.availManual[NXS.manKey(fp, dk)] = v; savePrefs(); },
    // FP status recorded while a Control Room tab was open (FPSTAT): share of observed time the FP was AVAILABLE
    avail(fp, dk, a, b) {
      const fs = fp ? FPSTAT.load(fp, dk) : null;
      if (!fs || !fs.ev || !fs.ev.length) return null;
      const ev = fs.ev.slice().sort((x, y) => x[0] - y[0]);
      const step = CFG.FP_STATUS_POLL_MIN * MIN, now = Date.now();
      const segs = (fs.seg && fs.seg.length ? fs.seg : [[ev[0][0], fs.last || ev[ev.length - 1][0]]]).map(([s, e]) => [s, Math.min(now, e + step)]);
      a = a == null ? -Infinity : a; b = b == null ? Infinity : b;
      let obs = 0, ok = 0, busy = 0, forced = 0;
      const spans = [];
      ev.forEach((e, i) => {
        const s0 = e[0], s1 = i + 1 < ev.length ? ev[i + 1][0] : Infinity;
        const raw = String(e[1] || ''), isF = raw.slice(-1) === '*', st = raw.replace('*', '');
        if (/^CLOSED/i.test(st)) return;   // outside operating hours: neither for nor against
        segs.forEach(([g0, g1]) => {
          const x0 = Math.max(s0, g0, a), x1 = Math.min(s1, g1, b);
          if (x1 <= x0) return;
          const d = x1 - x0, isOk = st.indexOf('AVAILABLE') === 0;
          obs += d; if (isOk) ok += d; else busy += d; if (isF) forced += d;
          spans.push({ from: x0, to: x1, st, ok: isOk, forced: isF });
        });
      });
      if (!obs) return null;
      spans.sort((x, y) => x.from - y.from);
      return { pct: (100 * ok) / obs, obsMin: obs / MIN, okMin: ok / MIN, busyMin: busy / MIN, forcedMin: forced / MIN, spans };
    },
    combine(p90, eta, av) {
      const W = CFG.SCORE_W || {};
      const parts = [
        { k: 'p90', w: +W.p90 || 0, v: p90, s: NXS.lin(p90, CFG.P90_TARGET_MIN, CFG.SCORE_P90_ZERO), target: CFG.P90_TARGET_MIN, zero: CFG.SCORE_P90_ZERO, unit: 'min', d: 0, goto: 'l_p90' },
        { k: 'eta', w: +W.eta || 0, v: eta, s: NXS.lin(eta, CFG.LATE_TARGET_PCT, CFG.SCORE_ETA_ZERO), target: CFG.LATE_TARGET_PCT, zero: CFG.SCORE_ETA_ZERO, unit: '%', d: 1, goto: 'l_eta' },
        { k: 'avail', w: +W.avail || 0, v: av, s: NXS.lin(av, CFG.AVAIL_TARGET_PCT, CFG.SCORE_AVAIL_ZERO), target: CFG.AVAIL_TARGET_PCT, zero: CFG.SCORE_AVAIL_ZERO, unit: '%', d: 1, goto: null },
      ];
      const wall = parts.reduce((t, p) => t + Math.max(0, p.w), 0);
      const have = parts.filter((p) => p.s != null && p.w > 0), wsum = have.reduce((t, p) => t + p.w, 0);
      parts.forEach((p) => { p.share = wall ? Math.max(0, p.w) / wall : 0; p.pts = p.s == null ? null : p.share * p.s; p.lost = p.s == null ? null : p.share * (100 - p.s); });
      const total = wsum ? have.reduce((t, p) => t + p.w * p.s, 0) / wsum : null;
      return { total, parts, partial: have.length < parts.filter((p) => p.w > 0).length };
    },
    p90Of: (v) => (CFG.SCORE_P90_NOW ? v.p90n : v.p90f != null ? v.p90f : v.p90n),
    day(A) {
      const dk = A.dk || (UI.meta && UI.meta.date), fp = NXS.fp(), ds = dayStartOf(dk);
      const man = NXS.manual(fp, dk), rec = NXS.avail(fp, dk, ds, ds == null ? null : ds + 86400000);
      const av = man != null ? man : rec ? rec.pct : null;
      return Object.assign(NXS.combine(NXS.p90Of(A.score.v), A.score.v.eta, av), { dk, fp, rec, manual: man });
    },
    hours(A) {
      const dk = A.dk, fp = NXS.fp(), ds = dayStartOf(dk);
      return A.score.hours.filter((x) => x.orders).map((x) => {
        const a = ds + x.h * 3600000, rec = NXS.avail(fp, dk, a, a + 3600000);
        const S = NXS.combine(CFG.SCORE_P90_NOW ? x.p90n : x.p90f != null ? x.p90f : x.p90n, x.eta, rec ? rec.pct : null);
        return Object.assign(S, { h: x.h, label: x.label, orders: x.orders });
      });
    },
    trend(days) {
      const H = UI.history || loadHistory(), fps = (UI.meta && UI.meta.fps || []).join(','), fp = NXS.fp();
      return Object.keys(H).filter((k) => k.split('|')[1] === fps).map((k) => H[k]).filter((r) => r && r.kpi && dayStartOf(r.date) != null)
        .sort((a, b) => dayStartOf(a.date) - dayStartOf(b.date)).slice(-(days || 14)).map((r) => {
          const ds = dayStartOf(r.date), man = NXS.manual(fp, r.date), rec = NXS.avail(fp, r.date, ds, ds + 86400000);
          const S = NXS.combine(NXS.p90Of(r.kpi), r.kpi.eta, man != null ? man : rec ? rec.pct : null);
          return Object.assign(S, { date: r.date });
        });
    },
    grade(t) {
      if (t == null) return { c: 'na', l: L2('Not enough data', 'مفيش بيانات كفاية'), g: '–' };
      if (t >= 90) return { c: 'ex', l: L2('Excellent', 'ممتاز'), g: 'A' };
      if (t >= 75) return { c: 'good', l: L2('Good', 'كويس'), g: 'B' };
      if (t >= 60) return { c: 'warn', l: L2('Needs work', 'محتاج شغل'), g: 'C' };
      return { c: 'bad', l: L2('Off track', 'بعيد عن الهدف'), g: 'D' };
    },
    cls: (s) => (s == null ? 'na' : s >= 90 ? 'ex' : s >= 75 ? 'good' : s >= 60 ? 'warn' : 'bad'),
    name: (k) => ({ p90: CFG.SCORE_P90_NOW ? 'P90 NOW' : 'P90 incl. forced', eta: 'ETA late %', avail: L2('Available status', 'Available status') }[k]),
  };

  /* ---------- drawing helpers ---------- */
  const NXD = {
    uid: 0,
    ring(val, size, stroke, cls, inner) {
      const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = val == null ? 0 : Math.max(0, Math.min(100, val)), id = 'nxg' + (++NXD.uid);
      return '<div class="nx-ring ' + cls + '" style="width:' + size + 'px;height:' + size + 'px"><svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">' +
        '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="s1"/><stop offset="1" class="s2"/></linearGradient></defs>' +
        '<circle class="trk" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + stroke + '"/>' +
        '<circle class="arc" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + stroke + '" stroke="url(#' + id + ')" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + c.toFixed(2) + '" data-off="' + (c * (1 - p / 100)).toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
        '</svg><div class="in">' + inner + '</div></div>';
    },
    num: (v, d) => (v == null || !isFinite(v) ? '–' : '<span class="nx-count" data-d="' + (d || 0) + '">' + Number(v).toFixed(d || 0) + '</span>'),
    spark(vals, w, h) {
      const pts = vals.map((v, i) => [vals.length > 1 ? (i * w) / (vals.length - 1) : w / 2, v == null ? null : h - (h * Math.max(0, Math.min(100, v))) / 100]);
      const ok = pts.filter((p) => p[1] != null);
      if (!ok.length) return '';
      const line = ok.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const area = line + ' L' + ok[ok.length - 1][0].toFixed(1) + ' ' + h + ' L' + ok[0][0].toFixed(1) + ' ' + h + ' Z';
      const id = 'nxs' + (++NXD.uid);
      const t75 = h - (h * 75) / 100, t90 = h - (h * 90) / 100;
      return '<svg class="nx-spark" viewBox="-8 -10 ' + (w + 16) + ' ' + (h + 20) + '"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="a1"/><stop offset="1" class="a2"/></linearGradient></defs>' +
        '<line class="ref" x1="0" x2="' + w + '" y1="' + t90 + '" y2="' + t90 + '"/><line class="ref r2" x1="0" x2="' + w + '" y1="' + t75 + '" y2="' + t75 + '"/>' +
        '<path class="area" d="' + area + '" fill="url(#' + id + ')"/><path class="ln" pathLength="1" d="' + line + '"/>' +
        ok.map((p, i) => '<circle class="pt" style="animation-delay:' + (0.6 + i * 0.05).toFixed(2) + 's" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5"/>').join('') + '</svg>';
    },
  };

  /* ---------- Score page ---------- */
  BRAIN_VIEWS.x_score = function (A) {
    CUR_A = A;
    const S = NXS.day(A), G = NXS.grade(S.total);
    const sym = { p90: '⏱', eta: '🎯', avail: '🟢' };
    const val = (p) => (p.v == null ? '–' : fmt(p.v, p.d) + '<span class="u">' + (p.unit === 'min' ? ' min' : '%') + '</span>');
    const tgt = (p) => (p.k === 'avail' ? '≥ ' : '≤ ') + p.target + (p.unit === 'min' ? ' min' : '%');
    let h = '';
    // hero
    h += '<div class="nx-hero ' + G.c + '"><span class="nx-hero-mark"></span>' +
      '<div class="nx-hero-l">' + NXD.ring(S.total, 216, 18, G.c, '<div class="big">' + NXD.num(S.total, 0) + '</div><div class="of">/ 100</div><div class="gr">' + G.g + '</div>') +
      '<div class="nx-verdict"><span class="nx-badge ' + G.c + '">' + G.l + '</span>' + (S.partial ? '<span class="nx-badge na" title="' + esc(L2('A part has no data yet; the score is worked out from the parts that have one', 'فيه جزء لسه ملوش بيانات، والسكور متحسب من الأجزاء اللي ليها بيانات')) + '">' + L2('Partial', 'جزئي') + '</span>' : '') + '</div></div>' +
      '<div class="nx-hero-r"><div class="nx-formula">' + L2('Score', 'السكور') + ' = ' + S.parts.map((p) => '<span class="nx-chip k-' + p.k + '">' + Math.round(p.share * 100) + '% × ' + NXS.name(p.k) + '</span>').join(' + ') + '</div>' +
      '<div class="nx-parts">' + S.parts.map((p, i) => '<div class="nx-part ' + NXS.cls(p.s) + '" style="--i:' + i + '"' + (p.goto ? ' data-goto="' + p.goto + '" role="button" tabindex="0"' : '') + '>' +
        NXD.ring(p.s, 92, 9, NXS.cls(p.s), '<div class="mid">' + NXD.num(p.s, 0) + '</div>') +
        '<div class="nx-pt"><div class="k">' + sym[p.k] + ' ' + NXS.name(p.k) + ' <span class="w">' + Math.round(p.share * 100) + '%</span></div>' +
        '<div class="v">' + val(p) + '</div>' +
        '<div class="s">' + L2('Target', 'الهدف') + ' <bdi>' + tgt(p) + '</bdi> · ' + L2('0 at', 'صفر عند') + ' <bdi>' + p.zero + (p.unit === 'min' ? ' min' : '%') + '</bdi></div>' +
        '<div class="nx-bar"><i style="--w:' + (p.pts == null ? 0 : (p.pts / Math.max(0.0001, p.share)).toFixed(1)) + '%"></i></div>' +
        '<div class="s pts">' + (p.pts == null ? L2('no data yet', 'لسه مفيش بيانات') : '<b>+' + fmt(p.pts, 1) + '</b> ' + L2('pts', 'نقطة') + (p.lost > 0.05 ? ' · <span class="lost">−' + fmt(p.lost, 1) + '</span>' : ' ✓')) + '</div>' +
        '</div></div>').join('') + '</div></div>' + NXV.glance(A) + '</div>';

    // where the points went
    const segs = S.parts.map((p) => '<i class="k-' + p.k + '" style="--w:' + (p.pts == null ? 0 : p.pts.toFixed(2)) + '%" title="' + esc(NXS.name(p.k) + ': +' + fmt(p.pts, 1)) + '"></i>').join('') +
      S.parts.map((p) => '<i class="lost" style="--w:' + (p.lost == null ? 0 : p.lost.toFixed(2)) + '%" title="' + esc(NXS.name(p.k) + ': −' + fmt(p.lost, 1)) + '"></i>').join('');
    const lostTop = S.parts.filter((p) => p.lost > 0.5).sort((a, b) => b.lost - a.lost);
    const tips = lostTop.map((p) => {
      if (p.k === 'p90') return L2('<b>P90</b> is costing <b>' + fmt(p.lost, 1) + ' pts</b>: ' + fmt(p.v, 0) + ' min against ' + p.target + '. Every minute closer to target wins about <b>' + fmt((p.share * 100) / Math.max(1, p.zero - p.target), 1) + ' pts</b>.',
        'الـ <b>P90</b> واكل <b>' + fmt(p.lost, 1) + ' نقطة</b>: ' + fmt(p.v, 0) + ' دقيقة قصاد ' + p.target + '. كل دقيقة أقرب للهدف بترجّع حوالي <b>' + fmt((p.share * 100) / Math.max(1, p.zero - p.target), 1) + ' نقطة</b>.');
      if (p.k === 'eta') return L2('<b>ETA late %</b> is costing <b>' + fmt(p.lost, 1) + ' pts</b>: ' + fmt(p.v, 1) + '% against ' + p.target + '%. Each point of ETA late % wins back about <b>' + fmt((p.share * 100) / Math.max(0.1, p.zero - p.target), 1) + ' pts</b>.',
        'الـ <b>ETA late %</b> واكل <b>' + fmt(p.lost, 1) + ' نقطة</b>: ' + fmt(p.v, 1) + '٪ قصاد ' + p.target + '٪. كل 1٪ أقل بيرجّع حوالي <b>' + fmt((p.share * 100) / Math.max(0.1, p.zero - p.target), 1) + ' نقطة</b>.');
      return L2('<b>Available status</b> is costing <b>' + fmt(p.lost, 1) + ' pts</b>: open ' + fmt(p.v, 1) + '% of the time against ' + p.target + '%. Keep the FP AVAILABLE (not BUSY / forced) in the peaks.',
        'الـ <b>Available status</b> واكل <b>' + fmt(p.lost, 1) + ' نقطة</b>: الـ FP كان AVAILABLE ' + fmt(p.v, 1) + '٪ من الوقت قصاد ' + p.target + '٪. خلّي الـ FP AVAILABLE (مش BUSY أو forced) في الذروة.');
    });
    h += '<div class="grid two">' +
      card(L2('Where the points went', 'النقط راحت فين'), L2('Coloured = points earned by each part, grey = points lost.', 'الملوّن = النقط اللي كل جزء جابها، والرمادي = النقط اللي راحت.'),
        '<div class="nx-stack">' + segs + '</div><div class="nx-legend">' + S.parts.map((p) => '<span><i class="k-' + p.k + '"></i>' + NXS.name(p.k) + ' <b>' + (p.pts == null ? '–' : fmt(p.pts, 1)) + '</b>/' + Math.round(p.share * 100) + '</span>').join('') + '<span><i class="lost"></i>' + L2('Lost', 'راحت') + '</span></div>' +
        (tips.length ? '<ul class="lpts nx-tips">' + tips.map((t) => '<li>' + t + '</li>').join('') + '</ul>' : '<p class="nx-perfect">' + L2('Full marks on every part. 🎉', 'الدرجة النهائية في كل الأجزاء. 🎉') + '</p>')) +
      NXV.availCard(A, S) + '</div>';

    // trend
    const T = NXS.trend(14);
    if (T.length > 1) {
      h += card(L2('Score, last ' + T.length + ' saved days', 'السكور، آخر ' + T.length + ' يوم متسجلين'), L2('Dashed lines: 90 (excellent) and 75 (good). Days are saved each time you load them.', 'الخطوط المتقطعة: 90 (ممتاز) و75 (كويس). الأيام بتتسجل كل ما تحمّلها.'),
        '<div class="nx-trend">' + NXD.spark(T.map((x) => x.total), 1000, 150) + '</div><div class="nx-days">' + T.map((x) => '<span class="' + NXS.cls(x.total) + '" title="' + esc(x.date) + '"><b>' + (x.total == null ? '–' : Math.round(x.total)) + '</b><small>' + esc(x.date.slice(0, 5)) + '</small></span>').join('') + '</div>');
    }
    // by timeslot
    const H = NXS.hours(A);
    const sp = (s) => (s == null ? '<span class="muted">–</span>' : '<span class="nx-sp ' + NXS.cls(s) + '">' + Math.round(s) + '</span>');
    h += card(L2('Score by timeslot', 'السكور في كل timeslot'), L2('The same formula on each timeslot\'s own P90, ETA late % and FP status (recorded hours only).', 'نفس المعادلة على الـ P90 والـ ETA late % وحالة الـ FP في كل timeslot (الساعات المتسجلة بس).'),
      '<div class="nx-heat">' + H.map((x) => '<div class="c ' + NXS.cls(x.total) + '" title="' + esc(x.label + ' · ' + (x.total == null ? '–' : Math.round(x.total))) + '"><b>' + (x.total == null ? '–' : Math.round(x.total)) + '</b><small>' + esc(shortHour(x.h)) + '</small></div>').join('') + '</div>' +
      table([
        ['Timeslot', (r) => r.h, (r) => esc(r.label), 'l'], ['Orders', (r) => r.orders],
        [NXS.name('p90'), (r) => r.parts[0].v, (r) => kpiPill('p90f', r.parts[0].v)], ['P90 pts', (r) => r.parts[0].s, (r) => sp(r.parts[0].s)],
        ['ETA late %', (r) => r.parts[1].v, (r) => kpiPill('eta', r.parts[1].v)], ['ETA pts', (r) => r.parts[1].s, (r) => sp(r.parts[1].s)],
        ['Available %', (r) => r.parts[2].v, (r) => (r.parts[2].v == null ? '<span class="muted">not recorded</span>' : fmt(r.parts[2].v, 0) + '%')], ['Avail pts', (r) => r.parts[2].s, (r) => sp(r.parts[2].s)],
        ['Score', (r) => r.total, (r) => sp(r.total)],
      ], H));
    h += '<div class="note">' + L2('<b>How it works.</b> Each part scores 100 at its target and falls in a straight line to 0 at its "0 at" point (P90 ' + CFG.P90_TARGET_MIN + ' → ' + CFG.SCORE_P90_ZERO + ' min, ETA late ' + CFG.LATE_TARGET_PCT + ' → ' + CFG.SCORE_ETA_ZERO + '%, Available ' + CFG.AVAIL_TARGET_PCT + ' → ' + CFG.SCORE_AVAIL_ZERO + '%). The score is the weighted average. <b>Available status</b> = share of the recorded time the FP was AVAILABLE (BUSY and forced statuses count against it, CLOSED is left out); it is recorded every ' + CFG.FP_STATUS_POLL_MIN + ' min while a Control Room tab is open, or you can type the day\'s figure yourself. Change the weights and scales in <b>Settings → FP Score</b>.',
      '<b>بيتحسب إزاي.</b> كل جزء بياخد 100 عند الهدف، وبينزل بخط مستقيم لحد صفر عند نقطة الصفر (الـ P90 من ' + CFG.P90_TARGET_MIN + ' لـ ' + CFG.SCORE_P90_ZERO + ' دقيقة، الـ ETA late من ' + CFG.LATE_TARGET_PCT + ' لـ ' + CFG.SCORE_ETA_ZERO + '٪، الـ Available من ' + CFG.AVAIL_TARGET_PCT + ' لـ ' + CFG.SCORE_AVAIL_ZERO + '٪). السكور = المتوسط المرجّح. <b>الـ Available status</b> = نسبة الوقت المتسجل اللي الـ FP كان فيه AVAILABLE (الـ BUSY والـ forced بيتحسبوا عليه، والـ CLOSED مش محسوب)، وبيتسجل كل ' + CFG.FP_STATUS_POLL_MIN + ' دقايق طول ما تاب الكنترول روم مفتوح، أو تقدر تكتب رقم اليوم بنفسك. الأوزان والمقاييس من <b>الإعدادات ← FP Score</b>.') + '</div>';
    return h;
  };

  const NXV = {
    availCard(A, S) {
      const R = S.rec, ds = dayStartOf(S.dk);
      let tl = '';
      if (R && R.spans.length) {
        const a0 = Math.min(R.spans[0].from, ds + 6 * 3600000), b0 = Math.max(R.spans[R.spans.length - 1].to, a0 + 3600000), W = b0 - a0;
        tl = '<div class="nx-tl">' + R.spans.map((s) => '<i class="' + (s.ok ? 'ok' : s.forced ? 'fo' : 'bz') + '" style="left:' + ((100 * (s.from - a0)) / W).toFixed(2) + '%;width:' + Math.max(0.3, (100 * (s.to - s.from)) / W).toFixed(2) + '%" title="' + esc(s.st + (s.forced ? ' (forced)' : '') + ' · ' + fmtTime(s.from) + '–' + fmtTime(s.to)) + '"></i>').join('') + '</div>' +
          '<div class="nx-tlax"><span>' + fmtTime(a0) + '</span><span>' + fmtTime(a0 + W / 2) + '</span><span>' + fmtTime(b0) + '</span></div>' +
          '<div class="nx-legend"><span><i class="ok"></i>AVAILABLE</span><span><i class="bz"></i>BUSY</span><span><i class="fo"></i>forced</span></div>' +
          '<div class="tiles">' +
          '<div class="tile"><div class="k">' + L2('Recorded', 'متسجل') + '</div><div class="v">' + hm(R.obsMin) + '</div></div>' +
          '<div class="tile"><div class="k">AVAILABLE</div><div class="v">' + hm(R.okMin) + '</div><div class="s">' + fmt(R.pct, 1) + '%</div></div>' +
          '<div class="tile"><div class="k">BUSY / ' + L2('other', 'غيره') + '</div><div class="v">' + hm(R.busyMin) + '</div>' + (R.forcedMin ? '<div class="s">' + hm(R.forcedMin) + ' forced</div>' : '') + '</div></div>';
      } else tl = '<p class="muted">' + L2('No FP status recorded for this day yet. Keep a Control Room tab open during the shift (it is checked every ' + CFG.FP_STATUS_POLL_MIN + ' min), or type the day\'s figure below.', 'مفيش حالة FP متسجلة لليوم ده لسه. سيب تاب الكنترول روم مفتوح طول الشيفت (بيتشيك كل ' + CFG.FP_STATUS_POLL_MIN + ' دقايق)، أو اكتب رقم اليوم تحت.') + '</p>';
      const man = S.manual;
      return card(L2('Available status', 'الـ Available status') + (man != null ? ' <span class="nx-badge na">' + L2('typed in', 'مكتوب بالإيد') + '</span>' : ''), L2('When the FP was open for NOW orders.', 'إمتى الـ FP كان مفتوح لأوردرات NOW.'),
        tl + '<div class="nx-man"><label>' + L2('Use this day\'s figure instead (%)', 'استخدم رقم اليوم ده بدل كده (%)') + '<input class="txt num" type="number" min="0" max="100" step="0.1" data-nxman value="' + (man != null ? man : '') + '" placeholder="' + (R ? fmt(R.pct, 1) : '–') + '"></label>' +
        '<button class="ghost sm" data-nxman-save>' + L2('Save', 'حفظ') + '</button>' + (man != null ? '<button class="ghost sm" data-nxman-clear>' + L2('Use the recording', 'استخدم التسجيل') + '</button>' : '') + '</div>');
    },
    banner(A) {
      let S; try { S = NXS.day(A); } catch (e) { return ''; }
      const G = NXS.grade(S.total);
      return '<div class="nx-banner ' + G.c + '" data-goto="x_score" role="button" tabindex="0">' + NXD.ring(S.total, 74, 8, G.c, '<div class="mid">' + NXD.num(S.total, 0) + '</div>') +
        '<div class="t"><div class="k">FP Score · <b>' + G.l + '</b> · ' + (function () { const X = nxStats(A.rows); return '<b>' + X.orders + '</b> ' + L2('orders', 'أوردر') + (X.aov != null ? ' · AOV <b>' + nxMoney(X.aov) + '</b> ' + nxCur() : '') + ' · ' + fmt(X.skus, 1) + ' SKUs'; })() + (S.partial ? ' <span class="nx-badge na">' + L2('Partial', 'جزئي') + '</span>' : '') + '</div><div class="ps">' +
        S.parts.map((p) => '<span class="' + NXS.cls(p.s) + '">' + NXS.name(p.k) + ' <b>' + (p.s == null ? '–' : Math.round(p.s)) + '</b><small> × ' + Math.round(p.share * 100) + '%</small></span>').join('') + '</div></div><span class="go">→</span></div>';
    },
  };
  BIND.x_score = function (main) {
    const inp = main.querySelector('[data-nxman]');
    const save = main.querySelector('[data-nxman-save]'), clr = main.querySelector('[data-nxman-clear]');
    const S = UI.data && NXS.day(UI.data);
    if (save && S) save.addEventListener('click', () => { const v = parseFloat(inp.value); NXS.setManual(S.fp, S.dk, isFinite(v) ? Math.max(0, Math.min(100, v)) : null); UI.render(); });
    if (clr && S) clr.addEventListener('click', () => { NXS.setManual(S.fp, S.dk, null); UI.render(); });
  };
  // the score banner on top of both KPI scorecards
  ['l_score'].forEach((k) => { const f = BRAIN_VIEWS[k]; if (f) BRAIN_VIEWS[k] = function (A, M) { return NXV.banner(A) + f.call(this, A, M); }; });
  { const host = typeof KPI_VIEWS.scorecard === 'function' ? KPI_VIEWS : BRAIN_VIEWS.scorecard ? BRAIN_VIEWS : null, f = host && host.scorecard; if (f) host.scorecard = function (A, M) { return NXV.banner(A) + f.call(this, A, M); }; }


  /* ---------- Orders, basket size and order value (v2.2) ---------- */
  // The Control Room order doesn't name its value the same way everywhere: try the usual fields, then products (price × quantity).
  // Settings on the Orders page can point it at an exact field (PREFS.valueField, a dotted path).
  const NX_VAL_KEYS = ['totalPrice', 'total_price', 'orderTotal', 'order_total', 'grandTotal', 'grand_total', 'totalAmount', 'total_amount', 'finalPrice', 'finalTotal', 'netTotal', 'totalAfterDiscount', 'orderValue', 'paymentAmount', 'amountToCollect', 'collectedAmount', 'amount', 'total', 'subTotal', 'subtotal', 'price'];
  const NX_VAL_GROUPS = ['payment', 'pricing', 'invoice', 'summary', 'totals', 'cart', 'bill', 'paymentDetails', 'orderSummary'];
  const NX_VAL = { field: null, seen: 0, found: 0, keys: null };
  function nxNum(v) {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    if (typeof v === 'object') return 'amount' in v ? nxNum(v.amount) : 'value' in v ? nxNum(v.value) : null;
    const n = Number(v); return isFinite(n) && n > 0 && n < 1e7 ? n : null;
  }
  const nxPath = (o, p) => String(p).split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  function nxKeys(o) {
    const out = [], num = (v) => typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v));
    Object.keys(o || {}).forEach((k) => {
      const v = o[k];
      if (num(v)) out.push([k, v]);
      else if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach((k2) => { if (num(v[k2])) out.push([k + '.' + k2, v[k2]]); });
    });
    const money = /price|total|amount|value|cost|paid|collect|egp|sum/i;
    return out.filter(([k]) => !/(^|\.)(id|_id|hrid|hrId|lat|lng|status)$/i.test(k) && !/time|date|ts$|At$/i.test(k)).sort((a, b) => money.test(b[0]) - money.test(a[0])).slice(0, 40);
  }
  function nxOrderValue(o) {
    NX_VAL.seen++;
    if (!NX_VAL.keys) NX_VAL.keys = nxKeys(o);
    const hit = (v, f) => { if (v != null) { NX_VAL.found++; if (!NX_VAL.field) NX_VAL.field = f; } return v; };
    if (PREFS.valueField) return hit(nxNum(nxPath(o, PREFS.valueField)), PREFS.valueField);
    for (const k of NX_VAL_KEYS) { const v = nxNum(o[k]); if (v != null) return hit(v, k); }
    for (const g of NX_VAL_GROUPS) { const x = o[g]; if (x && typeof x === 'object') for (const k of NX_VAL_KEYS) { const v = nxNum(x[k]); if (v != null) return hit(v, g + '.' + k); } }
    if (Array.isArray(o.products) && o.products.length) {
      let sum = 0, ok = false;
      o.products.forEach((p) => {
        const pr = nxNum(p.finalPrice != null ? p.finalPrice : p.price != null ? p.price : p.unitPrice != null ? p.unitPrice : p.sellingPrice != null ? p.sellingPrice : p.salePrice);
        const q = Number(p.actualQuantity != null ? p.actualQuantity : p.quantity != null ? p.quantity : p.qty != null ? p.qty : 1);
        if (pr != null && isFinite(q)) { sum += pr * q; ok = true; }
      });
      if (ok) return hit(sum, 'products: price × quantity');
    }
    return null;
  }
  function nxItems(o) {
    if (!Array.isArray(o.products) || !o.products.length) return null;
    let n = 0, ok = false;
    o.products.forEach((p) => { const q = Number(p.actualQuantity != null ? p.actualQuantity : p.quantity != null ? p.quantity : p.qty); if (isFinite(q) && q > 0) { n += q; ok = true; } });
    return ok ? n : null;
  }
  function nxStats(rows) {
    const main = rows.filter((r) => CFG.INCLUDE_SUBORDERS || !r.subOrder);
    const live = main.filter((r) => !/cancel/i.test(r.status || ''));
    const del = main.filter((r) => r.delivered);
    const nowN = main.filter((r) => !r.scheduled).length;
    const nowDel = del.filter((r) => !r.scheduled), forcedDel = del.filter((r) => r.scheduled && !r.plannedAhead), judged = del.filter((r) => r.late != null);
    const sk = live.map((r) => r.skus).filter((v) => v != null), val = live.map((r) => r.value).filter((v) => v != null);
    return {
      orders: main.length, delivered: del.length, cancelled: main.length - live.length, now: nowN, sched: main.length - nowN, live: live.length,
      skus: avg(sk), bags: avg(live.map((r) => r.bags)), items: avg(live.map((r) => r.items)), large: rate(sk.filter((v) => v >= CFG.LARGE_BASKET_SKUS).length, sk.length),
      aov: avg(val), gmv: val.length ? val.reduce((a, b) => a + b, 0) : null, valued: val.length,
      pack: median(live.filter((r) => !r.scheduled).map((r) => r.prepMin).filter((v) => v != null && v >= 0)),
      pick: median(live.map((r) => r.handleMin).filter((v) => v != null && v >= 0)), wait: median(live.filter((r) => !r.scheduled).map((r) => r.waitMin).filter((v) => v != null && v >= 0)),
      p90: pct((CFG.SCORE_P90_NOW ? nowDel : nowDel.concat(forcedDel)).map((r) => r.deliveryMin), 0.9), eta: rate(judged.filter((r) => r.late).length, judged.length),
    };
  }
  const nxMoney = (v) => (v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-US'));
  const nxCur = () => L2('EGP', 'ج.م');
  const nxPackT = () => CFG.WAIT_TARGET_MIN + CFG.HANDLE_TARGET_MIN;
  const nxPackCls = (v) => (v == null ? 'na' : v <= nxPackT() ? 'good' : v <= nxPackT() + 5 ? 'warn' : 'bad');
  const nxPackPill = (v) => (v == null ? '–' : '<span class="pill ' + nxPackCls(v) + '">' + fmt(v, 1) + '</span>');
  function nxShifts(A) {
    const dk = A.dk, ds = dayStartOf(dk), fp = NXS.fp();
    const main = A.rows;
    return CFG.SHIFTS.map((sh) => {
      const rows = main.filter((r) => inShift(r.slot, sh));
      const X = nxStats(rows);
      const to = sh.to > sh.from ? sh.to : sh.to + 24;
      const rec = ds == null ? null : NXS.avail(fp, dk, ds + sh.from * 3600000, ds + to * 3600000);
      const S = NXS.combine(X.p90, X.eta, rec ? rec.pct : null);
      return Object.assign(X, { name: sh.name, range: shiftRange(sh), score: S.total, partial: S.partial, avail: rec ? rec.pct : null });
    });
  }
  const nxShiftName = (n) => (isAr() ? ({ Night: 'الليل', Morning: 'الصبح', Between: 'البين', Evening: 'المسا' }[n] || n) : n);

  // the day in numbers: one strip used on the FP Score page and the Orders page
  NXV.dayStrip = function (A, link) {
    const X = nxStats(A.rows);
    const t = (k, v, u, sub, cls) => '<div class="kpi nx-k ' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' + v + (u ? '<span class="u">' + u + '</span>' : '') + '</div><div class="s">' + sub + '</div></div>';
    return '<div class="kpis nx-day' + (link ? ' nx-link" data-goto="x_orders" role="button" tabindex="0' : '') + '">' +
      t('🧾 ' + L2('Orders', 'الأوردرات'), NXD.num(X.orders, 0), '', L2(X.delivered + ' delivered · ' + X.cancelled + ' cancelled · ' + X.now + ' NOW / ' + X.sched + ' scheduled', X.delivered + ' اتسلموا · ' + X.cancelled + ' اتلغوا · ' + X.now + ' NOW / ' + X.sched + ' scheduled')) +
      t('🧺 ' + L2('Avg basket size', 'متوسط حجم السلة'), NXD.num(X.skus, 1), ' SKUs', L2('', '') + (X.bags != null ? fmt(X.bags, 1) + ' bags · ' : '') + (X.items != null ? fmt(X.items, 1) + ' items · ' : '') + fmt(X.large, 0) + '% ' + L2('large (' + CFG.LARGE_BASKET_SKUS + '+ SKUs)', 'كبيرة (' + CFG.LARGE_BASKET_SKUS + '+ SKUs)')) +
      t('💳 ' + L2('Avg order value', 'متوسط قيمة الأوردر'), X.aov == null ? '–' : NXD.num(X.aov, 0), X.aov == null ? '' : ' ' + nxCur(), X.aov == null ? L2('Order value not found – see Orders & basket', 'قيمة الأوردر مش لاقيها – شوف صفحة الأوردرات والسلة') : L2('from ' + X.valued + ' orders (not cancelled)', 'من ' + X.valued + ' أوردر (من غير الملغيين)'), X.aov == null ? 'na' : '') +
      t('💰 ' + L2('Total order value', 'إجمالي قيمة الأوردرات'), nxMoney(X.gmv), X.gmv == null ? '' : ' ' + nxCur(), L2('sales of the day (not cancelled)', 'مبيعات اليوم (من غير الملغيين)'), X.gmv == null ? 'na' : '') +
      t('📦 ' + L2('Packing time', 'وقت التجهيز'), NXD.num(X.pack, 1), ' min', L2('placed → packed, NOW median · target ' + nxPackT() + ' · wait ' + fmt(X.wait, 1) + ' + picking ' + fmt(X.pick, 1), 'من الطلب لحد الـ packed، median الـ NOW · الهدف ' + nxPackT() + ' · انتظار ' + fmt(X.wait, 1) + ' + تجهيز ' + fmt(X.pick, 1)), nxPackCls(X.pack)) + '</div>';
  };

  // quick look at the FP: small cards inside the FP Score hero
  NXV.glance = function (A) {
    const X = nxStats(A.rows);
    const g = (ic, k, v, u, sub, cls) => '<div class="nx-g ' + (cls || '') + '" data-goto="x_orders" role="button" tabindex="0"><div class="ic">' + ic + '</div><div class="tx"><div class="k">' + k + '</div><div class="v">' + v + (u ? '<span class="u">' + u + '</span>' : '') + '</div><div class="s">' + sub + '</div></div></div>';
    return '<div class="nx-glance"><div class="nx-gt">' + L2('Quick look at the FP', 'نظرة سريعة على الفرع') + ' <span>→ ' + LT('t_xorders') + '</span></div><div class="nx-gs">' +
      g('🧾', L2('Orders', 'الأوردرات'), NXD.num(X.orders, 0), '', L2(X.delivered + ' delivered · ' + X.cancelled + ' cancelled', X.delivered + ' اتسلموا · ' + X.cancelled + ' اتلغوا')) +
      g('🧺', L2('Avg basket', 'متوسط السلة'), NXD.num(X.skus, 1), ' SKUs', (X.bags != null ? fmt(X.bags, 1) + ' bags · ' : '') + fmt(X.large, 0) + '% ' + L2('large', 'كبيرة')) +
      g('💳', L2('Avg order value', 'متوسط قيمة الأوردر'), X.aov == null ? '–' : NXD.num(X.aov, 0), X.aov == null ? '' : ' ' + nxCur(), X.aov == null ? L2('not found yet', 'لسه مش لاقيها') : L2(X.valued + ' orders', X.valued + ' أوردر'), X.aov == null ? 'na' : '') +
      g('💰', L2('Total value', 'إجمالي القيمة'), nxMoney(X.gmv), X.gmv == null ? '' : ' ' + nxCur(), L2('not cancelled', 'من غير الملغيين'), X.gmv == null ? 'na' : '') +
      g('📦', L2('Packing time', 'وقت التجهيز'), NXD.num(X.pack, 1), ' min', L2('target ' + nxPackT() + ' · picking ' + fmt(X.pick, 1), 'الهدف ' + nxPackT() + ' · تجهيز ' + fmt(X.pick, 1)), 'st ' + nxPackCls(X.pack)) +
      '</div></div>';
  };

  BRAIN_VIEWS.x_orders = function (A) {
    CUR_A = A;
    let h = NXV.dayStrip(A, false);
    // each shift
    const SH = nxShifts(A), maxO = Math.max(1, ...SH.map((x) => x.orders));
    const row = (k, v) => '<div class="r"><span>' + k + '</span><b>' + v + '</b></div>';
    h += '<h3 class="nx-h">' + L2('Each shift', 'كل شيفت') + '</h3><div class="nx-shifts">' + SH.map((x, i) => '<div class="nx-shift ' + NXS.cls(x.score) + (x.orders ? '' : ' empty') + '" style="--i:' + i + '">' +
      '<div class="hd"><div><div class="nm">' + esc(nxShiftName(x.name)) + '</div><div class="rg"><bdi>' + esc(x.range) + '</bdi></div></div>' + NXD.ring(x.score, 66, 7, NXS.cls(x.score), '<div class="mid sm">' + NXD.num(x.score, 0) + '</div>') + '</div>' +
      '<div class="big"><span class="nx-count" data-d="0">' + x.orders + '</span><small> ' + L2('orders', 'أوردر') + '</small></div>' +
      '<div class="nx-bar"><i style="--w:' + ((100 * x.orders) / maxO).toFixed(1) + '%"></i></div>' +
      row(L2('Delivered', 'اتسلموا'), x.delivered + (x.cancelled ? ' <small>· ' + x.cancelled + ' ' + L2('cancelled', 'اتلغوا') + '</small>' : '')) +
      row(L2('Avg basket', 'متوسط السلة'), x.skus == null ? '–' : fmt(x.skus, 1) + ' SKUs' + (x.bags != null ? ' <small>· ' + fmt(x.bags, 1) + ' bags</small>' : '')) +
      row(L2('Avg order value', 'متوسط قيمة الأوردر'), x.aov == null ? '–' : nxMoney(x.aov) + ' <small>' + nxCur() + '</small>') +
      row(L2('Total value', 'إجمالي القيمة'), x.gmv == null ? '–' : nxMoney(x.gmv) + ' <small>' + nxCur() + '</small>') +
      row(L2('Packing time (min)', 'وقت التجهيز (دقيقة)'), nxPackPill(x.pack) + (x.pick != null ? ' <small>· ' + L2('picking', 'تجهيز') + ' ' + fmt(x.pick, 1) + '</small>' : '')) +
      row(NXS.name('p90'), x.p90 == null ? '–' : kpiPill('p90f', x.p90)) +
      row('ETA late %', x.eta == null ? '–' : kpiPill('eta', x.eta)) +
      row('Available', x.avail == null ? '<span class="muted">' + L2('not recorded', 'مش متسجل') + '</span>' : fmt(x.avail, 0) + '%') +
      '</div>').join('') + '</div>';
    // by timeslot
    const by = {}; A.rows.forEach((r) => { if (r.slot != null) (by[r.slot] = by[r.slot] || []).push(r); });
    const slots = Object.keys(by).map((hh) => Object.assign(nxStats(by[hh]), { h: +hh })).filter((x) => x.orders).sort((a, b) => a.h - b.h);
    h += card(L2('By timeslot', 'كل timeslot'), L2('Orders, basket size and order value in each timeslot.', 'الأوردرات وحجم السلة وقيمة الأوردر في كل timeslot.'), table([
      ['Timeslot', (r) => r.h, (r) => esc(slotLabel(r.h)), 'l'], ['Orders', (r) => r.orders], ['Delivered', (r) => r.delivered], ['NOW', (r) => r.now], ['Scheduled', (r) => r.sched],
      ['Avg SKUs', (r) => r.skus, (r) => fmt(r.skus, 1)], ['Avg bags', (r) => r.bags, (r) => fmt(r.bags, 1)], ['Large baskets', (r) => r.large, (r) => fmtPct(r.large)],
      ['Avg order value', (r) => r.aov, (r) => nxMoney(r.aov)], ['Total value', (r) => r.gmv, (r) => nxMoney(r.gmv)],
      ['Packing time', (r) => r.pack, (r) => nxPackPill(r.pack)], ['Wait for picker', (r) => r.wait, (r) => fmt(r.wait, 1)], ['Picking', (r) => r.pick, (r) => fmt(r.pick, 1)],
      [NXS.name('p90'), (r) => r.p90, (r) => kpiPill('p90f', r.p90)], ['ETA late %', (r) => r.eta, (r) => kpiPill('eta', r.eta)],
    ], slots));
    // where the value comes from
    const keys = NX_VAL.keys || [];
    h += card(L2('Order value: where it comes from', 'قيمة الأوردر: جاية منين'), '',
      '<p>' + (NX_VAL.field ? L2('Read from <code>' + esc(NX_VAL.field) + '</code> on ' + NX_VAL.found + ' of ' + NX_VAL.seen + ' orders.', 'متقرية من <code>' + esc(NX_VAL.field) + '</code> في ' + NX_VAL.found + ' من ' + NX_VAL.seen + ' أوردر.')
        : '<b>' + L2('No order value found in the Control Room data.', 'مش لاقي قيمة الأوردر في بيانات الكنترول روم.') + '</b> ' + L2('Pick the right field below.', 'اختار الـ field الصح من تحت.')) +
      (PREFS.valueField ? ' <span class="nx-badge na">' + L2('chosen by you', 'انت اللي اخترته') + '</span>' : ' <span class="nx-badge na">' + L2('found automatically', 'اتعرف لوحده') + '</span>') + '</p>' +
      (keys.length ? '<p class="mini">' + L2('Number fields on an order (click the one that is the order value):', 'الـ fields اللي فيها أرقام في الأوردر (اضغط على اللي هو قيمة الأوردر):') + '</p><div class="nx-fields">' +
        keys.map(([k, v]) => '<button class="ghost sm' + (k === (PREFS.valueField || NX_VAL.field) ? ' on' : '') + '" data-nxfield="' + esc(k) + '"><code>' + esc(k) + '</code> <small>' + esc(String(v).slice(0, 12)) + '</small></button>').join('') + '</div>' : '') +
      '<div class="nx-man"><label>' + L2('Or type the field (dotted path)', 'أو اكتب الـ field (بنقط)') + '<input class="txt" type="text" data-nxfieldtxt value="' + esc(PREFS.valueField || '') + '" placeholder="totalPrice"></label><button class="ghost sm" data-nxfield-save>' + L2('Use it', 'استخدمه') + '</button>' +
      (PREFS.valueField ? '<button class="ghost sm" data-nxfield="">' + L2('Back to automatic', 'رجّع للتلقائي') + '</button>' : '') + '</div>');
    return h;
  };
  BIND.x_orders = function (main) {
    const set = (v) => { if (v) PREFS.valueField = v; else delete PREFS.valueField; savePrefs(); UI.reanalyze(); };
    main.querySelectorAll('[data-nxfield]').forEach((b) => b.addEventListener('click', () => set(b.dataset.nxfield)));
    const sv = main.querySelector('[data-nxfield-save]'), tx = main.querySelector('[data-nxfieldtxt]');
    if (sv) sv.addEventListener('click', () => set(tx.value.trim()));
  };

  /* ---------- one menu, four roles ---------- */
  const NX_ROLES = () => [['all', L2('All', 'الكل')], ['fp', 'FP'], ['lead', 'Lead'], ['coord', 'Coordinator']];
  const coreGrp = (name) => (UI.groups.find((g) => g[0] === name) || [name, []])[1];
  function nxGroups(role) {
    const score = [L2('Score', 'الـ Score'), [['x_score', LT('t_xscore')], ['x_orders', LT('t_xorders')]]];
    if (role === 'fp') return [score].concat(UI.groups);
    if (role === 'lead') return [score].concat(ED_LEAD.groups());
    if (role === 'coord') return [score].concat(ED_COORD.groups());
    const L = ED_LEAD.groups(), C = ED_COORD.groups();
    return [
      [LT('g_over'), [['x_score', LT('t_xscore')], ['x_orders', LT('t_xorders')], ['l_score', LT('t_score')], ['l_p90', LT('t_p90')], ['l_eta', LT('t_eta')], ['rootcause', L2('Root causes', 'أسباب التأخير')], ['now', L2('Live & capacity', 'لايف والـ Capacity')]]],
      [L2('Day Analysis', 'تحليل اليوم'), coreGrp('Day Analysis')],
      L[1], C[1],
      [L2('Areas', 'المناطق'), coreGrp('Areas')],
      [L2('Plan & learn', 'التخطيط'), coreGrp('Plan & learn')],
      [LT('g_set'), [['setup', L2('Start here', 'ابدأ هنا')], ['settings', LT('t_settings')]]],
    ];
  }
  const navKeys = (G) => G.reduce((t, g) => t.concat(g[1].map((x) => x[0])), []);

  /* ---------- settings: the FP Brain's full set + the team extras + FP Score ---------- */
  const CORE_SET = SET_GROUPS.slice();
  const SCORE_SET = () => [L2('FP Score', 'الـ FP Score'), L2('Weights are relative (40 / 40 / 20 by default). Each part scores 100 at its KPI target and 0 at the point below.', 'الأوزان نسبية (40 / 40 / 20 افتراضيًا). كل جزء بياخد 100 عند هدف الـ KPI بتاعه وصفر عند النقطة اللي تحت.'), [
    ['SCORE_W.p90', L2('Weight: P90', 'وزن الـ P90'), '', 'num', 5],
    ['SCORE_W.eta', L2('Weight: ETA late %', 'وزن الـ ETA late %'), '', 'num', 5],
    ['SCORE_W.avail', L2('Weight: Available status', 'وزن الـ Available status'), '', 'num', 5],
    ['SCORE_P90_ZERO', L2('P90 scores 0 at (min)', 'الـ P90 بياخد صفر عند (دقيقة)'), L2('100 at the P90 target', '100 عند هدف الـ P90'), 'num', 1],
    ['SCORE_ETA_ZERO', L2('ETA late % scores 0 at (%)', 'الـ ETA late % بياخد صفر عند (%)'), L2('100 at the ETA late target', '100 عند هدف الـ ETA late'), 'num', 0.5],
    ['AVAIL_TARGET_PCT', L2('Available status target (%)', 'هدف الـ Available status (%)'), L2('share of the recorded time the FP was AVAILABLE', 'نسبة الوقت المتسجل اللي الـ FP كان فيه AVAILABLE'), 'num', 1],
    ['SCORE_AVAIL_ZERO', L2('Available status scores 0 at (%)', 'الـ Available status بياخد صفر عند (%)'), '', 'num', 1],
    ['SCORE_P90_NOW', L2('Score P90 NOW instead of P90 incl. forced', 'احسب الـ P90 NOW بدل P90 incl. forced'), '', 'bool'],
  ]];
  function teamExtras() {
    const core = new Set(); CORE_SET.forEach((g) => g[2].forEach((f) => core.add(f[0])));
    const ex = [];
    [LEAD_SET(), COORD_SET()].forEach((G) => G.forEach((g) => g[2].forEach((f) => { if (!core.has(f[0]) && !ex.some((x) => x[0] === f[0])) ex.push(f); })));
    return ex.length ? [[L2('Team pages (Lead & Coordinator)', 'صفحات الفريق (Lead و Coordinator)'), L2('Gaps, breaks, peaks, long picks and who gets ranked.', 'الوقت الفاضي، البريكات، الذروة، الـ picks الطويلة ومين يدخل الترتيب.'), ex]] : [];
  }

  /* ---------- the merged edition ---------- */
  const ED = {
    get etaFilter() { return NX.role() === 'coord' ? 'dis' : NX.role() === 'lead' ? 'store' : 'all'; },
    hideCore: false,
    groups: () => nxGroups(NX.role()),
    desc: Object.assign({}, ED_LEAD.desc, ED_COORD.desc, { x_score: 'd_xscore', x_orders: 'd_xorders', settings: 'd_settings' }),
    settings: () => [SCORE_SET(), [L2('Live updates', 'التحديث اللايف'), L2('While the brain is open on today and this tab is in front, the day reloads on its own. 0 = off.', 'طول ما الداش بورد مفتوحة على النهارده والتاب قدامك، اليوم بيتحدّث لوحده. صفر = مقفول.'), [['AUTO_REFRESH_MIN', L2('Reload the day every (min)', 'حدّث اليوم كل (دقيقة)'), L2('today only', 'النهارده بس'), 'num', 1]]]].concat(CORE_SET, teamExtras()),
    keyPoints(A, X) {
      const r = NX.role(); let o = [];
      try { if (r !== 'coord') o = o.concat(ED_LEAD.keyPoints(A, X)); } catch (e) { }
      try { if (r !== 'lead') o = o.concat(ED_COORD.keyPoints(A, X)); } catch (e) { }
      return o;
    },
    slotCols(A, X) {
      const r = NX.role();
      if (r === 'lead') return ED_LEAD.slotCols(A, X);
      if (r === 'coord') return ED_COORD.slotCols(A, X);
      const seen = new Set();
      return ED_LEAD.slotCols(A, X).concat(ED_COORD.slotCols(A, X)).filter((c) => (seen.has(c[0]) ? false : (seen.add(c[0]), true)));
    },
  };
  edBoot();


  /* ---------- Live: reload today's orders on their own (v2.3) ---------- */
  // The recorders (DA list, picker queue, DCM, FP status) always ran on timers; the orders and every KPI only loaded on Refresh.
  // Now, while the brain is open on today and this tab is in front, the day reloads every AUTO_REFRESH_MIN minutes, quietly:
  // no loading screen, same page and scroll, nothing typed is lost. Every 15 min it also re-reads the assignment history.
  const LIVE2 = {
    timer: null, next: 0, last: 0, lastFull: 0, err: null, busy: false, flash: 0,
    on: () => PREFS.live !== false && CFG.AUTO_REFRESH_MIN > 0,
    today: () => !!(UI.data && UI.meta && UI.meta.date === dateKeyOf(Date.now())),
    eligible: () => LIVE2.on() && UI.isOpen() && LIVE2.today() && document.visibilityState === 'visible' && !!CAP.ordersUrl,
    start() {
      if (LIVE2.timer) return;
      LIVE2.timer = setInterval(LIVE2.tick, 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && LIVE2.eligible() && Date.now() - LIVE2.last > CFG.AUTO_REFRESH_MIN * MIN) LIVE2.next = 0; });
    },
    loaded() { LIVE2.last = Date.now(); LIVE2.lastFull = Date.now(); LIVE2.next = Date.now() + CFG.AUTO_REFRESH_MIN * MIN; LIVE2.err = null; },
    tick() {
      LIVE2.paint();
      if (!LIVE2.eligible() || UI.busy || LIVE2.busy || Date.now() < LIVE2.next) return;
      const ae = UI.root && UI.root.getRootNode().activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { LIVE2.next = Date.now() + 15000; return; }   // someone is typing
      LIVE2.refresh();
    },
    async refresh() {
      LIVE2.busy = true; LIVE2.paint();
      const full = Date.now() - LIVE2.lastFull > 15 * MIN;
      try {
        const capturedDate = new URL(CAP.ordersUrl).searchParams.get('date');
        if (UI.meta && capturedDate && capturedDate !== UI.meta.date) { await UI.run(); }
        else {
          const res = await fetchAllOrders(null);
          if (res.orders.length) {
            const nextDay = await fetchNextDay(res.date, null);
            UI.busy = true; UI.quiet = true;
            try { UI.raw = res; UI.rawNext = nextDay; Object.assign(DAY_ORDERS, { dk: res.date, res, at: Date.now() }); await UI.build(!full); }
            finally { UI.busy = false; UI.quiet = false; }
            if (full) LIVE2.lastFull = Date.now();
            if (UI.tab !== 'map') UI.render(true);
          }
        }
        LIVE2.err = null; LIVE2.last = Date.now(); LIVE2.flash = Date.now();
      } catch (e) { LIVE2.err = e.message; }
      finally { LIVE2.busy = false; LIVE2.next = Date.now() + Math.max(0.5, CFG.AUTO_REFRESH_MIN) * MIN; LIVE2.paint(); }
    },
    toggle() { PREFS.live = !LIVE2.on(); if (PREFS.live && !(CFG.AUTO_REFRESH_MIN > 0)) CFG.AUTO_REFRESH_MIN = 2; savePrefs(); LIVE2.next = Date.now() + 1500; LIVE2.paint(); },
    paint() {
      const el = UI.root && UI.root.querySelector('.nx-live'); if (!el) return;
      let cls = 'off', txt, tip;
      const ago = (t) => { const m = Math.floor((Date.now() - t) / MIN); return m < 1 ? L2('just now', 'دلوقتي') : L2(m + ' min ago', 'من ' + m + ' دقيقة'); };
      if (!UI.data) { el.style.display = 'none'; return; }
      el.style.display = '';
      if (!LIVE2.on()) { txt = L2('Live off', 'اللايف مقفول'); tip = L2('Click to turn live updates on', 'اضغط عشان تشغّل التحديث اللايف'); }
      else if (!LIVE2.today()) { cls = 'off'; txt = L2('Past day', 'يوم فات'); tip = L2('Live updates run on today only', 'التحديث اللايف بيشتغل على النهارده بس'); }
      else if (LIVE2.busy) { cls = 'busy'; txt = L2('Updating…', 'بيحدّث…'); tip = ''; }
      else if (LIVE2.err) { cls = 'err'; txt = L2('Live: retrying', 'لايف: بيحاول تاني'); tip = LIVE2.err; }
      else {
        cls = 'on' + (Date.now() - LIVE2.flash < 2500 ? ' flash' : '');
        const left = Math.max(0, Math.round((LIVE2.next - Date.now()) / 1000));
        txt = L2('Live', 'لايف') + ' <small>' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + '</small>';
        tip = L2('Updated ' + ago(LIVE2.last) + ' · next update in ' + left + 's · click to turn off', 'اتحدّث ' + ago(LIVE2.last) + ' · التحديث الجاي بعد ' + left + ' ثانية · اضغط عشان تقفله');
      }
      const html = '<i></i>' + txt;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
      el.className = 'nx-live ' + cls; el.title = tip || '';
    },
  };

  /* ---------- look & motion ---------- */
  const NX_ICONS = {
    score: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-5"/>', over: '<path d="M3 12h4l3-7 4 14 3-7h4"/>', day: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    pk: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>', da: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8M13 6h3"/>',
    area: '<path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>', plan: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>', now: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  const iconFor = (g) => {
    const s = String(g).toLowerCase();
    if (/score|سكور/.test(s)) return 'score'; if (/overview|نظرة|kpi|now/.test(s)) return s === 'now' ? 'now' : 'over'; if (/day|اليوم/.test(s)) return 'day';
    if (/picker/.test(s)) return 'pk'; if (/\bda|الـ da/i.test(s)) return 'da'; if (/area|المناطق/.test(s)) return 'area'; if (/plan|التخطيط/.test(s)) return 'plan'; return 'set';
  };
  const NX = {
    role: () => (['all', 'fp', 'lead', 'coord'].includes(PREFS.role) ? PREFS.role : 'all'),
    motion: () => PREFS.motion !== false && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    setRole(r) {
      PREFS.role = r; savePrefs();
      const keys = navKeys(ED.groups());
      if (!keys.includes(UI.tab)) UI.tab = 'x_score';
      NX.paintRole(); UI.render();
    },
    paintRole() {
      if (!UI.root) return;
      const box = UI.root.querySelector('.nx-role'); if (!box) return;
      box.innerHTML = NX_ROLES().map(([k, l]) => '<button data-role="' + k + '" class="' + (NX.role() === k ? 'on' : '') + '">' + l + '</button>').join('') + '<span class="nx-glide"></span>';
      requestAnimationFrame(() => NX.glide());
      const mb = UI.root.querySelector('[data-act="motion"]'); if (mb) { mb.classList.toggle('off', !NX.motion()); mb.title = NX.motion() ? L2('Animations on – click to turn off', 'الأنيميشن شغال – اضغط تقفله') : L2('Animations off – click to turn on', 'الأنيميشن مقفول – اضغط تشغله'); }
      const cb = UI.root.querySelector('[data-act="csv"]'); if (cb) cb.textContent = L2('⤓ CSV', '⤓ CSV');
    },
    glide() {
      const box = UI.root && UI.root.querySelector('.nx-role'), on = box && box.querySelector('button.on'), g = box && box.querySelector('.nx-glide');
      if (!on || !g) return;
      g.style.width = on.offsetWidth + 'px'; g.style.transform = 'translateX(' + (on.offsetLeft - 3) + 'px)';
    },
    navDecor() {
      if (!UI.root) return;
      UI.root.querySelectorAll('aside .gl').forEach((el) => {
        if (el.previousElementSibling && el.previousElementSibling.classList.contains('nx-ico')) return;
        const ic = document.createElement('span'); ic.className = 'nx-ico';
        ic.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + NX_ICONS[iconFor(el.textContent)] + '</svg>';
        el.parentNode.insertBefore(ic, el);
      });
      const aside = UI.root.querySelector('aside'), on = aside.querySelector('button.on[data-tab]');
      let ink = aside.querySelector('.nx-ink');
      if (!ink) { ink = document.createElement('span'); ink.className = 'nx-ink'; if (NX._inkY != null) { ink.style.transform = 'translateY(' + NX._inkY + 'px)'; ink.style.height = NX._inkH + 'px'; } else ink.style.opacity = 0; aside.appendChild(ink); }
      if (!on || !on.offsetHeight) { ink.style.opacity = 0; return; }
      const y = on.offsetTop, hh = on.offsetHeight; NX._inkY = y; NX._inkH = hh;
      requestAnimationFrame(() => { ink.style.opacity = 1; ink.style.transform = 'translateY(' + y + 'px)'; ink.style.height = hh + 'px'; });
    },
    countUp(el) {
      const node = Array.from(el.childNodes).find((n) => n.nodeType === 3 && /\d/.test(n.nodeValue)) || (el.classList.contains('nx-count') ? el.firstChild : null);
      if (!node || node.nodeType !== 3) return;
      const m = /^(\s*)(-?\d+(?:\.(\d+))?)(.*)$/s.exec(node.nodeValue); if (!m) return;
      const to = parseFloat(m[2]), dec = m[3] ? m[3].length : 0; if (!isFinite(to) || Math.abs(to) > 1e6 || /^[,:\d]/.test(m[4])) return;
      const t0 = performance.now(), dur = 900 + Math.min(500, Math.abs(to) * 4);
      const tick = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); node.nodeValue = m[1] + (to * e).toFixed(dec) + m[4]; if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    },
    afterRender(main, soft) {
      if (NX._lang !== LANG.cur) { NX._lang = LANG.cur; NX.paintRole(); }
      NX.glide();
      NX.navDecor();
      NX.score(true);
      main.querySelectorAll('[data-goto][role="button"]').forEach((b) => b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } }));
      const go = NX.motion() && !soft;
      UI.root.classList.toggle('nx-still', !NX.motion());
      if (go) {
        main.classList.remove('nx-enter'); void main.offsetWidth; main.classList.add('nx-enter');
        clearTimeout(NX._t); NX._t = setTimeout(() => main.classList.remove('nx-enter'), 1800);
        main.querySelectorAll('.kpi .v, .tile .v, .nx-count').forEach((el, i) => { if (i < 60) NX.countUp(el); });
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        main.querySelectorAll('.nx-ring .arc').forEach((c) => { if (!go) c.style.transition = 'none'; c.style.strokeDashoffset = c.dataset.off; });
        main.querySelectorAll('.nx-bar i, .nx-stack i').forEach((b) => b.classList.add('on'));
      }));
    },
    // header + launcher score
    score(quiet) {
      if (!UI.root) return;
      const el = UI.root.querySelector('.nx-hscore'), fab = UI.root.querySelector('.fab .nx-fs');
      let S = null; try { S = UI.data ? NXS.day(UI.data) : null; } catch (e) { S = null; }
      const t = S ? S.total : null, c = NXS.cls(t);
      if (el) { el.className = 'nx-hscore ' + c; el.style.display = t == null ? 'none' : ''; el.innerHTML = '<i></i>Score <b>' + (t == null ? '–' : Math.round(t)) + '</b>'; el.dataset.goto = 'x_score'; }
      if (fab) { fab.className = 'nx-fs ' + c; fab.style.display = t == null ? 'none' : ''; fab.textContent = t == null ? '' : Math.round(t); }
    },
  };

  /* ---------- Breadfast logo (alpha masks, coloured per theme) ---------- */
  const NX_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAYoAAABwCAYAAAAAADfbAAAz20lEQVR42u19d9wcVdX/9+zukwYJIQQCElpAIIEIAoIIqKEXCyJI/yH6E+yigu3FChbAihULvCLSpPemUqRJ79JCDSYBkhBCQvLszvf9Y85NTi53Zmdm9ykJ93w+89l9nt2duXPn3vM9/Qi6QCRrAEREWuZ/KwLYFMAWACYDWB/A6gBGARgKgABeBzAbwAsAHgNwP4B7ADwiIr3mXA0AiYgkiBQpUqRI/UrSBYCAY+AkVwOwK4D3AdgGwDoVrtEL4HEANwK4FMD1IjJfz19XwGB8dJEiRYo0iImkKNN2f29N8o8kX+IbqUWyqa8tkol3tLzv+PQUyR+QXN/TMCJFihQp0iAFCQsQW5E832PsTcP0LRg0SfZmHKHv93rAMY/kr0mu7Ws0kSJFihRp8IBEQ19XIfkrZfBU5t6rrzSMvsny5IDGP5ejl0ke7QDLAlekSJEiRcLA+ChIijqrE5J7AfglgPX04xYAx6wTdVJb5v0agCcAPAngOQAvAVikn40AsBqAdQFsoOe0ZqWWjrGm522Zz28G8EkReZBkQ0Sa8XFGihQp0sBoETXz/rtGsu/1/BDWTPQcyd+T/BDJtYpqKyQ3JPlRNWfN8bSMxNNeSPJVkgc7zUIBLVKkSJEi9TdIkBxK8uwMULDmpVtJHkpypZBvQ8EgdNQD31+L5JdJPpFxLfv+OxEsIkWKFGngQGJFkn8PaBGJkfIfIblfABjq7RzOGkHlAKOW8Z3DNfrJJ6td/CKCRaRIkSL1b/hrTTWJfygjXpQhzZ9IcgUbNluEUTsgCfx/VZKTSO5AckeS25Ncl+TbSP6J5HxPo0nM2H4ew2cjRYoUqX9AwkU3/S0HJKaT3D0UNttOU/H8HmuQPIjkaSTvIzk7IxrqZZL/Np8n3udujF+PYBEpUqRI/RMCe3wOSDxIcgPjhJYKSXrvIXlGDjAkAX9IHlkz1N4xdDZSpEiR+jCZjuQexieReCBxD8lVy0jtngaxFcnLArkTvRmZ234Wd5IDFg5YZpNcx5nQ4pONFClSpO76JcaQnGYYM83rEyTHlTQ1OfDp0VIcvV5pDz+xrjcABokHJu0S9kjy2qhVRIoUKVLfaBO/9yKcHGDMJTmpIkisTfJGj+lbxt7K0A4WeJFWfv2oLHK/OTyCRaRIkSKh88xsknURaZHcEsC/NQu6pp83kWZDHyAi5xTNgjbnfBvSKrBrI60M29DzJvrq/BtPArgewK0AHgXwItIy5D0AVgGwIdKKtDsCmIglmeD2HDD/B4CZACYBmKNVbmPV2UiRIkXqMGfiKs98415P1897Sp5vIsmZgRwMqw1cQnJPksMKnruH5G4kr8g4n69VfDNGQUWKFClSd0xOWwf8Ei2SL5Ic64e1tgl/FZKrkZyaAxL3kNwlI3u77q6nx+Ksbu/7HyL5TAZYOAf4TJIr65hiIl6kSJEidQAUZ3hM3THeL5SMcKorU74m4Otw5/y10yBMBreU6YVhxr0GyX8GAMnew6ejVhEpUqRInYHFalpgzw9DfYbkcKcllACdo7wcDJvj8JWySXoFcj6Gkrw2ox5UQvKuovcQKVKkSJHCDPdjnkTeWzbL2ZicxmuElM158M/X0y2mbcBpFMlHvXBea4LaPDY7ihQpUqTqzPZCYxpyzP01kuOLMlfDsH+bYcI6oyhIKOg0SoThOs3inV63vOjUjhQpUqQugMRordvk+xEuKwESLsrpLdqy1DdhPUtypSIOcf/zEr4LBxZ/yACq66NGESlSpEjVgGKKV2TPMdhP2AKBBZn00RlM+pAi0rwDBQWc/UhuWybEV8e7AcmFXukPalmPMWXAJ1KkSJEipUzzGM/x67SKiSU0CsfgbzW/d36CR/N6TQRMV1NIvmR8DKeUCc3V1ys9oHJgsW3M1I4UKVKkclQDMNnyWqRZzs8g7XPt/pfLnEWE2vJ0c9Pj2mVH/1kzuWvt+TwFwElIM7EXIe2RfQSAd2u/7nYM3kU2nev9v6WvG6FEr/BIkSJFipQy7/UN83Sg8JiI9DoQQIEyIAoSw5QpC4C6nu9yLF1WI6iRiEgCYKwycyIt3UH93VoFGXyi470JabkQH1gmxEceKVKkSOWoAWCcYcKJqbsETzNoBxSbGA0k0d8+B+A/BTSTGslEz7Gi+X1dz19IuzGfPw3gWQVBO/414iOPFAmdlPoJCWtUQa9b16gZ4ZKGz9Qcf4l12/ofKEYF/v9ChXOtFWDYU0VkoWomeQtJ1Hy1W6DY3ywAj7TTSlzRP71Wk+RTChQ0i3t0QcCJFCnSG/dXgj4GIRFpZexzFhBaI/UhUIQK/c2pcK4xAaB4sZ3JSH0KLZJDAHzE02RqAO4QkTkFwAbeb2d6fhd3v4NVKuu4CrCVwqLEFamba1Z9hN8AsJWal90+q+se/WGJPRqsNK3v1wOwC9JK0RNUkE2UlzwM4J96LIhrvH+BIkSvl3nO+tqTc548xlhXDWA/XRgtXXzO13FRCTOYpQVvNqksEEXG/rpepOW/HYEy8PcGPl8JwA+rCECmHcEEAN8CsB+AERlf3wPAlwHsLSIXW4CJNDBAwQqLaEHgfyvmnU+1CZIcCuDbRvp3/TBeBXAhlo5cKkqhxdYaBFLZcQC2NoBY+ZQ6VwuRmuemIe3jcT+AR0RkoQ0ZjoARqQv0qq5bX6N4taowoyCxH4BTAKysHzUNH7FBNk0VSGN1hUECFFVoZgAo1mrjW2hodNUJAN5qmKdrlvRXEZlRUnJw1xoXiOaaNYDhse6a22dIZd2kJ0leBeAMEbnNV+8jRUL1KEkn3NTNfq11ABIHADjLAEHd40u+6bgWfYwD8+C7RY8HmOJbSY5VJ7P4DYgUJD6i6mTTLIIaUrPViU7rKFqCXKX2IVg67NfRs4NgzufpBltkpLNOj6YeDgjWB/AZALeSvIzkO3RTxp4ckTBI/HQJyfUB/En3d8t0v4RZ22KORNd5BIplECjcQ7vXSBqiD3kUgO2UOdVtyQ8FiV0AnG5UWDFq7Uki8hSAMg4yt8g2VG3GtnQFUmfYQEc9Oamsm0dDj7rRqtyG2gvALSS/LSIMgXakSP3vqhMCOAGpidg3wyZmbfcCmO+ZnYbEKVz2TE+OiT8AYDqA1ZVBOWZ8iDqe6GkSOwO4GMBQEw7rpIr7AXxfHbJJSSacANhN3ze9BXfvIA+PbaI6+Nje4TYW3W3C72j/8oMA9JKMPcQjDZSvrkVyYwB7635tePykBuBGAL8AcB9SP9xQAG8BsDNSf1wMc6/YkiEnUTn3x7MDzYUOL9vVznTJc+dxdaNe10J9oiYhkNyZ5Hyvd4SrNPsqyU2rVHo1rVPvM+d09Z7uGkjTi5mjy3P6fHdKzYzzJqaJ1AWmS2DULCKVWbuXeWvXvV5StIaaKSD6zZw2yafGWV9+ndlQM9LBRsJtqSRwnIgcCGCRmpsuQVruIwmEvR4kIg+Wdb6qOatJ8oMA3mbO7aT0i9Xs0uhAcu+TfahztUDnb2FBZzt1bldFGlb8VgArmM9otApRtb0XwIcAHCsix+nGjg7uSP1Jbq9P8czFztw0Dal/DSR7vPXptOZW1IYL80WXzDwcwC+RugNo+HMdwGkicmUuz+2GRmF6WTdI3u/1tXCvO2pjoQUBTcK9P7BKcyEjIQ8h+YjXC8NpNRMGsh9FjkbhKtvO6PD840kebHqV+53+bL+RhSQ31HmL/Tki9YtGYapMjyA5zVujjvf8KjYY6y5Q6OtKxqrg0zHt5rybTKKmVWKP9yRid41zAVzjaRI03zlIRM5ymkFZzUiR8IcANjbnd1ETF4jIVEXMwZpPICTHKNj26GuRo67ewedF5K8isiuAPZHW6/K1NRdBNgTAF1Uqi+anSP0dIr4q0grRoVD1f0eTaJ9ZLmapNaVXX1/X1wX9Fh6rDqoagPMA/MvLroYujJHGJGLNIw4kesqChHGOHwbgS8aB7ZjgIgDfKxNmO4DU1PtvikjRo+VpVXURuRJpvsZDAbBwz3xvkiu4sNm4jyL1I41CajaFF4ABANNVgImmpe6TjZC0R1scqPVRiYpPenkR1m4upiqkDxK9FUHiAACneWF27v1PReQ/JcNsl8V4Q4pISxl/j4hMR+ov6sXSESLumayOtDR8n6yDSJFyNIqhOVFLr8dpwnKdcAfXXEhEHgJwpDJrZqTj1wAc3AFINAxInOnlTNgw2+9WCLNd1kGjV+fnPgBXBbSKllcaPmoUkSJF6j+NwpzzScOQGIjGOUhEzuxAk2iS3N+AhO2pUQfwCoD9ReT1N2s1VTUpXZsjvcX+HJEiRUK/hscaKX8nAJdhSQaleCBxcBfMTfsjrRFDL9lOkJpb9hWR/7yJaxy5LOznc7SGRpnIiSyTV4EGNPb7zQ5AL69E+4A1tOnG2KrM8WCfv8A9uTwmaRPUIea14/kw16y16Y6ZVNkHnc6ZaT0g3Xgu3jhFc507mvNGl0GiqSBxKcJ5Eg4kzuwiSNg6MILUN/JhEbmuYgQVltO49RAtREH/R0lm5DZd0iXm5sqlt0p0SOvzWHuvlHurk9LvfTVWExXX6nSMqOA3Q6DyAMlmm4AOdiPXya0F5QFtGx+ZUkPBtdMHIForOtcGTNqChvc5C8y5u9/ePtUoDEjsiDSZbnhGCKwDiUYHPokiIHFpBInF0sG4HNPTMwXnfkTGWlmkpj2YpjUuCmsDAJsBWA9pPZ8EaYvaC6DheG0k7LplbiTHIU2k3AjAeD0nkZoYpwF4DMDDIjLDMYS+0ibdeU3E2ao6tokA1kSa+OjG9izS6LMHReRVw4yX2vAkV8goO794jiswSZoxjgYwGcAkAGsjjUCEN8YHzBhrnZpsNcmrx4u6aSLcVdPRKJIjdb21MiTseQW0s5rrlqd/T9T7nwBgNVPWZzqAqQDuF5HHDZgttXY0xyCrT8a8MsAaWNvjAWyJNLR/DeWV83Rd/wfAQxqcAm+vZQH9CoGQ+JE5WsUInfOeTIDuNOHOpOTvGCjLkZj3B5lsy7ILrkdf9zfn9Et/9JJ8f9VrDIKEu5kkR7UzQ1S43v8GSiW4RMTN85IQ3f9Jnk1yBskX9HWavv5UPx/q1gLJj5K8UZP6QrRZm2uKue4wTSK83KzTPJpN8iqSHyO5on++Lj9HIfkhkheRfLnA2J4n+QeSW3slZ8Ssi9Ac/7xC8qstwLkryTNJTi84xlNJbmvPVTbhzrz+ybuXGTqOvPmapd+Z4R3uf1NJrpa1T+yzJrkOye9oSZ9Wm3tfSPJWkp81+9De+47e87HHhkWTeb31s48+91fbjG0OySuU/9VCyY3mvG/35ssdM3PmYG7GnC8+OgIKDyReywGJg/sRJAZlRmd/AoWpeTWG5EsGGOzzmWpqb0kboLguY4Gdar6zHck7A7Wnes3R1MKEwU3lMbiDST7sna/lnc8e/iZ4kuQRBQqilcn+d/e6E8nbSowt8UD6FJXw7fr+d8Yc/7li3bUtSV4byMwvMkaSPIvkmp4gUBYoLuqDemavk1wjtG7NdYeTPE4ZbN56tOvSXzsfds9Hn/0eOWPapB1QeOtn58D6aRZc17eR3CawX9y9b9MHc87KQGEWeH+AxEe8shw+SHxgsGoS/Q0UuiDdvJ0SKEDonvFPCzxjt7Cv9Io9LtLXP+rnnzbndRsvyVhzQaAw8zOe5MWBQodJgfWcBAojXkVy7U7Awtvkx3cwNsuQH7JzQfLmjDn+U0GhzY7xKKPRtToY4wskdzVjLAsUf/PuJfGElqwxhA633+eSXN3fJ+aak7QAqF3vrQL3nxiwd3SSOf+egYKn7phUQks+scL68df1QpKHZsz51oESRlXnfPFRQ2fRTTuq43qE55Nw0U2HiMhfK/okbGOjswMhsC5f4sMickkV5ziWozBYVZMbmnjXS/ILAI7wkhBt+9TfFHB2+8XY/GO25rH82mTiN0xvkbLdzrYDcBuAD6it1PYlsI1rmoGmTW5NuO+77+6GtIHTVnqNelWnI8kzAPyPnrvljY3eeJqBhlIN40ubBOBGkjuqvXlIzjwXGWNd85h+DuBnam9umf4n4vUqCR30xrgGgCtJHq5jrFcoG5F1VPlN8Ldm/WwP4CYAW6j/gSbzuN0zcuunYZ7v0STP1/ldVPX5uGRfkqcBOMas3brXh6fIum7psz2d5D4Za7rsnLed90YHjuspBUGip0OQyAqBtSDRWE5AwtlExfXvKBAC65yizjG2MtIm9UeZ5wKv5/BJIvJEB85etzD3Qlrpk97/bcSTeOHRzNjkLlpuuGmFC3M+8fpsICfCq2aOJtI+BteQfI+IPJDnDAzdq673002me0+gF3u9ACNtGWbUArASgMt0L83qZN3oGE8E8AUdY8MbT8ublyJjdHN0Ksk5AGaXHNdwvdaQLuZ2rWiZs1k/mwG4XB3lTe8Z0RM62j0j951eAPsgrfpwepXkVDO+LwH4qAJOjzmP2xP1gmOyycOnkbxLgxEa3jMumzEvXcuj8EDiMg8k7CY9tIsggTYgsbxoEgQwp0qUCcmxSLOs91BmNj4AEo7B3Y60iVEn2epuUU0MxXy36aPcCDSx2QTAhcpYWt66tJvkXgD/BPAggJf0/6sD2BRp2eqJgd+4DbQygAtIbgXg1SJgoZu8SfKbAA4NgIS/ye/Q+X1SmWoDaRTU5gC2QxptY8eX6D1fhCWlK2oVGFGT5MdUWu31WoraEt5A2gjodqRRYi/p9VZHGqG2na4df4xEmtj6cskxPoa0oZmv1Y4AsEHGb6YijfiRjHL8800Yp9P0VtE5HJWzfuoAZgK4VedgGtLou9E6lm0BvANL6sTBaGWHIY1KSso8H7O+1wTwPaMNiHdPgrQ+3hU6Z00AY3Xd7Ik0Usteu2aix34iIvsauXI+0rbU9K5TB7CuB0juOy/qepWOGxcZu/eUNj6JQ6o6lY1z/CPGaR3ySXxwsPskKjQuWkjyav28yHEFyRtIPqiRIgw0gPHLjT9sHIFFIjScXfWqjPOGnOTOGfhbkp9QJ+AUkruT/BLJtTyH+wi11+eN+xaN3pE8AYPkB0zTKv9cbm3/oWBJ7LpZ78xwSjs6UwEo73yrkPwUyacyfFTMGO+pWfvJPJ9NtHx/MzBG9/dlJLdvM4ejSB6a8zyYsc7KlhnfMnDv7lnvUNRPZ57RhYHIPju+aTr3q7Q535Yk/xwYU7uIqUkZfjfHz/4nI/LQRRwdmBearo75vP2xpYnSWlwc1Jmj9XVlki9613bjOUr34lDvt4uPQkBhXouCRKeO65YX3WSZ0TIHEv3U4S7JiJJwf19TBiQKAoV/jZcVHIaXmI8ftdnkJ3ghhQ2z+N1GsALNcGXcofE6RrplHmNzzkc912MBZuEY8Hz10SAwvjeUgjeAcVYALJIqQGEc4f79WofmZ3wG1maMw0n+qsAYywKFe45b5QDFu0ue66A26+dqt+4NMw3dvzVn7aXBJUXBIgso3P652evR457NQrXOwGPqoXX9g5zAlN8WCEwZmQMUn2s75+2Aop9BYr8MkGiRnKfd8ZY5kCgBFM0KR15Eh/vsYn+uuwgU7hrPuQ3jMSNfunFMWEiuq5Kwfw9uHR5tGGLhNpv6/uKcjXVeG6Bwa/4rGZJgUyN5djH3WivS2Mv8/bMMBlcIKMwYD8wZI010TKOIxO+N8SttxjggQOFaGpNcgeSzHh+y47rGhIA32mkpus7cvG5M8pmqGoXRnkaaHBafQf9VvzOk3Zh0/9imcA5oWqoxDfPmRry9tlIOUHzeRUsGfp8m7rYBiuEDABJJQH1u6fU/uJwDRV9QonN3M8nd7GLqkunJhRS+0y36AhvSzcVvc/om/9rGsZfMIRGSowNMxHY8XCdDChSzsabnMKEj223ynPG5+/9LzlpoBxRuYz/sAYM93/cqjtGGWJ/YRrAZCKBwzPwzgfXjeMhTJlelXpEnTVbTULvw2hBQuL2ztq63EIM+0glQBU3y+wfWI3Wdj8/ILRFjVswEirbugiygMDf6XpXms0Di0C74JPYL+CQS772jA5bFVokFgaK3g6NZQPIhyV9YU06HQOHnZPSUaM04TjdhEvBDPaSAU6+SU2LW1WE5WsVRbST1jwd+695f2YnA4vlnHsvY/JlAYZ7fHgGJ15nX7nGgVHEOxWiAt+SY8gZKo2joOvFB0p1n1074hAGLwwoIdnlAsZ55lj6D/mIRIDfCyyjji7qd5A81+XNUTtJsnwLFESYD9bUCINGJJrFvjk+CHlg4RnLAcujM7ravIskwa1HNMm0ZcRugcAz+FWX6UtBB7hjxkTnaxAc63ORinHNPeevXXeOKNnblvweYkFuDb3dOw07qo+nr+9uAcB5Q/MXbt/Y8e3Wake5leYcEkX4HCnOObTNAkiSv7lI2vntGN7TZs3mmp1VNhrgf+HG3WW+NIqCuwsHECj2zOwKKrA9mktwCS+LaQ3kS/09E/tJhCOy+AM7B0iGwtoVpgjf22CaAM0lCRM5eDsJj3f3OA3CchuxJwd/VkcbivwXA+kjDQ99inqsffw0NLfwAgFNF5BDdTFVyKVwY4qUiMqNEToaL43u/F8LnQjgfBnCFC9/toE5TXdfQRVg6p8Sdb3NtBfsaSdGS7KKJUWsAeKdXmtrN5fUico8LfUT1yqpNnbNLSd6BNDSz1S7OX8fYUrPwFG+Mbg4fAXCV+26H7Y3rInIXyctNImRjEHTJ28Pcc8377OQutfelnuc4pH1dpELl3JeRhuKuZNa7C/V/O4ALSX5ORJ7N8Lcltjijtjm2lW77pbx+IyPZZS8AH+wjkGgEQCJUBfb9yjSveROABQDMF5ETO1zVI5Fmpe4DYH8sXTlWTGx4L4CDSV4rIn+umHjnzndBgR4DPpNbAWlcus/kagD+0qWqv66C7OUKFOKNexzSKqqPmITAmjLrLZDG+vvx/wBwni2n3iWmd5oCBQv+hkgzu9c047ZzeJHOc6ML5bqdP+tPChQySMrmb+fNoZuH6QrmJJl0WCbd9ZP/J4BHkVYuLpxLYfLObtDn5edCJDqn7yZ5DtKEwXtE5Hl/DxjtSEwZ/+ZANS5yN/H/vckPgUSji5qEBYkEwH4ico3+Zm+VCod5E+2DxbJeVlxIjgEw12sZW3gDaYnoGwDcQPJ4pFm6XzOSh3jZnSdoRNQrTqouoQU5if2uEpvS3dd6BsTE03gOJbmHV6K+KhNOkGbywpPU3Tpa0wCFHcumgdLsbg5v7QYT8pjedSaZj22YsWMwEz3Nzu7fm3JKy5fWHPV+/wVgDtIENQ4EYBiNbxiWJOz5GukdqiV2q8S8S2i8pixQmOf7BwCfCghtTjAZjbR19JEA5pF8FMCdSMvZ3A3gURFZ2K0Cl93scMeMznSHddHcZKU4CxL7ishFTvUSkaszwMJqFhSRc5YDzaKpi1IqZmgv7mImIi8COJbkjQDON7X0xWR2jgPwCRE5qaT06Rb7NAAvlGBKboOsZZ63bzaY1E9SqctIDpVlWC/jfmcj7anRLSbszvE0gOf1ukWZ8LqBc7nn+ni3xmhMcrOUgW3jZXoPBK0CYNWARgE1XfZFH/i7KsxdooB1D8mTAXxehashAQHEld9YUbXtLRU4AOBJ3cdni8g1qunU+rPFc61N7Q+aTXWYiJzeTyDRIyKOaTZE5GoAeyMtZlcLaBZnkdxfr7HMhc52TSVJCwK2HNiQHKKa2ccCErr7++M6Z60KDG6mznlRYHObd0xOQcLEFEbrxpEn+Y/MuK9VMv7/kmp8XXteOne9JQEXSEs8hGgulpTaYJf5xHNdPm9VU91KSM3iIXqhD3yIQFpPCRXqKCWqARyN1Oc7xKxxK5A3zJ5MvGKS6wM4HMDVWmb8fa7GW5d8MR0X4HI22iM6AAnnk/iwAQkEQGI/AxK9ntOvR8Hig0hr4liwkAgWmaCxSOf/bwD+YVRd++w3ArCFLrqyUuK8itLb0DbMoNbFQ3KqYmat/2EZ97XImTO6KMm5aywo+busbmu9yGlp2eEY5w2S5T00MDZHr/bRNV+rstZ1nTjGvw+Ak72Kvk1PoHHrv+EV2XSVZLcBcCnJP5Icofu2hgEECmf7/KmI/KEDkGgqSJzrqfE+SFyYdQ3H/I1m8boHNCHNYpnKs0Af23YB/DUgDTrQ2L4iw6/KkFoVSpp38+hpc6+9AyA5l93si6pWAu2A6oNkSfd2q9BpHz6fN0RAqZXkCwDei7Soqq3yWzMVnpumGCMMcNSMNvJxANepX7PPwaLRRpO4H8BXVdJsdgASvrnJRpjkgoQHFg3js7hYJQtbvdaBBdRn8Wbvm+1KkZPkAzmbfeN+HtMrOcD0cj9EczghaFqG5JxlXhpJcpiIvF7Vj5Rj2hhdEqxfydE0RnRZsk48c9dARz69luP8H9NH1xwbqMRb2syovSlcwMlEpNVhpyDtub5WgCe3vOjAmgHLbZH6H3d2obx95bNotFE1v2jivVmh9PFuChK1QATVHKSO1AuLaivWZ2Ec3FlgMV9j1LsV/bAs52k4xpJ4uSribQL2U2jjtICU5sZ2CICbTZOWbknC9PwV4swJAWEiC0BWQ+q/mFYxMi0UxUMtNbFuSSb8fEZE2YpIGw7N6MYYjVO2gTdGGg3UWp6l/GNVtHfyo0vhwRM73SOub4wK3hSRR5BG3f2E5AikZuCt1Ly0pQpwwwI5UTBh7u8F8BkRObmDnKhKQGETi/5RltGaGuyTAPzNAwmLyNeJyPmavt5bMlGpISJX5YAFAJxNclsRub9ko5rllYYFIozQzxvfbbKnVGof5ZkiawAm6LOV/oroCNCjCIfaDgMwkeQLXZqzmobZbqGScJHQSzcnjwfA1mlKm5G8rxu5Hi66BsCG2heBnZhhuuT8f4XkcwoUidfBb4sC5s0qGvl7qu4Vk2fkIpVaZm5rGto+H8A9erhS+BMA7II0tHazgPbkwty/rOXzX++rfZP3wH9bNJHKnxDNGj1bo0r8xe9ubj+S3xeRRdrZTaqABZZEQ4kHFiMAnKNILf0VHTAIqab3vlZgA7GAKajbG70mIi8hbT4Ez4kHpAlIrtufdHi48gjv0k33htIGGRrPvYGuY+6z3XUjSrfmBMCBJdrSumf2oGpEoXyTPfW83WAYNT3Xvl3W8jr1k9zrdUx0PGazrIKPFUEy0cZDUyo2lqppYEmiPoqWls9pmP8lpuxMw6QGTBWRU1TL+Lbhcf49rw1gK31OfQLitYxEqtkArrUtNkssqpbe1GSktua6YVCJF/H0DZLHqerfKVj0evfQVNXteB1TDW/iCCiVTLJU5+cGwGl7rTceZx6aQnIjZ5vVTVb6MCUYVkAalviwlp3+AsmJIanLaJ2PIO20Jt6aBYD9VRBKOhE+DBN6i2bRs4jtW5lKTUSmG2aZeEx0D5Krd+rk1PtLSK6ItP86B9E++odnPnURREMBHNwlpulA8nMqeDYrRD0lyvwnkzxCS4s/ohrCYjDzwKTplT1PROR7AE4IaIkOODbvS2GvliFR3S0isx0allz4GwP4UqD8Qd27Sfdgj+0QLHoULA72/BRO+vkcyU07rBuEZTTaqa420TE6Pz4zEtMeE/1cguHcgN01QRpnfryuu3qHGbVEGlI9Rs+7C4CfA3iA5E3aXxxe0xpXceDyQB/uFtJWoZ9SUGl0YXwnGs1bSu7bizw/hGsTPBLAV3WMncxhQ8/xLaRZ7MkgAIqWETTmehqVe/959ftU3vPGz7qBAkWpuTTF+I5X7e9eAKcAOEhNeG83CbKZIKN80RWg/J0KxHVP4BMsqXSA/tIooH1uy6pZzjb2LSwdjeA2wJkAHjIbTozkfyzJ7zmwKInYLnT2PADfN6Ytt4EaAL7dTXPBshAOqwyvpff9e6QO6yTQR3cBgFtKmD664Riti8jDAK42zA0G3PcleZg+2yFV7eokh+p6pAkrXKTXGYO0d7Zv001M/SVfKnWCyHdIblQ1DNskoB6iAN4que4X++H0+dU9ZpkA+CzJ7avmFZkx7gzgyyZzeMC1Y10/MwFc4q0fd+/jAJzsgLKs5mfWTw+Av6g2UZZ/uLl6N1InNZXXLdT3+5cwDyZqFXldf9//9uuM/z9bwQ7XUjvwPoYJOcY0VUQORlps8BnDEFxGYhPANx1YVNh8TUXc7yAN6XULpqFj+QDJDUzq+2Cu9+T8PKVs8baVoqqxTZKrkTwXwIcDzMhlhv5DRKYNkMP/uxlrsgXg9yT30qTBnhLtW+sqtLRUe9jISIM2Xv2UkGBiTDv3KpDZJEUxGd0XkVzdabUFG0GJYcBTAPyxipRuwPZ5AGd5zNLWzvqbrvveimN8m2p+0sf5GVXpZxk+0BbSmmFfU+2wcEl44ztIAPwv0irCrQqamZurG4zZvaGmMQLYieQU5UntgLyu639NACsEtE8iLYbYThNblGF+HqXnl7L9KD5eph+Aqdt+rFfn3NVvP9B8dwOSTwf68brfHFOlF4GpU7+7V/Pdnfe7A9nwKKcfhasNP1Md79241jiSR2uLxHYd1KZkFRrL6UfhN/CpdTAfZ+Y0nl/oep6YvsJ10/hHzHu/7/MPcvpIzyI5NqvTn9c3ITHNgPy+Bw+T3MRr/1o3Y1sKxM339jHNwJKKrVBtO9nXAmN06/95ku+qMMb3kJzRphXoYOiZfWabntnfD/TLzlo/br2PIHl2mzaw7fpRuPHtEJhD11fnSZJjTSfHWkAAtM/k7MCabuXtY2MCq5F8JKM3y3V5fbtJNtr2zC5h6hCSd5gBuME8ZnqxNgxYPJMDFntWbGHoJvruQLOee4u2AB0goHiR5HhtMDJaW3G2O0aRXJnkWiTfqc6yc0i+FNgwlhbp61ltmsT0JVC4DbqGgqTf5c0ykVPVVlzkvJvlNIdy9/3lAl3U3PP6RRtG9Ir2HF6hwNhWJ/nzwD22ygKFN8ZjvPvzmchCkt9yrUHbjHE0yW+b67dyxjiQQOH2+prKw1qBMbq/ryP5joLrZ2eS93nPICnbCtXrxPdATie+O/2IvMCYRpA8OQdwpmvAAdoIPlfkAM1n0Jfp7s5koSFpkz3zQQ3AGSar2iXvPUFyJ6TlldfxmsoQwKkkJwN4uaRJpKbXOF2bgliH6CQA64nI1EGWV2EL5d1dIaSxrurosICqWQuozC6j9VEAn3ZBCANga3bmk/+SPAzAFTqOJFCj6XAAHyF5qX7vAaQF+hYiLQ63OtKoj/chbWjTCJgLmnrftwFw7WCTAsXcvoY0NHKy17TH/X4UgF8A+ALJ8wFcjzTHYa7JuJ4IYDcNMR3rOZ/9JEhUKDj3YwC7A9jRG2PNBAh8F8ARJC8A8Hd9/nPMPWyINMN3P6QOe3iFO2uDxJntr59pJD+lJrhez0Tm+NBOAG7XzncXIy3hPUNt/kORJihuo2bzKV5OCj2/npSMmmpq7/JzA0U5E6SJdXeS/B3S6LynkYarD0Ua0r6TRpxtHJh/Z846VUTm5VSicGP+l+6PUHHQX5HcB8CVSPOcFunaHQ9gg441CqMl7J0hKW/lSwjmN28l+VyGqej0slqFkYAnGlXcIvm+A2V+6odWqInpnR2Sflpmbh8juV47baAvNYqc1qhJTm9mS6/p2l2QI+n60vkLZWLszf1vaNpI9gbmPTTeV/Ro5YzNaQBnaBRWaB+cmrdmjWS9GsnHS4wx0Z7lczK0pcQb46Ukz8pYB/2uUQTWzw/MeJMC62e+rp/5gXnxtajXSP7ESPCFNArvni9so/U5mqsm4xfb3IP7+zm1KtRy+mbXDL9tZvCIPI2pq47djQ3qOmfLdKQxw0tF1JgciMeR5kAsMNKjkwYPIbm1a8dYMvP3CXXIi5eUMwkY9OU2qh5iCoyJJ3U0TWGxKwG8R0SeGgyalVkLpyAth56YaDgGava3TE2j0apJ0VThpBeW3TR1nfYQkWeK3reRWh9TSexFPVevpxXUvQqfdZXSRxmptukFeTgN50oAHzXnY1nJWp33MwHsqmu/3RhdIMlIpCW7G4HxW+3zDqS5HnMxsGXG81rKfkODF3oCiaV2/bjnMFzXz3Bv/dh+LU7a3teUIkoqtFOtIS3i97gpveFL9G5cI5G2Mx5rNOEkoB3XVaM+UERm51U0Nuv4caSdCuuBahhi5qdl3jcBNLsJFGuFGrLYnsQZORB3Ic27sKYAx/i+UTHztxfAk4FFvfYgB4pOKqLCCwNtepUnp2q5+D3V3DNozG8GLE5T88ljOmYxG0VM5BLagGRikqMaqnJvLyL36YZJKvSNvhPADmoe7DFjC1X49EG8bswYFrT/COCDai4Y2gUzzFMA3oM0Ga3Hmz945atDJdcbhhG5KrvnA9hFS0yMGKT7xt3/FwEcYxhrywgPYp6DZKyfmhehNBPA+7RP9WpVn42+zlLz46M6r/7YGl4PIBr3QM3r1dJQ0+v7RORfBde0yyk5BmlOhyudlHgCWcPss4b7u9bF+j2rBD6bmReGa3wXv8PSheDcQt6T5FtLhrW6700P2BVXHgQSUbcb84Rq2VvGdDuATwPYXMvFi2sp2YUxJ30gGd6ItH/0SUj7H9jyyrZ2v93oLU9adEzvRQBfBTBFRJ6uWiDSgMWjWpL9RwDmm82dGOmrZXwtWaD9NIBDROQTmhApahOuPMduj4jIC5pY+HX1QTQ8qTVvjHbuZgD4tIjsC2BuN8bo8YystcyqDbv0Gf0Yae7CrYbhhaRl/95tblcNwHkAthaRK5T39FYdswm5fkqFjXNzxpZ4c9T01k9dfbvbish1Rde0KXU+VzXPaxWwat4Y/CMV0rrgo3A2uPOMfdSd55wS0SVTMmy0x1YM1f29OY+z5104UD1nzX1ez76jeWqnvpDkl0lultGgvazP56aM693YjZo6WWMkuT7JE0hOLTkPD5P8Hy2PgW6N0Qt/3FgjmJ4pMa779LmsZMIR3Rzfn/Gbs0qufzvGdUgerz6pMnP3TZLjjA+kR9+fm/Gbv5f0UWyTc/0dO9mj5hpC8iNatmVBwXufo1GD7zXnG6Kv78v53eQia8x7NrtrFNKCEs/mZpIHdNI72xvD4doxr52/9GUhOds0THdqzWdE5DdF+jmYaKazABxg1NY6gItFZO92qGcqVN6FNFrJZureKiLvKmoqMeP5i5astuO5SEQ+NBClx01J6e2QRul0K1N8EdLicLNUgp7pl2x3ET5lq0qaMW+PNNuVRj0WADNU9e1qxUpTt99V2RwBYGuVFDdXE+JolYgWYUkv67sA3ATgDjcHVe+9xNhWVA1oa/WBrW5KcsxW38gDSKOt7nbj8NegxsGPCczxMyJyZ9k5tufXDPWtdIybqg18FJYUhJyGtMzE7QDusnOnkrpbB1shjVL0x/hfEbml3RjNeVZWE2OIbhCRlzpZUz6vILm+9m54O9K+5GPU1LdATThPII2EulVE/uvxJGfSXh3Adhn79loRmVtkzC6h1o1Pw753QFr1dgP1Tbh2qa+adX2jiNwTOkdVXmT+noS09tQGOjdOe3Tr4j4Y77rVKL5eIerplwEJ/pacSp2hc3zFnCMxUvK4CpEq1wRyKc4bKI2iv7UXm0C0DN9HLSfap0FyaJvPpY/HVkWia/RXLk/e/A2WMfZxGZt62T3gks36aY/WOtG4u6m9o0A/irmBRu1rVLjus4G43XVIDheRBW3QlqYiJL1esSuopDajnQTubO+qKk/wYtWhNtsB7dDlSkz0QY8Hmvr5rX4aM/tSM1OJKTHF0xY7+1TTbVopP/A5+nhs/rVtNU8/0CDR+WqWnOOkquSYMX/+GK1fL3fuTP+EjtaBjieLSbW6of3ZytfeuH0ntnjrptUfYw70pLBrhOYzN75ES4u0uriGW22e6+I14Tz7E7yFM6GE05emNLN1qFIBZ0OtTprXbSsxzVjmIA3Zs20A1y7I4N011seSTlc2pG06MOARPstct72BHnOo3L2VeCuUw+/TsVUMc20N4BiTMsDTpfE0+zM5L2PcHOgx581pf0UlFnmuNaRZeH500Eau+mgBFdRWnF3kxSwL0nA9tCmn68JaX0FqJ3VA40L87i+4oN01djOx+JaeQiQsLz02vN4TkSJF6kNTyNcD2Zi9rrZOQb+Aq/V0l4lccn6BfxWNCNBzrK+e+EXqP/lsGf+EHvd5EVTuvnZ4M/goIkWKFKnbQLGLx0wdg/+oLeRX0Bn9/UAxrRbJLZxzqUizD32/EclVijjDvTHsk1FKZC7JVYueL1KkSJEiLWGwY7R6px/5dH5R6dtEGk326qH0etFGjTJxviWu7yIchmnMeBIopXtLBIlIkSJFqg4WVwTq7s+tGJb6T68ImXvdrQRYSF6Rq1A3Ln39TaCAlgOr4weyH0WkSJEiLetA8SmPqbrXoypkaO/hMWunYUxzmbLdYtauG5e+/1xGlUUHfO+M/olIkSJFqs5wx5tUcmu2eVyTmmoF/QRWq/DBgursHtMNsFBTk3hAl9Xl60H7/UiRIkWKVK02ygWej8Ix+U9U0Co20a5azYCT/H6SEz3fQlETk9jMSc0g/bGnuYT6EBwTzU6RIkWK1DlQvDvQ+tCZjEaV0Crc+T4baNTRNMW3PulFOdW9fr4128s30At2CsnbMzQJ275wDsnVoiM7UqRIkbpQFZPkjRkdrH5dsYLrbwJgYTs63U7ykCK9fLGkd+yeJC9p073KahM/ib6JSJEiRUJn/ZpNlcgdANyIpfsNu/d7isiVBSvKLq6wSfI0pB28Wl55D9u16QW97q0A/oO0rtMipBUeVwXwVqQ9bXdAWv0RXsOVrE5xryDtvPdiJ9UWI0WKFCnS0iajszOilmaafsNFcxucpvIjT9JPAhncRanIb/yorahNRIoUKVKXShLXSK5B8mVlyH7S2r226UpJsNif5H8zACMxDY9aAWDI+ixEbqz/Nj6P6JuIFClSpC5rFQfkOKJvIjkS5XwW7rxvIXlK4Ly9xiGddbSMppBFLtFvAclNut19LVKkSJEitXdEO0Z9q3Z8Kg0WptTHr0i+0IbpZ9GiNv8/PJqcIkWKFKnvO0PVSV7nAYR9/yTJbe1vip7b/D2a5N4KGreRnB4AgV6SL2mE1PEkT9Y+34kHJou8KKeYMxEpUqRIfeyvEJIrmdLhvQEz1EJtX1qz7SELtD4NtpEkOZLkBJKbk9ya5JZadtz5T44iOSugcTiQOGN5aeUYKVKkSMtSbsVYkne2yYe4heROgb67uaBhtJdGm+/tZXpMMOAEJ8mzDKBEkIgUKVKkfgaL0Z4ZKvGcx46u0KKAjVCT9zaHBLSLA0wSoJ9cZ0t2/Mo2UIpPLlKkSJEGBix6SP62ANN2RfiOJ7k9yVElrjWW5K7qh3jSO38roEU0Ta5E1CQiRYoUCX2UmV0QLKi9rQ8D8BMAqyDNriaWzuIWL1t6OoBHADwG4GkAswDM0++NQpp5vS6AiQA2BDDG/NY1hPezxKHnPFJEblJ/RxL7J0eKFCnSIIiG0vfrkTw3kC2deElyCctTy0uu8xsqLSR5UtlcjkiRIkWK1M9JeaZJ0U2BcNZmwI/Ra45mxv/83zQ9B/a5JDcv0yY1UqRIkSINYLkP87er6LowI1O6mdEvwmZdNzNqOM0i+SeS7wg1LYoUKVKkSBh4H0Ub7WKxb4DkhgDeD2APAFsAWLniqf8L4HYAlwC4UkSmW8d6rAIbKVKkSMsIUHiAQcvASY4HsKUekwFMQOq4HgmgR7+2EMBcBYYnAdwP4A4Ad4vIrLzzR4oUKVKk/qH/A5t5M7493vDaAAAAAElFTkSuQmCC';
  const NX_MARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAABwCAYAAABCZhNlAAAPnklEQVR42tVda7RVVRX+1jnnIkKAoIBAekMvKKBIpvnEB4pPUFNHPtB8oCmNcjQsf1SoQxtlZZqmNTRNKhsyGGqa4iOLzDRSfD8QkZciAoIoyJtzzv76ceeieZdr7bP2Pvti7THuOPveu/da81tzrjXnmmvOeQwKuEiWABhjTF39rTuAEQC+BGAvAG0AdgbQC8B2AAhgE4DVAJYCmAfgNQAvA5hjjNms2qoASIwxSbO0mgKAwhJCsi+AsQDGATgQQCuAUsZmqwAWAHgawMMA/mGMWSvtlwGwCOBZgRrp3P6+H8nbSa7kp686yZp81kkmzk/deca9FpP8Gck9VH9lkmZbgdVA9yV5rxBur5oiXoOqkawGfnzPV50B2EDyTpK7uxLWmWAr8tmb5M1ClL2qCniigGS97IAlSkJ0P2tITibZRdNU6BwW8THGmITk8QBuBbCb/LsOwHI9kcWorF7fIHNyPoD3AHwIwC5I3QD0lbneJm22qHfrQmNJ2q0DsABfADDJGPMCybJeMItYge391QGO1h1uvi/idxrJXWOnCsk2kueSnEZylcP1uiM9JLmR5MWWzqbntQVLsgvJexS4ukOMvZ4jeT7JHQKAKoGfsuf5gSQvI/lWoC99f33ToBXY7iT/qrhKNdIW+FySZ+rOBGC50cIiK74FXgo8M4Hk2575rrl9V+4VXIgoCWf/Jg1uCYzuDSR7aHUV06EdEM/fdyI5jOShJI8kOZrkYJIjSP6a5HqP+rK0/TYzaDvicj8tBewKkie6K3iM5DjrQn+RjjtJvkzyo8DqvZrkLDW3kwDon2RavRXYa1PAvmkNARFFk0OHH0ry987iRM+UqWdQaZbW89z+UgkieZxnJbZgXyXZPwdXjdyPIvmgR/dWA5aYa5UlKYATaWsDyeGpxomat71JLnEWJfu5kOSAqNH79CCWSF5DcrNDnGtgVD1cTZxBaWS4WI1RDs5nRdjtzopsga8luXdOsANJzkhRL/UAtzY6msEdgNBl37ncpdeKWdkYUye5L4Dnxaopyf9rYt1MMMbcQ7JijKnFgJU2hwGYLlZUVdoyYpUZZe29A+BJADMBzAWwEsBGsbx6AxgC4AAAY2S7CaGTnh2Z/ftaAMMALLeWoqtzH3M4YD//mHXOyucQkks9Olxz51GSJ5HslsEiG+OsA7UULv+iA5eV2O3vmbd1kh+S7OeqkwZqzZDso4wFH9g3xC73WWNl25/8bLXSnOePJznP0wfVQreW5MCtjFCA73ZerDnzoJJx3k5PAXuHeESgAJkse3HVz44kHwmAtr9P7oCBZF+Sn3iW//dIdou1URURkxy9qE3AK316ucntalmJeM1xPpDkfLEajX3xQmdE/CMToWtJDiD5sWM02PauyWqsZOi3q1hqdFZ9e3+YfukBRy8morx3ifUsKO7eFJga98aCVRuKrOpvhKgybaBY4+nn9uEdSC7z6LfHMoC16q2feCTcqbFM5lopYvdU8rWdQbyvdwbccvh5kgayI6EzIiR5id5IRHZ2WYC7F8VMDTVw/UmeTnJ0LHBnSq11TFKSXEeyFSS/6xBnuTwiA4et3v2nel+bo10aLXyK4INILldz8O60vXJAtKd6rEWSPKkEYKR6x1o/7wF4W1ktqVwRX9cAcbpbH5T1Hd9tjNkCoGSMSW1L/v9TAP3F71UDcA6AY6WPRnPayKDe6/jsLC17lZQzzihwc40xVZINiVRm3T7ilLODZombLkQwYtB6Ahguz3ZRjrvWSKdjIvTOBLBeaND9tpXk+MMFvNABE+P5HK5G04JeDuBNISKJGLRhAPqodsvyMzdG2mTQjDFmuSOhlsZBJQA9Pe8uzaESd3WMdwBYZIxZL0QwYtDGyn1dbQrWA5gdA9gZvIWOOAPADiXHD2yv1TkA9/b8bWWkpNj5ebZ63vq4XzHGLJfplWSQuA88/6uECNmUA3CLh8ObYlSaABkvIl1XjncD4M8Zppe+NqaxH579ZNZrk2eUe0ToXYp+/qECaU8vNgGY5hHNmMu33awXeRj1gQfwIAEVIrYiRyRXyaY+ESbYI5b7jDGLxZkQC9gya2fPyv5RkYDnewC3AdjZGEOPydgiqm88gMkeUa4B+HEjleZZqevyzhCP9nmnCMB25F+Rz7JaabsBGC0ElJx5W5UdzFTHpWQP524xxswRgyXJeA7W6gC212tFALaj9yaAJcpfZa9zRCVRga0J2EcAdFeE2dPBeQCuFABZ5q41X4+SsIqa0ud1ALMge1d3kz4xp5fjLqedRJwAw8VO3k6eO0wMfHpcSptI7pfnwFvZ9M94PKJvkWwpGvARDgi7IXlAPesDq7elX83jDVE0HO60bTHdYB9sGrA+MyL5ogPAfp4gIRLrPGDt/QV5TvWVw8DIvlf3ayVnZNGA7Qif4tluJnKGtLposHbFl8+rAm7mx7fSWBRgB/TfU/zFSQrYlibAnqr6TJz7/TsLsN3E7yGLjwsw8czZZsBaT8s4ObOqezw3t7mO+MIAO1yeICt0PeVcqAgxHif9JJ7FcgHJXtrb0hlxTkZtz2qOrqayky80xkwRi6uWFawYLuMA/El0N9Uuy4gdfoYxZo3ypqBoka4o1bOuk+esj7P6/iteDAWu0pUGeraI1biSAlY7/s8K9lGQ4ZEVbGdy9qxU2psF/D8KtiWtsdyAtxHYrGLc0qjBXIC38Zwd3wDs2dEDmgfwNhbj8U2LcTOAA6rn/wNsVsARnC3SXBxfyJzNC3gbzdnO42wWwBnAnt+JYpxE6dlmASuwh3/GC9RGkifn5mykN79FHG6HS3DZ55TvWAeF6Y1ANeucVe7a+52NgLsp6QY0HxTi5bByiMWKcaUTxVjfT2yKywHAl8r/xjRQPZ05Z30eklqz+/UQ4FNJflGizz+LOWs9FhtSVN/EItRSXUXKLe8kMY7Vs6dIOOTaQkE7gGMcbudvKwsqcg2Z2IxpycCCsa3AJlrPKmkYLaGRjThdKYLDtQLAxohx4rOgMpizF+XZHoZiji/5LG1jh9PNzekUwDUnwLposJls4wjQ9SjxDgC2IvY6yZY82V4RYJl1I5CB0xfFOvHckNujmzzJG5PC2dWZPBXZ5/QEL+0ewPaFp3KCtSbpUNW2LznzIfw3kTOv9KSJd5XkwZ/CkAL4zNhoWk94/nZybBo6UKvrM9s8AeMNVFZdpdP37hDY6gC2oD8muWOWeGVHlK8J5Dv4ItWvz5sV6uF04jlMm5J2mGa5MSNryIE6OWyTvWvNMV7oEe+qAzoPp1tU+mDNc1zKDqId2Dzc1MSB+O8CEenTSL7iEfNqAZy2oK8IHIjP0Gk8PsDfyZmYtavscNwUgMUCZIDKM0oDnSvkQe7/5Ql5SEiOStseXpzzbOmKQArABerZ1kBylb2/usnog4MdNdhBaos6TLO5CjM9KQCLZNXWXPCB1v2f3qRKfMqzUL5NskvTB+I2ap7kIACjPCkAU6WuTln8Y2VjzLsAjkZ7uGIFHctXJAB+Q/LzEnhayhGYNsXjt9sNwMhSgSf++wDY3iEebgqAxEJq0IskIiBRgHsDuFlCDrMsYDYFYAbaw4fLKo2gDOCgIgEP86S4rgIw200BENAVAT0e7Wmv9l3L8VNJHmEHKDKwNJHBXYL28EU3FHrvImM8dvEEnL5rjFnjSwEQ8W4xxswG8E1nGthrco74bZuYMs/J1AGA1iIB90E4BcAEOFIVTv9BxLCsxC8BcCTJkcK5UkaJW+ajsUjAlZQwfJO+7tEA+IGTgWLn9NkFpgCUQo10zQG4mtIO0wK6JV39OQD/VhHxlrbjZECyFhfaPnTU4ouR6pUD8CrP33aKnIMW3FRPrtEwAK2+qPrIFAC4OQ+feP4xMAfgxR4ArSR7CLEmIqr+SadcVR3tGWp7ZyiHZVfqNs9UWF0CsMIzqoMzZJLYEZ2jOrB6ty+APSPmoM6IW6lUm81yi0rFU6mDg1S/OudhWUkUvwt4D1EZScTOxTb2hiwUutgXABzRiFiRgLIxZiPa8wZtGy1y/1LGqXG0rB91p9/5IPk9T9htleTQHAnTzzpl3khyVkw7aj+9C8mnhYZVJK/Ikdb7jGfHRJKngeTYQML0hTkSpq/27IUTkge6lRIj2hwqZSORseDCUR4fl62u1gapt7HCs2N5IHbHokZ2z0DBoukZIvtMqEJTTKkLVfjA5e6r2s3zqKcY0FpVaCiLOD0RyHk4OQvoLOXelMfjuoBzISF5i35hUqCsxeUZiHRFyk2yWEGytamAFP/AWLDnedYizeFj9YuDRMbdY4sFsnmPLVxiufyXgFi9TrJfs4Epyvdl+/taoN6Wdtd2dTlzf8A9c2mO4iVDPZ5L294cm1Kj029ylqUxqrKbr7iYxXLdVgzq5cMCmWJLpdZH1vI0F6eUmPuE5LecwLdGhYfKTj+HSFWJENhEZboN7rAWBXxB+vO2nE69mzygtV/6RamD2Sey3a6iRu9rUFoq6Ih3C4gdivYyx649WwYw3hgzPaaAmM0mlTZvB/B1T9nVRPXxAYCnZLc0R37fLHZ0XwC7o7142GhlI+stJAIFxDahvcb1u9AFxBoU/dB1tQZn1I0lp4JioxKvMVfMO5b2a4P0qjkzQMDVPXlAr9kyrFkMApU5tiSlWnGoyF9acUCmHNTNIbl96tqjiDsjZcGZSbJXzuzT/iRvVVlrGlAtosRjNbLMY43kAbG1Le2Cc6sHtBWVWarsWiVHEc/hsqAtaUB86NrcoJDnt7NE9Wi79ImUI5FFJA/xlVDPUGq9pxQA/KVIzjJngKl2TS+I6XijTLnEGRT73h2ZrTlVyK+nysf11bbbItvLcpb6dvY5z997SOHdUSS/LLXnhyipm+RsdFywD2YpCBwyE3dUoEP69FmSx7hTo1HHirhKg+fGKhrcCEFL00PqDKvpGtO9lHjXAhGuJPk4yRNdO1k4Wmnw45a96C4VyN2Kp4knxmuKHdwiq4hXSP7KM5d9pt1skj+SUIReGfrqI7utG50C2vVA5ABJfl9PwyKL4lvf07kAbhQXrFsE3z1Is1bUW2gvEfWOuHPXyXM9xJL6gjjdhirXLgLt2/sFAL5hjHlC1oMkovZXvi+zkPPdqR7rx60knDD75X7HQ+LZdd1i7e+i9tax+vQYteHQ4lYLWFH6iyx8f0s8BoS+HrT5/EUUAs2a669LzRwnxGxOsXxCWzj9TR81zzNrpBDgwUV8dYkpgNtb5w7JNrR/Mc0JaC8I2Cdn08vRXvb5YQCPGmPe930ZzjYH7ADv8C05EgKxL4D90F46ancA/WShsmprC4A1AnAh2r9+6HkALxljPnRFt4hv6/gP/vumCw4dl7kAAAAASUVORK5CYII=';
  // the Breadfast theme: brand magenta frame, soft pink canvas, white cards (default from v2.1)
  THEMES.unshift({ id: 'brand', name: 'Breadfast', sub: 'Brand: logo magenta frame, soft pink canvas', sw: ['#AA0382', '#FBF4F8', '#2A1B26'] });
  if (!PREFS.nxBrand) { PREFS.nxBrand = 1; PREFS.theme = 'brand'; savePrefs(); }

  /* ---------- the new look ---------- */
  const NX_CSS = `
  .root { --nx-a: #AA0382; --nx-b: #6E0254; --nx-c: #E35DB5; --nx-ex: #2BC48A; --nx-r: 16px; --nx-logo-hdr: #fff; --magenta: #AA0382; --magenta-2: #85026A;
    --nx-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px -12px rgba(20,20,40,.22); --nx-shadow-h: 0 2px 4px rgba(0,0,0,.08), 0 18px 40px -16px rgba(60,20,90,.35);
    --nx-glass: color-mix(in srgb, var(--paper) 78%, transparent); --nx-ease: cubic-bezier(.2,.8,.2,1); }
  .root[data-theme="charcoal"], .root:not([data-theme]) { --nx-shadow: 0 1px 0 rgba(255,255,255,.04) inset, 0 10px 28px -14px rgba(0,0,0,.7); --nx-shadow-h: 0 1px 0 rgba(255,255,255,.06) inset, 0 20px 44px -16px rgba(170,3,130,.5); }
  .root[data-theme="white"], .root[data-theme="warm"] { --nx-logo-hdr: #AA0382; }

  /* launcher */
  .fab { background: linear-gradient(135deg, var(--nx-a), var(--nx-b)) !important; border-radius: 999px !important; padding: 12px 20px 12px 16px !important; box-shadow: 0 10px 30px -8px rgba(170,3,130,.6) !important;
    transition: transform .25s var(--nx-ease), box-shadow .25s; isolation: isolate; }
  .fab:hover { transform: translateY(-2px) scale(1.03); box-shadow: 0 16px 36px -8px rgba(170,3,130,.7) !important; }
  .fab::after { content: ''; position: absolute; inset: -4px; border-radius: inherit; border: 2px solid var(--nx-a); opacity: 0; z-index: -1; animation: nxPulse 2.6s var(--nx-ease) infinite; }
  .fab .dot { box-shadow: 0 0 0 3px rgba(255,255,255,.18); }
  .fab.ready .dot { animation: nxBlink 2s ease-in-out infinite; }
  .nx-fs { background: #fff; color: var(--nx-a) !important; border-radius: 999px; font-weight: 800; font-size: 12.5px; padding: 1px 8px; margin-inline-start: 2px; }
  .nx-fs.bad { color: #DB3738 !important; } .nx-fs.warn { color: #9a6400 !important; } .nx-fs.ex, .nx-fs.good { color: #0f7a4a !important; }

  /* frame */
  .overlay.open { animation: nxOpen .42s var(--nx-ease); }
  .overlay { isolation: isolate; }
  .overlay::before { content: ''; position: absolute; inset: -20%; z-index: -1; pointer-events: none; opacity: .55;
    background: radial-gradient(40% 35% at 20% 15%, color-mix(in srgb, var(--nx-a) 22%, transparent), transparent 70%),
                radial-gradient(35% 30% at 85% 10%, color-mix(in srgb, var(--nx-c) 20%, transparent), transparent 70%),
                radial-gradient(40% 40% at 70% 95%, color-mix(in srgb, var(--nx-c) 14%, transparent), transparent 70%);
    animation: nxAurora 26s ease-in-out infinite alternate; }
  header { position: relative; z-index: 3; backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px); background: color-mix(in srgb, var(--hdr-bg, var(--navy)) 86%, transparent) !important; gap: 14px !important; }
  header::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: linear-gradient(90deg, transparent, var(--nx-a), var(--nx-b), var(--nx-c), transparent); background-size: 200% 100%; animation: nxSlide 8s linear infinite; }
  header { flex-wrap: nowrap !important; padding-top: 12px !important; padding-bottom: 12px !important; }
  header .ttl { min-width: 0; flex: 0 1 auto; } header h1 { letter-spacing: -.02em !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  header .chips { min-width: 0; overflow: hidden; flex-wrap: nowrap !important; } header > .btn, header .thm .btn { white-space: nowrap; flex: none; }
  @media (max-width: 1700px) { header .thm-name, header .thm-car { display: none; } }
  @media (max-width: 1640px) { header .chips { display: none !important; } }
  @media (max-width: 1420px) { header h1 { font-size: 18px !important; } }
  @media (max-width: 1180px) { .nx-hscore { display: none !important; } header [data-act="csv"], header [data-act="motion"] { display: none; } }
  header .ttl .fp { letter-spacing: .02em; text-transform: none; }
  .btn { border-radius: 10px !important; transition: background .2s, transform .15s var(--nx-ease), box-shadow .2s, border-color .2s; }
  .btn:hover { transform: translateY(-1px); }
  .btn:active { transform: translateY(0) scale(.97); }
  .btn.primary { background: linear-gradient(135deg, var(--nx-a), var(--nx-b)) !important; border-color: transparent !important; color: #fff !important; box-shadow: 0 6px 18px -8px var(--nx-a); }
  .btn[data-act="motion"] { padding: 8px 10px; } .btn[data-act="motion"].off { opacity: .55; }
  .btn:disabled { animation: nxBreath 1.2s ease-in-out infinite; }
  /* role switcher */
  .nx-role { position: relative; display: inline-flex; padding: 3px; border-radius: 12px; background: var(--chip-bg, rgba(255,255,255,.12)); border: 1px solid var(--hdr-btn-line, rgba(255,255,255,.3)); }
  .nx-role button { position: relative; z-index: 1; background: none; border: 0; color: var(--hdr-fg, #fff) !important; font-weight: 650; font-size: 13px; padding: 6px 13px; border-radius: 9px; cursor: pointer; transition: color .25s; white-space: nowrap; }
  .nx-role button.on { color: #fff !important; }
  .nx-glide { position: absolute; z-index: 0; top: 3px; bottom: 3px; left: 3px; border-radius: 9px; background: linear-gradient(135deg, var(--nx-a), var(--nx-b)); box-shadow: 0 4px 14px -4px var(--nx-a); transition: transform .45s var(--nx-ease), width .45s var(--nx-ease); }
  .nx-hscore { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 650; padding: 5px 12px; border-radius: 999px; cursor: pointer; background: var(--chip-bg, rgba(255,255,255,.12)); color: var(--hdr-fg, #fff) !important; transition: transform .2s var(--nx-ease); }
  .nx-hscore:hover { transform: scale(1.05); }
  .nx-hscore b { font-size: 15px; } .nx-hscore i { width: 9px; height: 9px; border-radius: 50%; background: var(--muted-bar); box-shadow: 0 0 0 0 currentColor; animation: nxPing 2.4s infinite; }
  .nx-hscore.ex i, .nx-hscore.good i { background: var(--good-rule); color: var(--good-rule); } .nx-hscore.warn i { background: var(--warn-rule); color: var(--warn-rule); } .nx-hscore.bad i { background: var(--bad-rule); color: var(--bad-rule); }

  /* menu */
  aside { position: relative; background: color-mix(in srgb, var(--aside-bg, var(--paper)) 88%, transparent) !important; backdrop-filter: blur(10px); }
  aside button[data-tab] { position: relative; z-index: 1; border-radius: 10px !important; transition: background .2s, color .2s, padding .25s var(--nx-ease) !important; }
  aside button[data-tab]:hover { padding-inline-start: 18px !important; }
  aside button[data-tab].on { background: transparent !important; box-shadow: none !important; }
  .nx-ink { position: absolute; z-index: 0; left: 10px; right: 10px; top: 0; border-radius: 10px; pointer-events: none; background: var(--aside-on-bg, var(--accent-soft));
    box-shadow: inset 3px 0 0 var(--aside-on-bar, var(--nx-a)), 0 6px 16px -10px var(--nx-a); transition: transform .45s var(--nx-ease), height .3s var(--nx-ease), opacity .2s; }
  .root[dir="rtl"] .nx-ink { box-shadow: inset -3px 0 0 var(--aside-on-bar, var(--nx-a)), 0 6px 16px -10px var(--nx-a); }
  aside button.grp { display: flex !important; align-items: center; gap: 7px; }
  .nx-ico { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 8px; color: var(--nx-a); background: color-mix(in srgb, var(--nx-a) 13%, transparent); flex: none; }
  .root[data-theme="magenta"] .nx-ico { color: #fff; background: rgba(255,255,255,.16); }
  @media (max-width: 900px) { .nx-ink { display: none; } .nx-role button { padding: 5px 9px; } }

  /* page entrance */
  main { scroll-behavior: smooth; }
  main::-webkit-scrollbar, aside::-webkit-scrollbar { width: 10px; height: 10px; } main::-webkit-scrollbar-thumb, aside::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--ink-3) 35%, transparent); border-radius: 10px; border: 3px solid transparent; background-clip: padding-box; }
  .page > h2.pt { font-size: 24px !important; letter-spacing: -.02em; background: linear-gradient(90deg, var(--h-ink, var(--ink)), color-mix(in srgb, var(--nx-a) 75%, var(--h-ink, var(--ink)))); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; display: inline-block; }
  .nx-enter .page > * { animation: nxUp .6s var(--nx-ease) both; }
  .nx-enter .page > :nth-child(1) { animation-delay: 0s; } .nx-enter .page > :nth-child(2) { animation-delay: .04s; } .nx-enter .page > :nth-child(3) { animation-delay: .08s; }
  .nx-enter .page > :nth-child(4) { animation-delay: .14s; } .nx-enter .page > :nth-child(5) { animation-delay: .2s; } .nx-enter .page > :nth-child(6) { animation-delay: .26s; } .nx-enter .page > :nth-child(n+7) { animation-delay: .32s; }
  .nx-enter .kpi, .nx-enter .tile, .nx-enter .grid > .card { animation: nxUp .55s var(--nx-ease) both; }
  .nx-enter .kpi:nth-child(2), .nx-enter .tile:nth-child(2), .nx-enter .grid > .card:nth-child(2) { animation-delay: .06s; } .nx-enter .kpi:nth-child(3), .nx-enter .tile:nth-child(3), .nx-enter .grid > .card:nth-child(3) { animation-delay: .12s; }
  .nx-enter .kpi:nth-child(4), .nx-enter .tile:nth-child(4) { animation-delay: .18s; } .nx-enter .kpi:nth-child(5), .nx-enter .tile:nth-child(5) { animation-delay: .24s; } .nx-enter .kpi:nth-child(n+6), .nx-enter .tile:nth-child(n+6) { animation-delay: .3s; }
  .nx-enter .pill { animation: nxPop .45s var(--nx-ease) both; animation-delay: .25s; }
  .nx-enter tbody tr { animation: nxFade .5s ease both; } .nx-enter tbody tr:nth-child(n+2) { animation-delay: .05s; } .nx-enter tbody tr:nth-child(n+6) { animation-delay: .1s; } .nx-enter tbody tr:nth-child(n+12) { animation-delay: .15s; }

  /* surfaces */
  .card { border-radius: var(--nx-r) !important; box-shadow: var(--nx-shadow); border-color: color-mix(in srgb, var(--rule) 80%, transparent) !important; transition: box-shadow .3s, border-color .3s, transform .3s var(--nx-ease); position: relative; }
  .card:hover { box-shadow: var(--nx-shadow-h); border-color: color-mix(in srgb, var(--nx-a) 35%, var(--rule)) !important; }
  .card h2 { letter-spacing: -.01em; }
  .kpis, .sc, .tiles { border-radius: var(--nx-r) !important; box-shadow: var(--nx-shadow); overflow: hidden; }
  .kpi { position: relative; border-top: 0 !important; transition: background .25s, transform .3s var(--nx-ease); overflow: hidden; }
  .kpi::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 4px; background: var(--rule-strong); transform-origin: left; }
  .kpi.good::before { background: linear-gradient(90deg, var(--good-rule), color-mix(in srgb, var(--good-rule) 50%, var(--nx-c))); } .kpi.warn::before { background: linear-gradient(90deg, var(--warn-rule), #f59e0b); } .kpi.bad::before { background: linear-gradient(90deg, var(--bad-rule), var(--nx-a)); }
  .nx-enter .kpi::before { animation: nxGrow .9s var(--nx-ease) both .15s; }
  .kpi::after { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0; background: radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--nx-a) 10%, transparent), transparent 60%); transition: opacity .3s; }
  .kpi:hover::after { opacity: 1; } .kpi:hover { transform: translateY(-2px); }
  .kpi.bad .st::before { animation: nxPing 1.8s infinite; color: var(--bad-rule); }
  .pill { border-radius: 999px !important; transition: transform .2s var(--nx-ease); } tr:hover .pill { transform: scale(1.06); }
  .note { border-radius: 12px !important; }
  table tbody tr { transition: background .18s; }
  .seg { border-radius: 10px !important; } .seg button { transition: background .2s, color .2s; }
  input.txt, select { border-radius: 9px !important; transition: border-color .2s, box-shadow .2s; } input.txt:focus, select:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--nx-a) 25%, transparent); border-color: var(--nx-a) !important; outline: 0; }

  /* loading */
  .status.busy { position: relative; padding-top: 120px !important; }
  .status.busy::before { content: ''; position: absolute; top: 34px; left: 50%; width: 58px; height: 58px; margin-left: -29px; border-radius: 50%;
    background: conic-gradient(from 0deg, transparent 0 25%, var(--nx-a), var(--nx-b), var(--nx-c), transparent 90%); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px)); mask: radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px)); animation: nxSpin 1s linear infinite; }
  .status .bar { height: 8px !important; border-radius: 99px !important; background: color-mix(in srgb, var(--rule) 70%, transparent) !important; }
  .status .bar i { background: linear-gradient(90deg, var(--nx-a), var(--nx-b), var(--nx-c), var(--nx-a)) !important; background-size: 300% 100% !important; animation: nxSlide 1.6s linear infinite; border-radius: 99px; transition: width .4s var(--nx-ease) !important; }

  /* ---------- FP Score ---------- */
  .nx-ring { position: relative; display: inline-grid; place-items: center; flex: none; }
  .nx-ring svg { position: absolute; inset: 0; overflow: visible; }
  .nx-ring .trk { fill: none; stroke: color-mix(in srgb, var(--rule) 80%, transparent); }
  .nx-ring .arc { fill: none; stroke-linecap: round; transition: stroke-dashoffset 1.6s var(--nx-ease); filter: drop-shadow(0 4px 10px color-mix(in srgb, var(--nx-a) 35%, transparent)); }
  .nx-ring .s1 { stop-color: var(--nx-a); } .nx-ring .s2 { stop-color: var(--nx-b); }
  .nx-ring.ex .s1 { stop-color: #E35DB5; } .nx-ring.ex .s2 { stop-color: #AA0382; }
  .nx-ring.good .s1 { stop-color: #AA0382; } .nx-ring.good .s2 { stop-color: #6E0254; }
  .nx-ring.warn .s1 { stop-color: #EDC246; } .nx-ring.warn .s2 { stop-color: #F08A24; }
  .nx-ring.bad .s1 { stop-color: #E16C6F; } .nx-ring.bad .s2 { stop-color: #AA0382; }
  .nx-ring.na .s1, .nx-ring.na .s2 { stop-color: var(--muted-bar); }
  .nx-ring .in { position: relative; text-align: center; line-height: 1; direction: ltr; }
  .nx-pt .v, .nx-days, .nx-heat, .nx-tl, .nx-sp, .nx-hscore b, .nx-fs { direction: ltr; unicode-bidi: isolate; }
  .root[dir="rtl"] .nx-pt .v { text-align: right; }
  .nx-ring .big { font-size: 62px; font-weight: 800; letter-spacing: -.04em; color: var(--ink) !important; font-variant-numeric: tabular-nums; }
  .nx-ring .of { font-size: 13px; color: var(--ink-3) !important; font-weight: 600; margin-top: 4px; }
  .nx-ring .gr { display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 800; padding: 3px 11px; border-radius: 999px; color: #fff !important; background: linear-gradient(135deg, var(--nx-a), var(--nx-b)); }
  .nx-ring.ex .gr { background: linear-gradient(135deg, #E35DB5, #AA0382); } .nx-ring.good .gr { background: linear-gradient(135deg, #AA0382, #6E0254); } .nx-ring.warn .gr { background: linear-gradient(135deg, #EDC246, #F08A24); color: #3a2400 !important; } .nx-ring.bad .gr { background: linear-gradient(135deg, #E16C6F, #AA0382); }
  .nx-ring .mid { font-size: 24px; font-weight: 800; color: var(--ink) !important; font-variant-numeric: tabular-nums; }
  .nx-hero { position: relative; display: flex; gap: 30px; align-items: center; flex-wrap: wrap; padding: 26px 28px; margin-bottom: 18px; border-radius: 22px; overflow: hidden; isolation: isolate;
    background: linear-gradient(135deg, color-mix(in srgb, var(--paper) 92%, var(--nx-a)), var(--paper) 55%, color-mix(in srgb, var(--paper) 90%, var(--nx-c))); border: 1px solid color-mix(in srgb, var(--nx-a) 22%, var(--rule)); box-shadow: var(--nx-shadow-h); }
  .nx-hero::before { content: ''; position: absolute; width: 420px; height: 420px; left: -120px; top: -160px; z-index: -1; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--nx-a) 26%, transparent), transparent); animation: nxFloat 9s ease-in-out infinite alternate; }
  .nx-hero.ex::before, .nx-hero.good::before { background: radial-gradient(closest-side, rgba(227,93,181,.30), transparent); }
  .nx-hero.warn::before { background: radial-gradient(closest-side, rgba(237,194,70,.28), transparent); }
  .nx-hero.ex::after { content: '✦ ✧ ✦'; position: absolute; left: 40px; top: 14px; color: #E35DB5; letter-spacing: 18px; font-size: 14px; animation: nxTwinkle 2.4s ease-in-out infinite; }
  .nx-hero-l { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .nx-hero-r { flex: 1; min-width: 320px; }
  .nx-verdict { display: flex; gap: 6px; }
  .nx-badge { font-size: 12.5px; font-weight: 750; padding: 3px 11px; border-radius: 999px; background: var(--na-bg); color: var(--na-fg) !important; white-space: nowrap; }
  .nx-badge.ex, .nx-badge.good { background: var(--good-bg); color: var(--good) !important; } .nx-badge.warn { background: var(--warn-bg); color: var(--warn) !important; } .nx-badge.bad { background: var(--bad-bg); color: var(--bad) !important; }
  .nx-formula { font-size: 14px; font-weight: 650; color: var(--ink-2) !important; margin-bottom: 14px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .nx-chip { padding: 3px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 700; color: #fff !important; }
  .k-p90 { --kc: #AA0382; } .k-eta { --kc: #E35DB5; } .k-avail { --kc: #6E0254; }
  .nx-chip { background: var(--kc); }
  .nx-parts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  @container pg (max-width: 1100px) { .nx-parts { grid-template-columns: 1fr; } }
  .nx-part { display: flex; gap: 14px; align-items: center; padding: 14px; border-radius: 16px; background: var(--nx-glass); border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); backdrop-filter: blur(6px);
    transition: transform .3s var(--nx-ease), box-shadow .3s, border-color .3s; animation: nxUp .6s var(--nx-ease) both; animation-delay: calc(.15s + var(--i) * .1s); }
  .nx-still .nx-part { animation: none; }
  .nx-part[data-goto] { cursor: pointer; } .nx-part:hover { transform: translateY(-3px); box-shadow: var(--nx-shadow-h); border-color: color-mix(in srgb, var(--nx-a) 40%, var(--rule)); }
  .nx-pt { flex: 1; min-width: 0; }
  .nx-pt .k { font-size: 13px; font-weight: 700; color: var(--ink-2) !important; } .nx-pt .k .w { float: inline-end; font-size: 11.5px; padding: 1px 7px; border-radius: 99px; background: var(--na-bg); color: var(--na-fg) !important; }
  .nx-pt .v { font-size: 26px; font-weight: 800; letter-spacing: -.02em; color: var(--ink) !important; margin: 2px 0; font-variant-numeric: tabular-nums; } .nx-pt .v .u { font-size: 13px; font-weight: 600; color: var(--ink-3) !important; }
  .nx-pt .s { font-size: 12px; color: var(--ink-3) !important; } .nx-pt .s.pts b { color: var(--ink) !important; } .nx-pt .lost { color: var(--bad) !important; font-weight: 700; }
  .nx-bar { height: 6px; border-radius: 99px; background: color-mix(in srgb, var(--rule) 80%, transparent); overflow: hidden; margin: 7px 0 4px; }
  .nx-bar i { display: block; height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, var(--kc, var(--nx-a)), color-mix(in srgb, var(--kc, var(--nx-a)) 50%, #fff)); transition: width 1.4s var(--nx-ease) .3s; }
  .nx-bar i.on { width: var(--w); }
  .nx-parts .nx-part:nth-child(1) { --kc: #AA0382; } .nx-parts .nx-part:nth-child(2) { --kc: #E35DB5; } .nx-parts .nx-part:nth-child(3) { --kc: #6E0254; }
  .nx-stack { display: flex; height: 22px; border-radius: 99px; overflow: hidden; background: color-mix(in srgb, var(--rule) 60%, transparent); margin: 6px 0 10px; }
  .nx-stack i { display: block; width: 0; height: 100%; background: var(--kc); transition: width 1.3s var(--nx-ease); } .nx-stack i.on { width: var(--w); }
  .nx-stack i.lost { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--ink-3) 30%, transparent) 0 6px, color-mix(in srgb, var(--ink-3) 16%, transparent) 6px 12px); }
  .nx-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-2) !important; margin-bottom: 8px; }
  .nx-legend span { display: inline-flex; align-items: center; gap: 6px; } .nx-legend i { width: 11px; height: 11px; border-radius: 4px; background: var(--kc); }
  .nx-legend i.lost { background: color-mix(in srgb, var(--ink-3) 30%, transparent); } .nx-legend i.ok { background: #2BC48A; } .nx-legend i.bz { background: #EDC246; } .nx-legend i.fo { background: #E16C6F; }
  .nx-tips li { font-size: 14.5px !important; } .nx-perfect { font-size: 16px; font-weight: 700; color: var(--good) !important; }
  .nx-tl { position: relative; height: 30px; border-radius: 10px; background: color-mix(in srgb, var(--rule) 55%, transparent); overflow: hidden; margin: 4px 0 4px; }
  .nx-tl i { position: absolute; top: 0; bottom: 0; transform-origin: left; } .nx-tl i.ok { background: linear-gradient(180deg, #46d39a, #2BC48A); } .nx-tl i.bz { background: linear-gradient(180deg, #f4d36b, #EDC246); } .nx-tl i.fo { background: repeating-linear-gradient(135deg, #E16C6F 0 5px, #c94a5c 5px 10px); }
  .nx-enter .nx-tl i { animation: nxGrowX .9s var(--nx-ease) both .2s; }
  .nx-tlax { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--ink-3) !important; margin-bottom: 8px; direction: ltr; }
  .nx-man { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--rule); }
  .nx-man label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--ink-2) !important; } .nx-man input { width: 130px; font-size: 16px; font-weight: 700; padding: 6px 9px; }
  .nx-trend { direction: ltr; } .nx-spark { display: block; width: 100%; height: auto; max-height: 220px; overflow: visible; }
  .nx-spark .ln { fill: none; stroke: var(--nx-a); stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 0; }
  .nx-enter .nx-spark .ln { animation: nxDraw 1.6s var(--nx-ease) both; }
  .nx-spark .a1 { stop-color: var(--nx-a); stop-opacity: .32; } .nx-spark .a2 { stop-color: var(--nx-a); stop-opacity: 0; }
  .nx-spark .ref { stroke: var(--good-rule); stroke-dasharray: 5 6; stroke-width: 1.4; opacity: .7; } .nx-spark .ref.r2 { stroke: var(--warn-rule); }
  .nx-spark .pt { fill: var(--paper); stroke: var(--nx-a); stroke-width: 3; transform-box: fill-box; transform-origin: center; } .nx-enter .nx-spark .pt { animation: nxPop .4s var(--nx-ease) both; }
  .nx-days, .nx-heat { display: grid; grid-template-columns: repeat(auto-fill, minmax(54px, 1fr)); gap: 6px; margin-top: 10px; }
  .nx-days span, .nx-heat .c { display: flex; flex-direction: column; align-items: center; padding: 7px 4px; border-radius: 10px; background: var(--na-bg); transition: transform .2s var(--nx-ease); }
  .nx-days span:hover, .nx-heat .c:hover { transform: translateY(-2px) scale(1.04); }
  .nx-days b, .nx-heat b { font-size: 16px; font-variant-numeric: tabular-nums; } .nx-days small, .nx-heat small { font-size: 11px; color: var(--ink-3) !important; }
  .nx-heat { grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)); margin: 0 0 14px; }
  .nx-enter .nx-heat .c, .nx-enter .nx-days span { animation: nxPop .45s var(--nx-ease) both; }
  .nx-enter .nx-heat .c:nth-child(n+4), .nx-enter .nx-days span:nth-child(n+4) { animation-delay: .08s; } .nx-enter .nx-heat .c:nth-child(n+8), .nx-enter .nx-days span:nth-child(n+8) { animation-delay: .16s; } .nx-enter .nx-heat .c:nth-child(n+14) { animation-delay: .24s; }
  .ex.c, .nx-days .ex { background: color-mix(in srgb, #2BC48A 24%, transparent); } .good.c, .nx-days .good { background: var(--good-bg); } .warn.c, .nx-days .warn { background: var(--warn-bg); } .bad.c, .nx-days .bad { background: var(--bad-bg); }
  .nx-sp { display: inline-block; min-width: 40px; text-align: center; font-weight: 750; padding: 1px 8px; border-radius: 999px; background: var(--na-bg); }
  .nx-sp.ex { background: color-mix(in srgb, #2BC48A 24%, transparent); color: var(--good) !important; } .nx-sp.good { background: var(--good-bg); color: var(--good) !important; } .nx-sp.warn { background: var(--warn-bg); color: var(--warn) !important; } .nx-sp.bad { background: var(--bad-bg); color: var(--bad) !important; }
  .nx-banner { display: flex; align-items: center; gap: 16px; padding: 12px 18px; margin-bottom: 16px; border-radius: 18px; cursor: pointer; background: linear-gradient(110deg, color-mix(in srgb, var(--paper) 90%, var(--nx-a)), var(--paper)); border: 1px solid color-mix(in srgb, var(--nx-a) 25%, var(--rule)); box-shadow: var(--nx-shadow); transition: transform .3s var(--nx-ease), box-shadow .3s; }
  .nx-banner:hover { transform: translateY(-2px); box-shadow: var(--nx-shadow-h); } .nx-banner .t { flex: 1; }
  .nx-banner .k { font-size: 14px; color: var(--ink-2) !important; } .nx-banner .k b { color: var(--ink) !important; }
  .nx-banner .ps { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; } .nx-banner .ps span { font-size: 12.5px; padding: 3px 10px; border-radius: 999px; background: var(--na-bg); }
  .nx-banner .ps span.ex, .nx-banner .ps span.good { background: var(--good-bg); } .nx-banner .ps span.warn { background: var(--warn-bg); } .nx-banner .ps span.bad { background: var(--bad-bg); }
  .nx-banner .go { font-size: 22px; color: var(--nx-a) !important; transition: transform .3s var(--nx-ease); } .nx-banner:hover .go { transform: translateX(5px); } .root[dir="rtl"] .nx-banner .go { transform: scaleX(-1); }


  /* ---------- Breadfast logo ---------- */
  .nx-logo { flex: none; display: block; width: 92px; height: 26px; background: var(--nx-logo-hdr); -webkit-mask: url("${NX_LOGO}") left center / contain no-repeat; mask: url("${NX_LOGO}") left center / contain no-repeat; transition: transform .3s var(--nx-ease); }
  .nx-logo:hover { transform: scale(1.04); }
  .nx-logo + .ttl { padding-inline-start: 14px; border-inline-start: 1px solid var(--hdr-btn-line, rgba(255,255,255,.3)); }
  @media (max-width: 1280px) { .nx-logo { width: 15px; -webkit-mask-image: url("${NX_MARK}"); mask-image: url("${NX_MARK}"); } }
  .nx-fmark { display: block; width: 13px; height: 24px; background: #fff; -webkit-mask: url("${NX_MARK}") center / contain no-repeat; mask: url("${NX_MARK}") center / contain no-repeat; }
  .status.busy::after { content: ''; position: absolute; top: 49px; left: 50%; width: 16px; height: 29px; margin-left: -8px; background: var(--nx-a); -webkit-mask: url("${NX_MARK}") center / contain no-repeat; mask: url("${NX_MARK}") center / contain no-repeat; animation: nxBeat 1.2s ease-in-out infinite; }
  .nx-hero-mark { position: absolute; right: -30px; bottom: -60px; width: 190px; height: 360px; z-index: -1; background: var(--nx-a); opacity: .07; -webkit-mask: url("${NX_MARK}") center / contain no-repeat; mask: url("${NX_MARK}") center / contain no-repeat; transform: rotate(-12deg); pointer-events: none; }
  .root[dir="rtl"] .nx-hero-mark { right: auto; left: -30px; transform: rotate(12deg); }
  aside::after { content: ''; display: block; margin: 22px auto 4px; width: 84px; height: 24px; opacity: .35; background: var(--aside-grp, var(--nx-a)); -webkit-mask: url("${NX_LOGO}") center / contain no-repeat; mask: url("${NX_LOGO}") center / contain no-repeat; }
  @media (max-width: 900px) { aside::after { display: none; } }
  @keyframes nxBeat { 0%, 100% { transform: scale(.9); opacity: .7; } 50% { transform: scale(1.08); opacity: 1; } }

  /* ---------- Breadfast theme ---------- */
  .root[data-theme="brand"] {
    color-scheme: only light;
    --canvas: #FBF4F8; --paper: #FFFFFF; --paper-2: #FDF8FB; --rule: #EFE1EA; --rule-strong: #D9C2D1;
    --ink: #2A1B26; --ink-2: #4A3844; --ink-3: #7A6874; --h-ink: #AA0382;
    --navy: #AA0382; --navy-2: #85026A; --accent: #AA0382; --accent-soft: #F8E6F2; --on-accent: #FFFFFF; --muted-bar: #D8C8D2;
    --good: #105C39; --good-bg: #E3F4EA; --good-rule: #46B976;
    --warn: #593826; --warn-bg: #FCF4D6; --warn-rule: #EDC246;
    --bad: #DB3738; --bad-bg: #FDF1E9; --bad-rule: #DB3738;
    --pill-good-bg: #B5E3C8; --pill-good: #105C39; --pill-warn-bg: #FDDC6A; --pill-warn: #593826; --pill-bad-bg: #DB3738; --pill-bad: #FFFFFF;
    --hdr-bg: #AA0382; --hdr-fg: #FFFFFF; --hdr-fg-2: #F6D3EA; --hdr-line: #85026A; --hdr-btn-line: rgba(255,255,255,.5); --hdr-btn-hover: rgba(255,255,255,.14);
    --hdr-primary-bg: #FFFFFF; --hdr-primary-fg: #AA0382; --hdr-primary-hover: #FDF0F8; --chip-bg: rgba(255,255,255,.18);
    --aside-bg: #FFFFFF; --aside-line: #EFE1EA; --aside-fg: #4A3844; --aside-grp: #AA0382; --aside-hover: #FDF4FA; --aside-on-bg: #F8E6F2; --aside-on-fg: #AA0382; --aside-on-bar: #AA0382;
    --row-alt: #FDF9FC; --row-hover: #F8E6F2; --grid: #F1E6ED; --chart-text: #7A6874; --hover-fill: rgba(170,3,130,.06);
    --tip-bg: #2A1B26; --tip-fg: #FFFFFF; --tip-line: #2A1B26; --input-bg: #FFFFFF; --band: rgba(170,3,130,.035); --warn-band: rgba(237,194,70,.14);
    --na-bg: #F5ECF2; --na-fg: #4A3844; --focus: #AA0382; --map-bg: #F5ECF2;
    --nx-shadow: 0 1px 2px rgba(110,2,84,.05), 0 10px 26px -14px rgba(110,2,84,.28); --nx-shadow-h: 0 2px 4px rgba(110,2,84,.07), 0 20px 42px -16px rgba(170,3,130,.38);
  }
  .root[data-theme="brand"] header { background: linear-gradient(100deg, #AA0382 0%, #8E0270 55%, #6E0254 100%) !important; }
  .root[data-theme="brand"] header::after { background: linear-gradient(90deg, transparent, #F6B8E0, #fff, #F6B8E0, transparent); background-size: 200% 100%; }
  .root[data-theme="brand"] header .btn.primary, .root[data-theme="magenta"] header .btn.primary { background: #fff !important; color: #AA0382 !important; box-shadow: 0 6px 18px -8px rgba(0,0,0,.35); }
  .root[data-theme="brand"] .nx-glide, .root[data-theme="magenta"] .nx-glide { background: #fff; box-shadow: 0 4px 14px -4px rgba(0,0,0,.3); }
  .root[data-theme="brand"] .nx-role button.on, .root[data-theme="magenta"] .nx-role button.on { color: #AA0382 !important; }
  .root[data-theme="brand"] .overlay::before { opacity: .9; }
  .root[data-theme="brand"] .page > h2.pt { background: linear-gradient(90deg, #AA0382, #6E0254); -webkit-background-clip: text; background-clip: text; }
  .root[data-theme="brand"] .kpis, .root[data-theme="brand"] .sc, .root[data-theme="brand"] .tiles { border-color: #EFE1EA !important; }
  .root[data-theme="brand"] .thm-menu, .root[data-theme="brand"] .thm-menu button { color: var(--ink) !important; }

  /* ---------- orders & basket ---------- */
  .nx-day { margin-bottom: 18px; } .nx-day.nx-link { cursor: pointer; transition: transform .3s var(--nx-ease), box-shadow .3s; } .nx-day.nx-link:hover { transform: translateY(-2px); box-shadow: var(--nx-shadow-h); }
  .nx-k .k { font-size: 13.5px !important; } .nx-k .v { font-size: 32px !important; } .nx-k.na .v { color: var(--ink-3) !important; }
  .nx-k::before { background: linear-gradient(90deg, var(--nx-a), var(--nx-c)) !important; }
  .nx-h { font-size: 16px; margin: 4px 0 10px; color: var(--h-ink, var(--ink)) !important; font-weight: 700; }
  .nx-shifts { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; margin-bottom: 18px; }
  .nx-shift { position: relative; padding: 16px 18px; border-radius: var(--nx-r); background: var(--paper); border: 1px solid color-mix(in srgb, var(--rule) 80%, transparent); box-shadow: var(--nx-shadow); overflow: hidden;
    transition: transform .3s var(--nx-ease), box-shadow .3s; animation: nxUp .6s var(--nx-ease) both; animation-delay: calc(.1s + var(--i) * .09s); }
  .nx-shift::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 4px; background: linear-gradient(90deg, var(--nx-a), var(--nx-c)); }
  .nx-shift:hover { transform: translateY(-3px); box-shadow: var(--nx-shadow-h); } .nx-shift.empty { opacity: .55; }
  .nx-shift .hd { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .nx-shift .nm { font-size: 17px; font-weight: 800; color: var(--h-ink, var(--ink)) !important; } .nx-shift .rg { font-size: 12.5px; color: var(--ink-3) !important; }
  .nx-shift .big { font-size: 34px; font-weight: 800; letter-spacing: -.02em; color: var(--ink) !important; margin-top: 4px; font-variant-numeric: tabular-nums; } .nx-shift .big small { font-size: 14px; font-weight: 600; color: var(--ink-3) !important; }
  .nx-shift .nx-bar { margin: 4px 0 10px; } .nx-shift .nx-bar i { --kc: var(--nx-a); }
  .nx-shift .r { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 0; border-top: 1px dashed color-mix(in srgb, var(--rule) 80%, transparent); font-size: 13px; }
  .nx-shift .r span { color: var(--ink-2) !important; } .nx-shift .r b { color: var(--ink) !important; font-variant-numeric: tabular-nums; } .nx-shift .r small { color: var(--ink-3) !important; font-weight: 500; }
  .nx-ring .mid.sm { font-size: 18px; }
  .nx-fields { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 4px; } .nx-fields button.on { border-color: var(--nx-a) !important; background: var(--accent-soft) !important; }
  .nx-fields code, .card code { font-size: 12px; } .nx-man input[type="text"] { width: 240px; font-size: 14px; font-weight: 600; }

  /* quick look inside the FP Score hero */
  .nx-glance { flex-basis: 100%; margin-top: 4px; padding-top: 16px; border-top: 1px dashed color-mix(in srgb, var(--nx-a) 25%, var(--rule)); }
  .nx-gt { font-size: 13px; font-weight: 750; color: var(--ink-2) !important; margin-bottom: 10px; letter-spacing: .01em; display: flex; justify-content: space-between; }
  .nx-gt span { font-weight: 650; color: var(--accent) !important; font-size: 12.5px; }
  .nx-gs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
  @container pg (max-width: 1200px) { .nx-gs { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @container pg (max-width: 760px) { .nx-gs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .nx-g { position: relative; display: flex; gap: 11px; align-items: flex-start; padding: 12px 14px; border-radius: 14px; cursor: pointer; overflow: hidden;
    background: var(--nx-glass); border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); backdrop-filter: blur(6px);
    transition: transform .3s var(--nx-ease), box-shadow .3s, border-color .3s; animation: nxUp .6s var(--nx-ease) both; }
  .nx-g:nth-child(1) { animation-delay: .45s; } .nx-g:nth-child(2) { animation-delay: .52s; } .nx-g:nth-child(3) { animation-delay: .59s; } .nx-g:nth-child(4) { animation-delay: .66s; } .nx-g:nth-child(5) { animation-delay: .73s; }
  .nx-still .nx-g { animation: none; }
  .nx-g:hover { transform: translateY(-3px); box-shadow: var(--nx-shadow-h); border-color: color-mix(in srgb, var(--nx-a) 40%, var(--rule)); }
  .nx-g::after { content: ''; position: absolute; inset: auto 0 0 0; height: 3px; background: linear-gradient(90deg, var(--nx-a), var(--nx-c)); transform: scaleX(.18); transform-origin: left; transition: transform .45s var(--nx-ease); }
  .root[dir="rtl"] .nx-g::after { transform-origin: right; }
  .nx-g:hover::after { transform: scaleX(1); }
  .nx-g.st.good::after { background: var(--good-rule); } .nx-g.st.warn::after { background: var(--warn-rule); transform: scaleX(1); } .nx-g.st.bad::after { background: var(--bad-rule); transform: scaleX(1); }
  .nx-g .ic { flex: none; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 17px; background: color-mix(in srgb, var(--nx-a) 14%, transparent); }
  .nx-g .tx { min-width: 0; }
  .nx-g .k { font-size: 12px; font-weight: 650; color: var(--ink-3) !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nx-g .v { font-size: 22px; font-weight: 800; letter-spacing: -.02em; color: var(--ink) !important; font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
  .root[dir="rtl"] .nx-g .v { text-align: right; }
  .nx-g .v .u { font-size: 12px; font-weight: 600; color: var(--ink-3) !important; }
  .nx-g .s { font-size: 11.5px; color: var(--ink-3) !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nx-g.st.good .v { color: var(--good) !important; } .nx-g.st.warn .v { color: var(--warn) !important; } .nx-g.st.bad .v { color: var(--bad) !important; } .nx-g.na .v { color: var(--ink-3) !important; }

  /* live chip */
  .nx-live { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; padding: 5px 12px; border-radius: 999px; cursor: pointer; white-space: nowrap; flex: none;
    background: var(--chip-bg, rgba(255,255,255,.12)); color: var(--hdr-fg, #fff) !important; transition: background .3s, transform .2s var(--nx-ease); }
  .nx-live:hover { transform: scale(1.05); }
  .nx-live small { font-size: 11.5px; opacity: .8; font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
  .nx-live i { position: relative; width: 9px; height: 9px; border-radius: 50%; background: #9aa0a6; flex: none; }
  .nx-live.on i { background: #3DF5A0; } .nx-live.on i::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: #3DF5A0; animation: nxLivePing 1.6s ease-out infinite; }
  .nx-live.busy i { background: transparent; border: 2px solid currentColor; border-top-color: transparent; animation: nxSpin .8s linear infinite; }
  .nx-live.err i { background: #FFB547; } .nx-live.off { opacity: .75; }
  .nx-live.flash { background: rgba(61,245,160,.28); }
  @keyframes nxLivePing { 0% { transform: scale(1); opacity: .7; } 100% { transform: scale(2.6); opacity: 0; } }
  /* motion off */
  .nx-still *, .nx-still *::before, .nx-still *::after { animation: none !important; transition: none !important; }
  @media (prefers-reduced-motion: reduce) { .root *, .root *::before, .root *::after { animation: none !important; transition-duration: 0s !important; } }

  @keyframes nxUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes nxFade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes nxPop { 0% { opacity: 0; transform: scale(.7); } 70% { transform: scale(1.06); } 100% { opacity: 1; transform: scale(1); } }
  @keyframes nxGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes nxGrowX { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
  @keyframes nxDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
  @keyframes nxOpen { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
  @keyframes nxAurora { 0% { transform: translate(0,0) rotate(0deg); } 50% { transform: translate(3%, 2%) rotate(4deg); } 100% { transform: translate(-3%, 1%) rotate(-3deg); } }
  @keyframes nxSlide { from { background-position: 0% 0; } to { background-position: 200% 0; } }
  @keyframes nxSpin { to { transform: rotate(360deg); } }
  @keyframes nxPulse { 0% { opacity: .7; transform: scale(1); } 80%, 100% { opacity: 0; transform: scale(1.35); } }
  @keyframes nxBlink { 0%, 100% { box-shadow: 0 0 0 3px rgba(70,195,95,.25); } 50% { box-shadow: 0 0 0 6px rgba(70,195,95,.05); } }
  @keyframes nxPing { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 55%, transparent); } 80%, 100% { box-shadow: 0 0 0 7px transparent; } }
  @keyframes nxBreath { 50% { opacity: .5; } }
  @keyframes nxFloat { from { transform: translate(0,0); } to { transform: translate(60px, 40px); } }
  @keyframes nxTwinkle { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
  `;

  /* ------------------------------------------------------------------
   * Boot + test hook
   * ------------------------------------------------------------------ */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { UI.init(); LIVE2.start(); });
  else { UI.init(); LIVE2.start(); }
  PW.__fpUnified = PW.__fpCoord = PW.__fpLead = { __teamCanDo: (A) => teamCanDo(A), analyze, scoreDay, toCsv, CFG, CAP, UI, DCM, FPSTAT, LIVE, LOG, MAP, GMAP, PKREC, DAREC, NET, PREFS, accountability, p90Pool, loadHistory, rootCauses, NXS, NX, LIVE2 };
})();

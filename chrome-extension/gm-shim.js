// Replaces Tampermonkey's GM_xmlhttpRequest (used only for map tiles) by asking the extension's background to fetch.
(function () {
  const pending = new Map();
  let n = 0;
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__fpgm !== 'res') return;
    const cb = pending.get(d.id); if (!cb) return;
    pending.delete(d.id);
    if (d.error) return cb.onerror && cb.onerror({ error: d.error });
    const bin = atob(d.b64 || ''), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    cb.onload && cb.onload({ status: d.status, response: buf.buffer });
  });
  window.GM_xmlhttpRequest = function (details) {
    const id = ++n;
    pending.set(id, details);
    window.postMessage({ __fpgm: 'req', id, url: details.url }, '*');
    if (details.timeout) setTimeout(() => { if (pending.has(id)) { pending.delete(id); details.ontimeout && details.ontimeout(); } }, details.timeout);
  };
})();

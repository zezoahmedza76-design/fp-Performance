chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || !/^https:\/\/[^/]*(cartocdn\.com|arcgisonline\.com|openstreetmap\.org|openstreetmap\.fr)\//.test(msg.url || '')) { send({ error: 'blocked' }); return; }
  fetch(msg.url).then(async (r) => {
    const b = new Uint8Array(await r.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    send({ status: r.status, b64: btoa(s) });
  }).catch((e) => send({ error: String(e) }));
  return true;
});

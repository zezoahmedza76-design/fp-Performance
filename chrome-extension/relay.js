// Isolated world: passes requests from the page script to the background worker and back.
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.__fpgm !== 'req') return;
  chrome.runtime.sendMessage({ url: d.url }, (r) => {
    const err = chrome.runtime.lastError;
    window.postMessage(Object.assign({ __fpgm: 'res', id: d.id }, err || !r ? { error: err ? err.message : 'no answer' } : r), '*');
  });
});

(() => {
  if (window.__gehihiSessionPoll) return;
  const poll = () => {
    try {
      chrome.runtime.sendMessage({ type: "gehihi.poll" }).catch(() => {});
    } catch {}
  };
  window.__gehihiSessionPoll = setInterval(poll, 2500);
  poll();
})();

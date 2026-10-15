(() => {
  if (window.__gehihiSessionPoll) return;
  const poll = () => {
    try { chrome.runtime.sendMessage({ type: "gehihi.poll" }).catch(() => {}); }
    catch { clearInterval(window.__gehihiSessionPoll); }
  };
  window.__gehihiSessionPoll = setInterval(poll, 2000);
  poll();
})();

const status = document.getElementById("status");
async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "gehihi.state" });
  status.textContent = state.connected ? `Đã ghép tab Gemini · slot ${state.account_slot || "mặc định"}. Chưa đồng nghĩa model đã được kiểm thử.` : "Chưa kết nối. Backend và relay cần chạy trên máy; chọn đúng tab Gemini trước khi ghép.";
}
document.getElementById("connect").addEventListener("click", async () => {
  const button = document.getElementById("connect"); button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "gehihi.pair", key: document.getElementById("key").value });
    if (!result?.ok) { status.textContent = "Chưa ghép được. Kiểm tra khóa workspace, relay đang chạy và tab hiện tại là gemini.google.com."; return; }
    document.getElementById("key").value = ""; await refresh();
  } catch { status.textContent = "Tiện ích chưa phản hồi. Thử tải lại tiện ích rồi ghép lại tab."; }
  finally { button.disabled = false; }
});
document.getElementById("disconnect").addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "gehihi.disconnect" }); await refresh(); });
refresh().catch(() => { status.textContent = "Chưa đọc được trạng thái tiện ích."; });

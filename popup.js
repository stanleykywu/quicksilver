document.getElementById("record").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "START_RECORDING" });
});
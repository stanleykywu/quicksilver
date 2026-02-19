let recording = false;

chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === "START_RECORDING" && !recording) {
        recording = true;

        const existing = await chrome.offscreen.hasDocument?.();
        if (!existing) {
            await chrome.offscreen.createDocument({
                url: "offscreen.html",
                reasons: ["USER_MEDIA"],
                justification: "Record tab audio"
            });
        }

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) return;

        const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: tabs[0].id
        });

        chrome.runtime.sendMessage({
            type: "CAPTURE_STREAM",
            streamId
        });

        // Reset flag after the recording duration (30s + buffer)
        setTimeout(() => { recording = false; }, 31000);
    }
});
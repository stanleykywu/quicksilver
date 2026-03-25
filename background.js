importScripts("shared.js");

const RECORDING_DURATION_MS = 30_000;

let currentSession;

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "START_RECORDING") {
        return handleStartRecording();
    }

    if (msg.type === "STOP_RECORDING") {
        return handleStopRecording(msg.reason || "cancelled");
    }

    if (msg.type === "DETECTION_RESULT") {
        return handleDetectionResult(msg);
    }

    if (msg.type === "DETECTION_ERROR") {
        return handleDetectionError(msg);
    }

    if (msg.type === "RECORDING_FINISHED") {
        return handleRecordingFinished(msg.reason || "finished");
    }

    return undefined;
});

async function handleStartRecording() {
    if (currentSession?.status === "recording") {
        return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
        throw new Error("No active tab is available for recording.");
    }

    const normalizedUrl = normalizePageUrl(tab.url);
    if (!normalizedUrl) {
        throw new Error("Unable to normalize the current tab URL.");
    }

    currentSession = {
        tabId: tab.id,
        url: normalizedUrl,
        title: tab.title || normalizedUrl,
        startedAt: Date.now(),
        status: "recording"
    };

    await setRecordingState(currentSession);
    await ensureOffscreenDocument();

    try {
        const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: tab.id
        });

        await chrome.runtime.sendMessage({
            type: "CAPTURE_STREAM",
            streamId,
            session: currentSession
        });

        broadcast({
            type: "UI_RECORDING_STATE_UPDATED",
            recordingState: await getRecordingState()
        });
    } catch (err) {
        await finalizeRecordingSession({ closeOffscreen: true });
        throw err;
    }
}

async function handleStopRecording(reason) {
    if (!currentSession?.status) {
        return;
    }

    currentSession.status = "stopping";
    await setRecordingState(currentSession);
    broadcast({
        type: "UI_RECORDING_STATE_UPDATED",
        recordingState: await getRecordingState()
    });

    const offscreenExists = await chrome.offscreen.hasDocument?.();
    if (!offscreenExists) {
        await handleRecordingFinished(reason);
        return;
    }

    await chrome.runtime.sendMessage({
        type: "STOP_RECORDING",
        reason
    });
}

async function handleDetectionResult(msg) {
    const session = currentSession;
    if (!session?.url) {
        return;
    }

    const stored = await chrome.storage.local.get("detectionsByUrl");
    const detectionsByUrl = stored.detectionsByUrl || {};

    detectionsByUrl[session.url] = {
        url: session.url,
        title: session.title,
        score: msg.score,
        verdict: msg.verdict,
        sampleRate: msg.sampleRate,
        updatedAt: Date.now()
    };

    await chrome.storage.local.set({ detectionsByUrl });

    broadcast({
        type: "UI_DETECTION_SAVED",
        url: session.url
    });
}

async function handleDetectionError(msg) {
    console.error("Detection failed", msg.error || "Unknown inference failure");
    broadcast({
        type: "UI_DETECTION_ERROR",
        error: msg.error || "Inference failed."
    });
}

async function handleRecordingFinished(reason) {
    await finalizeRecordingSession({ reason, closeOffscreen: true });
}

async function finalizeRecordingSession({ reason, closeOffscreen }) {
    const previousSession = currentSession;
    currentSession = undefined;

    await clearRecordingState();

    if (closeOffscreen && await chrome.offscreen.hasDocument?.()) {
        try {
            await chrome.offscreen.closeDocument();
        } catch (err) {
            console.error("Failed to close offscreen document", err);
        }
    }

    broadcast({
        type: "UI_RECORDING_FINISHED",
        reason,
        session: previousSession || null
    });
}

async function ensureOffscreenDocument() {
    const existing = await chrome.offscreen.hasDocument?.();
    if (existing) {
        return;
    }

    await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Record tab audio for inference"
    });
}

async function setRecordingState(session) {
    const countdownEnd = session.startedAt + RECORDING_DURATION_MS;
    await chrome.storage.local.set({
        recordingState: {
            isRecording: session.status === "recording" || session.status === "stopping",
            status: session.status,
            countdownEnd,
            startedAt: session.startedAt,
            tabId: session.tabId,
            url: session.url,
            title: session.title
        }
    });
}

async function clearRecordingState() {
    await chrome.storage.local.remove("recordingState");
}

async function getRecordingState() {
    const stored = await chrome.storage.local.get("recordingState");
    return stored.recordingState || null;
}

function broadcast(message) {
    chrome.runtime.sendMessage(message).catch(() => { });
}

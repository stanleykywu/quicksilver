import {
    CAPTURE_STATUS,
    MESSAGE_TYPE,
    OFFSCREEN_DOCUMENT_PATH,
    OFFSCREEN_DOCUMENT_REASONS,
    RECORDING_DURATION_MS
} from "./constants.js";
import {
    getActiveCaptureSession,
    getLatestDetectionForUrl
} from "./storage.js";

const recordButton = document.getElementById("record");
const cancelButton = document.getElementById("cancel");
const timerDisplay = document.getElementById("timer");
const statusLabel = document.getElementById("status-label");
const pageTitleDisplay = document.getElementById("page-title");
const resultsList = document.getElementById("results-list");

let activePage = null;
let activeCaptureSession = null;
let countdownInterval = null;
let offscreenCreationPromise = null;
let hasLiveOffscreenSession = false;

recordButton.addEventListener("click", () => {
    void startCapture();
});

cancelButton.addEventListener("click", () => {
    void cancelCapture();
});

chrome.runtime.onMessage.addListener((message) => {
    void handleRuntimeMessage(message);
});

void initialize();

async function initialize() {
    await loadActiveTab();
    await reconcileRuntimeState();
    await restoreFromPersistence();
    await renderResultsPanel();
}

async function startCapture() {
    if (activeCaptureSession) {
        return;
    }

    await loadActiveTab();

    if (!activePage?.url || !activePage.tabId) {
        showEmptyResult("This page cannot be analyzed.");
        return;
    }

    const session = createCaptureSession(activePage);

    try {
        applyCaptureState(session);
        await renderResultsPanel(session);

        await ensureOffscreenDocument();
        const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: activePage.tabId
        });

        await chrome.runtime.sendMessage({
            type: MESSAGE_TYPE.START_CAPTURE,
            session,
            streamId
        });
    } catch (error) {
        console.error("Failed to start capture", error);
        applyCaptureState(null);
        await closeOffscreenDocumentIfPresent();
        await renderResultsPanel();
    }
}

async function cancelCapture() {
    if (!activeCaptureSession) {
        return;
    }

    const cancelingSession = {
        ...activeCaptureSession,
        status: CAPTURE_STATUS.CANCELING,
        cancelReason: "user_cancel"
    };

    try {
        activeCaptureSession = cancelingSession;
        applyCaptureState(cancelingSession);

        await chrome.runtime.sendMessage({
            type: MESSAGE_TYPE.CANCEL_CAPTURE,
            sessionId: cancelingSession.sessionId,
            reason: "user_cancel"
        });
    } catch (error) {
        console.error("Failed to cancel capture", error);
        await reconcileRuntimeState();
        await restoreFromPersistence();
        await renderResultsPanel();
    }
}

async function handleRuntimeMessage(message) {
    if (!message?.type) {
        return;
    }

    if (message.type === MESSAGE_TYPE.STATE_CHANGED) {
        activeCaptureSession = message.session || null;
        applyCaptureState(activeCaptureSession);
        await renderResultsPanel();
        return;
    }

    if (message.type === MESSAGE_TYPE.DETECTION_COMPLETED) {
        await renderResultsPanel();
        return;
    }

    if (message.type === MESSAGE_TYPE.DETECTION_FAILED) {
        console.error("Detection failed", message.stage, message.message);
        return;
    }

    if (message.type === MESSAGE_TYPE.CAPTURE_FINISHED) {
        activeCaptureSession = null;
        await closeOffscreenDocumentIfPresent();
        await restoreFromPersistence();
        await renderResultsPanel();
    }
}

async function loadActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const normalizedUrl = normalizePageUrl(tab?.url || "");

    activePage = {
        tabId: tab?.id ?? null,
        title: tab?.title || "Unknown page",
        url: normalizedUrl
    };

    pageTitleDisplay.textContent = activePage.title;
}

async function reconcileRuntimeState() {
    const [persistedSession, offscreenExists] = await Promise.all([
        getActiveCaptureSession(),
        hasOffscreenDocument()
    ]);

    hasLiveOffscreenSession = Boolean(persistedSession && offscreenExists);

    if (persistedSession && !offscreenExists) {
        return;
    }

    if (!persistedSession && offscreenExists) {
        await closeOffscreenDocumentIfPresent();
    }
}

async function restoreFromPersistence(fallbackSession = null) {
    activeCaptureSession = hasLiveOffscreenSession
        ? await getActiveCaptureSession()
        : null;
    applyCaptureState(activeCaptureSession || fallbackSession);
}

function applyCaptureState(session) {
    if (!session) {
        renderIdleState();
        return;
    }

    const status = session.status;
    const isCancelable =
        status === CAPTURE_STATUS.INITIALIZING ||
        status === CAPTURE_STATUS.CAPTURING;

    recordButton.disabled = true;
    cancelButton.disabled = !isCancelable;

    if (status === CAPTURE_STATUS.INITIALIZING) {
        statusLabel.textContent = "Starting capture...";
        startCountdown(session.deadlineAt);
        return;
    }

    if (status === CAPTURE_STATUS.CANCELING) {
        statusLabel.textContent = "Stopping...";
        startCountdown(session.deadlineAt);
        return;
    }

    if (status === CAPTURE_STATUS.INFERRING) {
        statusLabel.textContent = "Analyzing...";
        stopCountdown();
        setTimerDisplay(0);
        return;
    }

    statusLabel.textContent = "Listening...";
    startCountdown(session.deadlineAt);
}

function renderIdleState() {
    recordButton.disabled = !activePage?.url;
    cancelButton.disabled = true;
    statusLabel.textContent = "Ready to record";
    stopCountdown();
    setTimerDisplay(RECORDING_DURATION_MS);
}

async function renderResultsPanel(fallbackSession = null) {
    const visibleSession = activeCaptureSession || fallbackSession;

    if (visibleSession) {
        renderPendingResult(visibleSession);
        return;
    }

    if (!activePage?.url) {
        showEmptyResult("This page cannot be analyzed.");
        return;
    }

    try {
        const detection = await getLatestDetectionForUrl(activePage.url);

        if (!detection) {
            showEmptyResult("No saved result for this page.");
            return;
        }

        renderResultItem({
            title: detection.title || activePage.title,
            url: detection.url || activePage.url,
            status: detection.verdict || "Saved result",
            meta: `AI probability: ${formatScore(detection.score)}\nLast updated: ${formatTimestamp(detection.completedAt)}`,
            pending: false
        });
    } catch (error) {
        console.error("Failed to render results", error);
        showEmptyResult("No saved result for this page.");
    }
}

function renderPendingResult(session) {
    renderResultItem({
        title: session.tabTitle,
        url: session.normalizedUrl,
        status: getPendingStatusLabel(session.status),
        meta: "A saved result will appear after the 30 second sample.",
        pending: true
    });
}

function getPendingStatusLabel(status) {
    if (status === CAPTURE_STATUS.INITIALIZING) {
        return "Starting capture...";
    }

    if (status === CAPTURE_STATUS.CANCELING) {
        return "Stopping...";
    }

    if (status === CAPTURE_STATUS.INFERRING) {
        return "Analyzing...";
    }

    return "Listening...";
}

function startCountdown(deadlineAt) {
    const deadline = Number(deadlineAt) || Date.now();
    updateTimer(deadline);

    stopCountdown();
    countdownInterval = setInterval(() => {
        updateTimer(deadline);
    }, 200);
}

function updateTimer(deadlineAt) {
    const remainingMs = Math.max(0, deadlineAt - Date.now());
    setTimerDisplay(remainingMs);

    if (remainingMs <= 0) {
        stopCountdown();
    }
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

function setTimerDisplay(msRemaining) {
    const totalSeconds = Math.ceil(msRemaining / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    timerDisplay.textContent = `${minutes}:${seconds}`;
}

function renderResultItem({ title, url, status, meta, pending }) {
    resultsList.innerHTML = `
        <div class="result-item${pending ? " pending" : ""}">
            <div class="result-item-title">${escapeHtml(title || "Untitled page")}</div>
            <div class="result-item-url">${escapeHtml(url || "")}</div>
            <div class="result-item-status">${escapeHtml(status || "")}</div>
            <div class="result-item-meta">${escapeHtml(meta || "")}</div>
        </div>
    `;
}

function showEmptyResult(message) {
    resultsList.innerHTML = `<div class="results-empty">${escapeHtml(message)}</div>`;
}

function normalizePageUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        url.hash = "";
        return url.toString();
    } catch (error) {
        console.error("Failed to normalize URL", rawUrl, error);
        return null;
    }
}

function createCaptureSession(page) {
    const startedAt = Date.now();

    return {
        sessionId: crypto.randomUUID(),
        status: CAPTURE_STATUS.INITIALIZING,
        startedAt,
        deadlineAt: startedAt + RECORDING_DURATION_MS,
        tabId: page.tabId,
        tabUrl: page.url,
        normalizedUrl: page.url,
        tabTitle: page.title,
        sampleRate: null,
        capturedChunkCount: 0,
        capturedFrameCount: 0,
        cancelReason: null,
        error: null
    };
}

async function ensureOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        return;
    }

    if (!offscreenCreationPromise) {
        offscreenCreationPromise = chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: OFFSCREEN_DOCUMENT_REASONS,
            justification: "Capture tab audio and run local inference."
        }).finally(() => {
            offscreenCreationPromise = null;
        });
    }

    await offscreenCreationPromise;
}

async function hasOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
}

async function closeOffscreenDocumentIfPresent() {
    if (!(await hasOffscreenDocument())) {
        return;
    }

    try {
        await chrome.offscreen.closeDocument();
    } catch (error) {
        console.error("Failed to close offscreen document", error);
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatScore(score) {
    if (typeof score !== "number" || Number.isNaN(score)) {
        return "Unavailable";
    }

    return `${(score * 100).toFixed(1)}%`;
}

function formatTimestamp(timestamp) {
    if (!timestamp) {
        return "Unknown";
    }

    return new Date(timestamp).toLocaleString();
}

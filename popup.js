const recordButton = document.getElementById("record");
const cancelButton = document.getElementById("cancel");
const timerDisplay = document.getElementById("timer");
const statusLabel = document.getElementById("status-label");
const pageTitleDisplay = document.getElementById("page-title");
const resultsList = document.getElementById("results-list");
const resultsEmpty = document.getElementById("results-empty");

const RECORDING_DURATION_MS = 30_000;

let activePage;
let isRecording = false;
let countdownInterval;
let countdownEnd;

initialize();

recordButton.addEventListener("click", async () => {
    if (isRecording) {
        return;
    }

    if (!activePage?.url) {
        showEmptyResult("This page cannot be analyzed", "Open a standard web page to record tab audio.");
        return;
    }

    try {
        setPendingResultState();
        await chrome.runtime.sendMessage({ type: "START_RECORDING" });
    } catch (err) {
        console.error("Failed to start recording", err);
        renderIdleState();
        await renderResultsPanel();
    }
});

cancelButton.addEventListener("click", () => {
    requestCancel("user");
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "UI_RECORDING_FINISHED") {
        renderIdleState();
        renderResultsPanel();
    }

    if (msg.type === "UI_RECORDING_STATE_UPDATED") {
        applyRecordingState(msg.recordingState);
    }

    if (msg.type === "UI_DETECTION_SAVED") {
        renderResultsPanel();
    }

    if (msg.type === "UI_DETECTION_ERROR") {
        if (!isRecording) {
            renderResultsPanel();
        }
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
        return;
    }

    if (changes.recordingState) {
        applyRecordingState(changes.recordingState.newValue || null);
    }

    if (changes.detectionsByUrl) {
        renderResultsPanel();
    }
});

async function initialize() {
    await loadActiveTab();
    await restoreState();
    await renderResultsPanel();
}

async function loadActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const normalizedUrl = normalizePageUrl(tab?.url || "");

    activePage = {
        title: tab?.title || "Unknown page",
        url: normalizedUrl
    };

    pageTitleDisplay.textContent = activePage.title;
    recordButton.disabled = !activePage.url;
}

async function restoreState() {
    try {
        const stored = await chrome.storage.local.get("recordingState");
        applyRecordingState(stored.recordingState || null);
    } catch (err) {
        console.error("Failed to restore state", err);
        renderIdleState();
    }
}

function applyRecordingState(state) {
    if (!state || !state.isRecording || !state.countdownEnd) {
        renderIdleState();
        return;
    }

    const remaining = state.countdownEnd - Date.now();
    if (remaining <= 0) {
        renderIdleState();
        return;
    }

    isRecording = true;
    recordButton.disabled = true;
    cancelButton.disabled = state.status === "stopping";
    statusLabel.textContent = state.status === "stopping" ? "Stopping..." : "Listening...";
    startCountdown(state.countdownEnd);
}

function renderIdleState() {
    isRecording = false;
    recordButton.disabled = false;
    cancelButton.disabled = true;
    statusLabel.textContent = "Ready to record";
    stopCountdown();
    setTimerDisplay(RECORDING_DURATION_MS);
}

function setPendingResultState() {
    statusLabel.textContent = "Starting capture...";

    if (!activePage?.url) {
        return;
    }

    renderResultItem({
        title: activePage.title,
        url: activePage.url,
        status: "Listening...",
        meta: "A saved result will appear after the 30 second sample.",
        pending: true
    });
}

function requestCancel(reason) {
    if (!isRecording) {
        return;
    }

    cancelButton.disabled = true;
    statusLabel.textContent = "Stopping...";
    chrome.runtime.sendMessage({ type: "STOP_RECORDING", reason }).catch((err) => {
        console.error("Failed to cancel recording", err);
    });
}

function startCountdown(endTime) {
    countdownEnd = endTime;
    setTimerDisplay(countdownEnd - Date.now());

    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    countdownInterval = setInterval(() => {
        const remaining = Math.max(0, countdownEnd - Date.now());
        setTimerDisplay(remaining);
        if (remaining <= 0) {
            stopCountdown();
        }
    }, 200);
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = undefined;
    }
}

function setTimerDisplay(msRemaining) {
    const totalSeconds = Math.ceil(msRemaining / 1000);
    const seconds = Math.max(0, totalSeconds % 60).toString().padStart(2, "0");
    const minutes = Math.max(0, Math.floor(totalSeconds / 60)).toString().padStart(2, "0");
    timerDisplay.textContent = `${minutes}:${seconds}`;
}

async function renderResultsPanel() {
    const stored = await chrome.storage.local.get("recordingState");
    const recordingState = stored.recordingState || null;

    if (recordingState?.isRecording && recordingState.url) {
        renderResultItem({
            title: recordingState.title,
            url: recordingState.url,
            status: recordingState.status === "stopping" ? "Stopping..." : "Listening...",
            metaLine1: "A saved result will appear after the 30 second sample.",
            metaLine2: "",
            pending: true
        });
        return;
    }

    await renderSavedResult();
}

async function renderSavedResult() {
    if (!activePage?.url) {
        showEmptyResult("No saved result for this page");
        return;
    }

    try {
        const stored = await chrome.storage.local.get("detectionsByUrl");
        const detection = stored.detectionsByUrl?.[activePage.url];

        if (!detection) {
            showEmptyResult("No saved result for this page");
            return;
        }

        renderResultItem({
            title: detection.title || activePage.title,
            url: detection.url || activePage.url,
            status: detection.verdict || "Saved result",
            meta: `AI probability: ${formatScore(detection.score)}\nLast updated: ${formatTimestamp(detection.updatedAt)}`,
            pending: false
        });
    } catch (err) {
        console.error("Failed to restore saved result", err);
        showEmptyResult("No saved result for this page");
    }
}

function showEmptyResult(message) {
    resultsList.innerHTML = `<div id="results-empty" class="results-empty">${message}</div>`;
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

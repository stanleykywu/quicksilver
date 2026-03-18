const recordButton = document.getElementById("record");
const cancelButton = document.getElementById("cancel");
const timerDisplay = document.getElementById("timer");
const resultDisplay = document.getElementById("result");

let isRecording = false;
let countdownInterval;
let countdownEnd;

restoreState();
restoreResult();

recordButton.addEventListener("click", async () => {
    if (isRecording) return;

    try {
        resultDisplay.textContent = "Listening...";
        await chrome.runtime.sendMessage({ type: "START_RECORDING" });
        enterRecordingState();
    } catch (err) {
        console.error("Failed to start recording", err);
        exitRecordingState();
    }
});

cancelButton.addEventListener("click", () => {
    requestCancel("user");
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "RECORDING_FINISHED") {
        exitRecordingState();
    }

    if (msg.type === "DETECTION_RESULT") {
        resultDisplay.textContent = msg.verdict;
        chrome.storage.local.set({
            detectionResult: {
                verdict: msg.verdict,
                score: msg.result
            }
        });
    }
});

function enterRecordingState() {
    isRecording = true;
    recordButton.disabled = true;
    cancelButton.disabled = false;
    startCountdown(Date.now() + 30_000);
    persistState();
}

function exitRecordingState() {
    isRecording = false;
    recordButton.disabled = false;
    cancelButton.disabled = true;
    stopCountdown();
    setTimerDisplay(30_000);
    clearState();
}

function requestCancel(reason) {
    if (!isRecording) return;
    cancelButton.disabled = true;
    stopCountdown();
    persistState();
    chrome.runtime.sendMessage({ type: "STOP_RECORDING", reason }).catch((err) => {
        console.error("Failed to cancel recording", err);
    });
}

function startCountdown(endTime) {
    countdownEnd = endTime;
    setTimerDisplay(countdownEnd - Date.now());
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

async function restoreState() {
    try {
        const stored = await chrome.storage.local.get("recordingState");
        const state = stored.recordingState;
        if (!state || !state.isRecording || !state.countdownEnd) {
            setTimerDisplay(30_000);
            return;
        }

        const remaining = state.countdownEnd - Date.now();
        if (remaining <= 0) {
            clearState();
            setTimerDisplay(30_000);
            return;
        }

        isRecording = true;
        recordButton.disabled = true;
        cancelButton.disabled = false;
        startCountdown(state.countdownEnd);
    } catch (err) {
        console.error("Failed to restore state", err);
        setTimerDisplay(30_000);
    }
}

async function restoreResult() {
    try {
        const stored = await chrome.storage.local.get("detectionResult");
        const saved = stored.detectionResult;

        if (saved && saved.verdict) {
            resultDisplay.textContent = saved.verdict;
        } else {
            resultDisplay.textContent = "No result yet";
        }
    } catch (err) {
        console.error("Failed to restore result", err);
        resultDisplay.textContent = "No result yet";
    }
}

function persistState() {
    try {
        chrome.storage.local.set({ recordingState: { isRecording, countdownEnd } });
    } catch (err) {
        console.error("Failed to persist state", err);
    }
}

function clearState() {
    try {
        chrome.storage.local.remove("recordingState");
    } catch (err) {
        console.error("Failed to clear state", err);
    }
}
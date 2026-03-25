import {
    CAPTURE_STATUS,
    MESSAGE_TYPE,
    RECORDING_DURATION_MS
} from "./constants.js";
import {
    appendDetectionHistory,
    clearActiveCaptureSession,
    setActiveCaptureSession
} from "./storage.js";

let audioContext = null;
let sourceNode = null;
let monitorGainNode = null;
let workletNode = null;
let workletSinkNode = null;
let currentStream = null;
let stopTimeoutId = null;
let currentSession = null;
let isFinalizing = false;
let pendingStopReason = null;
let pcmChunks = [];
let sampleRate = null;
let runInference = null;

const wasmRuntimePromise = initializeWasm();

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MESSAGE_TYPE.START_CAPTURE) {
        void startCapture(message.session, message.streamId);
    }

    if (message?.type === MESSAGE_TYPE.CANCEL_CAPTURE) {
        void cancelCapture(message.sessionId, message.reason || "user_cancel");
    }
});

async function initializeWasm() {
    const wasmModule = await import("./pkg/ai_music_browser_detector.js");
    await wasmModule.default();
    runInference = wasmModule.run_inference;
}

async function startCapture(session, streamId) {
    if (!session || !streamId) {
        return;
    }

    if (currentSession) {
        return;
    }

    pendingStopReason = null;
    pcmChunks = [];
    sampleRate = null;
    isFinalizing = false;

    currentSession = {
        ...session,
        status: CAPTURE_STATUS.INITIALIZING,
        capturedChunkCount: 0,
        capturedFrameCount: 0,
        cancelReason: null,
        error: null
    };

    try {
        await persistSession();
        await notifyStateChanged();
        await wasmRuntimePromise;

        currentStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: "tab",
                    chromeMediaSourceId: streamId
                }
            },
            video: false
        });

        await setupAudioGraph(currentStream);

        currentSession = {
            ...currentSession,
            status: CAPTURE_STATUS.CAPTURING,
            sampleRate
        };
        await persistSession();
        await notifyStateChanged();

        stopTimeoutId = setTimeout(() => {
            void finalizeCapture("timeout");
        }, RECORDING_DURATION_MS);

        if (pendingStopReason) {
            await cancelCapture(session.sessionId, pendingStopReason);
        }
    } catch (error) {
        await failSession("capture_start", error);
    }
}

async function cancelCapture(sessionId, reason) {
    if (!currentSession || currentSession.sessionId !== sessionId) {
        return;
    }

    // don't cancel if we're still initializing
    // queue it to be handled right after initialization completes
    if (currentSession.status === CAPTURE_STATUS.INITIALIZING) {
        pendingStopReason = reason;
    }

    if (currentSession.status == CAPTURE_STATUS.CAPTURING) {
        currentSession = {
            ...currentSession,
            status: CAPTURE_STATUS.CANCELING,
            cancelReason: reason
        };
        await persistSession();
        await notifyStateChanged();
        await finalizeCapture(reason);
    }
}

async function setupAudioGraph(stream) {
    audioContext = new AudioContext();
    sampleRate = audioContext.sampleRate;

    sourceNode = audioContext.createMediaStreamSource(stream);

    monitorGainNode = audioContext.createGain();
    monitorGainNode.gain.value = 1;
    sourceNode.connect(monitorGainNode);
    monitorGainNode.connect(audioContext.destination);

    await audioContext.audioWorklet.addModule("processor.js");

    workletNode = new AudioWorkletNode(audioContext, "pcm-processor", {
        outputChannelCount: [2]
    });
    workletNode.port.onmessage = handleWorkletMessage;

    workletSinkNode = audioContext.createGain();
    workletSinkNode.gain.value = 0;

    sourceNode.connect(workletNode);
    workletNode.connect(workletSinkNode);
    workletSinkNode.connect(audioContext.destination);
}

function handleWorkletMessage(event) {
    if (!currentSession || currentSession.status === CAPTURE_STATUS.CANCELING) {
        return;
    }

    const chunk = event.data;
    if (!(chunk instanceof Float32Array) || chunk.length === 0) {
        return;
    }

    pcmChunks.push(chunk);
    currentSession = {
        ...currentSession,
        capturedChunkCount: currentSession.capturedChunkCount + 1,
        capturedFrameCount: currentSession.capturedFrameCount + chunk.length / 2
    };
}

async function finalizeCapture(reason) {
    if (!currentSession || isFinalizing) {
        return;
    }

    isFinalizing = true;
    clearStopTimeout();

    const shouldRunInference = reason === "timeout";
    const sessionSnapshot = currentSession;
    const flattenedPcm = shouldRunInference ? flattenPcmChunks(pcmChunks) : new Float32Array(0);

    try {
        if (shouldRunInference) {
            currentSession = {
                ...currentSession,
                status: CAPTURE_STATUS.INFERRING
            };
            await persistSession();
            await notifyStateChanged();
        }

        await cleanupAudioResources();

        if (shouldRunInference) {
            await completeInference(sessionSnapshot, flattenedPcm);
        }

        await resetSessionState();
        await notifyCaptureFinished(sessionSnapshot.sessionId, reason);
    } catch (error) {
        await failSession("finalize_capture", error);
    } finally {
        discardCapturedAudio();
        isFinalizing = false;
    }
}

async function completeInference(sessionSnapshot, flattenedPcm) {
    if (!runInference) {
        throw new Error("WASM runtime is not available.");
    }

    if (flattenedPcm.length === 0) {
        throw new Error("No audio samples were captured.");
    }

    const numericScore = Number(runInference(flattenedPcm, sampleRate));
    if (!Number.isFinite(numericScore)) {
        throw new Error("Inference returned an invalid score.");
    }

    const completedAt = Date.now();
    const score = numericScore;
    const verdict = score > 0.5 ? "Likely AI" : "Unlikely AI";
    const historyEntry = {
        sessionId: sessionSnapshot.sessionId,
        normalizedUrl: sessionSnapshot.normalizedUrl,
        url: sessionSnapshot.tabUrl,
        title: sessionSnapshot.tabTitle,
        capturedAt: sessionSnapshot.startedAt,
        completedAt,
        score,
        verdict,
        sampleRate
    };

    await appendDetectionHistory(historyEntry);
    await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.DETECTION_COMPLETED,
        sessionId: sessionSnapshot.sessionId,
        normalizedUrl: sessionSnapshot.normalizedUrl,
        score,
        verdict,
        sampleRate,
        capturedAt: sessionSnapshot.startedAt,
        completedAt
    }).catch(() => { });
}

async function failSession(stage, error) {
    const sessionId = currentSession?.sessionId ?? null;
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Offscreen failure during ${stage}`, error);

    clearStopTimeout();
    await cleanupAudioResources().catch(() => { });
    discardCapturedAudio();
    await clearActiveCaptureSession().catch(() => { });

    currentSession = null;
    pendingStopReason = null;

    await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.STATE_CHANGED,
        session: null
    }).catch(() => { });

    await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.DETECTION_FAILED,
        sessionId,
        stage,
        message
    }).catch(() => { });

    await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.CAPTURE_FINISHED,
        sessionId,
        reason: "error"
    }).catch(() => { });
}

async function persistSession() {
    if (!currentSession) {
        return;
    }

    await setActiveCaptureSession(currentSession);
}

async function notifyStateChanged() {
    await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.STATE_CHANGED,
        session: currentSession
    }).catch(() => { });
}

async function notifyCaptureFinished(sessionId, reason) {
    await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.STATE_CHANGED,
        session: null
    }).catch(() => { });

    await chrome.runtime.sendMessage({
        type: MESSAGE_TYPE.CAPTURE_FINISHED,
        sessionId,
        reason
    }).catch(() => { });
}

async function resetSessionState() {
    await clearActiveCaptureSession();
    currentSession = null;
    pendingStopReason = null;
}

async function cleanupAudioResources() {
    if (workletNode) {
        workletNode.port.onmessage = null;
        workletNode.disconnect();
    }

    if (workletSinkNode) {
        workletSinkNode.disconnect();
    }

    if (monitorGainNode) {
        monitorGainNode.disconnect();
    }

    if (sourceNode) {
        sourceNode.disconnect();
    }

    if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
    }

    if (audioContext && audioContext.state !== "closed") {
        await audioContext.close();
    }

    audioContext = null;
    sourceNode = null;
    monitorGainNode = null;
    workletNode = null;
    workletSinkNode = null;
    currentStream = null;
}

function discardCapturedAudio() {
    pcmChunks = [];
    sampleRate = null;
}

function clearStopTimeout() {
    if (stopTimeoutId) {
        clearTimeout(stopTimeoutId);
        stopTimeoutId = null;
    }
}

function flattenPcmChunks(chunks) {
    const totalLength = chunks.reduce((length, chunk) => length + chunk.length, 0);
    const flattened = new Float32Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
        flattened.set(chunk, offset);
        offset += chunk.length;
    }

    return flattened;
}

function isCurrentRun(runId) {
    return runId === currentRunId && Boolean(currentSession);
}

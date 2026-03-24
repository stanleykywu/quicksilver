let audioContext;
let source;
let workletNode;
let monitorGain;
let currentStream;
let stopTimeoutId;
let recordingSession;
let pcmData = [];
let recordedSampleRate;
let stopping = false;
let detector;

const RECORDING_DURATION_MS = 30_000;
const wasmReady = initWasm();

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CAPTURE_STREAM") {
        return startCapture(msg.streamId, msg.session);
    }

    if (msg.type === "STOP_RECORDING") {
        return stopRecording(msg.reason || "cancelled");
    }

    return undefined;
});

async function initWasm() {
    try {
        const wasmModule = await import("./pkg/ai_music_browser_detector.js");
        await wasmModule.default();
        detector = wasmModule.run_inference;
    } catch (err) {
        console.error("Failed to initialize WASM module", err);
    }
}

async function startCapture(streamId, session) {
    if (recordingSession) {
        await stopRecording("restarted");
    }

    recordingSession = session || null;
    currentStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: "tab",
                chromeMediaSourceId: streamId
            }
        },
        video: false
    });

    await startRecording(currentStream);
}

async function startRecording(stream) {
    audioContext = new AudioContext();
    recordedSampleRate = audioContext.sampleRate;

    await audioContext.audioWorklet.addModule("processor.js");

    source = audioContext.createMediaStreamSource(stream);

    monitorGain = audioContext.createGain();
    monitorGain.gain.value = 1;
    source.connect(monitorGain);
    monitorGain.connect(audioContext.destination);

    workletNode = new AudioWorkletNode(audioContext, "pcm-processor", {
        outputChannelCount: [2]
    });

    workletNode.port.onmessage = (event) => {
        pcmData.push(event.data);
    };

    source.connect(workletNode);
    workletNode.connect(audioContext.destination);

    stopTimeoutId = setTimeout(() => {
        stopRecording("timeout");
    }, RECORDING_DURATION_MS);
}

async function stopRecording(reason = "finished") {
    if (stopping) {
        return;
    }

    stopping = true;

    if (stopTimeoutId) {
        clearTimeout(stopTimeoutId);
        stopTimeoutId = undefined;
    }

    const shouldRunInference = reason === "finished" || reason === "timeout";
    const flattened = flattenPCM(pcmData);
    const sampleRate = recordedSampleRate;

    await cleanupAudioGraph();

    if (shouldRunInference) {
        await runInference(flattened, sampleRate, reason);
    }

    pcmData = [];
    recordingSession = undefined;
    recordedSampleRate = undefined;
    stopping = false;

    await chrome.runtime.sendMessage({
        type: "RECORDING_FINISHED",
        reason
    });
}

async function runInference(flattened, sampleRate, reason) {
    await wasmReady;

    if (!detector) {
        await chrome.runtime.sendMessage({
            type: "DETECTION_ERROR",
            reason,
            error: "WASM detector is not available."
        });
        return;
    }

    if (!flattened.length) {
        await chrome.runtime.sendMessage({
            type: "DETECTION_ERROR",
            reason,
            error: "No audio samples were captured."
        });
        return;
    }

    try {
        const score = detector(flattened, sampleRate);
        const verdict = score > 0.5 ? "Likely AI" : "Unlikely AI";

        await chrome.runtime.sendMessage({
            type: "DETECTION_RESULT",
            score,
            verdict,
            sampleRate,
            reason,
            session: recordingSession
        });
    } catch (err) {
        console.error("WASM inference failed", err);
        await chrome.runtime.sendMessage({
            type: "DETECTION_ERROR",
            reason,
            error: err instanceof Error ? err.message : String(err)
        });
    }
}

async function cleanupAudioGraph() {
    if (workletNode) {
        workletNode.disconnect();
        workletNode.port.onmessage = null;
    }

    if (source) {
        source.disconnect();
    }

    if (monitorGain) {
        monitorGain.disconnect();
    }

    if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
    }

    if (audioContext) {
        await audioContext.close();
    }

    workletNode = undefined;
    source = undefined;
    monitorGain = undefined;
    currentStream = undefined;
    audioContext = undefined;
}

function flattenPCM(chunks) {
    const length = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Float32Array(length);
    let offset = 0;

    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}

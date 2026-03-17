let audioContext;
let source;
let workletNode;
let pcmData = [];
let currentStream;
let recordedSampleRate; // Store the actual rate
let stopTimeoutId;
let stopping = false;
let monitorGain;
let detector; // function exported from WASM module

const wasmReady = initWasm();

async function initWasm() {
    try {
        const wasmModule = await import('./pkg/ai_music_browser_detector.js');
        await wasmModule.default();
        detector = wasmModule.run_inference;
    } catch (err) {
        console.error('Failed to initialize WASM module', err);
    }
}

chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === "CAPTURE_STREAM") {
        currentStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: "tab",
                    chromeMediaSourceId: msg.streamId
                }
            },
            video: false
        });
        startRecording(currentStream);
    }

    if (msg.type === "STOP_RECORDING") {
        stopRecording(msg.reason || "cancelled");
    }
});

async function startRecording(stream) {
    audioContext = new AudioContext();
    // Capture the REAL sample rate of the hardware/stream
    recordedSampleRate = audioContext.sampleRate;

    await audioContext.audioWorklet.addModule('processor.js');

    source = audioContext.createMediaStreamSource(stream);

    // Keep audio audible in the tab by routing it
    // through the offscreen context to the output
    monitorGain = audioContext.createGain();
    monitorGain.gain.value = 1;
    source.connect(monitorGain);
    monitorGain.connect(audioContext.destination);

    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor', {
        outputChannelCount: [2]
    });

    workletNode.port.onmessage = (event) => {
        pcmData.push(event.data);
    };

    source.connect(workletNode);
    workletNode.connect(audioContext.destination);

    stopTimeoutId = setTimeout(() => stopRecording("timeout"), 30000);
}

async function stopRecording(reason = "finished") {
    if (stopping) return; // If we're already stopping, don't run this again.
    stopping = true;

    if (stopTimeoutId) {
        clearTimeout(stopTimeoutId);
        stopTimeoutId = undefined;
    }

    // Regardless of the reason, we always sent a "RECORDING_FINISHED"
    // message to background.js at the end, so it can clean up.
    if (!workletNode && !currentStream && !audioContext) {
        stopping = false; // Because we finished stopping (i.e., did nothing)
        chrome.runtime.sendMessage({ type: "RECORDING_FINISHED", reason });
        return;
    }

    if (workletNode) {
        workletNode.disconnect();
    }

    if (source) {
        source.disconnect();
    }

    if (monitorGain) {
        monitorGain.disconnect();
    }

    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    if (audioContext) {
        await audioContext.close();
    }

    await wasmReady;
    const flattened = flattenPCM(pcmData);
    if (detector && flattened.length > 0 && (reason === "finished" || reason === "timeout")) {

        try {
            const result = detector(flattened, recordedSampleRate);
            const verdict = result > 0.5 ? "Likely AI" : "Unlikely AI";

            console.log("WASM detection result:", result);
            console.log("Detected verdict:", verdict);

            chrome.runtime.sendMessage({
                type: "DETECTION_RESULT",
                result,
                verdict
            });
        } catch (err) {
            console.error("WASM inference failed", {
                error: err instanceof Error ? err.message : String(err),
                flattenedLength: flattened.length,
                reason
            });
        }
    }

    pcmData = [];
    workletNode = undefined;
    source = undefined;
    monitorGain = undefined;
    audioContext = undefined;
    currentStream = undefined;
    recordedSampleRate = undefined;
    stopping = false;

    chrome.runtime.sendMessage({ type: "RECORDING_FINISHED", reason });
}

function flattenPCM(chunks) {
    let length = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    let result = new Float32Array(length);
    let offset = 0;
    for (let chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

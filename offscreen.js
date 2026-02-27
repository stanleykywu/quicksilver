let audioContext;
let source;
let workletNode;
let pcmData = [];
let currentStream;
let recordedSampleRate; // Store the actual rate
let stopTimeoutId;
let stopping = false;
let monitorGain;
let averagePcm32Wasm; // function exported from WASM module

const wasmReady = initWasm();

async function initWasm() {
    try {
        const wasmModule = await import('./pkg/ai_music_browser_detector.js');
        await wasmModule.default();
        averagePcm32Wasm = wasmModule.average_pcm32;
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
    if (averagePcm32Wasm && flattened.length > 0) {
        const average = averagePcm32Wasm(flattened);
        console.log("WASM average PCM32:", average);
    }

    if (flattened.length > 0 && (reason === "finished" || reason === "timeout")) {
        // Use the rate we captured at the start
        downloadWav(flattened, recordedSampleRate);
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

function downloadWav(floats, sampleRate) {
    const buffer = new ArrayBuffer(44 + floats.length * 2);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + floats.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);

    // This is the critical part: The header must match the actual samples
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true); // ByteRate: Rate * NumChannels * BytesPerSample

    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, floats.length * 2, true);

    let index = 44;
    for (let i = 0; i < floats.length; i++) {
        let s = Math.max(-1, Math.min(1, floats[i]));
        view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        index += 2;
    }

    const blob = new Blob([view], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tab-audio-${sampleRate}hz.wav`;
    a.click();
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

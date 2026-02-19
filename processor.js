class PCMProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        // Check if we have input and at least one channel
        if (input && input.length > 0) {
            const leftChannel = input[0];
            // If the source is mono, input[1] will be undefined; we duplicate L to R
            const rightChannel = input[1] || input[0];

            const interleaved = new Float32Array(leftChannel.length * 2);
            for (let i = 0; i < leftChannel.length; i++) {
                interleaved[i * 2] = leftChannel[i];
                interleaved[i * 2 + 1] = rightChannel[i];
            }

            this.port.postMessage(interleaved);
        }
        return true;
    }
}

registerProcessor('pcm-processor', PCMProcessor);
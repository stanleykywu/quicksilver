use realfft::RealFftPlanner;
use scirs2_core::ndarray::{Array2, Array3};

use crate::core::fakeprint::NUM_CHANNELS;

pub const N_FFT: usize = 1 << 14;

/// Get Hann window coefficients for a given window size.
fn hann_window(n: usize) -> Vec<f32> {
    if n == 0 {
        return vec![];
    }
    let m = (n - 1) as f32;
    (0..n)
        .map(|i| {
            let x = i as f32;
            0.5 - 0.5 * (2.0 * std::f32::consts::PI * x / m).cos()
        })
        .collect()
}

/// Reflect pad the signal by mirroring the first and last `pad` samples.
fn reflect_pad(signal: &[f32], pad: usize) -> Vec<f32> {
    let n = signal.len();
    let mut out = Vec::with_capacity(n + 2 * pad);

    // left reflection
    for i in (1..=pad).rev() {
        out.push(signal[i]);
    }

    out.extend_from_slice(signal);

    // right reflection
    for i in (n - pad - 1..n - 1).rev() {
        out.push(signal[i]);
    }

    out
}
/// Convert audio slice of shape [time, channels] to STFT input of shape [channels, frequency_bins, time_frames]
/// The ouput is in decibels, with a floor of -100 dB and a ceiling of 60 dB.
pub fn get_stft(audio_slice: &Array2<f32>) -> Array3<f32> {
    let hop = N_FFT / 2;
    let pad = N_FFT / 2;
    let n_bins = N_FFT / 2 + 1;
    let window = hann_window(N_FFT);

    let mut planner = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(N_FFT);

    let mut in_buf = r2c.make_input_vec();
    let mut out_buf = r2c.make_output_vec();
    let first_sig = audio_slice.column(0).to_vec(); // get the first channel
    let padded_sig = reflect_pad(&first_sig, pad);
    let n_frames = 1 + (padded_sig.len() - N_FFT) / hop;
    let mut stft = Array3::<f32>::zeros((NUM_CHANNELS, n_bins, n_frames));

    for ch in 0..NUM_CHANNELS {
        let sig = audio_slice.column(ch).to_vec();
        let padded_sig = reflect_pad(&sig, pad);
        for frame in 0..n_frames {
            let start = frame * hop;
            for i in 0..N_FFT {
                in_buf[i] = padded_sig[start + i] * window[i];
            }
            r2c.process(&mut in_buf, &mut out_buf).expect("FFT failed");
            for bin in 0..n_bins {
                let c = out_buf[bin];
                let power = c.re * c.re + c.im * c.im;
                let clipped = power.clamp(1e-10, 1e6);
                let db = 10.0 * clipped.log10();
                stft[[ch, bin, frame]] = db;
            }
        }
    }
    stft
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::fakeprint::open_audio_slice;
    use hound;
    use scirs2_core::ndarray::{Array2, s};
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize)]
    struct STFTResult {
        output_shape: Vec<usize>,
        output: Vec<Vec<Vec<f32>>>,
    }

    fn test_stft(audio_slice: &Array2<f32>, expected: &STFTResult) {
        let stft = get_stft(&audio_slice);
        let result = STFTResult {
            output_shape: stft.shape().to_vec(),
            output: stft
                .outer_iter()
                .map(|ch| ch.outer_iter().map(|bin| bin.to_vec()).collect())
                .collect(),
        };
        assert_eq!(result.output_shape, expected.output_shape);
        let mut tot_rel_err = 0.0;
        for (res_bin, exp_bin) in result.output.iter().zip(expected.output.iter()) {
            for (res_frame, exp_frame) in res_bin.iter().zip(exp_bin.iter()) {
                for (res_val, exp_val) in res_frame.iter().zip(exp_frame.iter()) {
                    tot_rel_err += (res_val - exp_val).abs() / exp_val.abs().max(1e-10);
                }
            }
        }
        let avg_err = tot_rel_err / (result.output_shape.iter().product::<usize>() as f32);
        assert!(avg_err < 1e-3, "Mean relative error too high: {}", avg_err);
    }

    #[test]
    fn test_stft1() {
        let mut reader =
            hound::WavReader::open("tests/assets/tom_scott.wav").expect("Failed to open WAV file");
        let spec = reader.spec();
        let samples = reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / i16::MAX as f32)
            .collect::<Vec<f32>>();
        let slice_end = spec.sample_rate as usize * 2;
        // get only first 2 seconds
        let audio_slice = open_audio_slice(&samples)
            .slice(s![..slice_end, ..])
            .to_owned();

        let expected =
            serde_json::from_str::<STFTResult>(include_str!("../../../tests/keys/stft1.json"))
                .expect("Failed to deserialize expected STFT result");
        test_stft(&audio_slice, &expected);
    }

    #[test]
    fn test_stft2() {
        let mut reader =
            hound::WavReader::open("tests/assets/tom_scott.wav").expect("Failed to open WAV file");
        let spec = reader.spec();
        let samples = reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / i16::MAX as f32)
            .collect::<Vec<f32>>();
        let slice_begin = spec.sample_rate as usize * 10;
        let slice_end = spec.sample_rate as usize * 11;
        // get only first 2 seconds
        let audio_slice = open_audio_slice(&samples)
            .slice(s![slice_begin..slice_end, ..])
            .to_owned();

        let expected =
            serde_json::from_str::<STFTResult>(include_str!("../../../tests/keys/stft2.json"))
                .expect("Failed to deserialize expected STFT result");
        test_stft(&audio_slice, &expected);
    }
}

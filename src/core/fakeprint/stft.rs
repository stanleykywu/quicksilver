use realfft::RealFftPlanner;
use scirs2_core::ndarray::{Array2, Array3};

use crate::core::fakeprint::NUM_CHANNELS;

pub const N_FFT: usize = 1 << 14;

// TODO: add unit tests for stft

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

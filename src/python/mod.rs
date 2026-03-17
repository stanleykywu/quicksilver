use crate::core::compute_fakeprint;
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

#[pyfunction(name = "compute_fakeprint")]
#[pyo3(signature = (pcm_audio, input_sample_rate, output_sample_rate=None, f_range=None))]
/// Python bindings for the `compute_fakeprint` function.
/// `pcm_audio` is a 1D array of audio samples in the range [-1.0, 1.0].
/// `input_sample_rate` is the sample rate of the input audio.
/// `output_sample_rate` is the desired sample rate for the output fakeprint.
/// If None, it defaults to 44.1 kHz.
/// `f_range` is a tuple of (min_freq, max_freq) to specify the frequency range for the fakeprint.
/// If None, it defaults to (5000, 16000) Hz.
fn py_compute_fakeprint(
    pcm_audio: Vec<f32>,
    input_sample_rate: u32,
    output_sample_rate: Option<u32>,
    f_range: Option<(f32, f32)>,
) -> PyResult<Vec<f32>> {
    if pcm_audio.is_empty() {
        return Err(PyValueError::new_err("pcm_audio is empty"));
    }

    Ok(compute_fakeprint(&pcm_audio, input_sample_rate, output_sample_rate, f_range).to_vec())
}

#[pyfunction(name = "compute_fakeprint_2d")]
#[pyo3(signature = (audio_2d, input_sample_rate, output_sample_rate=None, f_range=None))]
/// Python bindings for a 2D version of the `compute_fakeprint` function.
/// `audio_2d` is a 2D array of shape [time, channels] containing audio samples in the range [-1.0, 1.0].
/// `input_sample_rate` is the sample rate of the input audio.
/// `output_sample_rate` is the desired sample rate for the output fakeprint.
/// If None, it defaults to 44.1 kHz.
/// `f_range` is a tuple of (min_freq, max_freq) to specify the frequency range for the fakeprint.
/// If None, it defaults to (5000, 16000) Hz.
fn py_compute_fakeprint_2d(
    audio_2d: Vec<Vec<f32>>, // shape: [time, channels]
    input_sample_rate: u32,
    output_sample_rate: Option<u32>,
    f_range: Option<(f32, f32)>,
) -> PyResult<Vec<f32>> {
    if audio_2d.is_empty() {
        return Err(PyValueError::new_err("audio_2d is empty"));
    }

    // Flatten the 2D audio into a 1D array by interleaving the channels
    let mut pcm_audio = Vec::new();
    for frame in audio_2d {
        pcm_audio.extend(frame);
    }
    Ok(compute_fakeprint(&pcm_audio, input_sample_rate, output_sample_rate, f_range).to_vec())
}

pub fn register_python_module(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(py_compute_fakeprint, module)?)?;
    module.add_function(wrap_pyfunction!(py_compute_fakeprint_2d, module)?)?;
    Ok(())
}

#[pymodule]
pub fn fakepyrint(_py: Python<'_>, module: &Bound<'_, PyModule>) -> PyResult<()> {
    register_python_module(module)?;
    Ok(())
}

pub mod fakeprint;
pub use fakeprint::compute_fakeprint;

#[cfg(test)]
mod tests {
    use super::*;
    use hound;

    #[test]
    fn compute_fakeprint() {
        // skip test if the file doesn't exist
        if !std::path::Path::new("tests/test1-48000hz.wav").exists() {
            eprintln!("Skipping test_compute_fakeprint since test WAV file doesn't exist");
            return;
        }
        let mut reader =
            hound::WavReader::open("tests/test1-48000hz.wav").expect("Failed to open WAV file");
        let spec = reader.spec();
        let samples = reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / i16::MAX as f32)
            .collect::<Vec<f32>>();
        let fakeprint = fakeprint::compute_fakeprint(&samples, spec.sample_rate, None, None);
        assert!(!fakeprint.is_empty());
    }
}

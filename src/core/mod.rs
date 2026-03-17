pub mod fakeprint;
pub use fakeprint::compute_fakeprint;

#[cfg(test)]
mod tests {
    use super::*;
    use hound;

    #[test]
    fn compute_fakeprint() {
        let mut reader =
            hound::WavReader::open("tests/assets/tom_scott.wav").expect("Failed to open WAV file");
        let spec = reader.spec();
        let samples = reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / i16::MAX as f32)
            .collect::<Vec<f32>>();
        let fakeprint = fakeprint::compute_fakeprint(&samples, spec.sample_rate, None, None);
        assert!(!fakeprint.is_empty());
    }
}

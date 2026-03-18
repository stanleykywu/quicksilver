pub mod core;

#[cfg(feature = "python")]
pub mod python;

#[cfg(feature = "web")]
pub mod web;

#[cfg(test)]
#[cfg(feature = "web")]
mod tests {
    use super::*;

    #[test]
    #[cfg(feature = "web")]
    fn test_ai() {
        let mut reader =
            hound::WavReader::open("tests/assets/ai.wav").expect("Failed to open WAV file");
        let spec = reader.spec();
        let samples = reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / i16::MAX as f32)
            .collect::<Vec<f32>>();
        let prob = web::run_inference(&samples, spec.sample_rate).expect("Inference failed");
        assert!(
            prob > 0.5,
            "Expected probability > 0.5 for AI-generated audio, got {}",
            prob
        );
    }
    #[test]
    #[cfg(feature = "web")]
    fn test_human() {
        let mut reader =
            hound::WavReader::open("tests/assets/human.wav").expect("Failed to open WAV file");
        let spec = reader.spec();
        let samples = reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / i16::MAX as f32)
            .collect::<Vec<f32>>();
        let prob = web::run_inference(&samples, spec.sample_rate).expect("Inference failed");
        assert!(
            prob < 0.5,
            "Expected probability < 0.5 for human-generated audio, got {}",
            prob
        );
    }
}

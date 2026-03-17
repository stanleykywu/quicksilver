use ai_music_browser_detector::core;
use hound;

fn main() {
    let input_path = std::env::args()
        .nth(1)
        .expect("Usage: cargo run --example profile -- <input.wav>");
    let mut reader = hound::WavReader::open(&input_path).expect("Failed to open WAV file");
    let spec = reader.spec();
    let samples = reader
        .samples::<i16>()
        .map(|s| s.unwrap() as f32 / i16::MAX as f32)
        .collect::<Vec<f32>>();
    let fakeprint = core::compute_fakeprint(&samples, spec.sample_rate, None, None);
    println!("Fakeprint length: {}", fakeprint.len());
}

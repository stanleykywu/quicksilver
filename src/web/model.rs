use crate::core::compute_fakeprint;
use serde::Deserialize;
use std::sync::LazyLock;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
pub struct BinaryLogisticRegression {
    pub coef: Vec<f64>,
    pub intercept: f64,
    pub n_features: u64,
}

impl BinaryLogisticRegression {
    pub(crate) fn from_cbor(bytes: &[u8]) -> Result<Self, String> {
        let model: Self = serde_cbor::from_slice(bytes)
            .map_err(|e| format!("Failed to deserialize model: {e}"))?;

        if model.coef.len() != model.n_features as usize {
            return Err(format!(
                "Invalid model: coef length {} does not match n_features {}",
                model.coef.len(),
                model.n_features
            ));
        }

        Ok(model)
    }

    #[inline(always)]
    fn sigmoid(x: f64) -> f64 {
        // Numerically stable implementation. See
        // https://blog.dailydoseofds.com/p/a-highly-overlooked-point-in-the
        if x < 0.0 {
            let exp_x = (x).exp();
            exp_x / (1.0 + exp_x)
        } else {
            1.0 / (1.0 + (-x).exp())
        }
    }

    pub(crate) fn predict(&self, features: &[f32]) -> Result<f64, String> {
        if features.len() != self.n_features as usize {
            return Err(format!(
                "Expected {} features, got {}",
                self.n_features,
                features.len()
            ));
        }
        let mut dot_product = self.intercept;
        for (w, x) in self.coef.iter().zip(features.iter()) {
            dot_product += w * (*x as f64);
        }
        Ok(Self::sigmoid(dot_product))
    }
}

/// The model is small enough that it is most performant
/// to include it directly in the binary.
static MODEL_BYTES: &[u8] = include_bytes!("../../model/v1-2026-03-17/model.cbor");
/// We use a LazyLock to ensure that the model is only deserialized on
/// the first inference call, which avoids unnecessary work for repeated calls.
static MODEL: LazyLock<BinaryLogisticRegression> = LazyLock::new(|| {
    BinaryLogisticRegression::from_cbor(MODEL_BYTES).expect("Failed to load model")
});

#[wasm_bindgen]
pub fn run_inference(pcm_audio: &[f32], input_sample_rate: u32) -> Result<f64, JsValue> {
    if pcm_audio.is_empty() {
        return Err(JsValue::from_str("pcm_audio is empty"));
    }
    let features = compute_fakeprint(pcm_audio, input_sample_rate, None, None, None).to_vec();
    MODEL.predict(&features).map_err(|e| JsValue::from_str(&e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_prediction1() {
        let model = BinaryLogisticRegression {
            coef: vec![0.5, -0.25],
            intercept: 0.0,
            n_features: 2,
        };
        let features = vec![1.0, 2.0];
        let prob = model.predict(&features).unwrap();
        let expected = 0.5; // sigmoid(0) = 0.5
        assert!((prob - expected).abs() < 1e-6);
    }

    #[test]
    fn test_numerical_stability() {
        let model = BinaryLogisticRegression {
            coef: vec![1000.0],
            intercept: 0.0,
            n_features: 1,
        };
        let features1 = vec![1.0];
        let prob1 = model.predict(&features1).unwrap();
        let expected1 = 1.0; // sigmoid(1000) should be very close to 1
        assert!((prob1 - expected1).abs() < 1e-6);
        let features2 = vec![-1.0];
        let prob2 = model.predict(&features2).unwrap();
        let expected2 = 0.0; // sigmoid(-1000) should be very close to 0
        assert!((prob2 - expected2).abs() < 1e-6);
    }

    #[test]
    fn test_model_prediction2() {
        let model = BinaryLogisticRegression::from_cbor(MODEL_BYTES).expect("Failed to load model");
        let features = (0..model.n_features)
            .map(|i| i as f32 / 5000.0) // dummy features
            .collect::<Vec<f32>>();
        let prob = model.predict(&features).unwrap();
        let expected = 1.0 - 9.99999449e-01;
        assert!(
            (prob - expected).abs() < 1e-6,
            "Expected={}, got={}",
            expected,
            prob
        );
    }
    #[test]
    fn test_model_prediction3() {
        let bytes = include_bytes!("../../tests/assets/aifp.json");
        let fakeprint: Vec<f32> =
            serde_json::from_slice(bytes).expect("Failed to deserialize fakeprint");
        let prob = MODEL.predict(&fakeprint).unwrap();
        let expected = 1.0 - 2.98884029e-10;
        assert!(
            (prob - expected).abs() < 1e-6,
            "Expected={}, got={}",
            expected,
            prob
        );
    }
}

use scirs2_core::ndarray::Array1;
use scirs2_interpolate::{CubicSpline, SplineBoundaryCondition};
use scirs2_signal::resampling::{ResamplingConfig, ResamplingQuality, WindowType, resample_poly, resample};
use serde::Deserialize;
use serde_cbor::de;
use std::{default, sync::LazyLock};
use wasm_bindgen::prelude::*;

/// The model is small enough that it is most performant
/// to include it directly in the binary.
static MODEL_BYTES: &[u8] = include_bytes!("../model.cbor");
/// We use a LazyLock to ensure that the model is only deserialized on
/// the first inference call, which avoids unnecessary work for repeated calls.
static MODEL: LazyLock<BinaryLogisticRegression> = LazyLock::new(|| {
    BinaryLogisticRegression::from_cbor(MODEL_BYTES).expect("Failed to load model")
});

pub fn compute_fakeprint(pcm: &[f32]) -> Vec<f32> {
    // This is just a placeholder implementation
    let mut features: Vec<f32> = pcm.iter().map(|x| (*x) * 2.0).collect();
    if features.len() >= 4087 {
        features[..4087].to_vec()
    } else {
        features.resize(4087, 0.0);
        features
    }
}

pub fn interp1d(x: Vec<f64>, y: Vec<f64>, x_eval: Vec<f64>) -> Vec<f64> {
    let x_arr = Array1::from_vec(x);
    let y_arr = Array1::from_vec(y);
    let x_eval_arr = Array1::from_vec(x_eval);
    let spline = CubicSpline::with_boundary_condition(
        &x_arr.view(),
        &y_arr.view(),
        SplineBoundaryCondition::Natural,
    )
    .expect("Failed to create natural cubic spline");

    spline.evaluate_array(&x_eval_arr.view()).unwrap().to_vec()
}

pub fn resample_audio(input: &[f32], input_rate: u32, output_rate: u32) -> Vec<f32> {
    let upcasted_input: Vec<f64> = input.iter().map(|&x| x as f64).collect();

    resample(&upcasted_input, input_rate as f64, output_rate as f64, None)
        .unwrap()
        .iter()
        .map(|&x| x as f32)
        .collect()
}

#[derive(Deserialize)]
struct BinaryLogisticRegression {
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

#[wasm_bindgen]
pub fn run_inference(pcm_audio: &[f32]) -> Result<f64, JsValue> {
    if pcm_audio.is_empty() {
        return Err(JsValue::from_str("pcm_audio is empty"));
    }
    let features = compute_fakeprint(pcm_audio);
    MODEL.predict(&features).map_err(|e| JsValue::from_str(&e))
}

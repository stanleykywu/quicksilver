use scirs2_core::{
    Axis,
    ndarray::{Array1, s},
};
use scirs2_interpolate::{CubicSpline, SplineBoundaryCondition};
// TODO: add unit tests for each function

const DEFAULT_AREA: usize = 10;
const LOWER_HULL_FLOOR_DB: f32 = -45.0;
pub const DEFAULT_F_RANGE: (f32, f32) = (5000.0, 16000.0);

/// Compute the lower hull of a 1d array `x` using a sliding window of size `area`.
/// If area is None, it defaults to 10.
fn lower_hull(x: &Array1<f32>, area: Option<usize>) -> (Vec<usize>, Vec<f32>) {
    let area = area.unwrap_or(DEFAULT_AREA);
    let n = x.len();
    let mut idx: Vec<usize> = Vec::new();
    let mut hull: Vec<f32> = Vec::new();

    if n == 0 || area == 0 || n < area {
        return (vec![0, n.saturating_sub(1)], vec![x[0], x[n - 1]]);
    }

    for i in 0..=(n - area) {
        let patch = x.slice(s![i..i + area]);
        let mut rel_min = 0usize; // idx of minimum value in the patch
        let mut min_val = patch[0];
        for (j, &v) in patch.iter().enumerate().skip(1) {
            if v < min_val {
                min_val = v;
                rel_min = j;
            }
        }
        let abs_idx = i + rel_min;
        if !idx.contains(&abs_idx) {
            idx.push(abs_idx);
            hull.push(min_val);
        }
    }

    // Ensure endpoints exist
    if idx.first().copied() != Some(0) {
        idx.insert(0, 0);
        hull.insert(0, x[0]);
    }
    if idx.last().copied() != Some(n - 1) {
        idx.push(n - 1);
        hull.push(x[n - 1]);
    }

    (idx, hull)
}

/// Use cubic spline interpolation to evaluate `x_eval` at the points in `x` and `y`.
fn cubic_interp(x: &Array1<f32>, y: &Array1<f32>, x_eval: &Array1<f32>) -> Array1<f32> {
    // CubicSpline requires the input arrays to be in f64, so we need to upcast them.
    let spline = CubicSpline::with_boundary_condition(
        &x.mapv(|v| v as f64).view(),
        &y.mapv(|v| v as f64).view(),
        SplineBoundaryCondition::Natural,
    )
    .expect("Failed to create natural cubic spline");

    spline
        .evaluate_array(&x_eval.mapv(|v| v as f64).view())
        .unwrap()
        .mapv(|v| v as f32)
}

/// Compute the curve profile by taking the difference between the curve and its lower hull,
/// after interpolating the lower hull to the same x values as the curve.
pub fn curve_profile(
    freqs: &Array1<f32>,
    curve: &Array1<f32>,
    f_range: Option<(f32, f32)>,
    min_db: Option<f32>,
) -> (Array1<f32>, Array1<f32>) {
    if freqs.len() != curve.len() {
        panic!("freqs and curve must have the same length");
    }

    let (f_min, f_max) = f_range.unwrap_or(DEFAULT_F_RANGE);
    let min_db = min_db.unwrap_or(LOWER_HULL_FLOOR_DB);

    let mut xs = Vec::new();
    let mut cs = Vec::new();
    for i in 0..freqs.len() {
        if f_min < freqs[i] && freqs[i] < f_max {
            xs.push(freqs[i]);
            cs.push(curve[i]);
        }
    }

    let x_arr = Array1::from(xs);
    let c_arr = Array1::from(cs);

    let (low_hull_idx, lower_curve) = lower_hull(&c_arr, None);

    let x_arr_low_hull = x_arr.select(Axis(0), &low_hull_idx);

    let low_hull_curve = cubic_interp(&x_arr_low_hull, &Array1::from_vec(lower_curve), &x_arr)
        .mapv(|v| v.max(min_db)); // floor the lower hull

    let curve_profile = (c_arr - low_hull_curve).mapv(|v| v.max(0.0));

    (x_arr, curve_profile)
}

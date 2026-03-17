use scirs2_core::{
    Axis,
    ndarray::{Array1, s},
};
use scirs2_interpolate::{CubicSpline, SplineBoundaryCondition};

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cubic_interp1() {
        let x = Array1::from(vec![0.0, 1.0, 2.0]);
        let y = Array1::from(vec![0.0, 1.0, 0.0]);
        let x_eval = Array1::from(vec![0.5, 1.5]);
        let result = cubic_interp(&x, &y, &x_eval);
        let expected = Array1::from(vec![0.6875, 0.6875]);
        assert_eq!(result.len(), 2);
        assert!((result[0] - expected[0]).abs() < 1e-5);
        assert!((result[1] - expected[1]).abs() < 1e-5);
    }

    #[test]
    fn test_cubic_interp2() {
        let x = Array1::from(vec![
            -0.98222526,
            -0.93870537,
            -0.41203216,
            0.18344477,
            0.20670032,
            0.23254377,
            0.3504913,
            0.46100433,
            0.53757412,
            0.64404482,
        ]);
        let y = Array1::from(vec![
            -0.13608838,
            -0.19300755,
            -0.22067183,
            -0.30598885,
            -0.9092567,
            0.50033467,
            -0.80883903,
            -0.03053041,
            -0.55565505,
            -0.03910654,
        ]);
        let x_eval = Array1::from(vec![-0.5, -0.235, 0.0, 0.4]);
        let result = cubic_interp(&x, &y, &x_eval);
        let expected = Array1::from(vec![-0.91064353, 2.40422011, 4.13804684, -0.79505057]);
        assert_eq!(result.len(), 4);
        for i in 0..result.len() {
            assert!(
                (result[i] - expected[i]).abs() < 1e-5,
                "Failed at index {}: got {}, expected {}",
                i,
                result[i],
                expected[i]
            );
        }
    }

    #[test]
    fn test_lower_hull1() {
        let x = Array1::from(vec![
            0.64404482,
            -0.41203216,
            0.46100433,
            0.23254377,
            -0.93870537,
            -0.98222526,
            0.53757412,
            0.20670032,
            0.3504913,
            0.18344477,
        ]);
        let (idx, hull) = lower_hull(&x, Some(4));
        assert_eq!(idx, vec![0, 1, 4, 5, 9]);
        assert_eq!(
            hull,
            vec![
                0.64404482,
                -0.41203216,
                -0.93870537,
                -0.98222526,
                0.18344477
            ]
        );
    }

    #[test]
    fn test_lower_hull2() {
        let x = Array1::from(vec![3.0, 1.0, 4.0, 1.5, 5.0, 9.0]);
        let (idx, hull) = lower_hull(&x, Some(2));
        assert_eq!(idx, vec![0, 1, 3, 4, 5]);
        assert_eq!(hull, vec![3., 1., 1.5, 5., 9.]);
    }

    #[test]
    fn test_curve_profile() {
        let x = Array1::from(vec![
            0., 2500., 5000., 7500., 10000., 12500., 15000., 17500., 20000., 22500., 25000.,
            27500., 30000., 32500., 35000., 37500., 40000., 42500., 45000., 47500., 50000.,
        ]);
        let curve = Array1::from(vec![
            -30.1743011,
            -50.506431,
            -17.17825364,
            -99.47450709,
            -24.43209108,
            -62.61011003,
            -8.17123769,
            -24.91867834,
            -26.49457764,
            -50.48815831,
            -89.14511013,
            40.51973171,
            14.09663399,
            17.56805976,
            21.15996675,
            16.8759065,
            28.5472071,
            56.9114152,
            11.89116212,
            59.04972889,
            -22.73807915,
        ]);

        let (x_eval, profile) = curve_profile(&x, &curve, Some((5000.0, 45000.0)), Some(-45.0));
        let expected_x_eval = vec![
            7500., 10000., 12500., 15000., 17500., 20000., 22500., 25000., 27500., 30000., 32500.,
            35000., 37500., 40000., 42500.,
        ];
        let expected_profile = vec![
            0.,
            20.56790892,
            0.,
            36.82876231,
            20.08132166,
            18.50542236,
            0.,
            0.,
            85.51973171,
            59.09663399,
            57.17581133,
            38.71538268,
            10.59831017,
            0.,
            0.,
        ];
        assert_eq!(x_eval.len(), expected_x_eval.len());
        assert_eq!(profile.len(), expected_profile.len());
        for i in 0..x_eval.len() {
            assert!(
                (x_eval[i] - expected_x_eval[i]).abs() < 1e-5,
                "Failed at index {}: got {}, expected {}",
                i,
                x_eval[i],
                expected_x_eval[i]
            );
            assert!(
                (profile[i] - expected_profile[i]).abs() < 1e-5,
                "Failed at index {}: got {}, expected {}",
                i,
                profile[i],
                expected_profile[i]
            );
        }
    }
}

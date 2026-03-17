pub mod model;
pub use model::BinaryLogisticRegression;
pub use model::run_inference;

// TODO: look at creating streaming resampling
// within js instead of doing it during fakeprint computation.

import cbor2
import joblib
from sklearn.linear_model import LogisticRegression
import argparse

def main(model_path, output_path):
    model = joblib.load(model_path)
    assert isinstance(model, LogisticRegression), "Loaded model is not a LogisticRegression instance"
    payload = {
        "coef": model.coef_.tolist()[0],
        "intercept": model.intercept_.tolist()[0], 
        "classes": model.classes_.tolist(), # binary classification
        "n_features": model.n_features_in_
    }
    with open(output_path, "wb") as f:
        cbor2.dump(payload, f)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serialize a trained model to CBOR format")
    parser.add_argument("--model_path", help="Path to the trained model file")
    parser.add_argument("--output_path", help="Path to the output CBOR file", default="model.cbor")
    args = parser.parse_args()
    main(args.model_path, args.output_path)
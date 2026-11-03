# SignSpeak hp-v1 live recognizer: model card

**Intended use.** A hackathon prototype that recognises a small, human-verified set of
Indian Sign Language (ISL) signs from webcam landmarks and shows their meaning in English,
Kannada, Hindi or Tamil. It is not a translator, and it must not be used for medical,
emergency or legal communication.

**Inputs.** Browser MediaPipe hand (up to 2) and upper-body pose landmarks at about 15 fps
(lm-v1). No images. Features: hp-v1 window summaries over 1.6 s (see `docs/data_schema.md`).

**Model.** A CPU scikit-learn classifier, chosen from RandomForest, ExtraTrees,
LogisticRegression and RBF-SVM by grouped out-of-fold macro-F1. A reserved NONE class
(rest, idle, transitions, random movement) is trained with the signs. A prediction is
shown only if NONE does not win and confidence and margin pass thresholds tuned on
validation folds.

**Data.** Only takes recorded on `/collect` by consenting, pseudonymous signers, for signs
a human verified against an exact official ISLRTC reference. No external dataset is used.

**Known limitations.**
- No face landmarks, so signs that need facial grammar or mouthing are excluded.
- A small vocabulary with few signers: expect errors with new people, lighting, cameras
  and backgrounds. Any unfamiliar movement can still be confidently misread as a sign.
- Accuracy is only known for unseen signers when at least 3 signers were collected
  (leave-one-signer-out). Otherwise the section below says it was NOT measured.
- The kn/hi/ta meanings were drafted by an AI assistant and need native-speaker checks.

<!-- AUTO:BEGIN (written by python -m backend.live.train; do not edit by hand) -->
## Latest trained model

No model has been trained yet. No metrics exist.
<!-- AUTO:END -->

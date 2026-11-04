// Add only team-provided names and roles (people's own choice of how to be credited).
export const PROJECT = 'SignSpeak Local';
export const TEAM_NAME = 'Sin-Tax';
export const TEAM = [
  { name: 'Aditya Arun Karadi', role: 'AI/ML Development, Dataset Collection, Model Testing & Integration' },
  { name: 'Chinmay Rajendra', role: 'Full-Stack Development, System Architecture & Deployment' },
  { name: 'Aryan KL', role: 'UI/UX Design, Quality Assurance & Documentation' },
];
export const EVENT = 'Human Impact track · hackathon, 2–4 November 2026';

// Hand-written leave-one-signer-out check of run #4 (docs/MODEL_CARD.md): algorithm and thresholds
// chosen on the training signer only. Shown only while the loaded model is this run.
export const CROSS_PERSON_CHECK = {
  run: 4,
  trained_at: '2026-11-04T11:12:46+00:00',
  folds: [
    { name: 'Trained on signer02, tested on signer01', macroF1: '0.756', signs: '45/48', noneAccepted: '22/48' },
    { name: 'Trained on signer01, tested on signer02', macroF1: '0.919', signs: '21/24', noneAccepted: '0/16' },
    { name: 'Both folds together', macroF1: '0.803', signs: '66/72', noneAccepted: '22/64' },
  ],
};

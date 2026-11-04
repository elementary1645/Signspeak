// Editable site content. TEAM: replace with real names and roles (people's own choice of
// how to be credited). These GitHub accounts are the ones in the repository history.
export const TEAM = [
  { name: 'elementary1645', role: 'Repository owner', url: 'https://github.com/elementary1645' },
  { name: 'Chinmay1881', role: 'Contributor', url: 'https://github.com/Chinmay1881' },
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

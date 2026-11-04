# SignSpeak: 2-minute demo

**Before you start (5 minutes ahead)**
- Laptop with Chrome or Edge, good front light, plain background. Not a phone.
- Open https://signspeak-5xwo.onrender.com/translate. The free server sleeps, so the first load
  can take about 50 seconds. Allow the camera, press **Start camera**, and wait for
  **Live connection** and **Ready**. Then press **Stop camera** and go back to Home.
- Choose **English** in the language menu and turn **Speak results aloud** on. Check the laptop volume.
- Rehearse once: HELLO, YES, NO, and the non-sign below. If HELLO fires during the non-sign,
  switch to the backup non-sign.
- Sit so your face is in the upper half of the frame and your hands and shoulders are in view.

| Time | Screen | Do | Say (roughly) |
|---|---|---|---|
| 0:00–0:15 | **Home** | Point at "signs supported right now: 3". | "SignSpeak turns a few Indian Sign Language signs into text and speech in four Indian languages. Tracking runs in the browser; only landmark points go to the server, never video." |
| 0:15–0:35 | **Learn ISL** | Scroll the three cards (HELLO, NO, YES); point at one embedded ISLRTC video and the "Not supported yet" list. | "Every sign was checked by a person against the official ISLRTC dictionary video before the model could learn it. We link those videos, we don't copy them. These others aren't verified, so the model doesn't know them." |
| 0:35–1:15 | **Translate** | Start camera. Hand raised beside your shoulder, then sign **HELLO**, hold ~1 s. Then **YES**, then **NO**. Wait for each to show and be spoken. | "It waits for a steady answer before showing a sign, and shows a sign once, not on repeat." |
| | | **Non-sign:** reach one hand slowly out in front of your chest, palm down, as if picking up a cup, and hold it there for 2 seconds. Badge shows **Not a known sign**; nothing is spoken. *Backup:* rest both hands in your lap, then lift one to chest height and lower it. | "Just as important: when I'm not signing, it should say nothing. It was trained with a 'none' class of rest, fidgeting and half-signs, and it refuses when it isn't confident." |
| 1:15–1:35 | **Translate** | Switch the menu to **ಕನ್ನಡ (Kannada)**. Sign **YES**: "ಹೌದು" is shown and spoken. Press **Replay** once if needed. | "The same sign in Kannada. The Kannada, Hindi and Tamil wording is still waiting for a native-speaker check." |
| 1:35–2:00 | **About & Model** | Scroll to **Limits**, then the **Tested on the other person** table. | "Honest limits: three signs, no facial grammar, phones are too slow today. We withdrew THANK_YOU because it failed live even though it was perfect offline. With only two signers we train on one and test on the other: 66 of 72 signs right, but 22 of 64 non-signs were accepted as a sign, mostly HELLO. That is not a real unseen-signer accuracy yet; we need more signers, ideally Deaf ISL signers." |

**If something goes wrong**
- *"Model not trained yet" or "Loading the trained model…":* the server just woke up. Wait 10–20 seconds and reload.
- *"Hand detection is uncertain":* move your hand away from your face and start again from beside the shoulder.
- *Tracking FPS warning, or the laptop/desktop notice appears on a laptop:* close other tabs and apps; the tracker needs 7+ FPS.
- *A sign doesn't fire:* return to the start position, sign a little slower, and hold for a full second.
- *No sound:* check the volume, then press **Replay** (some browsers block audio until you click).

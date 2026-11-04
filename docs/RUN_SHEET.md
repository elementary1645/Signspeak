# Signer run sheet (about 25 minutes)

One page for each signer recording on `/collect`. The full rules are in
[COLLECTION_PROTOCOL.md](COLLECTION_PROTOCOL.md).

## 1. Setup

1. Open `/collect`. Enter your **Signer pseudonym** (for example `signer07`; never your
   real name), and use the same one every time. Leave **Session** as today's date. Tick
   the consent box yourself.
2. **Collection protocol:** `hp-v2-8fps: 16 frames, about 2 seconds (recommended)`.
3. **Tracking settings:** Resolution **640×480**, Delegate **CPU**. Inference FPS is
   locked to 8. Change settings only while the camera is stopped.
4. Press **Start camera** and warm up for 10 seconds. Sit an arm's length or more away,
   with your head, shoulders, elbows and hands in view and even lighting.
5. **No framing warning.** If the page says *"Tilt your screen down so your face is in
   the upper half and your shoulders are in view"*, fix it before recording.
6. Raise one hand at a time and check that "your left" and "your right" match your real
   hands.

## 2. How to start every take

**Before you press Record take, raise your signing hand beside your shoulder, away from
your face.** Do not start from rest (hands in your lap or by your side) and do not start
with a hand near your face. After the 3-2-1 countdown, sign once. Recording stops by
itself after about 2 seconds.

Press **Keep** if the sign was right and your hands stayed visible. Otherwise, or if Keep
is disabled (FPS or timing warning, or a dashed yellow hand), press **Discard** and try
again. Never invent variants. Small changes in position, speed and distance are fine.

## 3. Signs: 8 kept takes each

Choose each sign in the sign list and watch its official video on the page before you
start.

| Sign | Notes |
|---|---|
| **HELLO** | Move your hand away from the top of your head. |
| **YES** | Make your hand into a fist and move it up and down next to your head. |
| **NO** | Make your index and middle finger touch your thumb. |

## 4. NONE: 16 kept takes

Choose **NONE: not a sign**. The page shows a prompt for each take (rest, scratching your
head, adjusting glasses, half a sign, chatting, holding your hand raised and still, reaching
out slowly, and so on). Follow it naturally until recording stops. The prompt changes by
itself after each kept take. If the team lead asks for a particular prompt, pick it in the
**NONE prompt** menu. These takes teach the
model when not to answer, so they matter as much as the signs.

## 5. Finish

1. Check that **Summary** says "Complete" (HELLO, YES, NO at 8 and NONE
   at 16).
2. Press **Download my data (N takes)** and send the `.jsonl` file to the team lead.
3. On a shared computer, press **Clear saved takes** after downloading.

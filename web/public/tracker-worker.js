/* Classic worker: MediaPipe's WASM loader uses importScripts. All assets same-origin. */
self.exports = {};
importScripts('/mediapipe/vision_bundle.cjs');
let task;
self.onmessage = async ({ data }) => {
  const { id, bitmap, timestamp } = data;
  try {
    if (data.type === 'init') {
      const files = await exports.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const hand = data.kind === 'hand';
      const Task = hand ? exports.HandLandmarker : exports.PoseLandmarker;
      task = await Task.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${self.location.origin}/models/${hand ? 'hand_landmarker' : 'pose_landmarker_lite'}.task`, delegate: data.delegate },
        runningMode: 'VIDEO', ...(hand ? { numHands: 2 } : { numPoses: 1, outputSegmentationMasks: false }),
        // GPU workers require an explicitly owned canvas.
        canvas: new OffscreenCanvas(1, 1),
      });
      self.postMessage({ id, ready: true });
    } else {
      const start = performance.now();
      const result = task.detectForVideo(bitmap, timestamp);
      self.postMessage({ id, result: { landmarks: result.landmarks, handedness: result.handedness }, ms: performance.now() - start });
    }
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  } finally { bitmap?.close(); }
};

"""Official Tasks API, CPU IMAGE mode; no remote-machine webcam access."""
import io
import threading
from pathlib import Path
import numpy as np
from PIL import Image, UnidentifiedImageError

MODEL = Path(__file__).resolve().parents[1] / 'models/hand_landmarker.task'
THRESHOLD = 0.7


def decode_image(payload, mirrored=False):
    try:
        with Image.open(io.BytesIO(payload)) as image:
            if image.width * image.height > 1920 * 1080:
                raise ValueError('Image exceeds 1080p pixel budget')
            image = image.convert('RGB')
            if mirrored:
                image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            return np.array(image)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError('Invalid image') from exc


class Detector:
    def __init__(self):
        # Imported here so the live (hp-v1) server can run without loading Python MediaPipe.
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision
        self.mp = mp
        self.lock = threading.Lock()
        self.task = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL), delegate=BaseOptions.Delegate.CPU),
            running_mode=vision.RunningMode.IMAGE, num_hands=2,
            min_hand_detection_confidence=THRESHOLD, min_hand_presence_confidence=THRESHOLD))

    def detect(self, rgb):
        with self.lock:
            result = self.task.detect(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb))
        hands = []
        for points, categories in zip(result.hand_landmarks, result.handedness):
            category = categories[0]
            hands.append({'side': category.category_name, 'handedness_score': category.score,
                          'landmarks': [[p.x, p.y, p.z] for p in points]})
        return hands

    def close(self):
        self.task.close()

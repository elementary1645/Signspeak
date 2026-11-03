"""Real CPU model + HTTP route smoke test; no camera or sign accuracy claims."""
import base64
import io
import inspect
import sys
from fastapi.testclient import TestClient
import mediapipe as mp
from mediapipe.tasks.python import vision
from PIL import Image
from backend.app.main import app


def main():
    # Windows consoles default to cp1252; never crash on a stray non-ASCII character.
    sys.stdout.reconfigure(errors='replace')
    print('MediaPipe:', mp.__version__)
    print('HandLandmarkerOptions:', inspect.signature(vision.HandLandmarkerOptions))
    image = io.BytesIO()
    Image.new('RGB', (640, 480), 'black').save(image, format='JPEG')
    with TestClient(app) as client:
        health = client.get('/health').json()
        assert health['detector_ready'], health
        assert client.get('/').status_code == 200
        assert client.get('/collector.js').status_code == 200
        response = client.post('/frames', json={
            'image': base64.b64encode(image.getvalue()).decode(), 'timestamp_ms': 0})
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['hands'] == [] and result['features'] is None and not result['saved'], result
        recognition = client.post('/frames', json={
            'image': base64.b64encode(image.getvalue()).decode(), 'timestamp_ms': 1,
            'recognize': True, 'stream_id': 'real-cpu-smoke'}).json()
        assert recognition['prediction']['state'] == 'no_hand'
        assert recognition['prediction']['stable_label'] is None
        assert recognition['frame_latency_ms'] >= 0
        print('PASS: CPU Tasks initialization, browser assets, health, JPEG -> detection -> no-hand response')


if __name__ == '__main__':
    main()

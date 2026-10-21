# MediaPipe face detection (bundled)

Files from `@mediapipe/tasks-vision` 1.1.1 (Apache License 2.0, https://github.com/google-ai-edge/mediapipe), unmodified:

- `vision_bundle.mjs`
- `vision_wasm_internal.js`, `vision_wasm_internal.wasm` (SIMD build)

Model: `blaze_face_short_range.tflite` (float16), from
https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite
(Apache License 2.0).

Used by `js/face.js`. Loaded only when a photo is uploaded.

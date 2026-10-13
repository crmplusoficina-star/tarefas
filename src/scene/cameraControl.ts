/** Imperative bridge between keyboard / HUD buttons and the camera rig. */
export const cameraControl = {
  panBy: (_screenX: number, _screenY: number) => {},
  zoomBy: (_factor: number) => {},
  rotateBy: (_az: number, _pol: number) => {},
  /** drop manual pan/zoom/rotation and return to the level's framing */
  reset: () => {},
}

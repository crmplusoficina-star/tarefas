/** Imperative bridge between keyboard / HUD buttons / overlays and the camera rig. */
export const cameraControl = {
  panBy: (_screenX: number, _screenY: number) => {},
  /** keyboard / button zoom: toward the screen centre, never opens categories */
  zoomBy: (_factor: number) => {},
  /** wheel zoom aimed at the cursor (client coordinates) */
  wheel: (_clientX: number, _clientY: number, _deltaY: number, _deltaMode: number) => {},
  rotateBy: (_az: number, _pol: number) => {},
  /** drop manual pan/zoom/rotation and return to the level's framing */
  reset: () => {},
}

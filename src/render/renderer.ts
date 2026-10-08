import * as THREE from 'three';

/** Owns the WebGL renderer and resizes it to the canvas. Device pixel ratio is clamped for iGPUs. */
export function createRenderer(canvas: HTMLCanvasElement, maxDpr = 1.5): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0b1016, 1);
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
  };
  resize();
  window.addEventListener('resize', resize);
  return renderer;
}

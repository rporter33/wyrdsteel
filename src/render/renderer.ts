import * as THREE from 'three';

/**
 * Owns the WebGL renderer: filmic tone mapping, sRGB output, PCF shadows. Resizes with the
 * canvas and tells the caller, so the post chain can follow.
 */
export function createRenderer(canvas: HTMLCanvasElement, onResize: (w: number, h: number) => void = () => {}): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x0b1016, 1);
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    onResize(w, h);
  };
  resize();
  window.addEventListener('resize', resize);
  return renderer;
}

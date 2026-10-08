import * as THREE from 'three';
import { createRenderer } from '../render/renderer';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
camera.position.set(0, 3, 9);
camera.lookAt(0, 0.5, 0);

// A placeholder emblem: the steel diamond from the favicon, built from primitives.
const emblem = new THREE.Mesh(
  new THREE.OctahedronGeometry(1.4, 0),
  new THREE.MeshToonMaterial({ color: 0x78c6ff }),
);
scene.add(emblem, new THREE.HemisphereLight(0xcfe8ff, 0x1a1f26, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 5, 4);
scene.add(sun);

const debug = { frames: 0 };
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __game: unknown }).__game = debug;

function frame() {
  debug.frames++;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  emblem.rotation.y += 0.01;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const r = doc.getRoot();
  console.log('==', f);
  console.log('meshes', r.listMeshes().map((m) => `${m.getName()}[${m.listPrimitives().map((p) => `${p.getIndices()?.getCount() / 3 | 0}t ${Object.keys(Object.fromEntries(p.listSemantics().map((s) => [s, 1]))).join(',')} mat=${p.getMaterial()?.getName()}`).join('; ')}]`).join(' | '));
  console.log('materials', r.listMaterials().map((m) => `${m.getName()} col=${m.getBaseColorFactor().map((x) => x.toFixed(2))} tex=${!!m.getBaseColorTexture()} rough=${m.getRoughnessFactor()} metal=${m.getMetallicFactor()}`).join(' | '));
  console.log('textures', r.listTextures().map((t) => `${t.getName()} ${t.getMimeType()} ${t.getSize()}`).join(' | '));
  console.log('skins', r.listSkins().map((s) => `${s.getName()} joints=${s.listJoints().length}`).join(' | '));
  console.log('anims', r.listAnimations().length, r.listAnimations().slice(0, 80).map((a) => a.getName()).join(' '));
  console.log('nodes', r.listNodes().length, r.listNodes().slice(0, 12).map((n) => n.getName()).join(' '));
}

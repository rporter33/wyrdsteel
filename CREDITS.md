# Credits

Wyrdsteel's code is MIT licensed. The art it loads at run time is all **CC0 (public domain)**,
processed for the web by `scripts/assets/build.mjs` and committed under `public/assets/`. No
attribution is required for CC0 work; it is listed here because it should be.

## Characters and animation

From [Quaternius](https://quaternius.com) (CC0), via [quaternius.itch.io](https://quaternius.itch.io):

- **Universal Animation Library** and **Universal Animation Library 2** (Standard): the skeleton
  and the 50 clips the game uses (locomotion, sword, pistol, spell, hit reactions, death). Merged
  into one file, cut to the bones the camera can see, resampled.
- **Universal Base Characters** (Standard): the hero bodies under the Sworn's plate, and the
  mannequin that stands in for enemies. Bodies are reduced in triangles; textures re-encoded as
  WebP.

Armour, weapons, helms and props hung on those skeletons are built from primitives in code
(`src/render/models/`).

## Surfaces

Physically based texture sets from [ambientCG](https://ambientcg.com) (CC0), packed into colour,
normal and occlusion-roughness-metalness WebP images at 1024 px:

| In game | ambientCG set |
|---|---|
| Citadel and Wyrd floors | [PavingStones128](https://ambientcg.com/view?id=PavingStones128) |
| Citadel walls | [Bricks075A](https://ambientcg.com/view?id=Bricks075A) |
| Iron Wood snow | [Snow014](https://ambientcg.com/view?id=Snow014), [Snow006](https://ambientcg.com/view?id=Snow006) |
| Iron Wood bark | [Bark001](https://ambientcg.com/view?id=Bark001) |
| Rock and cliffs | [Rock030](https://ambientcg.com/view?id=Rock030) |
| Foundry plate, rust, walkways | [MetalPlates006](https://ambientcg.com/view?id=MetalPlates006), [Metal041B](https://ambientcg.com/view?id=Metal041B), [MetalWalkway014](https://ambientcg.com/view?id=MetalWalkway014) |
| Lava | [Lava001](https://ambientcg.com/view?id=Lava001) |
| Ice and crystal | [Ice003](https://ambientcg.com/view?id=Ice003), [Ice002](https://ambientcg.com/view?id=Ice002) |
| Earth | [Ground112](https://ambientcg.com/view?id=Ground112) |

## Light

HDR skies from [Poly Haven](https://polyhaven.com) (CC0), used only for image-based lighting and
never shown directly; downsampled to 512 × 256:
[Old Hall](https://polyhaven.com/a/old_hall),
[Snowy Forest Path 01](https://polyhaven.com/a/snowy_forest_path_01),
[Industrial Workshop Foundry](https://polyhaven.com/a/industrial_workshop_foundry),
[Small Cave](https://polyhaven.com/a/small_cave),
[Rogland Moonlit Night](https://polyhaven.com/a/rogland_moonlit_night).

## Everything else

Sound effects and music are synthesized with the Web Audio API (`src/audio/`); no audio files
ship. The interface uses the system font.

Names of gods, places and creatures come from Norse mythology (the Poetic and Prose Eddas), which
is in the public domain.

Runtime libraries: [three.js](https://threejs.org) (MIT), [Preact](https://preactjs.com) (MIT).
Asset tools (development only): [glTF Transform](https://gltf-transform.dev) (MIT),
[meshoptimizer](https://github.com/zeux/meshoptimizer) (MIT), [sharp](https://sharp.pixelplumbing.com) (Apache-2.0).

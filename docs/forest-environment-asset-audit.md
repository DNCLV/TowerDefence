# Forest environment asset audit

Source: `Background/Forest/` (Kenney Mini Forest 1.0, CC0). This directory is source material only.

## Pack structure

- `Models/GLB format/`: 22 GLB models plus `Textures/colormap.png`.
- `Models/FBX format/`: matching FBX models plus the same colormap.
- `Models/OBJ format/`: matching OBJ/MTL models plus the same colormap.
- `Previews/`: one PNG preview per model.
- Root: pack preview/sample images, license, overview, and documentation links.

The complete source folder is 3,257,227 bytes. The GLB set is 838,760 bytes. Every inspected environment GLB uses one material and references the shared external `Textures/colormap.png`; geometry buffers are embedded.

## GLB inventory

| File | Bytes | Likely use |
|---|---:|---|
| `bridge.glb` | 32,460 | bridge prop |
| `building-platform.glb` | 48,212 | building component |
| `building-roof.glb` | 31,964 | building component |
| `building-structure.glb` | 16,356 | building component |
| `character-archer.glb` | 239,124 | character; not environment runtime |
| `fence.glb` | 29,904 | fence prop |
| `flag.glb` | 16,604 | flag prop |
| `ladder.glb` | 22,260 | ladder prop |
| `patch-dirt.glb` | 10,176 | entrance/ground detail |
| `patch-grass.glb` | 29,732 | vegetation filler |
| `plant.glb` | 22,424 | understory plant |
| `platform.glb` | 63,436 | raised platform |
| `rocks-high.glb` | 31,952 | tall boulder formation |
| `rocks-low.glb` | 31,964 | low boulder formation |
| `rocks-ramp.glb` | 23,148 | sloped rock formation |
| `stones.glb` | 23,124 | small stones |
| `target.glb` | 17,696 | target prop |
| `tent.glb` | 77,896 | camp prop |
| `tree.glb` | 23,476 | conifer tree |
| `tree-high.glb` | 31,176 | tall conifer tree |
| `weapon-arrow.glb` | 7,168 | weapon prop |
| `weapon-bow.glb` | 8,508 | weapon prop |

## Selected runtime subset

`tree.glb`, `tree-high.glb`, `rocks-low.glb`, `rocks-high.glb`, `rocks-ramp.glb`, `stones.glb`, `plant.glb`, `patch-grass.glb`, `patch-dirt.glb`, and their shared `Textures/colormap.png` are packaged under `public/assets/environment/forest/`.

The subset is 237,831 bytes. It provides two tree silhouettes, four rock/stone silhouettes, vegetation, grass, and dirt without shipping buildings, weapons, character art, duplicates, previews, or alternate formats.

Measured geometry is very small: trees use 182/266 triangles; selected rocks use 234–342 triangles; vegetation/patches use 108–295 triangles. This makes repeated static placement practical while retaining shared geometry and materials.

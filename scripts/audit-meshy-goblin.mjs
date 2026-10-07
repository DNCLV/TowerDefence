import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(projectRoot, "3D/Goblin/Meshy_AI_Bloodfang_Marauder_biped/Meshy_AI_Bloodfang_Marauder_biped_Animation_Casual_Walk_withSkin.glb");
const assetPath = process.argv[2] ? path.resolve(projectRoot, process.argv[2]) : sourcePath;

function readGlb(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "glTF" || buffer.readUInt32LE(4) !== 2) throw new Error("Expected a glTF 2.0 binary file.");
  let json;
  let binary;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) throw new Error("Invalid GLB chunk bounds.");
    if (type === 0x4e4f534a) json = JSON.parse(buffer.toString("utf8", start, end).trim());
    if (type === 0x004e4942) binary = buffer.subarray(start, end);
    offset = end;
  }
  if (!json || !binary) throw new Error("GLB is missing its JSON or binary chunk.");
  return { json, binary };
}

const componentInfo = {
  5120: [1, "getInt8"], 5121: [1, "getUint8"], 5122: [2, "getInt16"], 5123: [2, "getUint16"],
  5125: [4, "getUint32"], 5126: [4, "getFloat32"],
};
const elementComponents = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function accessorValues(gltf, binary, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const [componentBytes, getter] = componentInfo[accessor.componentType];
  const components = elementComponents[accessor.type];
  const stride = view.byteStride ?? componentBytes * components;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const values = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const row = [];
    for (let c = 0; c < components; c += 1) row.push(data[getter](start + i * stride + c * componentBytes, true));
    values.push(row);
  }
  return values;
}

function jpegDimensions(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  for (let offset = 2; offset + 9 < data.length;) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    const marker = data[offset + 1];
    const segmentLength = data.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    }
    if (segmentLength < 2) break;
    offset += segmentLength + 2;
  }
  return undefined;
}

async function audit(file) {
  const buffer = await readFile(file);
  const { json, binary } = readGlb(buffer);
  const parents = Array(json.nodes.length).fill(-1);
  json.nodes.forEach((node, index) => (node.children ?? []).forEach((child) => { parents[child] = index; }));
  const nodeName = (index) => json.nodes[index]?.name ?? `node_${index}`;
  const hierarchy = (index) => {
    const names = [];
    for (let cursor = index; cursor >= 0; cursor = parents[cursor]) names.unshift(nodeName(cursor));
    return names.join(" > ");
  };
  const roots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map((index) => ({ index, name: nodeName(index) }));
  const skins = (json.skins ?? []).map((skin) => ({
    name: skin.name,
    jointCount: skin.joints.length,
    skeletonRoot: skin.skeleton === undefined ? undefined : nodeName(skin.skeleton),
    joints: skin.joints.map((index) => ({ name: nodeName(index), parent: parents[index] < 0 ? null : nodeName(parents[index]) })),
  }));
  const animations = (json.animations ?? []).map((animation) => {
    const translations = [];
    let durationSeconds = 0;
    let maxLoopEndpointError = 0;
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler];
      const input = json.accessors[sampler.input];
      durationSeconds = Math.max(durationSeconds, input.max?.[0] ?? 0);
      const targetIndex = channel.target.node;
      if (channel.target.path === "translation" && ["target_character", "mixamorig:Hips"].includes(nodeName(targetIndex))) translations.push({
        node: nodeName(targetIndex), hierarchy: hierarchy(targetIndex),
        timeRange: [input.min?.[0], input.max?.[0]], outputRange: json.accessors[sampler.output].min && json.accessors[sampler.output].max
          ? { min: json.accessors[sampler.output].min, max: json.accessors[sampler.output].max } : undefined,
      });
      if (sampler.interpolation === "CUBICSPLINE") continue;
      const values = accessorValues(json, binary, sampler.output);
      if (values.length < 2) continue;
      let error = 0;
      if (channel.target.path === "rotation" && values.at(-1).length === 4) {
        const a = values[0]; const b = values.at(-1);
        error = Math.min(Math.hypot(...a.map((value, i) => value - b[i])), Math.hypot(...a.map((value, i) => value + b[i])));
      } else {
        error = Math.hypot(...values[0].map((value, i) => value - values.at(-1)[i]));
      }
      maxLoopEndpointError = Math.max(maxLoopEndpointError, error);
    }
    return { name: animation.name, durationSeconds, channelCount: animation.channels.length, maxLoopEndpointError, translationTracks: translations };
  });
  let triangleCount = 0;
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    const indices = primitive.indices === undefined ? json.accessors[primitive.attributes.POSITION].count : json.accessors[primitive.indices].count;
    triangleCount += Math.floor(indices / 3);
  }
  const images = (json.images ?? []).map((image) => {
    const view = json.bufferViews[image.bufferView];
    const imageBytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    return { mimeType: image.mimeType, bytes: imageBytes.length, dimensions: jpegDimensions(imageBytes) };
  });
  return {
    path: path.relative(projectRoot, file).replaceAll("\\", "/"),
    fileBytes: buffer.length,
    sceneRoots: roots,
    skinCount: skins.length,
    skeletons: skins.map(({ name, skeletonRoot, jointCount, joints }) => ({ name, skeletonRoot, jointCount, joints })),
    animationCount: animations.length,
    animations: animations.map(({ name, durationSeconds, channelCount, maxLoopEndpointError, translationTracks }) => ({
      name, durationSeconds, channelCount, maxLoopEndpointError, rootTranslationTracks: translationTracks,
    })),
    meshNames: (json.meshes ?? []).map((mesh) => mesh.name),
    triangleCount,
    materialCount: (json.materials ?? []).length,
    images,
  };
}

if (process.argv[2]) {
  const report = await audit(assetPath);
  console.log(JSON.stringify(report, null, 2));
} else {
  const runtimePath = path.join(projectRoot, "public/assets/models/enemies/optimized/goblin-meshy-casual-walk.glb");
  const [source, runtime] = await Promise.all([audit(sourcePath), audit(runtimePath)]);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const sourceClip = source.animations[0];
  const runtimeClip = runtime.animations[0];
  assert(source.skinCount === 1 && source.skeletons[0]?.jointCount === 28, "Source rig audit changed: expected one skin with 28 joints.");
  assert(source.animationCount === 1 && sourceClip?.name === "Casual_Walk", "Only the approved Casual_Walk clip should be present on this source file.");
  assert(sourceClip.rootTranslationTracks.some(({ node }) => node === "mixamorig:Hips"), "Hips translation track was not found for root-motion inspection.");
  assert(runtime.skinCount === source.skinCount && runtime.skeletons[0]?.jointCount === source.skeletons[0]?.jointCount, "Runtime optimization changed the Goblin skin/joint count.");
  assert(runtimeClip?.name === "Casual_Walk" && runtimeClip.channelCount === sourceClip.channelCount, "Runtime optimization changed or removed the Casual_Walk clip tracks.");
  assert(runtime.triangleCount < 25000 && runtime.materialCount === source.materialCount && runtime.images.length === source.images.length,
    "Runtime optimization did not preserve materials/textures or reduce the mesh to the intended mobile budget.");
  console.log(JSON.stringify({ source, runtime }, null, 2));
}

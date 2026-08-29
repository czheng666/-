const clipper = globalThis.ClipperLib;

if (!clipper) throw new Error("本地 ClipperLib 尚未加载");

export default clipper;

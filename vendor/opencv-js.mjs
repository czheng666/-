const opencv = globalThis.cv;

if (!opencv) throw new Error("本地 OpenCV.js 尚未加载");

export default opencv;

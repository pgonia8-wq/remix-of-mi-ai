# Media engine rules

- Media engines are pure local modules with unit tests: BS.1770/EBU R128 loudness and true-peak (loudness.ts), timeline timing shared with the FFmpeg plan (timeline.ts), parametric CAD formulas parsed without eval (cad-params.ts), STEP export as planar B-rep from repaired triangulated solids (step.ts), rigid-skin rigging matching glTF bone conventions (rig.ts). Why: previews, exports and renders must agree and stay testable without devices.
- Rig animation samples eased keys with quaternion slerp and bakes non-linear curves at 30 fps for GLB; optional weights2/blend give two-bone skinning. Why: preview and exported animation must match.
- GLB previews dynamically load Three.js after mount and block external GLB resources. Why: native/browser SSR safety and preventing untrusted model files from fetching external data.

import { WATER_LEVEL } from '@cloudsea/sim';
import * as THREE from 'three';

/**
 * 水（DESIGN 14.1，v0.7）：
 * - 水面：细分网格 + 顶点着色器里的多重正弦波（低多边形的起伏小面），菲涅尔式的边缘提亮；
 * - 岸边泡沫：沿岸线的一圈半透明白带，随时间时隐时现；
 * - 水下：人物与絮灵材质里“水面以下的部分”按深度混入水色（看得出哪里在水下），
 *   池底按深度上色（浅处沙色 → 深处青绿）。
 * 水面高度随场景挪动（航行时整座岛被挪到世界坐标），所以水下染色的水位由场景每帧设置。
 */
export const waterUniforms = {
  uTime: { value: 0 },
};

/** 水下染色：水位（世界坐标 y）与水色；uOn = 0 时关闭（航行、战斗）。 */
export const waterTint = {
  uWaterLevel: { value: WATER_LEVEL },
  uWaterColor: { value: new THREE.Color(0x3f8fa6) },
  uWaterOn: { value: 0 },
};

/** 设置当前场景的水位（世界坐标）；null = 关闭水下染色。 */
export function setWaterTint(levelY: number | null): void {
  waterTint.uWaterOn.value = levelY === null ? 0 : 1;
  if (levelY !== null) waterTint.uWaterLevel.value = levelY;
}

/** 给人物 / 絮灵的材质加上水下染色（蒙皮之后的世界坐标判断在不在水下）。 */
export function patchWaterTint(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterTint);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWaterWorldY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWaterWorldY;\nuniform float uWaterLevel;\nuniform vec3 uWaterColor;\nuniform float uWaterOn;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float wDepth = clamp((uWaterLevel - vWaterWorldY) / 1.1, 0.0, 1.0);
        float wEdge = smoothstep(0.0, 0.04, uWaterLevel - vWaterWorldY);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uWaterColor * (0.9 - 0.35 * wDepth), uWaterOn * wEdge * (0.35 + 0.4 * wDepth));`,
      );
  };
  m.customProgramCacheKey = () => 'water-tint';
  return m;
}

/** 水面材质：顶点波动 + 边缘提亮。 */
export const waterMaterial = (() => {
  const m = new THREE.MeshStandardMaterial({ color: 0x7fbfd8, emissive: 0x2f6f88, emissiveIntensity: 0.18, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.74, flatShading: true, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uTime'] = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vWave;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        float wave = sin(wp.x * 1.7 + uTime * 1.6) * 0.035 + sin(wp.z * 2.3 - uTime * 1.2) * 0.03 + sin((wp.x + wp.z) * 3.1 + uTime * 2.4) * 0.015;
        transformed.y += wave;
        vWave = wave;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWave;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb += vec3(0.9, 0.97, 1.0) * smoothstep(0.03, 0.07, vWave) * 0.35;');
  };
  m.customProgramCacheKey = () => 'water-surface';
  return m;
})();

/** 岸边泡沫：沿着形状的一圈白带，透明度随时间与位置起伏。 */
export const foamMaterial = (() => {
  const m = new THREE.MeshBasicMaterial({ color: 0xf6fbff, transparent: true, opacity: 0.55, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uTime'] = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFoamW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFoamW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vFoamW;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nfloat f = 0.5 + 0.5 * sin(vFoamW.x * 4.0 + vFoamW.z * 3.0 + uTime * 1.5);\ngl_FragColor.a *= 0.35 + 0.65 * f;');
  };
  m.customProgramCacheKey = () => 'water-foam';
  return m;
})();

/** 池底颜色：按水深从浅处沙色过渡到深处青绿（HSL）。 */
export function bedColor(out: THREE.Color, depth: number, noise: number): THREE.Color {
  const k = Math.max(0, Math.min(1, depth / 1.6));
  return out.setHSL(0.1 + k * 0.4, 0.25 + k * 0.15, 0.42 - k * 0.2 + (noise - 0.5) * 0.05);
}

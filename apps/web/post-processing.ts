import {
  BokehPass,
  EffectComposer,
  GTAOPass,
  OutputPass,
  RenderPass,
  SMAAPass,
  ShaderPass,
  UnrealBloomPass,
} from 'three/addons'
import * as THREE from 'three'
import type {
  PostProcessingPass,
  PostProcessingRendererFactory,
} from '@nerima-games/mc-render'
import {
  chainEffects,
} from '@nerima-games/mc-render'
import type { PostProcessingStep } from '@nerima-games/mc-render'

const signatureOf = (chain: ReadonlyArray<PostProcessingStep>): string =>
  chain.map(({ pass, effects }) => `${pass}:${effects.join(',')}`).join('|')

const GOD_RAYS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    lightPosition: { value: new THREE.Vector2(0.5, 0.72) },
    exposure: { value: 0.18 },
    decay: { value: 0.96 },
    density: { value: 0.8 },
    weight: { value: 0.22 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 lightPosition;
    uniform float exposure;
    uniform float decay;
    uniform float density;
    uniform float weight;
    varying vec2 vUv;

    void main() {
      vec2 delta = (vUv - lightPosition) * (density / 32.0);
      vec2 sampleUv = vUv;
      float illumination = 1.0;
      vec3 rays = vec3(0.0);

      for (int index = 0; index < 32; index++) {
        sampleUv -= delta;
        vec3 sampleColor = texture2D(tDiffuse, sampleUv).rgb;
        float luminance = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
        rays += sampleColor * luminance * illumination * weight;
        illumination *= decay;
      }

      vec3 base = texture2D(tDiffuse, vUv).rgb;
      gl_FragColor = vec4(base + rays * exposure, 1.0);
    }
  `,
}

const addGodRaysPass = (composer: EffectComposer): void => {
  composer.addPass(new ShaderPass(GOD_RAYS_SHADER))
}

/**
 * Adapt mc-render's platform-neutral plan to Three's postprocessing passes.
 * The render package owns the pass policy; this host owns Three resources.
 */
export const makeThreePostProcessingRenderer: PostProcessingRendererFactory = ({
  renderer,
  scene,
  camera,
  viewport,
}) => {
  const nativeRenderer = renderer as unknown as THREE.WebGLRenderer
  const nativeScene = scene as unknown as THREE.Scene
  const nativeCamera = camera as unknown as THREE.Camera
  const composer = new EffectComposer(nativeRenderer)
  let configuredSignature = ''

  const rebuild = (chain: ReadonlyArray<PostProcessingStep>): void => {
    const signature = signatureOf(chain)
    if (signature === configuredSignature) return
    for (const pass of composer.passes) {
      pass.dispose?.()
    }
    composer.passes.length = 0
    const effects: ReadonlyArray<PostProcessingPass> = chainEffects(chain)
    composer.addPass(new RenderPass(nativeScene, nativeCamera))
    for (const effect of effects) {
      if (effect === 'gtao') {
        composer.addPass(new GTAOPass(nativeScene, nativeCamera, viewport.width, viewport.height))
      }
      if (effect === 'godRays') {
        addGodRaysPass(composer)
      }
      if (effect === 'bloom') {
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(viewport.width, viewport.height), 0.8, 0.35, 0.75))
      }
      if (effect === 'bokeh') {
        composer.addPass(new BokehPass(nativeScene, nativeCamera, {
          focus: 10,
          aperture: 0.00015,
          maxblur: 0.01,
        }))
      }
      if (effect === 'smaa') {
        composer.addPass(new SMAAPass(viewport.width, viewport.height))
      }
    }
    composer.addPass(new OutputPass())
    configuredSignature = signature
  }

  composer.setSize(viewport.width, viewport.height)
  return {
    render: (chain) => {
      rebuild(chain)
      composer.render()
    },
    resize: (width, height) => {
      composer.setSize(width, height)
    },
    dispose: () => composer.dispose(),
  }
}

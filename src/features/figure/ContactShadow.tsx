import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Color,
  DoubleSide,
  Mesh,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type Texture,
} from 'three'

type Props = {
  size?: number
  resolution?: number
  /** metres above the floor that still cast */
  far?: number
  /** blur radius in texels */
  blur?: number
  opacity?: number
  color?: string
}

const blurShader = (dir: [number, number]) =>
  new ShaderMaterial({
    uniforms: { tMap: { value: null as Texture | null }, uStep: { value: dir } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tMap; uniform vec2 uStep; varying vec2 vUv;
      void main() {
        vec4 s = vec4(0.0); float wsum = 0.0;
        for (int i = -6; i <= 6; i++) {
          float w = exp(-float(i * i) / 18.0);
          s += texture2D(tMap, vUv + uStep * float(i)) * w; wsum += w;
        }
        gl_FragColor = s / wsum;
      }`,
    depthTest: false,
    depthWrite: false,
  })

/** Soft ground contact shadow: depth of the lowest surface seen from below, blurred. Self-contained. */
export function ContactShadow({ size = 3.2, resolution = 512, far = 0.8, blur = 2, opacity = 0.7, color = '#241e19' }: Props) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const plane = useRef<Mesh>(null)
  const res = useMemo(() => {
    const rt = new WebGLRenderTarget(resolution, resolution)
    const rt2 = new WebGLRenderTarget(resolution, resolution)
    const cam = new OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, far)
    cam.rotation.x = Math.PI / 2
    cam.updateMatrixWorld()
    const depth = new MeshDepthMaterial()
    depth.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 2.0 ) );',
      )
    }
    const quadScene = new Scene()
    const quad = new Mesh(new PlaneGeometry(2, 2))
    quad.frustumCulled = false
    quadScene.add(quad)
    const h = blurShader([1 / resolution, 0])
    const v = blurShader([0, 1 / resolution])
    return { rt, rt2, cam, depth, quadScene, quad, h, v }
  }, [resolution, size, far])

  useEffect(() => () => {
    res.rt.dispose()
    res.rt2.dispose()
    res.depth.dispose()
    res.h.dispose()
    res.v.dispose()
  }, [res])

  useFrame(() => {
    const p = plane.current
    if (!p) return
    const prev = { target: gl.getRenderTarget(), override: scene.overrideMaterial, bg: scene.background, alpha: gl.getClearAlpha() }
    const clear = new Color()
    gl.getClearColor(clear)
    p.visible = false
    scene.overrideMaterial = res.depth
    scene.background = null
    gl.setClearColor(0x000000, 0)
    gl.setRenderTarget(res.rt)
    gl.clear()
    gl.render(scene, res.cam)
    scene.overrideMaterial = prev.override
    scene.background = prev.bg
    for (let pass = 0; pass < 2; pass++) {
      res.h.uniforms.uStep.value = [blur / resolution, 0]
      res.v.uniforms.uStep.value = [0, blur / resolution]
      res.h.uniforms.tMap.value = res.rt.texture
      res.quad.material = res.h
      gl.setRenderTarget(res.rt2)
      gl.render(res.quadScene, res.cam)
      res.v.uniforms.tMap.value = res.rt2.texture
      res.quad.material = res.v
      gl.setRenderTarget(res.rt)
      gl.render(res.quadScene, res.cam)
    }
    gl.setRenderTarget(prev.target)
    gl.setClearColor(clear, prev.alpha)
    p.visible = true
  })

  return (
    <mesh ref={plane} rotation-x={Math.PI / 2} position-y={0.002} renderOrder={-1}>
      <planeGeometry args={[size, size]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        side={DoubleSide}
        uniforms={{ tMap: { value: res.rt.texture }, uColor: { value: new Color(color) }, uOpacity: { value: opacity } }}
        vertexShader="varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
        fragmentShader="uniform sampler2D tMap; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; void main() { gl_FragColor = vec4(uColor, texture2D(tMap, vUv).a * uOpacity); }"
      />
    </mesh>
  )
}

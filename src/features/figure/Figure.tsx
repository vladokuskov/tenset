import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, type Ref } from 'react'
import type { Material, Mesh, Object3D } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { BODY_URL, type FigureVariant } from './assets'
import { createRegionLut, fillDebugLut, fillHighlightLut, useFigureAtlas } from './atlas'
import { Correctives } from './correctives'
import { dqsBoneFactors } from './dqs'
import { resolveHighlight, type FigureHighlight } from './highlight'
import { HighlightMask } from './mask'
import { createFigureMaterial, setHighlightEnabled, setPulsePhase, type FigureMaterialName, type FigureUniforms, type MaterialOptions } from './material'
import { poses, type PoseName } from './poses'
import { Rig, type Pose } from './rig'

const MATERIALS: FigureMaterialName[] = ['skin', 'hair', 'shorts', 'eyes']

export type FigureHandle = {
  rig: Rig
  scene: Object3D
  correctives: Correctives
  setPose: (pose: Pose | PoseName) => void
  /** worked muscles by taxonomy id (groups expand to their heads) */
  setHighlight: (h: FigureHighlight | null) => void
  /** concentric pulse inside highlighted muscles, phase 0..1; null turns it off */
  setPulse: (phase: number | null) => void
}

export type FigureProps = {
  pose?: Pose | PoseName
  /** @deprecated ignored: one head ships */
  variant?: FigureVariant
  /** skin material options */
  skin?: MaterialOptions
  materials?: Partial<Record<FigureMaterialName, MaterialOptions>>
  /** angle-keyed corrective morphs (default on; off only for QA comparisons) */
  correctives?: boolean
  /** worked muscles, drawn through the head-level atlas */
  highlight?: FigureHighlight
  /** concentric pulse phase 0..1 inside the highlighted muscles */
  pulse?: number | null
  /** muscle atlas (relief + highlight); off only for QA comparisons */
  atlas?: boolean
  /** QA: unlit flat region colours, hair and shorts hidden */
  atlasFlat?: boolean
  castShadow?: boolean
  onReady?: (handle: FigureHandle) => void
  ref?: Ref<FigureHandle>
}

function resolve(pose: Pose | PoseName): Pose {
  return typeof pose === 'string' ? poses[pose] : pose
}

export function Figure({
  pose = 'relaxed',
  skin,
  materials,
  correctives: useCorrectives = true,
  highlight,
  pulse = null,
  atlas: useAtlas = true,
  atlasFlat = false,
  castShadow = false,
  onReady,
  ref,
}: FigureProps) {
  const gl = useThree((s) => s.gl)
  const gltf = useGLTF(BODY_URL, false, true)
  const atlas = useFigureAtlas()
  const lut = useMemo(() => createRegionLut(), [])
  const mask = useMemo(() => new HighlightMask(atlas.regions, lut), [atlas, lut])
  useEffect(() => () => {
    lut.dispose()
    mask.dispose()
  }, [lut, mask])
  const scene = useMemo(() => cloneSkinned(gltf.scene), [gltf.scene])
  const rig = useMemo(() => new Rig(scene), [scene])
  const correctives = useMemo(() => Correctives.fromScene(rig, scene, useCorrectives), [rig, scene, useCorrectives])
  const built = useMemo(() => {
    const bones = dqsBoneFactors(rig.mesh.skeleton.bones.map((b) => b.name))
    const vertexMix = rig.mesh.geometry.hasAttribute('color')
    const inv = rig.dequant.clone().invert()
    const out = {} as Record<FigureMaterialName, Material>
    let skinUniforms: FigureUniforms | null = null
    const atlasInput = useAtlas || atlasFlat
      ? { regions: atlas.regions, relief: atlas.relief, fibre: atlas.fibre, lut, mask: mask.texture, reliefRange: atlas.reliefRange, fibreAmp: atlas.fibreAmp, flat: atlasFlat }
      : undefined
    for (const name of MATERIALS) {
      const m = createFigureMaterial(name, name === 'skin' ? { ...materials?.skin, ...skin } : materials?.[name], bones, vertexMix, atlasInput)
      m.uniforms.uDequant.value.copy(rig.dequant)
      m.uniforms.uDequantInv.value.copy(inv)
      out[name] = m.material
      if (name === 'skin') skinUniforms = m.uniforms
    }
    return { mats: out, skinUniforms: skinUniforms! }
  }, [skin, materials, rig, atlas, lut, mask, useAtlas, atlasFlat])
  const { mats, skinUniforms } = built

  useLayoutEffect(() => {
    scene.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) {
        const name = m.userData.figureMaterial as FigureMaterialName | undefined ?? (m.material as Material).name as FigureMaterialName
        m.userData.figureMaterial = name
        m.material = mats[name] ?? mats.skin
        m.visible = !(atlasFlat && (name === 'hair' || name === 'shorts'))
        m.castShadow = castShadow
        m.receiveShadow = castShadow
        m.frustumCulled = false
      }
    })
  }, [scene, mats, castShadow, atlasFlat])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])

  const handle = useMemo<FigureHandle>(
    () => ({
      rig,
      scene,
      correctives,
      setPose: (p) => {
        rig.apply(resolve(p))
        correctives.update()
      },
      setHighlight: (h) => {
        if (atlasFlat) {
          fillDebugLut(lut, atlas.meta)
          return
        }
        const any = fillHighlightLut(lut, atlas.meta, resolveHighlight(h ?? undefined))
        if (any) mask.bake(gl)
        setHighlightEnabled(skinUniforms, any)
      },
      setPulse: (phase) => setPulsePhase(skinUniforms, phase),
    }),
    [rig, scene, correctives, atlasFlat, lut, atlas, mask, gl, skinUniforms],
  )
  useImperativeHandle(ref, () => handle, [handle])

  const highlightKey = JSON.stringify(highlight ?? null)
  useLayoutEffect(() => {
    handle.setHighlight(JSON.parse(highlightKey) as FigureHighlight | null)
  }, [handle, highlightKey])

  useLayoutEffect(() => handle.setPulse(pulse), [handle, pulse])

  useLayoutEffect(() => {
    handle.setPose(pose)
    onReady?.(handle)
  }, [handle, pose, onReady])

  // poses may also be driven directly through the rig (motions), so keep the morphs in step every frame
  useFrame(() => correctives.update())

  return <primitive object={scene} />
}

useGLTF.preload(BODY_URL, false, true)

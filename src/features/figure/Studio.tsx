import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import { PMREMGenerator } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ContactShadow } from './ContactShadow'

/** Self-hosted image-based light from three's procedural RoomEnvironment (no network). */
export function StudioEnvironment({ intensity = 0.25 }: { intensity?: number }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useLayoutEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const env = pmrem.fromScene(room, 0.04).texture
    scene.environment = env
    scene.environmentIntensity = intensity
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
      room.dispose()
    }
  }, [gl, scene, intensity])
  return null
}

/** Neutral key / fill / rim rig for white backgrounds; rotates with the camera azimuth. */
export function StudioLights({ azimuth = 0 }: { azimuth?: number }) {
  return (
    <group rotation-y={azimuth}>
      {/* key: high, camera left */}
      <directionalLight position={[-2.0, 4.2, 2.4]} intensity={2.5} color="#fffdfa" />
      {/* fill: low, camera right */}
      <directionalLight position={[3.2, 0.8, 2.0]} intensity={0.3} color="#f2f5fa" />
      {/* rims: behind, both sides, to lift the silhouette off the white */}
      <directionalLight position={[2.6, 2.2, -3.0]} intensity={0.6} color="#ffffff" />
      <directionalLight position={[-3.0, 1.4, -2.2]} intensity={0.35} color="#ffffff" />
      <hemisphereLight args={['#ffffff', '#737377', 0.22]} />
    </group>
  )
}

export function StudioFloor() {
  return (
    <ContactShadow size={3.2} resolution={512} far={0.8} blur={2.2} opacity={0.62} color="#2b2b2d" />
  )
}

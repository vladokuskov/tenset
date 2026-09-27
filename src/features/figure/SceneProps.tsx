import { useMemo } from 'react'
import type { FigureHandle } from './Figure'
import { Bench } from './props/Bench'
import { Dumbbell } from './props/Dumbbell'
import { fitSeatedBench } from './props/fit'
import { HandProp } from './props/HandProp'
import type { BenchParams } from './props/sockets'
import type { ExerciseScene } from './scenes'

// the figure is posed before its handle reaches the scene content, so the fit can run during render
function SeatedBench({ figure, params }: { figure: FigureHandle; params: BenchParams }) {
  const fit = useMemo(() => {
    figure.scene.updateMatrixWorld(true)
    return fitSeatedBench(figure, params)
  }, [figure, params])
  return (
    <group position={fit.position}>
      <Bench {...fit.params} />
    </group>
  )
}

/** An exercise scene's equipment, placed on the posed figure. */
export function SceneProps({ scene, figure }: { scene: ExerciseScene; figure: FigureHandle }) {
  return (
    <>
      {scene.dumbbells && (['L', 'R'] as const).map((side) => (
        <HandProp key={side} figure={figure} side={side}>
          <Dumbbell />
        </HandProp>
      ))}
      {scene.bench && <SeatedBench figure={figure} params={scene.bench} />}
    </>
  )
}

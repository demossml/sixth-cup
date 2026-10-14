import Phaser from 'phaser'
import { RUNNER_CONFIG } from './config'
import type { GameBridge } from './types'
import { DEFAULT_LEVEL } from './levels'
import { BootScene } from './scenes/BootScene'
import { RunnerScene } from './scenes/RunnerScene'

export function createRunnerConfig(
  parent: HTMLElement,
  bridge: GameBridge,
  levelId = DEFAULT_LEVEL.id,
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: RUNNER_CONFIG.width,
    height: RUNNER_CONFIG.height,
    backgroundColor: '#A9D0F5',
    scale: {
      // Мир 960×540 вписывается в родителя (который занимает почти весь viewport)
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: RUNNER_CONFIG.width,
      height: RUNNER_CONFIG.height,
    },
    render: { antialias: true, powerPreference: 'high-performance' },
    fps: { target: 60, smoothStep: true },
    // физика Phaser не нужна: вся логика в core/RunnerCore
    audio: { noAudio: true },
    banner: false,
    input: { mouse: true, touch: true, keyboard: false, gamepad: false },
    scene: [BootScene, RunnerScene],
    callbacks: {
      preBoot: (game) => {
        game.registry.set('bridge', bridge)
        game.registry.set('levelId', levelId)
      },
    },
  }
}

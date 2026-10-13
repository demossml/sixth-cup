import Phaser from 'phaser'
import { RUNNER_CONFIG } from './config'
import type { GameBridge } from './types'
import { BootScene } from './scenes/BootScene'
import { RunnerScene } from './scenes/RunnerScene'

export function createRunnerConfig(
  parent: HTMLElement,
  bridge: GameBridge,
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: RUNNER_CONFIG.width,
    height: RUNNER_CONFIG.height,
    backgroundColor: '#87B5E8',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: RUNNER_CONFIG.width,
      height: RUNNER_CONFIG.height,
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [BootScene, RunnerScene],
    audio: { noAudio: true },
    banner: false,
    callbacks: {
      preBoot: (game) => {
        game.registry.set('bridge', bridge)
      },
    },
  }
}

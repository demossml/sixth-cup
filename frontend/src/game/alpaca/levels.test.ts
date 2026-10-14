import { describe, expect, it } from 'vitest'
import { RUNNER_LEVELS } from './levels'
import { RunnerCore } from './core/RunnerCore'
import { RUNNER_CONFIG } from './config'

describe('runner level data', () => {
  it('contains four uniquely identified levels with finish and bean totals', () => {
    expect(RUNNER_LEVELS).toHaveLength(4)
    for (const level of RUNNER_LEVELS) {
      const ids = level.objects.map(o => o.id)
      expect(new Set(ids).size, level.id).toBe(ids.length)
      expect(level.objects.some(o => o.type === 'finish'), level.id).toBe(true)
      expect(level.beansTotal, level.id).toBe(level.objects.filter(o => o.type === 'bean').length)
      expect(level.length).toBeGreaterThan(4000)
    }
  })
  it('adds chase, thrown projectiles, moving overheads and a speed zone on later levels', () => {
    expect(RUNNER_LEVELS[1].antagonist).toBe('chase')
    expect(RUNNER_LEVELS[1].objects.some(o => o.type === 'inspector')).toBe(true)
    expect(RUNNER_LEVELS[2].objects.some(o => o.type === 'projectile')).toBe(true)
    expect(RUNNER_LEVELS[2].objects.some(o => o.type === 'movingOverhead')).toBe(true)
    expect(RUNNER_LEVELS[3].objects.some(o => o.type === 'closedZone')).toBe(true)
  })
})

function botRun(level: (typeof RUNNER_LEVELS)[number]) {
  const core = new RunnerCore(level.objects, level.length, level.antagonist === 'chase', level.antagonist === 'throw')
  let elapsed = 0
  const crateLead = level.id === 'morning-coffee-city-01' ? 40 : 120
  while (core.status === 'running' && elapsed < 60_000) {
    for (const object of level.objects) {
      const distance = object.x - core.worldX - (RUNNER_CONFIG.heroX + RUNNER_CONFIG.hitbox.run.w / 2 + RUNNER_CONFIG.hitbox.run.offsetX)
      if (distance < -200) continue
      const jumpLead = object.type === 'crate' ? crateLead : object.type === 'projectile' || object.type === 'inspector' ? 40 : 0
      if (jumpLead && core.grounded && distance <= jumpLead && distance > jumpLead - 12) core.jump()
      if ((object.type === 'overhead' || object.type === 'movingOverhead') && core.grounded && !core.sliding && distance <= 30 && distance > 18) core.slide()
    }
    core.step(8)
    elapsed += 8
  }
  return { core, elapsed }
}

describe('проходимость четырёх уровней ботом', () => {
  it.each(RUNNER_LEVELS)('$name можно пройти без пиксель-перфекта', (level) => {
    const { core, elapsed } = botRun(level)
    expect(core.status, level.id).toBe('finished')
    expect(elapsed, level.id).toBeLessThan(35_000)
    expect(core.beans, level.id).toBe(level.beansTotal)
  })
})

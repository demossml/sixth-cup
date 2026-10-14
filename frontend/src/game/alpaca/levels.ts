import type { LevelObject } from './types'
import { RUNNER_CONFIG } from './config'
import { FINISH_WIDTH, LEVEL_01_NAME, LEVEL_01_OBJECTS } from './level01'

export interface RunnerLevel {
  id: string
  name: string
  subtitle: string
  objects: LevelObject[]
  beansTotal: number
  length: number
  tip: string
  antagonist: 'none' | 'chase' | 'throw' | 'closed'
}
const G = RUNNER_CONFIG.groundY
const U = RUNNER_CONFIG.crateUnit
const bean = (id: string, x: number, y = G - 42, special = false): LevelObject => ({ type: 'bean', id, x, y, special })
const crate = (id: string, x: number, width: number = U, height: number = U): LevelObject => ({ type: 'crate', id, x, width, height })
const banner = (id: string, x: number): LevelObject => ({ type: 'overhead', id, x, width: RUNNER_CONFIG.bannerWidth, height: 0 })
const movingBanner = (id: string, x: number): LevelObject => ({ type: 'movingOverhead', id, x, width: RUNNER_CONFIG.bannerWidth, height: 0 })
const finish = (x: number): LevelObject => ({ type: 'finish', id: 'finish', x })
const closedZone = (id: string, x: number, width: number): LevelObject => ({ type: 'closedZone', id, x, width })
const build = (id: string, name: string, subtitle: string, tip: string, antagonist: RunnerLevel['antagonist'], objects: LevelObject[], finishX: number): RunnerLevel => ({
  id, name, subtitle, tip, antagonist, objects, beansTotal: objects.filter(o => o.type === 'bean').length,
  length: finishX + FINISH_WIDTH / 2 - RUNNER_CONFIG.heroX,
})

export const RUNNER_LEVELS: RunnerLevel[] = [
  build('morning-coffee-city-01', LEVEL_01_NAME, 'Утро в городе · обучение', 'Тап или свайп вверх — прыгнуть. Свайп вниз — скользить под баннером. На ящики можно запрыгивать.', 'none', LEVEL_01_OBJECTS, 5000),
  build('alley-rush-02', 'Переулок', 'Серый бариста уже близко', 'Инспектор догоняет сзади! Перепрыгивай ящики и собирай синие зёрна — они отбрасывают его назад.', 'chase', [
    bean('a1', 520), bean('a2', 590), bean('a3', 660),
    crate('a-c1', 1000), bean('a4', 990, G-104), bean('a5', 1050, G-122),
    crate('a-c2', 1460, U*2), bean('a6', 1485, G-110), bean('a7', 1550, G-110),
    {type:'inspector', id:'inspector-chase-1', x:1910},
    bean('a8', 2070, G-42, true), bean('a9', 2140, G-42, true), bean('a10', 2210, G-42, true),
    banner('a-o1', 2460), bean('a11', 2490, G-16),
    crate('a-c3', 2960, U*2), bean('a12', 2980, G-110), bean('a13', 3040, G-110),
    {type:'inspector', id:'inspector-chase-2', x:3400},
    crate('a-c4', 3830), banner('a-o2', 4310), bean('a14', 4340, G-16), bean('a15', 4600), bean('a16', 4680),
    crate('a-c5', 5100), bean('a17', 5130, G-110), movingBanner('a-o3', 5550), bean('a18', 5580, G-16), bean('a19', 5750), finish(6000),
  ], 6000),
  build('terrace-wind-03', 'Терраса', 'Ветер, летящие помехи и двойной прыжок', 'На террасе инспектор бросает мусор-скидку. Перепрыгни летящий предмет; синие зёрна дают второй прыжок в воздухе.', 'throw', [
    bean('t1',520), bean('t2',600), crate('t-c1',1000), bean('t3',1010,G-112),
    {type:'projectile',id:'t-p1',x:1430,y:G-78,width:42,height:38}, bean('t4',1490,G-42,true),
    movingBanner('t-o1',1830), bean('t5',1860,G-16), crate('t-c2',2300,U*2), bean('t6',2330,G-110), bean('t7',2390,G-110),
    {type:'inspector',id:'inspector-throw-1',x:2850}, {type:'projectile',id:'t-p2',x:3200,y:G-78,width:46,height:40},
    bean('t8',3260,G-42,true), movingBanner('t-o2',3480), bean('t9',3510,G-16), crate('t-c3',3900),
    bean('t10',3930,G-110), {type:'projectile',id:'t-p3',x:4310,y:G-78,width:42,height:38}, bean('t11',4550), bean('t12',4630),
    crate('t-c4',5100), bean('t13',5130,G-110), movingBanner('t-o3',5650), bean('t14',5680,G-16),
    {type:'projectile',id:'t-p4',x:6150,y:G-78,width:42,height:38}, bean('t15',6450), finish(6700),
  ], 6700),
  build('night-shift-04', 'Ночная смена', 'Финальный забег', 'Закрытая зона ускоряет препятствия. Следи за баннерами, бросками и инспектором — не торопись собирать каждое зерно.', 'closed', [
    bean('n1',520), bean('n2',600), crate('n-c1',1000), bean('n3',1010,G-110),
    banner('n-o1',1450), bean('n4',1480,G-16), {type:'projectile',id:'n-p1',x:1850,y:G-78,width:42,height:38},
    crate('n-c2',2210,U*2), bean('n5',2240,G-110), bean('n6',2300,G-110),
    {type:'inspector',id:'inspector-final-1',x:2800}, closedZone('n-closed-zone',2700,560), movingBanner('n-o2',3150), bean('n7',3180,G-16),
    {type:'projectile',id:'n-p2',x:3500,y:G-78,width:44,height:40}, crate('n-c3',3780), bean('n8',3810,G-110),
    {type:'inspector',id:'inspector-final-2',x:4120}, banner('n-o3',4430), bean('n9',4460,G-16), bean('n10',4680),
    crate('n-c4',5200), bean('n11',5230,G-110), movingBanner('n-o4',5750), bean('n12',5780,G-16),
    {type:'projectile',id:'n-p3',x:6200,y:G-78,width:44,height:40}, {type:'inspector',id:'inspector-final-3',x:6700}, bean('n13',6950), finish(7400),
  ], 7400),
]
export const DEFAULT_LEVEL = RUNNER_LEVELS[0]
export function getRunnerLevel(id?: string): RunnerLevel {
  return RUNNER_LEVELS.find(level => level.id === id) ?? DEFAULT_LEVEL
}
export const LEVEL_MAX_BEANS: Record<string, number> = Object.fromEntries(RUNNER_LEVELS.map(level => [level.id, level.beansTotal]))

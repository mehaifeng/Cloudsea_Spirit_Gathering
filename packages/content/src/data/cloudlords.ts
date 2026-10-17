import type { CloudlordInput } from '../cloudlords';

/** 云主（DESIGN 5.3，M2）：先做晴原一位。 */
export const CLOUDLORDS: readonly CloudlordInput[] = [
  {
    id: 'sunPlainsLord',
    name: '蚀化的曦冕',
    region: 'sunPlains',
    island: 'sunLighthouse',
    boss: { line: 'warmbud', formIndex: 2, level: 16 },
    guards: [
      { line: 'kitefluff', formIndex: 1, level: 12 },
      { line: 'forgespark', formIndex: 1, level: 12 },
    ],
    extraActions: 1,
    hpScale: [1, 1.6, 2.2, 2.8],
    weather: 'sun',
    skills: ['eclipseFlare', 'eclipseWave', 'eclipseMend'],
    phases: [
      { hpBelow: 0.66, skills: ['eclipseFlare', 'eclipseWave', 'eclipseGlare'], line: '曦冕的蚀光暗了一下，又更刺眼地亮了起来！' },
      { hpBelow: 0.33, skills: ['eclipseSmite', 'eclipseWave', 'eclipseGlare'], stages: [{ stat: 'power', delta: 2 }], line: '曦冕发狂了，蚀光凝成了沉重的光锤！' },
    ],
    reward: { shells: 300 },
    description: '灯塔熄灭后，一只曦冕被蚀雾吞没，盘踞在晴原灯塔下。',
  },
];

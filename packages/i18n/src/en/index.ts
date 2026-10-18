import content from './content.json';
import extra from './extra.json';
import keepersMist from './keepersMist.json';
import keepersRain from './keepersRain.json';
import keepersSun from './keepersSun.json';
import keepersThunder from './keepersThunder.json';
import keepersWind from './keepersWind.json';
import sim from './sim.json';
import ui from './ui.json';

/** 英文表：中文原文 → 英文（M4-3）。按来源分文件，合并成一张表。 */
export const EN: Readonly<Record<string, string>> = { ...content, ...keepersSun, ...keepersWind, ...keepersRain, ...keepersThunder, ...keepersMist, ...sim, ...ui, ...extra };

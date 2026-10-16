import { z } from 'zod';
import type { Element } from './elements';

/** 工作类型（DESIGN 4.1 工作特长）。 */
export const WORK_TASKS = [
  'planting',
  'baking',
  'irrigation',
  'brewing',
  'windmill',
  'transport',
  'power',
  'smithing',
  'storage',
  'perfumery',
] as const;
export const workTaskSchema = z.enum(WORK_TASKS);
export type WorkTask = z.infer<typeof workTaskSchema>;

export const WORK_TASK_NAME: Readonly<Record<WorkTask, string>> = {
  planting: '种植',
  baking: '烘烤',
  irrigation: '灌溉',
  brewing: '酿造',
  windmill: '风车',
  transport: '运输',
  power: '发电',
  smithing: '锻造',
  storage: '储藏',
  perfumery: '调香',
};

/** 每个属性擅长的工作。双属性两者都算（DESIGN 4.2）。 */
export const ELEMENT_WORK: Readonly<Record<Element, readonly WorkTask[]>> = {
  sun: ['planting', 'baking'],
  rain: ['irrigation', 'brewing'],
  wind: ['windmill', 'transport'],
  thunder: ['power', 'smithing'],
  mist: ['storage', 'perfumery'],
};

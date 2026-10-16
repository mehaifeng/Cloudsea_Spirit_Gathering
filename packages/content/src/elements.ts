import { z } from 'zod';

/** 五天象属性（DESIGN 4.1）。 */
export const ELEMENTS = ['sun', 'rain', 'wind', 'thunder', 'mist'] as const;

export const elementSchema = z.enum(ELEMENTS);
export type Element = z.infer<typeof elementSchema>;

export interface ElementInfo {
  /** 显示名（中文源语言）。 */
  readonly name: string;
  /** 本地化键。 */
  readonly nameKey: string;
  /** 属性色，CLAUDE.md 固定值。 */
  readonly color: string;
}

export const ELEMENT_INFO: Readonly<Record<Element, ElementInfo>> = {
  sun: { name: '晴', nameKey: 'element.sun', color: '#F3B94D' },
  rain: { name: '雨', nameKey: 'element.rain', color: '#5AA9E6' },
  wind: { name: '风', nameKey: 'element.wind', color: '#5CC8A0' },
  thunder: { name: '雷', nameKey: 'element.thunder', color: '#A77BE8' },
  mist: { name: '雾', nameKey: 'element.mist', color: '#B8BFD6' },
};

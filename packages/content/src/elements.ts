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

/** 相克：键克值（晴克雾 · 雾克雷 · 雷克雨 · 雨克风 · 风克晴）。 */
export const COUNTERS: Readonly<Record<Element, Element>> = {
  sun: 'mist',
  mist: 'thunder',
  thunder: 'rain',
  rain: 'wind',
  wind: 'sun',
};

/** 相生：键生值（雨生晴 · 晴生雷 · 雷生风 · 风生雾 · 雾生雨）。 */
export const GENERATES: Readonly<Record<Element, Element>> = {
  rain: 'sun',
  sun: 'thunder',
  thunder: 'wind',
  wind: 'mist',
  mist: 'rain',
};

/** 每个属性自带的本源技能（DESIGN 4.4）。双属性絮灵只带主属性的本源技能。 */
export const INNATE_SKILL: Readonly<Record<Element, string>> = {
  sun: 'dawnlight',
  rain: 'downpour',
  wind: 'whirl',
  thunder: 'boltStrike',
  mist: 'mistVeil',
};

/** 每个属性的通用技能书（D35）。 */
export const ELEMENT_BOOK_SKILL: Readonly<Record<Element, string>> = {
  sun: 'sunflare',
  rain: 'waterBolt',
  wind: 'windBlade',
  thunder: 'sparkShot',
  mist: 'mistLash',
};

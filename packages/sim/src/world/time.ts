/**
 * 游戏内时间（DESIGN 3.5）：只认 tick，不读系统时钟。
 * 1 游戏日 = 现实 20 分钟 = 12000 tick（10 tick / 秒）。
 * 白天 06:00–19:00 占 13 分钟，夜晚 19:00–06:00 占 7 分钟——钟面流速有意不均匀（D22）。
 */
export const TICKS_PER_SECOND = 10;
export const TICKS_PER_DAY = 12000;
export const DAY_TICKS = 7800;
export const NIGHT_TICKS = TICKS_PER_DAY - DAY_TICKS;
export const DAY_START_HOUR = 6;
export const DAY_HOURS = 13;
export const NIGHT_HOURS = 11;

export interface Clock {
  /** 第几天（从 1 开始）。 */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly isNight: boolean;
  /** 当天已过的 tick。 */
  readonly tickOfDay: number;
}

export function dayOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY) + 1;
}

export function clockAt(tick: number): Clock {
  const t = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  const isNight = t >= DAY_TICKS;
  const hoursIn = isNight ? ((t - DAY_TICKS) / NIGHT_TICKS) * NIGHT_HOURS : (t / DAY_TICKS) * DAY_HOURS;
  const totalMinutes = Math.floor(((isNight ? DAY_START_HOUR + DAY_HOURS : DAY_START_HOUR) + hoursIn) * 60);
  return {
    day: dayOf(tick),
    hour: Math.floor(totalMinutes / 60) % 24,
    minute: totalMinutes % 60,
    isNight,
    tickOfDay: t,
  };
}

/** 0..1 的“太阳高度”，渲染端插值天空用：白天 0→1→0，夜里为 0。 */
export function daylight(tick: number): number {
  const { tickOfDay, isNight } = clockAt(tick);
  if (isNight) return 0;
  return Math.sin((tickOfDay / DAY_TICKS) * Math.PI);
}

export function formatClock(c: Clock): string {
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

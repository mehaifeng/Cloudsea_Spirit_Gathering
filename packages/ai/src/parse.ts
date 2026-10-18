import { PLANNER_GOALS } from '@cloudsea/content';
import { z } from 'zod';
import { cleanLine } from './filter';

/** 从模型回复里取出 JSON 对象（容忍 ```json 代码块和前后废话）。 */
export function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  const text = fenced ? fenced[1]! : content;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const talkSchema = z.object({ text: z.string() });
const planSchema = z.object({ goal: z.enum(PLANNER_GOALS), note: z.string().optional() });
const summarySchema = z.object({ summary: z.string() });

/** 守岛人说的一句话；不合格 = null。 */
export function parseTalk(content: string): string | null {
  const r = talkSchema.safeParse(extractJson(content));
  return r.success ? cleanLine(r.data.text, 120) : null;
}

/** 今天的目标（只能是白名单里的，DESIGN 11.4）与一句打算。 */
export function parsePlan(content: string): { goal: (typeof PLANNER_GOALS)[number]; note?: string } | null {
  const r = planSchema.safeParse(extractJson(content));
  if (!r.success) return null;
  const note = r.data.note === undefined ? undefined : cleanLine(r.data.note, 60);
  return note ? { goal: r.data.goal, note } : { goal: r.data.goal };
}

export function parseSummary(content: string): string | null {
  const r = summarySchema.safeParse(extractJson(content));
  return r.success ? cleanLine(r.data.summary, 300) : null;
}

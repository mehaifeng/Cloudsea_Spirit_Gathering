/**
 * 运行时生成内容的防护（DESIGN 11.6，M3-4）：
 * 敏感词过滤、跳出角色检查、长度上限；房主生成时和客人显示时各做一次。
 * 词表刻意保持很短、只拦明显越界的内容：误杀的代价只是回退到对话库的那句话。
 */
const BLOCKED: readonly string[] = [
  // 跳出角色 / 暴露模型身份
  '语言模型', '人工智能', 'AI助手', 'AI 助手', 'ChatGPT', 'OpenAI', 'as an AI', 'language model', '作为一个AI', '作为AI',
  // 越界话题（游戏是全年龄的温和作品）
  '政治', '政府', '总统', '主席', '共产党', '宗教', '上帝', '真主', '色情', '性爱', '裸体', '毒品', '吸毒', '自杀', '杀人', '血腥', '枪支', '炸弹', '恐怖袭击',
  'sex', 'porn', 'nude', 'suicide', 'kill yourself', 'cocaine', 'heroin', 'terrorist',
  // 脏话
  '傻逼', '操你', '妈的', '他妈', 'fuck', 'shit', 'bitch',
  // 网址、联系方式
  'http://', 'https://', 'www.', '.com', '微信号', 'QQ号',
];

/** 玩家自己屏蔽的句子（举报后不再显示，DESIGN 11.6）。 */
const userBlocked = new Set<string>();

export function blockLine(text: string): void {
  userBlocked.add(normalize(text));
}

export function setUserBlocked(lines: readonly string[]): void {
  userBlocked.clear();
  for (const l of lines) userBlocked.add(normalize(l));
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

export function isBlocked(text: string): boolean {
  const n = normalize(text);
  return userBlocked.has(n) || BLOCKED.some((w) => n.includes(normalize(w)));
}

/**
 * 把模型给的一句话整理成能放进游戏的样子；不合格返回 null（调用方回退）。
 * - 去掉首尾引号、换行合并；
 * - 长度 1–max 字；
 * - 不含敏感词、不跳出角色。
 */
export function cleanLine(raw: unknown, max = 120): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^["“「『']+|["”」』']+$/g, '')
    .trim();
  if (!t || [...t].length > max) return null;
  if (isBlocked(t)) return null;
  return t;
}

/**
 * 玩家起的名字进 prompt 时当数据处理（DESIGN 11.6）：去掉控制字符和可能改写指令的符号，最多 16 字。
 */
export function sanitizeName(name: string): string {
  return [...name.replace(/[\u0000-\u001f\u007f<>{}[\]`"\\]/g, '').trim()].slice(0, 16).join('') || '守岛人';
}

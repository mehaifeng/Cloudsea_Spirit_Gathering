# CLAUDE.md — 云海拾灵 开发约定

本文件给 Claude Code 使用。开始任何任务前先读：
1. `HANDOFF.md`：当前状态、已做决策、下一步
2. `DESIGN.md`：游戏设计的唯一事实来源

设计和代码冲突时，以 DESIGN.md 为准；如果需要改设计，先和用户确认，再同时更新 DESIGN.md 和代码。
DESIGN.md 中标〔补〕的条目是 Claude 按设计精神补的细节，视为已生效；今后新的规则级改动用 ⚠ 标出，确认后去掉标记并记入 HANDOFF.md 决策表。

## 项目概览
- 类型：经营 + 建造 + 絮灵收集培育 + 回合制对战 + 最多 4 人房主联机
- 平台：Steam PC（Windows）首发，买断制
- 美术：100% 代码生成（Three.js 低多边形 + 程序化骨骼动画；UI 用 SVG）
- AI 守岛人：规则 AI + 预生成对话；可选玩家自带 key（OpenAI Chat Completions 兼容协议）

## 技术栈（已确认）
- 语言：TypeScript（strict），Node 22+
- 渲染：Three.js（npm 版，固定版本号），Vite 构建
- 桌面壳：Electron + steamworks.js（Steam 大厅、P2P、成就、云存档）
- 数据校验：zod
- 测试：Vitest
- 包管理：pnpm workspaces

## 目录结构（计划；已建：sim、content、render、net、ui、apps/desktop、tools/battle-sim）
```
packages/
  sim/        纯游戏逻辑：战斗（含战斗搜索 AI）、繁殖、经济、世界状态（星图 + 活跃岛实例）、存档迁移。无渲染、无 IO、无 DOM
  content/    数据表（物种、零件、技能、建筑、配方、订单、守岛人人设）与 zod schema
  render/     Three.js 表现层：岛屿生成、絮灵与角色建模、骨骼动画、特效
  net/        传输抽象：Loopback（单人）、SteamP2P、WebSocket（局域网 / 开发调试）
  ai/         守岛人规划器（加权随机 / LLM）、LLM 客户端（Chat Completions）、对话库检索、守岛人岛抽象模拟
  ui/         HUD、菜单、图鉴、SVG 图标
apps/
  desktop/    Electron 主进程：Steam、存档读写、key 加密存储、LLM 请求
  web-demo/   宣传用网页试玩版（无联机、无 LLM）
tools/
  battle-sim/   自动对战与平衡统计
  econ-sim/     经济节奏模拟
  species-lab/  物种编辑器：调参数并实时预览骨骼动画
  content-gen/  开发期用 LLM 批量生成对话库（产物需人工审核后入库）
prototype/      M0 单文件原型，只作参考，不再修改
```

## 架构铁律
1. **sim 是纯的**：`packages/sim` 不得引用 three、DOM、Node API、Electron、网络。输入是状态和意图，输出是新状态和事件。
2. **确定性**：sim 内禁止 `Math.random()` 和 `Date.now()`。随机数一律使用传入的种子 RNG（mulberry32 或 xoshiro）；时间一律使用游戏内 tick。
3. **单人 = 0 个客人的房主**：单人模式和联机走同一条代码路径，通过 Loopback 传输。不要为单人写特殊分支。
4. **房主权威**：客户端只发意图（intent），从不直接修改世界状态。房主执行 sim 后广播事件和状态差量。
5. **数据驱动**：物种、技能、零件、建筑、配方、订单、守岛人都是 `packages/content` 中的数据。新增内容不应需要改 sim 代码。
6. **LLM 不碰规则**：LLM 只输出符合 schema 的 JSON 意图，必须通过 sim 校验；失败时回退到规则规划器。战斗决策永远不用 LLM。
7. **存档有版本**：世界存档和角色存档都带 `version` 字段，结构变更必须写迁移函数和测试。
8. **API key 安全**：key 只在 Electron 主进程中处理，用 safeStorage 加密存本地，不进日志、不进存档、不发给联机客人。

## 美术约定
- 低多边形，`flatShading: true`，顶点色，不使用贴图。例外：UI 图标（SVG）、粒子 sprite 与天空 / 云海着色器可用程序生成的 canvas 贴图。
- 模型由代码构建：几何体拼装 → 按面上色 → 程序化骨骼 → 计算蒙皮权重。参考 `prototype/index.html` 中的 `Rig` 和 `buildCreature`。
- 动画以程序化为主：两骨 IK、步态相位、弹簧物理；需要表演的动作再用关键帧。
- 使用现代 Three.js API（原型用的是 r128 的旧写法，比如 `skinning: true`，迁移时要改掉），注意颜色管理（sRGB 输出）。
- 属性色固定：晴 #F3B94D、雨 #5AA9E6、风 #5CC8A0、雷 #A77BE8、雾 #B8BFD6。

## 代码约定
- 代码标识符用英文；游戏内文本、数据表的显示名用中文，并预留英文本地化键。
- 术语对照（代码中统一使用）：
  - 絮灵 = `spirit`，物种 = `species`，零件 = `part`，资质 = `talent`，性格 = `nature`
  - 天象属性 = `element`：`sun` 晴 / `rain` 雨 / `wind` 风 / `thunder` 雷 / `mist` 雾
  - 云气 = `qi`，天候（战斗）= `fieldWeather`，天气（世界）= `weather`，守岛人（AI）= `keeper`，灯塔 = `lighthouse`，云主 = `cloudlord`
  - 云贝 = `shells`，灵饰 = `charm`，基因码 = `gene code`
  - 性别 = `sex`（雄 `male` / 雌 `female`），雄性比例 = `sexRatio`；疲惫标记 = `weary`（可与其他状态并存）
  - 大区 = `region`：晴原 `sunPlains` / 风谷 `windValley` / 雨泽 `rainMarsh` / 雷崖 `thunderCliff` / 雾海 `mistSea`
  - 稀有度 = `rarity`：常见 `common` / 少见 `uncommon` / 稀有 `rare` / 极稀 `veryRare`；形态 = `form`，种族值 = `baseStats`，零件池 = `partPool`，刷新规则 = `spawns`
  - 五项属性 = `stats`：生命 `hp` / 力量 `power` / 守护 `guard` / 灵巧 `agility` / 共鸣 `resonance`；命中 `accuracy`，闪避 `evasion`；异化 = `mutation`
  - 工作类型 = `workTask`：种植 `planting` / 烘烤 `baking` / 灌溉 `irrigation` / 酿造 `brewing` / 风车 `windmill` / 运输 `transport` / 发电 `power` / 锻造 `smithing` / 储藏 `storage` / 调香 `perfumery`
  - 守岛人：`keeper` **只指 AI 守岛人**；玩家 = `player`（世界观里两者都叫守岛人）
  - 蚀雾 = `blight`，蚀化（的）= `blighted`，净化 = `purify`，净化池 = `purifyPool`（蚀雾与雾属性 `mist` 无关）
  - 相克 = `counters`，相生 = `generates`（A generates B），连携 = `synergy`，本属性加成 = `affinityBonus`
  - 进化段：幼絮 `hatchling` / 成灵 `adult` / 云主形 `lord`；蛋 = `egg`；进化线 = `line`
  - 技能来源：本源 `innateSkill` / 零件 `partSkill` / 技能书 `skillBook`；技能池 `skillPool`，装备栏 `skillSlots`；轻击 `jab`，防御 `guard`
  - 状态异常 = `ailment`（目眩 `dazzled` / 湿透 `soaked` / 失衡 `unbalanced` / 麻痹 `paralyzed` / 迷蒙 `hazed`），增减益层数 = `stage`，暴击 = `crit`，倒下 = `downed`，疲惫 = `weary`
  - 提灯 = `lantern`（≠ 灯塔 `lighthouse`），云舟 = `skiff`（v0.5 起取代风帆 `sail`），航行 = `voyage`，采集工具 = `gatherTool`，燃料 = `fuel`，雾浓度 = `fogLevel`
  - 播片 / 过场 = `cutscene`，镜头时间轴 = `cameraTrack`，细节层级 = `lod`，世界布局 = `worldLayout`
  - 岛核 = `islandCore`，家园岛 = `homeIsland`，漂流岛 = `driftIsle`，守岛人岛 = `keeperIsland`，集市岛 = `marketIsle`，星图 = `starChart`
  - 栖巢 = `nest`，繁殖屋 = `hatchery`，工位 = `workSlot`，蓝图 = `blueprint`，订单 = `order`，商队 = `caravan`
  - 灯露 = `lanternDew`，记忆碎片 = `memoryShard`，图鉴 = `codex`，好感度 = `affinity`，外来（导入）标记 = `foreign`
  - 势力：灯塔会 `lighthouseOrder` / 风帆商队 `caravan` / 潜云者 `divers`
  - 新术语先加到这张表再进代码。
- 小步提交，每个提交只做一件事。

## 测试要求
- sim 的每个规则都要有单元测试，尤其是：伤害公式、克制和天候、繁殖遗传、捕获率、存档迁移、基因码编解码。
- 改动战斗数值后，运行 `tools/battle-sim`，在提交说明里附上关键胜率变化。
- 渲染相关改动：用 Playwright 截图自查（白天、夜晚、近景），截图不入库。

## 常用命令
- 安装：`corepack enable pnpm && pnpm install`（pnpm 版本由根 `package.json` 的 `packageManager` 固定）
  - 本机走代理时 Electron 二进制下载会卡住，需要：`ELECTRON_GET_USE_PROXY=1 GLOBAL_AGENT_HTTPS_PROXY=$HTTPS_PROXY node apps/desktop/node_modules/electron/install.js`
- 开发：`pnpm dev`（Vite 开发服务器 + Electron 窗口，渲染端热更新）
- 运行打包版：`pnpm build && pnpm --filter @cloudsea/desktop start`
- 类型检查：`pnpm typecheck`
- 单元测试：`pnpm test`（含 sim 纯度检查：禁止非相对导入、Math.random、Date 等）
- 截图冒烟 + 全流程回归：`pnpm smoke`（打包后用 Playwright 启动 Electron，按新手引导走一遍核心循环；截图存到 `apps/desktop/screenshots/`，不入库）
- 平衡模拟：`pnpm --filter @cloudsea/battle-sim start [--matches 200] [--levels 1,10,30,60] [--json]`
- 测试模式：环境变量 `CLOUDSEA_TEST=1` 时存档写临时目录、世界种子固定、页面暴露 `window.__game`（只发意图）

## 工作方式：Claude 开发，Lynx 验收
Lynx 不参与写代码，只负责四件事：**验收输出、回归测试、需求变更、关键决策**。因此：

### Claude 的职责
- 自主完成设计实现、技术选型细节、重构和测试，不需要逐项请示。
- 只有以下情况必须先问 Lynx：改动 DESIGN.md 中的玩法或规则、新增或删减范围、引入付费服务或新的外部依赖服务、不可逆的数据或存档格式决策。
- 遇到设计没覆盖的细节，自己按 DESIGN.md 的精神做决定，并记入 HANDOFF.md 的决策表，交付时一并汇报。

### 每次交付必须附带（交付物模板）
1. **可运行版本**：说明如何启动（命令或可执行文件路径）。
2. **变更摘要**：做了什么、没做什么、和计划的偏差，用玩家能理解的语言写。
3. **截图或录屏**：每个可见改动至少一张（白天 / 夜晚 / 近景按需）。
4. **测试报告**：单元测试通过数、平衡模拟的关键数据变化、已知问题。
5. **验收清单**：给 Lynx 的试玩步骤，每条写清“做什么 → 应该看到什么”，控制在 10 条以内。
6. 更新 HANDOFF.md。

### 回归测试
- 自动化：`pnpm test`（sim 单元测试）+ 平衡模拟 + Playwright 截图冒烟测试，每次交付前全部通过。
- 人工：`docs/playtest/` 下维护累积的回归清单。每个里程碑结束时，Lynx 按清单完整走一遍；新功能的验收条目通过后并入回归清单。
- Lynx 报告的问题，修复时必须同时补一条能复现该问题的自动化测试（能自动化的话）。

### 需求变更流程
1. Lynx 提出变更（一句话也可以）。
2. Claude 评估：影响哪些系统、工作量、风险，给出建议（接受 / 调整 / 延后）。
3. Lynx 确认后，先更新 DESIGN.md 和 HANDOFF.md 的决策表，再改代码。
4. 变更完成后按交付物模板交付。

### 沟通
- 中文，直接、具体，先说结论。
- 动作手感和画面观感以 Lynx 的试玩反馈为准。

# 商店素材（M4-4，提交就绪）

| 文件 | 内容 |
|---|---|
| `store-zh.md` | 简体中文商店页：简短描述、关于这款游戏、特色、抢先体验问卷、系统需求、AI 内容披露 |
| `store-en.md` | 英文商店页（同上） |
| `../steam/achievements.md` | Steamworks 后台要建的 23 个成就（API 名、名称、描述）与 Steam 云配额 |
| 截图与胶囊图 | 由代码生成：`pnpm --filter @cloudsea/desktop store-art`，输出到 `apps/desktop/screenshots/store/`（不入库，见 CLAUDE.md） |

`store-art` 生成的文件（中英各一套）：
- 截图 1920×1080 × 7：家园岛白天、家园岛夜晚、野外战斗、灯塔下的云主、守岛人的岛与对话、星图、雾海
- 主胶囊 1232×706、头图 920×430、小胶囊 462×174、竖版胶囊 748×896、库胶囊 600×900、库主图 3840×1240、库 Logo 1280×720（透明底）

## 需要 Lynx 本人完成的事（付费或账号操作，Claude 不代办）
1. 在 Steamworks 缴纳 App 费用（100 美元）并拿到正式 App ID；把它填进环境变量 `CLOUDSEA_STEAM_APPID` 的默认值（`apps/desktop/src/main/net.ts`，目前是测试用的 480）。
2. 在后台创建成就（`docs/steam/achievements.md`）、打开 Steam 云并设配额。
3. 定价（DESIGN 待确认第 1 条：¥68–98）。
4. 背景音乐来源（DESIGN 待确认第 5 条；当前版本没有音乐和音效，商店页已如实说明）。
5. 代码签名证书（可选，避免 Windows SmartScreen 警告）；有了以后在 GitHub Secrets 配 `CSC_LINK` / `CSC_KEY_PASSWORD`。
6. 把 CI 产出的安装包上传到 Steam（SteamPipe），填商店页、提交审核。

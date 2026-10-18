# Steam 成就配置（M4-1）

在 Steamworks 后台“统计与成就”里按下表新建成就（API 名必须一字不差）；图标需要 64×64 的已解锁 / 未解锁两张 JPG，可以用游戏内截图裁剪或之后用代码生成。
游戏里成就由房主的世界规则判定，达成时调用 Steam 解锁；没有 Steam 时成就照常记在角色存档里，下次连上 Steam 会补同步。

| API 名 | 名称 | 描述 | 隐藏 |
|---|---|---|---|
| ACH_FIRST_FRIEND | 第一位伙伴 | 在岛核前唤出第一只絮灵。 |  |
| ACH_FIRST_CATCH | 初次邀请 | 用灯露邀请一只野生絮灵加入。 |  |
| ACH_FULL_HOUSE | 热闹的家 | 同时拥有 20 只絮灵。 |  |
| ACH_CODEX_20 | 图鉴过半 | 图鉴里抓到 20 种形态。 |  |
| ACH_CODEX_40 | 万物有灵 | 图鉴里抓到全部 40 种形态。 |  |
| ACH_GROWN_UP | 长大了 | 让一只絮灵进化成成灵。 |  |
| ACH_LORD_FORM | 云主之姿 | 让一只絮灵进化成云主形。 |  |
| ACH_LEVEL_60 | 登峰 | 一只絮灵达到 60 级。 |  |
| ACH_SHINY | 幻色 | 拥有一只幻色絮灵。 | 是 |
| ACH_FIRST_EGG | 新生 | 在繁殖屋里生下第一枚蛋。 |  |
| ACH_RESONANCE | 共鸣 | 让两只属性相生的不同物种生下一枚蛋。 |  |
| ACH_PURIFIER | 洗去暗雾 | 在净化池里净化一只蚀化的絮灵。 |  |
| ACH_WIN_100 | 百战 | 赢下 100 场战斗。 |  |
| ACH_TOGETHER | 并肩 | 和朋友一起打赢一场战斗。 |  |
| ACH_CODE_DUEL | 以码会友 | 赢下一场队伍码挑战。 |  |
| ACH_GUARDIAN_NOD | 守卫的认可 | 打赢一位灯塔会守卫。 |  |
| ACH_FIRST_LIGHT | 第一座灯塔 | 重燃晴原的灯塔。 |  |
| ACH_HALFWAY | 雾散了一半 | 重燃三座灯塔。 |  |
| ACH_REKINDLED | 群岛重燃 | 重燃全部五座灯塔。 |  |
| ACH_GROWING_ISLAND | 岛长大了 | 把岛核升到 5 级。 |  |
| ACH_FAR_SAIL | 远航 | 提灯和云舟都升到 5 级。 |  |
| ACH_KINDRED | 知心 | 和一位守岛人的好感达到 4 级。 |  |
| ACH_STORYTELLER | 听故事的人 | 和守岛人讲完 9 段故事。 |  |

## Steam 云
游戏通过 Steam 远程存储（ISteamRemoteStorage）同步存档：在 Steamworks 后台“Steam 云”里打开云存储，配额建议 每用户 100 MB / 1000 个文件。
测试 App ID 480 下不会写云（那是 Valve 示例游戏的云盘）。


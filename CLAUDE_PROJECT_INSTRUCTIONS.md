# Riftbound Card Rater — Claude Project Instructions

## 项目概述
一个两人协作的 TCG 单卡评级网站，部署在 GitHub Pages，数据存储在 Supabase。

## 文件结构
```
riftbound-rater/
├── index.html    # HTML 结构（~180 行）
├── style.css     # 所有样式（~270 行）
└── app.js        # 所有逻辑（~1130 行）
```

## 技术栈
- **前端**：原生 HTML/CSS/JS，无框架，无构建工具
- **托管**：GitHub Pages（静态）
- **数据库**：Supabase PostgreSQL（通过 REST API 读写）
- **实时同步**：Supabase Realtime（自实现 Phoenix WebSocket 客户端，无外部依赖）

## Supabase 配置
```
URL:   https://vepqjryrhvuehwemabqu.supabase.co
TABLE: cards_v2
RLS:   已关闭
Realtime: 已开启（ALTER PUBLICATION supabase_realtime ADD TABLE public.cards_v2）
```

## 数据库 Schema
```sql
CREATE TABLE public.cards_v2 (
  id       text PRIMARY KEY,       -- uid()，客户端生成
  tab      text NOT NULL,          -- 'special'|'red'|'green'|'blue'|'orange'|'purple'|'yellow'
  name     text NOT NULL,          -- 卡牌中文名
  img      text,                   -- 卡图 URL（来自官网 CDN）
  pos      integer DEFAULT 0,      -- 同 tab 内排序
  grade_a  text,                   -- 玩家 A 评级：'S'|'A'|'B'|'C'|'D'|null
  note_a   text,                   -- 玩家 A 备注
  grade_b  text,                   -- 玩家 B 评级
  note_b   text                    -- 玩家 B 备注
);
```

## 核心常量（app.js）
```js
const TABS = [
  { id:'special', label:'传奇 / 专法', color:'#c9a84c' },
  { id:'red',     label:'红',          color:'#e05252' },
  { id:'green',   label:'绿',          color:'#52b96e' },
  { id:'blue',    label:'蓝',          color:'#5b9fe0' },
  { id:'orange',  label:'橙',          color:'#e07d30' },
  { id:'purple',  label:'紫',          color:'#9b6de0' },
  { id:'yellow',  label:'黄',          color:'#d4b935' },
];
const G  = ['S','A','B','C','D'];
const GC = { S:'#c0392b', A:'#d4820a', B:'#1e8449', C:'#1a6fa8', D:'#3d4455' };
const GF = { S:'#fff', A:'#fff', B:'#fff', C:'#fff', D:'#9aa' };
```

## 关键设计决策
- **anon key 直接写在前端**：Supabase anon key 是公开设计的，关闭 RLS 后仅限私用，可接受
- **无外部 JS 依赖**：Realtime 客户端为自实现的 Phoenix WebSocket 协议，无需 npm/CDN
- **智能 DOM patch**：远端 UPDATE 事件只更新评级相关 DOM，不重建 textarea，避免打断输入
- **debounce 1500ms**：备注输入防抖，减少写入频率
- **activeUser**：'a' 或 'b'，决定读写哪组 grade_*/note_* 列

## app.js 结构索引
```
CONFIG          第 1 行    Supabase URL/KEY/TABLE
TAB CONFIG      ~30 行     TABS/G/GC/GF/GL 常量
STATE           ~60 行     activeUser/activeTab/db 等全局状态
SUPABASE HELPERS ~80 行   sbFetch() / sbUpsert()
REALTIME CLIENT ~110 行   createRealtimeClient()（Phoenix 协议实现）
BOOT & SYNC     ~280 行   boot() / loadAll() / subscribeRealtime() / handleRealtimeEvent()
CARD OPS        ~360 行   addCard() / delCard() / setGrade() / updateNote() / saveCard()
IMPORT          ~490 行   doJsonImport() / doBulkImport()
USER SWITCH     ~590 行   switchUser()
COMPARE         ~610 行   startCompare() / exitCmp()
RENDER          ~670 行   renderAll() / renderTabs() / renderCards() / renderStats() 等
OCR             ~870 行   runOCR()（调用 Claude Haiku 识别卡名）
KEYBOARD        ~920 行   快捷键 S/A/B/C/D 评级，←→ 导航
LIGHTBOX        ~980 行   openLightbox() / closeLightbox()
BOOT            ~1120 行  boot() 调用
```

## 协作规则（请 Claude 遵守）
1. **只修改被要求的部分**，不改动其他函数
2. **输出 diff 而非全文**，除非明确要求输出完整文件
3. **保持现有代码风格**：紧凑的单行 CSS、分区注释用 `═══` 分隔
4. **不引入外部依赖**：不加 npm 包、不加 CDN 库（Google Fonts 除外）
5. **中文注释**：面向用户的注释用中文

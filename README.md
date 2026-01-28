# MyEdge Portfolio - AI 专属首页

> 使用 Cloudflare Workers + Durable Objects + Workers AI 构建的个人品牌页面生成器

## ✨ 功能特性

### 个人品牌展示（全部 AI 动态生成）
- 🤖 **AI 生成专业 Bio**（150-200字，基于 GitHub 数据）
- 📦 **AI 生成项目描述**（每个项目独特的亮点文案）
- 💡 **AI 生成每日 Quote**（个性化励志语录）
- 🏷️ 自动提取技能标签
- 🔗 社交链接整合（GitHub/Twitter/个人网站）
- 🖼️ AI 生成个性化背景图（Stable Diffusion）

### 个性化仪表盘（真实数据源）
- 🌤️ **真实天气**（小米天气 API + wttr.in 双重备选，完全免费）
- 📰 **真实新闻**（多源聚合）：
  - Hacker News - 科技/创业热点
  - Dev.to - 开发/设计文章
  - GitHub Trending - 热门开源项目
  - Yahoo Finance RSS - 财经资讯
- 🔖 可编辑书签/快捷链接
- 🌙 深色模式支持

### 技术特性
- 💾 Durable Objects 持久化存储
- ⚡ 智能缓存策略（减少 API 调用）
- 📱 社交预览卡片（Open Graph / Twitter Cards）
- 🔄 一键刷新 AI 内容
- 📤 社交分享功能
- 🚫 **无模拟数据** - 所有内容真实获取或 AI 生成

## 🚀 快速部署

### 前置要求
- [Cloudflare 账户](https://dash.cloudflare.com/sign-up)
- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 步骤 1: 安装 Wrangler
```bash
npm install -g wrangler
wrangler login
```

### 步骤 2: 克隆项目
```bash
git clone <your-repo>
cd myedge-portfolio
```

### 步骤 3: 创建 R2 Bucket
```bash
wrangler r2 bucket create myedge-assets
```

### 步骤 4: 配置 GitHub Token（强烈建议）
```bash
# GitHub API 未认证限制: 60 次/小时
# 配置 Token 后: 5000 次/小时

# 1. 创建 Token: https://github.com/settings/tokens
#    权限: 只需勾选 public_repo

# 2. 配置 Secret
npx wrangler secret put GITHUB_TOKEN
# 粘贴你的 token 并回车
```

### 步骤 5: 部署
```bash
wrangler deploy
```

### 步骤 6: 访问
部署成功后访问：`https://myedge-portfolio.<your-subdomain>.workers.dev`

## 📁 项目结构

```
myedge-portfolio/
├── worker.js          # 主 Worker 代码（单文件包含所有逻辑）
├── wrangler.toml      # Cloudflare 配置
└── README.md          # 说明文档
```

## 🔧 API 接口

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 入口页面 |
| `/p/{slug}` | GET | 专属页面 |
| `/@{username}` | GET | 用户页面（别名） |
| `/api/generate` | POST | 生成/获取专属页面 |
| `/api/user/{slug}` | GET | 获取用户数据 |
| `/api/refresh` | POST | 刷新 AI 内容 |
| `/api/bookmark/add` | POST | 添加书签 |
| `/api/bookmark/remove` | POST | 删除书签 |
| `/api/weather` | GET | 获取天气 |
| `/api/news` | GET | 获取新闻 |

## 📊 缓存策略

| 内容类型 | 缓存时间 | 数据来源 |
|----------|----------|----------|
| AI Bio / 项目描述 / Quote | 24 小时 | Workers AI (Llama 3) |
| AI 背景图 | 7 天 | Workers AI (Stable Diffusion) |
| 新闻摘要 | 2 小时 | Hacker News, Dev.to, GitHub |
| 天气数据 | 30 分钟 | 小米天气 API / wttr.in |

## 🌤️ 天气 API 说明

使用双重免费天气 API，**无需任何 API Key**：

| API | 优先级 | 覆盖范围 | 特点 |
|-----|--------|----------|------|
| 小米天气 | 中国城市 | 中国大陆+港澳台 | 中文描述、AQI、PM2.5 |
| wttr.in | 国际城市/备选 | 全球 | 稳定可靠、免费无限制 |

### 小米天气 API

基于 [小米天气 API 文档](https://github.com/huanghui0906/API/blob/master/XiaomiWeather.md) 实现。

**API 端点：**
```
https://weatherapi.market.xiaomi.com/wtr-v3/weather/all
```

**必需参数：**
- `locationKey`: `weathercn:` + 城市ID（如 `weathercn:101010100` 表示北京）
- `sign`: 固定签名 `zUFJoAR2ZVrDy1vF3D07`
- `appKey`: `weather20151024`
- `locale`: `zh_cn`
- `isGlobal`: `false`

**返回数据：**
- `current.temperature.value` - 当前温度
- `current.feelsLike.value` - 体感温度
- `current.humidity.value` - 湿度
- `current.wind.speed.value` - 风速
- `current.weather` - 天气状况代码
- `aqi.aqi` - 空气质量指数
- `aqi.pm25` - PM2.5

### 支持的城市

**中国城市（使用小米天气，支持县级城市）：**
```
直辖市: 北京、上海、天津、重庆（含所有区县）
华北: 河北(石家庄、唐山等)、山西(太原、大同等)、内蒙古(呼和浩特、包头等)
东北: 辽宁(沈阳、大连等)、吉林(长春、吉林等)、黑龙江(哈尔滨、齐齐哈尔等)
华东: 江苏(南京、苏州等)、浙江(杭州、宁波等)、安徽(合肥、芜湖等)
      福建(福州、厦门等)、江西(南昌、九江等)、山东(济南、青岛等)
华中: 河南(郑州、洛阳等)、湖北(武汉、宜昌等)、湖南(长沙、株洲等)
华南: 广东(广州、深圳等)、广西(南宁、桂林等)、海南(海口、三亚等)
西南: 四川(成都、绵阳等)、贵州(贵阳、遵义等)、云南(昆明、大理等)、西藏(拉萨等)
西北: 陕西(西安、咸阳等)、甘肃(兰州、天水等)、青海(西宁等)
      宁夏(银川等)、新疆(乌鲁木齐、喀什等)
港澳台: 香港(18区)、澳门、台北、高雄、台中等
```

**覆盖范围：2000+ 城市，支持到县/区级别**

**国际城市（使用 wttr.in）：**
```
Los Angeles、New York、San Francisco、Seattle、Tokyo
London、Paris、Singapore、Sydney、Toronto、Vancouver...
```

**简写格式也支持：**
```
LA、NYC、SF、HK...
```

**同名城市区分（使用前缀避免冲突）：**
| 输入 | 对应城市 |
|------|----------|
| 北京朝阳 | 北京市朝阳区 |
| 辽宁朝阳 | 辽宁省朝阳市 |
| 北京通州 | 北京市通州区 |
| 南通通州 | 江苏省南通市通州区 |
| 甘孜州 | 四川甘孜藏族自治州 |
| 甘孜县 | 甘孜州甘孜县 |
| 阿坝州 | 四川阿坝藏族羌族自治州 |
| 阿坝县 | 阿坝州阿坝县 |
| 九龙县 | 四川甘孜州九龙县 |
| 香港九龙 | 香港九龙区 |
| 大埔 | 广东梅州大埔县 |
| 香港大埔 | 香港大埔区 |

## 📰 新闻源说明

| 兴趣领域 | 数据来源 |
|----------|----------|
| AI / Tech | Hacker News Top Stories |
| Tech / Design | Dev.to Articles API |
| Tech | GitHub Trending Repos |
| Finance | Yahoo Finance RSS |

## 🎨 自定义

### 修改默认城市
```javascript
// worker.js
const CONFIG = {
  DEFAULT_CITY: 'Beijing',  // 改为你的城市
  // ...
};
```

### 添加新闻来源
```javascript
// worker.js - generateNews 函数
const newsData = {
  'YourTopic': [
    { title: '...', source: '...', time: '...' }
  ]
};
```

### 修改 AI 提示词
```javascript
// worker.js - generateAIBio 函数
const prompt = `你自定义的提示词...`;
```

## 💰 成本估算

基于 Cloudflare 免费额度：

| 服务 | 免费额度 | 预计使用 |
|------|----------|----------|
| Workers 请求 | 10万次/天 | ✅ 足够 |
| Durable Objects | 1GB 存储 | ✅ 足够 |
| Workers AI | 1万次/天 | ✅ 足够 |
| R2 存储 | 10GB | ✅ 足够 |

**结论：个人使用完全免费！**

## 🔒 安全注意

- 只存储公开 GitHub 数据
- 不收集敏感个人信息
- 用户可随时删除数据
- 支持 HTTPS

## ⚠️ 常见问题

### GitHub API 速率限制

**架构优化：前端直接调用 GitHub API**

为避免所有用户共享 Cloudflare Worker IP 的 API 配额，本项目采用**前端直接调用**架构：

```
┌─────────────────────────────────────────────────────────────┐
│  之前（后端调用 - 有问题）                                    │
│  用户A ─┐                                                    │
│  用户B ─┼─→ Worker (共享IP) ─→ GitHub API                    │
│  用户C ─┘        ↑                                           │
│               60次/小时 被所有用户共享，很快用完！             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  现在（前端调用 - 已优化）                                    │
│  用户A 浏览器 ─→ GitHub API (用户A的IP) → 60次/小时          │
│  用户B 浏览器 ─→ GitHub API (用户B的IP) → 60次/小时          │
│  用户C 浏览器 ─→ GitHub API (用户C的IP) → 60次/小时          │
│         ↓                                                    │
│      Worker（只负责 AI 生成和存储）                           │
└─────────────────────────────────────────────────────────────┘
```

**优势：**
- 每个用户独立享有 60 次/小时的配额
- 无需配置 GitHub Token 即可正常使用
- Worker 不再受 GitHub API 限流影响

**可选：配置 GitHub Token（进一步提升）**

如果仍需后端调用（如 Cron 定时刷新），可配置 Token：

```bash
# 1. 创建 GitHub Personal Access Token
#    访问: https://github.com/settings/tokens
#    权限只需勾选: public_repo

# 2. 配置到 Worker
npx wrangler secret put GITHUB_TOKEN

# 3. 重新部署
wrangler deploy
```

配置后后端调用限制提升到 **5000 次/小时**

### 天气数据获取失败

系统会自动降级：小米天气 API → wttr.in → 默认数据

## 📝 TODO

- [ ] 用户认证（Email / OAuth）
- [ ] PWA 支持
- [ ] 书签分类
- [ ] 定时刷新（Cron Triggers）
- [ ] 更多 AI 模型选择
- [ ] 多语言支持
- [ ] 自定义主题

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可

MIT License


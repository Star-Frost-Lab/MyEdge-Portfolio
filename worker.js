/**
 * MyEdge Portfolio - AI 专属首页
 * Cloudflare Worker + Durable Objects + Workers AI + R2
 * 
 * 功能：
 * - 入口页面：输入表单 + 生成专属链接
 * - 专属页面：动态品牌展示 + 仪表盘
 * - 数据持久化：Durable Objects 存储
 * - AI 生成：Workers AI 文本/图像（所有内容动态生成）
 * - 真实新闻：Hacker News + Dev.to + RSS
 * - 图像存储：R2
 * - 社交预览：Open Graph / Twitter Cards（针对爬虫优化）
 */

// ==================== 配置常量 ====================
const CONFIG = {
  CACHE_TTL_TEXT: 24 * 60 * 60 * 1000,      // 文本缓存 24 小时
  CACHE_TTL_IMAGE: 7 * 24 * 60 * 60 * 1000, // 图像缓存 7 天
  CACHE_TTL_NEWS: 2 * 60 * 60 * 1000,       // 新闻缓存 2 小时
  CACHE_TTL_WEATHER: 30 * 60 * 1000,        // 天气缓存 30 分钟
  DEFAULT_CITY: 'Los Angeles',
  // 社交爬虫 User-Agent 列表
  SOCIAL_BOTS: [
    'twitterbot', 'facebookexternalhit', 'linkedinbot',
    'discordbot', 'slackbot', 'telegrambot', 'whatsapp',
    'wechat', 'micromessenger', 'googlebot', 'bingbot',
    'pinterest', 'tumblr', 'vkshare', 'w3c_validator',
    'redditbot', 'applebot', 'embedly', 'quora link preview',
    'showyoubot', 'outbrain', 'rogerbot', 'developers.google.com'
  ],
  // 新闻源配置
  NEWS_SOURCES: {
    HACKER_NEWS: 'https://hacker-news.firebaseio.com/v0',
    DEV_TO: 'https://dev.to/api/articles',
    PRODUCT_HUNT: 'https://api.producthunt.com/v2/api/graphql'
  }
};

// ==================== Durable Object 类 ====================
export class UserDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case '/get':
          return await this.getData();
        case '/set':
          return await this.setData(request);
        case '/update':
          return await this.updateData(request);
        case '/delete':
          return await this.deleteData();
        case '/update-bookmarks':
          return await this.updateBookmarks(request);
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  async getData() {
    const data = await this.state.storage.get('userData');
    if (!data) {
      return new Response(JSON.stringify({ exists: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ exists: true, data }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async setData(request) {
    const body = await request.json();
    const now = Date.now();
    
    const userData = {
      username: body.username,
      city: body.city || CONFIG.DEFAULT_CITY,
      interests: body.interests || [],
      userBio: body.userBio || '',
      slug: body.slug,
      github: body.github || null,
      repos: body.repos || [],
      aiBio: body.aiBio || null,
      aiProjectDescriptions: body.aiProjectDescriptions || {},
      aiQuote: body.aiQuote || null,
      aiBackgroundUrl: body.aiBackgroundUrl || null,
      aiCardImageUrl: body.aiCardImageUrl || null, // 社交卡片图
      skills: body.skills || [],
      bookmarks: body.bookmarks || [],
      timestamps: {
        created: now,
        updated: now,
        textGenerated: body.timestamps?.textGenerated || now,
        imageGenerated: body.timestamps?.imageGenerated || null,
        newsUpdated: body.timestamps?.newsUpdated || null,
        weatherUpdated: body.timestamps?.weatherUpdated || null
      },
      cachedNews: body.cachedNews || null,
      cachedWeather: body.cachedWeather || null
    };

    await this.state.storage.put('userData', userData);
    
    return new Response(JSON.stringify({ success: true, data: userData }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async updateData(request) {
    const updates = await request.json();
    let userData = await this.state.storage.get('userData');
    
    if (!userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    userData = this.deepMerge(userData, updates);
    userData.timestamps.updated = Date.now();
    
    await this.state.storage.put('userData', userData);
    
    return new Response(JSON.stringify({ success: true, data: userData }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async deleteData() {
    await this.state.storage.delete('userData');
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 批量更新书签（支持排序）
  async updateBookmarks(request) {
    const { bookmarks } = await request.json();
    let userData = await this.state.storage.get('userData');
    
    if (!userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 确保每个书签有正确的 order
    userData.bookmarks = (bookmarks || []).map((bm, index) => ({
      id: bm.id || Date.now().toString(36) + index,
      name: bm.name,
      url: bm.url,
      icon: bm.icon || '🔗',
      order: index
    }));
    userData.timestamps.updated = Date.now();
    
    await this.state.storage.put('userData', userData);
    
    return new Response(JSON.stringify({ success: true, bookmarks: userData.bookmarks }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}

// ==================== 主 Worker ====================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    try {
      if (path === '/' || path === '/index.html') {
        return serveEntryPage();
      }

      if (path.startsWith('/api/')) {
        return await handleAPI(request, env, path);
      }

      if (path.startsWith('/p/') || path.startsWith('/@')) {
        return await handlePortfolioPage(request, env, path);
      }

      if (path.startsWith('/assets/')) {
        return await serveR2Asset(env, path);
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Worker Error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

// ==================== CORS 处理 ====================
function handleCORS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

// ==================== API 处理 ====================
async function handleAPI(request, env, path) {
  const apiPath = path.replace('/api', '');

  switch (true) {
    case apiPath === '/generate':
      return await handleGenerate(request, env);
    case apiPath.startsWith('/user/'):
      return await handleGetUser(request, env, apiPath);
    case apiPath === '/refresh':
      return await handleRefresh(request, env);
    case apiPath === '/bookmarks/update':
      return await handleUpdateBookmarks(request, env);
    case apiPath === '/weather':
      return await handleWeather(request, env);
    case apiPath === '/news':
      return await handleNews(request, env);
    case apiPath === '/debug':
      return await handleDebug(request, env);
    case apiPath === '/location':
      return handleLocation(request);
    default:
      return new Response('API Not Found', { status: 404 });
  }
}

// ==================== 获取用户位置 ====================
function handleLocation(request) {
  const cf = request.cf || {};
  
  return jsonResponse({
    city: cf.city || 'Los Angeles',
    country: cf.country || 'US',
    region: cf.region || '',
    latitude: cf.latitude || null,
    longitude: cf.longitude || null,
    timezone: cf.timezone || 'America/Los_Angeles',
    cityDisplay: getCityDisplayName(cf.city, cf.country)
  });
}

function getCityDisplayName(city, country) {
  if (!city) return '洛杉矶';
  
  const cityNameMap = {
    'Beijing': '北京',
    'Shanghai': '上海',
    'Guangzhou': '广州',
    'Shenzhen': '深圳',
    'Hangzhou': '杭州',
    'Chengdu': '成都',
    'Wuhan': '武汉',
    'Xian': '西安',
    'Nanjing': '南京',
    'Suzhou': '苏州',
    'Hong Kong': '香港',
    'Taipei': '台北',
    'Tokyo': '东京',
    'Singapore': '新加坡',
    'Seoul': '首尔',
    'Los Angeles': '洛杉矶',
    'San Francisco': '旧金山',
    'New York': '纽约',
    'Seattle': '西雅图',
    'London': '伦敦',
    'Paris': '巴黎',
    'Sydney': '悉尼',
    'Toronto': '多伦多'
  };
  
  return cityNameMap[city] || city;
}

// ==================== 诊断端点 ====================
async function handleDebug(request, env) {
  const bindings = {
    AI: {
      exists: !!env.AI,
      type: typeof env.AI,
      isFunction: typeof env.AI?.run === 'function'
    },
    USER_DO: {
      exists: !!env.USER_DO,
      type: typeof env.USER_DO
    },
    R2_BUCKET: {
      exists: !!env.R2_BUCKET,
      type: typeof env.R2_BUCKET
    },
    GITHUB_TOKEN: {
      exists: !!env.GITHUB_TOKEN,
      length: env.GITHUB_TOKEN?.length || 0
    }
  };

  let aiTest = { success: false, error: null };
  if (env.AI) {
    try {
      const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages: [{ role: 'user', content: 'Say "Hello" in one word.' }],
        max_tokens: 10
      });
      aiTest = { 
        success: true, 
        response: response.response?.substring(0, 50) 
      };
    } catch (error) {
      aiTest = { 
        success: false, 
        error: error.message,
        errorName: error.name
      };
    }
  }

  return jsonResponse({
    status: 'debug',
    bindings,
    aiTest,
    envKeys: Object.keys(env),
    timestamp: new Date().toISOString()
  });
}

// ==================== 生成专属页面 ====================
async function handleGenerate(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const body = await request.json();
  const { username, city, interests, userBio, githubData: clientGithubData } = body;

  if (!username) {
    return jsonResponse({ error: 'GitHub username is required' }, 400);
  }

  const doId = env.USER_DO.idFromName(username.toLowerCase());
  const doStub = env.USER_DO.get(doId);

  const existingRes = await doStub.fetch(new Request('http://do/get'));
  const existing = await existingRes.json();

  if (existing.exists) {
    const updateRes = await doStub.fetch(new Request('http://do/update', {
      method: 'POST',
      body: JSON.stringify({ city, interests, userBio })
    }));
    const updated = await updateRes.json();
    return jsonResponse({
      isNew: false,
      slug: updated.data.slug,
      data: updated.data
    });
  }

  try {
    // 1. 获取 GitHub 数据
    let githubData;
    if (clientGithubData && clientGithubData.user && clientGithubData.repos) {
      githubData = clientGithubData;
    } else {
      githubData = await fetchGitHubData(username, env);
    }

    // 2. 生成 slug
    const slug = generateSlug(username);

    // 3. 使用 AI 生成所有内容
    const aiContent = await generateAllAIContent(env, githubData, userBio, interests);

    // 4. 获取真实新闻
    const news = await fetchRealNews(interests);

    // 5. 获取天气
    const weather = await fetchWeather(env, city || CONFIG.DEFAULT_CITY);

    // 6. 生成并存储背景图和社交卡片图
    let backgroundUrl = null;
    let cardImageUrl = null;
    if (env.AI && env.R2_BUCKET) {
      const imageResults = await generateAndStoreImages(env, username, githubData.user, aiContent.skills, aiContent.bio);
      backgroundUrl = imageResults.backgroundUrl;
      cardImageUrl = imageResults.cardImageUrl;
    }

    // 7. 保存到 DO
    const userData = {
      username,
      city: city || CONFIG.DEFAULT_CITY,
      interests: interests || [],
      userBio: userBio || '',
      slug,
      github: githubData.user,
      repos: githubData.repos,
      aiBio: aiContent.bio,
      aiProjectDescriptions: aiContent.projectDescriptions,
      aiQuote: aiContent.quote,
      aiBackgroundUrl: backgroundUrl,
      aiCardImageUrl: cardImageUrl,
      skills: aiContent.skills,
      bookmarks: getDefaultBookmarks(),
      cachedNews: news,
      cachedWeather: weather,
      timestamps: {
        textGenerated: Date.now(),
        imageGenerated: backgroundUrl ? Date.now() : null,
        newsUpdated: Date.now(),
        weatherUpdated: Date.now()
      }
    };

    await doStub.fetch(new Request('http://do/set', {
      method: 'POST',
      body: JSON.stringify(userData)
    }));

    return jsonResponse({
      isNew: true,
      slug,
      data: userData
    });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// ==================== 获取用户数据 ====================
async function handleGetUser(request, env, apiPath) {
  const slug = apiPath.replace('/user/', '');
  const username = slug.split('-')[0];
  
  if (!username) {
    return jsonResponse({ error: 'Invalid slug' }, 400);
  }

  const doId = env.USER_DO.idFromName(username.toLowerCase());
  const doStub = env.USER_DO.get(doId);

  const res = await doStub.fetch(new Request('http://do/get'));
  const result = await res.json();

  if (!result.exists || result.data.slug !== slug) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  const userData = result.data;
  const now = Date.now();
  let updates = {};

  if (!userData.cachedWeather || 
      now - userData.timestamps.weatherUpdated > CONFIG.CACHE_TTL_WEATHER) {
    updates.cachedWeather = await fetchWeather(env, userData.city);
    updates.timestamps = { ...updates.timestamps, weatherUpdated: now };
  }

  if (!userData.cachedNews || 
      now - userData.timestamps.newsUpdated > CONFIG.CACHE_TTL_NEWS) {
    updates.cachedNews = await fetchRealNews(userData.interests);
    updates.timestamps = { ...updates.timestamps, newsUpdated: now };
  }

  if (Object.keys(updates).length > 0) {
    await doStub.fetch(new Request('http://do/update', {
      method: 'POST',
      body: JSON.stringify(updates)
    }));
    Object.assign(userData, updates);
  }

  return jsonResponse({ data: userData });
}

// ==================== 刷新 AI 内容 ====================
async function handleRefresh(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { username, forceAll, githubData: clientGithubData } = await request.json();

  if (!username) {
    return jsonResponse({ error: 'Username is required' }, 400);
  }

  const doId = env.USER_DO.idFromName(username.toLowerCase());
  const doStub = env.USER_DO.get(doId);

  const res = await doStub.fetch(new Request('http://do/get'));
  const result = await res.json();

  if (!result.exists) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  const userData = result.data;

  let githubData;
  if (clientGithubData && clientGithubData.user && clientGithubData.repos) {
    githubData = clientGithubData;
  } else {
    githubData = await fetchGitHubData(username, env);
  }

  const aiContent = await generateAllAIContent(env, githubData, userData.userBio, userData.interests);
  const news = await fetchRealNews(userData.interests);
  const weather = await fetchWeather(env, userData.city);

  const updates = {
    github: githubData.user,
    repos: githubData.repos,
    aiBio: aiContent.bio,
    aiProjectDescriptions: aiContent.projectDescriptions,
    aiQuote: aiContent.quote,
    skills: aiContent.skills,
    cachedNews: news,
    cachedWeather: weather,
    timestamps: {
      textGenerated: Date.now(),
      newsUpdated: Date.now(),
      weatherUpdated: Date.now()
    }
  };

  // 如果强制刷新所有内容，重新生成图像
  if (forceAll && env.AI && env.R2_BUCKET) {
    const imageResults = await generateAndStoreImages(env, username, githubData.user, aiContent.skills, aiContent.bio);
    updates.aiBackgroundUrl = imageResults.backgroundUrl;
    updates.aiCardImageUrl = imageResults.cardImageUrl;
    updates.timestamps.imageGenerated = Date.now();
  }

  await doStub.fetch(new Request('http://do/update', {
    method: 'POST',
    body: JSON.stringify(updates)
  }));

  const updatedRes = await doStub.fetch(new Request('http://do/get'));
  const updated = await updatedRes.json();

  return jsonResponse({ success: true, data: updated.data });
}

// ==================== 批量更新书签 ====================
async function handleUpdateBookmarks(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { username, bookmarks } = await request.json();
  
  if (!username) {
    return jsonResponse({ error: 'Username is required' }, 400);
  }

  const doId = env.USER_DO.idFromName(username.toLowerCase());
  const doStub = env.USER_DO.get(doId);

  return await doStub.fetch(new Request('http://do/update-bookmarks', {
    method: 'POST',
    body: JSON.stringify({ bookmarks })
  }));
}

// ==================== 真实新闻 API ====================
async function handleNews(request, env) {
  const url = new URL(request.url);
  const interests = url.searchParams.get('interests')?.split(',') || ['Tech'];
  const news = await fetchRealNews(interests);
  return jsonResponse(news);
}

async function fetchRealNews(interests) {
  const allNews = [];

  try {
    if (interests.some(i => ['Tech', 'AI', 'Startup'].includes(i))) {
      const hnNews = await fetchHackerNews();
      allNews.push(...hnNews);
    }

    if (interests.some(i => ['Tech', 'Design', 'AI'].includes(i))) {
      const devNews = await fetchDevToNews(interests);
      allNews.push(...devNews);
    }

    if (interests.includes('Tech')) {
      const ghTrending = await fetchGitHubTrending();
      allNews.push(...ghTrending);
    }

    if (interests.includes('Finance')) {
      const financeNews = await fetchFinanceNews();
      allNews.push(...financeNews);
    }

  } catch (error) {
    console.error('News fetch error:', error);
  }

  const uniqueNews = deduplicateNews(allNews);
  return uniqueNews.slice(0, 8);
}

async function fetchHackerNews() {
  try {
    const topStoriesRes = await fetch(`${CONFIG.NEWS_SOURCES.HACKER_NEWS}/topstories.json`);
    const topStories = await topStoriesRes.json();
    
    const storyIds = topStories.slice(0, 5);
    const stories = await Promise.all(
      storyIds.map(async (id) => {
        const res = await fetch(`${CONFIG.NEWS_SOURCES.HACKER_NEWS}/item/${id}.json`);
        return res.json();
      })
    );

    return stories
      .filter(s => s && s.title)
      .map(story => ({
        title: story.title,
        url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
        source: 'Hacker News',
        time: formatTimeAgo(story.time * 1000),
        score: story.score,
        category: 'Tech'
      }));
  } catch (error) {
    console.error('HN fetch error:', error);
    return [];
  }
}

async function fetchDevToNews(interests) {
  try {
    const tagMap = {
      'AI': 'ai,machinelearning,chatgpt',
      'Tech': 'programming,webdev,javascript',
      'Design': 'design,ux,css',
      'Startup': 'startup,entrepreneurship,business'
    };

    const tags = interests
      .filter(i => tagMap[i])
      .map(i => tagMap[i])
      .join(',')
      .split(',')[0] || 'programming';

    const res = await fetch(`${CONFIG.NEWS_SOURCES.DEV_TO}?tag=${tags}&per_page=4&top=1`);
    const articles = await res.json();

    return articles.map(article => ({
      title: article.title,
      url: article.url,
      source: 'Dev.to',
      time: formatTimeAgo(new Date(article.published_at).getTime()),
      author: article.user?.name || article.user?.username,
      category: 'Tech',
      reactions: article.public_reactions_count
    }));
  } catch (error) {
    console.error('Dev.to fetch error:', error);
    return [];
  }
}

async function fetchGitHubTrending() {
  try {
    const res = await fetch(
      'https://api.github.com/search/repositories?q=created:>' + 
      getDateDaysAgo(7) + 
      '&sort=stars&order=desc&per_page=3',
      { headers: { 'User-Agent': 'MyEdge-Portfolio' } }
    );
    const data = await res.json();

    return (data.items || []).map(repo => ({
      title: `🔥 ${repo.full_name} - ${repo.description?.substring(0, 60) || 'Trending repository'}`,
      url: repo.html_url,
      source: 'GitHub Trending',
      time: formatTimeAgo(new Date(repo.created_at).getTime()),
      stars: repo.stargazers_count,
      category: 'Tech'
    }));
  } catch (error) {
    console.error('GitHub trending error:', error);
    return [];
  }
}

async function fetchFinanceNews() {
  try {
    const rssUrl = encodeURIComponent('https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US');
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`);
    const data = await res.json();

    if (data.status !== 'ok') return [];

    return (data.items || []).slice(0, 3).map(item => ({
      title: item.title,
      url: item.link,
      source: 'Yahoo Finance',
      time: formatTimeAgo(new Date(item.pubDate).getTime()),
      category: 'Finance'
    }));
  } catch (error) {
    console.error('Finance news error:', error);
    return [];
  }
}

function deduplicateNews(news) {
  const seen = new Set();
  return news.filter(item => {
    const key = item.title.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

// ==================== 天气 API ====================

// 小米天气 API 城市 ID 映射
// 完整城市列表参考: https://github.com/huanghui0906/API/blob/master/xiaomi_weather.db
// 城市编码格式: 101 + 省份(2位) + 城市(2位) + 区县(2位)
const XIAOMI_CITY_IDS = {
  // ==================== 直辖市 ====================
  // 北京
  '北京': '101010100', 'beijing': '101010100',
  '海淀': '101010200', '北京朝阳': '101010300', '顺义': '101010400',
  '怀柔': '101010500', '北京通州': '101010600', '昌平': '101010700',
  '延庆': '101010800', '丰台': '101010900', '石景山': '101011000',
  '大兴': '101011100', '房山': '101011200', '密云': '101011300',
  '门头沟': '101011400', '平谷': '101011500',
  // 天津
  '天津': '101030100', 'tianjin': '101030100',
  '武清': '101030200', '宝坻': '101030300', '东丽': '101030400',
  '西青': '101030500', '北辰': '101030600', '宁河': '101030700',
  '汉沽': '101030800', '静海': '101030900', '津南': '101031000',
  '塘沽': '101031100', '大港': '101031200', '蓟县': '101031400',
  // 上海
  '上海': '101020100', 'shanghai': '101020100',
  '闵行': '101020200', '宝山': '101020300', '嘉定': '101020500',
  '浦东': '101020600', '金山': '101020700', '青浦': '101020800',
  '松江': '101020900', '奉贤': '101021000', '崇明': '101021100',
  // 重庆
  '重庆': '101040100', 'chongqing': '101040100',
  '永川': '101040200', '合川': '101040300', '南川': '101040400',
  '江津': '101040500', '万州': '101040600', '涪陵': '101040700',
  '黔江': '101040800', '长寿': '101040900', '璧山': '101041000',
  '綦江': '101041100', '潼南': '101041200', '铜梁': '101041300',
  '大足': '101041400', '荣昌': '101041500', '垫江': '101041600',
  '梁平': '101041700', '忠县': '101041800', '开县': '101041900',
  '云阳': '101042000', '奉节': '101042100', '巫溪': '101042200',
  '巫山': '101042300', '石柱': '101042400', '彭水': '101042500',
  '酉阳': '101042600', '秀山': '101042700', '武隆': '101042800',
  '丰都': '101042900', '城口': '101043000',
  
  // ==================== 华北地区 ====================
  // 河北省
  '石家庄': '101090101', 'shijiazhuang': '101090101',
  '唐山': '101090201', '张家口': '101090301', '承德': '101090402',
  '秦皇岛': '101091101', '保定': '101090201', '沧州': '101090701',
  '廊坊': '101090601', '衡水': '101090801', '邢台': '101090901',
  '邯郸': '101091001', '正定': '101090102', '藁城': '101090103',
  '晋州': '101090104', '新乐': '101090105', '辛集': '101090106',
  '涿州': '101090202', '定州': '101090203', '安国': '101090204',
  '高碑店': '101090205', '遵化': '101090502', '迁安': '101090503',
  '三河': '101090602', '霸州': '101090603', '香河': '101090604',
  '固安': '101090605', '永清': '101090606', '大厂': '101090607',
  '任丘': '101090702', '黄骅': '101090703', '河间': '101090704',
  '泊头': '101090705', '青县': '101090706', '南宫': '101090902',
  '沙河': '101090903', '武安': '101091002', '涉县': '101091003',
  // 山西省
  '太原': '101100101', 'taiyuan': '101100101',
  '大同': '101100201', '阳泉': '101100301', '晋中': '101100401',
  '长治': '101100501', '晋城': '101100601', '临汾': '101100701',
  '运城': '101100801', '朔州': '101100901', '忻州': '101101001',
  '吕梁': '101101100', '古交': '101100102', '清徐': '101100103',
  '榆次': '101100402', '介休': '101100403', '孝义': '101101102',
  '汾阳': '101101103', '侯马': '101100702', '霍州': '101100703',
  '永济': '101100802', '河津': '101100803', '原平': '101101002',
  // 内蒙古
  '呼和浩特': '101080101', 'hohhot': '101080101',
  '包头': '101080201', '乌海': '101080301', '赤峰': '101080401',
  '通辽': '101080501', '鄂尔多斯': '101080601', '呼伦贝尔': '101080701',
  '巴彦淖尔': '101080801', '乌兰察布': '101080901', '海拉尔': '101080702',
  '满洲里': '101080703', '牙克石': '101080704', '扎兰屯': '101080705',
  '额尔古纳': '101080706', '根河': '101080707', '锡林浩特': '101081101',
  '二连浩特': '101081102', '阿拉善左旗': '101081201', '阿拉善右旗': '101081202',
  '额济纳旗': '101081203', '霍林郭勒': '101080502', '乌兰浩特': '101081001',
  
  // ==================== 东北地区 ====================
  // 辽宁省
  '沈阳': '101070101', 'shenyang': '101070101',
  '大连': '101070201', 'dalian': '101070201',
  '鞍山': '101070301', '抚顺': '101070401', '本溪': '101070501',
  '丹东': '101070601', '锦州': '101070701', '营口': '101070801',
  '阜新': '101070901', '辽阳': '101071001', '盘锦': '101071101',
  '铁岭': '101071201', '辽宁朝阳': '101071301', '葫芦岛': '101071401',
  '新民': '101070102', '瓦房店': '101070202', '普兰店': '101070203',
  '庄河': '101070204', '海城': '101070302', '开原': '101071202',
  '调兵山': '101071203', '北票': '101071302', '凌源': '101071303',
  '兴城': '101071402',
  // 吉林省
  '长春': '101060101', 'changchun': '101060101',
  '吉林': '101060201', '四平': '101060301', '辽源': '101060401',
  '通化': '101060501', '白山': '101060601', '松原': '101060701',
  '白城': '101060801', '延吉': '101060901', '延边': '101060901',
  '德惠': '101060102', '九台': '101060103', '榆树': '101060104',
  '农安': '101060105', '舒兰': '101060202', '桦甸': '101060203',
  '蛟河': '101060204', '磐石': '101060205', '公主岭': '101060302',
  '双辽': '101060303', '梅河口': '101060502', '集安': '101060503',
  '临江': '101060602', '珲春': '101060902', '敦化': '101060903',
  '图们': '101060904', '龙井': '101060905', '和龙': '101060906',
  // 黑龙江省
  '哈尔滨': '101050101', 'harbin': '101050101',
  '齐齐哈尔': '101050201', '牡丹江': '101050301', '佳木斯': '101050401',
  '大庆': '101050901', '鸡西': '101051001', '双鸭山': '101051101',
  '伊春': '101050801', '七台河': '101051201', '鹤岗': '101050501',
  '黑河': '101050601', '绥化': '101050701', '大兴安岭': '101051301',
  '尚志': '101050102', '双城': '101050103', '五常': '101050104',
  '阿城': '101050105', '宾县': '101050106', '讷河': '101050202',
  '富锦': '101050402', '同江': '101050403', '绥芬河': '101050302',
  '海林': '101050303', '宁安': '101050304', '穆棱': '101050305',
  '密山': '101051002', '虎林': '101051003', '北安': '101050602',
  '五大连池': '101050603', '嫩江': '101050604', '肇东': '101050702',
  '安达': '101050703', '海伦': '101050704', '漠河': '101051302',
  
  // ==================== 华东地区 ====================
  // 江苏省
  '南京': '101190101', 'nanjing': '101190101',
  '无锡': '101190201', 'wuxi': '101190201',
  '苏州': '101190401', 'suzhou': '101190401',
  '常州': '101191101', 'changzhou': '101191101',
  '徐州': '101190801', '南通': '101190501', '连云港': '101191001',
  '淮安': '101190901', '盐城': '101190701', '扬州': '101190601',
  '镇江': '101190301', '泰州': '101191201', '宿迁': '101191301',
  '江阴': '101190202', '宜兴': '101190203', '昆山': '101190402',
  '太仓': '101190403', '常熟': '101190404', '张家港': '101190405',
  '吴江': '101190407', '金坛': '101191102', '溧阳': '101191103',
  '丹阳': '101190302', '扬中': '101190303', '句容': '101190304',
  '仪征': '101190602', '高邮': '101190603', '江都': '101190604',
  '泰兴': '101191202', '姜堰': '101191203', '靖江': '101191204',
  '兴化': '101191205', '如皋': '101190502', '海门': '101190503',
  '启东': '101190504', '南通通州': '101190505', '海安': '101190506',
  '东台': '101190702', '大丰': '101190703', '射阳': '101190704',
  '建湖': '101190705', '阜宁': '101190706', '滨海': '101190707',
  '响水': '101190708', '新沂': '101190802', '邳州': '101190803',
  '睢宁': '101190804', '沛县': '101190805', '丰县': '101190806',
  '东海': '101191002', '灌云': '101191003', '灌南': '101191004',
  '涟水': '101190902', '盱眙': '101190903', '洪泽': '101190904',
  '金湖': '101190905', '沭阳': '101191302', '泗阳': '101191303',
  '泗洪': '101191304',
  // 浙江省
  '杭州': '101210101', 'hangzhou': '101210101',
  '宁波': '101210401', 'ningbo': '101210401',
  '温州': '101210701', 'wenzhou': '101210701',
  '嘉兴': '101210301', 'jiaxing': '101210301',
  '湖州': '101210201', '绍兴': '101210501', 'shaoxing': '101210501',
  '金华': '101210901', 'jinhua': '101210901',
  '衢州': '101211001', '舟山': '101211101', '台州': '101210601',
  '丽水': '101210801', '临安': '101210102', '富阳': '101210103',
  '桐庐': '101210104', '建德': '101210105', '淳安': '101210106',
  '萧山': '101210107', '余杭': '101210108', '慈溪': '101210402',
  '余姚': '101210403', '奉化': '101210404', '宁海': '101210405',
  '象山': '101210406', '北仑': '101210410', '瑞安': '101210702',
  '乐清': '101210703', '永嘉': '101210704', '文成': '101210705',
  '平阳': '101210706', '泰顺': '101210707', '苍南': '101210708',
  '洞头': '101210709', '海宁': '101210302', '平湖': '101210303',
  '桐乡': '101210304', '嘉善': '101210305', '海盐': '101210306',
  '德清': '101210202', '长兴': '101210203', '安吉': '101210204',
  '诸暨': '101210502', '上虞': '101210503', '嵊州': '101210504',
  '新昌': '101210505', '义乌': '101210902', '东阳': '101210903',
  '永康': '101210904', '兰溪': '101210905', '浦江': '101210906',
  '武义': '101210907', '磐安': '101210908', '龙游': '101211002',
  '江山': '101211003', '常山': '101211004', '开化': '101211005',
  '岱山': '101211102', '嵊泗': '101211103', '临海': '101210602',
  '温岭': '101210603', '玉环': '101210604', '天台': '101210605',
  '仙居': '101210606', '三门': '101210607', '龙泉': '101210802',
  '青田': '101210803', '缙云': '101210804', '遂昌': '101210805',
  '松阳': '101210806', '云和': '101210807', '庆元': '101210808',
  '景宁': '101210809',
  // 安徽省
  '合肥': '101220101', 'hefei': '101220101',
  '芜湖': '101220301', '蚌埠': '101220201', '淮南': '101220401',
  '马鞍山': '101220501', '淮北': '101220601', '铜陵': '101220701',
  '安庆': '101220801', '黄山': '101221001', '滁州': '101221101',
  '阜阳': '101220801', '宿州': '101220901', '六安': '101221401',
  '亳州': '101220901', '池州': '101221701', '宣城': '101221801',
  '巢湖': '101220102', '肥东': '101220103', '肥西': '101220104',
  '长丰': '101220105', '庐江': '101220106', '当涂': '101220502',
  '繁昌': '101220302', '芜湖县': '101220303', '南陵': '101220304',
  '怀远': '101220202', '固镇': '101220203', '五河': '101220204',
  '凤台': '101220402', '天长': '101221102', '明光': '101221103',
  '全椒': '101221104', '来安': '101221105', '定远': '101221106',
  '凤阳': '101221107', '界首': '101220802', '临泉': '101220803',
  '阜南': '101220804', '颍上': '101220805', '太和': '101220806',
  '砀山': '101220902', '萧县': '101220903', '灵璧': '101220904',
  '泗县': '101220905', '霍邱': '101221402', '金寨': '101221403',
  '霍山': '101221404', '舒城': '101221405', '桐城': '101220809',
  '枞阳': '101220808', '怀宁': '101220807', '岳西': '101220810',
  '望江': '101220811', '宿松': '101220812', '潜山': '101220813',
  '太湖': '101220814', '歙县': '101221002', '休宁': '101221003',
  '黟县': '101221004', '祁门': '101221005', '屯溪': '101221006',
  '青阳': '101221702', '石台': '101221703', '东至': '101221704',
  '宁国': '101221802', '郎溪': '101221803', '广德': '101221804',
  '泾县': '101221805', '旌德': '101221806', '绩溪': '101221807',
  // 福建省
  '福州': '101230101', 'fuzhou': '101230101',
  '厦门': '101230201', 'xiamen': '101230201',
  '泉州': '101230501', 'quanzhou': '101230501',
  '漳州': '101230601', 'zhangzhou': '101230601',
  '莆田': '101230401', '三明': '101230801', '南平': '101230901',
  '龙岩': '101230701', '宁德': '101231001', '福清': '101230102',
  '长乐': '101230103', '闽侯': '101230104', '连江': '101230105',
  '罗源': '101230106', '闽清': '101230107', '永泰': '101230108',
  '平潭': '101230109', '同安': '101230206', '晋江': '101230502',
  '石狮': '101230503', '南安': '101230504', '惠安': '101230505',
  '安溪': '101230506', '永春': '101230507', '德化': '101230508',
  '龙海': '101230602', '漳浦': '101230603', '云霄': '101230604',
  '诏安': '101230605', '东山': '101230606', '平和': '101230607',
  '南靖': '101230608', '长泰': '101230609', '华安': '101230610',
  '仙游': '101230402', '永安': '101230802', '沙县': '101230803',
  '尤溪': '101230804', '大田': '101230805', '明溪': '101230806',
  '清流': '101230807', '宁化': '101230808', '建宁': '101230809',
  '泰宁': '101230810', '将乐': '101230811', '邵武': '101230902',
  '武夷山': '101230903', '建瓯': '101230904', '建阳': '101230905',
  '松溪': '101230906', '政和': '101230907', '光泽': '101230908',
  '顺昌': '101230909', '浦城': '101230910', '长汀': '101230702',
  '上杭': '101230703', '武平': '101230704', '永定': '101230705',
  '连城': '101230706', '漳平': '101230707', '福安': '101231002',
  '福鼎': '101231003', '霞浦': '101231004', '寿宁': '101231005',
  '周宁': '101231006', '柘荣': '101231007', '古田': '101231008',
  '屏南': '101231009',
  // 江西省
  '南昌': '101240101', 'nanchang': '101240101',
  '九江': '101240201', '景德镇': '101240301', '萍乡': '101240601',
  '新余': '101240801', '鹰潭': '101241101', '赣州': '101240701',
  '吉安': '101240901', '宜春': '101240501', '抚州': '101240401',
  '上饶': '101241001', '进贤': '101240102', '新建': '101240103',
  '安义': '101240104', '南昌县': '101240105', '瑞昌': '101240202',
  '九江县': '101240203', '武宁': '101240204', '修水': '101240205',
  '永修': '101240206', '德安': '101240207', '星子': '101240208',
  '都昌': '101240209', '湖口': '101240210', '彭泽': '101240211',
  '乐平': '101240302', '浮梁': '101240303', '丰城': '101240502',
  '樟树': '101240503', '高安': '101240504', '奉新': '101240505',
  '万载': '101240506', '上高': '101240507', '宜丰': '101240508',
  '靖安': '101240509', '铜鼓': '101240510', '芦溪': '101240602',
  '上栗': '101240603', '莲花': '101240604', '赣县': '101240702',
  '南康': '101240703', '瑞金': '101240704', '信丰': '101240705',
  '大余': '101240706', '上犹': '101240707', '崇义': '101240708',
  '安远': '101240709', '龙南': '101240710', '定南': '101240711',
  '全南': '101240712', '宁都': '101240713', '于都': '101240714',
  '兴国': '101240715', '会昌': '101240716', '寻乌': '101240717',
  '石城': '101240718', '分宜': '101240802', '吉安县': '101240902',
  '吉水': '101240903', '峡江': '101240904', '新干': '101240905',
  '永丰': '101240906', '泰和': '101240907', '遂川': '101240908',
  '万安': '101240909', '安福': '101240910', '永新': '101240911',
  '井冈山': '101240912', '临川': '101240402', '南城': '101240403',
  '黎川': '101240404', '南丰': '101240405', '崇仁': '101240406',
  '乐安': '101240407', '宜黄': '101240408', '金溪': '101240409',
  '资溪': '101240410', '东乡区': '101240411', '广昌': '101240412',
  '上饶县': '101241002', '广丰': '101241003', '玉山': '101241004',
  '铅山': '101241005', '横峰': '101241006', '弋阳': '101241007',
  '余干': '101241008', '鄱阳': '101241009', '万年': '101241010',
  '婺源': '101241011', '德兴': '101241012', '贵溪': '101241102',
  '余江': '101241103',
  // 山东省
  '济南': '101120101', 'jinan': '101120101',
  '青岛': '101120201', 'qingdao': '101120201',
  '烟台': '101120501', 'yantai': '101120501',
  '淄博': '101120301', '枣庄': '101121001', '东营': '101121201',
  '潍坊': '101120601', 'weifang': '101120601',
  '济宁': '101120701', '泰安': '101120801', '威海': '101121301',
  '日照': '101121501', '莱芜': '101121401', '临沂': '101120901',
  '德州': '101120401', '聊城': '101121701', '滨州': '101121101',
  '菏泽': '101121601', '章丘': '101120102', '平阴': '101120103',
  '济阳': '101120104', '商河': '101120105', '即墨': '101120202',
  '胶州': '101120203', '胶南': '101120205', '莱西': '101120206',
  '平度': '101120207', '桓台': '101120302', '高青': '101120303',
  '沂源': '101120304', '滕州': '101121002', '利津': '101121202',
  '垦利': '101121203', '广饶': '101121204', '青州': '101120602',
  '诸城': '101120603', '寿光': '101120604', '安丘': '101120605',
  '高密': '101120606', '昌邑': '101120607', '昌乐': '101120608',
  '临朐': '101120609', '曲阜': '101120702', '兖州': '101120703',
  '邹城': '101120704', '嘉祥': '101120705', '金乡': '101120706',
  '鱼台': '101120707', '微山': '101120708', '泗水': '101120709',
  '汶上': '101120710', '梁山': '101120711', '新泰': '101120802',
  '肥城': '101120803', '宁阳': '101120804', '东平': '101120805',
  '荣成': '101121302', '文登': '101121303', '乳山': '101121304',
  '莒县': '101121502', '五莲': '101121503', '沂南': '101120902',
  '郯城': '101120903', '沂水': '101120904', '苍山': '101120905',
  '费县': '101120906', '平邑': '101120907', '莒南': '101120908',
  '蒙阴': '101120909', '临沭': '101120910', '禹城': '101120402',
  '乐陵': '101120403', '临邑': '101120404', '平原': '101120405',
  '夏津': '101120406', '武城': '101120407', '齐河': '101120408',
  '宁津': '101120409', '庆云': '101120410', '陵县': '101120411',
  '龙口': '101120502', '莱阳': '101120503', '莱州': '101120504',
  '蓬莱': '101120505', '招远': '101120506', '栖霞': '101120507',
  '海阳': '101120508', '长岛': '101120509', '临清': '101121702',
  '高唐': '101121703', '茌平': '101121704', '东阿': '101121705',
  '冠县': '101121706', '莘县': '101121707', '阳谷': '101121708',
  '无棣': '101121102', '阳信': '101121103', '惠民': '101121104',
  '博兴': '101121105', '邹平': '101121106', '沾化': '101121107',
  '曹县': '101121602', '单县': '101121603', '成武': '101121604',
  '巨野': '101121605', '郓城': '101121606', '鄄城': '101121607',
  '定陶': '101121608', '东明': '101121609',
  
  // ==================== 华中地区 ====================
  // 河南省
  '郑州': '101180101', 'zhengzhou': '101180101',
  '开封': '101180801', '洛阳': '101180901', '平顶山': '101180501',
  '安阳': '101180201', '鹤壁': '101181201', '新乡': '101180301',
  '焦作': '101181101', '濮阳': '101181301', '许昌': '101180401',
  '漯河': '101181501', '三门峡': '101181701', '南阳': '101180701',
  '商丘': '101181001', '信阳': '101180601', '周口': '101181401',
  '驻马店': '101181601', '济源': '101181801', '巩义': '101180102',
  '荥阳': '101180103', '新密': '101180104', '新郑': '101180105',
  '登封': '101180106', '中牟': '101180107', '偃师': '101180902',
  '孟津': '101180903', '新安': '101180904', '洛宁': '101180905',
  '宜阳': '101180906', '伊川': '101180907', '嵩县': '101180908',
  '栾川': '101180909', '汝阳': '101180910', '林州': '101180202',
  '内黄': '101180203', '汤阴': '101180204', '滑县': '101180205',
  '辉县': '101180302', '卫辉': '101180303', '新乡县': '101180304',
  '获嘉': '101180305', '原阳': '101180306', '延津': '101180307',
  '封丘': '101180308', '长垣': '101180309', '禹州': '101180402',
  '长葛': '101180403', '鄢陵': '101180404', '襄城': '101180405',
  '舞钢': '101180502', '叶县': '101180503', '宝丰': '101180504',
  '郏县': '101180505', '鲁山': '101180506', '汝州': '101180507',
  '罗山': '101180602', '光山': '101180603', '息县': '101180604',
  '潢川': '101180605', '淮滨': '101180606', '商城': '101180607',
  '新县': '101180608', '固始': '101180609', '邓州': '101180702',
  '南召': '101180703', '方城': '101180704', '西峡': '101180705',
  '镇平': '101180706', '内乡': '101180707', '淅川': '101180708',
  '社旗': '101180709', '唐河': '101180710', '新野': '101180711',
  '桐柏': '101180712', '杞县': '101180802', '通许': '101180803',
  '尉氏': '101180804', '兰考': '101180805', '永城': '101181002',
  '夏邑': '101181003', '虞城': '101181004', '柘城': '101181005',
  '宁陵': '101181006', '睢县': '101181007', '民权': '101181008',
  '沁阳': '101181102', '孟州': '101181103', '温县': '101181104',
  '博爱': '101181105', '修武': '101181106', '武陟': '101181107',
  '浚县': '101181202', '淇县': '101181203', '清丰': '101181302',
  '南乐': '101181303', '范县': '101181304', '台前': '101181305',
  '濮阳县': '101181306', '项城': '101181402', '沈丘': '101181403',
  '淮阳': '101181404', '太康': '101181405', '鹿邑': '101181406',
  '西华': '101181407', '扶沟': '101181408', '商水': '101181409',
  '郸城': '101181410', '舞阳': '101181502', '临颍': '101181503',
  '遂平': '101181602', '西平': '101181603', '上蔡': '101181604',
  '汝南': '101181605', '平舆': '101181606', '确山': '101181607',
  '正阳': '101181608', '新蔡': '101181609', '泌阳': '101181610',
  '义马': '101181702', '渑池': '101181703', '灵宝': '101181704',
  '卢氏': '101181705', '陕县': '101181706',
  // 湖北省
  '武汉': '101200101', 'wuhan': '101200101',
  '黄石': '101200601', '十堰': '101201101', '宜昌': '101200901',
  '襄阳': '101200201', '襄樊': '101200201', '鄂州': '101200301',
  '荆门': '101201401', '孝感': '101200401', '荆州': '101200801',
  '黄冈': '101200501', '咸宁': '101200701', '随州': '101201301',
  '恩施': '101201001', '仙桃': '101201201', '潜江': '101201501',
  '天门': '101201601', '神农架': '101201701', '蔡甸': '101200102',
  '江夏': '101200103', '黄陂': '101200104', '新洲': '101200105',
  '大冶': '101200602', '阳新': '101200603', '丹江口': '101201102',
  '郧县': '101201103', '郧西': '101201104', '竹山': '101201105',
  '竹溪': '101201106', '房县': '101201107', '宜都': '101200902',
  '当阳': '101200903', '枝江': '101200904', '远安': '101200905',
  '兴山': '101200906', '秭归': '101200907', '长阳': '101200908',
  '五峰': '101200909', '老河口': '101200202', '枣阳': '101200203',
  '宜城': '101200204', '南漳': '101200205', '谷城': '101200206',
  '保康': '101200207', '京山': '101201402', '沙洋': '101201403',
  '钟祥': '101201404', '应城': '101200402', '安陆': '101200403',
  '云梦': '101200404', '大悟': '101200405', '孝昌': '101200406',
  '汉川': '101200407', '公安': '101200802', '监利': '101200803',
  '江陵': '101200804', '石首': '101200805', '洪湖': '101200806',
  '松滋': '101200807', '团风': '101200502', '红安': '101200503',
  '罗田': '101200504', '英山': '101200505', '浠水': '101200506',
  '蕲春': '101200507', '黄梅': '101200508', '麻城': '101200509',
  '武穴': '101200510', '赤壁': '101200702', '嘉鱼': '101200703',
  '崇阳': '101200704', '通城': '101200705', '通山': '101200706',
  '广水': '101201302', '曾都': '101201303', '利川': '101201002',
  '建始': '101201003', '巴东': '101201004', '宣恩': '101201005',
  '咸丰': '101201006', '来凤': '101201007', '鹤峰': '101201008',
  // 湖南省
  '长沙': '101250101', 'changsha': '101250101',
  '株洲': '101250301', '湘潭': '101250201', '衡阳': '101250401',
  '邵阳': '101250901', '岳阳': '101251001', '常德': '101250601',
  '张家界': '101251501', '益阳': '101250701', '郴州': '101250501',
  '永州': '101251101', '怀化': '101251201', '娄底': '101250801',
  '湘西': '101251401', '望城': '101250102', '长沙县': '101250103',
  '宁乡': '101250104', '浏阳': '101250105', '醴陵': '101250302',
  '攸县': '101250303', '茶陵': '101250304', '炎陵': '101250305',
  '株洲县': '101250306', '湘乡': '101250202', '韶山': '101250203',
  '湘潭县': '101250204', '耒阳': '101250402', '常宁': '101250403',
  '衡阳县': '101250404', '衡东': '101250405', '衡山': '101250406',
  '衡南': '101250407', '祁东': '101250408', '邵东': '101250902',
  '新邵': '101250903', '邵阳县': '101250904', '隆回': '101250905',
  '洞口': '101250906', '武冈': '101250907', '新宁': '101250908',
  '绥宁': '101250909', '城步': '101250910', '汨罗': '101251002',
  '临湘': '101251003', '岳阳县': '101251004', '湘阴': '101251005',
  '平江': '101251006', '华容': '101251007', '桃源': '101250602',
  '汉寿': '101250603', '澧县': '101250604', '临澧': '101250605',
  '安乡': '101250606', '石门': '101250607', '津市': '101250608',
  '慈利': '101251502', '桑植': '101251503', '沅江': '101250702',
  '桃江': '101250703', '南县': '101250704', '安化': '101250705',
  '资兴': '101250502', '宜章': '101250503', '汝城': '101250504',
  '安仁': '101250505', '嘉禾': '101250506', '临武': '101250507',
  '桂东': '101250508', '永兴': '101250509', '桂阳': '101250510',
  '祁阳': '101251102', '东安': '101251103', '双牌': '101251104',
  '道县': '101251105', '江永': '101251106', '宁远': '101251107',
  '蓝山': '101251108', '新田': '101251109', '江华': '101251110',
  '中方': '101251202', '沅陵': '101251203', '辰溪': '101251204',
  '溆浦': '101251205', '会同': '101251206', '麻阳': '101251207',
  '新晃': '101251208', '芷江': '101251209', '靖州': '101251210',
  '通道': '101251211', '洪江': '101251212', '冷水江': '101250802',
  '涟源': '101250803', '双峰': '101250804', '新化': '101250805',
  '吉首': '101251402', '泸溪': '101251403', '凤凰': '101251404',
  '花垣': '101251405', '保靖': '101251406', '古丈': '101251407',
  '永顺': '101251408', '龙山': '101251409',
  
  // ==================== 华南地区 ====================
  // 广东省
  '广州': '101280101', 'guangzhou': '101280101',
  '深圳': '101280601', 'shenzhen': '101280601',
  '东莞': '101281601', 'dongguan': '101281601',
  '佛山': '101280800', 'foshan': '101280800',
  '珠海': '101280701', 'zhuhai': '101280701',
  '中山': '101281701', 'zhongshan': '101281701',
  '惠州': '101280301', 'huizhou': '101280301',
  '汕头': '101280501', 'shantou': '101280501',
  '江门': '101281101', '湛江': '101281001', '茂名': '101282001',
  '肇庆': '101280901', '韶关': '101280201', '梅州': '101280401',
  '汕尾': '101282101', '河源': '101281201', '阳江': '101281801',
  '清远': '101281301', '潮州': '101281501', '揭阳': '101281901',
  '云浮': '101281401', '番禺': '101280102', '从化': '101280103',
  '增城': '101280104', '花都': '101280105', '南海': '101280803',
  '顺德': '101280801', '三水': '101280806', '高明': '101280807',
  '宝安': '101280602', '盐田': '101280603', '龙岗': '101280604',
  '南山': '101280605', '斗门': '101280702', '金湾': '101280703',
  '台山': '101281102', '开平': '101281103', '鹤山': '101281104',
  '恩平': '101281105', '新会': '101281106', '吴川': '101281002',
  '雷州': '101281003', '廉江': '101281004', '遂溪': '101281005',
  '徐闻': '101281006', '高州': '101282002', '化州': '101282003',
  '电白': '101282004', '信宜': '101282005', '高要': '101280902',
  '四会': '101280903', '广宁': '101280904', '德庆': '101280905',
  '封开': '101280906', '怀集': '101280907', '曲江': '101280202',
  '乐昌': '101280203', '南雄': '101280204', '仁化': '101280205',
  '始兴': '101280206', '翁源': '101280207', '新丰': '101280208',
  '乳源': '101280209', '梅县': '101280402', '兴宁': '101280403',
  '蕉岭': '101280404', '大埔': '101280405', '丰顺': '101280406',
  '平远': '101280407', '五华': '101280408', '惠东': '101280302',
  '博罗': '101280303', '龙门': '101280304', '潮阳': '101280502',
  '潮南': '101280503', '澄海': '101280504', '南澳': '101280505',
  '海丰': '101282102', '陆丰': '101282103', '陆河': '101282104',
  '紫金': '101281202', '龙川': '101281203', '连平': '101281204',
  '和平': '101281205', '东源': '101281206', '阳西': '101281802',
  '阳春': '101281803', '连州': '101281302', '英德': '101281303',
  '连山': '101281304', '连南': '101281305', '清新': '101281306',
  '佛冈': '101281307', '阳山': '101281308', '潮安': '101281502',
  '饶平': '101281503', '普宁': '101281902', '揭东': '101281903',
  '惠来': '101281904', '揭西': '101281905', '罗定': '101281402',
  '云安': '101281403', '新兴': '101281404', '郁南': '101281405',
  // 广西壮族自治区
  '南宁': '101300101', 'nanning': '101300101',
  '柳州': '101300301', '桂林': '101300501', '梧州': '101300601',
  '北海': '101301001', '防城港': '101301101', '钦州': '101301201',
  '贵港': '101300801', '玉林': '101300901', '百色': '101300701',
  '贺州': '101300401', '河池': '101301301', '来宾': '101300201',
  '崇左': '101301401', '武鸣': '101300102', '邕宁': '101300103',
  '隆安': '101300104', '马山': '101300105', '上林': '101300106',
  '宾阳': '101300107', '横县': '101300108', '柳江': '101300302',
  '柳城': '101300303', '鹿寨': '101300304', '融安': '101300305',
  '融水': '101300306', '三江': '101300307', '阳朔': '101300502',
  '临桂': '101300503', '灵川': '101300504', '全州': '101300505',
  '兴安': '101300506', '永福': '101300507', '灌阳': '101300508',
  '龙胜': '101300509', '资源': '101300510', '平乐': '101300511',
  '荔浦': '101300512', '恭城': '101300513', '苍梧': '101300602',
  '藤县': '101300603', '蒙山': '101300604', '岑溪': '101300605',
  '田阳': '101300702', '田东': '101300703', '平果': '101300704',
  '德保': '101300705', '靖西': '101300706', '那坡': '101300707',
  '凌云': '101300708', '乐业': '101300709', '田林': '101300710',
  '西林': '101300711', '隆林': '101300712', '桂平': '101300802',
  '平南': '101300803', '覃塘': '101300804', '港北': '101300805',
  '港南': '101300806', '容县': '101300902', '陆川': '101300903',
  '博白': '101300904', '兴业': '101300905', '北流': '101300906',
  '合浦': '101301002', '东兴': '101301102', '上思': '101301103',
  '灵山': '101301202', '浦北': '101301203', '昭平': '101300402',
  '钟山': '101300403', '富川': '101300404', '宜州': '101301302',
  '罗城': '101301303', '环江': '101301304', '南丹': '101301305',
  '天峨': '101301306', '凤山': '101301307', '东兰': '101301308',
  '巴马': '101301309', '都安': '101301310', '大化': '101301311',
  '兴宾': '101300202', '忻城': '101300203', '象州': '101300204',
  '武宣': '101300205', '金秀': '101300206', '合山': '101300207',
  '扶绥': '101301402', '宁明': '101301403', '龙州': '101301404',
  '大新': '101301405', '天等': '101301406', '凭祥': '101301407',
  // 海南省
  '海口': '101310101', 'haikou': '101310101',
  '三亚': '101310201', 'sanya': '101310201',
  '三沙': '101310301', '儋州': '101310205', '文昌': '101310202',
  '琼海': '101310203', '万宁': '101310204', '五指山': '101310206',
  '东方': '101310207', '定安': '101310102', '屯昌': '101310103',
  '澄迈': '101310104', '临高': '101310105', '白沙': '101310208',
  '昌江': '101310209', '乐东': '101310220', '陵水': '101310221',
  '保亭': '101310222', '琼中': '101310223',
  
  // ==================== 西南地区 ====================
  // 四川省
  '成都': '101270101', 'chengdu': '101270101',
  '绵阳': '101270401', '德阳': '101272001', '眉山': '101271401',
  '宜宾': '101271101', '泸州': '101271001', '达州': '101270601',
  '南充': '101270501', '遂宁': '101270701', '广安': '101270801',
  '巴中': '101270901', '内江': '101271201', '资阳': '101271301',
  '乐山': '101271501', '自贡': '101270301', '攀枝花': '101270201',
  '雅安': '101271601', '广元': '101272101', '凉山': '101271701',
  '甘孜州': '101271801', '阿坝州': '101271901', '都江堰': '101270102',
  '彭州': '101270103', '邛崃': '101270104', '崇州': '101270105',
  '金堂': '101270106', '双流': '101270107', '郫县': '101270108',
  '大邑': '101270109', '蒲江': '101270110', '新津': '101270111',
  '龙泉驿': '101270112', '新都': '101270113', '温江': '101270114',
  '青白江': '101270115', '江油': '101270402', '三台': '101270403',
  '盐亭': '101270404', '安县': '101270405', '梓潼': '101270406',
  '北川': '101270407', '平武': '101270408', '什邡': '101272002',
  '广汉': '101272003', '绵竹': '101272004', '罗江': '101272005',
  '中江': '101272006', '仁寿': '101271402', '彭山': '101271403',
  '洪雅': '101271404', '丹棱': '101271405', '青神': '101271406',
  '翠屏': '101271102', '宜宾县': '101271103', '南溪': '101271104',
  '江安': '101271105', '长宁': '101271106', '高县': '101271107',
  '珙县': '101271108', '筠连': '101271109', '兴文': '101271110',
  '屏山': '101271111', '泸县': '101271002', '合江': '101271003',
  '叙永': '101271004', '古蔺': '101271005', '纳溪': '101271006',
  '万源': '101270602', '宣汉': '101270603', '开江': '101270604',
  '达县': '101270605', '大竹': '101270606', '渠县': '101270607',
  '阆中': '101270502', '南部': '101270503', '营山': '101270504',
  '蓬安': '101270505', '仪陇': '101270506', '西充': '101270507',
  '射洪': '101270702', '蓬溪': '101270703', '大英': '101270704',
  '岳池': '101270802', '武胜': '101270803', '邻水': '101270804',
  '华蓥': '101270805', '通江': '101270902', '南江': '101270903',
  '平昌': '101270904', '隆昌': '101271202', '威远': '101271203',
  '资中': '101271204', '安岳': '101271302', '乐至': '101271303',
  '简阳': '101271304', '峨眉山': '101271502', '犍为': '101271503',
  '井研': '101271504', '夹江': '101271505', '沐川': '101271506',
  '马边': '101271507', '峨边': '101271508', '荣县': '101270302',
  '富顺': '101270303', '米易': '101270202', '盐边': '101270203',
  '名山': '101271602', '荥经': '101271603', '汉源': '101271604',
  '石棉': '101271605', '天全': '101271606', '芦山': '101271607',
  '宝兴': '101271608', '旺苍': '101272102', '青川': '101272103',
  '剑阁': '101272104', '苍溪': '101272105', '西昌': '101271702',
  '德昌': '101271703', '会理': '101271704', '会东': '101271705',
  '宁南': '101271706', '普格': '101271707', '布拖': '101271708',
  '金阳': '101271709', '昭觉': '101271710', '喜德': '101271711',
  '冕宁': '101271712', '越西': '101271713', '甘洛': '101271714',
  '美姑': '101271715', '雷波': '101271716', '盐源': '101271717',
  '木里': '101271718', '康定': '101271802', '泸定': '101271803',
  '丹巴': '101271804', '九龙县': '101271805', '雅江': '101271806',
  '道孚': '101271807', '炉霍': '101271808', '甘孜县': '101271809',
  '新龙': '101271810', '德格': '101271811', '白玉': '101271812',
  '石渠': '101271813', '色达': '101271814', '理塘': '101271815',
  '巴塘': '101271816', '乡城': '101271817', '稻城': '101271818',
  '得荣': '101271819', '马尔康': '101271902', '金川': '101271903',
  '小金': '101271904', '阿坝县': '101271905', '若尔盖': '101271906',
  '红原': '101271907', '壤塘': '101271908', '汶川': '101271909',
  '理县': '101271910', '茂县': '101271911', '松潘': '101271912',
  '九寨沟': '101271913', '黑水': '101271914',
  // 贵州省
  '贵阳': '101260101', 'guiyang': '101260101',
  '遵义': '101260201', '六盘水': '101260801', '安顺': '101260301',
  '毕节': '101260501', '铜仁': '101260601', '黔西南': '101260901',
  '黔东南': '101260401', '黔南': '101260701', '清镇': '101260102',
  '开阳': '101260103', '息烽': '101260104', '修文': '101260105',
  '赤水': '101260202', '仁怀': '101260203', '遵义县': '101260204',
  '桐梓': '101260205', '绥阳': '101260206', '正安': '101260207',
  '凤冈': '101260208', '湄潭': '101260209', '余庆': '101260210',
  '习水': '101260211', '道真': '101260212', '务川': '101260213',
  '平坝': '101260302', '普定': '101260303', '镇宁': '101260304',
  '关岭': '101260305', '紫云': '101260306', '凯里': '101260402',
  '黄平': '101260403', '施秉': '101260404', '三穗': '101260405',
  '镇远': '101260406', '岑巩': '101260407', '天柱': '101260408',
  '锦屏': '101260409', '剑河': '101260410', '台江': '101260411',
  '黎平': '101260412', '榕江': '101260413', '从江': '101260414',
  '雷山': '101260415', '麻江': '101260416', '丹寨': '101260417',
  '大方': '101260502', '黔西': '101260503', '金沙': '101260504',
  '织金': '101260505', '纳雍': '101260506', '威宁': '101260507',
  '赫章': '101260508', '铜仁区': '101260602', '江口': '101260603',
  '玉屏': '101260604', '石阡': '101260605', '思南': '101260606',
  '印江': '101260607', '德江': '101260608', '沿河': '101260609',
  '松桃': '101260610', '万山': '101260611', '都匀': '101260702',
  '福泉': '101260703', '荔波': '101260704', '贵定': '101260705',
  '瓮安': '101260706', '独山': '101260707', '平塘': '101260708',
  '罗甸': '101260709', '长顺': '101260710', '龙里': '101260711',
  '惠水': '101260712', '三都': '101260713', '兴义': '101260902',
  '兴仁': '101260903', '普安': '101260904', '晴隆': '101260905',
  '贞丰': '101260906', '望谟': '101260907', '册亨': '101260908',
  '安龙': '101260909',
  // 云南省
  '昆明': '101290101', 'kunming': '101290101',
  '曲靖': '101290401', '玉溪': '101290301', '保山': '101290501',
  '昭通': '101290201', '丽江': '101290601', '普洱': '101290701',
  '临沧': '101290801', '楚雄': '101290901', '红河': '101291001',
  '文山': '101291101', '西双版纳': '101291201', '大理': '101290601',
  '德宏': '101291401', '怒江': '101291501', '迪庆': '101291601',
  '安宁': '101290102', '呈贡': '101290103', '晋宁': '101290104',
  '富民': '101290105', '宜良': '101290106', '嵩明': '101290107',
  '石林': '101290108', '禄劝': '101290109', '寻甸': '101290110',
  '东川': '101290111', '宣威': '101290402', '马龙': '101290403',
  '陆良': '101290404', '师宗': '101290405', '罗平': '101290406',
  '富源': '101290407', '会泽': '101290408', '沾益': '101290409',
  '江川': '101290302', '澄江': '101290303', '通海': '101290304',
  '华宁': '101290305', '易门': '101290306', '峨山': '101290307',
  '新平': '101290308', '元江': '101290309', '施甸': '101290502',
  '腾冲': '101290503', '龙陵': '101290504', '昌宁': '101290505',
  '鲁甸': '101290202', '巧家': '101290203', '盐津': '101290204',
  '大关': '101290205', '永善': '101290206', '绥江': '101290207',
  '镇雄': '101290208', '彝良': '101290209', '威信': '101290210',
  '水富': '101290211', '永胜': '101290602', '华坪': '101290603',
  '宁蒗': '101290604', '思茅': '101290702', '宁洱': '101290703',
  '墨江': '101290704', '景东': '101290705', '景谷': '101290706',
  '镇沅': '101290707', '江城': '101290708', '孟连': '101290709',
  '澜沧': '101290710', '西盟': '101290711', '凤庆': '101290802',
  '云县': '101290803', '永德': '101290804', '镇康': '101290805',
  '双江': '101290806', '耿马': '101290807', '沧源': '101290808',
  '楚雄市': '101290902', '双柏': '101290903', '牟定': '101290904',
  '南华': '101290905', '姚安': '101290906', '大姚': '101290907',
  '永仁': '101290908', '元谋': '101290909', '武定': '101290910',
  '禄丰': '101290911', '个旧': '101291002', '开远': '101291003',
  '蒙自': '101291004', '屏边': '101291005', '建水': '101291006',
  '石屏': '101291007', '弥勒': '101291008', '泸西': '101291009',
  '元阳': '101291010', '红河县': '101291011', '金平': '101291012',
  '绿春': '101291013', '河口': '101291014', '文山市': '101291102',
  '砚山': '101291103', '西畴': '101291104', '麻栗坡': '101291105',
  '马关': '101291106', '丘北': '101291107', '广南': '101291108',
  '富宁': '101291109', '景洪': '101291202', '勐海': '101291203',
  '勐腊': '101291204', '大理市': '101290602', '祥云': '101290603',
  '宾川': '101290604', '弥渡': '101290605', '永平': '101290606',
  '云龙': '101290607', '洱源': '101290608', '剑川': '101290609',
  '鹤庆': '101290610', '漾濞': '101290611', '南涧': '101290612',
  '巍山': '101290613', '瑞丽': '101291402', '芒市': '101291403',
  '梁河': '101291404', '盈江': '101291405', '陇川': '101291406',
  '泸水': '101291502', '福贡': '101291503', '贡山': '101291504',
  '兰坪': '101291505', '香格里拉': '101291602', '德钦': '101291603',
  '维西': '101291604',
  // 西藏自治区
  '拉萨': '101140101', 'lhasa': '101140101', 'lasa': '101140101',
  '日喀则': '101140201', '山南': '101140301', '林芝': '101140401',
  '昌都': '101140501', '那曲': '101140601', '阿里': '101140701',
  '当雄': '101140102', '尼木': '101140103', '曲水': '101140104',
  '堆龙德庆': '101140105', '达孜': '101140106', '墨竹工卡': '101140107',
  '林周': '101140108', '日喀则区': '101140202', '江孜': '101140203',
  '定日': '101140204', '萨迦': '101140205', '拉孜': '101140206',
  '昂仁': '101140207', '谢通门': '101140208', '白朗': '101140209',
  '仁布': '101140210', '康马': '101140211', '定结': '101140212',
  '仲巴': '101140213', '亚东': '101140214', '吉隆': '101140215',
  '聂拉木': '101140216', '萨嘎': '101140217', '岗巴': '101140218',
  '乃东': '101140302', '扎囊': '101140303', '贡嘎': '101140304',
  '桑日': '101140305', '琼结': '101140306', '曲松': '101140307',
  '措美': '101140308', '洛扎': '101140309', '加查': '101140310',
  '隆子': '101140311', '错那': '101140312', '浪卡子': '101140313',
  '林芝县': '101140402', '工布江达': '101140403', '米林': '101140404',
  '墨脱': '101140405', '波密': '101140406', '察隅': '101140407',
  '朗县': '101140408', '昌都区': '101140502', '江达': '101140503',
  '贡觉': '101140504', '类乌齐': '101140505', '丁青': '101140506',
  '察雅': '101140507', '八宿': '101140508', '左贡': '101140509',
  '芒康': '101140510', '洛隆': '101140511', '边坝': '101140512',
  '那曲区': '101140602', '嘉黎': '101140603', '比如': '101140604',
  '聂荣': '101140605', '安多': '101140606', '申扎': '101140607',
  '索县': '101140608', '班戈': '101140609', '巴青': '101140610',
  '尼玛': '101140611', '普兰': '101140702', '札达': '101140703',
  '噶尔': '101140704', '日土': '101140705', '革吉': '101140706',
  '改则': '101140707', '措勤': '101140708',
  
  // ==================== 西北地区 ====================
  // 陕西省
  '西安': '101110101', 'xian': '101110101',
  '咸阳': '101110200', '宝鸡': '101110901', '渭南': '101110501',
  '铜川': '101111001', '延安': '101110300', '榆林': '101110401',
  '汉中': '101110601', '安康': '101110701', '商洛': '101110800',
  '长安': '101110102', '临潼': '101110103', '蓝田': '101110104',
  '周至': '101110105', '户县': '101110106', '高陵': '101110107',
  '兴平': '101110201', '三原': '101110202', '泾阳': '101110203',
  '乾县': '101110204', '礼泉': '101110205', '永寿': '101110206',
  '彬县': '101110207', '长武': '101110208', '旬邑': '101110209',
  '淳化': '101110210', '武功': '101110211', '凤翔': '101110902',
  '岐山': '101110903', '扶风': '101110904', '眉县': '101110905',
  '陇县': '101110906', '千阳': '101110907', '麟游': '101110908',
  '凤县': '101110909', '太白': '101110910', '华县': '101110502',
  '潼关': '101110503', '大荔': '101110504', '合阳': '101110505',
  '澄城': '101110506', '蒲城': '101110507', '白水': '101110508',
  '富平': '101110509', '韩城': '101110510', '华阴': '101110511',
  '宜君': '101111002', '耀州': '101111003', '延长': '101110302',
  '延川': '101110303', '子长': '101110304', '安塞': '101110305',
  '志丹': '101110306', '吴起': '101110307', '甘泉': '101110308',
  '富县': '101110309', '洛川': '101110310', '宜川': '101110311',
  '黄龙': '101110312', '黄陵': '101110313', '神木': '101110402',
  '府谷': '101110403', '横山': '101110404', '靖边': '101110405',
  '定边': '101110406', '绥德': '101110407', '米脂': '101110408',
  '佳县': '101110409', '吴堡': '101110410', '清涧': '101110411',
  '子洲': '101110412', '南郑': '101110602', '城固': '101110603',
  '洋县': '101110604', '西乡': '101110605', '勉县': '101110606',
  '宁强': '101110607', '略阳': '101110608', '镇巴': '101110609',
  '留坝': '101110610', '佛坪': '101110611', '汉阴': '101110702',
  '石泉': '101110703', '宁陕': '101110704', '紫阳': '101110705',
  '岚皋': '101110706', '平利': '101110707', '镇坪': '101110708',
  '旬阳': '101110709', '白河': '101110710', '洛南': '101110802',
  '丹凤': '101110803', '商南': '101110804', '山阳': '101110805',
  '镇安': '101110806', '柞水': '101110807',
  // 甘肃省
  '兰州': '101160101', 'lanzhou': '101160101',
  '嘉峪关': '101160401', '金昌': '101160501', '白银': '101160901',
  '天水': '101160801', '武威': '101160201', '张掖': '101160701',
  '平凉': '101160301', '酒泉': '101160601', '庆阳': '101161001',
  '定西': '101160801', '陇南': '101161201', '临夏': '101161101',
  '甘南': '101161301', '永登': '101160102', '皋兰': '101160103',
  '榆中': '101160104', '古浪': '101160202', '民勤': '101160203',
  '天祝': '101160204', '静宁': '101160302', '灵台': '101160303',
  '崇信': '101160304', '华亭': '101160305', '庄浪': '101160306',
  '泾川': '101160307', '永靖': '101161102', '和政': '101161103',
  '广河': '101161104', '康乐': '101161105', '临夏县': '101161106',
  '东乡县': '101161107', '积石山': '101161108', '金塔': '101160602',
  '瓜州': '101160603', '肃北': '101160604', '阿克塞': '101160605',
  '敦煌': '101160606', '玉门': '101160607', '山丹': '101160702',
  '民乐': '101160703', '临泽': '101160704', '高台': '101160705',
  '肃南': '101160706', '秦安': '101160802', '甘谷': '101160803',
  '武山': '101160804', '清水': '101160805', '张家川': '101160806',
  '靖远': '101160902', '会宁': '101160903', '景泰': '101160904',
  '庆城': '101161002', '环县': '101161003', '华池': '101161004',
  '合水': '101161005', '正宁': '101161006', '宁县': '101161007',
  '镇原': '101161008', '通渭': '101160902', '陇西': '101160903',
  '渭源': '101160904', '临洮': '101160905', '漳县': '101160906',
  '岷县': '101160907', '成县': '101161202', '文县': '101161203',
  '宕昌': '101161204', '康县': '101161205', '西和': '101161206',
  '礼县': '101161207', '徽县': '101161208', '两当': '101161209',
  '合作': '101161302', '临潭': '101161303', '卓尼': '101161304',
  '舟曲': '101161305', '迭部': '101161306', '玛曲': '101161307',
  '碌曲': '101161308', '夏河': '101161309',
  // 青海省
  '西宁': '101150101', 'xining': '101150101',
  '海东': '101150201', '海北': '101150801', '黄南': '101150301',
  '海南': '101150401', '果洛': '101150501', '玉树': '101150601',
  '海西': '101150701', '大通': '101150102', '湟中': '101150103',
  '湟源': '101150104', '平安': '101150202', '乐都': '101150203',
  '民和': '101150204', '互助': '101150205', '化隆': '101150206',
  '循化': '101150207', '祁连': '101150802', '海晏': '101150803',
  '刚察': '101150804', '门源': '101150805', '同仁': '101150302',
  '尖扎': '101150303', '泽库': '101150304', '河南': '101150305',
  '共和': '101150402', '同德': '101150403', '贵德': '101150404',
  '兴海': '101150405', '贵南': '101150406', '玛沁': '101150502',
  '班玛': '101150503', '甘德': '101150504', '达日': '101150505',
  '久治': '101150506', '玛多': '101150507', '玉树市': '101150602',
  '杂多': '101150603', '称多': '101150604', '治多': '101150605',
  '囊谦': '101150606', '曲麻莱': '101150607', '格尔木': '101150702',
  '德令哈': '101150703', '乌兰': '101150704', '都兰': '101150705',
  '天峻': '101150706',
  // 宁夏回族自治区
  '银川': '101170101', 'yinchuan': '101170101',
  '石嘴山': '101170201', '吴忠': '101170301', '固原': '101170401',
  '中卫': '101170501', '永宁': '101170102', '贺兰': '101170103',
  '灵武': '101170104', '平罗': '101170202', '惠农': '101170203',
  '利通': '101170302', '盐池': '101170303', '同心': '101170304',
  '青铜峡': '101170305', '原州': '101170402', '西吉': '101170403',
  '隆德': '101170404', '泾源': '101170405', '彭阳': '101170406',
  '沙坡头': '101170502', '中宁': '101170503', '海原': '101170504',
  // 新疆维吾尔自治区
  '乌鲁木齐': '101130101', 'urumqi': '101130101',
  '克拉玛依': '101130201', '吐鲁番': '101130501', '哈密': '101130601',
  '昌吉': '101130301', '博尔塔拉': '101130801', '巴音郭楞': '101130901',
  '阿克苏': '101131001', '克孜勒苏': '101131101', '喀什': '101131201',
  '和田': '101131301', '伊犁': '101130401', '塔城': '101130701',
  '阿勒泰': '101131401', '石河子': '101131501', '阿拉尔': '101131601',
  '图木舒克': '101131701', '五家渠': '101131801', '北屯': '101131901',
  '铁门关': '101132001', '双河': '101132101', '可克达拉': '101132201',
  '昆玉': '101132301', '乌鲁木齐县': '101130102', '米东': '101130103',
  '达坂城': '101130104', '独山子': '101130202', '克拉玛依区': '101130203',
  '白碱滩': '101130204', '乌尔禾': '101130205', '昌吉市': '101130302',
  '阜康': '101130303', '呼图壁': '101130304', '玛纳斯': '101130305',
  '奇台': '101130306', '吉木萨尔': '101130307', '木垒': '101130308',
  '伊宁': '101130402', '奎屯': '101130403', '尼勒克': '101130404',
  '伊宁县': '101130405', '霍城': '101130406', '巩留': '101130407',
  '新源': '101130408', '昭苏': '101130409', '特克斯': '101130410',
  '察布查尔': '101130411', '鄯善': '101130502', '托克逊': '101130503',
  '伊州': '101130602', '巴里坤': '101130603', '伊吾': '101130604',
  '塔城市': '101130702', '乌苏': '101130703', '额敏': '101130704',
  '沙湾': '101130705', '托里': '101130706', '裕民': '101130707',
  '和布克赛尔': '101130708', '博乐': '101130802', '精河': '101130803',
  '温泉': '101130804', '阿拉山口': '101130805', '库尔勒': '101130902',
  '轮台': '101130903', '尉犁': '101130904', '若羌': '101130905',
  '且末': '101130906', '焉耆': '101130907', '和静': '101130908',
  '和硕': '101130909', '博湖': '101130910', '阿克苏市': '101131002',
  '温宿': '101131003', '库车': '101131004', '沙雅': '101131005',
  '新和': '101131006', '拜城': '101131007', '乌什': '101131008',
  '阿瓦提': '101131009', '柯坪': '101131010', '阿图什': '101131102',
  '阿克陶': '101131103', '阿合奇': '101131104', '乌恰': '101131105',
  '喀什市': '101131202', '疏附': '101131203', '疏勒': '101131204',
  '英吉沙': '101131205', '泽普': '101131206', '莎车': '101131207',
  '叶城': '101131208', '麦盖提': '101131209', '岳普湖': '101131210',
  '伽师': '101131211', '巴楚': '101131212', '塔什库尔干': '101131213',
  '和田市': '101131302', '和田县': '101131303', '墨玉': '101131304',
  '皮山': '101131305', '洛浦': '101131306', '策勒': '101131307',
  '于田': '101131308', '民丰': '101131309', '阿勒泰市': '101131402',
  '布尔津': '101131403', '富蕴': '101131404', '福海': '101131405',
  '哈巴河': '101131406', '青河': '101131407', '吉木乃': '101131408',
  
  // ==================== 港澳台 ====================
  // 香港
  '香港': '101320101', 'hongkong': '101320101', 'hong kong': '101320101', 'hk': '101320101',
  '香港九龙': '101320102', '新界': '101320103', '中西区': '101320104',
  '湾仔': '101320105', '东区': '101320106', '南区': '101320107',
  '油尖旺': '101320108', '深水埗': '101320109', '九龙城': '101320110',
  '黄大仙': '101320111', '观塘': '101320112', '荃湾': '101320113',
  '屯门': '101320114', '元朗': '101320115', '北区': '101320116',
  '香港大埔': '101320117', '西贡': '101320118', '沙田': '101320119',
  '葵青': '101320120', '离岛': '101320121',
  // 澳门
  '澳门': '101330101', 'macau': '101330101', 'macao': '101330101',
  '氹仔': '101330102', '路环': '101330103',
  // 台湾
  '台北': '101340101', 'taipei': '101340101',
  '高雄': '101340201', 'kaohsiung': '101340201',
  '台中': '101340401', 'taichung': '101340401',
  '台南': '101340301', 'tainan': '101340301',
  '新北': '101340102', '桃园': '101340402', '基隆': '101340501',
  '新竹': '101340601', '嘉义': '101340701', '彰化': '101340801',
  '南投': '101340901', '云林': '101341001', '屏东': '101341101',
  '宜兰': '101341201', '花莲': '101341301', '台东': '101341401',
  '澎湖': '101341501', '金门': '101341601', '马祖': '101341701',
  '苗栗': '101340602', '新竹县': '101340603', '嘉义县': '101340702',
};

// 国际城市使用 wttr.in 作为备选（小米天气主要支持中国城市）
const INTERNATIONAL_CITIES = [
  'los angeles', 'la', 'new york', 'nyc', 'san francisco', 'sf',
  'seattle', 'tokyo', 'london', 'paris', 'singapore', 'sydney',
  'toronto', 'vancouver', 'berlin', 'dubai', 'bangkok', 'seoul',
  '洛杉矶', '纽约', '旧金山', '西雅图', '东京', '伦敦', '巴黎',
  '新加坡', '悉尼', '多伦多', '温哥华', '柏林', '迪拜', '曼谷', '首尔'
];


async function handleWeather(request, env) {
  const url = new URL(request.url);
  const city = url.searchParams.get('city') || CONFIG.DEFAULT_CITY;
  const weather = await fetchWeather(env, city);
  return jsonResponse(weather);
}

async function fetchWeather(env, city) {
  const cityLower = city.toLowerCase().trim();
  
  const isInternational = INTERNATIONAL_CITIES.some(c => 
    cityLower.includes(c) || c.includes(cityLower)
  );
  
  if (!isInternational) {
    try {
      const xiaomiWeather = await fetchXiaomiWeather(city);
      if (xiaomiWeather) {
        return xiaomiWeather;
      }
    } catch (e) {
      console.error('Xiaomi Weather API error:', e);
    }
  }

  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      headers: { 'User-Agent': 'MyEdge-Portfolio' }
    });
    
    if (!res.ok) {
      throw new Error(`wttr.in returned ${res.status}`);
    }
    
    const data = await res.json();
    const current = data.current_condition?.[0];
    
    if (!current) {
      throw new Error('Invalid wttr.in response');
    }
    
    return {
      city: data.nearest_area?.[0]?.areaName?.[0]?.value || city,
      temp: parseInt(current.temp_C) || 22,
      feels: parseInt(current.FeelsLikeC) || 23,
      humidity: parseInt(current.humidity) || 50,
      wind: parseInt(current.windspeedKmph) || 10,
      desc: current.weatherDesc?.[0]?.value || '晴',
      icon: getWeatherEmojiFromWttr(parseInt(current.weatherCode)),
      source: 'wttr.in'
    };
  } catch (e) {
    console.error('wttr.in error:', e);
    
    return {
      city: city,
      temp: 22,
      feels: 23,
      humidity: 50,
      wind: 10,
      desc: '数据获取中',
      icon: '🌤️',
      source: 'fallback'
    };
  }
}

async function fetchXiaomiWeather(city) {
  const cityLower = city.toLowerCase().trim();
  const cityId = XIAOMI_CITY_IDS[cityLower] || XIAOMI_CITY_IDS[city.trim()];
  
  if (!cityId) {
    console.log(`City "${city}" not found in Xiaomi mapping, falling back to wttr.in`);
    return null;
  }

  const params = new URLSearchParams({
    latitude: '0',
    longitude: '0',
    locationKey: `weathercn:${cityId}`,
    days: '1',
    appKey: 'weather20151024',
    sign: 'zUFJoAR2ZVrDy1vF3D07',
    isGlobal: 'false',
    locale: 'zh_cn'
  });

  const apiUrl = `https://weatherapi.market.xiaomi.com/wtr-v3/weather/all?${params.toString()}`;

  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    }
  });

  if (!res.ok) {
    console.error('Xiaomi API response not ok:', res.status);
    return null;
  }

  const data = await res.json();
  
  if (!data || !data.current) {
    console.error('Invalid Xiaomi weather data structure:', JSON.stringify(data).substring(0, 200));
    return null;
  }

  const current = data.current;
  const weatherCode = parseInt(current.weather) || 0;
  
  return {
    city: city,
    temp: Math.round(parseFloat(current.temperature?.value || '22')),
    feels: Math.round(parseFloat(current.feelsLike?.value || current.temperature?.value || '22')),
    humidity: parseInt(current.humidity?.value || '50'),
    wind: Math.round(parseFloat(current.wind?.speed?.value || '10')),
    desc: getXiaomiWeatherDesc(weatherCode),
    icon: getXiaomiWeatherEmoji(weatherCode),
    aqi: data.aqi?.aqi || null,
    pm25: data.aqi?.pm25 || null,
    pm10: data.aqi?.pm10 || null,
    uvIndex: current.uvIndex || null,
    pressure: current.pressure?.value || null,
    visibility: current.visibility?.value || null,
    pubTime: current.pubTime || null,
    source: 'xiaomi'
  };
}

function getXiaomiWeatherDesc(weatherCode) {
  const descMap = {
    0: '晴', 1: '多云', 2: '阴', 3: '阵雨', 4: '雷阵雨',
    5: '雷阵雨并伴有冰雹', 6: '雨夹雪', 7: '小雨', 8: '中雨',
    9: '大雨', 10: '暴雨', 11: '大暴雨', 12: '特大暴雨',
    13: '阵雪', 14: '小雪', 15: '中雪', 16: '大雪', 17: '暴雪',
    18: '雾', 19: '冻雨', 20: '沙尘暴', 21: '小雨-中雨',
    22: '中雨-大雨', 23: '大雨-暴雨', 24: '暴雨-大暴雨',
    25: '大暴雨-特大暴雨', 26: '小雪-中雪', 27: '中雪-大雪',
    28: '大雪-暴雪', 29: '浮沉', 30: '扬沙', 31: '强沙尘暴',
    32: '飑', 33: '龙卷风', 34: '若高吹雪', 35: '轻雾', 53: '霾', 99: '未知'
  };
  return descMap[weatherCode] || '未知';
}

function getXiaomiWeatherEmoji(weatherCode) {
  const code = parseInt(weatherCode) || 0;
  if (code === 0) return '☀️';
  if (code === 1) return '⛅';
  if (code === 2) return '☁️';
  if (code === 3 || code === 21) return '🌦️';
  if (code === 4 || code === 5) return '⛈️';
  if (code === 6 || code === 19) return '🌨️';
  if (code >= 7 && code <= 12) return '🌧️';
  if (code >= 22 && code <= 25) return '🌧️';
  if (code === 13) return '🌨️';
  if (code >= 14 && code <= 17) return '❄️';
  if (code >= 26 && code <= 28) return '❄️';
  if (code === 34) return '❄️';
  if (code === 18 || code === 35) return '🌫️';
  if (code === 20 || code === 29 || code === 30 || code === 31) return '🏜️';
  if (code === 32 || code === 33) return '🌪️';
  if (code === 53) return '😷';
  if (code === 99) return '❓';
  return '🌤️';
}

function getWeatherEmojiFromWttr(weatherCode) {
  if (weatherCode === 113) return '☀️';
  if (weatherCode === 116) return '⛅';
  if (weatherCode === 119 || weatherCode === 122) return '☁️';
  if ([143, 248, 260].includes(weatherCode)) return '🌫️';
  if ([176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 317, 320, 353, 356, 359, 362, 365].includes(weatherCode)) return '🌧️';
  if ([179, 182, 185, 227, 230, 323, 326, 329, 332, 335, 338, 350, 368, 371, 374, 377].includes(weatherCode)) return '❄️';
  if ([200, 386, 389, 392, 395].includes(weatherCode)) return '⛈️';
  return '🌤️';
}

// ==================== GitHub API ====================
async function fetchGitHubData(username, env) {
  const headers = {
    'User-Agent': 'MyEdge-Portfolio',
    'Accept': 'application/vnd.github.v3+json'
  };
  
  if (env?.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${env.GITHUB_TOKEN}`;
  }

  try {
    const [userRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`, { headers }),
      fetch(`https://api.github.com/users/${username}/repos?sort=stars&per_page=10`, { headers })
    ]);

    const rateLimitRemaining = userRes.headers.get('X-RateLimit-Remaining');
    const rateLimitReset = userRes.headers.get('X-RateLimit-Reset');
    
    if (userRes.status === 403) {
      const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toLocaleTimeString() : '未知';
      throw new Error(`GitHub API 速率限制，请稍后重试（重置时间: ${resetTime}）。建议配置 GITHUB_TOKEN 以提高限制。`);
    }

    if (userRes.status === 404) {
      throw new Error(`GitHub 用户 "${username}" 不存在`);
    }

    if (!userRes.ok) {
      throw new Error(`GitHub API 错误: ${userRes.status}`);
    }

    const user = await userRes.json();
    const repos = await reposRes.json();

    console.log(`GitHub API 剩余配额: ${rateLimitRemaining}`);

    return { user, repos };
  } catch (error) {
    if (error.message.includes('速率限制') || error.message.includes('不存在')) {
      throw error;
    }
    throw new Error(`GitHub API 请求失败: ${error.message}`);
  }
}

// ==================== AI 内容生成 ====================
async function generateAllAIContent(env, githubData, userBio, interests) {
  const { user, repos } = githubData;
  const skills = extractSkills(repos);

  console.log('Checking AI binding...');
  console.log('env.AI exists:', !!env.AI);
  console.log('env.AI type:', typeof env.AI);
  
  if (!env.AI) {
    console.error('AI binding not found in env. Available bindings:', Object.keys(env));
    throw new Error('Workers AI is required. Please ensure: 1) AI binding is configured in wrangler.toml with [ai] section, 2) Your Cloudflare account has Workers AI enabled, 3) You have redeployed after adding the binding.');
  }

  try {
    console.log('Testing AI binding...');
    
    const [bio, projectDescriptions, quote] = await Promise.all([
      generateAIBio(env.AI, user, userBio, repos),
      generateAIProjectDescriptions(env.AI, repos),
      generateAIQuote(env.AI, user, interests, skills)
    ]);

    return { bio, projectDescriptions, quote, skills };
  } catch (error) {
    console.error('AI generation error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    if (error.message.includes('model')) {
      throw new Error('AI model error: ' + error.message + '. Please check if the model name is correct.');
    }
    if (error.message.includes('binding')) {
      throw new Error('AI binding error: ' + error.message + '. Please verify your wrangler.toml configuration.');
    }
    throw new Error('AI content generation failed: ' + error.message);
  }
}

async function generateAIBio(ai, user, userBio, repos) {
  const ownRepos = repos.filter(r => !r.fork);
  const topLanguages = extractSkills(ownRepos).slice(0, 3).join('、');
  const topRepos = ownRepos.slice(0, 3).map(r => r.name).join('、');
  
  const prompt = `请为一位开发者创作个人简介（80-120字），直接以"我"开头，第一人称。

开发者信息：
- 名字：${user.name || user.login}
- 身份：${user.company || '独立开发者'}
- 原创项目：${ownRepos.length} 个
- 粉丝：${user.followers} 人
- 技术栈：${topLanguages || '全栈开发'}
- 代表作：${topRepos || '开源项目'}
${user.bio ? '- 个人说明：' + user.bio : ''}
${userBio ? '- 补充：' + userBio : ''}

严格要求：
1. 直接以"我"字开头写简介
2. 禁止出现：昵称、用户名、"作为"、"是一名"、"以下是"、"根据"等词
3. 自然融入技术和成就
4. 只输出简介内容，无任何解释`;

  const response = await ai.run('@cf/meta/llama-3-8b-instruct', {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300
  });

  let result = response.response?.trim() || '';
  
  result = result
    .replace(/^(以下是|这是|根据|基于|好的|当然|没问题).*?[：:。\n]/gi, '')
    .replace(/^(作为|身为)[^，,。]*?[，,]/gi, '')
    .replace(/^我是一[名位个][^，,。]*?[，,]/gi, '')
    .replace(/^[^我]*?(我)/i, '我')
    .replace(/昵称[^，,。]*?[，,。]/gi, '')
    .replace(/用户名[^，,。]*?[，,。]/gi, '')
    .replace(/名字叫[^，,。]*?[，,。]/gi, '')
    .replace(/名为[^，,。]*?[，,。]/gi, '')
    .replace(/叫做[^，,。]*?[，,。]/gi, '')
    .trim();
  
  if (!result.startsWith('我')) {
    result = '我' + result;
  }
  
  return result || `我专注于 ${topLanguages || '技术'} 领域，在 GitHub 上持续分享开源项目和技术实践，热爱用代码创造价值。`;
}

async function generateAIProjectDescriptions(ai, repos) {
  const descriptions = {};
  const ownRepos = repos.filter(r => !r.fork).slice(0, 6);
  
  for (const repo of ownRepos) {
    const prompt = `作为技术文案专家，为这个 GitHub 项目写一句独特的亮点描述（25-50字），要突出其技术价值和创新点，不要使用套话。

项目信息：
- 名称：${repo.name}
- 语言：${repo.language || '多语言'}
- Star：${repo.stargazers_count}
- Fork：${repo.forks_count}
- 描述：${repo.description || '无描述'}
- 主题：${repo.topics?.join(', ') || '无'}

要求：
1. 描述要具体，突出项目特色
2. 可以用 emoji 开头
3. 使用中文
4. 直接输出描述，不要有引号或额外标点`;

    try {
      const response = await ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100
      });
      descriptions[repo.name] = response.response?.trim() || `⭐ ${repo.description || '优质开源项目'}`;
    } catch (e) {
      console.error(`Project desc error for ${repo.name}:`, e);
      descriptions[repo.name] = `⭐ ${repo.description || '优质开源项目'}`;
    }
  }

  return descriptions;
}

async function generateAIQuote(ai, user, interests, skills) {
  const context = interests?.length > 0 ? interests.join('、') : (skills?.length > 0 ? skills.slice(0, 2).join('、') : '技术');
  
  const prompt = `作为一位智慧导师，为这位 ${context} 领域的开发者 ${user.name || user.login} 创作一句独特的励志名言或智慧语录。

要求：
1. 内容要与 ${context} 领域相关
2. 要有深度和启发性，不要陈词滥调
3. 30-60字
4. 可以是原创格言，也可以化用经典
5. 格式严格为："名言内容" —— 来源
6. 使用中文
7. 直接输出，不要有额外说明

示例格式：
"代码如诗，每一行都在诉说创造的故事。" —— 技术哲思`;

  try {
    const response = await ai.run('@cf/meta/llama-3-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150
    });

    const text = response.response?.trim() || '';
    const match = text.match(/[""「](.+?)[""」].*[——\-—]+\s*(.+)/);
    if (match) {
      return { text: match[1].trim(), author: match[2].trim() };
    }
    
    const parts = text.split(/[——\-—]+/);
    if (parts.length >= 2) {
      return { 
        text: parts[0].replace(/["""「」]/g, '').trim(), 
        author: parts[1].trim() 
      };
    }

    return { text: text.replace(/["""「」]/g, '').substring(0, 60), author: 'AI 智慧' };
  } catch (error) {
    console.error('Quote generation error:', error);
    throw error;
  }
}

function extractSkills(repos) {
  const languageCount = {};
  repos.forEach(repo => {
    if (repo.language) {
      languageCount[repo.language] = (languageCount[repo.language] || 0) + 1;
    }
  });
  return Object.entries(languageCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([lang]) => lang);
}

function getDefaultBookmarks() {
  return [
    { id: '1', name: 'Google', url: 'https://google.com', icon: '🔍', order: 0 },
    { id: '2', name: 'GitHub', url: 'https://github.com', icon: '🐙', order: 1 },
    { id: '3', name: 'Twitter', url: 'https://twitter.com', icon: '🐦', order: 2 },
    { id: '4', name: 'YouTube', url: 'https://youtube.com', icon: '📺', order: 3 }
  ];
}

// ==================== 图像生成 & R2 存储 ====================
// 生成背景图和社交卡片图
async function generateAndStoreImages(env, username, user, skills, bio) {
  const results = {
    backgroundUrl: null,
    cardImageUrl: null
  };

  const skillContext = skills.slice(0, 3).join(', ') || 'technology';
  
  try {
    // 1. 生成个性化背景图（页面背景）
    const backgroundPrompt = `Create a stunning, modern abstract technology background. Theme: ${skillContext} development. Style: dark gradient with glowing geometric patterns, circuit-like lines, floating particles, deep purple and blue tones, futuristic, professional. Perfect for a developer portfolio. High quality, 4K feel, no text.`;

    const backgroundResponse = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0', {
      prompt: backgroundPrompt,
      width: 1920,
      height: 1080
    });

    const bgKey = `backgrounds/${username}-bg-${Date.now()}.png`;
    await env.R2_BUCKET.put(bgKey, backgroundResponse, {
      httpMetadata: { contentType: 'image/png' }
    });
    results.backgroundUrl = `/assets/${bgKey}`;

    // 2. 生成社交卡片图（1200x630 用于 OG 预览）
    const displayName = user?.name || username;
    const shortBio = (bio || '').substring(0, 50);
    
    const cardPrompt = `Create a professional social media card image for a developer named "${displayName}". Theme: ${skillContext}. Style: modern gradient background (purple to blue), abstract tech patterns, geometric shapes, professional and clean. The image should work well as an Open Graph preview card. No text, just visual design. Size optimized for 1200x630.`;

    const cardResponse = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0', {
      prompt: cardPrompt,
      width: 1200,
      height: 630
    });

    const cardKey = `cards/${username}-card-${Date.now()}.png`;
    await env.R2_BUCKET.put(cardKey, cardResponse, {
      httpMetadata: { contentType: 'image/png' }
    });
    results.cardImageUrl = `/assets/${cardKey}`;

  } catch (e) {
    console.error('Image generation error:', e);
    // 如果图像生成失败，使用头像作为备用
    if (user?.avatar_url) {
      results.cardImageUrl = user.avatar_url;
    }
  }

  return results;
}

async function serveR2Asset(env, path) {
  const key = path.replace('/assets/', '');
  
  if (!env.R2_BUCKET) {
    return new Response('R2 not configured', { status: 404 });
  }

  const object = await env.R2_BUCKET.get(key);
  
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=604800');

  return new Response(object.body, { headers });
}

// ==================== 专属页面处理 ====================
async function handlePortfolioPage(request, env, path) {
  let slug;
  if (path.startsWith('/p/')) {
    slug = path.replace('/p/', '');
  } else if (path.startsWith('/@')) {
    slug = path.replace('/@', '');
  }

  if (!slug) {
    return new Response('Invalid URL', { status: 400 });
  }

  const username = slug.split('-')[0];
  
  const doId = env.USER_DO.idFromName(username.toLowerCase());
  const doStub = env.USER_DO.get(doId);

  const res = await doStub.fetch(new Request('http://do/get'));
  const result = await res.json();

  if (!result.exists) {
    return serveNotFoundPage();
  }

  const userData = result.data;

  if (userData.slug !== slug && username !== slug) {
    return serveNotFoundPage();
  }

  // 检测社交爬虫 - 关键逻辑
  const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
  const isBot = CONFIG.SOCIAL_BOTS.some(bot => userAgent.includes(bot));

  // 如果是社交爬虫，返回轻量级 HTML（只有 meta 标签）
  if (isBot) {
    return serveSocialPreviewPage(userData, request);
  }

  // 正常用户访问，更新动态内容
  const now = Date.now();
  let updates = {};

  if (!userData.cachedWeather || now - userData.timestamps.weatherUpdated > CONFIG.CACHE_TTL_WEATHER) {
    updates.cachedWeather = await fetchWeather(env, userData.city);
    updates.timestamps = { ...updates.timestamps, weatherUpdated: now };
  }

  if (!userData.cachedNews || now - userData.timestamps.newsUpdated > CONFIG.CACHE_TTL_NEWS) {
    updates.cachedNews = await fetchRealNews(userData.interests);
    updates.timestamps = { ...updates.timestamps, newsUpdated: now };
  }

  if (Object.keys(updates).length > 0) {
    await doStub.fetch(new Request('http://do/update', {
      method: 'POST',
      body: JSON.stringify(updates)
    }));
    Object.assign(userData, updates);
  }

  return servePortfolioPage(userData, request);
}

// ==================== 页面渲染 ====================

function serveEntryPage() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyEdge Portfolio - AI 专属首页</title>
  <meta name="description" content="使用 AI 生成您的专属个人品牌页面和智能仪表盘">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Inter', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%); }
    .glass { background: rgba(255,255,255,0.1); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.2); }
    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
    .float-animation { animation: float 3s ease-in-out infinite; }
    @keyframes pulse-glow { 0%,100%{box-shadow:0 0 20px rgba(102,126,234,0.5)} 50%{box-shadow:0 0 40px rgba(102,126,234,0.8)} }
    .pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
  </style>
</head>
<body class="min-h-screen gradient-bg flex items-center justify-center p-4">
  <div class="glass rounded-3xl p-8 md:p-12 max-w-2xl w-full text-white">
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/20 mb-6 float-animation">
        <svg class="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      </div>
      <h1 class="text-4xl md:text-5xl font-bold mb-4">MyEdge Portfolio</h1>
      <p class="text-lg text-white/80">AI 驱动的个人品牌 × 智能首页</p>
    </div>

    <form id="generate-form" class="space-y-6">
      <div>
        <label class="block text-sm font-medium mb-2">GitHub 用户名 *</label>
        <div class="relative">
          <span class="absolute left-4 top-1/2 -translate-y-1/2 text-white/50">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </span>
          <input type="text" id="github-username" required placeholder="例如: octocat" 
            class="w-full pl-12 pr-4 py-4 bg-white/10 border border-white/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/50 placeholder-white/40">
        </div>
      </div>

      <div class="bg-white/5 rounded-xl p-4 flex items-center gap-3">
        <span class="text-2xl">📍</span>
        <div>
          <p class="text-sm text-white/60">天气将基于您的位置自动获取</p>
          <p id="detected-location" class="text-white font-medium">检测中...</p>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium mb-2">兴趣领域（用于新闻推荐）</label>
        <div class="flex flex-wrap gap-2" id="interests-container">
          <button type="button" data-interest="AI" class="interest-btn px-4 py-2 rounded-full border border-white/30 hover:bg-white/20 transition">🤖 AI</button>
          <button type="button" data-interest="Tech" class="interest-btn px-4 py-2 rounded-full border border-white/30 hover:bg-white/20 transition">💻 科技</button>
          <button type="button" data-interest="Startup" class="interest-btn px-4 py-2 rounded-full border border-white/30 hover:bg-white/20 transition">🚀 创业</button>
          <button type="button" data-interest="Design" class="interest-btn px-4 py-2 rounded-full border border-white/30 hover:bg-white/20 transition">🎨 设计</button>
          <button type="button" data-interest="Finance" class="interest-btn px-4 py-2 rounded-full border border-white/30 hover:bg-white/20 transition">📈 金融</button>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium mb-2">个人简介（可选，AI 会参考并优化）</label>
        <textarea id="bio-input" rows="3" placeholder="简单描述你自己，AI 会帮你润色..." 
          class="w-full px-4 py-4 bg-white/10 border border-white/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/50 placeholder-white/40 resize-none"></textarea>
      </div>

      <button type="submit" id="generate-btn" 
        class="w-full py-4 bg-white text-purple-600 font-bold rounded-xl hover:bg-white/90 transition transform hover:scale-[1.02] pulse-glow">
        ✨ 生成我的专属页面
      </button>

      <div id="loading" class="hidden text-center py-8">
        <div class="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
        <p id="loading-text" class="text-white/80">🤖 AI 正在生成您的专属内容...</p>
        <p class="text-white/60 text-sm mt-2">这可能需要 10-30 秒（包含背景图生成）</p>
      </div>

      <div id="error" class="hidden mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-center">
        <p id="error-text" class="text-red-200"></p>
      </div>

      <div id="result" class="hidden mt-6 p-4 bg-white/10 rounded-xl">
        <p class="text-center mb-3">🎉 您的专属页面已生成！</p>
        <div class="flex gap-2">
          <input type="text" id="result-url" readonly class="flex-1 px-4 py-3 bg-white/10 rounded-lg text-sm">
          <button type="button" id="copy-btn" class="px-4 py-3 bg-white text-purple-600 rounded-lg font-medium hover:bg-white/90 transition">复制</button>
          <a id="visit-btn" href="#" class="px-4 py-3 bg-purple-500 text-white rounded-lg font-medium hover:bg-purple-600 transition">访问</a>
        </div>
      </div>
    </form>

    <p class="text-center text-white/60 text-sm mt-6">
      已有页面？输入相同用户名即可读取和编辑
    </p>
  </div>

  <script>
    let selectedInterests = [];

    document.querySelectorAll('.interest-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('bg-white/30');
        const interest = btn.dataset.interest;
        const idx = selectedInterests.indexOf(interest);
        if (idx > -1) selectedInterests.splice(idx, 1);
        else selectedInterests.push(interest);
      });
    });

    async function fetchGitHubDataFromClient(username) {
      const [userRes, reposRes] = await Promise.all([
        fetch('https://api.github.com/users/' + encodeURIComponent(username), {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        }),
        fetch('https://api.github.com/users/' + encodeURIComponent(username) + '/repos?sort=stars&per_page=30', {
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        })
      ]);

      const rateLimitRemaining = userRes.headers.get('X-RateLimit-Remaining');
      const rateLimitReset = userRes.headers.get('X-RateLimit-Reset');

      if (userRes.status === 403) {
        const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toLocaleTimeString() : '未知';
        throw new Error('GitHub API 速率限制（60次/小时），请稍后重试。重置时间: ' + resetTime);
      }

      if (userRes.status === 404) {
        throw new Error('GitHub 用户 "' + username + '" 不存在');
      }

      if (!userRes.ok) {
        throw new Error('GitHub API 错误: ' + userRes.status);
      }

      const user = await userRes.json();
      let repos = await reposRes.json();
      repos = repos.filter(repo => !repo.fork);

      console.log('GitHub API 剩余配额:', rateLimitRemaining);
      console.log('原创项目数量:', repos.length);

      return { user, repos };
    }

    document.getElementById('generate-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('github-username').value.trim();
      const userBio = document.getElementById('bio-input').value.trim();

      if (!username) return;

      document.getElementById('generate-btn').classList.add('hidden');
      document.getElementById('loading').classList.remove('hidden');
      document.getElementById('loading-text').textContent = '🔍 正在获取 GitHub 数据...';
      document.getElementById('result').classList.add('hidden');
      document.getElementById('error').classList.add('hidden');

      try {
        const githubData = await fetchGitHubDataFromClient(username);
        
        document.getElementById('loading-text').textContent = '🤖 AI 正在生成内容和背景图...';

        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            username, 
            interests: selectedInterests, 
            userBio,
            githubData
          })
        });

        const data = await res.json();

        if (data.error) {
          throw new Error(data.error);
        }

        const baseUrl = window.location.origin;
        const url = baseUrl + '/p/' + data.slug;
        document.getElementById('result-url').value = url;
        document.getElementById('visit-btn').href = '/p/' + data.slug;
        document.getElementById('result').classList.remove('hidden');

      } catch (err) {
        document.getElementById('error-text').textContent = err.message;
        document.getElementById('error').classList.remove('hidden');
      } finally {
        document.getElementById('generate-btn').classList.remove('hidden');
        document.getElementById('loading').classList.add('hidden');
      }
    });

    document.getElementById('copy-btn').addEventListener('click', () => {
      const input = document.getElementById('result-url');
      input.select();
      document.execCommand('copy');
      document.getElementById('copy-btn').textContent = '已复制!';
      setTimeout(() => document.getElementById('copy-btn').textContent = '复制', 2000);
    });

    (async function detectLocation() {
      try {
        const res = await fetch('/api/location');
        const data = await res.json();
        document.getElementById('detected-location').textContent = data.cityDisplay + ', ' + data.country;
      } catch (e) {
        document.getElementById('detected-location').textContent = '位置获取失败，将使用默认位置';
      }
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

function servePortfolioPage(data, request) {
  // 获取当前域名用于构建完整 URL
  const url = new URL(request?.url || 'https://example.com');
  const baseUrl = `${url.protocol}//${url.host}`;
  
  // 构建社交预览图 URL
  const ogImage = data.aiCardImageUrl 
    ? (data.aiCardImageUrl.startsWith('http') ? data.aiCardImageUrl : baseUrl + data.aiCardImageUrl)
    : data.github?.avatar_url || '';
  
  // 构建背景图 URL
  const backgroundImage = data.aiBackgroundUrl 
    ? (data.aiBackgroundUrl.startsWith('http') ? data.aiBackgroundUrl : baseUrl + data.aiBackgroundUrl)
    : '';

  // 生成 OG 标题（bio 前 60 字或默认标题）
  const ogTitle = data.aiBio 
    ? data.aiBio.substring(0, 60) + (data.aiBio.length > 60 ? '...' : '')
    : `${data.github?.name || data.username} 的 AI 作品集`;

  // 生成 OG 描述（项目亮点 + 简介）
  const topProjects = (data.repos || []).filter(r => !r.fork).slice(0, 3).map(r => r.name).join('、');
  const ogDescription = topProjects 
    ? `精选项目：${topProjects}。${(data.aiBio || '').substring(0, 100)}`
    : (data.aiBio || '').substring(0, 200);

  const newsHtml = (data.cachedNews || []).map(item => `
    <a href="${item.url}" target="_blank" class="block p-3 rounded-xl hover:bg-white/10 transition group">
      <h4 class="font-medium text-sm group-hover:text-purple-300 transition">${item.title}</h4>
      <div class="flex items-center gap-2 mt-1 text-xs text-white/50">
        <span class="text-purple-300">${item.source}</span>
        <span>•</span>
        <span>${item.time}</span>
        ${item.score ? `<span>• ⬆️ ${item.score}</span>` : ''}
        ${item.reactions ? `<span>• ❤️ ${item.reactions}</span>` : ''}
      </div>
    </a>
  `).join('');

  // 书签按 order 排序
  const sortedBookmarks = (data.bookmarks || []).sort((a, b) => (a.order || 0) - (b.order || 0));

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.github?.name || data.username} - MyEdge Portfolio</title>
  <meta name="description" content="${(data.aiBio || '').substring(0, 160)}">
  
  <!-- Open Graph 优化 -->
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:type" content="profile">
  <meta property="og:url" content="${baseUrl}/p/${data.slug}">
  <meta property="og:site_name" content="MyEdge Portfolio">
  
  <!-- Twitter Card 优化 -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image" content="${ogImage}">
  ${data.github?.twitter_username ? `<meta name="twitter:creator" content="@${data.github.twitter_username}">` : ''}
  <meta name="twitter:site" content="@MyEdgePortfolio">

  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Inter', sans-serif; }
    .gradient-bg { 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%); 
    }
    .has-bg-image {
      background-size: cover;
      background-position: center;
      background-attachment: fixed;
    }
    .has-bg-image::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.85) 0%, rgba(118, 75, 162, 0.85) 50%, rgba(240, 147, 251, 0.85) 100%);
      z-index: -1;
    }
    .glass { background: rgba(255,255,255,0.1); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.2); }
    .dark .glass { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); }
    .card-hover:hover { transform: translateY(-4px); box-shadow: 0 20px 40px rgba(0,0,0,0.2); }
    .skill-tag { background: linear-gradient(135deg, rgba(102,126,234,0.2), rgba(118,75,162,0.2)); border: 1px solid rgba(102,126,234,0.3); }
    .news-scroll::-webkit-scrollbar { width: 4px; }
    .news-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }
    .bookmark-item { cursor: pointer; user-select: none; }
    .bookmark-item.dragging { opacity: 0.5; }
    .bookmark-item.drag-over { border: 2px dashed rgba(255,255,255,0.5); }
    .edit-mode .bookmark-item { animation: shake 0.3s ease-in-out infinite; }
    @keyframes shake {
      0%, 100% { transform: rotate(-1deg); }
      50% { transform: rotate(1deg); }
    }
    .edit-mode .bookmark-delete { display: flex !important; }
    .bookmark-delete { display: none; }
  </style>
</head>
<body class="min-h-screen ${backgroundImage ? 'has-bg-image' : 'gradient-bg'} transition-colors duration-500" ${backgroundImage ? `style="background-image: url('${backgroundImage}')"` : ''}>
  <!-- 导航栏 -->
  <nav class="fixed top-0 left-0 right-0 z-50 glass">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <img class="w-10 h-10 rounded-full border-2 border-white/30" src="${data.github?.avatar_url || ''}" alt="">
        <span class="font-semibold text-white">${data.github?.name || data.username}</span>
      </div>
      <div class="flex items-center gap-3">
        <button id="refresh-btn" class="p-2 rounded-lg hover:bg-white/10 transition text-white" title="刷新所有内容（包括重新生成背景图）">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
        </button>
        <button id="dark-mode-btn" class="p-2 rounded-lg hover:bg-white/10 transition text-white" title="深色模式">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>
        <button id="share-btn" class="px-4 py-2 bg-white/20 rounded-lg hover:bg-white/30 transition text-white text-sm font-medium">
          📤 分享
        </button>
      </div>
    </div>
  </nav>

  <!-- Hero 区域 -->
  <section class="pt-24 pb-16 px-4 relative overflow-hidden">
    <div class="max-w-4xl mx-auto text-center relative z-10">
      <img class="w-32 h-32 rounded-full border-4 border-white/50 mx-auto mb-6 shadow-2xl" src="${data.github?.avatar_url || ''}" alt="">
      <h1 class="text-4xl md:text-5xl font-bold text-white mb-4">${data.github?.name || data.username}</h1>
      <p class="text-lg text-white/80 max-w-2xl mx-auto leading-relaxed">${data.aiBio || ''}</p>
      
      <div class="flex flex-wrap justify-center gap-2 mt-6">
        ${(data.skills || []).map(skill => `<span class="skill-tag px-4 py-2 rounded-full text-sm font-medium text-white">${skill}</span>`).join('')}
      </div>
      
      <div class="flex justify-center gap-4 mt-8">
        <a href="${data.github?.html_url || '#'}" target="_blank" class="p-3 glass rounded-full hover:bg-white/20 transition text-white">
          <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </a>
        ${data.github?.blog ? `<a href="${data.github.blog.startsWith('http') ? data.github.blog : 'https://' + data.github.blog}" target="_blank" class="p-3 glass rounded-full hover:bg-white/20 transition text-white">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
          </svg>
        </a>` : ''}
        ${data.github?.twitter_username ? `<a href="https://twitter.com/${data.github.twitter_username}" target="_blank" class="p-3 glass rounded-full hover:bg-white/20 transition text-white">
          <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>` : ''}
      </div>
    </div>
  </section>

  <!-- 主内容 -->
  <main class="max-w-7xl mx-auto px-4 pb-16">
    <div class="grid lg:grid-cols-3 gap-6">
      <!-- 左侧仪表盘 -->
      <div class="lg:col-span-1 space-y-6">
        <!-- 天气 -->
        <div class="glass rounded-2xl p-6 text-white card-hover transition-all duration-300">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold">🌤️ 天气</h3>
            <span class="text-sm text-white/60">${data.cachedWeather?.city || data.city || 'Los Angeles'}</span>
          </div>
          <div class="flex items-center gap-4">
            <span class="text-5xl">${data.cachedWeather?.icon || '☀️'}</span>
            <div>
              <div class="text-4xl font-bold">${data.cachedWeather?.temp || 22}°C</div>
              <div class="text-white/70">${data.cachedWeather?.desc || '晴朗'}</div>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 mt-4 text-center text-sm">
            <div class="bg-white/10 rounded-lg p-2">
              <div class="text-white/60">湿度</div>
              <div class="font-semibold">${data.cachedWeather?.humidity || 50}%</div>
            </div>
            <div class="bg-white/10 rounded-lg p-2">
              <div class="text-white/60">风速</div>
              <div class="font-semibold">${data.cachedWeather?.wind || 10} km/h</div>
            </div>
            <div class="bg-white/10 rounded-lg p-2">
              <div class="text-white/60">体感</div>
              <div class="font-semibold">${data.cachedWeather?.feels || 23}°C</div>
            </div>
          </div>
        </div>

        <!-- AI Quote -->
        <div class="glass rounded-2xl p-6 text-white card-hover transition-all duration-300">
          <h3 class="font-semibold mb-4">💡 今日灵感 <span class="text-xs text-white/50 font-normal">AI 生成</span></h3>
          <blockquote class="text-lg italic leading-relaxed">"${data.aiQuote?.text || '每一行代码都是通往未来的阶梯。'}"</blockquote>
          <p class="text-right text-white/60 mt-3 text-sm">— ${data.aiQuote?.author || 'AI 智慧'}</p>
        </div>

        <!-- 快捷链接（支持编辑模式和拖拽排序） -->
        <div class="glass rounded-2xl p-6 text-white card-hover transition-all duration-300">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold">🔗 快捷链接</h3>
            <button id="edit-links-btn" class="text-sm text-white/60 hover:text-white transition px-3 py-1 rounded-lg hover:bg-white/10">✏️ 编辑</button>
          </div>
          <p id="edit-hint" class="hidden text-xs text-white/40 mb-3">拖拽排序 | 点击删除 | 完成后点击保存</p>
          <div class="grid grid-cols-4 gap-3" id="bookmarks-container">
            ${sortedBookmarks.map((bm, idx) => `
              <div class="bookmark-item flex flex-col items-center p-2 bg-white/10 rounded-xl hover:bg-white/20 transition text-center relative" 
                   draggable="false"
                   data-id="${bm.id}" 
                   data-name="${bm.name}" 
                   data-url="${bm.url}" 
                   data-icon="${bm.icon}"
                   data-order="${bm.order || idx}">
                <button class="bookmark-delete absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full text-white text-xs items-center justify-center">×</button>
                <span class="text-2xl mb-1">${bm.icon}</span>
                <span class="text-xs truncate w-full">${bm.name}</span>
              </div>
            `).join('')}
          </div>
          <!-- 编辑模式下的操作按钮 -->
          <div id="edit-actions" class="hidden mt-4 space-y-2">
            <button id="add-bookmark-btn" class="w-full py-2 bg-white/10 rounded-lg hover:bg-white/20 transition text-sm">+ 添加新链接</button>
            <div class="flex gap-2">
              <button id="cancel-edit-btn" class="flex-1 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition text-sm">取消</button>
              <button id="save-bookmarks-btn" class="flex-1 py-2 bg-green-500/80 rounded-lg hover:bg-green-500 transition text-sm font-medium">💾 保存</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧项目和新闻 -->
      <div class="lg:col-span-2 space-y-6">
        <!-- 项目 -->
        <div class="glass rounded-2xl p-6 text-white">
          <h3 class="font-semibold mb-4">🚀 精选项目 <span class="text-xs text-white/50 font-normal">AI 描述</span></h3>
          <div class="grid md:grid-cols-2 gap-4">
            ${(data.repos || []).filter(r => !r.fork).slice(0, 6).map(repo => `
              <a href="${repo.html_url}" target="_blank" class="block bg-white/10 rounded-xl p-4 hover:bg-white/20 transition card-hover">
                <div class="flex items-start justify-between mb-2">
                  <h4 class="font-semibold truncate flex-1">${repo.name}</h4>
                  <span class="text-yellow-400 text-sm ml-2">⭐ ${repo.stargazers_count}</span>
                </div>
                <p class="text-sm text-white/70 line-clamp-2">${data.aiProjectDescriptions?.[repo.name] || repo.description || '优质项目'}</p>
                <div class="flex items-center gap-2 mt-3">
                  ${repo.language ? `<span class="text-xs bg-white/20 px-2 py-1 rounded">${repo.language}</span>` : ''}
                  <span class="text-xs text-white/50">🍴 ${repo.forks_count}</span>
                </div>
              </a>
            `).join('')}
          </div>
        </div>

        <!-- 真实新闻 -->
        <div class="glass rounded-2xl p-6 text-white">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold">📰 实时资讯</h3>
            <span class="text-sm text-white/60">${(data.interests || ['Tech']).join(' · ')}</span>
          </div>
          <div class="space-y-1 max-h-80 overflow-y-auto news-scroll">
            ${newsHtml || '<p class="text-white/50 text-center py-4">暂无新闻</p>'}
          </div>
          <p class="text-xs text-white/40 mt-3 text-center">数据来源: Hacker News, Dev.to, GitHub Trending</p>
        </div>

        <!-- GitHub 统计 -->
        <div class="glass rounded-2xl p-6 text-white">
          <h3 class="font-semibold mb-4">📊 GitHub 统计</h3>
          <div class="grid grid-cols-4 gap-4 text-center">
            <div class="bg-white/10 rounded-xl p-4">
              <div class="text-3xl font-bold text-green-400">${(data.repos || []).filter(r => !r.fork).length}</div>
              <div class="text-sm text-white/60">原创项目</div>
            </div>
            <div class="bg-white/10 rounded-xl p-4">
              <div class="text-3xl font-bold text-blue-400">${data.github?.followers || 0}</div>
              <div class="text-sm text-white/60">粉丝</div>
            </div>
            <div class="bg-white/10 rounded-xl p-4">
              <div class="text-3xl font-bold text-purple-400">${data.github?.following || 0}</div>
              <div class="text-sm text-white/60">关注</div>
            </div>
            <div class="bg-white/10 rounded-xl p-4">
              <div class="text-3xl font-bold text-yellow-400">${(data.repos || []).filter(r => !r.fork).reduce((s, r) => s + r.stargazers_count, 0)}</div>
              <div class="text-sm text-white/60">获星</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- 页脚 -->
  <footer class="glass py-6 text-center text-white/60 text-sm">
    <p>Powered by <span class="text-white font-semibold">MyEdge Portfolio</span> × Workers AI ✨</p>
    <p class="text-xs mt-1">所有内容由 AI 动态生成 | 背景图 AI 生成 | 新闻实时获取</p>
  </footer>

  <!-- 分享弹窗 -->
  <div id="share-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="glass rounded-2xl p-6 max-w-md w-full mx-4 text-white">
      <h3 class="text-xl font-bold mb-4">分享你的专属页面</h3>
      <div class="bg-white/10 rounded-xl p-4 flex items-center gap-3">
        <input type="text" id="share-url" readonly class="flex-1 bg-transparent focus:outline-none text-sm">
        <button id="copy-share" class="px-4 py-2 bg-white text-purple-600 rounded-lg text-sm font-medium">复制</button>
      </div>
      <p class="text-xs text-white/50 mt-3">分享到社交媒体时会显示精美预览卡片 ✨</p>
      <button id="close-share" class="w-full mt-4 py-3 bg-white/10 rounded-xl hover:bg-white/20 transition">关闭</button>
    </div>
  </div>

  <!-- 添加/编辑书签弹窗 -->
  <div id="bookmark-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="glass rounded-2xl p-6 max-w-md w-full mx-4 text-white">
      <h3 id="bookmark-modal-title" class="text-xl font-bold mb-4">添加快捷链接</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm mb-1">名称</label>
          <input type="text" id="bookmark-name" placeholder="例如: Google" class="w-full px-4 py-3 bg-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/30">
        </div>
        <div>
          <label class="block text-sm mb-1">URL</label>
          <input type="url" id="bookmark-url" placeholder="https://..." class="w-full px-4 py-3 bg-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/30">
        </div>
        <div>
          <label class="block text-sm mb-1">图标 (Emoji)</label>
          <input type="text" id="bookmark-icon" placeholder="🔗" maxlength="2" class="w-full px-4 py-3 bg-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/30">
        </div>
      </div>
      <div class="flex gap-3 mt-6">
        <button id="cancel-bookmark-modal" class="flex-1 py-3 bg-white/10 rounded-xl hover:bg-white/20">取消</button>
        <button id="confirm-bookmark-modal" class="flex-1 py-3 bg-white text-purple-600 font-semibold rounded-xl">确定</button>
      </div>
    </div>
  </div>

  <!-- 刷新提示 -->
  <div id="refresh-toast" class="hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-50 glass px-6 py-3 rounded-full text-white">
    <span class="flex items-center gap-2">
      <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
      <span id="refresh-toast-text">AI 正在重新生成内容...</span>
    </span>
  </div>

  <script>
    const username = '${data.username}';
    const slug = '${data.slug}';
    let isEditMode = false;
    let originalBookmarks = ${JSON.stringify(sortedBookmarks)};
    let currentBookmarks = JSON.parse(JSON.stringify(originalBookmarks));
    let draggedItem = null;
    
    // 设置分享链接
    document.getElementById('share-url').value = window.location.origin + '/p/' + slug;
    
    // 深色模式
    document.getElementById('dark-mode-btn').addEventListener('click', () => {
      document.body.classList.toggle('dark');
      if (document.body.classList.contains('dark')) {
        document.body.classList.remove('gradient-bg');
        document.body.classList.add('bg-gray-900');
      } else {
        document.body.classList.add('gradient-bg');
        document.body.classList.remove('bg-gray-900');
      }
    });

    // 前端获取 GitHub 数据
    async function fetchGitHubDataFromClient(user) {
      try {
        const [userRes, reposRes] = await Promise.all([
          fetch('https://api.github.com/users/' + encodeURIComponent(user)),
          fetch('https://api.github.com/users/' + encodeURIComponent(user) + '/repos?sort=stars&per_page=30')
        ]);
        if (!userRes.ok || !reposRes.ok) return null;
        const userData = await userRes.json();
        let repos = await reposRes.json();
        repos = repos.filter(r => !r.fork);
        return { user: userData, repos };
      } catch(e) { return null; }
    }

    // 刷新按钮
    document.getElementById('refresh-btn').addEventListener('click', async () => {
      const btn = document.getElementById('refresh-btn');
      const toast = document.getElementById('refresh-toast');
      const toastText = document.getElementById('refresh-toast-text');
      
      btn.classList.add('animate-spin');
      toast.classList.remove('hidden');
      toastText.textContent = 'AI 正在重新生成内容和背景图...';
      
      try {
        const githubData = await fetchGitHubDataFromClient(username);
        await fetch('/api/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, forceAll: true, githubData })
        });
        location.reload();
      } catch(e) { 
        console.error(e);
        toast.classList.add('hidden');
        btn.classList.remove('animate-spin');
      }
    });

    // 分享弹窗
    document.getElementById('share-btn').addEventListener('click', () => {
      document.getElementById('share-modal').classList.remove('hidden');
    });
    document.getElementById('close-share').addEventListener('click', () => {
      document.getElementById('share-modal').classList.add('hidden');
    });
    document.getElementById('copy-share').addEventListener('click', () => {
      document.getElementById('share-url').select();
      document.execCommand('copy');
      document.getElementById('copy-share').textContent = '已复制!';
      setTimeout(() => document.getElementById('copy-share').textContent = '复制', 2000);
    });

    // ========== 书签编辑模式 ==========
    const container = document.getElementById('bookmarks-container');
    const editBtn = document.getElementById('edit-links-btn');
    const editActions = document.getElementById('edit-actions');
    const editHint = document.getElementById('edit-hint');

    // 渲染书签
    function renderBookmarks() {
      container.innerHTML = currentBookmarks.map((bm, idx) => \`
        <div class="bookmark-item flex flex-col items-center p-2 bg-white/10 rounded-xl hover:bg-white/20 transition text-center relative" 
             draggable="\${isEditMode}"
             data-id="\${bm.id}" 
             data-name="\${bm.name}" 
             data-url="\${bm.url}" 
             data-icon="\${bm.icon}"
             data-index="\${idx}">
          <button class="bookmark-delete absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full text-white text-xs items-center justify-center">\u00d7</button>
          <span class="text-2xl mb-1">\${bm.icon}</span>
          <span class="text-xs truncate w-full">\${bm.name}</span>
        </div>
      \`).join('');
      
      bindBookmarkEvents();
    }

    // 绑定书签事件
    function bindBookmarkEvents() {
      const items = container.querySelectorAll('.bookmark-item');
      
      items.forEach(item => {
        // 点击事件
        item.addEventListener('click', (e) => {
          if (isEditMode) {
            // 编辑模式下，点击打开编辑弹窗
            if (!e.target.classList.contains('bookmark-delete')) {
              openBookmarkModal('edit', item.dataset);
            }
          } else {
            // 正常模式下打开链接
            window.open(item.dataset.url, '_blank');
          }
        });

        // 删除按钮
        item.querySelector('.bookmark-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          const id = item.dataset.id;
          currentBookmarks = currentBookmarks.filter(b => b.id !== id);
          renderBookmarks();
        });

        // 拖拽事件
        item.addEventListener('dragstart', (e) => {
          draggedItem = item;
          item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          draggedItem = null;
          container.querySelectorAll('.bookmark-item').forEach(i => i.classList.remove('drag-over'));
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (draggedItem && draggedItem !== item) {
            item.classList.add('drag-over');
          }
        });

        item.addEventListener('dragleave', () => {
          item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
          e.preventDefault();
          item.classList.remove('drag-over');
          
          if (draggedItem && draggedItem !== item) {
            const fromIndex = parseInt(draggedItem.dataset.index);
            const toIndex = parseInt(item.dataset.index);
            
            // 交换位置
            const [removed] = currentBookmarks.splice(fromIndex, 1);
            currentBookmarks.splice(toIndex, 0, removed);
            
            renderBookmarks();
          }
        });
      });
    }

    // 进入编辑模式
    editBtn.addEventListener('click', () => {
      if (isEditMode) {
        // 已经在编辑模式，点击退出
        exitEditMode();
      } else {
        // 进入编辑模式
        isEditMode = true;
        container.classList.add('edit-mode');
        editBtn.textContent = '❌ 取消';
        editActions.classList.remove('hidden');
        editHint.classList.remove('hidden');
        renderBookmarks();
      }
    });

    // 退出编辑模式（不保存）
    function exitEditMode() {
      isEditMode = false;
      container.classList.remove('edit-mode');
      editBtn.textContent = '✏️ 编辑';
      editActions.classList.add('hidden');
      editHint.classList.add('hidden');
      currentBookmarks = JSON.parse(JSON.stringify(originalBookmarks));
      renderBookmarks();
    }

    document.getElementById('cancel-edit-btn').addEventListener('click', exitEditMode);

    // 添加书签按钮
    document.getElementById('add-bookmark-btn').addEventListener('click', () => {
      openBookmarkModal('add');
    });

    // 保存书签
    document.getElementById('save-bookmarks-btn').addEventListener('click', async () => {
      const toast = document.getElementById('refresh-toast');
      const toastText = document.getElementById('refresh-toast-text');
      toast.classList.remove('hidden');
      toastText.textContent = '正在保存...';

      try {
        // 更新 order
        currentBookmarks = currentBookmarks.map((bm, idx) => ({ ...bm, order: idx }));
        
        const res = await fetch('/api/bookmarks/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, bookmarks: currentBookmarks })
        });
        
        const data = await res.json();
        if (data.success) {
          originalBookmarks = JSON.parse(JSON.stringify(currentBookmarks));
          isEditMode = false;
          container.classList.remove('edit-mode');
          editBtn.textContent = '✏️ 编辑';
          editActions.classList.add('hidden');
          editHint.classList.add('hidden');
          toastText.textContent = '保存成功！';
          setTimeout(() => toast.classList.add('hidden'), 1500);
        } else {
          throw new Error(data.error || '保存失败');
        }
      } catch (e) {
        toastText.textContent = '保存失败: ' + e.message;
        setTimeout(() => toast.classList.add('hidden'), 2000);
      }
    });

    // ========== 书签弹窗 ==========
    let editingBookmarkId = null;

    function openBookmarkModal(mode, data = {}) {
      const modal = document.getElementById('bookmark-modal');
      const title = document.getElementById('bookmark-modal-title');
      
      if (mode === 'add') {
        title.textContent = '添加快捷链接';
        document.getElementById('bookmark-name').value = '';
        document.getElementById('bookmark-url').value = '';
        document.getElementById('bookmark-icon').value = '';
        editingBookmarkId = null;
      } else {
        title.textContent = '编辑快捷链接';
        document.getElementById('bookmark-name').value = data.name || '';
        document.getElementById('bookmark-url').value = data.url || '';
        document.getElementById('bookmark-icon').value = data.icon || '';
        editingBookmarkId = data.id;
      }
      
      modal.classList.remove('hidden');
    }

    document.getElementById('cancel-bookmark-modal').addEventListener('click', () => {
      document.getElementById('bookmark-modal').classList.add('hidden');
    });

    document.getElementById('confirm-bookmark-modal').addEventListener('click', () => {
      const name = document.getElementById('bookmark-name').value.trim();
      const url = document.getElementById('bookmark-url').value.trim();
      const icon = document.getElementById('bookmark-icon').value.trim() || '🔗';
      
      if (!name || !url) {
        alert('请填写名称和 URL');
        return;
      }
      
      if (editingBookmarkId) {
        // 编辑现有书签
        const idx = currentBookmarks.findIndex(b => b.id === editingBookmarkId);
        if (idx > -1) {
          currentBookmarks[idx] = { ...currentBookmarks[idx], name, url, icon };
        }
      } else {
        // 添加新书签
        currentBookmarks.push({
          id: Date.now().toString(36),
          name,
          url,
          icon,
          order: currentBookmarks.length
        });
      }
      
      renderBookmarks();
      document.getElementById('bookmark-modal').classList.add('hidden');
    });

    // 初始绑定事件
    bindBookmarkEvents();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

// 社交预览页面（针对爬虫优化的轻量级 HTML）
function serveSocialPreviewPage(data, request) {
  const url = new URL(request?.url || 'https://example.com');
  const baseUrl = `${url.protocol}//${url.host}`;
  
  // 社交卡片图（优先使用 AI 生成的卡片图，其次是背景图，最后是头像）
  const ogImage = data.aiCardImageUrl 
    ? (data.aiCardImageUrl.startsWith('http') ? data.aiCardImageUrl : baseUrl + data.aiCardImageUrl)
    : (data.aiBackgroundUrl 
        ? (data.aiBackgroundUrl.startsWith('http') ? data.aiBackgroundUrl : baseUrl + data.aiBackgroundUrl)
        : data.github?.avatar_url || '');

  // og:title - bio 前 60 字或默认标题
  const displayName = data.github?.name || data.username;
  const ogTitle = data.aiBio 
    ? data.aiBio.substring(0, 60) + (data.aiBio.length > 60 ? '...' : '')
    : `${displayName} 的 AI 作品集`;

  // og:description - 项目亮点总结 + 一句话简介
  const topProjects = (data.repos || []).filter(r => !r.fork).slice(0, 3);
  const projectHighlights = topProjects.length > 0 
    ? `精选项目：${topProjects.map(r => r.name).join('、')}。` 
    : '';
  const ogDescription = projectHighlights + (data.aiBio || `${displayName} 的个人作品集`).substring(0, 150);

  // 构建完整的 canonical URL
  const canonicalUrl = `${baseUrl}/p/${data.slug}`;
  
  // 轻量级 HTML，只包含必要的 meta 标签
  const html = `<!DOCTYPE html>
<html lang="zh-CN" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- 基础 Meta -->
  <title>${displayName} - MyEdge Portfolio</title>
  <meta name="description" content="${ogDescription}">
  <meta name="author" content="${displayName}">
  <link rel="canonical" href="${canonicalUrl}">
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="profile">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${displayName} 的个人主页预览">
  <meta property="og:site_name" content="MyEdge Portfolio">
  <meta property="og:locale" content="zh_CN">
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${canonicalUrl}">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image" content="${ogImage}">
  <meta name="twitter:image:alt" content="${displayName} 的个人主页预览">
  ${data.github?.twitter_username ? `<meta name="twitter:creator" content="@${data.github.twitter_username}">` : ''}
  <meta name="twitter:site" content="@MyEdgePortfolio">
  
  <!-- LinkedIn -->
  <meta property="og:image:secure_url" content="${ogImage}">
  
  <!-- Discord -->
  <meta name="theme-color" content="#667eea">
  
  <!-- WeChat / 微信 -->
  <meta itemprop="name" content="${displayName} - MyEdge Portfolio">
  <meta itemprop="description" content="${ogDescription}">
  <meta itemprop="image" content="${ogImage}">
  
  <!-- 技能标签作为关键词 -->
  <meta name="keywords" content="${(data.skills || []).join(', ')}, ${displayName}, portfolio, developer">
  
  <!-- 禁止缓存（确保爬虫获取最新内容） -->
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  
  <!-- 重定向到完整页面（非爬虫访问时） -->
  <meta http-equiv="refresh" content="0;url=${canonicalUrl}">
</head>
<body>
  <!-- 给爬虫提供基础内容结构 -->
  <main>
    <article>
      <header>
        <h1>${displayName}</h1>
        <img src="${data.github?.avatar_url || ''}" alt="${displayName}" width="200" height="200">
      </header>
      <section>
        <p>${data.aiBio || ''}</p>
      </section>
      <section>
        <h2>技术栈</h2>
        <ul>
          ${(data.skills || []).map(s => `<li>${s}</li>`).join('')}
        </ul>
      </section>
      <section>
        <h2>精选项目</h2>
        <ul>
          ${topProjects.map(r => `<li><a href="${r.html_url}">${r.name}</a> - ${r.description || ''}</li>`).join('')}
        </ul>
      </section>
    </article>
  </main>
  <footer>
    <p>Powered by MyEdge Portfolio - AI 驱动的个人品牌页面</p>
  </footer>
  <script>
    // 立即重定向到完整页面
    window.location.replace('${canonicalUrl}');
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 
      'Content-Type': 'text/html;charset=UTF-8',
      // 告诉爬虫这是 canonical 页面
      'Link': `<${canonicalUrl}>; rel="canonical"`,
      // 不缓存
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

function serveNotFoundPage() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>页面不存在 - MyEdge Portfolio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .gradient-bg { background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%); }
  </style>
</head>
<body class="min-h-screen gradient-bg flex items-center justify-center">
  <div class="text-center text-white">
    <h1 class="text-6xl font-bold mb-4">404</h1>
    <p class="text-xl mb-8">抱歉，该页面不存在</p>
    <a href="/" class="px-6 py-3 bg-white text-purple-600 rounded-xl font-medium hover:bg-white/90 transition">
      返回首页创建你的专属页面
    </a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

// ==================== 工具函数 ====================

function generateSlug(username) {
  const random = Math.random().toString(36).substring(2, 8);
  return `${username.toLowerCase()}-${random}`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

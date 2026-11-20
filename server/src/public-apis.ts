/**
 * Curated Free Public API Skill Library (Progressive Disclosure for NOTE4 E-Ink Apps).
 *
 * All 25 endpoints below are zero-API-key HTTPS/HTTP public APIs verified for compact
 * payload sizes (< 30 KiB, safe for ESP32-S3 + MicroQuickJS 512 KiB JS heap).
 *
 * Progressive disclosure design:
 *  - Layer 1 (static system prompt): ~55 tokens mentioning `lookup_public_api` -> preserves KV prefix cache.
 *  - Layer 2 (per-user-turn hint): only when keywords match, inject tiny `available_public_apis_hint` slugs.
 *  - Layer 3 (on-demand tool `lookup_public_api`): returns exact URL template, resolved city lat/lon,
 *    response schema, ES5 MicroQuickJS snippet, and a ready-to-use `mock_net` sample for `check_work`.
 */

export interface PublicApiSkill {
  id: string;
  name: string;
  category: 'weather' | 'finance' | 'news' | 'culture' | 'calendar' | 'geek';
  keywords: string[];
  url_template: string;
  params: string;
  response_fields: string;
  es5_parse: string;
  mock_net_sample: string;
  notes?: string;
}

/** Built-in coordinates for 52 major Chinese & world cities so AI resolves locations in 0 extra requests. */
export const CITY_COORDS: Record<string, {lat: number; lon: number; en: string}> = {
  北京: {lat: 39.9, lon: 116.4, en: 'Beijing'},
  上海: {lat: 31.23, lon: 121.47, en: 'Shanghai'},
  广州: {lat: 23.13, lon: 113.26, en: 'Guangzhou'},
  深圳: {lat: 22.54, lon: 114.06, en: 'Shenzhen'},
  杭州: {lat: 30.29, lon: 120.16, en: 'Hangzhou'},
  成都: {lat: 30.66, lon: 104.07, en: 'Chengdu'},
  南京: {lat: 32.06, lon: 118.8, en: 'Nanjing'},
  武汉: {lat: 30.59, lon: 114.3, en: 'Wuhan'},
  西安: {lat: 34.34, lon: 108.94, en: 'Xian'},
  重庆: {lat: 29.56, lon: 106.55, en: 'Chongqing'},
  苏州: {lat: 31.3, lon: 120.58, en: 'Suzhou'},
  天津: {lat: 39.08, lon: 117.2, en: 'Tianjin'},
  长沙: {lat: 28.23, lon: 112.94, en: 'Changsha'},
  郑州: {lat: 34.75, lon: 113.62, en: 'Zhengzhou'},
  青岛: {lat: 36.07, lon: 120.38, en: 'Qingdao'},
  厦门: {lat: 24.48, lon: 118.09, en: 'Xiamen'},
  宁波: {lat: 29.87, lon: 121.55, en: 'Ningbo'},
  合肥: {lat: 31.82, lon: 117.23, en: 'Hefei'},
  福州: {lat: 26.07, lon: 119.3, en: 'Fuzhou'},
  大连: {lat: 38.91, lon: 121.61, en: 'Dalian'},
  沈阳: {lat: 41.8, lon: 123.43, en: 'Shenyang'},
  哈尔滨: {lat: 45.8, lon: 126.53, en: 'Harbin'},
  昆明: {lat: 25.04, lon: 102.83, en: 'Kunming'},
  贵阳: {lat: 26.65, lon: 106.63, en: 'Guiyang'},
  南宁: {lat: 22.82, lon: 108.37, en: 'Nanning'},
  海口: {lat: 20.04, lon: 110.2, en: 'Haikou'},
  三亚: {lat: 18.25, lon: 109.51, en: 'Sanya'},
  珠海: {lat: 22.27, lon: 113.58, en: 'Zhuhai'},
  佛山: {lat: 23.02, lon: 113.12, en: 'Foshan'},
  无锡: {lat: 31.49, lon: 120.31, en: 'Wuxi'},
  济南: {lat: 36.65, lon: 117.12, en: 'Jinan'},
  太原: {lat: 37.87, lon: 112.55, en: 'Taiyuan'},
  石家庄: {lat: 38.04, lon: 114.51, en: 'Shijiazhuang'},
  长春: {lat: 43.82, lon: 125.32, en: 'Changchun'},
  南昌: {lat: 28.68, lon: 115.86, en: 'Nanchang'},
  兰州: {lat: 36.06, lon: 103.83, en: 'Lanzhou'},
  乌鲁木齐: {lat: 43.83, lon: 87.62, en: 'Urumqi'},
  拉萨: {lat: 29.65, lon: 91.17, en: 'Lhasa'},
  香港: {lat: 22.32, lon: 114.17, en: 'HongKong'},
  澳门: {lat: 22.2, lon: 113.54, en: 'Macau'},
  台北: {lat: 25.03, lon: 121.56, en: 'Taipei'},
  东京: {lat: 35.68, lon: 139.65, en: 'Tokyo'},
  大阪: {lat: 34.69, lon: 135.5, en: 'Osaka'},
  新加坡: {lat: 1.35, lon: 103.82, en: 'Singapore'},
  首尔: {lat: 37.57, lon: 126.98, en: 'Seoul'},
  伦敦: {lat: 51.51, lon: -0.13, en: 'London'},
  纽约: {lat: 40.71, lon: -74.01, en: 'NewYork'},
  旧金山: {lat: 37.77, lon: -122.42, en: 'SanFrancisco'},
  洛杉矶: {lat: 34.05, lon: -118.24, en: 'LosAngeles'},
  巴黎: {lat: 48.86, lon: 2.35, en: 'Paris'},
  悉尼: {lat: -33.87, lon: 151.21, en: 'Sydney'},
  温哥华: {lat: 49.28, lon: -123.12, en: 'Vancouver'},
};

export const PUBLIC_API_SKILLS: PublicApiSkill[] = [
  // ---- Weather, AQI & Astronomy ----
  {
    id: 'open_meteo_weather',
    name: 'Open-Meteo 全球实时天气与多日预报（含日出日落/紫外线）',
    category: 'weather',
    keywords: ['天气', '气温', '温度', '预报', '下雨', '晴天', '日出', '日落', '紫外线', '湿度', '风速', 'weather', 'forecast', 'sunrise', 'sunset', 'uv'],
    url_template:
      'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max&timezone=Asia%2FShanghai&forecast_days=4',
    params: '直接把用户所在城市的 lat/lon 填入（参考 resolved_cities 或调用 open_meteo_geo）；海外城市改 timezone=auto',
    response_fields:
      'current: {temperature_2m, relative_humidity_2m, apparent_temperature, weather_code(0晴/1-2多云/3阴/45-48雾/51-67雨/71-77雪/95雷雨), wind_speed_10m}; daily: {time[], weather_code[], temperature_2m_max[], temperature_2m_min[], sunrise[]("YYYY-MM-DDTHH:MM"), sunset[], uv_index_max[]}',
    es5_parse:
      "var j=parse(st,b),c=j&&j.current,d=j&&j.daily;if(!c||!d)return;var sr=(d.sunrise&&d.sunrise[0])?d.sunrise[0].slice(11,16):'06:30',ss=(d.sunset&&d.sunset[0])?d.sunset[0].slice(11,16):'18:00';",
    mock_net_sample:
      '{"current":{"temperature_2m":22.4,"relative_humidity_2m":48,"apparent_temperature":21.8,"weather_code":1,"wind_speed_10m":11.2},"daily":{"time":["2026-11-20","2026-11-21","2026-11-22","2026-11-23"],"weather_code":[1,0,2,61],"temperature_2m_max":[24,25,22,18],"temperature_2m_min":[13,14,12,10],"sunrise":["2026-11-20T06:48"],"sunset":["2026-11-20T17:12"],"uv_index_max":[4.5]}}',
    notes: '免密钥、约 1.1KB；MicroQuickJS 不支持 new Date("YYYY-MM-DD") 或 Date.UTC()，直接 slice(11,16) 取日出日落时间，周几用 clock().w 偏移计算；多城市切换时每次只请求当前城市即可，勿一次性并发拉所有城市',
  },
  {
    id: 'open_meteo_aqi',
    name: 'Open-Meteo 实时空气质量（PM2.5 / PM10 / AQI / UV）',
    category: 'weather',
    keywords: ['空气', '空气质量', 'pm2.5', 'pm25', 'pm10', '雾霾', 'aqi', '污染', '紫外线'],
    url_template:
      'https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&current=pm2_5,pm10,us_aqi,european_aqi,uv_index&timezone=Asia%2FShanghai',
    params: '填入用户城市的 lat/lon（参考 resolved_cities）',
    response_fields: 'current: {pm2_5, pm10, us_aqi(0-50优/51-100良/101-150轻度/151-200中度), european_aqi, uv_index}',
    es5_parse:
      'var j=parse(st,b),c=j&&j.current;if(!c)return;S.aqi=Math.round(c.us_aqi||0);S.pm25=Math.round(c.pm2_5||0);S.pm10=Math.round(c.pm10||0);',
    mock_net_sample: '{"current":{"pm2_5":18.4,"pm10":32.1,"us_aqi":64,"european_aqi":28,"uv_index":3.2}}',
    notes: '免密钥、仅 ~450B；非常适合与 open_meteo_weather 组合做「城市气象与空气质量面板」',
  },
  {
    id: 'open_meteo_geo',
    name: 'Open-Meteo 城市名查经纬度（地理编码）',
    category: 'weather',
    keywords: ['城市', '定位', '经纬度', '坐标', '地点', '地名', 'geocode', 'city'],
    url_template: 'https://geocoding-api.open-meteo.com/v1/search?name={city_encoded}&count=1&language=zh&format=json',
    params: '把城市名 URL 编码填入 {city_encoded}（若已在内置常用城市表中则直接用坐标，无需二次请求）',
    response_fields: 'results[0]: {name, latitude, longitude, country, admin1}',
    es5_parse: 'var j=parse(st,b),r=j&&j.results&&j.results[0];if(!r)return;S.lat=r.latitude;S.lon=r.longitude;',
    mock_net_sample: '{"results":[{"name":"杭州","latitude":30.29,"longitude":120.16,"country":"中国"}]}',
    notes: '免密钥、仅 ~350B',
  },
  {
    id: 'sunrise_sunset',
    name: 'Sunrise-Sunset 全球日出日落与白昼时长',
    category: 'weather',
    keywords: ['日出', '日落', '白昼', '天亮', '黄昏', '黄金时刻', '天文', 'sunrise', 'sunset'],
    url_template: 'https://api.sunrise-sunset.org/json?lat={lat}&lng={lon}&formatted=0',
    params: '填入 lat / lon；返回 UTC ISO 时间，北京时间小时 = (+slice(11,13) + 8) % 24',
    response_fields: 'results: {sunrise, sunset, solar_noon, day_length(秒), civil_twilight_begin, civil_twilight_end}',
    es5_parse:
      "var j=parse(st,b),r=j&&j.results;if(!r)return;function bj(s){return pad((+s.slice(11,13)+8)%24)+':'+s.slice(14,16);}S.sr=bj(r.sunrise);S.ss=bj(r.sunset);S.len=Math.floor(r.day_length/3600)+'h '+Math.floor((r.day_length%3600)/60)+'m';",
    mock_net_sample:
      '{"results":{"sunrise":"2026-11-19T23:04:35+00:00","sunset":"2026-11-20T08:55:16+00:00","day_length":35441}}',
    notes: '免密钥、仅 ~500B；若已调 open_meteo_weather 也可直接用其 daily.sunrise/sunset 字段少发一次请求',
  },

  // ---- Finance, Stocks, Gold, FX & Crypto ----
  {
    id: 'tencent_stock_kline',
    name: '腾讯财经 A股 / ETF / 港股 / 美股 日 K 线与收盘价',
    category: 'finance',
    keywords: ['股票', '股市', 'a股', '港股', '美股', 'k线', '行情', '大盘', 'etf', '基金', '茅台', '腾讯', '苹果', '英伟达', 'stock', 'kline'],
    url_template: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,30,qfq',
    params:
      'symbol 规则：沪市 sh+6位(如 sh600519 贵州茅台、sh510300 沪深300ETF、sh000001 上证指数)，深市 sz+6位(如 sz000001、sz399001、sz300750 宁德时代)，港股 hk+5位(如 hk00700 腾讯)，美股 us+代码(如 usAAPL、usNVDA)',
    response_fields:
      'data[symbol].qfqday (或 .day): [[日期, 开盘, 收盘, 最高, 最低, 成交量], ...]；每项均为字符串数字，用 +row[2] 转数值',
    es5_parse:
      'var j=parse(st,b),d=j&&j.data&&j.data[SYM],q=d&&(d.qfqday||d.day);if(!q||!q.length)return;var last=+q[q.length-1][2],prev=q.length>1?+q[q.length-2][2]:+q[q.length-1][1];',
    mock_net_sample:
      '{"code":0,"data":{"sh600519":{"qfqday":[["2026-11-18","1420.00","1435.20","1440.00","1415.00","32000"],["2026-11-19","1436.00","1452.80","1458.00","1430.00","41000"]]}}}',
    notes: '免密钥、纯 UTF-8 JSON、国内直连 ~200ms、30 日约 2–5KB，最稳健的股票与 K 线数据源',
  },
  {
    id: 'tencent_stock_quote',
    name: '腾讯财经 多标的盘中实时快照（大盘/个股/ETF）',
    category: 'finance',
    keywords: ['股票', '实时股价', '大盘', '上证', '深证', '创业板', '指数', '自选股', '盯盘', 'quote', 'index'],
    url_template: 'https://qt.gtimg.cn/q={symbols_csv}',
    params: '逗号拼接多个代码如 sh000001,sz399001,sz399006,sh600519；一次可拉 3–6 只标的',
    response_fields:
      '文本行 v_sh000001="1~名称~代码~现价(3)~昨收(4)~今开(5)~...~涨跌额(31)~涨跌幅%(32)~最高(33)~最低(34)~..."，按 "~" split 取索引 [3],[4],[31],[32]',
    es5_parse:
      'if(st<200||st>=300)return;var lines=b.split(";");for(var i=0;i<lines.length;i++){var q=lines[i].split("~");if(q.length>33){var px=+q[3],pct=+q[32];}}',
    mock_net_sample: 'v_sh000001="1~SSE~000001~3533.79~3520.10~3525.00~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~13.69~0.39~3540.00~3518.00";',
    notes: '免密钥、~1.5KB、国内 ~190ms；注意该接口中文名字段为 GBK 编码，请务必在代码里写死 UTF-8 中文简称，只解析数字字段 [3]/[31]/[32]！',
  },
  {
    id: 'fx_rates',
    name: 'ExchangeRate-API 全球 160+ 币种实时汇率',
    category: 'finance',
    keywords: ['汇率', '外汇', '美元', '日元', '欧元', '港币', '英镑', '人民币', '换算', 'fx', 'currency', 'exchange'],
    url_template: 'https://open.er-api.com/v6/latest/{base}',
    params: '{base} 填 3 字母币种代码：CNY / USD / JPY / EUR / HKD / GBP',
    response_fields: 'result:"success", base_code, rates:{USD, EUR, JPY, HKD, GBP, CNY, ...}',
    es5_parse: 'var j=parse(st,b);if(!j||!j.rates)return;S.usd=j.rates.USD;S.jpy=j.rates.JPY;S.eur=j.rates.EUR;',
    mock_net_sample: '{"result":"success","base_code":"CNY","rates":{"USD":0.1385,"EUR":0.1292,"JPY":21.35,"HKD":1.078,"GBP":0.1085}}',
    notes: '免密钥、约 3KB，每日更新，适合汇率换算与跨境消费桌面卡',
  },
  {
    id: 'gold_price',
    name: '今日国内实时黄金金价（银行投资金条 & 品牌金店）',
    category: 'finance',
    keywords: ['黄金', '金价', '金条', '足金', '周大福', '老凤祥', '贵金属', 'gold'],
    url_template: 'https://v2.xxapi.cn/api/goldprice',
    params: '无需参数，直接 GET',
    response_fields: 'code:200, data:{bank_gold_bar_price:[{bank,price}], precious_metal_price:[{brand,bullion_price,gold_price,recycle_price,updated_date}]}',
    es5_parse:
      'var j=parse(st,b),d=j&&j.data;if(!d)return;var bars=d.bank_gold_bar_price||[],shops=d.precious_metal_price||[];',
    mock_net_sample:
      '{"code":200,"data":{"bank_gold_bar_price":[{"bank":"工商银行如意金条","price":"835.5"},{"bank":"建设银行建行金","price":"834.0"}],"precious_metal_price":[{"brand":"周大福","gold_price":"1028","recycle_price":"810"}]}}',
    notes: '免密钥、仅 ~2.5KB、国内直连 ~300ms',
  },
  {
    id: 'crypto_coingecko',
    name: 'CoinGecko 加密货币多币种价格与 24h 涨跌幅（含 USD / CNY）',
    category: 'finance',
    keywords: ['比特币', '以太坊', '加密', '币价', '虚拟币', 'btc', 'eth', 'sol', 'doge', 'crypto', 'bitcoin'],
    url_template:
      'https://api.coingecko.com/api/v3/simple/price?ids={ids_csv}&vs_currencies=usd,cny&include_24hr_change=true',
    params: '{ids_csv} 如 bitcoin,ethereum,solana,dogecoin（小写全称，逗号分隔）',
    response_fields: '{bitcoin:{usd, usd_24h_change, cny, cny_24h_change}, ethereum:{...}}',
    es5_parse:
      'var j=parse(st,b);if(!j||!j.bitcoin)return;S.btc=j.bitcoin.usd;S.chg=j.bitcoin.usd_24h_change;',
    mock_net_sample:
      '{"bitcoin":{"usd":92450,"usd_24h_change":2.35,"cny":668200,"cny_24h_change":2.31},"ethereum":{"usd":3120,"usd_24h_change":-1.12}}',
    notes: '免密钥、仅 ~230B！建议 ui.tick(300000) 每 5 分钟刷新避免限流；切勿使用 Binance（部分地区 451）',
  },
  {
    id: 'crypto_okx',
    name: 'OKX 加密货币现货实时行情（单币对毫秒级）',
    category: 'finance',
    keywords: ['okx', '现货', 'btc', 'eth', 'sol', '币价', '行情'],
    url_template: 'https://www.okx.com/api/v5/market/ticker?instId={pair}',
    params: '{pair} 如 BTC-USDT / ETH-USDT / SOL-USDT',
    response_fields: 'code:"0", data[0]:{instId, last, open24h, high24h, low24h, vol24h}',
    es5_parse:
      'var j=parse(st,b),d=j&&j.data&&j.data[0];if(!d)return;var last=+d.last,open=+d.open24h,pct=open?(last-open)*100/open:0;',
    mock_net_sample: '{"code":"0","data":[{"instId":"BTC-USDT","last":"92450.5","open24h":"90320.0","high24h":"93100.0","low24h":"89800.0"}]}',
    notes: '免密钥、仅 ~360B',
  },
  {
    id: 'oil_price',
    name: '全国 31 省市今日油价（92/95/98/0号柴油与调价幅度）',
    category: 'finance',
    keywords: ['油价', '汽油', '柴油', '92号', '95号', '加油', '开车', 'oil', 'gas'],
    url_template: 'https://v2.xxapi.cn/api/oilPrice',
    params: '无需参数；遍历 data[] 按 regionName.indexOf(用户省份) 匹配对应地区',
    response_fields: 'code:200, data[]:{regionName, n92, n95, n98, n0, n92Change, date}',
    es5_parse:
      'var j=parse(st,b),a=j&&j.data;if(!a)return;for(var i=0;i<a.length;i++)if(a[i].regionName.indexOf(PROV)===0){S.cur=a[i];break;}',
    mock_net_sample:
      '{"code":200,"data":[{"regionName":"北京市","n92":"7.48","n95":"7.96","n98":"9.46","n0":"7.18","n92Change":-0.12,"date":"2026-11-20"}]}',
    notes: '免密钥、约 16KB、国内直连 ~110ms',
  },

  // ---- News, Hotboards & Tech ----
  {
    id: 'cn_hotboard',
    name: '中文全网实时热搜与资讯榜（10 大平台任选）',
    category: 'news',
    keywords: ['热搜', '热榜', '新闻', '资讯', '微博', '知乎', '百度', '澎湃', '36氪', '少数派', 'it之家', '掘金', '抖音', 'v2ex', '头条', 'news', 'hot'],
    url_template: 'https://uapis.cn/api/v1/misc/hotboard?type={type}',
    params:
      '{type} 可选（均 < 28KB 实测安全）：weibo(微博)、zhihu(知乎)、baidu(百度)、thepaper(澎湃)、36kr(36氪)、sspai(少数派)、ithome(IT之家)、juejin(掘金)、douyin(抖音)、v2ex(V2EX)。切勿选 bilibili（超 64KB 会截断！）',
    response_fields: 'type, update_time, list[]:{index, title, hot_value}',
    es5_parse:
      'var j=parse(st,b),L=j&&j.list;if(!L)return;var a=[];for(var i=0;i<L.length&&i<8;i++)a.push([String(L[i].title||"").slice(0,28),String(L[i].hot_value||"").slice(0,8)]);',
    mock_net_sample:
      '{"type":"ithome","list":[{"index":1,"title":"新款超轻墨水屏桌面终端发布","hot_value":"128万"},{"index":2,"title":"开源大模型端侧推理提速 3 倍","hot_value":"86万"}]}',
    notes: '免密钥、国内直连 120–1500ms、2–27KB；可支持按上下或确认在多个榜单间切换',
  },
  {
    id: 'hacker_news',
    name: 'Hacker News 首页热门科技讨论（Algolia 紧凑 JSON）',
    category: 'geek',
    keywords: ['hacker news', 'hn', '科技', '极客', '硅谷', '海外科技', 'tech'],
    url_template: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=8',
    params: 'hitsPerPage 控制条数（建议 6–8 条保持 < 10KB）',
    response_fields: 'hits[]:{title, points, num_comments, author}',
    es5_parse:
      'var j=parse(st,b),h=j&&j.hits;if(!h)return;var a=[];for(var i=0;i<h.length;i++)a.push([String(h[i].title||"").slice(0,48),h[i].points||0,h[i].num_comments||0]);',
    mock_net_sample:
      '{"hits":[{"title":"Show HN: Open-Source E-Ink Desktop Studio","points":342,"num_comments":89,"author":"dev"},{"title":"Fast 16-Grayscale Glass Rendering on ESP32","points":215,"num_comments":44,"author":"hw"}]}',
    notes: '免密钥、单次请求直出 8 条含赞数与评论数，~8KB',
  },
  {
    id: 'github_repo',
    name: 'GitHub 开源仓库实时看板（Star / Fork / Issue / 语言）',
    category: 'geek',
    keywords: ['github', 'star', 'stars', '仓库', '开源', 'repo', 'issue', 'fork'],
    url_template: 'https://api.github.com/repos/{owner}/{repo}',
    params: '直接把用户提到的 owner/repo 填入 URL（例如 LCYLYM/note4-eink-studio）',
    response_fields: 'full_name, description, stargazers_count, forks_count, open_issues_count, language, pushed_at',
    es5_parse:
      'var j=parse(st,b);if(!j||!j.full_name)return;S.stars=j.stargazers_count;S.forks=j.forks_count;S.issues=j.open_issues_count;S.lang=j.language||"";',
    mock_net_sample:
      '{"full_name":"LCYLYM/note4-eink-studio","description":"ESP32-S3 E-Ink Studio","stargazers_count":1280,"forks_count":146,"open_issues_count":5,"language":"TypeScript"}',
    notes: '免密钥（匿名 60 次/小时，建议 ui.tick(600000) 每 10 分钟刷新），~5.5KB',
  },
  {
    id: 'github_user',
    name: 'GitHub 开发者个人公开统计（Followers / 公开仓库数）',
    category: 'geek',
    keywords: ['github用户', '粉丝', 'followers', '开发者', 'github主页'],
    url_template: 'https://api.github.com/users/{username}',
    params: '填入用户的 GitHub 用户名',
    response_fields: 'login, name, bio, public_repos, followers, following',
    es5_parse: 'var j=parse(st,b);if(!j||!j.login)return;S.followers=j.followers;S.repos=j.public_repos;S.bio=j.bio||"";',
    mock_net_sample: '{"login":"LCYLYM","name":"LCYLYM","bio":"Building E-Ink hardware","public_repos":28,"followers":356,"following":42}',
    notes: '免密钥、仅 ~1.2KB，建议每 10–30 分钟刷新',
  },

  // ---- Culture, Quotes, Poetry & Learning ----
  {
    id: 'jinrishici',
    name: '今日诗词 · 每日一首古诗词名句',
    category: 'culture',
    keywords: ['诗词', '古诗', '诗句', '宋词', '唐诗', '古风', '文雅', 'poetry', 'poem'],
    url_template: 'https://v1.jinrishici.com/all.json',
    params: '无需参数，每次请求返回一条随机经典古诗词',
    response_fields: 'content(诗句), origin(词牌/篇名), author(作者), category(分类)',
    es5_parse: 'var j=parse(st,b);if(!j||!j.content)return;S.txt=j.content;S.from=j.author+" · "+j.origin;',
    mock_net_sample: '{"content":"人间有味是清欢，且把浮名换浅斟。","origin":"浣溪沙","author":"苏轼","category":"古诗文-生活"}',
    notes: '免密钥、极简 ~160B、国内 ~230ms，绝配 16 灰 clear + 4-bit serif 粗宋体！',
  },
  {
    id: 'cn_yiyan',
    name: '中文每日一言 / 桌面治愈短句',
    category: 'culture',
    keywords: ['一言', '每日一句', '金句', '语录', '毒鸡汤', '励志', '文案', '句子', 'quote', 'hitokoto'],
    url_template: 'https://v2.xxapi.cn/api/yiyan?type=hitokoto',
    params: 'type 可选 hitokoto(一言) / poetry(诗词) / comfort(安慰)',
    response_fields: 'code:200, data(字符串短句)',
    es5_parse: 'var j=parse(st,b);if(!j||!j.data)return;S.quote=String(j.data);',
    mock_net_sample: '{"code":200,"data":"生活，过慢一点，让岁月不要在匆匆中流逝。"}',
    notes: '免密钥、仅 ~240B、国内直连稳定（比 v1.hitokoto.cn 握手更稳）',
  },
  {
    id: 'zen_quotes',
    name: 'ZenQuotes 英文每日名言',
    category: 'culture',
    keywords: ['英文名言', '英语名言', 'english quote', 'zenquotes', '英文金句'],
    url_template: 'https://zenquotes.io/api/today',
    params: '无需参数（或改 /api/random 随机刷新）',
    response_fields: '数组 [0]: {q(英文句子), a(作者)}',
    es5_parse: 'var j=parse(st,b);if(!j||!j[0])return;S.q=j[0].q;S.a=j[0].a;',
    mock_net_sample: '[{"q":"Simplicity is about subtracting the obvious and adding the meaningful.","a":"John Maeda"}]',
    notes: '免密钥、仅 ~360B',
  },
  {
    id: 'history_today',
    name: '历史上的今天（中外历史大事件）',
    category: 'culture',
    keywords: ['历史上的今天', '历史', '往事', '编年', 'history'],
    url_template: 'https://v2.xxapi.cn/api/history',
    params: '无需参数，自动按当天月日返回事件数组',
    response_fields: 'code:200, data:[ "YYYY年MM月DD日 事件描述", ... ]',
    es5_parse: 'var j=parse(st,b);if(!j||!j.data||!j.data.length)return;S.list=j.data.slice(0,12);',
    mock_net_sample: '{"code":200,"data":["1985年11月20日 微软发布首个 Windows 1.0 系统","1998年11月20日 国际空间站首个组件发射升空"]}',
    notes: '免密钥、仅 ~1KB、国内 ~110ms',
  },
  {
    id: 'horoscope',
    name: '十二星座今日运势（综合/爱情/事业/财运）',
    category: 'culture',
    keywords: ['星座', '运势', '白羊', '金牛', '双子', '巨蟹', '狮子', '处女', '天秤', '天蝎', '射手', '摩羯', '水瓶', '双鱼', 'horoscope'],
    url_template: 'https://v2.xxapi.cn/api/horoscope?type={sign}&time=today',
    params: '{sign} 英文小写：aries/taurus/gemini/cancer/leo/virgo/libra/scorpio/sagittarius/capricorn/aquarius/pisces',
    response_fields: 'code:200, data:{luckynumber, fortune:{all,love,work,money}, fortunetext:{all}}',
    es5_parse: 'var j=parse(st,b),d=j&&j.data;if(!d||!d.fortune)return;S.f=d.fortune;S.txt=d.fortunetext.all;',
    mock_net_sample:
      '{"code":200,"data":{"luckynumber":"7","fortune":{"all":4,"love":4,"work":5,"money":3},"fortunetext":{"all":"今日灵感充沛，适合推进核心创作任务。"}}}',
    notes: '免密钥、~1.7KB、国内 ~100ms',
  },
  {
    id: 'en_dictionary',
    name: 'Free Dictionary 英语词典（音标 / 词性 / 英文释义与例句）',
    category: 'culture',
    keywords: ['词典', '英语', '单词', '查词', '音标', 'dictionary', 'word'],
    url_template: 'https://api.dictionaryapi.dev/api/v2/entries/en/{word}',
    params: '{word} 英文小写单词，如 serendipity / ephemeral / resilience',
    response_fields: '[0]:{word, phonetic, meanings[0]:{partOfSpeech, definitions[0]:{definition, example}}}',
    es5_parse:
      'var j=parse(st,b),e=j&&j[0],m=e&&e.meanings&&e.meanings[0],d=m&&m.definitions&&m.definitions[0];if(!d)return;S.ph=e.phonetic||"";S.def=d.definition;',
    mock_net_sample:
      '[{"word":"serendipity","phonetic":"/ˌsɛrənˈdɪpɪti/","meanings":[{"partOfSpeech":"noun","definitions":[{"definition":"The occurrence of finding valuable things not sought for."}]}]}]',
    notes: '免密钥、~1.3KB',
  },
  {
    id: 'wiki_zh_random',
    name: '中文维基百科随机词条摘要（桌面冷知识）',
    category: 'culture',
    keywords: ['维基', '百科', '冷知识', '科普', '随机知识', 'wikipedia', 'wiki'],
    url_template: 'https://zh.wikipedia.org/api/rest_v1/page/random/summary',
    params: '无需参数（也可查指定词条 /page/summary/{title}）',
    response_fields: 'title, description, extract(纯文本摘要)',
    es5_parse: 'var j=parse(st,b);if(!j||!j.title)return;S.t=j.title;S.ex=String(j.extract||"").slice(0,110);',
    mock_net_sample: '{"title":"电子纸","description":"模拟墨水在纸上视觉效果的显示技术","extract":"电子纸是一种双稳态反射式显示技术，断电后仍可清晰保持画面。"}',
    notes: '免密钥、~2.8KB；部分国内网络可能慢，务必内置离线精选词条兜底',
  },

  // ---- Calendar, Holidays & Science ----
  {
    id: 'cn_holiday',
    name: '中国法定节假日倒计时与调休查询（Timor API）',
    category: 'calendar',
    keywords: ['节假日', '假期', '放假', '倒计时', '调休', '春节', '国庆', '元旦', '五一', '中秋', '清明', '端午', '摸鱼', 'holiday'],
    url_template: 'https://timor.tech/api/holiday/next',
    params: '无需参数直出下一个法定节假日与剩余天数；查全年列表可用 https://timor.tech/api/holiday/year/{year}',
    response_fields: 'code:0, holiday:{name(节日名), date("YYYY-MM-DD"), rest(剩余天数整数), wage(3)}',
    es5_parse: 'var j=parse(st,b),h=j&&j.holiday;if(!h)return;S.hname=h.name;S.hdate=h.date;S.hrest=h.rest;',
    mock_net_sample: '{"code":0,"holiday":{"holiday":true,"name":"元旦","wage":3,"date":"2027-01-01","rest":42}}',
    notes: '免密钥、仅 ~110B！直接展示 h.rest 剩余天数即可，切勿调用 Date.UTC() 或 new Date("YYYY-MM-DD")（MicroQuickJS 不支持）',
  },
  {
    id: 'iss_astros',
    name: '国际空间站与当前在轨宇航员实时名单',
    category: 'geek',
    keywords: ['空间站', '太空', '宇航员', '航天', 'iss', 'space', 'astronaut'],
    url_template: 'http://api.open-notify.org/astros.json',
    params: '无需参数（HTTP 明文，ESP32 支持）',
    response_fields: 'number(当前在轨总人数), people:[{name, craft("ISS"/"Tiangong")}]',
    es5_parse: 'var j=parse(st,b);if(!j||!j.people)return;S.num=j.number;S.people=j.people;',
    mock_net_sample: '{"number":7,"people":[{"craft":"ISS","name":"Oleg Kononenko"},{"craft":"Tiangong","name":"Ye Guangfu"}]}',
    notes: '免密钥、仅 ~600B',
  },
  {
    id: 'usgs_quake',
    name: 'USGS 全球近期显著地震实时播报',
    category: 'geek',
    keywords: ['地震', '震级', '地质', 'usgs', 'earthquake'],
    url_template: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson',
    params: '无需参数（返回近 7 天全球显著地震 GeoJSON）',
    response_fields: 'features[]:{properties:{mag(震级), place(地点), title}}',
    es5_parse:
      'var j=parse(st,b),f=j&&j.features;if(!f)return;var a=[];for(var i=0;i<f.length&&i<5;i++)a.push([f[i].properties.mag,String(f[i].properties.place||"").slice(0,26)]);',
    mock_net_sample: '{"features":[{"properties":{"mag":6.1,"place":"42 km E of Hualien, Taiwan"}}]}',
    notes: '免密钥、~3.5KB',
  },
];

/** Extract any cities mentioned in free-form Chinese/English text and return ready-to-use coordinates. */
export function resolveCitiesFromText(text: string): {name: string; lat: number; lon: number}[] {
  const s = String(text ?? '');
  const lo = s.toLowerCase();
  const out: {name: string; lat: number; lon: number}[] = [];
  for (const [cn, info] of Object.entries(CITY_COORDS)) {
    if (s.includes(cn) || lo.includes(info.en.toLowerCase())) {
      out.push({name: cn, lat: info.lat, lon: info.lon});
      if (out.length >= 6) break;
    }
  }
  return out;
}

/**
 * Lightweight progressive-disclosure matcher for the user turn.
 * Returns compact slugs only when keywords hit (0 tokens added for offline apps!).
 */
export function suggestPublicApis(message: string): {id: string; name: string}[] {
  const lo = String(message ?? '').toLowerCase();
  if (!lo.trim()) return [];
  const scored: {api: PublicApiSkill; score: number}[] = [];
  for (const api of PUBLIC_API_SKILLS) {
    let score = 0;
    for (const kw of api.keywords) {
      if (lo.includes(kw.toLowerCase())) score += kw.length >= 3 ? 3 : 2;
    }
    if (score > 0) scored.push({api, score});
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map(x => ({id: x.api.id, name: x.api.name}));
}

/**
 * Progressive-disclosure hint for the user turn.
 * Returns undefined when no public API keywords match (0 extra tokens for offline apps!).
 */
export function suggestPublicApiHint(
  message: string
): {apis: {id: string; name: string}[]; resolved_cities?: {name: string; lat: number; lon: number}[]} | undefined {
  const apis = suggestPublicApis(message);
  if (!apis.length) return undefined;
  const cities = resolveCitiesFromText(message);
  return cities.length ? {apis, resolved_cities: cities} : {apis};
}

/**
 * Handler for the on-demand `lookup_public_api` tool and `GET /api/public-apis`.
 * - Empty query / "list" => compact 1-line index of all 25 APIs.
 * - Specific query or category => top matching full API skill cards + auto-resolved city coordinates.
 */
export function lookupPublicApis(query?: string, category?: string) {
  const q = String(query ?? '').trim();
  const cat = String(category ?? '').trim().toLowerCase();
  const resolved_cities = resolveCitiesFromText(q);

  if ((!q || q.toLowerCase() === 'list' || q === '全部') && !cat) {
    return {
      ok: true,
      total: PUBLIC_API_SKILLS.length,
      usage_tip: '传具体中文或英文关键词（如 "成都 天气 空气"、"茅台 股票"、"金价 节假日"）即可获取完整 URL、字段、ES5 片段和 mock_net 样例。',
      apis: PUBLIC_API_SKILLS.map(a => ({id: a.id, category: a.category, name: a.name})),
    };
  }

  const lo = q.toLowerCase();
  const tokens = lo.split(/[\s,，、/|+]+/).filter(Boolean);
  const scored: {api: PublicApiSkill; score: number}[] = [];
  for (const api of PUBLIC_API_SKILLS) {
    if (cat && api.category !== cat) continue;
    let score = cat ? 1 : 0;
    const idLo = api.id.toLowerCase();
    if (lo && (idLo === lo || tokens.includes(idLo))) score += 20;
    if (lo && api.name.toLowerCase().includes(lo)) score += 6;
    for (const kw of api.keywords) {
      const kl = kw.toLowerCase();
      if (lo.includes(kl)) score += kl.length >= 3 ? 4 : 3;
      else if (tokens.some(t => t.length >= 2 && (kl.includes(t) || t.includes(kl)))) score += 2;
    }
    if (score > 0) scored.push({api, score});
  }
  scored.sort((a, b) => b.score - a.score);
  const limit = !q && cat ? 10 : 4;
  const matches = scored.slice(0, limit).map(x => x.api);

  if (!matches.length) {
    return {
      ok: true,
      matches: [],
      ...(resolved_cities.length ? {resolved_cities} : {}),
      available_index: PUBLIC_API_SKILLS.map(a => ({id: a.id, category: a.category, name: a.name})),
    };
  }

  return {
    ok: true,
    ...(resolved_cities.length ? {resolved_cities} : {}),
    matches,
  };
}

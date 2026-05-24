/**
 * 9 个目标平台的写作 trait 元数据。Step 1（平台选择）和 refine prompt
 * 都从这里取数据，避免两处定义漂移。
 *
 * 设计约束：
 * - 字段只描述「这个平台一篇好稿子长什么样」，不含 UI 颜色 / 图标。
 * - word_range_min / max 用 number，便于 prompt 里组装区间。
 * - hook_position：钩子落点；pacing：节奏密度。这两个值在 article / refine
 *   prompt 里被引用，让模型按平台调整。
 * - tone_tag：给 UI 卡片角标用的一两字标签。
 */

export type PlatformKey =
  | 'wechat'
  | 'bilibili'
  | 'zhihu'
  | 'sspai'
  | 'uisdc'
  | 'xhs'
  | 'douyin'
  | 'youtube'
  | 'custom';

export interface PlatformTrait {
  key: PlatformKey;
  name: string;
  /** 卡片角标：「深度」「节奏」「直给」之类 2-3 字 */
  tone_tag: string;
  /** 推荐字数下限 */
  word_range_min: number;
  /** 推荐字数上限 */
  word_range_max: number;
  /** 简短一句话语气 */
  voice: string;
  /** 推荐结构骨架 */
  structure: string;
  /** 钩子落点 */
  hook_position: string;
  /** 节奏密度 */
  pacing: string;
  /** 要做（prompt 直接展开成 - bullet） */
  do_extra: string[];
  /** 不要做 */
  dont_extra: string[];
  /** 给 UI 卡片底部的一句话提示 */
  ui_hint: string;
}

export const PLATFORMS: PlatformTrait[] = [
  {
    key: 'wechat',
    name: '公众号',
    tone_tag: '深度',
    word_range_min: 2000,
    word_range_max: 4500,
    voice: '深度长文 · 半正式 · 段落松弛 · 适度金句',
    structure: '主标题 + 5-8 个二级标题 + 升华收尾',
    hook_position: '开篇 200 字内立钩，正文 1/3 处给反转或第二钩',
    pacing: '节奏中等偏慢，段落 4-6 行，允许铺垫',
    do_extra: [
      '在文章开头放一段引人入胜的 hook（≤ 200 字）',
      '章节小标题做得"读完一句话就懂这段讲什么"',
      '收尾留一个回响金句，但全文只一处',
    ],
    dont_extra: [
      '不要堆砌外链',
      '不要在正文里放"点赞在看转发"这类运营话术',
    ],
    ui_hint: '2000-4500 字 · 深度长文',
  },
  {
    key: 'bilibili',
    name: 'B 站长视频文案',
    tone_tag: '口播',
    word_range_min: 3000,
    word_range_max: 6000,
    voice: '口播逐字稿 · 偏松弛网感 · 强镜头感 · 留弹幕互动钩子',
    structure: '开场钩 + 章节卡 + 多段拆解 + 反转 / 总结 + 留白下集预告',
    hook_position: '前 15 秒（约 80 字）必须立钩；每 90-120 秒一个小钩',
    pacing: '语速 4-5 字/秒；短句为主，长短交错，避免连续两句长句',
    do_extra: [
      '逐字稿格式，标点按口播停顿放',
      '关键转场写成单独一行，便于剪辑加章节卡',
      '在反转或金句前留一句"先别走"或类似拉留率的提示',
    ],
    dont_extra: [
      '不要长段落硬塞知识点，每段 ≤ 4 行',
      '不要文字游戏（双关只在镜头里有效，文字稿里反而难读）',
    ],
    ui_hint: '3000-6000 字 · 口播逐字稿',
  },
  {
    key: 'zhihu',
    name: '知乎专栏',
    tone_tag: '论证',
    word_range_min: 4500,
    word_range_max: 8500,
    voice: '论述 · 论证扎实 · 略带学术腔 · 但不掉书袋',
    structure: '先抛结论 + 多层论证（每层小标题）+ 反例 / 边界 + 结论再扣题',
    hook_position: '开头 100 字内给「先说结论」一段；后面每章一个小钩',
    pacing: '节奏慢稳，可以长段；段尾允许"小结：……"',
    do_extra: [
      '在开头明确给出"先说结论"段',
      '每个论证小节展开 1-2 个例证或数据',
      '段尾允许出现"小结：……"',
    ],
    dont_extra: [
      '不要情绪化感叹号',
      '不要堆砌孤立金句',
    ],
    ui_hint: '4500-8500 字 · 论证长答',
  },
  {
    key: 'sspai',
    name: '少数派',
    tone_tag: '工具',
    word_range_min: 2500,
    word_range_max: 4000,
    voice: '工具类深度 · 半技术腔 · 步骤清晰 · 有 takeaways',
    structure: '问题 / 方法 / 步骤 / 注意事项 / 一句话总结，5 段式',
    hook_position: '开篇明确给出「要解决什么问题」+「为什么这个方案」',
    pacing: '中速；每步骤独立成节，便于扫读',
    do_extra: [
      '每个步骤用「## 第 N 步：……」作小标题',
      '在文末用 1-3 条 takeaway 收束',
    ],
    dont_extra: [
      '不要长篇感慨',
      '不要插入与方法论无关的个人故事',
    ],
    ui_hint: '2500-4000 字 · 工作流',
  },
  {
    key: 'uisdc',
    name: '优设',
    tone_tag: '设计',
    word_range_min: 2200,
    word_range_max: 3800,
    voice: '设计向 · 视觉强 · 例子多 · 偏实操',
    structure: '问题 + 案例对比 + 方法拆解 + 设计原则总结',
    hook_position: '首段抛出「这个设计错在哪 / 这次想解的痛点是什么」',
    pacing: '中速；多用 1/2/3 分点，便于读图读结构',
    do_extra: [
      '每个观点尽量配一个具体设计案例描述',
      '关键术语用「」包裹，便于读者抓重点',
    ],
    dont_extra: [
      '不要写抽象艺术理论，要落到「设计师明天能用」',
      '不要批评具体公司或作者',
    ],
    ui_hint: '2200-3800 字 · 设计实操',
  },
  {
    key: 'xhs',
    name: '小红书',
    tone_tag: '共鸣',
    word_range_min: 700,
    word_range_max: 1200,
    voice: '口语 · 短句 · 节奏快 · 有共鸣感',
    structure: '一句话钩子开头 + 3-5 个分点（每点 60-180 字）+ 一句话收尾',
    hook_position: '第一行就是钩，不要铺垫',
    pacing: '快；每段 ≤ 4 行；段间允许跳跃',
    do_extra: [
      '小标题可以用「1 / 2 / 3」或破折号引入',
      '保留作者口吻的「我」和「你」',
    ],
    dont_extra: [
      '不要写超过 100 字的长段',
      '严禁任何 emoji 或表情字符',
      '不要写「双击屏幕」「点关注」这种话术',
    ],
    ui_hint: '700-1200 字 · 口语短文',
  },
  {
    key: 'douyin',
    name: '抖音口播',
    tone_tag: '快剪',
    word_range_min: 300,
    word_range_max: 800,
    voice: '极口语 · 强情绪 · 每句都要给信息 · 不允许铺垫',
    structure: '3 秒钩 + 3-5 个反差点 + 一句话收（呼吁评论 / 反问）',
    hook_position: '前 3 秒（约 15 字）必须立钩；钩失败整条作废',
    pacing: '极快；句子 ≤ 18 字；几乎每句都给一个新信息',
    do_extra: [
      '逐字稿格式，用「。」分句，便于看口播停顿',
      '每条段落 ≤ 3 句',
      '在中段加一个反差或反问，防止划走',
    ],
    dont_extra: [
      '不要用书面词',
      '不要解释专有名词，直接用最大众的说法',
      '不要任何 emoji',
    ],
    ui_hint: '300-800 字 · 短视频口播',
  },
  {
    key: 'youtube',
    name: 'YouTube 视频文案',
    tone_tag: '叙事',
    word_range_min: 2500,
    word_range_max: 5500,
    voice: '叙事感强 · 镜头切换感 · 中等节奏 · 有起承转合',
    structure: 'Cold open + 自我介绍 + 主体（3-5 段）+ Outro + Call to action',
    hook_position: 'Cold open 30 秒（约 120 字）；每章节开头给一次「下一段会讲什么」',
    pacing: '中速；偶尔可以慢下来做情绪铺垫',
    do_extra: [
      '逐字稿，但保留「（停顿）」「（看镜头）」这类标注',
      '在主体中段加一次「subscribe 提醒」也允许',
      '收尾给一个明确的 next-video 钩',
    ],
    dont_extra: [
      '不要中英混杂到难读',
      '不要每段都同样长度，要有节奏变化',
    ],
    ui_hint: '2500-5500 字 · 视频文案',
  },
  {
    key: 'custom',
    name: '自定义',
    tone_tag: '通用',
    word_range_min: 1500,
    word_range_max: 4000,
    voice: '通用中长篇 · 半正式 · 不偏向任何特定平台',
    structure: '主标题 + 4-6 个章节 + 升华收尾',
    hook_position: '开篇 200 字内立钩',
    pacing: '节奏中等',
    do_extra: [
      '保持博主风格主导整体气质',
      '允许使用作者原本的结构习惯',
    ],
    dont_extra: [
      '不要往任何具体平台风格上强行靠拢',
    ],
    ui_hint: '1500-4000 字 · 通用长文',
  },
];

export function getPlatform(key: string | null | undefined): PlatformTrait {
  const k = (key ?? '').trim();
  const hit = PLATFORMS.find((p) => p.key === k);
  return hit ?? PLATFORMS.find((p) => p.key === 'custom')!;
}

export function isValidPlatformKey(v: string): v is PlatformKey {
  return PLATFORMS.some((p) => p.key === v);
}

/**
 * v3 platform_fingerprints 字段里用的 key 是中文（公众号 / 知乎 / 小红书...），
 * 我们的 PlatformKey 是英文，需要双向映射。
 * 这个映射只取「在指纹库里大概率会出现的中文名」。custom / bilibili / douyin /
 * youtube 在 v3 指纹库里命中率较低，落回 null（走 cross-platform 降级）。
 */
const PLATFORM_KEY_TO_CN: Partial<Record<PlatformKey, string[]>> = {
  wechat: ['公众号', '微信公众号', 'WeChat'],
  zhihu: ['知乎', '知乎专栏'],
  xhs: ['小红书', '小红书笔记'],
  sspai: ['少数派'],
  uisdc: ['优设', '优设网'],
  bilibili: ['B站', 'B 站', 'bilibili', '哔哩哔哩'],
  douyin: ['抖音', '抖音口播'],
  youtube: ['YouTube', 'youtube', 'Youtube'],
};

/**
 * 给定 PlatformKey，从 v3 platform_fingerprints 里找匹配的那一份指纹。
 * 找不到返回 null，由调用方决定是降级到跨平台改写还是通用风格。
 */
export function pickV3PlatformFingerprint(
  platformFingerprints: Record<string, unknown> | null | undefined,
  key: PlatformKey,
): { name: string; data: Record<string, unknown> } | null {
  if (!platformFingerprints || typeof platformFingerprints !== 'object') return null;
  const candidates = PLATFORM_KEY_TO_CN[key] ?? [];
  for (const cn of candidates) {
    if (cn in platformFingerprints) {
      const data = platformFingerprints[cn];
      if (data && typeof data === 'object') {
        return { name: cn, data: data as Record<string, unknown> };
      }
    }
  }
  return null;
}

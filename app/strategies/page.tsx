import { HomeNav } from '@/components/nav/HomeNav';
import { ARTICLE_CATEGORIES } from '@/lib/prompts/fingerprint-v3-stage0';
import { StrategyScout } from './StrategyScout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 策略侦察页：选「我要写哪一类」+「平台」→ 跨博主召出策略碎片。
 *
 * 用法：写文章前先来这里看一眼，挑 1-3 条想用的碎片，再回 compose。
 * 长期价值：随着库里的博主指纹越来越多，这一页的"灵感库"会变厚。
 */
export default function StrategiesPage() {
  return (
    <>
      <HomeNav activePath="/strategies" />
      <main className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <div className="fp-page-head">
          <div className="fp-page-head-left">
            <h1 className="fp-page-title">策略侦察</h1>
            <div className="fp-page-meta">
              <span>跨博主的可复用碎片，按类别 + 手法挑组合。</span>
            </div>
          </div>
        </div>
        <StrategyScout categories={[...ARTICLE_CATEGORIES]} />
      </main>
    </>
  );
}

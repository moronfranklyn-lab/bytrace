import { HomeNav } from '@/components/nav/HomeNav';
import { RecipeManager } from './RecipeManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 风格配方管理页：列出全部配方 + 新建入口 + 编辑/删除。
 *
 * 配方 = 用户给某个平台挑出来的"碎片组合"。
 * 比如「公众号 / 业界动态版」可能由「思敏学姐的开篇」+「半佛仙人的收尾」组成。
 * 写作时按平台筛配方，把碎片注入 prompt。
 */
export default function RecipesPage() {
  return (
    <>
      <HomeNav activePath="/recipes" />
      <main className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <div className="fp-page-head">
          <div className="fp-page-head-left">
            <h1 className="fp-page-title">风格配方</h1>
            <div className="fp-page-meta">
              <span>给每个平台搭一份"碎片组合"。写作时选配方，比每次重新挑省事得多。</span>
            </div>
          </div>
        </div>
        <RecipeManager />
      </main>
    </>
  );
}

import Link from 'next/link';
import { HomeNav } from '@/components/nav/HomeNav';

export default function NotFound() {
  return (
    <>
      <HomeNav activePath="/" />
      <main className="container not-found-page">
        <div className="not-found-eyebrow">404 · 这一页飞走了</div>
        <h1 className="not-found-title">
          找不到这扇门，<br />
          但你写的东西都还在。
        </h1>
        <p className="not-found-desc">
          也许是地址抄错了一个字，也许是这位博主的指纹已经被删掉了。
          回到工作台，看看刚才在写的那篇。
        </p>
        <div className="not-found-actions">
          <Link href="/" className="btn btn-primary">
            回到工作台
            <span className="btn-arrow">→</span>
          </Link>
          <Link href="/fingerprints" className="btn btn-secondary">
            看看指纹库
          </Link>
        </div>
      </main>
    </>
  );
}

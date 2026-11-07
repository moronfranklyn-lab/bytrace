import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 是 native binding，必须放到 serverExternalPackages，否则 Next 会尝试打包导致失败
  serverExternalPackages: ['better-sqlite3'],

  // API 路由配置
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Accel-Buffering', value: 'no' },
        ],
      },
    ];
  },
};

export default nextConfig;

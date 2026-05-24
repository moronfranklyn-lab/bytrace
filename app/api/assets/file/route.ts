import { NextRequest } from 'next/server';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { getLocalAssetById } from '@/lib/images/local';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function mimeOf(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * GET /api/assets/file?id=<local_asset_id>
 *
 * Stream a local asset by its ID. We never accept raw filesystem paths from
 * the client — only IDs that have to exist in `local_assets`. That keeps
 * this endpoint from becoming an arbitrary-file-read.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return new Response('missing id', { status: 400 });
  }
  const asset = getLocalAssetById(id);
  if (!asset) {
    return new Response('not found', { status: 404 });
  }
  if (!existsSync(asset.file_path)) {
    return new Response('file missing on disk', { status: 410 });
  }

  const stat = statSync(asset.file_path);
  const stream = createReadStream(asset.file_path);
  // Node Readable → web ReadableStream (Next 15 / Node 18+ supports this directly)
  const webStream = new ReadableStream({
    start(controller) {
      stream.on('data', (chunk: string | Buffer) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buf));
      });
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });

  return new Response(webStream, {
    headers: {
      'Content-Type': mimeOf(asset.file_path),
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, max-age=300',
    },
  });
}

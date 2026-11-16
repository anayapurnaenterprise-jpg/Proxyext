export const config = {
  runtime: 'edge',
  regions: ['iad1', 'fra1'],
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const stId = searchParams.get('id');
  const okId = searchParams.get('ok');
  const pdId = searchParams.get('pd');

  const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const mobileUA = 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const playerUA = 'Lavf/60.3.100'; // ExoPlayer / VLC Media Player User-Agent (Bypasses Pixeldrain Hotlink Check)

  try {
    let targetUrl = '';
    let referer = '';
    let cookieHeader = '';
    let customUA = desktopUA;

    // 1. PIXELDRAIN MODE (?pd=FILE_ID)
    if (pdId) {
      targetUrl = `https://pixeldrain.com/api/file/${pdId}`;
      customUA = playerUA;
      referer = '';
    }
    // 2. STREAMTAPE MODE (?id=VIDEO_ID)
    else if (stId) {
      const embedRes = await fetch(`https://streamtape.com/e/${stId}`, {
        headers: { 'User-Agent': desktopUA },
      });
      const html = await embedRes.text();

      const m1 = html.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(['"]([^'"]+)['"]\)/);
      const m2 = html.match(/robotlink'\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('([^']+)'\)\.substring\((\d+)\)/);

      if (m1) {
        targetUrl = 'https:' + m1[1] + m1[2].substring(3) + '&stream=1';
      } else if (m2) {
        targetUrl = 'https:' + m2[1] + m2[2].substring(parseInt(m2[3], 10)) + '&stream=1';
      }

      if (!targetUrl) {
        return new Response('Streamtape link extraction failed', { status: 404 });
      }
      referer = `https://streamtape.com/e/${stId}`;
    }
    // 3. OK.RU MODE (?ok=VIDEO_ID)
    else if (okId) {
      const embedRes = await fetch(`https://ok.ru/videoembed/${okId}?nochat=1`, {
        headers: {
          'User-Agent': desktopUA,
          'Referer': 'https://ok.ru/',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      const setCookie = embedRes.headers.get('set-cookie');
      if (setCookie) cookieHeader = setCookie;
      const html = await embedRes.text();
      targetUrl = parseOkruHtml(html);

      if (!targetUrl) {
        const mobRes = await fetch(`https://m.ok.ru/video/${okId}`, {
          headers: { 'User-Agent': mobileUA, 'Accept-Language': 'en-US,en;q=0.9' },
        });
        const mobCookie = mobRes.headers.get('set-cookie');
        if (mobCookie) cookieHeader = mobCookie;
        const mobHtml = await mobRes.text();
        targetUrl = parseOkruHtml(mobHtml);

        if (!targetUrl) {
          const cdnMatch = mobHtml.match(/https?:\/\/[^"'\\]+\.(?:mycdn\.me|okcdn\.ru)\/[^"'\\]+/i);
          if (cdnMatch) {
            targetUrl = cdnMatch[0].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
          }
        }
      }

      if (!targetUrl) {
        return new Response('OK.ru video is private or blocked', { status: 404 });
      }
      referer = 'https://ok.ru/';
    } else {
      return new Response('D Stream Proxy Active! Use ?id=STREAMTAPE_ID, ?ok=OKRU_ID, or ?pd=PIXELDRAIN_ID', { status: 200 });
    }

    const fetchHeaders = new Headers();
    fetchHeaders.set('User-Agent', customUA);
    if (referer) fetchHeaders.set('Referer', referer);
    if (cookieHeader) fetchHeaders.set('Cookie', cookieHeader);

    const rangeHeader = req.headers.get('range');
    if (rangeHeader) fetchHeaders.set('Range', rangeHeader);

    const upstream = await fetch(targetUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
    });

    const responseHeaders = new Headers();
    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((h) => {
      if (upstream.headers.has(h)) {
        responseHeaders.set(h, upstream.headers.get(h));
      }
    });
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response('Proxy Error: ' + err.message, { status: 502 });
  }
}

function parseOkruHtml(html) {
  const optMatch = html.match(/data-options="([^"]+)"/i);
  if (!optMatch) return '';
  try {
    const decoded = optMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
    const data = JSON.parse(decoded);
    if (data?.flashvars?.metadata) {
      const meta = typeof data.flashvars.metadata === 'string' ? JSON.parse(data.flashvars.metadata) : data.flashvars.metadata;
      if (Array.isArray(meta.videos) && meta.videos.length > 0) {
        const rank = { full: 5, hd: 4, sd: 3, low: 2, lowest: 1, mobile: 0 };
        meta.videos.sort((a, b) => (rank[b.name] || 0) - (rank[a.name] || 0));
        return meta.videos[0].url || '';
      }
      if (meta.hlsMasterPlaylistUrl) return meta.hlsMasterPlaylistUrl;
    }
  } catch (e) {}
  return '';
}

export const config = {
  runtime: 'edge',
  regions: ['sin1', 'iad1'],
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const stId = searchParams.get('id');
  const okId = searchParams.get('ok');

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

  try {
    let targetUrl = '';
    let referer = '';
    let cookieHeader = '';

    // 1. STREAMTAPE MODE (?id=VIDEO_ID)
    if (stId) {
      const embedRes = await fetch(`https://streamtape.com/e/${stId}`, {
        headers: { 'User-Agent': ua },
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

    // 2. OK.RU MODE (?ok=VIDEO_ID) - Same-IP Extraction + Cookie Forwarding
    else if (okId) {
      const embedRes = await fetch(`https://ok.ru/videoembed/${okId}`, {
        headers: {
          'User-Agent': ua,
          'Referer': 'https://ok.ru/',
        },
      });

      const setCookie = embedRes.headers.get('set-cookie');
      if (setCookie) {
        cookieHeader = setCookie;
      }

      const html = await embedRes.text();
      const optMatch = html.match(/data-options="([^"]+)"/i);

      if (optMatch) {
        const decoded = optMatch[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&#039;/g, "'");
        const data = JSON.parse(decoded);

        if (data?.flashvars?.metadata) {
          const meta = JSON.parse(data.flashvars.metadata);
          if (Array.isArray(meta.videos) && meta.videos.length > 0) {
            const rank = { full: 5, hd: 4, sd: 3, low: 2, lowest: 1, mobile: 0 };
            meta.videos.sort((a, b) => (rank[b.name] || 0) - (rank[a.name] || 0));
            targetUrl = meta.videos[0].url;
          } else if (meta.hlsMasterPlaylistUrl) {
            targetUrl = meta.hlsMasterPlaylistUrl;
          }
        }
      }

      if (!targetUrl) {
        return new Response('OK.ru video is private or blocked', { status: 404 });
      }
      referer = 'https://ok.ru/';
    } else {
      return new Response('D Stream Proxy Active! Use ?id=STREAMTAPE_ID or ?ok=OKRU_ID', { status: 200 });
    }

    // Stream video with Range & Cookie support
    const fetchHeaders = new Headers();
    fetchHeaders.set('User-Agent', ua);
    fetchHeaders.set('Referer', referer);
    if (cookieHeader) {
      fetchHeaders.set('Cookie', cookieHeader);
    }

    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
      fetchHeaders.set('Range', rangeHeader);
    }

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

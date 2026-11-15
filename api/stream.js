export const config = {
  runtime: 'edge',
  regions: ['sin1', 'iad1'], // Forces Singapore & US servers (bypasses India bom1 region)
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get('id');

  if (!videoId) {
    return new Response('Proxy is Active! Add ?id=VIDEO_ID to stream.', { status: 200 });
  }

  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

    const embedRes = await fetch(`https://streamtape.com/e/${videoId}`, {
      headers: { 'User-Agent': ua },
    });
    const html = await embedRes.text();

    let directUrl = '';
    const m1 = html.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(['"]([^'"]+)['"]\)/);
    const m2 = html.match(/robotlink'\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('([^']+)'\)\.substring\((\d+)\)/);

    if (m1) {
      directUrl = 'https:' + m1[1] + m1[2].substring(3) + '&stream=1';
    } else if (m2) {
      directUrl = 'https:' + m2[1] + m2[2].substring(parseInt(m2[3], 10)) + '&stream=1';
    }

    if (!directUrl) {
      return new Response('Could not extract video stream from Streamtape', { status: 404 });
    }

    const fetchHeaders = new Headers();
    fetchHeaders.set('User-Agent', ua);
    fetchHeaders.set('Referer', `https://streamtape.com/e/${videoId}`);

    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
      fetchHeaders.set('Range', rangeHeader);
    }

    const upstream = await fetch(directUrl, {
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

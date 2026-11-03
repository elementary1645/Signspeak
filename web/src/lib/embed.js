// Only official videos that the platform itself lets sites embed (YouTube) are embedded,
// via the privacy-enhanced youtube-nocookie domain. Everything else is a link. Never rehosted.
export function embedUrl(reference) {
  let url;
  try { url = new URL(reference); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtube.com' && url.pathname === '/watch') id = url.searchParams.get('v');
  else if (host === 'youtube.com' && /^\/(shorts|embed)\//.test(url.pathname)) id = url.pathname.split('/')[2];
  else if (host === 'youtu.be') id = url.pathname.slice(1);
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

export const youtubeVideoId = (value) => {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(url.hostname.toLowerCase())) return '';
    const id = url.hostname.toLowerCase().endsWith('youtu.be')
      ? url.pathname.split('/').filter(Boolean)[0]
      : url.pathname === '/watch'
        ? url.searchParams.get('v')
        : url.pathname.match(/^\/(?:embed|shorts)\/([^/?#]+)/)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? id : '';
  } catch {
    return '';
  }
};

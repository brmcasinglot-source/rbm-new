export function getYouTubeThumbnail(videoUrl) {
  if (!videoUrl) return "";
  let url;
  try {
    url = new URL(videoUrl);
  } catch {
    return "";
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";
  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
    videoId = url.searchParams.get("v") || "";
    if (!videoId) {
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
      videoId = match?.[1] || "";
    }
  }

  return /^[A-Za-z0-9_-]{11}$/.test(videoId)
    ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    : "";
}

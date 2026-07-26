// Runs on youtube.com/watch pages. YouTube is a single-page app, so
// navigation between videos doesn't reload this script — we detect video
// changes by polling the URL and the <video> element instead of relying on
// a full page load per video.

interface WatchSession {
  videoId: string;
  title: string;
  channel: string;
  url: string;
  watchedSeconds: number;
  lastSampledAt: number;
}

const SAMPLE_INTERVAL_MS = 5000;
const MIN_REPORTABLE_SECONDS = 5;

let currentSession: WatchSession | null = null;

function getVideoIdFromUrl(): string | null {
  return new URL(location.href).searchParams.get("v");
}

function getVideoTitle(): string {
  const titleEl = document.querySelector<HTMLElement>(
    "h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string"
  );
  return titleEl?.textContent?.trim() || document.title.replace(/ - YouTube$/, "");
}

function getChannelName(): string {
  const channelEl = document.querySelector<HTMLElement>(
    "ytd-channel-name a, #channel-name a, #owner #channel-name a"
  );
  return channelEl?.textContent?.trim() || "";
}

function finalizeSession(): void {
  if (!currentSession) return;

  if (currentSession.watchedSeconds >= MIN_REPORTABLE_SECONDS) {
    chrome.runtime.sendMessage({
      type: "youtube-watch-event",
      payload: {
        videoTitle: currentSession.title,
        channelName: currentSession.channel,
        videoUrl: currentSession.url,
        durationSeconds: Math.round(currentSession.watchedSeconds),
        watchedAt: new Date().toISOString(),
      },
    });
  }

  currentSession = null;
}

function sampleWatchTime(): void {
  const videoId = getVideoIdFromUrl();
  const video = document.querySelector("video");

  if (!videoId || !video) {
    finalizeSession();
    return;
  }

  if (!currentSession || currentSession.videoId !== videoId) {
    finalizeSession();
    currentSession = {
      videoId,
      title: getVideoTitle(),
      channel: getChannelName(),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      watchedSeconds: 0,
      lastSampledAt: Date.now(),
    };
  }

  // Title/channel metadata can load in async after the first sample.
  if (!currentSession.title) currentSession.title = getVideoTitle();
  if (!currentSession.channel) currentSession.channel = getChannelName();

  const now = Date.now();
  const elapsedSeconds = (now - currentSession.lastSampledAt) / 1000;
  currentSession.lastSampledAt = now;

  if (!video.paused && !video.ended) {
    currentSession.watchedSeconds += elapsedSeconds;
  }
}

setInterval(sampleWatchTime, SAMPLE_INTERVAL_MS);
window.addEventListener("beforeunload", finalizeSession);
// Fired by YouTube's own router on SPA navigation between videos.
document.addEventListener("yt-navigate-finish", () => {
  setTimeout(sampleWatchTime, 500);
});

// Runs on youtube.com/watch pages. YouTube is a single-page app, so
// navigation between videos doesn't reload this script — we detect video
// changes by polling the URL and the <video> element instead of relying on
// a full page load per video.

interface WatchSession {
  videoId: string;
  title: string;
  channel: string;
  topic: string | null;
  url: string;
  watchedSeconds: number;
  lastSampledAt: number;
}

const SAMPLE_INTERVAL_MS = 5000;
const REPORT_INTERVAL_MS = 60000; // send a chunk at least this often, even mid-video
const MIN_REPORTABLE_SECONDS = 5;

let currentSession: WatchSession | null = null;

function getVideoIdFromUrl(): string | null {
  const url = new URL(location.href);
  const watchId = url.searchParams.get("v");
  if (watchId) return watchId;

  // Shorts don't use a ?v= param — the id is the path segment instead.
  const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]+)/);
  return shortsMatch ? shortsMatch[1] : null;
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

// Best-effort only: this reads the "Game"/"Music in this video" info card
// YouTube shows under the description when it auto-recognizes the content.
// It's absent on most videos, and the selector may need updating if
// YouTube changes this section's markup — that's fine, it just degrades
// to null rather than breaking anything else.
function getTopicName(): string | null {
  const topicEl = document.querySelector<HTMLElement>(
    "ytd-rich-metadata-renderer #title, ytd-rich-metadata-renderer yt-formatted-string#title"
  );
  return topicEl?.textContent?.trim() || null;
}

function reportChunk(session: WatchSession): void {
  if (session.watchedSeconds < MIN_REPORTABLE_SECONDS) {
    console.log(
      `[Pocrastinados] chunk too short to report (${session.watchedSeconds.toFixed(1)}s < ${MIN_REPORTABLE_SECONDS}s) for "${session.title}"`
    );
    return;
  }

  console.log(`[Pocrastinados] reporting ${Math.round(session.watchedSeconds)}s for "${session.title}"`);

  chrome.runtime.sendMessage({
    type: "youtube-watch-event",
    payload: {
      videoTitle: session.title,
      channelName: session.channel,
      topicName: session.topic,
      videoUrl: session.url,
      durationSeconds: Math.round(session.watchedSeconds),
      watchedAt: new Date().toISOString(),
    },
  });
}

// Sends whatever has accumulated and ends the session (video changed, tab closing).
function finalizeSession(): void {
  if (!currentSession) return;
  reportChunk(currentSession);
  currentSession = null;
}

// Sends whatever has accumulated so far but keeps the session open, so a
// single long video still shows up without waiting for it to end.
function flushChunk(): void {
  if (!currentSession || currentSession.watchedSeconds === 0) return;
  reportChunk(currentSession);
  currentSession.watchedSeconds = 0;
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
      topic: getTopicName(),
      url: location.href,
      watchedSeconds: 0,
      lastSampledAt: Date.now(),
    };
    console.log(`[Pocrastinados] now tracking "${currentSession.title}" (${videoId})`);
  }

  // Title/channel/topic metadata can load in async after the first sample.
  if (!currentSession.title) currentSession.title = getVideoTitle();
  if (!currentSession.channel) currentSession.channel = getChannelName();
  if (!currentSession.topic) currentSession.topic = getTopicName();

  const now = Date.now();
  const elapsedSeconds = (now - currentSession.lastSampledAt) / 1000;
  currentSession.lastSampledAt = now;

  if (!video.paused && !video.ended) {
    currentSession.watchedSeconds += elapsedSeconds;
  }
}

console.log("[Pocrastinados] content script active on", location.href);

setInterval(sampleWatchTime, SAMPLE_INTERVAL_MS);
setInterval(flushChunk, REPORT_INTERVAL_MS);
window.addEventListener("beforeunload", finalizeSession);
// Fired by YouTube's own router on SPA navigation between videos.
document.addEventListener("yt-navigate-finish", () => {
  setTimeout(sampleWatchTime, 500);
});

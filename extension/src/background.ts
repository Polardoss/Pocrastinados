// Queues YouTube watch events reported by the content script in
// chrome.storage.local and flushes them to the Pocrastinados ingestion
// endpoint on a timer, so a temporary network hiccup doesn't lose events.

interface QueuedEvent {
  videoTitle: string;
  channelName: string;
  videoUrl: string;
  durationSeconds: number;
  watchedAt: string;
}

interface StoredSettings {
  ingestUrl?: string;
  ingestSecret?: string;
}

const QUEUE_KEY = "pocrastinados_queue";
const FLUSH_ALARM = "pocrastinados-flush";

async function getQueue(): Promise<QueuedEvent[]> {
  const stored = (await chrome.storage.local.get(QUEUE_KEY)) as Record<string, QueuedEvent[]>;
  return stored[QUEUE_KEY] ?? [];
}

async function setQueue(queue: QueuedEvent[]): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

async function enqueue(event: QueuedEvent): Promise<void> {
  const queue = await getQueue();
  queue.push(event);
  await setQueue(queue);
}

async function flushQueue(): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) return;

  const { ingestUrl, ingestSecret } = (await chrome.storage.local.get([
    "ingestUrl",
    "ingestSecret",
  ])) as StoredSettings;

  if (!ingestUrl || !ingestSecret) return;

  try {
    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ingestSecret}`,
      },
      body: JSON.stringify({ events: queue }),
    });

    if (res.ok) {
      await setQueue([]);
    }
  } catch {
    // Offline or endpoint unreachable — keep the queue for the next alarm.
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "youtube-watch-event") {
    enqueue(message.payload).then(flushQueue);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) flushQueue();
});

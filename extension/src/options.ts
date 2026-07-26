interface StoredSettings {
  ingestUrl?: string;
  ingestSecret?: string;
}

async function load(): Promise<void> {
  const { ingestUrl, ingestSecret } = (await chrome.storage.local.get([
    "ingestUrl",
    "ingestSecret",
  ])) as StoredSettings;

  const urlInput = document.getElementById("ingestUrl") as HTMLInputElement | null;
  const secretInput = document.getElementById("ingestSecret") as HTMLInputElement | null;
  if (urlInput) urlInput.value = ingestUrl ?? "";
  if (secretInput) secretInput.value = ingestSecret ?? "";
}

function showStatus(message: string): void {
  const status = document.getElementById("status");
  if (!status) return;
  status.textContent = message;
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
}

document.getElementById("save")?.addEventListener("click", async () => {
  const urlInput = document.getElementById("ingestUrl") as HTMLInputElement;
  const secretInput = document.getElementById("ingestSecret") as HTMLInputElement;

  await chrome.storage.local.set({
    ingestUrl: urlInput.value.trim(),
    ingestSecret: secretInput.value.trim(),
  });

  showStatus("Enregistré.");
});

load();

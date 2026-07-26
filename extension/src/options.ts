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

function showStatus(message: string, isError = false): void {
  const status = document.getElementById("status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
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

// Sends an empty event batch: exercises permissions/CORS/auth/reachability
// without writing anything to the database (the route returns early on an
// empty events array, before touching Supabase).
document.getElementById("test")?.addEventListener("click", async () => {
  const urlInput = document.getElementById("ingestUrl") as HTMLInputElement;
  const secretInput = document.getElementById("ingestSecret") as HTMLInputElement;
  const ingestUrl = urlInput.value.trim();
  const ingestSecret = secretInput.value.trim();

  if (!ingestUrl || !ingestSecret) {
    showStatus("Renseigne l'URL et le secret avant de tester.", true);
    return;
  }

  showStatus("Test en cours…");

  try {
    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ingestSecret}` },
      body: JSON.stringify({ events: [] }),
    });

    if (res.status === 401) {
      showStatus("Échec : secret refusé (401). Vérifie qu'il correspond à YOUTUBE_INGEST_SECRET sur Vercel.", true);
    } else if (res.status === 500) {
      const body = await res.text().catch(() => "");
      showStatus(`Échec : le serveur signale une erreur 500. ${body}`, true);
    } else if (res.ok) {
      showStatus("OK — la connexion et le secret fonctionnent.");
    } else {
      showStatus(`Échec : HTTP ${res.status} ${res.statusText}`, true);
    }
  } catch (error) {
    showStatus(
      `Échec réseau : ${error instanceof Error ? error.message : String(error)} — probablement bloqué par les permissions de l'extension (host_permissions) ou par CORS.`,
      true
    );
  }
});

load();

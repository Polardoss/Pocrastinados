import { config } from "dotenv";
import { syncSteamPlaytime } from "../src/lib/steam";

config({ path: ".env.local" });
config();

async function main() {
  const result = await syncSteamPlaytime();
  console.log(
    `Steam sync complete: ${result.gamesProcessed} games processed, ${result.sessionsCreated} session(s) created (captured at ${result.capturedAt}).`
  );
}

main().catch((error) => {
  console.error("Steam sync failed:", error);
  process.exitCode = 1;
});

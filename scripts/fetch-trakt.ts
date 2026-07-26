import { config } from "dotenv";
import { syncTraktHistory } from "../src/lib/trakt";

config({ path: ".env.local" });
config();

async function main() {
  const result = await syncTraktHistory();
  console.log(
    `Trakt sync complete: ${result.itemsFetched} item(s) fetched over ${result.pagesFetched} page(s), ${result.itemsInserted} inserted.`
  );
}

main().catch((error) => {
  console.error("Trakt sync failed:", error);
  process.exitCode = 1;
});

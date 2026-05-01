import { runMigrationCli } from "./migrate-existing-folders";

runMigrationCli()
  .then(() => {
    console.log("[migrate-folders] done");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[migrate-folders] failed:", err);
    process.exit(1);
  });

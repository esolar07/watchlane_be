import { config } from "./config/env";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import routes from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { syncAllMailboxes } from "./jobs/sync-mailboxes";
import { schedule } from "node-cron";

const app = express();

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.json({ message: "Watchlane API is running" });
});

app.use("/api", routes);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});

schedule("*/5 * * * *", () => {syncAllMailboxes()}, {
  timezone: "America/New_York"
});

import { config } from "../config/env";
import { sendEmail } from "../services/email.service";
import { buildOwnerWelcomeEmail } from "../lib/email-templates/owner-welcome";

const TEST_RECIPIENT = { name: "Eddie Solar", address: "esolar07@gmail.com" };

async function main(): Promise<void> {
  const content = buildOwnerWelcomeEmail({ ownerName: "Eddie", workspaceName: "Eddie's Workspace" });
  const result = await sendEmail({
    from: { name: config.email.fromName, address: config.email.fromAddress },
    to: [TEST_RECIPIENT],
    ...content,
  });
  console.log("[test-welcome] sent:", result);
}

main().catch((err) => {
  console.error("[test-welcome] failed:", err);
  process.exit(1);
});

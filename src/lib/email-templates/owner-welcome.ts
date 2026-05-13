import { EmailMessage } from "../../types/email-provider";

type OwnerWelcomeContext = {
  ownerName: string;
  workspaceName: string;
};

const GETTING_STARTED_TIPS = [
  "Create your organization — set up your workspace for support, sales, customer success, or operations.",
  "Connect your mailbox — connect a shared inbox or individual mailbox to begin monitoring customer conversations.",
  "Monitor what needs attention — track overdue threads, SLA risk, and response coverage in real time.",
];

const OWNER_WELCOME_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Watchlane</title>
</head>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:Inter,Arial,sans-serif;color:#1f2937;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#f6f7fb;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="height:8px;background:#27374d;"></td>
          </tr>
          <tr>
            <td style="padding:48px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:36px;">
                    <img
                      src="https://watchlane.app/logo.svg"
                      alt="Watchlane"
                      width="190"
                      style="display:block;border:0;outline:none;text-decoration:none;"
                    />
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;">
                    <h1 style="margin:0;font-size:34px;line-height:1.2;font-weight:700;color:#1f2937;">
                      Welcome to Watchlane
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:28px;">
                    <p style="margin:0;font-size:17px;line-height:1.7;color:#4b5563;">
                      Watchlane gives customer-facing teams real-time visibility into overdue conversations, SLA risk, and inbox coverage — so nothing slips through the cracks.
                    </p>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:28px;">
                    <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:#27374d;margin-bottom:8px;">STEP 1</div>
                    <div style="font-size:20px;font-weight:600;color:#1f2937;margin-bottom:6px;">Create your organization</div>
                    <div style="font-size:15px;line-height:1.7;color:#6b7280;">Set up your workspace for support, sales, customer success, or operations.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:28px;">
                    <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:#27374d;margin-bottom:8px;">STEP 2</div>
                    <div style="font-size:20px;font-weight:600;color:#1f2937;margin-bottom:6px;">Connect your mailbox</div>
                    <div style="font-size:15px;line-height:1.7;color:#6b7280;">Connect a shared inbox or individual mailbox to begin monitoring customer conversations.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:10px;">
                    <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:#27374d;margin-bottom:8px;">STEP 3</div>
                    <div style="font-size:20px;font-weight:600;color:#1f2937;margin-bottom:6px;">Monitor what needs attention</div>
                    <div style="font-size:15px;line-height:1.7;color:#6b7280;">Track overdue threads, SLA risk, and response coverage in real time.</div>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:36px 0 12px 0;">
                    <a
                      href="https://watchlane.app"
                      style="display:inline-block;background:#27374d;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:15px 28px;border-radius:12px;"
                    >
                      Open Watchlane
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#222f42;padding:28px 40px;">
              <p style="margin:0;font-size:14px;line-height:1.8;color:#d1d5db;">
                Never miss a customer email again.<br />
                Real-time inbox SLA visibility for customer-facing teams.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

function buildTextBody(ctx: OwnerWelcomeContext): string {
  const intro = `Hi ${ctx.ownerName},\n\nWelcome to Watchlane. Your workspace "${ctx.workspaceName}" is ready.\n\nHere's how to get started:\n\n`;
  const steps = GETTING_STARTED_TIPS.map((tip, i) => `${i + 1}. ${tip}`).join("\n");
  const outro = `\n\nOpen Watchlane: https://watchlane.app\n\n— The Watchlane team`;
  return `${intro}${steps}${outro}`;
}

export function buildOwnerWelcomeEmail(ctx: OwnerWelcomeContext): Omit<EmailMessage, "from" | "to"> {
  return {
    subject: `Welcome to Watchlane, ${ctx.ownerName}`,
    text: buildTextBody(ctx),
    html: OWNER_WELCOME_HTML,
  };
}

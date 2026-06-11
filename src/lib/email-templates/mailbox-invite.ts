import { EmailMessage } from "../../types/email-provider";

type MailboxInviteContext = {
  teamName: string;
  inviteUrl: string;
};

function buildTextBody(ctx: MailboxInviteContext): string {
  const intro = `Hi,\n\n${ctx.teamName} on Watchlane has invited you to connect your Microsoft mailbox so the team can monitor customer-facing conversations.\n\n`;
  const action = `Connect your mailbox: ${ctx.inviteUrl}\n\n`;
  const note = `You will not be creating a Watchlane account — this link only attaches your mailbox to ${ctx.teamName}.\n\n— The Watchlane team`;
  return `${intro}${action}${note}`;
}

function buildHtmlBody(ctx: MailboxInviteContext): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connect your mailbox to Watchlane</title>
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
                    <img src="https://watchlane.app/logo.svg" alt="Watchlane" width="190" style="display:block;border:0;outline:none;text-decoration:none;" />
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:16px;">
                    <h1 style="margin:0;font-size:30px;line-height:1.2;font-weight:700;color:#1f2937;">Connect your mailbox</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:28px;">
                    <p style="margin:0;font-size:17px;line-height:1.7;color:#4b5563;">
                      <strong>${ctx.teamName}</strong> on Watchlane has invited you to connect your Microsoft mailbox so the team can monitor customer-facing conversations for SLA risk and coverage.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:24px;">
                    <p style="margin:0;font-size:15px;line-height:1.7;color:#6b7280;">
                      You will not be creating a Watchlane account. This link only attaches your mailbox to <strong>${ctx.teamName}</strong>.
                    </p>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:12px 0 8px 0;">
                    <a href="${ctx.inviteUrl}" style="display:inline-block;background:#27374d;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:15px 28px;border-radius:12px;">Connect mailbox</a>
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
}

export function buildMailboxConnectInviteEmail(ctx: MailboxInviteContext): Omit<EmailMessage, "from" | "to"> {
  return {
    subject: `Connect your mailbox to ${ctx.teamName} on Watchlane`,
    text: buildTextBody(ctx),
    html: buildHtmlBody(ctx),
  };
}

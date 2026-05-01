import { prisma } from "../lib/prisma";
import { getValidAccessToken } from "../lib/microsoft";
import { GRAPH_BASE } from "../lib/microsoft-graph";

async function main() {
  const account = await prisma.emailAccount.findFirstOrThrow({
    where: { emailAddress: "watchlanedemo@outlook.com" },
    select: { id: true },
  });
  const accessToken = await getValidAccessToken(account.id);

  const threadSubjects = ["Welcome to your new Outlook.com account", "Microsoft account security info was added", "Get to know your OneDrive", "New app(s) connected", "Don"];
  for (const subjectPart of threadSubjects) {
    const thread = await prisma.thread.findFirst({
      where: { subject: { contains: subjectPart } },
      select: { subject: true, messages: { where: { direction: "INBOUND" }, select: { externalId: true }, take: 1 } },
    });
    if (!thread || thread.messages.length === 0) { console.log(`No DB match for "${subjectPart}"`); continue; }
    const externalId = thread.messages[0].externalId;
    const res = await fetch(`${GRAPH_BASE}/messages/${externalId}?$select=id,subject,parentFolderId`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      console.log(`"${thread.subject}"`);
      console.log(`  Graph status=${res.status}  → message NOT FOUND in Outlook`);
      continue;
    }
    const data = await res.json() as { subject: string; parentFolderId: string };
    const folder = await prisma.emailFolder.findFirst({ where: { externalId: data.parentFolderId, emailAccountId: account.id }, select: { name: true, systemKind: true } });
    console.log(`"${thread.subject}"`);
    console.log(`  Currently in Outlook folder: "${folder?.name ?? "UNKNOWN"}" (systemKind=${folder?.systemKind ?? "—"})`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

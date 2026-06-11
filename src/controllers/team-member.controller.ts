import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ValidationError } from "../lib/errors";
import { findOrCreatePlaceholderUser } from "../services/user.service";
import { assertCallerCanManageTeam } from "../services/team-access.service";
import type { TeamRole } from "../generated/prisma/client";

interface AddMemberBody { email: string; role?: TeamRole }
interface UpdateMemberBody { role: TeamRole }

const MEMBER_USER_SELECT = { id: true, email: true, name: true } as const;

export async function listTeamMembers(req: Request<{ teamId: string }>, res: Response) {
  const teamId = req.params.teamId;
  await assertCallerCanManageTeam(req.user!.userId, teamId);
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    include: { user: { select: MEMBER_USER_SELECT } },
  });
  res.json({ members });
}

export async function addTeamMember(req: Request<{ teamId: string }, {}, AddMemberBody>, res: Response) {
  const teamId = req.params.teamId;
  await assertCallerCanManageTeam(req.user!.userId, teamId);
  const { email, role = "MEMBER" } = req.body ?? ({} as AddMemberBody);
  if (!email) throw new ValidationError("email is required");
  const user = await findOrCreatePlaceholderUser(email);
  const member = await upsertTeamMember(user.id, teamId, role);
  res.status(201).json({ member });
}

async function upsertTeamMember(userId: string, teamId: string, role: TeamRole) {
  return prisma.teamMember.upsert({
    where: { userId_teamId: { userId, teamId } },
    create: { userId, teamId, role },
    update: { role },
    include: { user: { select: MEMBER_USER_SELECT } },
  });
}

export async function updateTeamMember(req: Request<{ teamId: string; memberId: string }, {}, UpdateMemberBody>, res: Response) {
  const { teamId, memberId } = req.params;
  await assertCallerCanManageTeam(req.user!.userId, teamId);
  if (!req.body?.role) throw new ValidationError("role is required");
  const member = await prisma.teamMember.update({
    where: { id: memberId },
    data: { role: req.body.role },
    include: { user: { select: MEMBER_USER_SELECT } },
  });
  res.json({ member });
}

export async function removeTeamMember(req: Request<{ teamId: string; memberId: string }>, res: Response) {
  const { teamId, memberId } = req.params;
  await assertCallerCanManageTeam(req.user!.userId, teamId);
  await prisma.teamMember.delete({ where: { id: memberId } });
  res.status(204).end();
}

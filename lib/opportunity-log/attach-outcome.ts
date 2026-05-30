// ─── OPPORTUNITY LOG — RESOLVE OUTCOME ──────────────────────────────────────
// Update an opportunity row with the realized outcome. Used by:
//   - paper-engine on position close (taken trades)
//   - monitor-skipped when a skipped signal's would-have stop/target hits
//   - session close handler for inconclusive skipped signals

import { prisma } from '../prisma'

export type OutcomeLabel = 'win' | 'loss' | 'be' | 'inconclusive'

export interface ResolveOutcomeInput {
  opportunityId: string
  label: OutcomeLabel
  outcomeR: number
  mfeR: number
  maeR: number
}

export async function resolveOutcome(input: ResolveOutcomeInput): Promise<void> {
  await prisma.signalOpportunity.update({
    where: { id: input.opportunityId },
    data: {
      outcomeStatus: 'resolved',
      outcomeLabel: input.label,
      outcomeR: input.outcomeR,
      mfeR: input.mfeR,
      maeR: input.maeR,
      resolvedAt: new Date(),
    },
  })
}

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create default settings (id=1 is the singleton).
  // On re-seed, re-assert the fixed 50K-combine rules + the order-execution
  // safety lock so existing rows can never drift. Secrets (API keys, telegram
  // tokens) and user-tunable toggles are intentionally left out of `update` so
  // they are preserved across deploys.
  const combineRules = {
    accountSize: 50000,
    dailyLossLimit: 1000,
    trailingDrawdown: 2000,
    profitTarget: 3000,
    enableOrderExecution: false,
  }
  await prisma.settings.upsert({
    where: { id: 1 },
    update: combineRules,
    create: {
      id: 1,
      ...combineRules,
      maxTradesPerDay: 2,
      maxLosingTradesPerDay: 2,
      mnqEnabled: true,
      nqEnabled: false,
      topstepxUsername: "",
    },
  })

  // Create default broker connection scaffold
  await prisma.brokerConnection.upsert({
    where: { id: 'topstepx-main' },
    update: {},
    create: {
      id: 'topstepx-main',
      provider: 'topstepx',
      status: 'disconnected',
      notes: 'TopstepX read-only API — scaffold ready, not yet activated',
    },
  })

  console.log('Seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

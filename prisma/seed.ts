import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create default settings (id=1 is the singleton)
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {
      accountSize: 50000,
      dailyLossLimit: 1000,
      trailingDrawdown: 2000,
      profitTarget: 3000,
    },
    create: {
      id: 1,
      accountSize: 50000,
      dailyLossLimit: 1000,
      trailingDrawdown: 2000,
      profitTarget: 3000,
      maxTradesPerDay: 2,
      maxLosingTradesPerDay: 2,
      mnqEnabled: true,
      nqEnabled: false,
      enableOrderExecution: false,
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

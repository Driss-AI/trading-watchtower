/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
    instrumentationHook: true,
  },
  async redirects() {
    return [
      {
        source: '/stats',
        destination: '/performance',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig

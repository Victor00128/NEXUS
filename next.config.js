/** @type {import('next').NextConfig} */

// Static export (GitHub Pages / Netlify) can't run a server, so it can't proxy.
// For local use (`next dev` / `next start`) we DO want a server-side proxy so
// the browser can reach NVIDIA NIM, which does not send CORS headers and would
// otherwise block every direct fetch from the page.
//
// Set NEXT_STATIC_EXPORT=1 to produce the static bundle for hosting.
const isStaticExport = process.env.NEXT_STATIC_EXPORT === '1'

const nextConfig = {
  reactStrictMode: true,
  ...(isStaticExport ? { output: 'export' } : {}),
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  async rewrites() {
    // Rewrites only apply in server mode (ignored by static export).
    return [
      {
        source: '/__nvidia/:path*',
        destination: 'https://integrate.api.nvidia.com/:path*',
      },
      {
        source: '/__openrouter/:path*',
        destination: 'https://openrouter.ai/api/:path*',
      },
    ]
  },
}

module.exports = nextConfig

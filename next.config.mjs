/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  // pg opens real TCP sockets and keeps a pool, so it must stay outside the bundler.
  serverExternalPackages: ['pg'],
};

export default nextConfig;

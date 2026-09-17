/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  // pg opens real TCP sockets and keeps a pool, so it must stay outside the bundler.
  serverExternalPackages: ['pg'],

  /**
   * The Support Bot lives at /bots/support. It was briefly at /bots/father, before it was
   * named, and this keeps that address working — a redirect rather than a note, because a
   * 404 on a URL somebody saved reads as a broken product rather than a moved page.
   *
   * Permanent, since the move is: the old name is not coming back. `destination` carries no
   * query string because the page never took one.
   */
  async redirects() {
    return [{ source: '/bots/father', destination: '/bots/support', permanent: true }];
  },
};

export default nextConfig;

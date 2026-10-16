/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['nodemailer'],
  },
  eslint: { ignoreDuringBuilds: true },
  webpack: (config, { webpack }) => {
    // ws is bundled into the server/SSR graph (transitively via socket.io-client
    // → engine.io-client), so it must NOT go into serverComponentsExternalPackages
    // (that breaks the client-SSR bundle). Instead make its optional native
    // deps fail to resolve so ws falls back to its pure-JS mask/unmask path —
    // otherwise webpack stubs them as empty objects and every outgoing frame
    // ≥48 bytes crashes with "bufferUtil.mask is not a function".
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^bufferutil$/, contextRegExp: /ws/ }),
      new webpack.IgnorePlugin({ resourceRegExp: /^utf-8-validate$/, contextRegExp: /ws/ }),
    );
    return config;
  },
};

export default nextConfig;

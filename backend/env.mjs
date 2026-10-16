// Load .env before any other module runs. ESM evaluates imports depth-first
// in declaration order, so importing this first in server.mjs guarantees the
// proxy variables exist before Bitget REST/WS clients initialize.
// (Node >=20.12 also has process.loadEnvFile; the flag-free import keeps
// dev, prod and the node:20 Docker image on one path.)
try {
  process.loadEnvFile();
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    console.log(`[env] loaded .env — exchange proxy: ${process.env.HTTPS_PROXY || process.env.HTTP_PROXY}`);
  }
} catch {
  // no .env file — fine, environment may provide variables directly
}

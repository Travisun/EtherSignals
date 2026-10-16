import { fetchRepoMeta } from "@/lib/github";
import { jsonOk } from "@/lib/api/respond";

export const revalidate = 3600;

/** GET /api/github/stars, cached repo metadata for the star badge. */
export async function GET() {
  const meta = await fetchRepoMeta();
  return jsonOk(meta, { headers: { "Cache-Control": "no-store" } });
}

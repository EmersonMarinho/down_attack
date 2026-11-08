import { send } from "h3";
import { renderSolarePlayerOgPng } from "~~/server/utils/solareOgCard.js";

export default controller.handle({
  get: async (event) => {
    const query = getQuery(event);
    const headers = getHeaders(event);
    const hasExplicitRegion =
      typeof query.region === "string"
        ? query.region.trim().length > 0
        : Boolean(query.region);
    const trimmedVersionKey = typeof query.v === "string" ? query.v.trim() : "";
    const hasVersionKey =
      trimmedVersionKey.length > 0 && trimmedVersionKey.length <= 128;

    const playerSummary = await solare.getPlayerSummary({
      nick: query.nick,
      region: hasExplicitRegion
        ? query.region
        : solare.inferRegionFromHeaders(headers),
      season: query.season,
    });

    const pngBytes = await renderSolarePlayerOgPng(playerSummary);

    setHeader(
      event,
      "Cache-Control",
      hasVersionKey
        ? "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800"
        : "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
    if (!hasExplicitRegion) {
      setHeader(
        event,
        "Vary",
        "x-vercel-ip-country, cf-ipcountry, x-country-code",
      );
    }

    return send(event, Buffer.from(pngBytes), "image/png");
  },
});

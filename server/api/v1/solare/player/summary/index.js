export default controller.handle({
  get: async (event) => {
    const query = getQuery(event);
    const headers = getHeaders(event);
    const hasExplicitRegion =
      typeof query.region === "string"
        ? query.region.trim().length > 0
        : Boolean(query.region);

    const playerSummary = await solare.getPlayerSummary({
      nick: query.nick,
      region: hasExplicitRegion
        ? query.region
        : solare.inferRegionFromHeaders(headers),
      season: query.season,
    });

    setHeader(
      event,
      "Cache-Control",
      "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
    );
    if (!hasExplicitRegion) {
      setHeader(
        event,
        "Vary",
        "x-vercel-ip-country, cf-ipcountry, x-country-code",
      );
    }

    return playerSummary;
  },
});

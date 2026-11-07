export default controller.handle({
  get: async (event) => {
    const query = getQuery(event);
    const headers = getHeaders(event);
    const hasExplicitRegion =
      typeof query.region === "string"
        ? query.region.trim().length > 0
        : Boolean(query.region);

    const playerProfile = await solare.getPlayerProfile({
      nick: query.nick,
      region: hasExplicitRegion
        ? query.region
        : solare.inferRegionFromHeaders(headers),
      season: query.season,
      class_type: query.class_type,
      page: query.page,
      limit: query.limit,
    });

    setHeader(
      event,
      "Cache-Control",
      "public, max-age=0, s-maxage=10, stale-while-revalidate=10",
    );
    if (!hasExplicitRegion) {
      setHeader(
        event,
        "Vary",
        "x-vercel-ip-country, cf-ipcountry, x-country-code",
      );
    }

    return playerProfile;
  },
});

export default controller.handle({
  get: async (event) => {
    const query = getQuery(event);
    const headers = getHeaders(event);
    const hasExplicitRegion =
      typeof query.region === "string"
        ? query.region.trim().length > 0
        : Boolean(query.region);

    const rankingData = await solare.getRanking({
      region: query.region,
      season: query.season,
      classType: query.class_type,
      headers,
    });

    setHeader(
      event,
      "Cache-Control",
      "public, max-age=0, s-maxage=300, stale-while-revalidate=300",
    );
    if (!hasExplicitRegion) {
      setHeader(
        event,
        "Vary",
        "x-vercel-ip-country, cf-ipcountry, x-country-code",
      );
    }

    return rankingData;
  },
});

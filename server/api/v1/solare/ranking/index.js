export default controller.handle({
  get: async (event) => {
    const query = getQuery(event);
    const headers = getHeaders(event);

    const rankingData = await solare.getRanking({
      region: query.region,
      season: query.season,
      classType: query.class_type,
      headers,
    });

    setHeader(
      event,
      "Cache-Control",
      "public, max-age=0, s-maxage=30, stale-while-revalidate=30",
    );
    setHeader(
      event,
      "Vary",
      "x-vercel-ip-country, cf-ipcountry, x-country-code",
    );

    return rankingData;
  },
});

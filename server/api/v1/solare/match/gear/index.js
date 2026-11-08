export default controller.handle({
  get: async (event) => {
    const query = getQuery(event);

    const loadouts = await solareLoadout.getMatchLoadouts({
      region: query.region,
      record_no: query.record_no,
    });

    // Decoded equipment never changes once parsed; failures are retried after a cooldown.
    setHeader(
      event,
      "Cache-Control",
      loadouts.status === "ok"
        ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400"
        : "public, max-age=0, s-maxage=60",
    );

    return loadouts;
  },
});

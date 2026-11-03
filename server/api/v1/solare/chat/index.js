export default controller.handle({
  get: async (event) => {
    const query = getQuery(event);

    const chatText = await solare.getChatSummary({
      nick: query.nick,
      region: query.region,
      token: query.token,
    });

    setHeader(event, "Content-Type", "text/plain; charset=utf-8");
    setHeader(
      event,
      "Cache-Control",
      "public, max-age=0, s-maxage=10, stale-while-revalidate=10",
    );

    return chatText;
  },
});

import { setResponseStatus } from "h3";

export default controller.handle({
  get: async (event) => {
    const query = getQuery(event);
    const headers = getHeaders(event);

    const overlayData = await solare.getOverlayData({
      nick: query.nick,
      region: query.region,
      token: query.token,
      since: query.since ?? query.since_record_no,
      ifNoneMatch: headers["if-none-match"],
    });

    setHeader(
      event,
      "Cache-Control",
      "public, max-age=0, s-maxage=10, stale-while-revalidate=10",
    );

    const etag =
      overlayData.etag ||
      (overlayData.session
        ? `W/"${overlayData.latest_record_no}:${overlayData.session.anchor_record_no}:${overlayData.session.session_start_record_no}:${overlayData.session.anchor_rating}"`
        : `W/"${overlayData.latest_record_no ?? 0}"`);
    setHeader(event, "ETag", etag);

    if (overlayData.not_modified) {
      setResponseStatus(event, 304);
      return null;
    }

    return overlayData;
  },
});

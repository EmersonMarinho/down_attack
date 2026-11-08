import { setResponseStatus } from "h3";

export default controller.handle({
  get: async (event) => {
    const query = getQuery(event);
    const headers = getHeaders(event);

    // The Vercel CDN strips If-None-Match before forwarding cacheable requests,
    // so clients also mirror the ETag fingerprint in the `etag` query param.
    const headerIfNoneMatch =
      typeof headers["if-none-match"] === "string"
        ? headers["if-none-match"].trim()
        : "";

    const overlayData = await solare.getOverlayData({
      nick: query.nick,
      region: query.region,
      token: query.token,
      since: query.since ?? query.since_record_no,
      ifNoneMatch: headerIfNoneMatch || query.etag,
    });

    // Live overlay data must never be served from a shared/browser cache:
    // freshness is handled by the cheap `since` / ETag 304 check at the origin.
    setHeader(event, "Cache-Control", "private, no-store, max-age=0");

    const etag = overlayData.etag || `W/"${overlayData.latest_record_no ?? 0}"`;
    setHeader(event, "ETag", etag);

    if (overlayData.not_modified) {
      setResponseStatus(event, 304);
      return null;
    }

    return overlayData;
  },
});

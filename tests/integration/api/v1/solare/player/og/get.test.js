import orchestrator from "tests/orchestrator.js";
import webserver from "~~/infra/webserver.js";

function extractMetaTags(html) {
  const tags = [];
  const metaRegex = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    const raw = match[0];
    const attrs = {};
    const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(raw)) !== null) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
    }
    tags.push(attrs);
  }
  return tags;
}

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();

  await orchestrator.createSolarePlayer({
    region: "SA",
    season: 9,
    user_no: 810001,
    user_nickname: "DiscordEmbedHero",
    current_ranking: 1,
    rank_rating: 2480,
    class_type: 20,
    skill_branch_type: 1,
    win_count: 80,
    lose_count: 20,
    draw_count: 0,
  });

  await orchestrator.createSolareMatch({
    region: "SA",
    season: 9,
    record_no: 990001,
    user_nickname: "DiscordEmbedHero",
    user_no: 810001,
    class_type: 20,
    skill_branch_type: 1,
    is_winner: true,
    players: [
      {
        team: 0,
        user_nickname: "DiscordEmbedHero",
        user_no: 810001,
        class_type: 20,
        skill_branch_type: 1,
        kill_count: 6,
        death_count: 2,
        cc_applied_count: 15,
        damage_done: 240000,
        damage_taken: 120000,
        recovery: 85000,
        is_winner: true,
        vary_rank_rating: 28,
      },
    ],
  });
});

describe("GET /api/v1/solare/player/og", () => {
  describe("Anonymous User", () => {
    test("With missing nick returns 400 ValidationError", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player/og`,
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.name).toBe("ValidationError");
    });

    test("With nonexistent player returns 404 NotFoundError", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player/og?nick=UnknownOgPlayer&region=SA`,
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.name).toBe("NotFoundError");
    });

    test("Generates a valid 1200x630 PNG image with appropriate Cache-Control headers", async () => {
      // Without version key -> short CDN cache
      const unversionedRes = await fetch(
        `${webserver.origin}/api/v1/solare/player/og?nick=DiscordEmbedHero&region=SA`,
      );
      expect(unversionedRes.status).toBe(200);
      expect(unversionedRes.headers.get("content-type")).toBe("image/png");
      expect(unversionedRes.headers.get("cache-control")).toBe(
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      );

      const arrayBuf = await unversionedRes.arrayBuffer();
      const pngBuf = Buffer.from(arrayBuf);
      expect(
        pngBuf
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          ),
      ).toBe(true);
      expect(pngBuf.readUInt32BE(16)).toBe(1200);
      expect(pngBuf.readUInt32BE(20)).toBe(630);

      // With version fingerprint -> long CDN cache
      const versionedRes = await fetch(
        `${webserver.origin}/api/v1/solare/player/og?nick=DiscordEmbedHero&region=SA&v=v2-9-1-1-2508-80-20-0-20-1-3.00-20.1.1.1`,
      );
      expect(versionedRes.status).toBe(200);
      expect(versionedRes.headers.get("content-type")).toBe("image/png");
      expect(versionedRes.headers.get("cache-control")).toBe(
        "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
      );
      expect(versionedRes.headers.get("vary")).toBeNull();

      // Oversized version key (>128 chars) falls back to short CDN cache
      const oversizedVersionRes = await fetch(
        `${webserver.origin}/api/v1/solare/player/og?nick=DiscordEmbedHero&region=SA&v=${"x".repeat(129)}`,
      );
      expect(oversizedVersionRes.status).toBe(200);
      expect(oversizedVersionRes.headers.get("cache-control")).toBe(
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      );

      // Omitted region sets Vary header for IP geolocation
      const inferredRegionRes = await fetch(
        `${webserver.origin}/api/v1/solare/player/og?nick=DiscordEmbedHero`,
        {
          headers: {
            "x-vercel-ip-country": "BR",
          },
        },
      );
      expect(inferredRegionRes.status).toBe(200);
      expect(inferredRegionRes.headers.get("vary")).toBe(
        "x-vercel-ip-country, cf-ipcountry, x-country-code",
      );
    });
  });
});

describe("SSR OpenGraph embeds on /solare/player/:region/:nick", () => {
  test("Renders rich Discord OpenGraph & Twitter large card meta tags in SSR HTML", async () => {
    const response = await fetch(
      `${webserver.origin}/solare/player/sa/discordembedhero`,
    );
    expect(response.status).toBe(200);

    const html = await response.text();
    const metas = extractMetaTags(html);

    const ogTitle = metas.find((m) => m.property === "og:title")?.content;
    const ogDescription = metas.find(
      (m) => m.property === "og:description",
    )?.content;
    const ogImages = metas.filter((m) => m.property === "og:image");
    const ogImageWidth = metas.find(
      (m) => m.property === "og:image:width",
    )?.content;
    const ogImageHeight = metas.find(
      (m) => m.property === "og:image:height",
    )?.content;
    const twitterCard = metas.find((m) => m.name === "twitter:card")?.content;
    const twitterImage = metas.find((m) => m.name === "twitter:image")?.content;
    const themeColor = metas.find((m) => m.name === "theme-color")?.content;

    expect(ogTitle).toBe(
      "DiscordEmbedHero (#1 SA) — Musa · 2,508 PTS · 80.0% WR | Arena of Solare",
    );
    expect(ogDescription).toContain("Season 9 (SA)");
    expect(ogDescription).toContain("Rank #1 · Solare Incarnate V (2,508 PTS)");
    expect(ogDescription).toContain("Top #1 Musa");
    expect(ogDescription).toContain("Musa (Awakening)");
    expect(ogDescription).toContain("80W 20L (80.0% WR)");
    expect(ogDescription).toContain("3.00 K/D");

    // Must override global default og:image cleanly with a single absolute dynamic card URL
    expect(ogImages).toHaveLength(1);
    expect(ogImages[0].content).toBe(
      `${webserver.origin}/api/v1/solare/player/og?region=SA&nick=DiscordEmbedHero&v=v2-9-1-1-2508-80-20-0-20-1-3.00-20.1.1.1`,
    );
    expect(ogImageWidth).toBe("1200");
    expect(ogImageHeight).toBe("630");
    expect(twitterCard).toBe("summary_large_image");
    expect(twitterImage).toBe(ogImages[0].content);
    expect(themeColor).toBe("#d4af6a");
  });

  test("Falls back gracefully with HTTP 200 and summary card when player does not exist or nick contains encoded %", async () => {
    const response = await fetch(
      `${webserver.origin}/solare/player/sa/GhostDiscordPlayer999`,
    );
    expect(response.status).toBe(200);

    const html = await response.text();
    const metas = extractMetaTags(html);

    const ogTitle = metas.find((m) => m.property === "og:title")?.content;
    const ogImages = metas.filter((m) => m.property === "og:image");
    const twitterCard = metas.find((m) => m.name === "twitter:card")?.content;

    expect(ogTitle).toBe(
      "GhostDiscordPlayer999 (SA) — Arena of Solare Profile",
    );
    expect(ogImages).toHaveLength(1);
    expect(ogImages[0].content).toBe(
      `${webserver.origin}/images/solare/solare-icon-game@4x.png`,
    );
    expect(twitterCard).toBe("summary");

    // Literal % in decoded route param (%25) must not throw URIError 500 during SSR
    const percentRes = await fetch(
      `${webserver.origin}/solare/player/sa/Ghost%25Player`,
    );
    expect(percentRes.status).toBe(200);
  });
});

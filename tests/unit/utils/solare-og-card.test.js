import {
  buildSolarePlayerOgTree,
  renderSolarePlayerOgPng,
} from "~~/server/utils/solareOgCard.js";

function readPngDimensions(pngBytes) {
  const buf = Buffer.from(pngBytes);
  const signature = buf.subarray(0, 8);
  const expectedSig = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect(signature.equals(expectedSig)).toBe(true);

  const ihdrType = buf.subarray(12, 16).toString("ascii");
  expect(ihdrType).toBe("IHDR");

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height, byteLength: buf.length };
}

function collectTextNodes(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectTextNodes(child, out);
    return out;
  }
  if (node.props?.children !== undefined) {
    collectTextNodes(node.props.children, out);
  }
  return out;
}

describe("server/utils/solareOgCard.js", () => {
  test("renders a 1200x630 PNG for a ranked rated player with Top 3 classes", async () => {
    const summary = {
      region: "SA",
      season: 9,
      user_nickname: "Okazaki",
      user_no: "500101",
      current_ranking: 12,
      official_ranking: 12,
      class_ranking: 2,
      rank_rating: 2450,
      rating_is_estimated: false,
      class_type: 20,
      skill_branch_type: 1,
      kd_ratio: 2.15,
      overall: {
        wins: 78,
        losses: 48,
        draws: 0,
        total_games: 126,
        winrate: 61.9,
      },
      classes: [
        {
          class_type: 20,
          skill_branch_type: 1,
          wins: 55,
          losses: 26,
          draws: 0,
          total_games: 81,
          winrate: 67.9,
        },
        {
          class_type: 26,
          skill_branch_type: 2,
          wins: 15,
          losses: 13,
          draws: 0,
          total_games: 28,
          winrate: 53.6,
        },
        {
          class_type: 1,
          skill_branch_type: 1,
          wins: 8,
          losses: 9,
          draws: 0,
          total_games: 17,
          winrate: 47.1,
        },
      ],
    };

    const tree = buildSolarePlayerOgTree(summary);
    const texts = collectTextNodes(tree).join(" | ");
    expect(texts).toContain("Okazaki");
    expect(texts).not.toContain("OKAZAKI");
    expect(texts).toContain("#12");
    expect(texts).toContain("Top #2");
    expect(texts).toContain("Solare Incarnate");
    expect(texts).toContain("2,450 PTS");
    expect(texts).toContain("78W / 48L");
    expect(texts).toContain("Win Rate 62%");
    expect(texts).toContain("DOWN ATTACK");

    const pngBytes = await renderSolarePlayerOgPng(summary);
    const { width, height, byteLength } = readPngDimensions(pngBytes);
    expect(width).toBe(1200);
    expect(height).toBe(630);
    expect(byteLength).toBeGreaterThan(20000);
  });

  test("renders a 1200x630 PNG cleanly for an unranked player with 1 class, draws, and Cyrillic/Latin-ext nickname", async () => {
    const summary = {
      region: "RU",
      season: 9,
      user_nickname: "Валькирия_Áéí",
      user_no: null,
      current_ranking: null,
      official_ranking: null,
      class_ranking: null,
      rank_rating: null,
      rating_is_estimated: false,
      class_type: 24,
      skill_branch_type: 1,
      kd_ratio: 1.75,
      overall: {
        wins: 14,
        losses: 9,
        draws: 1,
        total_games: 24,
        winrate: 58.3,
      },
      classes: [],
    };

    const tree = buildSolarePlayerOgTree(summary);
    const texts = collectTextNodes(tree).join(" | ");
    expect(texts).toContain("Валькирия_Áéí");
    expect(texts).toContain("#RU");
    expect(texts).toContain("Season 9");
    expect(texts).toContain("1.75 K/D");
    expect(texts).toContain("14W / 9L / 1D");
    expect(texts).toContain("Win Rate 58%");

    const pngBytes = await renderSolarePlayerOgPng(summary);
    const { width, height, byteLength } = readPngDimensions(pngBytes);
    expect(width).toBe(1200);
    expect(height).toBe(630);
    expect(byteLength).toBeGreaterThan(15000);
  });
});

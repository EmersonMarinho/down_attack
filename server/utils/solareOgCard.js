import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import {
  getClassName,
  getClassSlug,
  getSkillBranch,
  getTierInfo,
} from "~~/app/utils/solareTier.js";

const esmRequire = createRequire(import.meta.url);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

let wasmInitPromise = null;
let cachedFonts = null;
const imageDataUriCache = new Map();

function getCandidateRoots() {
  const roots = new Set([process.cwd()]);
  let current = MODULE_DIR;
  for (let depth = 0; depth <= 8; depth += 1) {
    roots.add(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return Array.from(roots);
}

function resolveExistingFile(relativeCandidates, packageSpecifier = null) {
  if (packageSpecifier) {
    try {
      const resolved = esmRequire.resolve(packageSpecifier);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // Fall back to filesystem candidate paths
    }
  }

  for (const root of getCandidateRoots()) {
    for (const rel of relativeCandidates) {
      const fullPath = path.resolve(root, rel);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

async function ensureResvgInitialized() {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const wasmPath = resolveExistingFile(
        [
          "assets/resvg/index_bg.wasm",
          "node_modules/@resvg/resvg-wasm/index_bg.wasm",
        ],
        "@resvg/resvg-wasm/index_bg.wasm",
      );

      if (!wasmPath) {
        throw new Error("Could not locate @resvg/resvg-wasm/index_bg.wasm");
      }

      const wasmBuffer = fs.readFileSync(wasmPath);
      await initWasm(wasmBuffer);
    })().catch((err) => {
      wasmInitPromise = null;
      throw err;
    });
  }

  return wasmInitPromise;
}

function loadFonts() {
  if (cachedFonts) {
    return cachedFonts;
  }

  const fontSpecs = [
    { file: "inter-latin-400-normal.woff", weight: 400 },
    { file: "inter-latin-600-normal.woff", weight: 600 },
    { file: "inter-latin-700-normal.woff", weight: 700 },
    { file: "inter-latin-800-normal.woff", weight: 800 },
    { file: "inter-latin-900-normal.woff", weight: 900 },
    { file: "inter-latin-ext-600-normal.woff", weight: 600 },
    { file: "inter-latin-ext-700-normal.woff", weight: 700 },
    { file: "inter-latin-ext-900-normal.woff", weight: 900 },
    { file: "inter-cyrillic-700-normal.woff", weight: 700 },
    { file: "inter-cyrillic-900-normal.woff", weight: 900 },
  ];

  const fonts = [];
  for (const spec of fontSpecs) {
    const filePath = resolveExistingFile(
      [
        `assets/og-fonts/${spec.file}`,
        `node_modules/@fontsource/inter/files/${spec.file}`,
      ],
      `@fontsource/inter/files/${spec.file}`,
    );

    if (filePath) {
      fonts.push({
        name: "Inter",
        data: fs.readFileSync(filePath),
        weight: spec.weight,
        style: "normal",
      });
    }
  }

  if (fonts.length === 0) {
    throw new Error("Could not load Inter font files for OG image generation");
  }

  cachedFonts = fonts;
  return cachedFonts;
}

function loadPublicImageDataUri(publicUrlPath) {
  if (!publicUrlPath) return null;
  if (imageDataUriCache.has(publicUrlPath)) {
    return imageDataUriCache.get(publicUrlPath);
  }

  const cleanRel = publicUrlPath.replace(/^\/+/, "");
  const resolved = resolveExistingFile([`public/${cleanRel}`, cleanRel]);
  if (!resolved) {
    imageDataUriCache.set(publicUrlPath, null);
    return null;
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".svg"
        ? "image/svg+xml"
        : "image/png";

  const base64 = fs.readFileSync(resolved).toString("base64");
  const dataUri = `data:${mime};base64,${base64}`;
  imageDataUriCache.set(publicUrlPath, dataUri);
  return dataUri;
}

function getHeaderPortraitDataUri(classType) {
  if (classType !== null && classType !== undefined) {
    const num = Number(classType);
    const highRes = loadPublicImageDataUri(`/images/solare/classes/${num}.jpg`);
    if (highRes) return highRes;

    const slug = getClassSlug(num);
    if (slug) {
      const gameAvatar = loadPublicImageDataUri(
        `/images/solare/game/avatars/${slug}.png`,
      );
      if (gameAvatar) return gameAvatar;
    }
  }

  return loadPublicImageDataUri("/images/solare/solare-icon-game@4x.png");
}

function getRoundClassAvatarDataUri(classType) {
  if (classType !== null && classType !== undefined) {
    const num = Number(classType);
    const slug = getClassSlug(num);
    if (slug) {
      const gameAvatar = loadPublicImageDataUri(
        `/images/solare/game/avatars/${slug}.png`,
      );
      if (gameAvatar) return gameAvatar;
    }

    const highRes = loadPublicImageDataUri(`/images/solare/classes/${num}.jpg`);
    if (highRes) return highRes;
  }

  return loadPublicImageDataUri("/images/solare/solare-icon-game@4x.png");
}

function h(type, props, ...children) {
  const flatChildren = children
    .flat(Infinity)
    .filter((c) => c !== null && c !== undefined && c !== false);

  return {
    type,
    props: {
      ...(props || {}),
      children:
        flatChildren.length === 0
          ? undefined
          : flatChildren.length === 1
            ? flatChildren[0]
            : flatChildren,
    },
  };
}

function formatTierHeadline(name) {
  if (!name) return "Arena of Solare";
  if (name.startsWith("Solare Incarnate")) {
    return "Solare Incarnate";
  }
  return name.replace(/\[([IVX]+)\]/g, "$1").trim();
}

function buildClassItem(classEntry) {
  const className = getClassName(classEntry.class_type);
  const specName = getSkillBranch(
    classEntry.class_type,
    classEntry.skill_branch_type,
  );
  const totalGames = Number(classEntry.total_games || 0);
  const winrateNum = Math.max(
    0,
    Math.min(100, Number(classEntry.winrate || 0)),
  );
  const winrateRounded = Math.round(winrateNum);
  const avatarUri = getRoundClassAvatarDataUri(classEntry.class_type);

  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const visibleArc = (296 / 360) * circumference;
  const winArc = (winrateNum / 100) * visibleArc;

  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
        gap: "18px",
      },
    },
    // Dual-color Win/Loss Ring + Avatar + Bottom % Label (OP.GG style)
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          width: "84px",
          height: "90px",
          flexShrink: 0,
        },
      },
      h(
        "svg",
        {
          width: "84",
          height: "84",
          viewBox: "0 0 84 84",
          style: {
            position: "absolute",
            top: "0px",
            left: "0px",
            transform: "rotate(122deg)",
          },
        },
        // Loss / background track over the open-bottom ring
        h("circle", {
          cx: "42",
          cy: "42",
          r: String(radius),
          fill: "none",
          stroke: totalGames > 0 ? "#e84057" : "#2c303d",
          "stroke-width": "5.5",
          "stroke-dasharray": `${visibleArc.toFixed(2)} ${circumference.toFixed(2)}`,
          "stroke-linecap": "butt",
        }),
        // Win arc (OP.GG blue)
        totalGames > 0 && winrateNum > 0
          ? h("circle", {
              cx: "42",
              cy: "42",
              r: String(radius),
              fill: "none",
              stroke: "#5383e8",
              "stroke-width": "5.5",
              "stroke-dasharray": `${winArc.toFixed(2)} ${circumference.toFixed(2)}`,
              "stroke-linecap": "butt",
            })
          : null,
      ),
      avatarUri
        ? h("img", {
            src: avatarUri,
            width: 60,
            height: 60,
            style: {
              position: "absolute",
              top: "12px",
              left: "12px",
              width: "60px",
              height: "60px",
              borderRadius: "999px",
              objectFit: "cover",
              backgroundColor: "#121318",
            },
          })
        : null,
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "absolute",
            bottom: "0px",
            backgroundColor: "#181920",
            color: "#ffffff",
            borderRadius: "6px",
            padding: "1px 7px",
            fontSize: "18px",
            fontWeight: 800,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          },
        },
        `${winrateRounded}%`,
      ),
    ),
    // Class Name + Spec + Matches
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minWidth: 0,
          flex: 1,
          gap: "4px",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
            minWidth: 0,
          },
        },
        h(
          "span",
          {
            style: {
              color: "#d9dce3",
              fontSize: "23px",
              fontWeight: 600,
              lineHeight: 1.15,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
          },
          className,
        ),
        h(
          "span",
          {
            style: {
              color: "#d4af6a",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            },
          },
          specName === "Awakening"
            ? "AWK"
            : specName === "Succession"
              ? "SUCC"
              : "ASC",
        ),
      ),
      h(
        "div",
        {
          style: {
            color: "#878b99",
            fontSize: "20px",
            fontWeight: 400,
            lineHeight: 1.15,
            whiteSpace: "nowrap",
          },
        },
        `${totalGames} ${totalGames === 1 ? "Match" : "Matches"}`,
      ),
    ),
  );
}

function buildEmptyClassSlot() {
  return h("div", {
    style: {
      display: "flex",
      flex: 1,
      minWidth: 0,
    },
  });
}

export function buildSolarePlayerOgTree(summary) {
  const nick = String(summary?.user_nickname || "Unknown");
  const region = String(summary?.region || "SA").toUpperCase();
  const season = Number(summary?.season || 9);
  const ranking =
    summary?.current_ranking !== null && summary?.current_ranking !== undefined
      ? Number(summary.current_ranking)
      : null;
  const classRanking =
    summary?.class_ranking !== null && summary?.class_ranking !== undefined
      ? Number(summary.class_ranking)
      : null;
  const hasRating =
    summary?.rank_rating !== null && summary?.rank_rating !== undefined;
  const rating = hasRating ? Number(summary.rank_rating) : null;

  const wins = Number(summary?.overall?.wins || 0);
  const losses = Number(summary?.overall?.losses || 0);
  const draws = Number(summary?.overall?.draws || 0);
  const totalGames = Number(
    summary?.overall?.total_games ?? wins + losses + draws,
  );
  const winrate =
    summary?.overall?.winrate !== undefined &&
    summary?.overall?.winrate !== null
      ? Number(summary.overall.winrate)
      : totalGames > 0
        ? Number(((wins / totalGames) * 100).toFixed(1))
        : 0;
  const clampedWr = Math.max(0, Math.min(100, winrate));

  const primaryClassType =
    summary?.class_type !== undefined ? summary.class_type : null;
  const primaryBranchType =
    summary?.skill_branch_type !== undefined ? summary.skill_branch_type : null;
  const primaryClassName =
    primaryClassType !== null ? getClassName(primaryClassType) : null;
  const primarySpecName =
    primaryClassType !== null
      ? getSkillBranch(primaryClassType, primaryBranchType)
      : null;

  const portraitUri = getHeaderPortraitDataUri(primaryClassType);
  const brandIconUri = loadPublicImageDataUri(
    "/images/solare/solare-icon-game@4x.png",
  );

  const tierInfo = hasRating ? getTierInfo(rating, ranking ?? 999) : null;
  const fallbackCrestPath = ranking
    ? "/images/solare/tiers/shining-spear-ii.png"
    : "/images/solare/tiers/beginner-soldier.png";
  const tierEmblemUri = tierInfo
    ? loadPublicImageDataUri(tierInfo.badge_url)
    : loadPublicImageDataUri(fallbackCrestPath);

  const rawClasses = Array.isArray(summary?.classes) ? summary.classes : [];
  const topClasses =
    rawClasses.length > 0
      ? rawClasses.slice(0, 3)
      : primaryClassType !== null
        ? [
            {
              class_type: primaryClassType,
              skill_branch_type: primaryBranchType,
              wins,
              losses,
              draws,
              total_games: totalGames,
              winrate,
            },
          ]
        : [];

  const nickFontSize =
    nick.length > 18 ? "36px" : nick.length > 13 ? "42px" : "48px";
  const tagFontSize =
    nick.length > 18 ? "34px" : nick.length > 13 ? "38px" : "44px";

  const kdRatio =
    summary?.kd_ratio !== undefined && summary?.kd_ratio !== null
      ? Number(summary.kd_ratio)
      : null;

  const pillBadge =
    classRanking && primaryClassName
      ? {
          text: `Top #${classRanking}`,
          bg: "#d4af6a",
          color: "#15161c",
        }
      : ranking
        ? {
            text: `Rank #${ranking}`,
            bg: "#d4af6a",
            color: "#15161c",
          }
        : {
            text: `S${season}`,
            bg: "#2d3140",
            color: "#d1d5db",
          };

  const headlineLeft = tierInfo
    ? formatTierHeadline(tierInfo.name)
    : ranking
      ? `Top 100 ${region}`
      : `Season ${season}`;

  const headlineRight = hasRating
    ? `${rating.toLocaleString("en-US")} PTS`
    : ranking
      ? `#${ranking} ${region}`
      : kdRatio !== null
        ? `${kdRatio.toFixed(2)} K/D`
        : `${wins}W ${losses}L`;

  const recordParts = [`${wins}W / ${losses}L`];
  if (draws > 0) {
    recordParts[0] += ` / ${draws}D`;
  }
  if (kdRatio !== null && (hasRating || ranking)) {
    recordParts.push(`${kdRatio.toFixed(2)} K/D`);
  }

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        position: "relative",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        backgroundColor: "#181920",
        padding: "72px 80px",
        gap: "30px",
        fontFamily: "Inter",
        overflow: "hidden",
      },
    },

    // 1. TOP HEADER SECTION (OP.GG Proportions)
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          width: "100%",
          boxSizing: "border-box",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "28px",
            minWidth: 0,
            flex: 1,
          },
        },
        // 108x108 Portrait
        h(
          "div",
          {
            style: {
              display: "flex",
              position: "relative",
              width: "108px",
              height: "108px",
              borderRadius: "20px",
              overflow: "hidden",
              backgroundColor: "#101116",
              border: "2px solid rgba(212, 175, 106, 0.65)",
              flexShrink: 0,
            },
          },
          portraitUri
            ? h("img", {
                src: portraitUri,
                width: 108,
                height: 108,
                style: {
                  width: "108px",
                  height: "108px",
                  objectFit: "cover",
                },
              })
            : null,
        ),
        // Original-case Nickname + #Rank/Region + Pill Subtitle
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "12px",
              minWidth: 0,
            },
          },
          h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "baseline",
                gap: "14px",
                minWidth: 0,
              },
            },
            h(
              "div",
              {
                style: {
                  color: "#ffffff",
                  fontSize: nickFontSize,
                  fontWeight: 800,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.05,
                  maxWidth: "560px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                },
              },
              nick,
            ),
            h(
              "div",
              {
                style: {
                  color: "#6f7382",
                  fontSize: tagFontSize,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.05,
                  whiteSpace: "nowrap",
                },
              },
              ranking ? `#${ranking}` : `#${region}`,
            ),
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "21px",
              },
            },
            h(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pillBadge.bg,
                  color: pillBadge.color,
                  fontSize: "15px",
                  fontWeight: 800,
                  padding: "4px 11px",
                  borderRadius: "7px",
                  lineHeight: 1.15,
                  whiteSpace: "nowrap",
                },
              },
              pillBadge.text,
            ),
            primaryClassName
              ? h(
                  "span",
                  {
                    style: {
                      color: "#ffffff",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    },
                  },
                  `${primaryClassName} · ${primarySpecName}`,
                )
              : null,
            h(
              "span",
              {
                style: {
                  color: "#878b99",
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                },
              },
              `Arena of Solare · ${region}`,
            ),
          ),
        ),
      ),
      // Top-Right Brand Mark (aligned like OP.GG logo)
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "9px",
            paddingTop: "6px",
            flexShrink: 0,
          },
        },
        brandIconUri
          ? h("img", {
              src: brandIconUri,
              width: 28,
              height: 28,
              style: {
                width: "28px",
                height: "28px",
                objectFit: "contain",
              },
            })
          : null,
        h(
          "span",
          {
            style: {
              color: "#ffffff",
              fontSize: "23px",
              fontWeight: 900,
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
            },
          },
          "DOWN ATTACK",
        ),
      ),
    ),

    // 2. MIDDLE UNIFIED TIER & WINRATE BOX (OP.GG Style)
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          width: "100%",
          height: "210px",
          boxSizing: "border-box",
          backgroundColor: "#282933",
          borderRadius: "20px",
          padding: "28px 44px",
          gap: "38px",
        },
      },
      // Left: Tier Crest
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "126px",
            height: "126px",
            flexShrink: 0,
          },
        },
        tierEmblemUri
          ? h("img", {
              src: tierEmblemUri,
              width: 126,
              height: 126,
              style: {
                width: "126px",
                height: "126px",
                objectFit: "contain",
              },
            })
          : null,
      ),
      // Right: Full-width Tier+PTS header, Win/Loss bar, and Record+Winrate row
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            minWidth: 0,
          },
        },
        // Top Row: Tier Name <---> Points
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              width: "100%",
              marginBottom: "18px",
            },
          },
          h(
            "span",
            {
              style: {
                color: "#ffffff",
                fontSize: "38px",
                fontWeight: 700,
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
              },
            },
            headlineLeft,
          ),
          h(
            "span",
            {
              style: {
                color: "#ffffff",
                fontSize: "38px",
                fontWeight: 700,
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
              },
            },
            headlineRight,
          ),
        ),
        // Middle Row: Full-width Dual-color Bar
        h(
          "div",
          {
            style: {
              display: "flex",
              width: "100%",
              height: "14px",
              backgroundColor: "#1c1d25",
              borderRadius: "999px",
              overflow: "hidden",
              marginBottom: "16px",
            },
          },
          totalGames > 0 && clampedWr > 0
            ? h("div", {
                style: {
                  width: `${clampedWr}%`,
                  height: "100%",
                  backgroundColor: "#5383e8",
                  borderTopLeftRadius: "999px",
                  borderBottomLeftRadius: "999px",
                  borderTopRightRadius: clampedWr >= 100 ? "999px" : "0px",
                  borderBottomRightRadius: clampedWr >= 100 ? "999px" : "0px",
                },
              })
            : null,
          totalGames > 0 && clampedWr < 100
            ? h("div", {
                style: {
                  width: `${100 - clampedWr}%`,
                  height: "100%",
                  backgroundColor: "#e84057",
                  borderTopRightRadius: "999px",
                  borderBottomRightRadius: "999px",
                  borderTopLeftRadius: clampedWr <= 0 ? "999px" : "0px",
                  borderBottomLeftRadius: clampedWr <= 0 ? "999px" : "0px",
                },
              })
            : null,
        ),
        // Bottom Row: W/L (+ K/D) <---> Win Rate %
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              fontSize: "24px",
              color: "#999da9",
              fontWeight: 400,
              lineHeight: 1.15,
            },
          },
          h("span", null, recordParts.join("  ·  ")),
          h("span", null, `Win Rate ${Math.round(clampedWr)}%`),
        ),
      ),
    ),

    // 3. BOTTOM TOP 3 PLAYED CLASSES (Clean Floating Row Like OP.GG)
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          boxSizing: "border-box",
          padding: "0px 8px",
          gap: "28px",
        },
      },
      ...[0, 1, 2].map((idx) =>
        topClasses[idx]
          ? buildClassItem(topClasses[idx])
          : buildEmptyClassSlot(),
      ),
    ),
  );
}

export async function renderSolarePlayerOgPng(summary) {
  await ensureResvgInitialized();
  const fonts = loadFonts();
  const tree = buildSolarePlayerOgTree(summary);

  const svg = await satori(tree, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts,
  });

  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: CARD_WIDTH,
    },
  });

  let pngData = null;
  try {
    pngData = resvg.render();
    return pngData.asPng();
  } finally {
    pngData?.free();
    resvg.free();
  }
}

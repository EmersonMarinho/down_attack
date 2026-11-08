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

function getWinrateTheme(winrate) {
  const wr = Number(winrate) || 0;
  if (wr >= 65) {
    return {
      stroke: "#34d399",
      badgeBg: "#022c22",
      badgeText: "#6ee7b7",
      badgeBorder: "rgba(16, 185, 129, 0.55)",
    };
  }
  if (wr >= 50) {
    return {
      stroke: "#38bdf8",
      badgeBg: "#082f49",
      badgeText: "#7dd3fc",
      badgeBorder: "rgba(14, 165, 233, 0.55)",
    };
  }
  return {
    stroke: "#fb7185",
    badgeBg: "#4c0519",
    badgeText: "#fda4af",
    badgeBorder: "rgba(244, 63, 94, 0.55)",
  };
}

function formatTierHeadline(name) {
  if (!name) return "Arena of Solare";
  if (name.startsWith("Solare Incarnate")) {
    return "Solare Incarnate";
  }
  return name.replace(/\[([IVX]+)\]/g, "$1").trim();
}

function buildClassCard(classEntry) {
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
  const theme = getWinrateTheme(winrateNum);
  const avatarUri = getRoundClassAvatarDataUri(classEntry.class_type);

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dashLength = (winrateNum / 100) * circumference;

  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        flex: 1,
        height: "130px",
        boxSizing: "border-box",
        backgroundColor: "#13151e",
        border: "1px solid #222636",
        borderRadius: "14px",
        padding: "16px 22px",
        gap: "18px",
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          width: "80px",
          height: "86px",
          flexShrink: 0,
        },
      },
      h(
        "svg",
        {
          width: "78",
          height: "78",
          viewBox: "0 0 78 78",
          style: {
            position: "absolute",
            top: "0px",
            left: "1px",
            transform: "rotate(-90deg)",
          },
        },
        h("circle", {
          cx: "39",
          cy: "39",
          r: String(radius),
          fill: "none",
          stroke: "#1f2937",
          "stroke-width": "6",
        }),
        winrateNum > 0
          ? h("circle", {
              cx: "39",
              cy: "39",
              r: String(radius),
              fill: "none",
              stroke: theme.stroke,
              "stroke-width": "6",
              "stroke-dasharray": `${dashLength.toFixed(2)} ${circumference.toFixed(2)}`,
              "stroke-linecap": "round",
            })
          : null,
      ),
      avatarUri
        ? h("img", {
            src: avatarUri,
            width: 56,
            height: 56,
            style: {
              position: "absolute",
              top: "11px",
              left: "12px",
              width: "56px",
              height: "56px",
              borderRadius: "999px",
              objectFit: "cover",
              backgroundColor: "#0c0e14",
              border: "1.5px solid rgba(255, 255, 255, 0.22)",
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
            backgroundColor: theme.badgeBg,
            color: theme.badgeText,
            border: `1px solid ${theme.badgeBorder}`,
            borderRadius: "6px",
            padding: "2px 8px",
            fontSize: "12px",
            fontWeight: 900,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          },
        },
        `${winrateRounded}%`,
      ),
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minWidth: 0,
          flex: 1,
        },
      },
      h(
        "div",
        {
          style: {
            color: "#ffffff",
            fontSize: "18px",
            fontWeight: 700,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          },
        },
        className,
      ),
      h(
        "div",
        {
          style: {
            color: "#e4b655",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginTop: "4px",
            whiteSpace: "nowrap",
          },
        },
        specName.toUpperCase(),
      ),
      h(
        "div",
        {
          style: {
            color: "#9ca3af",
            fontSize: "13px",
            fontWeight: 600,
            marginTop: "6px",
            whiteSpace: "nowrap",
          },
        },
        `${totalGames} ${totalGames === 1 ? "Match" : "Matches"}`,
      ),
    ),
  );
}

function buildEmptyClassSlot(season) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        flex: 1,
        height: "130px",
        boxSizing: "border-box",
        backgroundColor: "rgba(19, 21, 30, 0.5)",
        border: "1px dashed #222636",
        borderRadius: "14px",
        padding: "16px 22px",
        gap: "18px",
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "64px",
          height: "64px",
          borderRadius: "999px",
          border: "2px dashed #282d40",
          backgroundColor: "#0c0e14",
          color: "#4b5563",
          fontSize: "20px",
          fontWeight: 800,
          flexShrink: 0,
        },
      },
      "—",
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        },
      },
      h(
        "div",
        {
          style: {
            color: "#6b7280",
            fontSize: "15px",
            fontWeight: 700,
          },
        },
        "No Extra Class",
      ),
      h(
        "div",
        {
          style: {
            color: "#4b5563",
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginTop: "4px",
          },
        },
        `SEASON ${season || 9}`,
      ),
    ),
  );
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

  const nickUpper = nick.toUpperCase();
  const nickFontSize =
    nickUpper.length > 18 ? "28px" : nickUpper.length > 13 ? "33px" : "38px";

  const dotSeparator = h("div", {
    style: {
      width: "5px",
      height: "5px",
      borderRadius: "999px",
      backgroundColor: "#6b7280",
    },
  });

  const subtitleItems = [
    h("span", { style: { color: "#38bdf8", fontWeight: 700 } }, region),
  ];

  if (primaryClassName) {
    subtitleItems.push(dotSeparator);
    subtitleItems.push(
      h(
        "span",
        { style: { color: "#f3f4f6", fontWeight: 600 } },
        `${primaryClassName} (${primarySpecName})`,
      ),
    );
  }

  if (classRanking && primaryClassName) {
    subtitleItems.push(dotSeparator);
    subtitleItems.push(
      h(
        "span",
        { style: { color: "#fde08b", fontWeight: 700 } },
        `Top #${classRanking} ${primaryClassName}`,
      ),
    );
  }

  subtitleItems.push(dotSeparator);
  subtitleItems.push(
    h(
      "span",
      { style: { color: "#9ca3af", fontWeight: 400 } },
      "Arena of Solare",
    ),
  );

  if (!classRanking) {
    subtitleItems.push(dotSeparator);
    subtitleItems.push(
      h(
        "span",
        { style: { color: "#9ca3af", fontWeight: 400 } },
        "Black Desert",
      ),
    );
  }

  const kdRatio =
    summary?.kd_ratio !== undefined && summary?.kd_ratio !== null
      ? Number(summary.kd_ratio)
      : null;

  const showKdInSubcaption = kdRatio !== null && (hasRating || ranking);

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        backgroundColor: "#0f1117",
        padding: "44px 52px",
        fontFamily: "Inter",
        overflow: "hidden",
        border: "1px solid #1e2230",
      },
    },
    // Top-left gold ambient glow
    h("div", {
      style: {
        position: "absolute",
        top: "-120px",
        left: "-90px",
        width: "480px",
        height: "320px",
        backgroundImage:
          "radial-gradient(circle, rgba(228, 182, 85, 0.13) 0%, rgba(56, 189, 248, 0.04) 48%, rgba(15, 17, 23, 0) 70%)",
      },
    }),
    // Bottom-right cyan/gold ambient glow
    h("div", {
      style: {
        position: "absolute",
        bottom: "-120px",
        right: "-90px",
        width: "480px",
        height: "320px",
        backgroundImage:
          "radial-gradient(circle, rgba(56, 189, 248, 0.10) 0%, rgba(228, 182, 85, 0.04) 48%, rgba(15, 17, 23, 0) 70%)",
      },
    }),

    // 1. TOP HEADER SECTION
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
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
            gap: "22px",
            minWidth: 0,
          },
        },
        // 82x82 Gold-framed Portrait
        h(
          "div",
          {
            style: {
              display: "flex",
              position: "relative",
              width: "82px",
              height: "82px",
              borderRadius: "16px",
              overflow: "hidden",
              backgroundColor: "#08090c",
              border: "2px solid #c99c3e",
              flexShrink: 0,
            },
          },
          portraitUri
            ? h("img", {
                src: portraitUri,
                width: 82,
                height: 82,
                style: {
                  width: "82px",
                  height: "82px",
                  objectFit: "cover",
                },
              })
            : null,
        ),
        // Name + Rank Pill + Subtitle
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "8px",
            },
          },
          h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "14px",
              },
            },
            h(
              "div",
              {
                style: {
                  color: "#ffffff",
                  fontSize: nickFontSize,
                  fontWeight: 900,
                  letterSpacing: "0.03em",
                  lineHeight: 1,
                  maxWidth: "480px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                },
              },
              nickUpper,
            ),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "7px 14px",
                  borderRadius: "11px",
                  backgroundColor: "#272b38",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  color: ranking ? "#fde08b" : "#9ca3af",
                  fontSize: "18px",
                  fontWeight: 900,
                  letterSpacing: "0.05em",
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                },
              },
              ranking ? `RANK #${ranking}` : `SEASON ${season}`,
            ),
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "9px",
                fontSize: "15px",
                letterSpacing: "0.01em",
              },
            },
            ...subtitleItems,
          ),
        ),
      ),
      // Brand Watermark
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            color: "#ffffff",
            fontSize: "21px",
            fontWeight: 900,
            letterSpacing: "0.06em",
            whiteSpace: "nowrap",
            flexShrink: 0,
          },
        },
        "DOWN-ATTACK.COM",
      ),
    ),

    // 2. MIDDLE RANK TIER & WINRATE CONTAINER
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          height: "162px",
          boxSizing: "border-box",
          backgroundColor: "#161822",
          border: "1px solid #2b3044",
          borderRadius: "16px",
          padding: "20px 32px",
        },
      },
      // Left: Tier Crest + Tier Name + Points
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "24px",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "108px",
              height: "108px",
              flexShrink: 0,
            },
          },
          tierEmblemUri
            ? h("img", {
                src: tierEmblemUri,
                width: 108,
                height: 108,
                style: {
                  width: "108px",
                  height: "108px",
                  objectFit: "contain",
                },
              })
            : null,
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "8px",
            },
          },
          h(
            "div",
            {
              style: {
                color: "#ffffff",
                fontSize: "29px",
                fontWeight: 800,
                letterSpacing: "0.01em",
                lineHeight: 1.15,
              },
            },
            tierInfo
              ? formatTierHeadline(tierInfo.name)
              : ranking
                ? `Top 100 ${region}`
                : `Season ${season} Contender`,
          ),
          hasRating
            ? h(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "baseline",
                    gap: "10px",
                  },
                },
                h(
                  "span",
                  {
                    style: {
                      color: "#f3c152",
                      fontSize: "38px",
                      fontWeight: 900,
                      letterSpacing: "-0.01em",
                      lineHeight: 1,
                    },
                  },
                  rating.toLocaleString("en-US"),
                ),
                h(
                  "span",
                  {
                    style: {
                      color: "#d1d5db",
                      fontSize: "19px",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      lineHeight: 1,
                    },
                  },
                  "PTS",
                ),
              )
            : h(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "baseline",
                    gap: "10px",
                  },
                },
                h(
                  "span",
                  {
                    style: {
                      color: "#f3c152",
                      fontSize: "36px",
                      fontWeight: 900,
                      lineHeight: 1,
                    },
                  },
                  ranking
                    ? `#${ranking}`
                    : kdRatio !== null
                      ? kdRatio.toFixed(2)
                      : `${wins}W`,
                ),
                h(
                  "span",
                  {
                    style: {
                      color: "#d1d5db",
                      fontSize: "18px",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      lineHeight: 1,
                    },
                  },
                  ranking
                    ? `${region} LADDER`
                    : kdRatio !== null
                      ? "K/D RATIO"
                      : "SEASON RECORD",
                ),
              ),
        ),
      ),

      // Right: Win/Loss + Winrate + Progress Bar + Total Games
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: "468px",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: "11px",
            },
          },
          h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "20px",
                fontWeight: 900,
              },
            },
            h("span", { style: { color: "#34d399" } }, `${wins}W`),
            h("span", { style: { color: "#6b7280", fontWeight: 600 } }, "/"),
            h("span", { style: { color: "#fb7185" } }, `${losses}L`),
            draws > 0
              ? [
                  h(
                    "span",
                    { style: { color: "#6b7280", fontWeight: 600 } },
                    "/",
                  ),
                  h("span", { style: { color: "#9ca3af" } }, `${draws}D`),
                ]
              : null,
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
              },
            },
            h(
              "span",
              {
                style: {
                  color: "#d1d5db",
                  fontSize: "17px",
                  fontWeight: 700,
                },
              },
              "Win Rate",
            ),
            h(
              "span",
              {
                style: {
                  color: "#ffffff",
                  fontSize: "25px",
                  fontWeight: 900,
                },
              },
              `${clampedWr.toFixed(1)}%`,
            ),
          ),
        ),
        // Dual-tone Bar
        h(
          "div",
          {
            style: {
              display: "flex",
              width: "100%",
              height: "20px",
              boxSizing: "border-box",
              backgroundColor: "#0c0f17",
              borderRadius: "999px",
              padding: "2px",
              border: "1px solid rgba(255, 255, 255, 0.10)",
              overflow: "hidden",
            },
          },
          totalGames > 0 && clampedWr > 0
            ? h("div", {
                style: {
                  width: `${clampedWr}%`,
                  height: "100%",
                  backgroundImage:
                    "linear-gradient(90deg, #06b6d4 0%, #38bdf8 100%)",
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
                  backgroundImage:
                    "linear-gradient(90deg, #f43f5e 0%, #dc2626 100%)",
                  borderTopRightRadius: "999px",
                  borderBottomRightRadius: "999px",
                  borderTopLeftRadius: clampedWr <= 0 ? "999px" : "0px",
                  borderBottomLeftRadius: clampedWr <= 0 ? "999px" : "0px",
                },
              })
            : null,
        ),
        // Sub-caption row
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: showKdInSubcaption ? "space-between" : "flex-end",
              marginTop: "10px",
              fontSize: "13px",
              color: "#9ca3af",
              fontWeight: 600,
            },
          },
          showKdInSubcaption
            ? h(
                "div",
                {
                  style: { display: "flex", alignItems: "center", gap: "5px" },
                },
                h("span", null, "Season K/D:"),
                h(
                  "span",
                  { style: { color: "#f3f4f6", fontWeight: 700 } },
                  kdRatio.toFixed(2),
                ),
              )
            : null,
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "5px" } },
            h("span", null, "Total Solare Games:"),
            h(
              "span",
              { style: { color: "#ffffff", fontWeight: 700 } },
              String(totalGames),
            ),
          ),
        ),
      ),
    ),

    // 3. BOTTOM TOP 3 PLAYED CLASSES
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          boxSizing: "border-box",
          gap: "16px",
        },
      },
      ...[0, 1, 2].map((idx) =>
        topClasses[idx]
          ? buildClassCard(topClasses[idx])
          : buildEmptyClassSlot(season),
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

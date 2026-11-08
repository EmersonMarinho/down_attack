<template>
  <div class="solare-home-page">
    <main
      class="flex-1 w-full max-w-[1440px] mx-auto px-4 md:px-8 py-6 flex flex-col gap-6"
    >
      <!-- TOP HEADER SECTION -->
      <div class="w-full max-w-[1240px] mx-auto flex flex-col gap-5 pt-2">
        <!-- Top Micro Bar -->
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div
            class="flex items-center gap-2 text-xs font-mono tracking-wider text-slate-400"
          >
            <span
              class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
            />
            <span
              class="uppercase tracking-widest text-[11px] text-slate-300 font-semibold"
            >
              COMPETITIVE SEASON {{ activeSeason }} ACTIVE • OFFICIAL 3V3 RANKED
            </span>
          </div>

          <NuxtLink
            to="/solare/overlay"
            class="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-[#3d424e]/70 bg-[#16181d]/80 hover:bg-[#20232a] text-[#d4af37] text-xs font-mono font-medium tracking-wide transition-all shadow-sm"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="text-[#d4af37] shrink-0"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <span>OBS Stream Overlay &amp; Chat Bot (!solare)</span>
          </NuxtLink>
        </div>

        <!-- Main Title Card Container -->
        <section
          class="rounded-xl border border-[#2b2d35] bg-[#14151a] p-8 md:p-10 flex flex-col items-center text-center shadow-2xl relative"
        >
          <h1
            class="solare-serif text-2xl sm:text-3xl md:text-[38px] tracking-[0.14em] text-[#f0e3c8] font-medium uppercase mb-3 leading-tight"
          >
            ARENA OF SOLARE PLAYER SEARCH
          </h1>
          <p class="text-sm md:text-[15px] text-[#9a9eab] max-w-2xl mb-8">
            Search official 3v3 ranked match history, class performance, combat
            averages, and regional Top 100 leaderboards.
          </p>

          <!-- Region tabs & Search bar container -->
          <div
            class="w-full max-w-2xl rounded-xl border border-[#262830] bg-[#111216] p-4 flex flex-col gap-4"
          >
            <!-- Region Selector Row -->
            <div class="flex items-center gap-2 flex-wrap text-xs font-mono">
              <span
                class="text-[#7d8291] font-semibold text-[11px] uppercase tracking-wider mr-1"
              >
                REGION:
              </span>
              <button
                v-for="reg in regions"
                :key="reg"
                type="button"
                :class="
                  selectedRegion === reg
                    ? 'px-3 py-1 rounded bg-[#d4af37] text-[#1c1808] font-bold text-xs shadow-sm hover:brightness-105 transition-all'
                    : 'px-3 py-1 rounded bg-[#1a1c22] text-[#9398a7] hover:text-white hover:bg-[#242730] transition-colors border border-[#2b2e38] text-xs font-medium'
                "
                @click="changeRegion(reg)"
              >
                {{ reg }}
              </button>
            </div>

            <!-- Search Input Bar -->
            <form
              class="flex items-stretch rounded-lg border border-[#2e313c] bg-[#16181f] overflow-hidden focus-within:border-[#d4af37]/60 transition-colors"
              @submit.prevent="handlePlayerSearch"
            >
              <div class="flex items-center pl-3.5 pr-2 text-[#7d8291]">
                <svg
                  class="w-4 h-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                v-model="searchInput"
                type="text"
                placeholder="Enter Family Name (e.g., Okazaki, Shamsir, Neri)..."
                class="flex-1 bg-transparent border-none text-sm text-[#e3e2e6] placeholder-[#5d6373] focus:outline-none focus:ring-0 py-2.5 px-1"
              />
              <button
                type="submit"
                class="bg-[#d4af37] hover:bg-[#dfba42] text-[#1c1808] font-bold text-xs uppercase px-7 tracking-wider transition-colors flex items-center justify-center"
              >
                SEARCH
              </button>
            </form>
          </div>
        </section>
      </div>

      <!-- LEADERBOARD SECTION -->
      <section
        class="w-full max-w-[1240px] mx-auto py-2 px-2 flex flex-col gap-1.5 select-none"
      >
        <!-- Filter Controls -->
        <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div class="flex items-center gap-2">
            <h2
              class="solare-serif text-base md:text-lg font-bold tracking-[0.08em] text-[#f0e3c8] uppercase"
            >
              TOP 100 LEADERBOARD ({{ selectedRegion }})
            </h2>
          </div>

          <div class="flex items-center gap-2.5 flex-wrap">
            <select
              v-model="selectedClassFilter"
              class="h-9 rounded-lg border border-[#2b2d35] bg-[#14151a] text-xs text-[#e3e2e6] px-3 focus:outline-none focus:border-[#d4af37]/70"
              aria-label="Filter by Class"
              @change="fetchRanking"
            >
              <option value="">All Classes</option>
              <option
                v-for="cls in classOptions"
                :key="cls.id"
                :value="String(cls.id)"
              >
                {{ cls.name }}
              </option>
            </select>

            <input
              v-model="tableSearchFilter"
              type="text"
              placeholder="Filter leaderboard..."
              class="h-9 rounded-lg border border-[#2b2d35] bg-[#14151a] text-xs text-[#e3e2e6] placeholder-[#5d6373] px-3 focus:outline-none focus:border-[#d4af37]/70"
            />
          </div>
        </div>

        <!-- Loading / Empty States -->
        <div
          v-if="isLoadingRanking"
          class="py-16 text-center rounded-xl border border-[#2b2d35] bg-[#14151a]"
        >
          <div class="solare-spinner mx-auto mb-3" />
          <p class="font-mono text-xs text-[#9a9eab]">
            Loading {{ selectedRegion }} Top 100 Leaderboard...
          </p>
        </div>

        <div
          v-else-if="filteredRankingPlayers.length === 0"
          class="py-14 text-center text-sm text-[#7d8291] rounded-xl border border-[#2b2d35] bg-[#14151a]"
        >
          No ranked players found for this filter in {{ selectedRegion }}.
        </div>

        <!-- IN-GAME ACCURATE LEADERBOARD -->
        <div v-else class="overflow-x-auto">
          <div class="min-w-[960px] flex flex-col gap-1.5">
            <!-- IN-GAME ACCURATE HEADER BAR -->
            <div
              class="grid grid-cols-12 items-center px-4 py-2.5 text-[#99907c] text-[12px] font-mono tracking-wider border-b border-[#4d4635]/30 mb-1 select-none"
            >
              <div class="col-span-5 flex items-center justify-between pr-4">
                <span
                  class="flex items-center gap-1.5 text-[#d0c5af] font-medium"
                >
                  <svg
                    class="w-4 h-4 text-[#f2ca50] shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Solare Throne</span>
                </span>
                <span class="text-[#d0c5af] font-medium text-center pr-10">
                  Family Name
                </span>
              </div>
              <div class="col-span-2 text-center text-[#d0c5af] font-medium">
                Win Rate
              </div>
              <div class="col-span-2 text-center text-[#d0c5af] font-medium">
                W / D / L
              </div>
              <div class="col-span-2 text-center text-[#d0c5af] font-medium">
                Recent Matches
              </div>
              <div
                class="col-span-1 text-right text-[#d0c5af] font-medium pr-2"
              >
                Rating
              </div>
            </div>

            <!-- PODIUM ROWS (RANKS 1, 2, 3) -->
            <div
              v-for="p in podiumPlayers"
              :key="`podium-${selectedRegion}-${p.user_no || p.user_nickname}`"
              class="group grid grid-cols-12 items-center px-4 py-2 min-h-[96px] relative overflow-hidden select-none cursor-pointer transition-all hover:brightness-110"
              :class="{
                'border border-[#9b783e]/60 shadow-2xl podium-rank-1':
                  p.rank === 1,
                'border border-[#4a586d]/60 shadow-xl': p.rank === 2,
                'border border-[#6b4832]/60 shadow-xl': p.rank === 3,
              }"
              :style="getPodiumBackgroundStyle(p.rank)"
              @click="goToPlayer(p.user_nickname)"
            >
              <div class="col-span-5 flex items-center gap-2.5 z-10 min-w-0">
                <div
                  class="relative flex items-center justify-center flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 -my-2"
                  :title="p.tierInfo?.name"
                >
                  <img
                    v-if="p.tierBadgeUrl"
                    :src="p.tierBadgeUrl"
                    :alt="p.tierInfo?.name || 'Solare Rank Medallion'"
                    class="w-full h-full object-contain"
                    :class="{
                      'drop-shadow-[0_0_12px_rgba(242,202,80,0.6)]':
                        p.rank === 1,
                      'drop-shadow-[0_0_12px_rgba(189,199,218,0.5)]':
                        p.rank === 2,
                      'drop-shadow-[0_0_12px_rgba(255,160,120,0.5)]':
                        p.rank === 3,
                    }"
                  />
                </div>

                <div
                  class="flex items-baseline solare-serif text-2xl sm:text-3xl font-bold tracking-tight w-12 sm:w-14 md:w-16 flex-shrink-0"
                  :class="{
                    'text-[#f5d580]': p.rank === 1,
                    'text-slate-200': p.rank === 2,
                    'text-[#ffb59c]': p.rank === 3,
                  }"
                >
                  {{ p.rank
                  }}<span class="text-sm sm:text-base uppercase ml-0.5">{{
                    p.ordinalSuffix
                  }}</span>
                </div>

                <div
                  class="relative h-16 sm:h-20 w-28 sm:w-32 md:w-36 xl:w-40 overflow-hidden flex-shrink-0 -my-2 flex items-center justify-center art-slice-mask"
                >
                  <img
                    v-if="p.portraitUrl"
                    :src="p.portraitUrl"
                    :alt="p.className"
                    class="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
                  />
                </div>

                <img
                  v-if="p.branchIconUrl"
                  :src="p.branchIconUrl"
                  :alt="p.branchName"
                  class="w-5 h-6 object-contain ml-1 flex-shrink-0"
                  :class="
                    p.branchName === 'Succession'
                      ? 'drop-shadow-[0_0_6px_rgba(100,180,255,0.6)]'
                      : 'drop-shadow-[0_0_6px_rgba(255,100,100,0.7)]'
                  "
                />

                <div class="flex flex-col ml-1 min-w-0">
                  <NuxtLink
                    :to="`/solare/player/${selectedRegion.toLowerCase()}/${encodeURIComponent(p.user_nickname)}`"
                    class="solare-serif text-base font-bold text-white hover:text-[#f2ca50] tracking-wide truncate transition-colors"
                    @click.stop
                  >
                    {{ p.user_nickname }}
                  </NuxtLink>
                  <span
                    class="text-xs truncate"
                    :class="{
                      'text-amber-200/80': p.rank === 1,
                      'text-slate-300/80': p.rank === 2,
                      'text-[#ffb59c]/80': p.rank === 3,
                    }"
                  >
                    [{{ p.branchName }}]{{ p.className }}
                  </span>
                </div>
              </div>

              <div
                class="col-span-2 flex items-center justify-center z-10 whitespace-nowrap"
              >
                <span class="rating-num text-sm text-[#e3e2e6] font-medium">
                  {{ p.formattedWinrate }}%
                </span>
              </div>

              <div
                class="col-span-2 text-center rating-num text-sm text-[#e3e2e6] z-10 whitespace-nowrap"
              >
                {{ p.wins }} / {{ p.draws }} / {{ p.losses }}
              </div>

              <div
                class="col-span-2 flex items-center justify-center gap-1 font-mono text-sm z-10 whitespace-nowrap"
              >
                <template
                  v-for="(slot, sIdx) in p.recentMatchSlots"
                  :key="sIdx"
                >
                  <span
                    v-if="slot === true"
                    class="text-sky-400 font-bold text-2xl leading-none -translate-y-[0.5px]"
                    >○</span
                  >
                  <span
                    v-else-if="slot === false"
                    class="text-red-400 font-bold leading-none"
                    >✕</span
                  >
                  <span v-else class="text-slate-600 font-bold leading-none"
                    >-</span
                  >
                  <span v-if="sIdx < 4" class="text-[#99907c] text-xs">/</span>
                </template>
              </div>

              <div
                class="col-span-1 text-right solare-serif text-2xl font-bold text-[#f2ca50] tracking-wider pr-2 z-10 whitespace-nowrap"
              >
                {{ p.rank_rating ?? "—" }}
              </div>
            </div>

            <!-- STANDARD ROWS (RANKS 4+) -->
            <div
              v-if="standardPlayers.length > 0"
              class="flex flex-col gap-1 mt-1"
            >
              <div
                v-for="(p, idx) in standardPlayers"
                :key="`row-${selectedRegion}-${p.user_no || p.user_nickname}`"
                class="group grid grid-cols-12 items-center px-4 py-2 hover:bg-[#202228] border border-[#2d2f36] hover:border-[#4d515f] transition-all select-none cursor-pointer"
                :class="idx % 2 === 0 ? 'bg-[#1b1c20]' : 'bg-[#17181c]'"
                @click="goToPlayer(p.user_nickname)"
              >
                <div class="col-span-5 flex items-center gap-2.5 min-w-0">
                  <div
                    class="w-12 h-12 flex items-center justify-center flex-shrink-0"
                    :title="p.tierInfo?.name"
                  >
                    <img
                      v-if="p.tierBadgeUrl"
                      :src="p.tierBadgeUrl"
                      :alt="p.tierInfo?.name || 'Solare Rank Medal'"
                      loading="lazy"
                      decoding="async"
                      class="w-11 h-11 object-contain drop-shadow-[0_0_6px_rgba(189,199,218,0.4)]"
                    />
                  </div>

                  <div
                    class="flex items-baseline text-white rating-num text-sm font-semibold w-12 flex-shrink-0"
                  >
                    {{ p.rank
                    }}<span
                      class="text-[11px] uppercase ml-0.5 text-slate-400"
                      >{{ p.ordinalSuffix }}</span
                    >
                  </div>

                  <div
                    class="w-32 h-10 overflow-hidden flex-shrink-0 flex items-center art-slice-mask"
                  >
                    <img
                      v-if="p.portraitUrl"
                      :src="p.portraitUrl"
                      :alt="p.className"
                      loading="lazy"
                      decoding="async"
                      class="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>

                  <img
                    v-if="p.branchIconUrl"
                    :src="p.branchIconUrl"
                    :alt="p.branchName"
                    loading="lazy"
                    decoding="async"
                    class="w-4 h-5 object-contain ml-1 flex-shrink-0"
                    :class="
                      p.branchName === 'Succession'
                        ? 'drop-shadow-[0_0_6px_rgba(100,180,255,0.6)]'
                        : 'drop-shadow-[0_0_6px_rgba(255,100,100,0.7)]'
                    "
                  />

                  <div class="flex flex-col min-w-0">
                    <NuxtLink
                      :to="`/solare/player/${selectedRegion.toLowerCase()}/${encodeURIComponent(p.user_nickname)}`"
                      class="solare-serif text-sm font-semibold text-white hover:text-[#f2ca50] truncate transition-colors"
                      @click.stop
                    >
                      {{ p.user_nickname }}
                    </NuxtLink>
                    <span class="text-[11px] text-slate-400 truncate">
                      [{{ p.branchName }}]{{ p.className }}
                    </span>
                  </div>
                </div>

                <div
                  class="col-span-2 flex items-center justify-center whitespace-nowrap"
                >
                  <span class="rating-num text-xs text-[#e3e2e6]">
                    {{ p.formattedWinrate }}%
                  </span>
                </div>

                <div
                  class="col-span-2 text-center rating-num text-xs text-[#e3e2e6] whitespace-nowrap"
                >
                  {{ p.wins }} / {{ p.draws }} / {{ p.losses }}
                </div>

                <div
                  class="col-span-2 flex items-center justify-center gap-1 font-mono text-xs whitespace-nowrap"
                >
                  <template
                    v-for="(slot, sIdx) in p.recentMatchSlots"
                    :key="sIdx"
                  >
                    <span
                      v-if="slot === true"
                      class="text-sky-400 font-bold text-[22px] leading-none -translate-y-[0.5px]"
                      >○</span
                    >
                    <span
                      v-else-if="slot === false"
                      class="text-red-400 font-bold leading-none"
                      >✕</span
                    >
                    <span v-else class="text-slate-600 font-bold leading-none"
                      >-</span
                    >
                    <span v-if="sIdx < 4" class="text-[#99907c] text-[10px]"
                      >/</span
                    >
                  </template>
                </div>

                <div
                  class="col-span-1 text-right solare-serif text-lg font-bold text-[#f2ca50] pr-2 whitespace-nowrap"
                >
                  {{ p.rank_rating ?? "—" }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import {
  BDO_CLASSES,
  getClassName,
  getSkillBranch,
  getClassAvatar,
  getClassIcon,
  getClassMatchSlot,
  getClassPortrait,
  getSkillBranchIcon,
  getTierInfo,
} from "~/utils/solareTier.js";

const route = useRoute();
const router = useRouter();

useSeoMeta({
  title:
    "BDO Arena of Solare Player Search, Match History & Top 100 Leaderboard",
  description:
    "Search Black Desert Online (BDO) Arena of Solare 3v3 player profiles, match histories, class winrates, K/D ratios, and regional Top 100 leaderboards across SA, NA, EU, KR, JP, RU, TR, and TW.",
});

definePageMeta({
  header: {
    name: "Arena of Solare",
    icon: "/images/solare/solare-icon-game@4x.png",
  },
});

const STORAGE_REGION_KEY = "solare_selected_region";
const regions = ["SA", "NA", "EU", "KR", "JP", "RU", "TR", "TW"];
const selectedRegion = ref("SA");
const regionInitialized = ref(false);
const activeSeason = ref(9);

function saveSelectedRegion(reg) {
  if (typeof window === "undefined") return;
  try {
    if (regions.includes(reg)) {
      window.localStorage.setItem(STORAGE_REGION_KEY, reg);
    }
  } catch {
    // Ignore storage errors
  }
}

function loadSavedRegion() {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(STORAGE_REGION_KEY);
    if (saved && regions.includes(saved.toUpperCase())) {
      return saved.toUpperCase();
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

const searchInput = ref("");
const selectedClassFilter = ref("");
const tableSearchFilter = ref("");

const isLoadingRanking = ref(true);
const rankingPlayers = ref([]);

const classOptions = Object.entries(BDO_CLASSES)
  .map(([id, name]) => ({ id: Number(id), name }))
  .sort((a, b) => a.name.localeCompare(b.name));

function getOrdinalSuffix(rank) {
  const n = Math.abs(Number(rank)) || 0;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function buildRecentMatchSlots(recentMatches) {
  const arr = Array.isArray(recentMatches) ? recentMatches.slice(0, 5) : [];
  return Array.from({ length: 5 }, (_, idx) =>
    idx < arr.length ? Boolean(arr[idx]) : null,
  );
}

function getPodiumBackgroundStyle(rank) {
  if (rank === 1) {
    return {
      background:
        "linear-gradient(90deg, #382818 0%, #634524 35%, #2a1e14 75%, #18191d 100%)",
    };
  }
  if (rank === 2) {
    return {
      background:
        "linear-gradient(90deg, #1b232e 0%, #2c3a4f 35%, #18202c 75%, #13151a 100%)",
    };
  }
  return {
    background:
      "linear-gradient(90deg, #241913 0%, #442a1d 35%, #231610 75%, #131418 100%)",
  };
}

const decoratedRankingPlayers = computed(() =>
  rankingPlayers.value.map((p) => {
    const totalGames = Number(p.total_games || 0);
    const wins = Number(p.wins || 0);
    const formattedWinrate =
      totalGames > 0
        ? ((wins / totalGames) * 100).toFixed(2)
        : Number(p.winrate || 0).toFixed(2);
    const tierInfo = getTierInfo(
      p.rank_rating !== null && p.rank_rating !== undefined
        ? p.rank_rating
        : p.rank <= 100
          ? 1850
          : 0,
      p.rank,
    );

    return {
      ...p,
      className: getClassName(p.class_type),
      branchName: getSkillBranch(p.class_type, p.skill_branch_type),
      avatarUrl: getClassAvatar(p.class_type),
      classIconUrl: getClassIcon(p.class_type),
      portraitUrl:
        getClassPortrait(p.class_type) || getClassMatchSlot(p.class_type),
      matchSlotUrl: getClassMatchSlot(p.class_type),
      branchIconUrl: getSkillBranchIcon(p.class_type, p.skill_branch_type),
      tierInfo,
      tierBadgeUrl: tierInfo?.badge_url || null,
      ordinalSuffix: getOrdinalSuffix(p.rank),
      formattedWinrate,
      recentMatchSlots: buildRecentMatchSlots(p.recent_matches),
    };
  }),
);

const filteredRankingPlayers = computed(() => {
  const q = tableSearchFilter.value.trim().toLowerCase();
  if (!q) return decoratedRankingPlayers.value;
  return decoratedRankingPlayers.value.filter(
    (p) =>
      p.user_nickname.toLowerCase().includes(q) ||
      p.className.toLowerCase().includes(q),
  );
});

const podiumPlayers = computed(() =>
  filteredRankingPlayers.value.filter((p) => p.rank >= 1 && p.rank <= 3),
);

const standardPlayers = computed(() =>
  filteredRankingPlayers.value.filter((p) => !(p.rank >= 1 && p.rank <= 3)),
);

async function fetchRanking() {
  isLoadingRanking.value = true;
  try {
    const params = new URLSearchParams();
    if (regionInitialized.value) {
      params.set("region", selectedRegion.value);
    }
    if (selectedClassFilter.value !== "") {
      params.set("class_type", selectedClassFilter.value);
    }

    const res = await fetch(`/api/v1/solare/ranking?${params.toString()}`);
    if (!res.ok) {
      rankingPlayers.value = [];
      return;
    }

    const body = await res.json();
    if (body.region && regions.includes(body.region)) {
      selectedRegion.value = body.region;
      regionInitialized.value = true;
      saveSelectedRegion(body.region);
    }
    if (body.season) {
      activeSeason.value = body.season;
    }
    rankingPlayers.value = body.players || [];
  } catch {
    rankingPlayers.value = [];
  } finally {
    isLoadingRanking.value = false;
  }
}

function changeRegion(reg) {
  selectedRegion.value = reg;
  regionInitialized.value = true;
  saveSelectedRegion(reg);
  fetchRanking();
}

function handlePlayerSearch() {
  const trimmed = searchInput.value.trim();
  if (!trimmed) return;
  goToPlayer(trimmed);
}

function goToPlayer(nick) {
  saveSelectedRegion(selectedRegion.value);
  router.push(
    `/solare/player/${selectedRegion.value.toLowerCase()}/${encodeURIComponent(nick)}`,
  );
}

onMounted(() => {
  const savedRegion = loadSavedRegion();
  if (savedRegion) {
    selectedRegion.value = savedRegion;
    regionInitialized.value = true;
  }

  // Support direct ?nick=... query link by redirecting to dedicated player route
  if (route.query.nick) {
    const qNick = String(route.query.nick).trim();
    const qReg = String(route.query.region || selectedRegion.value || "SA")
      .trim()
      .toUpperCase();
    if (regions.includes(qReg)) {
      saveSelectedRegion(qReg);
    }
    if (qNick) {
      router.replace(
        `/solare/player/${qReg.toLowerCase()}/${encodeURIComponent(qNick)}`,
      );
      return;
    }
  }

  fetchRanking();
});
</script>

<style scoped>
.solare-home-page {
  min-height: calc(100vh - 4.5rem);
  background: #0c0d10;
  color: #e3e2e6;
  font-family:
    "Plus Jakarta Sans",
    "IBM Plex Sans",
    system-ui,
    -apple-system,
    sans-serif;
  -webkit-font-smoothing: antialiased;
}

.solare-serif {
  font-family: "Cinzel", serif;
}

.rating-num {
  font-feature-settings: "tnum" 1;
}

.podium-rank-1 {
  box-shadow:
    0 0 35px -5px rgba(212, 175, 55, 0.25),
    inset 0 1px 0 rgba(229, 193, 115, 0.4);
}

.art-slice-mask {
  mask-image: linear-gradient(
    to right,
    transparent 0%,
    black 14%,
    black 86%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0%,
    black 14%,
    black 86%,
    transparent 100%
  );
}

.solare-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #2e3039;
  border-top-color: #d4af37;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

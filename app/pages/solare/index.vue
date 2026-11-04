<template>
  <div class="solare-home-page">
    <div class="solare-home-container">
      <!-- TOP BAR WITH STREAM OVERLAY CTA -->
      <div class="solare-home-topbar">
        <div class="flex items-center gap-2.5">
          <span class="solare-live-dot" />
          <span class="font-mono text-[11px] tracking-[0.08em] text-[#9a9aa3]">
            COMPETITIVE SEASON {{ activeSeason }} ACTIVE • OFFICIAL 3V3 RANKED
          </span>
        </div>

        <NuxtLink to="/solare/overlay" class="solare-overlay-cta">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <span>OBS Stream Overlay &amp; Chat Bot (!solare)</span>
        </NuxtLink>
      </div>

      <!-- HERO SEARCH CARD -->
      <section class="solare-hero-card">
        <div class="text-center space-y-2 max-w-2xl mx-auto">
          <h1 class="solare-hero-title">ARENA OF SOLARE PLAYER SEARCH</h1>
          <p class="text-sm text-[#9a9aa3]">
            Search official 3v3 ranked match history, class performance, combat
            averages, and regional Top 100 leaderboards.
          </p>
        </div>

        <!-- SEARCH BAR + REGION PILLS -->
        <div class="solare-search-box">
          <div class="solare-region-strip">
            <span
              class="font-mono text-[11px] tracking-[0.08em] text-[#7d7e86] mr-1"
            >
              REGION:
            </span>
            <button
              v-for="reg in regions"
              :key="reg"
              type="button"
              class="solare-region-btn"
              :class="{ 'solare-region-btn--active': selectedRegion === reg }"
              @click="changeRegion(reg)"
            >
              {{ reg }}
            </button>
          </div>

          <form class="solare-hero-form" @submit.prevent="handlePlayerSearch">
            <svg
              class="w-4 h-4 text-[#7d7e86] ml-3.5 shrink-0"
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
            <input
              v-model="searchInput"
              type="text"
              placeholder="Enter Family Name (e.g., Okazaki, Shamsir, Neri)..."
              class="solare-hero-input"
            />
            <button type="submit" class="solare-hero-submit">SEARCH</button>
          </form>
        </div>
      </section>

      <!-- TOP 100 LEADERBOARD SECTION -->
      <section class="solare-ranking-section">
        <div class="solare-ranking-header">
          <div>
            <h2 class="solare-ranking-title">
              TOP 100 LEADERBOARD ({{ selectedRegion }})
            </h2>
            <p class="text-xs text-[#7d7e86] mt-0.5">
              Click any player to open their full 3v3 match history and combat
              dashboard.
            </p>
          </div>

          <!-- Class Filter & Quick Filter -->
          <div class="flex items-center gap-3 flex-wrap">
            <select
              v-model="selectedClassFilter"
              class="solare-filter-select"
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
              class="solare-filter-input"
            />
          </div>
        </div>

        <!-- Ranking Table Card -->
        <div class="solare-ranking-card">
          <div v-if="isLoadingRanking" class="py-16 text-center">
            <div class="solare-spinner mx-auto mb-3" />
            <p class="font-mono text-xs text-[#9a9aa3]">
              Loading {{ selectedRegion }} Top 100 Leaderboard...
            </p>
          </div>

          <div
            v-else-if="filteredRankingPlayers.length === 0"
            class="py-14 text-center text-sm text-[#7d7e86]"
          >
            No ranked players found for this filter in {{ selectedRegion }}.
          </div>

          <div v-else class="overflow-x-auto">
            <table class="solare-ranking-table">
              <thead>
                <tr>
                  <th class="w-20 text-center">RANK</th>
                  <th class="text-left">PLAYER</th>
                  <th class="text-left">CLASS &amp; SPEC</th>
                  <th class="text-center">MATCHES</th>
                  <th class="text-center">RECORD</th>
                  <th class="w-48 text-right">WIN RATE</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in filteredRankingPlayers"
                  :key="`${selectedRegion}-${p.user_no || p.user_nickname}`"
                  class="solare-ranking-row"
                  @click="goToPlayer(p.user_nickname)"
                >
                  <td class="text-center font-mono">
                    <span
                      class="solare-rank-pill"
                      :class="{
                        'solare-rank-pill--1': p.rank === 1,
                        'solare-rank-pill--2': p.rank === 2,
                        'solare-rank-pill--3': p.rank === 3,
                      }"
                    >
                      #{{ p.rank }}
                    </span>
                  </td>

                  <td>
                    <div class="flex items-center gap-3">
                      <img
                        v-if="p.avatarUrl"
                        :src="p.avatarUrl"
                        :alt="p.className"
                        class="w-9 h-9 rounded-full border border-[#34353c] bg-[#1c1d22] object-cover shrink-0"
                      />
                      <NuxtLink
                        :to="`/solare/player/${selectedRegion.toLowerCase()}/${encodeURIComponent(p.user_nickname)}`"
                        class="font-semibold text-[14px] text-[#f1e6cf] hover:text-[#d4af6a] transition"
                        @click.stop
                      >
                        {{ p.user_nickname }}
                      </NuxtLink>
                    </div>
                  </td>

                  <td>
                    <div class="flex items-center gap-2">
                      <img
                        v-if="p.branchIconUrl"
                        :src="p.branchIconUrl"
                        :alt="p.branchName"
                        class="w-4 h-4 object-contain shrink-0"
                      />
                      <img
                        v-if="p.classIconUrl"
                        :src="p.classIconUrl"
                        :alt="p.className"
                        class="w-4 h-4 object-contain opacity-75 shrink-0"
                      />
                      <span class="text-[13px] text-[#ece7df]">
                        {{ p.className }}
                      </span>
                      <span class="text-[#4a4b52]">•</span>
                      <span class="text-xs text-[#d4af6a]">
                        {{ p.branchName }}
                      </span>
                    </div>
                  </td>

                  <td class="text-center font-mono text-[13px] text-[#c8c1b7]">
                    {{ p.total_games }}
                  </td>

                  <td class="text-center font-mono text-[13px]">
                    <span class="text-[#5ca3ff] font-semibold">
                      {{ p.wins }}W
                    </span>
                    <span class="text-[#4a4b52] mx-1">-</span>
                    <span class="text-[#ec6a5e] font-semibold">
                      {{ p.losses }}L
                    </span>
                  </td>

                  <td class="text-right">
                    <div class="flex items-center justify-end gap-3">
                      <div
                        class="w-20 h-1.5 rounded bg-[#24252b] overflow-hidden hidden sm:block"
                      >
                        <div
                          class="h-full rounded"
                          :style="{
                            width: `${Math.min(100, Math.max(0, p.winrate))}%`,
                            background: getWinrateColor(p.winrate),
                          }"
                        />
                      </div>
                      <span
                        class="font-mono text-[13px] font-semibold w-12 text-right"
                        :style="{ color: getWinrateColor(p.winrate) }"
                      >
                        {{ p.winrate.toFixed(1) }}%
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
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
  getSkillBranchIcon,
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

function getWinrateColor(wr) {
  const num = Number(wr) || 0;
  if (num >= 60) return "#35c48b";
  if (num >= 50) return "#c8c1b7";
  return "#ec6a5e";
}

const decoratedRankingPlayers = computed(() =>
  rankingPlayers.value.map((p) => ({
    ...p,
    className: getClassName(p.class_type),
    branchName: getSkillBranch(p.class_type, p.skill_branch_type),
    avatarUrl: getClassAvatar(p.class_type),
    classIconUrl: getClassIcon(p.class_type),
    branchIconUrl: getSkillBranchIcon(p.class_type, p.skill_branch_type),
  })),
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
  background: #101114;
  color: #ece7df;
  font-family: "IBM Plex Sans", system-ui, sans-serif;
  padding: 24px 16px 64px;
  -webkit-font-smoothing: antialiased;
}

.solare-home-container {
  max-width: 1320px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.solare-home-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.solare-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #35c48b;
  box-shadow: 0 0 8px rgba(53, 196, 139, 0.6);
}

.solare-overlay-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #d4af6a;
  background: #221d15;
  border: 1px solid #5a4a2c;
  border-radius: 8px;
  padding: 8px 14px;
  text-decoration: none;
  transition: all 0.15s ease;
}

.solare-overlay-cta:hover {
  background: #2d261b;
  border-color: #d4af6a;
}

.solare-hero-card {
  background: #16171b;
  border: 1px solid #26272c;
  border-radius: 12px;
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.solare-hero-title {
  margin: 0;
  font-family: "Cinzel", serif;
  font-weight: 700;
  font-size: clamp(24px, 3.2vw, 36px);
  letter-spacing: 0.05em;
  color: #f1e6cf;
}

.solare-search-box {
  max-width: 820px;
  width: 100%;
  margin: 0 auto;
  background: #111216;
  border: 1px solid #2a2b31;
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.solare-region-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.solare-region-btn {
  border: 1px solid #26272c;
  background: #16171b;
  color: #9a9aa3;
  border-radius: 5px;
  padding: 4px 10px;
  font:
    600 11px "JetBrains Mono",
    monospace;
  cursor: pointer;
  transition: all 0.15s ease;
}

.solare-region-btn:hover {
  color: #ece7df;
  border-color: #3a3b42;
}

.solare-region-btn--active {
  background: #d4af6a;
  border-color: #d4af6a;
  color: #1a1610;
}

.solare-hero-form {
  display: flex;
  align-items: center;
  background: #16171b;
  border: 1px solid #2e3039;
  border-radius: 8px;
  height: 44px;
  overflow: hidden;
}

.solare-hero-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: #ece7df;
  font-size: 14px;
  padding: 0 12px;
}

.solare-hero-submit {
  height: 100%;
  border: none;
  background: #d4af6a;
  color: #1a1610;
  font:
    700 12px "IBM Plex Sans",
    sans-serif;
  letter-spacing: 0.08em;
  padding: 0 24px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.solare-hero-submit:hover {
  background: #e2c07e;
}

/* RANKING SECTION */
.solare-ranking-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.solare-ranking-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.solare-ranking-title {
  margin: 0;
  font-family: "Cinzel", serif;
  font-weight: 700;
  font-size: 20px;
  letter-spacing: 0.04em;
  color: #f1e6cf;
}

.solare-filter-select,
.solare-filter-input {
  height: 36px;
  background: #16171b;
  border: 1px solid #26272c;
  border-radius: 8px;
  color: #ece7df;
  font-size: 13px;
  padding: 0 12px;
  outline: none;
}

.solare-filter-select:focus,
.solare-filter-input:focus {
  border-color: #d4af6a;
}

.solare-ranking-card {
  background: #16171b;
  border: 1px solid #26272c;
  border-radius: 10px;
  overflow: hidden;
}

.solare-ranking-table {
  width: 100%;
  border-collapse: collapse;
}

.solare-ranking-table thead tr {
  border-bottom: 1px solid #26272c;
  background: #131418;
}

.solare-ranking-table th {
  padding: 12px 16px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  color: #7d7e86;
  white-space: nowrap;
}

.solare-ranking-row {
  border-bottom: 1px solid #1e2026;
  cursor: pointer;
  transition: background 0.12s ease;
}

.solare-ranking-row:hover {
  background: #1b1d23;
}

.solare-ranking-row td {
  padding: 10px 16px;
  white-space: nowrap;
}

.solare-rank-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #9a9aa3;
}

.solare-rank-pill--1 {
  background: rgba(212, 175, 106, 0.18);
  color: #d4af6a;
  border: 1px solid #6a5631;
}

.solare-rank-pill--2 {
  background: rgba(200, 193, 183, 0.14);
  color: #e2ddd5;
  border: 1px solid #524f4a;
}

.solare-rank-pill--3 {
  background: rgba(186, 123, 79, 0.16);
  color: #d89566;
  border: 1px solid #6b462d;
}

.solare-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #2e3039;
  border-top-color: #d4af6a;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

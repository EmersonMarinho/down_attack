<template>
  <div class="solare-v3-page">
    <div class="solare-v3-container">
      <!-- TOP NAVIGATION & SEARCH BAR -->
      <nav class="solare-top-bar">
        <div class="solare-top-links">
          <NuxtLink to="/solare" class="solare-brand-link">
            <img
              src="/images/solare/solare-icon-game@4x.png"
              alt="Solare"
              class="w-6 h-6 object-contain"
            />
            <span class="solare-brand-title">SOLARE</span>
            <span class="solare-brand-sub">Ranking &amp; Search</span>
          </NuxtLink>

          <NuxtLink to="/solare/overlay" class="solare-overlay-pill">
            <span>Stream Overlay &amp; Bot</span>
          </NuxtLink>
        </div>

        <form class="solare-search-form" @submit.prevent="submitSearch">
          <select
            v-model="searchRegion"
            class="solare-search-select"
            aria-label="Select Region"
          >
            <option v-for="reg in regions" :key="reg" :value="reg">
              {{ reg }}
            </option>
          </select>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search Family Name..."
            class="solare-search-input"
          />
          <button type="submit" class="solare-search-btn">SEARCH</button>
        </form>
      </nav>

      <!-- LOADING STATE -->
      <div v-if="isLoadingProfile && !profile" class="solare-state-card">
        <div class="solare-spinner" />
        <p class="text-sm text-[#9a9aa3] font-mono">
          Loading Arena of Solare profile for
          <span class="text-[#f1e6cf] font-semibold">{{ routeNick }}</span>
          ({{ routeRegion }})...
        </p>
      </div>

      <!-- ERROR / NOT FOUND STATE -->
      <div v-else-if="errorMessage && !profile" class="solare-state-card">
        <p class="font-['Cinzel',serif] text-xl font-bold text-[#f1e6cf]">
          Player Not Found
        </p>
        <p class="text-sm text-[#9a9aa3] max-w-md text-center">
          {{ errorMessage }}
        </p>
        <div class="flex items-center gap-3 pt-2">
          <NuxtLink to="/solare" class="solare-gold-btn">
            Back to Leaderboard
          </NuxtLink>
        </div>
      </div>

      <!-- PROFILE DASHBOARD -->
      <template v-else-if="profile">
        <!-- HEADER CARD -->
        <header class="solare-header-card">
          <div class="solare-header-left">
            <div class="solare-portrait-wrap">
              <img
                v-if="headerPortraitUrl && !portraitError"
                :src="headerPortraitUrl"
                :alt="profile.user_nickname"
                class="solare-portrait-img"
                @error="portraitError = true"
              />
              <div v-else class="solare-portrait-fallback">
                <img
                  src="/images/solare/solare-icon-game@4x.png"
                  alt="Solare"
                  class="w-10 h-10 object-contain opacity-70"
                />
              </div>
              <div class="solare-portrait-badge">
                {{
                  profile.current_ranking
                    ? `#${profile.current_ranking} ${profile.region}`
                    : profile.region
                }}
              </div>
            </div>

            <div class="solare-identity-col">
              <div class="solare-name-row">
                <h1 class="solare-player-name">
                  {{ profile.user_nickname }}
                </h1>
                <span class="solare-region-tag">
                  {{
                    profile.current_ranking
                      ? `#${profile.current_ranking} ${profile.region}`
                      : profile.rank_rating !== null &&
                          profile.rank_rating !== undefined
                        ? profile.region
                        : `UNRANKED ${profile.region}`
                  }}
                </span>
                <span v-if="profile.class_ranking" class="solare-top-tag">
                  TOP #{{ profile.class_ranking }}
                  {{ primaryClassName.toUpperCase() }}
                </span>
                <span
                  v-else-if="
                    profile.current_ranking && profile.current_ranking <= 100
                  "
                  class="solare-top-tag"
                >
                  TOP 100
                </span>
              </div>

              <div class="solare-class-row">
                <img
                  v-if="primaryBranchIcon"
                  :src="primaryBranchIcon"
                  :alt="primarySpecName"
                  class="w-4 h-4 object-contain"
                />
                <span class="text-[#ece7df] font-medium">
                  {{ primaryClassName }}
                </span>
                <span class="text-[#4a4b52]">•</span>
                <span class="text-[#d4af6a] font-medium">
                  {{ primarySpecName }}
                </span>
                <span class="text-[#4a4b52]">•</span>
                <span class="font-mono text-xs text-[#9a9aa3]">
                  {{ profile.overall?.wins ?? 0 }}W
                  {{ profile.overall?.losses ?? 0 }}L ({{
                    profile.overall?.winrate ?? 0
                  }}%)
                </span>
              </div>

              <div class="solare-update-row">
                <button
                  type="button"
                  :disabled="isRefreshing"
                  class="solare-gold-btn"
                  @click="refreshProfile"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    :class="{ 'animate-spin': isRefreshing }"
                  >
                    <path
                      d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.5H10"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span>{{ isRefreshing ? "UPDATING…" : "UPDATE" }}</span>
                </button>

                <span class="solare-updated-status">
                  <span class="solare-status-dot" />
                  <span>{{ lastMatchStatusText }}</span>
                </span>
              </div>
            </div>
          </div>

          <div class="solare-header-stats">
            <div class="solare-header-stat-item">
              <span class="solare-header-stat-label">SEASON</span>
              <span class="solare-header-stat-value">
                Season {{ profile.season }}
                <span class="font-normal text-[#7d7e86]">(Active)</span>
              </span>
            </div>
            <div class="solare-header-stat-item">
              <span class="solare-header-stat-label">LADDER RANK</span>
              <span class="solare-header-stat-value font-mono text-[#d4af6a]">
                {{
                  profile.current_ranking
                    ? `#${profile.current_ranking} ${profile.region}`
                    : `Unranked ${profile.region}`
                }}
              </span>
            </div>
            <div
              v-if="
                profile.rank_rating !== null &&
                profile.rank_rating !== undefined
              "
              class="solare-header-stat-item"
            >
              <span class="solare-header-stat-label">RATING</span>
              <span
                class="solare-header-stat-value font-mono text-[#f1e6cf] inline-flex items-center gap-1.5"
                :title="profileTierInfo?.name"
              >
                <img
                  v-if="profileTierInfo?.badge_url"
                  :src="profileTierInfo.badge_url"
                  :alt="profileTierInfo.name"
                  class="w-5 h-5 object-contain shrink-0"
                />
                <span>{{ profile.rank_rating }} PTS</span>
              </span>
            </div>
            <div class="solare-header-stat-item">
              <span class="solare-header-stat-label">BEST WIN STREAK</span>
              <span
                class="solare-header-stat-value font-mono text-[#35c48b]"
                :title="
                  profile.overall?.current_win_streak
                    ? `Current active streak: ${profile.overall.current_win_streak}W`
                    : ''
                "
              >
                {{ profile.overall?.best_win_streak ?? 0 }} Matches
              </span>
            </div>
          </div>
        </header>

        <!-- GEAR (crystals + alchemy stone) -->
        <SolareGearPanel
          v-if="gearPanel"
          :gear="gearPanel.gear"
          :sets="gearPanel.sets"
          :title="gearPanel.title"
          :source="gearPanel.source"
        />

        <!-- MAIN BODY: SIDEBAR + MATCH HISTORY -->
        <div class="solare-main-grid">
          <!-- LEFT SIDEBAR -->
          <aside class="solare-sidebar">
            <!-- SEASON OVERVIEW CARD -->
            <section class="solare-side-card">
              <div class="flex items-center justify-between">
                <span class="solare-side-title">SEASON RECORD (3V3)</span>
                <span class="font-mono text-xs text-[#7d7e86]">
                  {{ profile.overall?.total_games ?? 0 }} Games
                </span>
              </div>

              <div class="flex items-baseline justify-between gap-2">
                <div class="font-mono text-lg font-semibold text-[#ece7df]">
                  <span class="text-[#5ca3ff]">
                    {{ profile.overall?.wins ?? 0 }}W
                  </span>
                  <span class="text-[#4a4b52] mx-1">/</span>
                  <span class="text-[#ec6a5e]">
                    {{ profile.overall?.losses ?? 0 }}L
                  </span>
                </div>
                <span
                  class="font-mono text-xl font-bold"
                  :style="{
                    color: getWinrateColor(profile.overall?.winrate ?? 0),
                  }"
                >
                  {{ (profile.overall?.winrate ?? 0).toFixed(1) }}%
                </span>
              </div>

              <div
                class="h-1.5 rounded bg-[#24252b] overflow-hidden flex"
                aria-hidden="true"
              >
                <div
                  class="h-full bg-[#5ca3ff] transition-all"
                  :style="{
                    width: `${Math.min(100, Math.max(0, profile.overall?.winrate ?? 0))}%`,
                  }"
                />
              </div>

              <div
                class="grid grid-cols-3 gap-2 pt-2 border-t border-[#22232a] text-center font-mono"
              >
                <div>
                  <span class="block text-[10px] text-[#7d7e86]">AVG DMG</span>
                  <span class="text-xs font-semibold text-[#ece7df]">
                    {{ formatNumber(profile.averages?.damage_done ?? 0, true) }}
                  </span>
                </div>
                <div>
                  <span class="block text-[10px] text-[#7d7e86]">AVG HEAL</span>
                  <span class="text-xs font-semibold text-[#35c48b]">
                    {{ formatNumber(profile.averages?.recovery ?? 0, true) }}
                  </span>
                </div>
                <div>
                  <span class="block text-[10px] text-[#7d7e86]">AVG CC</span>
                  <span class="text-xs font-semibold text-[#d4af6a]">
                    {{ profile.averages?.cc ?? 0 }}
                  </span>
                </div>
              </div>
            </section>

            <!-- PDL TREND (LAST 20) -->
            <section v-if="sparklineData.hasData" class="solare-side-card">
              <div class="flex justify-between items-baseline">
                <span class="solare-side-title">PDL TREND</span>
                <span class="text-xs text-[#7d7e86]">
                  Last {{ sparklineData.count }} matches
                </span>
              </div>

              <div class="relative h-[104px]">
                <svg
                  viewBox="0 0 300 100"
                  preserveAspectRatio="none"
                  class="absolute inset-0 w-full h-full block"
                >
                  <defs>
                    <linearGradient id="pdlfill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0"
                        stop-color="#d4af6a"
                        stop-opacity="0.28"
                      />
                      <stop
                        offset="1"
                        stop-color="#d4af6a"
                        stop-opacity="0.0"
                      />
                    </linearGradient>
                  </defs>
                  <line
                    x1="0"
                    y1="15"
                    x2="300"
                    y2="15"
                    stroke="#2a2b31"
                    stroke-dasharray="3 4"
                    vector-effect="non-scaling-stroke"
                  />
                  <line
                    x1="0"
                    y1="50"
                    x2="300"
                    y2="50"
                    stroke="#2a2b31"
                    stroke-dasharray="3 4"
                    vector-effect="non-scaling-stroke"
                  />
                  <line
                    x1="0"
                    y1="85"
                    x2="300"
                    y2="85"
                    stroke="#2a2b31"
                    stroke-dasharray="3 4"
                    vector-effect="non-scaling-stroke"
                  />
                  <polygon :points="sparklineData.area" fill="url(#pdlfill)" />
                  <polyline
                    :points="sparklineData.points"
                    fill="none"
                    stroke="#d4af6a"
                    stroke-width="2"
                    stroke-linejoin="round"
                    vector-effect="non-scaling-stroke"
                  />
                </svg>
                <div
                  class="solare-spark-dot"
                  :style="{ top: sparklineData.dotTop }"
                />
              </div>

              <div
                class="flex justify-between items-center font-mono text-xs pt-1"
              >
                <span class="text-[#7d7e86]">Net PDL Variation</span>
                <span
                  class="px-2 py-0.5 rounded font-semibold border"
                  :class="
                    sparklineData.netDelta >= 0
                      ? 'text-[#35c48b] bg-[#35c48b]/10 border-[#35c48b]/35'
                      : 'text-[#ec6a5e] bg-[#ec6a5e]/10 border-[#ec6a5e]/35'
                  "
                >
                  {{
                    sparklineData.netDelta >= 0
                      ? `+${sparklineData.netDelta} PDL`
                      : `${sparklineData.netDelta} PDL`
                  }}
                </span>
              </div>
            </section>

            <!-- SPEC PERFORMANCE -->
            <section class="solare-side-card">
              <div class="flex items-center justify-between">
                <span class="solare-side-title">SPEC PERFORMANCE</span>
                <button
                  v-if="selectedClassFilter !== null"
                  type="button"
                  class="text-[11px] font-mono text-[#d4af6a] hover:underline cursor-pointer"
                  @click="selectClassFilter(null)"
                >
                  Reset Filter
                </button>
              </div>

              <div
                v-if="formattedClasses.length === 0"
                class="text-xs text-[#7d7e86] py-2"
              >
                No class history recorded in this season yet.
              </div>

              <button
                v-for="spec in formattedClasses"
                :key="spec.key"
                type="button"
                class="solare-spec-item"
                :class="{
                  'solare-spec-item--active':
                    selectedClassFilter === spec.class_type,
                }"
                @click="
                  selectClassFilter(
                    selectedClassFilter === spec.class_type
                      ? null
                      : spec.class_type,
                  )
                "
              >
                <div class="solare-spec-icon-wrap">
                  <img
                    v-if="spec.avatarUrl"
                    :src="spec.avatarUrl"
                    :alt="spec.className"
                    class="w-full h-full object-cover rounded-[6px]"
                  />
                  <img
                    v-if="spec.branchIconUrl"
                    :src="spec.branchIconUrl"
                    :alt="spec.branchName"
                    class="solare-spec-branch-badge"
                  />
                </div>
                <div class="flex flex-col gap-0.5 min-w-0 text-left">
                  <span
                    class="text-[13px] font-semibold text-[#ece7df] truncate"
                  >
                    {{ spec.className }} · {{ spec.branchName }}
                  </span>
                  <span class="font-mono text-[11px] text-[#7d7e86] truncate">
                    {{ spec.total_games }} games · {{ spec.kdRatio }} K/D
                  </span>
                </div>
                <div class="flex flex-col items-end gap-0.5 shrink-0">
                  <span
                    class="font-mono text-[15px] font-semibold"
                    :style="{ color: getWinrateColor(spec.winrate) }"
                  >
                    {{ spec.winrate.toFixed(1) }}%
                  </span>
                  <span class="text-[11px] text-[#7d7e86]">Win rate</span>
                </div>
              </button>
            </section>

            <!-- RECENTLY PLAYED WITH -->
            <section
              v-if="recentlyPlayedWith.length > 0"
              class="solare-side-card"
            >
              <div class="flex justify-between items-baseline">
                <span class="solare-side-title">RECENTLY PLAYED WITH</span>
                <span class="text-xs text-[#7d7e86]">
                  Last {{ loadedMatches.length }}
                </span>
              </div>

              <div class="flex flex-col gap-1.5">
                <div
                  v-for="mate in recentlyPlayedWith"
                  :key="mate.user_nickname"
                  class="solare-mate-row"
                >
                  <img
                    v-if="mate.avatarUrl"
                    :src="mate.avatarUrl"
                    :alt="mate.className"
                    class="w-[26px] h-[26px] rounded-full border border-[#34353c] object-cover bg-[#24252b]"
                  />
                  <div
                    v-else
                    class="w-[26px] h-[26px] rounded-full border border-[#34353c] bg-[#24252b] flex items-center justify-center font-mono text-[9px] text-[#9a9aa3]"
                  >
                    {{ mate.abbr }}
                  </div>

                  <NuxtLink
                    :to="`/solare/player/${profile.region.toLowerCase()}/${encodeURIComponent(mate.user_nickname)}`"
                    class="text-[13px] text-[#ece7df] hover:text-[#d4af6a] truncate transition"
                  >
                    {{ mate.user_nickname }}
                  </NuxtLink>

                  <span class="font-mono text-xs text-[#7d7e86] text-right">
                    {{ mate.wins }}W {{ mate.losses }}L
                  </span>

                  <span
                    class="font-mono text-xs font-semibold text-right"
                    :style="{ color: getWinrateColor(mate.winrate) }"
                  >
                    {{ mate.winrate }}%
                  </span>
                </div>
              </div>
            </section>
          </aside>

          <!-- MAIN COLUMN: SUMMARY + MATCHES -->
          <section class="solare-matches-col">
            <!-- FILTER TABS & RECENT STATS BANNER -->
            <div class="solare-summary-box">
              <div class="solare-tabs-bar">
                <button
                  v-for="tab in matchTabs"
                  :key="tab.id"
                  type="button"
                  class="solare-tab-btn"
                  :class="{
                    'solare-tab-btn--active': resultFilter === tab.id,
                  }"
                  @click="resultFilter = tab.id"
                >
                  <span>{{ tab.label }}</span>
                  <span class="font-mono text-[11px] text-[#7d7e86]">
                    {{ tab.count }}
                  </span>
                </button>

                <div
                  class="ml-auto flex items-center gap-2 pr-2 py-2 flex-wrap"
                >
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded text-[11px] font-mono border transition cursor-pointer"
                    :class="
                      compactNumbers
                        ? 'bg-[#1d1f26] border-[#3a3b42] text-[#d4af6a]'
                        : 'bg-transparent border-[#26272c] text-[#7d7e86] hover:text-[#ece7df]'
                    "
                    @click="compactNumbers = !compactNumbers"
                  >
                    {{
                      compactNumbers ? "Compact (205.6k)" : "Exact (205,600)"
                    }}
                  </button>
                </div>
              </div>

              <div class="solare-summary-content">
                <div class="flex items-center gap-4 shrink-0">
                  <div
                    class="solare-donut"
                    :style="{
                      background: `conic-gradient(#5ca3ff 0 ${recentSummary.winrate}%, #ec6a5e ${recentSummary.winrate}% 100%)`,
                    }"
                  >
                    <div class="solare-donut-inner">
                      {{ Math.round(recentSummary.winrate) }}%
                    </div>
                  </div>
                  <div class="flex flex-col gap-0.5 whitespace-nowrap">
                    <span class="text-xs text-[#7d7e86]">
                      Last {{ recentSummary.total }} matches
                    </span>
                    <span class="font-mono text-[15px] font-semibold">
                      <span class="text-[#5ca3ff]">
                        {{ recentSummary.wins }}W
                      </span>
                      <span class="text-[#ec6a5e] ml-1.5">
                        {{ recentSummary.losses }}L
                      </span>
                    </span>
                  </div>
                </div>

                <div class="solare-summary-divider" />

                <div class="solare-summary-metrics">
                  <div class="flex flex-col gap-1 whitespace-nowrap">
                    <span class="text-[11px] tracking-[0.08em] text-[#7d7e86]">
                      K / D
                    </span>
                    <span class="font-mono text-[17px] font-semibold">
                      {{ recentSummary.avgKills }}
                      <span class="text-[#4a4b52]">/</span>
                      {{ recentSummary.avgDeaths }}
                    </span>
                    <span class="font-mono text-[11px] text-[#d4af6a]">
                      {{ recentSummary.kdRatio }} K/D
                    </span>
                  </div>

                  <div class="flex flex-col gap-1 whitespace-nowrap">
                    <span class="text-[11px] tracking-[0.08em] text-[#7d7e86]">
                      KILL PART.
                    </span>
                    <span
                      class="font-mono text-[17px] font-semibold text-[#f07b67]"
                    >
                      {{ recentSummary.avgKp }}%
                    </span>
                    <span class="text-[11px] text-[#7d7e86]">
                      Team contribution
                    </span>
                  </div>

                  <div class="flex flex-col gap-1 whitespace-nowrap">
                    <span class="text-[11px] tracking-[0.08em] text-[#7d7e86]">
                      AVG DAMAGE
                    </span>
                    <span class="font-mono text-[17px] font-semibold">
                      {{ formatNumber(recentSummary.avgDmg, true) }}
                    </span>
                    <span class="text-[11px] text-[#7d7e86]">Per match</span>
                  </div>

                  <div class="flex flex-col gap-1 whitespace-nowrap">
                    <span class="text-[11px] tracking-[0.08em] text-[#7d7e86]">
                      MVP / ACE
                    </span>
                    <span
                      class="font-mono text-[17px] font-semibold text-[#d4af6a]"
                    >
                      {{ recentSummary.mvpRate }}%
                    </span>
                    <span class="text-[11px] text-[#7d7e86]">
                      {{ recentSummary.mvpCount }} matches
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- EMPTY MATCHES STATE -->
            <div
              v-if="decoratedMatches.length === 0"
              class="solare-side-card text-center py-10 text-sm text-[#9a9aa3]"
            >
              No matches found for this filter.
            </div>

            <!-- MATCH CARDS LIST -->
            <article
              v-for="m in decoratedMatches"
              :key="m.record_no"
              class="solare-match-card"
              :class="
                m.is_winner
                  ? 'solare-match-card--win'
                  : 'solare-match-card--loss'
              "
            >
              <!-- COLLAPSED ROW -->
              <div
                class="solare-match-summary-row"
                @click="toggleMatch(m.record_no)"
              >
                <!-- 1. Outcome, PDL, Time, Rounds -->
                <div class="flex flex-col gap-1 flex-none w-[116px]">
                  <div class="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span
                      class="font-semibold text-[15px]"
                      :class="m.is_winner ? 'text-[#5ca3ff]' : 'text-[#ec6a5e]'"
                    >
                      {{ m.is_winner ? "Victory" : "Defeat" }}
                    </span>
                    <span
                      v-if="m.pdlLabel"
                      class="font-mono font-semibold text-xs"
                      :class="m.is_winner ? 'text-[#5ca3ff]' : 'text-[#ec6a5e]'"
                    >
                      {{ m.pdlLabel }}
                    </span>
                  </div>

                  <span
                    class="font-mono text-[11px] text-[#7d7e86] whitespace-nowrap"
                  >
                    {{ m.ago }} · {{ m.duration }}
                  </span>

                  <div class="flex gap-[3px] pt-0.5">
                    <div
                      v-for="(r, idx) in m.rounds"
                      :key="idx"
                      class="solare-round-pip"
                      :class="
                        r.isWin
                          ? 'solare-round-pip--win'
                          : r.isLoss
                            ? 'solare-round-pip--loss'
                            : 'solare-round-pip--draw'
                      "
                    >
                      {{ r.shortLabel }}
                    </div>
                  </div>
                </div>

                <!-- 2. Self Class Avatar + Spec + Grade Badge -->
                <div class="flex items-center gap-3 flex-none w-[138px]">
                  <div class="relative w-10 h-10 shrink-0">
                    <img
                      v-if="m.self.avatarUrl"
                      :src="m.self.avatarUrl"
                      :alt="m.self.className"
                      class="w-10 h-10 rounded-lg border border-[#2e3039] bg-[#111216] object-cover"
                    />
                    <img
                      v-if="m.self.branchIconUrl"
                      :src="m.self.branchIconUrl"
                      :alt="m.self.branchName"
                      class="w-4 h-4 object-contain absolute -bottom-1 -right-1 bg-[#101114] rounded-full border border-[#3a3b42]"
                    />
                  </div>
                  <div class="flex flex-col gap-1 items-start min-w-0">
                    <span class="text-[13px] text-[#c8c1b7] truncate">
                      {{ m.self.branchName }}
                    </span>
                    <span
                      class="solare-grade-badge"
                      :class="{
                        'solare-grade-badge--mvp': m.self.grade === 'MVP',
                        'solare-grade-badge--ace': m.self.grade === 'ACE',
                      }"
                    >
                      {{ m.self.grade }}
                    </span>
                  </div>
                </div>

                <!-- 3. Self K/D + Ratio + KP -->
                <div
                  class="flex flex-col gap-0.5 flex-none w-[88px] whitespace-nowrap"
                >
                  <span class="font-mono font-semibold text-[17px]">
                    {{ m.self.kills }}
                    <span class="text-[#4a4b52]">/</span>
                    {{ m.self.deaths }}
                  </span>
                  <span
                    class="font-mono font-medium text-xs"
                    :style="{ color: m.self.kdColor }"
                  >
                    {{ m.self.kdRatio }} K/D
                  </span>
                  <span class="text-[11px] text-[#7d7e86]">
                    KP {{ m.self.kp }}%
                  </span>
                </div>

                <!-- 4. Self Damage + Team Share -->
                <div
                  class="flex flex-col items-end gap-0.5 flex-none w-[104px] whitespace-nowrap"
                >
                  <span class="font-mono font-semibold text-[15px]">
                    {{ formatNumber(m.self.damage_done, compactNumbers) }}
                  </span>
                  <span class="text-[11px] text-[#7d7e86]">
                    {{ m.self.dmgShare }}% team dmg
                  </span>
                </div>

                <!-- 5. 3v3 Rosters (Allies & Enemies in exact replay order) -->
                <div class="solare-rosters-mini">
                  <div
                    v-for="(side, sIdx) in [m.allies, m.enemies]"
                    :key="sIdx"
                    class="flex flex-col gap-1 min-w-0"
                  >
                    <div
                      v-for="p in side"
                      :key="`${m.record_no}-${sIdx}-${p.user_nickname}`"
                      class="flex items-center gap-1.5 min-w-0"
                    >
                      <img
                        v-if="p.avatarUrl"
                        :src="p.avatarUrl"
                        :alt="p.className"
                        class="w-4 h-4 rounded-full flex-none bg-[#24252b] border border-[#3a3b42] object-cover"
                      />
                      <NuxtLink
                        :to="`/solare/player/${profile.region.toLowerCase()}/${encodeURIComponent(p.user_nickname)}`"
                        class="text-xs truncate transition hover:underline"
                        :class="
                          p.isSelf
                            ? 'text-[#d4af6a] font-semibold'
                            : 'text-[#9a9aa3] hover:text-[#ece7df]'
                        "
                        @click.stop
                      >
                        {{ p.user_nickname }}
                      </NuxtLink>
                    </div>
                  </div>
                </div>

                <!-- 6. Expand Button -->
                <div class="solare-chevron-btn">
                  <svg
                    width="11"
                    height="7"
                    viewBox="0 0 12 8"
                    class="transition-transform duration-200"
                    :style="{
                      transform: isMatchOpen(m.record_no)
                        ? 'rotate(180deg)'
                        : 'rotate(0deg)',
                    }"
                  >
                    <path
                      d="M1 1.5L6 6.5L11 1.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                    />
                  </svg>
                </div>
              </div>

              <!-- EXPANDED IN-GAME SCOREBOARD DRAWER -->
              <div
                v-if="isMatchOpen(m.record_no)"
                class="solare-match-expanded"
              >
                <!-- Drawer Top Banner (In-Game Match Header Style) -->
                <div class="solare-drawer-header">
                  <div class="flex items-baseline gap-2 whitespace-nowrap">
                    <span
                      class="font-semibold text-base"
                      :class="m.is_winner ? 'text-[#5ca3ff]' : 'text-[#ec6a5e]'"
                    >
                      {{ m.is_winner ? "Victory" : "Defeat" }}
                    </span>
                    <span
                      v-if="m.pdlText"
                      class="font-mono font-semibold text-[13px]"
                      :class="m.is_winner ? 'text-[#5ca3ff]' : 'text-[#ec6a5e]'"
                    >
                      {{ m.pdlText }} PDL
                    </span>
                    <span class="font-mono text-[11px] text-[#7d7e86]">
                      #{{ m.record_no }}
                    </span>
                  </div>

                  <!-- 3v3 Match Avatars VS Banner -->
                  <div class="flex items-center gap-3 mx-auto">
                    <div class="flex gap-1.5">
                      <div
                        v-for="a in m.allies"
                        :key="`av-ally-${a.user_nickname}`"
                        :title="`${a.user_nickname} (${a.className} - ${a.branchName})`"
                        class="solare-vs-avatar"
                        :class="
                          a.isSelf ? 'border-[#d4af6a]' : 'border-[#3a3b42]'
                        "
                      >
                        <img
                          v-if="a.avatarUrl"
                          :src="a.avatarUrl"
                          :alt="a.className"
                          class="w-full h-full object-cover"
                        />
                      </div>
                    </div>

                    <span
                      class="font-mono text-[11px] font-semibold text-[#7d7e86]"
                    >
                      VS
                    </span>

                    <div class="flex gap-1.5">
                      <div
                        v-for="e in m.enemies"
                        :key="`av-enemy-${e.user_nickname}`"
                        :title="`${e.user_nickname} (${e.className} - ${e.branchName})`"
                        class="solare-vs-avatar border-[#3a3b42]"
                      >
                        <img
                          v-if="e.avatarUrl"
                          :src="e.avatarUrl"
                          :alt="e.className"
                          class="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                  </div>

                  <!-- Right: O / X Rounds + Duration + Date + Replay -->
                  <div class="flex items-center gap-4">
                    <div
                      class="flex items-center gap-1 font-mono text-xs font-bold"
                    >
                      <template
                        v-for="(r, rIdx) in m.rounds"
                        :key="`ox-${rIdx}`"
                      >
                        <span
                          :class="
                            r.isWin
                              ? 'text-[#5ca3ff]'
                              : r.isLoss
                                ? 'text-[#ec6a5e]'
                                : 'text-[#9a9aa3]'
                          "
                        >
                          {{ r.oxLabel }}
                        </span>
                        <span
                          v-if="rIdx < m.rounds.length - 1"
                          class="text-[#4a4b52] font-normal"
                        >
                          /
                        </span>
                      </template>
                    </div>

                    <div
                      class="flex flex-col items-end gap-0.5 pl-4 border-l border-[#26272c] whitespace-nowrap"
                    >
                      <span class="font-mono font-semibold text-[15px]">
                        {{ m.duration }}
                      </span>
                      <span class="font-mono text-[11px] text-[#7d7e86]">
                        {{ m.dateFormatted }}
                      </span>
                    </div>

                    <a
                      v-if="m.repz_download_url"
                      :href="m.repz_download_url"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Download Official Replay (.repz)"
                      class="solare-replay-btn"
                      @click.stop
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16">
                        <path
                          d="M8 2v8m0 0L5 7m3 3l3-3M3 13h10"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.6"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </a>
                  </div>
                </div>

                <!-- Two Side-by-Side Team Tables (In-Game Replay Order) -->
                <div class="solare-teams-grid">
                  <div
                    v-for="team in m.teams"
                    :key="team.id"
                    class="solare-team-table"
                  >
                    <div class="solare-team-thead">
                      <span
                        class="flex items-center gap-1.5 font-semibold"
                        :style="{ color: team.color }"
                      >
                        <span
                          class="w-2 h-2 rounded-[2px]"
                          :style="{ background: team.color }"
                        />
                        <span>{{ team.title }}</span>
                      </span>
                      <span class="text-center">K / D</span>
                      <span class="text-right" title="Crowd Control"> CC </span>
                      <span class="text-right" title="Damage Dealt">DMG</span>
                      <span class="text-right" title="Damage Taken">TAKEN</span>
                      <span class="text-right" title="Recovery / Healing">
                        HEAL
                      </span>
                    </div>

                    <div
                      v-for="p in team.players"
                      :key="`${m.record_no}-${team.id}-${p.user_nickname}`"
                      class="solare-team-row"
                      :class="{ 'solare-team-row--self': p.isSelf }"
                    >
                      <div class="flex items-center gap-2.5 min-w-0">
                        <!-- Match Slot Portrait + MVP/ACE Badge -->
                        <div class="solare-slot-portrait">
                          <img
                            v-if="p.matchSlotUrl || p.avatarUrl"
                            :src="p.matchSlotUrl || p.avatarUrl"
                            :alt="p.className"
                            class="w-full h-full object-cover object-center"
                          />
                          <span
                            v-if="p.badge"
                            class="solare-slot-badge"
                            :class="
                              p.badge === 'MVP'
                                ? 'solare-slot-badge--mvp'
                                : 'solare-slot-badge--ace'
                            "
                          >
                            {{ p.badge }}
                          </span>
                        </div>

                        <div class="flex flex-col gap-0.5 min-w-0">
                          <div class="flex items-center gap-1.5 min-w-0">
                            <img
                              v-if="p.branchIconUrl"
                              :src="p.branchIconUrl"
                              :alt="p.branchName"
                              :title="p.branchName"
                              class="w-3.5 h-3.5 object-contain shrink-0"
                            />
                            <img
                              v-if="p.classIconUrl"
                              :src="p.classIconUrl"
                              :alt="p.className"
                              :title="p.className"
                              class="w-3.5 h-3.5 object-contain opacity-75 shrink-0"
                            />
                            <NuxtLink
                              :to="`/solare/player/${profile.region.toLowerCase()}/${encodeURIComponent(p.user_nickname)}`"
                              class="text-[13px] truncate transition hover:underline"
                              :class="
                                p.isSelf
                                  ? 'text-[#d4af6a] font-semibold'
                                  : 'text-[#ece7df] hover:text-[#d4af6a]'
                              "
                            >
                              {{ p.user_nickname }}
                            </NuxtLink>
                          </div>
                          <span class="text-[11px] text-[#7d7e86] truncate">
                            {{ p.className }} · {{ p.branchName }}
                          </span>
                        </div>
                      </div>

                      <span
                        class="text-center whitespace-nowrap font-mono text-[13px] font-medium"
                        :class="
                          p.kills > p.deaths
                            ? 'text-[#ece7df]'
                            : 'text-[#9a9aa3]'
                        "
                      >
                        {{ p.kills }} / {{ p.deaths }}
                      </span>

                      <span class="text-right font-mono text-xs text-[#7d7e86]">
                        {{ p.cc }}
                      </span>

                      <span
                        class="text-right font-mono text-xs font-medium"
                        :class="
                          p.isTopDmg ? 'text-[#d4af6a]' : 'text-[#ece7df]'
                        "
                      >
                        {{ formatNumber(p.damage_done, compactNumbers) }}
                      </span>

                      <span class="text-right font-mono text-xs text-[#c8c1b7]">
                        {{ formatNumber(p.damage_taken, compactNumbers) }}
                      </span>

                      <span class="text-right font-mono text-xs text-[#c8c1b7]">
                        {{ formatNumber(p.recovery, compactNumbers) }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Equipment of every player, decoded from the replay -->
                <div v-if="m.repz_download_url" class="solare-match-gear">
                  <span class="solare-match-gear-title">GEAR</span>
                  <p
                    v-if="matchGearMap[m.record_no]?.status === 'loading'"
                    class="solare-match-gear-note"
                  >
                    Reading the replay...
                  </p>
                  <p
                    v-else-if="
                      matchGearMap[m.record_no] &&
                      matchGearMap[m.record_no].status !== 'ok'
                    "
                    class="solare-match-gear-note"
                  >
                    Gear unavailable for this replay.
                  </p>
                  <template v-else-if="matchGearMap[m.record_no]">
                    <div
                      v-for="team in m.teams"
                      :key="`gear-${m.record_no}-${team.id}`"
                      class="solare-match-gear-team"
                    >
                      <div
                        v-for="p in team.players"
                        :key="`gear-${m.record_no}-${p.user_nickname}`"
                        class="solare-match-gear-row"
                      >
                        <span
                          class="solare-match-gear-name"
                          :style="{ color: team.color }"
                        >
                          {{ p.user_nickname }}
                        </span>
                        <SolareGearStrip
                          v-if="findMatchLoadout(m.record_no, p.user_nickname)"
                          :gear="
                            findMatchLoadout(m.record_no, p.user_nickname).gear
                          "
                          :sets="
                            findMatchLoadout(m.record_no, p.user_nickname)
                              .crystal_sets
                          "
                        />
                        <span v-else class="solare-match-gear-note">—</span>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </article>

            <!-- LOAD MORE MATCHES -->
            <button
              v-if="hasMoreMatches"
              type="button"
              :disabled="isLoadingMore"
              class="solare-load-more-btn"
              @click="loadMoreMatches"
            >
              {{ isLoadingMore ? "LOADING MATCHES…" : "SHOW MORE MATCHES" }}
            </button>

            <span class="text-center font-mono text-xs text-[#7d7e86]">
              Showing {{ decoratedMatches.length }} of {{ totalFilteredCount }}
            </span>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import {
  getClassName,
  getSkillBranch,
  getClassAvatar,
  getClassMatchSlot,
  getClassIcon,
  getSkillBranchIcon,
  getTierInfo,
} from "~/utils/solareTier.js";

const route = useRoute();
const router = useRouter();

const regions = ["SA", "NA", "EU", "KR", "JP", "RU", "TR", "TW"];

function safeDecodeRouteParam(val) {
  const raw = String(val || "");
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

const routeRegion = computed(() =>
  String(route.params.region || "SA")
    .trim()
    .toUpperCase(),
);
const routeNick = computed(() => safeDecodeRouteParam(route.params.nick));

const searchRegion = ref(routeRegion.value);
const searchQuery = ref(routeNick.value);

const profile = ref(null);
const loadedMatches = ref([]);
const currentPage = ref(1);
const hasMoreMatches = ref(false);
const totalMatchesInDb = ref(0);

const isLoadingProfile = ref(true);
const isRefreshing = ref(false);
const isLoadingMore = ref(false);
const errorMessage = ref("");
const portraitError = ref(false);

const selectedClassFilter = ref(null);
const resultFilter = ref("all"); // 'all' | 'win' | 'loss'
const compactNumbers = ref(false);
const openMatchMap = ref({});

const requestUrl = useRequestURL();

const { data: ssrSummary } = await useAsyncData(
  () =>
    `solare-player-summary:${routeRegion.value}:${routeNick.value.toLowerCase()}`,
  async () => {
    if (import.meta.client || !routeNick.value) return null;
    try {
      return await $fetch("/api/v1/solare/player/summary", {
        query: {
          nick: routeNick.value,
          region: routeRegion.value,
        },
      });
    } catch {
      return null;
    }
  },
  {
    server: true,
    lazy: import.meta.client,
  },
);

const seoSource = computed(() => profile.value || ssrSummary.value || null);

const seoTitle = computed(() => {
  const p = seoSource.value;
  if (!p) {
    return `${routeNick.value} (${routeRegion.value}) — Arena of Solare Profile`;
  }

  const nick = p.user_nickname;
  const region = p.region;
  const ranking = p.current_ranking;
  const hasRating = p.rank_rating !== null && p.rank_rating !== undefined;
  const rating = hasRating ? Number(p.rank_rating) : null;
  const className =
    p.class_type !== null && p.class_type !== undefined
      ? getClassName(p.class_type)
      : null;
  const totalGames = Number(p.overall?.total_games ?? 0);
  const winrate = Number(p.overall?.winrate ?? 0);

  const rankBadge = ranking ? `#${ranking} ${region}` : region;
  const details = [];
  if (className) details.push(className);
  if (hasRating) details.push(`${rating.toLocaleString("en-US")} PTS`);
  if (totalGames > 0) details.push(`${winrate.toFixed(1)}% WR`);

  const suffix = details.length > 0 ? ` — ${details.join(" · ")}` : "";
  return `${nick} (${rankBadge})${suffix} | Arena of Solare`;
});

const seoDescription = computed(() => {
  const p = seoSource.value;
  if (!p) {
    return `View ${routeNick.value}'s official Black Desert Online Arena of Solare 3v3 ranked match history, class winrates, K/D ratio, combat stats, and replays in ${routeRegion.value}.`;
  }

  const season = p.season || 9;
  const region = p.region;
  const ranking = p.current_ranking;
  const classRanking = p.class_ranking;
  const hasRating = p.rank_rating !== null && p.rank_rating !== undefined;
  const rating = hasRating ? Number(p.rank_rating) : null;
  const tierInfo = hasRating ? getTierInfo(rating, ranking ?? 999) : null;
  const tierName = tierInfo
    ? tierInfo.name.replace(/\[([IVX]+)\]/g, "$1").trim()
    : null;
  const className =
    p.class_type !== null && p.class_type !== undefined
      ? getClassName(p.class_type)
      : null;
  const specName =
    p.class_type !== null && p.class_type !== undefined
      ? getSkillBranch(p.class_type, p.skill_branch_type)
      : null;
  const wins = Number(p.overall?.wins ?? 0);
  const losses = Number(p.overall?.losses ?? 0);
  const draws = Number(p.overall?.draws ?? 0);
  const winrate = Number(p.overall?.winrate ?? 0);
  const kdRatio =
    p.kd_ratio !== null && p.kd_ratio !== undefined ? Number(p.kd_ratio) : null;

  const segments = [`Season ${season} (${region})`];

  if (ranking && tierName && hasRating) {
    segments.push(
      `Rank #${ranking} · ${tierName} (${rating.toLocaleString("en-US")} PTS)`,
    );
  } else if (tierName && hasRating) {
    segments.push(`${tierName} (${rating.toLocaleString("en-US")} PTS)`);
  } else if (ranking) {
    segments.push(`Rank #${ranking} ${region}`);
  } else {
    segments.push("Unranked");
  }

  if (classRanking && className) {
    segments.push(`Top #${classRanking} ${className}`);
  }

  if (className) {
    segments.push(`${className} (${specName})`);
  }

  segments.push(
    `${wins}W ${losses}L${draws > 0 ? ` ${draws}D` : ""} (${winrate.toFixed(1)}% WR)`,
  );

  if (kdRatio !== null) {
    segments.push(`${kdRatio.toFixed(2)} K/D`);
  }

  return segments.join(" · ");
});

const seoOgImageUrl = computed(() => {
  const p = seoSource.value;
  if (!p) {
    return `${requestUrl.origin}/images/solare/solare-icon-game@4x.png`;
  }

  const season = p.season || 9;
  const ranking = p.current_ranking ?? "u";
  const classRanking = p.class_ranking ?? "u";
  const rating =
    p.rank_rating !== null && p.rank_rating !== undefined ? p.rank_rating : "n";
  const wins = p.overall?.wins ?? 0;
  const losses = p.overall?.losses ?? 0;
  const draws = p.overall?.draws ?? 0;
  const cType = p.class_type ?? "x";
  const sBranch = p.skill_branch_type ?? "x";
  const kdToken =
    p.kd_ratio !== null && p.kd_ratio !== undefined
      ? Number(p.kd_ratio).toFixed(2)
      : "n";
  const classesToken = (p.classes || [])
    .slice(0, 3)
    .map(
      (c) =>
        `${c.class_type}.${c.skill_branch_type}.${c.total_games}.${c.wins}`,
    )
    .join("_");
  const versionKey = [
    "v2",
    season,
    ranking,
    classRanking,
    rating,
    wins,
    losses,
    draws,
    cType,
    sBranch,
    kdToken,
    classesToken || "0",
  ].join("-");

  const params = new URLSearchParams({
    region: p.region,
    nick: p.user_nickname,
    v: versionKey,
  });

  return `${requestUrl.origin}/api/v1/solare/player/og?${params.toString()}`;
});

const seoCanonicalUrl = computed(() => {
  const reg = (seoSource.value?.region || routeRegion.value).toLowerCase();
  const nick = seoSource.value?.user_nickname || routeNick.value;
  return `${requestUrl.origin}/solare/player/${reg}/${encodeURIComponent(nick)}`;
});

useSeoMeta({
  title: () => seoTitle.value,
  description: () => seoDescription.value,
  ogTitle: () => seoTitle.value,
  ogDescription: () => seoDescription.value,
  ogType: () => (seoSource.value ? "profile" : "website"),
  ogUrl: () => seoCanonicalUrl.value,
  ogImage: () => seoOgImageUrl.value,
  ogImageWidth: () => (seoSource.value ? 1200 : undefined),
  ogImageHeight: () => (seoSource.value ? 630 : undefined),
  ogImageType: "image/png",
  ogImageAlt: () =>
    seoSource.value
      ? `${seoSource.value.user_nickname} (${seoSource.value.region}) Arena of Solare Season ${seoSource.value.season || 9} Share Card`
      : "Arena of Solare",
  twitterCard: () => (seoSource.value ? "summary_large_image" : "summary"),
  twitterTitle: () => seoTitle.value,
  twitterDescription: () => seoDescription.value,
  twitterImage: () => seoOgImageUrl.value,
  themeColor: () => (seoSource.value ? "#d4af6a" : "#1e1d1e"),
});

definePageMeta({
  header: {
    name: "Arena of Solare",
    icon: "/images/solare/solare-icon-game@4x.png",
  },
});

function getWinrateColor(wr) {
  const num = Number(wr) || 0;
  if (num >= 60) return "#35c48b";
  if (num >= 50) return "#c8c1b7";
  return "#ec6a5e";
}

function formatNumber(val, compact = false) {
  const num = Number(val) || 0;
  if (compact) {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return String(num);
  }
  return num.toLocaleString("en-US");
}

function formatDuration(seconds) {
  const totalSec = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatRelativeAgo(isoDate) {
  if (!isoDate) return "Recorded";
  const ms = new Date(isoDate).getTime();
  if (Number.isNaN(ms)) return "Recorded";

  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatShortDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

const headerPortraitUrl = computed(() => {
  if (!profile.value || profile.value.class_type === null) return null;
  return `/images/solare/classes/${profile.value.class_type}.jpg`;
});

const primaryClassName = computed(() =>
  getClassName(profile.value?.class_type),
);

const primarySpecName = computed(() =>
  getSkillBranch(profile.value?.class_type, profile.value?.skill_branch_type),
);

// Equipment decoded from each match replay (/api/v1/solare/match/gear), keyed by record_no.
const matchGearMap = ref({});

async function loadMatchGear(recordNo) {
  if (!recordNo || matchGearMap.value[recordNo]) return;
  matchGearMap.value = {
    ...matchGearMap.value,
    [recordNo]: { status: "loading", players: [] },
  };
  try {
    const data = await $fetch("/api/v1/solare/match/gear", {
      query: { region: routeRegion.value, record_no: recordNo },
    });
    matchGearMap.value = { ...matchGearMap.value, [recordNo]: data };
  } catch {
    matchGearMap.value = {
      ...matchGearMap.value,
      [recordNo]: { status: "error", players: [] },
    };
  }
}

function findMatchLoadout(recordNo, nickname) {
  const entry = matchGearMap.value[recordNo];
  if (!entry?.players?.length || !nickname) return null;
  const target = String(nickname).toLowerCase();
  return (
    entry.players.find((p) => p.user_nickname?.toLowerCase() === target) || null
  );
}

// Latest match of this player that has an official replay to decode.
const latestReplayMatch = computed(
  () => loadedMatches.value.find((m) => m.repz_download_url) || null,
);

watch(
  latestReplayMatch,
  (match) => {
    if (match) loadMatchGear(match.record_no);
  },
  { immediate: true },
);

watch(openMatchMap, (map) => {
  for (const [recordNo, isOpen] of Object.entries(map)) {
    if (isOpen) loadMatchGear(Number(recordNo));
  }
});

const gearPanel = computed(() => {
  const match = latestReplayMatch.value;
  const p = profile.value;
  if (!match || !p) return null;
  const loadout = findMatchLoadout(match.record_no, p.user_nickname);
  if (!loadout) return null;

  const classType = match.allies?.find(
    (a) => a.user_nickname?.toLowerCase() === p.user_nickname?.toLowerCase(),
  );
  const className = classType ? getClassName(classType.class_type) : "";
  const specName = classType
    ? getSkillBranch(classType.class_type, classType.skill_branch_type)
    : "";
  return {
    gear: loadout.gear,
    sets: loadout.crystal_sets || [],
    title: [specName, className].filter(Boolean).join(" "),
    source: `Last match #${match.record_no}`,
  };
});

const primaryBranchIcon = computed(() =>
  getSkillBranchIcon(
    profile.value?.class_type,
    profile.value?.skill_branch_type,
  ),
);

const profileTierInfo = computed(() => {
  if (
    !profile.value ||
    profile.value.rank_rating === null ||
    profile.value.rank_rating === undefined
  ) {
    return null;
  }
  return getTierInfo(
    profile.value.rank_rating,
    profile.value.current_ranking ?? 999,
  );
});

const lastMatchStatusText = computed(() => {
  const firstMatch = loadedMatches.value[0];
  if (firstMatch?.match_date) {
    return `Last match ${formatRelativeAgo(firstMatch.match_date)}`;
  }
  return "Synced with official servers";
});

const formattedClasses = computed(() => {
  const list = profile.value?.classes || [];
  return list.map((c) => {
    const k = Number(c.averages?.kills || 0);
    const d = Number(c.averages?.deaths || 0);
    const ratio = d > 0 ? (k / d).toFixed(2) : k.toFixed(2);
    return {
      ...c,
      key: `${c.class_type}:${c.skill_branch_type}`,
      className: getClassName(c.class_type),
      branchName: getSkillBranch(c.class_type, c.skill_branch_type),
      avatarUrl: getClassAvatar(c.class_type),
      branchIconUrl: getSkillBranchIcon(c.class_type, c.skill_branch_type),
      kdRatio: ratio,
    };
  });
});

const sparklineData = computed(() => {
  const deltas = profile.value?.recent_pdl_deltas || [];
  if (deltas.length < 2) {
    return {
      hasData: false,
      count: deltas.length,
      points: "",
      area: "",
      dotTop: "50%",
      netDelta: 0,
    };
  }

  let running = 0;
  const pts = [0];
  for (const d of deltas) {
    running += Number(d || 0);
    pts.push(running);
  }

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = Math.max(1, max - min);
  const toY = (val) => 88 - ((val - min) / range) * 76;

  const xyList = pts.map(
    (val, i) =>
      `${((i / (pts.length - 1)) * 300).toFixed(1)},${toY(val).toFixed(1)}`,
  );
  const xy = xyList.join(" ");
  const lastY = toY(pts[pts.length - 1]);

  return {
    hasData: true,
    count: deltas.length,
    points: xy,
    area: `0,100 ${xy} 300,100`,
    dotTop: `${lastY.toFixed(1)}%`,
    netDelta: running,
  };
});

function isSelfParticipant(p) {
  if (!profile.value || !p) return false;
  if (
    profile.value.user_no &&
    p.user_no &&
    String(profile.value.user_no) === String(p.user_no)
  ) {
    return true;
  }
  return (
    String(p.user_nickname || "").toLowerCase() ===
    String(profile.value.user_nickname || "").toLowerCase()
  );
}

const recentlyPlayedWith = computed(() => {
  if (!profile.value) return [];
  const map = new Map();

  for (const m of loadedMatches.value.slice(0, 20)) {
    for (const ally of m.allies || []) {
      if (isSelfParticipant(ally)) continue;
      const key = ally.user_nickname.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          user_nickname: ally.user_nickname,
          class_type: ally.class_type,
          wins: 0,
          losses: 0,
          games: 0,
        });
      }
      const entry = map.get(key);
      entry.games += 1;
      if (m.is_winner) entry.wins += 1;
      else entry.losses += 1;
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.games - a.games || b.wins - a.wins)
    .slice(0, 5)
    .map((t) => {
      const className = getClassName(t.class_type);
      return {
        ...t,
        className,
        abbr: className.slice(0, 2).toUpperCase(),
        avatarUrl: getClassAvatar(t.class_type),
        winrate: t.games > 0 ? Math.round((t.wins / t.games) * 100) : 0,
      };
    });
});

function decorateParticipant(
  p,
  maxDmg,
  bestWinnerNick,
  bestLoserNick,
  isWinningTeam,
) {
  const className = getClassName(p.class_type);
  const branchName = getSkillBranch(p.class_type, p.skill_branch_type);
  const isSelf = isSelfParticipant(p);
  const kills = Number(p.kill_count ?? p.kills ?? 0);
  const deaths = Number(p.death_count ?? p.deaths ?? 0);
  const cc = Number(p.cc_applied_count ?? p.cc ?? 0);

  let badge = "";
  if (isWinningTeam && p.user_nickname === bestWinnerNick) {
    badge = "MVP";
  } else if (!isWinningTeam && p.user_nickname === bestLoserNick) {
    badge = "ACE";
  }

  return {
    ...p,
    kills,
    deaths,
    cc,
    isSelf,
    className,
    branchName,
    avatarUrl: getClassAvatar(p.class_type),
    matchSlotUrl: getClassMatchSlot(p.class_type),
    classIconUrl: getClassIcon(p.class_type),
    branchIconUrl: getSkillBranchIcon(p.class_type, p.skill_branch_type),
    badge,
    isTopDmg: maxDmg > 0 && p.damage_done === maxDmg,
  };
}

function computePerformanceScore(p) {
  const kills = Number(p.kill_count ?? p.kills ?? 0);
  const deaths = Number(p.death_count ?? p.deaths ?? 0);
  const cc = Number(p.cc_applied_count ?? p.cc ?? 0);
  return (
    kills * 30000 +
    Number(p.damage_done || 0) +
    cc * 3500 +
    Number(p.recovery || 0) * 0.25 -
    deaths * 20000
  );
}

const allDecoratedMatches = computed(() => {
  return loadedMatches.value.map((m) => {
    const rawAllies = m.allies || [];
    const rawEnemies = m.enemies || [];
    const allPlayers = [...rawAllies, ...rawEnemies];

    const maxDmg = allPlayers.reduce(
      (mx, p) => Math.max(mx, Number(p.damage_done || 0)),
      0,
    );

    const winningSide = m.is_winner ? rawAllies : rawEnemies;
    const losingSide = m.is_winner ? rawEnemies : rawAllies;

    const bestWinner = [...winningSide].sort(
      (a, b) => computePerformanceScore(b) - computePerformanceScore(a),
    )[0];
    const bestLoser = [...losingSide].sort(
      (a, b) => computePerformanceScore(b) - computePerformanceScore(a),
    )[0];

    const allies = rawAllies.map((p) =>
      decorateParticipant(
        p,
        maxDmg,
        bestWinner?.user_nickname,
        bestLoser?.user_nickname,
        m.is_winner,
      ),
    );
    const enemies = rawEnemies.map((p) =>
      decorateParticipant(
        p,
        maxDmg,
        bestWinner?.user_nickname,
        bestLoser?.user_nickname,
        !m.is_winner,
      ),
    );

    const selfPlayer = allies.find((p) => p.isSelf) ||
      allies[0] || {
        kills: 0,
        deaths: 0,
        cc: 0,
        damage_done: 0,
        className: primaryClassName.value,
        branchName: primarySpecName.value,
        avatarUrl: getClassAvatar(profile.value?.class_type),
        branchIconUrl: primaryBranchIcon.value,
        badge: "",
      };

    const sortedAll = [...allPlayers].sort(
      (a, b) => computePerformanceScore(b) - computePerformanceScore(a),
    );
    const selfRankIndex = sortedAll.findIndex((p) => isSelfParticipant(p));
    const rankOrdinal =
      ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH"][selfRankIndex] || "3RD";

    const grade = selfPlayer.badge || rankOrdinal;

    const teamKills = Math.max(
      1,
      allies.reduce((sum, p) => sum + Number(p.kills || 0), 0),
    );
    const teamDmg = Math.max(
      1,
      allies.reduce((sum, p) => sum + Number(p.damage_done || 0), 0),
    );

    const ratioNum =
      Number(selfPlayer.kills || 0) /
      Math.max(1, Number(selfPlayer.deaths || 0));
    const kdRatio = ratioNum.toFixed(2);
    const kdColor =
      ratioNum >= 3 ? "#d4af6a" : ratioNum >= 1.5 ? "#35c48b" : "#5ca3ff";

    const kp = Math.round((Number(selfPlayer.kills || 0) / teamKills) * 100);
    const dmgShare = Math.round(
      (Number(selfPlayer.damage_done || 0) / teamDmg) * 100,
    );

    const rounds = (m.win_record || []).map((code) => {
      const num = Number(code);
      if (num === 2) {
        return { isWin: true, isLoss: false, shortLabel: "W", oxLabel: "O" };
      }
      if (num === 3) {
        return { isWin: false, isLoss: true, shortLabel: "L", oxLabel: "X" };
      }
      return { isWin: false, isLoss: false, shortLabel: "D", oxLabel: "△" };
    });

    const hasRatingDelta =
      m.vary_rank_rating !== null && m.vary_rank_rating !== undefined;
    const deltaNum = hasRatingDelta ? Number(m.vary_rank_rating) : null;
    const pdlText =
      deltaNum !== null ? `${deltaNum > 0 ? "+" : ""}${deltaNum}` : "";
    const pdlLabel = pdlText ? `(${pdlText})` : "";

    return {
      ...m,
      pdlText,
      pdlLabel,
      ago: formatRelativeAgo(m.match_date),
      duration: formatDuration(m.play_time_seconds),
      dateFormatted: formatShortDate(m.match_date),
      rounds,
      allies,
      enemies,
      self: {
        ...selfPlayer,
        grade,
        kdRatio,
        kdColor,
        kp,
        dmgShare,
      },
      teams: [
        {
          id: "allies",
          title: "YOUR TEAM",
          color: m.is_winner ? "#5ca3ff" : "#ec6a5e",
          players: allies,
        },
        {
          id: "enemies",
          title: "ENEMY TEAM",
          color: m.is_winner ? "#ec6a5e" : "#5ca3ff",
          players: enemies,
        },
      ],
    };
  });
});

const decoratedMatches = computed(() => {
  if (resultFilter.value === "win") {
    return allDecoratedMatches.value.filter((m) => m.is_winner);
  }
  if (resultFilter.value === "loss") {
    return allDecoratedMatches.value.filter((m) => !m.is_winner);
  }
  return allDecoratedMatches.value;
});

const matchTabs = computed(() => {
  const allCount = allDecoratedMatches.value.length;
  const winCount = allDecoratedMatches.value.filter((m) => m.is_winner).length;
  const lossCount = allDecoratedMatches.value.filter(
    (m) => !m.is_winner,
  ).length;

  return [
    { id: "all", label: "All", count: allCount },
    { id: "win", label: "Victories", count: winCount },
    { id: "loss", label: "Defeats", count: lossCount },
  ];
});

const totalFilteredCount = computed(() => {
  if (resultFilter.value === "all") {
    return totalMatchesInDb.value || decoratedMatches.value.length;
  }
  return decoratedMatches.value.length;
});

const recentSummary = computed(() => {
  const subset = decoratedMatches.value.slice(0, 20);
  const total = subset.length;
  if (total === 0) {
    return {
      total: 0,
      wins: 0,
      losses: 0,
      winrate: 0,
      avgKills: "0.0",
      avgDeaths: "0.0",
      kdRatio: "0.00",
      avgKp: 0,
      avgDmg: 0,
      mvpCount: 0,
      mvpRate: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let sumK = 0;
  let sumD = 0;
  let sumKp = 0;
  let sumDmg = 0;
  let mvpCount = 0;

  for (const m of subset) {
    if (m.is_winner) wins += 1;
    else losses += 1;
    sumK += Number(m.self.kills || 0);
    sumD += Number(m.self.deaths || 0);
    sumKp += Number(m.self.kp || 0);
    sumDmg += Number(m.self.damage_done || 0);
    if (m.self.grade === "MVP" || m.self.grade === "ACE") {
      mvpCount += 1;
    }
  }

  const avgK = sumK / total;
  const avgD = sumD / total;
  const kdRatio = avgD > 0 ? (avgK / avgD).toFixed(2) : avgK.toFixed(2);

  return {
    total,
    wins,
    losses,
    winrate: (wins / total) * 100,
    avgKills: avgK.toFixed(1),
    avgDeaths: avgD.toFixed(1),
    kdRatio,
    avgKp: Math.round(sumKp / total),
    avgDmg: Math.round(sumDmg / total),
    mvpCount,
    mvpRate: Math.round((mvpCount / total) * 100),
  };
});

function isMatchOpen(recordNo) {
  return Boolean(openMatchMap.value[recordNo]);
}

function toggleMatch(recordNo) {
  openMatchMap.value = {
    ...openMatchMap.value,
    [recordNo]: !openMatchMap.value[recordNo],
  };
}

async function fetchPlayerPage({ page = 1, append = false } = {}) {
  const params = new URLSearchParams();
  params.set("nick", routeNick.value);
  params.set("region", routeRegion.value);
  params.set("page", String(page));
  params.set("limit", "20");

  if (selectedClassFilter.value !== null) {
    params.set("class_type", String(selectedClassFilter.value));
  }

  const response = await fetch(`/api/v1/solare/player?${params.toString()}`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.message || "Could not load player profile.");
  }

  profile.value = body;
  currentPage.value = body.pagination?.page || page;
  hasMoreMatches.value = Boolean(body.pagination?.has_more);
  totalMatchesInDb.value = Number(body.pagination?.total_matches || 0);

  if (append) {
    const existingIds = new Set(loadedMatches.value.map((m) => m.record_no));
    const nextRows = (body.matches || []).filter(
      (m) => !existingIds.has(m.record_no),
    );
    loadedMatches.value = [...loadedMatches.value, ...nextRows];
  } else {
    loadedMatches.value = body.matches || [];
    const firstRecordNo = loadedMatches.value[0]?.record_no;
    openMatchMap.value = firstRecordNo ? { [firstRecordNo]: true } : {};
  }
}

async function loadInitialProfile() {
  if (!routeNick.value) return;
  isLoadingProfile.value = true;
  errorMessage.value = "";
  portraitError.value = false;

  try {
    await fetchPlayerPage({ page: 1, append: false });
  } catch (err) {
    profile.value = null;
    errorMessage.value = err.message || "Player not found.";
  } finally {
    isLoadingProfile.value = false;
  }
}

async function refreshProfile() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    await fetchPlayerPage({ page: 1, append: false });
  } catch {
    // Keep existing profile visible if refresh fails
  } finally {
    isRefreshing.value = false;
  }
}

async function selectClassFilter(classType) {
  selectedClassFilter.value = classType;
  isRefreshing.value = true;
  try {
    await fetchPlayerPage({ page: 1, append: false });
  } finally {
    isRefreshing.value = false;
  }
}

async function loadMoreMatches() {
  if (isLoadingMore.value || !hasMoreMatches.value) return;
  isLoadingMore.value = true;
  try {
    await fetchPlayerPage({ page: currentPage.value + 1, append: true });
  } finally {
    isLoadingMore.value = false;
  }
}

function persistSelectedRegion(reg) {
  if (typeof window === "undefined") return;
  try {
    const normalized = String(reg || "")
      .trim()
      .toUpperCase();
    if (regions.includes(normalized)) {
      window.localStorage.setItem("solare_selected_region", normalized);
    }
  } catch {
    // Ignore storage errors
  }
}

function submitSearch() {
  const trimmed = searchQuery.value.trim();
  if (!trimmed) return;
  persistSelectedRegion(searchRegion.value);
  router.push(
    `/solare/player/${searchRegion.value.toLowerCase()}/${encodeURIComponent(trimmed)}`,
  );
}

watch([routeRegion, routeNick], ([newReg, newNick]) => {
  searchRegion.value = newReg;
  searchQuery.value = newNick;
  persistSelectedRegion(newReg);
  profile.value = null;
  loadedMatches.value = [];
  selectedClassFilter.value = null;
  resultFilter.value = "all";
  loadInitialProfile();
});

onMounted(() => {
  persistSelectedRegion(routeRegion.value);
  loadInitialProfile();
});
</script>

<style scoped>
.solare-v3-page {
  min-height: calc(100vh - 4.5rem);
  background: #101114;
  color: #ece7df;
  font-family: "IBM Plex Sans", system-ui, sans-serif;
  padding: 20px 16px 64px;
  -webkit-font-smoothing: antialiased;
}

.solare-v3-container {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* TOP BAR */
.solare-top-bar {
  background: #16171b;
  border: 1px solid #26272c;
  border-radius: 10px;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.solare-top-links {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.solare-brand-link {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.solare-brand-title {
  font-family: "Cinzel", serif;
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 0.06em;
  color: #f1e6cf;
}

.solare-brand-sub {
  font-size: 13px;
  color: #9a9aa3;
}

.solare-overlay-pill {
  font-size: 12px;
  font-weight: 600;
  color: #d4af6a;
  background: #221d15;
  border: 1px solid #4a3f2a;
  border-radius: 6px;
  padding: 6px 12px;
  transition: all 0.15s ease;
}

.solare-overlay-pill:hover {
  background: #2c251a;
  border-color: #d4af6a;
}

.solare-search-form {
  display: flex;
  align-items: stretch;
  flex: 1 1 320px;
  max-width: 460px;
  height: 38px;
  border: 1px solid #2e3039;
  border-radius: 8px;
  background: #111216;
  overflow: hidden;
}

.solare-search-select {
  background: #1b1c21;
  color: #d4af6a;
  border: none;
  border-right: 1px solid #2e3039;
  padding: 0 12px;
  font:
    600 12px "JetBrains Mono",
    monospace;
  cursor: pointer;
  outline: none;
}

.solare-search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: #ece7df;
  font-size: 13px;
  padding: 0 14px;
}

.solare-search-btn {
  border: none;
  background: #d4af6a;
  color: #1a1610;
  font:
    600 12px "IBM Plex Sans",
    sans-serif;
  letter-spacing: 0.08em;
  padding: 0 16px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.solare-search-btn:hover {
  background: #e2c07e;
}

/* STATE CARD */
.solare-state-card {
  background: #16171b;
  border: 1px solid #26272c;
  border-radius: 10px;
  padding: 56px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.solare-spinner {
  width: 32px;
  height: 32px;
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

/* HEADER CARD */
.solare-header-card {
  background: #16171b;
  border: 1px solid #26272c;
  border-radius: 10px;
  padding: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.solare-header-left {
  display: flex;
  align-items: center;
  gap: 22px;
  flex: 1 1 480px;
  min-width: 0;
}

.solare-portrait-wrap {
  position: relative;
  flex: none;
  width: 88px;
  height: 104px;
}

.solare-portrait-img,
.solare-portrait-fallback {
  width: 88px;
  height: 104px;
  border: 1px solid #8a7146;
  border-radius: 8px;
  object-fit: cover;
  object-position: top;
  background: #111216;
  display: flex;
  align-items: center;
  justify-content: center;
}

.solare-portrait-badge {
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  background: #101114;
  border: 1px solid #8a7146;
  color: #ece7df;
  border-radius: 4px;
  padding: 2px 8px;
  font:
    500 11px "JetBrains Mono",
    monospace;
  white-space: nowrap;
}

.solare-identity-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.solare-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.solare-player-name {
  margin: 0;
  font-family: "Cinzel", serif;
  font-weight: 700;
  font-size: 32px;
  letter-spacing: 0.03em;
  line-height: 1;
  color: #f1e6cf;
}

.solare-region-tag {
  font:
    500 11px "JetBrains Mono",
    monospace;
  white-space: nowrap;
  color: #9a9aa3;
  background: #1d1f26;
  border: 1px solid #2e3039;
  border-radius: 4px;
  padding: 3px 8px;
}

.solare-top-tag {
  font:
    600 11px "JetBrains Mono",
    monospace;
  white-space: nowrap;
  color: #d4af6a;
  background: #2a2316;
  border: 1px solid #5a4a2c;
  border-radius: 4px;
  padding: 3px 8px;
}

.solare-class-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #9a9aa3;
  flex-wrap: wrap;
}

.solare-update-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.solare-gold-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: #d4af6a;
  color: #1a1610;
  border-radius: 6px;
  padding: 8px 16px;
  font:
    600 12px "IBM Plex Sans",
    sans-serif;
  letter-spacing: 0.08em;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease;
}

.solare-gold-btn:hover:not(:disabled) {
  background: #e2c07e;
}

.solare-gold-btn:disabled {
  opacity: 0.65;
  cursor: default;
}

.solare-updated-status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #7d7e86;
  white-space: nowrap;
}

.solare-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #35c48b;
}

.solare-header-stats {
  display: flex;
  align-items: center;
  gap: 36px;
  padding-left: 28px;
  border-left: 1px solid #26272c;
  flex-wrap: wrap;
}

.solare-header-stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.solare-header-stat-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #7d7e86;
  white-space: nowrap;
}

.solare-header-stat-value {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}

/* MAIN GRID */
.solare-main-grid {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.solare-sidebar {
  flex: 1 1 300px;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.solare-side-card {
  background: #16171b;
  border: 1px solid #26272c;
  border-radius: 10px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.solare-side-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #9a9aa3;
}

.solare-spark-dot {
  position: absolute;
  right: -4px;
  width: 9px;
  height: 9px;
  margin-top: -4.5px;
  border-radius: 50%;
  background: #d4af6a;
  box-shadow: 0 0 0 3px rgba(212, 175, 106, 0.2);
}

.solare-spec-item {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  background: #1b1c21;
  border: 1px solid #2a2b31;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.solare-spec-item:hover {
  border-color: #4a4b55;
}

.solare-spec-item--active {
  border-color: #d4af6a;
  background: #221f1a;
}

.solare-spec-icon-wrap {
  position: relative;
  width: 38px;
  height: 38px;
  border-radius: 7px;
  background: #111216;
  border: 1px solid #2e3039;
}

.solare-spec-branch-badge {
  position: absolute;
  bottom: -3px;
  right: -3px;
  width: 15px;
  height: 15px;
  object-fit: contain;
  background: #101114;
  border-radius: 50%;
  border: 1px solid #3a3b42;
}

.solare-mate-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 64px 44px;
  gap: 10px;
  align-items: center;
  padding: 4px 0;
}

/* RIGHT COLUMN */
.solare-matches-col {
  flex: 1 1 560px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.solare-summary-box {
  background: #16171b;
  border: 1px solid #26272c;
  border-radius: 10px;
  overflow: hidden;
}

.solare-tabs-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  border-bottom: 1px solid #26272c;
  flex-wrap: wrap;
}

.solare-tab-btn {
  border: none;
  background: transparent;
  padding: 14px 14px 11px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font:
    600 13px "IBM Plex Sans",
    sans-serif;
  color: #7d7e86;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s ease;
}

.solare-tab-btn:hover {
  color: #ece7df;
}

.solare-tab-btn--active {
  color: #ece7df;
  border-bottom-color: #d4af6a;
}

.solare-summary-content {
  padding: 18px 22px;
  display: flex;
  align-items: center;
  gap: 28px;
  flex-wrap: wrap;
}

.solare-donut {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.solare-donut-inner {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: #16171b;
  display: flex;
  align-items: center;
  justify-content: center;
  font:
    600 16px "JetBrains Mono",
    monospace;
}

.solare-summary-divider {
  width: 1px;
  align-self: stretch;
  background: #26272c;
}

.solare-summary-metrics {
  flex: 1;
  min-width: 300px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  text-align: center;
}

/* MATCH CARD */
.solare-match-card {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #26272c;
  border-left-width: 3px;
}

.solare-match-card--win {
  background: #141923;
  border-color: #233044;
  border-left-color: #5ca3ff;
}

.solare-match-card--loss {
  background: #211517;
  border-color: #3f2427;
  border-left-color: #ec6a5e;
}

.solare-match-summary-row {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 16px 14px 18px;
  cursor: pointer;
  flex-wrap: wrap;
}

.solare-round-pip {
  width: 15px;
  height: 15px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font:
    600 9px "JetBrains Mono",
    monospace;
  border: 1px solid transparent;
}

.solare-round-pip--win {
  color: #5ca3ff;
  border-color: #5ca3ff;
  background: rgba(92, 163, 255, 0.12);
}

.solare-round-pip--loss {
  color: #ec6a5e;
  border-color: #ec6a5e;
  background: rgba(236, 106, 94, 0.12);
}

.solare-round-pip--draw {
  color: #9a9aa3;
  border-color: #4a4b52;
  background: rgba(154, 154, 163, 0.1);
}

.solare-grade-badge {
  font:
    600 10px "JetBrains Mono",
    monospace;
  white-space: nowrap;
  border-radius: 3px;
  padding: 2px 7px;
  background: transparent;
  color: #9a9aa3;
  border: 1px solid #3a3b42;
}

.solare-grade-badge--mvp {
  background: rgba(212, 175, 106, 0.15);
  color: #d4af6a;
  border-color: #6a5631;
}

.solare-grade-badge--ace {
  background: rgba(53, 196, 139, 0.15);
  color: #35c48b;
  border-color: rgba(53, 196, 139, 0.45);
}

.solare-rosters-mini {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  flex: 1 1 200px;
  min-width: 0;
  padding-left: 6px;
}

.solare-chevron-btn {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 6px;
  background: #1d1f26;
  border: 1px solid #2e3039;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9a9aa3;
  margin-left: auto;
}

/* EXPANDED DRAWER */
.solare-match-expanded {
  border-top: 1px solid #26272c;
  background: #131418;
}

.solare-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 18px;
  border-bottom: 1px solid #22232a;
  flex-wrap: wrap;
}

.solare-vs-avatar {
  width: 38px;
  height: 38px;
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid #3a3b42;
  background: #1c1d22;
}

.solare-replay-btn {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: #1d1f26;
  border: 1px solid #2e3039;
  color: #d4af6a;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.solare-replay-btn:hover {
  border-color: #d4af6a;
  background: #282319;
}

.solare-teams-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
}

.solare-team-table {
  min-width: 0;
  border-right: 1px solid #22232a;
}

.solare-team-thead {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px 34px 58px 58px 58px;
  gap: 8px;
  padding: 9px 16px;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: #7d7e86;
  border-bottom: 1px solid #22232a;
  white-space: nowrap;
}

.solare-team-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px 34px 58px 58px 58px;
  gap: 8px;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #1c1d22;
}

.solare-team-row--self {
  background: rgba(212, 175, 106, 0.07);
}

.solare-slot-portrait {
  position: relative;
  flex: none;
  width: 52px;
  height: 34px;
  border-radius: 5px;
  overflow: hidden;
  background: #1c1d22;
  border: 1px solid #34353c;
}

.solare-slot-badge {
  position: absolute;
  bottom: 1px;
  left: 2px;
  font:
    700 8px "JetBrains Mono",
    monospace;
  border-radius: 2px;
  padding: 0 3px;
  line-height: 1.3;
}

.solare-slot-badge--mvp {
  background: #d4af6a;
  color: #14120d;
}

.solare-slot-badge--ace {
  background: #35c48b;
  color: #0e1914;
}

.solare-load-more-btn {
  width: 100%;
  border: 1px solid #26272c;
  background: #16171b;
  color: #d4af6a;
  border-radius: 10px;
  padding: 15px;
  font:
    600 12px "IBM Plex Sans",
    sans-serif;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.15s ease;
}

.solare-load-more-btn:hover:not(:disabled) {
  background: #1b1c21;
  border-color: #3a3b42;
}

@media (max-width: 900px) {
  .solare-sidebar {
    max-width: 100%;
  }
  .solare-header-stats {
    border-left: none;
    padding-left: 0;
  }
  .solare-teams-grid {
    grid-template-columns: 1fr;
  }
}

.solare-match-gear {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px 14px;
  border-top: 1px solid #26272c;
}

.solare-match-gear-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #6f7078;
}

.solare-match-gear-team {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.solare-match-gear-team + .solare-match-gear-team {
  padding-top: 6px;
  border-top: 1px dashed #26272c;
}

.solare-match-gear-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  gap: 10px;
}

.solare-match-gear-name {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.solare-match-gear-note {
  font-size: 12px;
  color: #7d7e86;
}

@media (max-width: 640px) {
  .solare-match-gear-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>

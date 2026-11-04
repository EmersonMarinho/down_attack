<template>
  <div
    class="min-h-[calc(100vh-4.5rem)] bg-[#222122] text-stone-200 antialiased font-sans selection:bg-amber-600/40 selection:text-amber-100"
  >
    <main class="w-full max-w-[1540px] mx-auto py-6 px-4 sm:px-6">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8 items-start">
        <!-- LEFT COLUMN (4-5 Cols on desktop): CONFIG & CONTROLS -->
        <div class="lg:col-span-5 xl:col-span-4 space-y-6">
          <!-- CARD 1: FIND YOUR PLAYER (STEP 1) -->
          <div class="bdo-panel rounded-lg p-5 space-y-4">
            <div
              class="flex items-center justify-between border-b border-[#362f27] pb-3"
            >
              <div class="flex items-center space-x-2.5">
                <span
                  class="w-6 h-6 rounded bg-[#3a3026] text-[#dfcaa2] border border-[#584938] flex items-center justify-center font-mono font-bold text-xs"
                >
                  1
                </span>
                <h3
                  class="font-serif font-bold text-sm tracking-wide text-white uppercase"
                >
                  Find Your Player
                </h3>
              </div>
              <span
                v-if="searchStatus === 'found'"
                class="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded uppercase"
              >
                Profile Found
              </span>
              <span
                v-else-if="searchStatus === 'loading'"
                class="text-[11px] font-mono text-amber-300 bg-amber-950/40 border border-amber-800/60 px-2 py-0.5 rounded uppercase"
              >
                Searching...
              </span>
              <span
                v-else-if="searchStatus === 'error'"
                class="text-[11px] font-mono text-rose-400 bg-rose-950/40 border border-rose-800/60 px-2 py-0.5 rounded uppercase"
              >
                Not Found
              </span>
              <span
                v-else
                class="text-[11px] font-mono text-[#dfcaa2] bg-[#2b241c] border border-[#584938] px-2 py-0.5 rounded uppercase"
              >
                Demo Mode
              </span>
            </div>

            <!-- Region Pills -->
            <div class="space-y-1.5">
              <label
                class="text-[11px] font-semibold uppercase tracking-wider text-stone-400"
              >
                Select Region
              </label>
              <div class="grid grid-cols-4 gap-1.5">
                <button
                  v-for="reg in regions"
                  :key="reg"
                  type="button"
                  class="py-1 px-2 text-xs font-mono rounded text-center transition"
                  :class="
                    selectedRegion === reg
                      ? 'font-bold bg-[#382d21] text-[#dfcaa2] border border-[#826744] shadow-sm'
                      : 'font-medium bg-[#1e1c1b] text-stone-400 border border-[#362f27] hover:border-[#584938]'
                  "
                  @click="selectRegion(reg)"
                >
                  {{ reg }}
                </button>
              </div>
            </div>

            <!-- Family Name Input + Search Button -->
            <div class="space-y-1.5">
              <label
                class="text-[11px] font-semibold uppercase tracking-wider text-stone-400"
              >
                Family Name
              </label>
              <form class="flex space-x-2" @submit.prevent="handleSearchPlayer">
                <div class="relative flex-grow">
                  <input
                    v-model="familyNameInput"
                    type="text"
                    placeholder="Enter your Family Name (e.g., Okazaki)"
                    class="w-full bg-[#151413] border border-[#584938] focus:border-[#c5a059] rounded px-3.5 py-2 text-xs text-white placeholder-stone-500 focus:outline-none transition font-sans"
                  />
                </div>
                <button
                  type="submit"
                  :disabled="isSearching"
                  class="px-4 py-2 bg-[#2c2621] hover:bg-[#393129] disabled:opacity-50 border border-[#584938] hover:border-[#c5a059] rounded text-xs font-bold text-[#dfcaa2] transition flex items-center space-x-1.5 flex-shrink-0 cursor-pointer"
                >
                  <svg
                    class="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                  <span>{{ isSearching ? "..." : "Search" }}</span>
                </button>
              </form>
              <p
                v-if="searchErrorMessage"
                class="text-[11px] font-mono text-rose-400 pt-0.5"
              >
                {{ searchErrorMessage }}
              </p>
            </div>

            <!-- Player Status Result Box -->
            <div class="bdo-panel-inner rounded-md p-3.5 space-y-3">
              <div class="flex items-center space-x-3.5">
                <!-- Class Portrait -->
                <div
                  class="relative w-14 h-16 rounded border border-[#715c43] bg-black overflow-hidden flex-shrink-0 shadow"
                >
                  <img
                    v-if="playerPortraitUrl && !portraitImgError"
                    :src="playerPortraitUrl"
                    :alt="activePlayerData.user_nickname"
                    class="w-full h-full object-cover object-top"
                    @error="portraitImgError = true"
                  />
                  <div
                    v-else
                    class="w-full h-full flex items-center justify-center bg-[#181615]"
                  >
                    <img
                      src="/images/solare/solare-icon-game@4x.png"
                      alt="Solare"
                      class="w-8 h-8 object-contain opacity-60"
                    />
                  </div>
                </div>

                <!-- Player Info (Without Rating/Points row) -->
                <div class="flex-grow space-y-1 min-w-0">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center space-x-2 min-w-0">
                      <span
                        class="font-serif font-black text-base text-white truncate"
                      >
                        {{ activePlayerData.user_nickname }}
                      </span>
                      <span
                        class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#2b241c] text-[#dfcaa2] border border-[#584938] shrink-0"
                      >
                        {{
                          activePlayerData.current_ranking
                            ? `#${activePlayerData.current_ranking}`
                            : "UNRANKED"
                        }}
                      </span>
                    </div>
                    <span
                      class="text-xs font-mono font-bold text-emerald-400 shrink-0"
                    >
                      {{ activePlayerData.overall?.winrate ?? 0 }}% WR
                    </span>
                  </div>

                  <div
                    class="text-[11px] text-stone-300 flex items-center space-x-2"
                  >
                    <span class="font-bold text-stone-200">
                      {{ activePlayerData.region }} • {{ activeClassName }}
                    </span>
                    <span class="text-stone-500">•</span>
                    <span class="text-amber-400/90 font-medium">
                      {{ activeSpecName }}
                    </span>
                  </div>

                  <div class="text-[11px] font-mono text-stone-400 pt-0.5">
                    <span class="text-emerald-400 font-bold">
                      {{ activePlayerData.overall?.wins ?? 0 }}W
                    </span>
                    <span> - </span>
                    <span class="text-rose-400 font-bold">
                      {{ activePlayerData.overall?.losses ?? 0 }}L
                    </span>
                    <span class="text-stone-500">
                      ({{ activePlayerData.overall?.total_games ?? 0 }} Matches)
                    </span>
                  </div>
                </div>
              </div>

              <!-- Last Recorded Match Verification Box (With Match Stats) -->
              <div
                class="rounded bg-[#181615] border border-[#3b332a] p-2.5 space-y-2.5"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="space-y-0.5 min-w-0">
                    <div
                      class="text-[10px] font-mono uppercase tracking-wider text-stone-400 flex items-center space-x-1.5"
                    >
                      <span
                        class="w-1.5 h-1.5 rounded-full"
                        :class="
                          activeLatestMatch ? 'bg-emerald-400' : 'bg-amber-400'
                        "
                      />
                      <span>Last Processed Match:</span>
                    </div>
                    <div
                      v-if="activeLatestMatch"
                      class="text-xs font-mono font-semibold text-stone-200 flex items-center gap-1.5 flex-wrap"
                    >
                      <span
                        class="px-1.5 py-0.5 rounded text-[10px] font-black uppercase border"
                        :class="
                          activeLatestMatch.is_winner
                            ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-400'
                            : 'bg-rose-950/60 border-rose-600/50 text-rose-400'
                        "
                      >
                        {{ activeLatestMatch.is_winner ? "Victory" : "Defeat" }}
                      </span>
                      <span
                        v-if="activeLatestMatch.award"
                        class="px-1.5 py-0.5 rounded text-[10px] font-black uppercase border"
                        :class="
                          activeLatestMatch.award === 'mvp'
                            ? 'bg-amber-950/60 border-amber-500/60 text-amber-300'
                            : 'bg-violet-950/60 border-violet-500/60 text-violet-300'
                        "
                        :title="`Performance score: ${activeLatestMatch.performance_score} (100 = match average)`"
                      >
                        {{
                          activeLatestMatch.award === "mvp" ? "★ MVP" : "ACE"
                        }}
                      </span>
                      <span
                        v-if="latestMatchDelta !== null"
                        class="font-bold"
                        :class="
                          latestMatchDelta >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        "
                      >
                        {{
                          latestMatchDelta >= 0
                            ? `+${latestMatchDelta}`
                            : latestMatchDelta
                        }}
                        PTS
                      </span>
                      <span class="text-stone-500">
                        #{{ activeLatestMatch.record_no }}
                      </span>
                      <span
                        v-if="
                          formatRelativeMatchTime(activeLatestMatch.match_date)
                        "
                        class="text-stone-400 text-[11px]"
                      >
                        •
                        {{
                          formatRelativeMatchTime(activeLatestMatch.match_date)
                        }}
                      </span>
                    </div>
                    <div v-else class="text-xs font-mono text-stone-400">
                      No recorded matches found yet
                    </div>
                  </div>

                  <div
                    class="flex items-center space-x-1 px-2 py-1 rounded bg-emerald-950/60 border border-emerald-600/50 text-[10px] font-bold text-emerald-300 shrink-0"
                  >
                    <svg
                      class="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M5 13l4 4L19 7"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                      />
                    </svg>
                    <span>Safe to Start</span>
                  </div>
                </div>

                <!-- Match Combat Performance Breakdown -->
                <div
                  v-if="activeLatestMatch"
                  class="grid grid-cols-5 gap-1.5 pt-2 border-t border-[#2c251f] text-center font-mono"
                >
                  <div
                    class="bg-[#121110] border border-[#2d2722] rounded py-1.5 px-1"
                  >
                    <span
                      class="block text-[9px] uppercase text-stone-400 font-semibold"
                    >
                      DMG
                    </span>
                    <span class="block text-xs font-bold text-white mt-0.5">
                      {{ formatCompactStat(activeLatestMatch.damage_done) }}
                    </span>
                  </div>

                  <div
                    class="bg-[#121110] border border-[#2d2722] rounded py-1.5 px-1"
                  >
                    <span
                      class="block text-[9px] uppercase text-stone-400 font-semibold"
                    >
                      TAKEN
                    </span>
                    <span class="block text-xs font-bold text-stone-200 mt-0.5">
                      {{ formatCompactStat(activeLatestMatch.damage_taken) }}
                    </span>
                  </div>

                  <div
                    class="bg-[#121110] border border-[#2d2722] rounded py-1.5 px-1"
                  >
                    <span
                      class="block text-[9px] uppercase text-stone-400 font-semibold"
                    >
                      HEAL
                    </span>
                    <span
                      class="block text-xs font-bold text-emerald-400 mt-0.5"
                    >
                      {{ formatCompactStat(activeLatestMatch.recovery) }}
                    </span>
                  </div>

                  <div
                    class="bg-[#121110] border border-[#2d2722] rounded py-1.5 px-1"
                  >
                    <span
                      class="block text-[9px] uppercase text-stone-400 font-semibold"
                    >
                      K / D
                    </span>
                    <span class="block text-xs font-bold text-white mt-0.5">
                      {{ activeLatestMatch.kills }}/{{
                        activeLatestMatch.deaths
                      }}
                    </span>
                  </div>

                  <div
                    class="bg-[#121110] border border-[#2d2722] rounded py-1.5 px-1"
                  >
                    <span
                      class="block text-[9px] uppercase text-stone-400 font-semibold"
                    >
                      CC
                    </span>
                    <span class="block text-xs font-bold text-[#dfcaa2] mt-0.5">
                      {{ activeLatestMatch.cc }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- CARD 2: START OR RESET STREAM SESSION (STEP 2) -->
          <div class="bdo-panel rounded-lg p-5 space-y-4">
            <div
              class="flex items-center justify-between border-b border-[#362f27] pb-3"
            >
              <div class="flex items-center space-x-2.5">
                <span
                  class="w-6 h-6 rounded bg-[#3a3026] text-[#dfcaa2] border border-[#584938] flex items-center justify-center font-mono font-bold text-xs"
                >
                  2
                </span>
                <h3
                  class="font-serif font-bold text-sm tracking-wide text-white uppercase"
                >
                  Start or Reset Stream Session
                </h3>
              </div>
              <div v-if="sessionToken" class="flex items-center space-x-1.5">
                <span
                  class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"
                />
                <span class="text-[11px] font-mono font-bold text-emerald-400">
                  LIVE SESSION ACTIVE
                </span>
              </div>
              <span
                v-else
                class="text-[11px] font-mono font-bold text-stone-400"
              >
                READY TO START
              </span>
            </div>

            <p class="text-xs text-stone-400 leading-relaxed">
              Starting a session snapshots your current baseline rating and only
              counts matches finished after this moment.
            </p>

            <!-- Smart Baseline Continuity Notice -->
            <div
              class="rounded bg-[#211e1b] border border-[#4d3e2e] p-3 text-xs space-y-1.5"
            >
              <div
                class="flex items-center space-x-2 text-[#dfcaa2] font-semibold"
              >
                <svg
                  class="w-4 h-4 text-[#c5a059] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <span>Session Continuity Detected</span>
              </div>
              <p class="text-[11px] text-stone-300 leading-normal">
                <template
                  v-if="sessionToken && activePlayerData.rating !== null"
                >
                  Previous session detected: Your last session is at
                  <span class="font-mono font-bold text-white">
                    {{ activePlayerData.rating }} PTS
                  </span>
                  . Starting a new session will automatically continue from
                  <span class="font-mono font-bold text-[#dfcaa2]">
                    {{ activePlayerData.rating }} PTS
                  </span>
                  (or customize your baseline below).
                </template>
                <template v-else>
                  Enter your current in-game Arena of Solare rating (PTS) below.
                  On future streams, your ending rating will be carried over
                  automatically!
                </template>
              </p>
            </div>

            <!-- Starting Rating Input Row -->
            <div>
              <label
                class="text-[11px] font-semibold uppercase tracking-wider text-stone-400 block mb-1"
              >
                Starting Rating (PTS)
              </label>
              <div class="relative">
                <input
                  v-model.number="startingRatingInput"
                  type="number"
                  min="0"
                  max="9999"
                  placeholder="Enter your current in-game PTS (e.g., 1850)"
                  class="w-full bg-[#151413] border border-[#584938] focus:border-[#c5a059] rounded px-3 py-1.5 text-xs font-mono font-bold text-[#dfcaa2] placeholder-stone-500 placeholder:font-sans placeholder:font-normal focus:outline-none"
                />
                <button
                  type="button"
                  class="absolute right-2 top-1.5 text-[10px] text-stone-400 hover:text-stone-200 underline cursor-pointer"
                  @click="resetBaselineInput"
                >
                  Reset
                </button>
              </div>
            </div>

            <!-- Primary Action Button -->
            <button
              type="button"
              :disabled="isSavingSession"
              class="w-full gold-gradient-btn py-3 px-4 rounded text-xs font-serif font-black tracking-wider uppercase text-white flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-60"
              @click="handleStartOrResetSession"
            >
              <svg
                class="w-4 h-4 text-[#dfcaa2]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </svg>
              <span>{{ sessionButtonLabel }}</span>
            </button>

            <p
              v-if="sessionFeedbackMessage"
              class="text-[11px] font-mono"
              :class="
                sessionFeedbackIsError ? 'text-rose-400' : 'text-emerald-400'
              "
            >
              {{ sessionFeedbackMessage }}
            </p>

            <!-- Current Active Session Tracker Summary -->
            <div
              class="rounded bg-[#171514] border border-[#3b342b] p-3 flex items-center justify-between text-xs"
            >
              <div class="space-y-0.5">
                <div
                  class="text-[10px] font-mono text-stone-400 uppercase tracking-wider"
                >
                  Active Session Status
                </div>
                <div class="font-mono font-bold text-stone-200">
                  <span>{{ sessionStatusPrefix }} • </span>
                  <span class="text-emerald-400">
                    {{ activePlayerData.session?.wins ?? 0 }}W
                  </span>
                  <span> - </span>
                  <span class="text-rose-400">
                    {{ activePlayerData.session?.losses ?? 0 }}L
                  </span>
                  <span> (</span>
                  <span
                    :class="
                      (activePlayerData.session?.net_pdl ?? 0) >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    "
                  >
                    {{
                      (activePlayerData.session?.net_pdl ?? 0) >= 0
                        ? `+${activePlayerData.session?.net_pdl ?? 0}`
                        : (activePlayerData.session?.net_pdl ?? 0)
                    }}
                    PTS
                  </span>
                  <span>)</span>
                </div>
              </div>
              <div class="text-right font-mono">
                <span class="text-[10px] text-stone-500 block">
                  LAST OVERLAY SYNC
                </span>
                <span class="text-xs text-stone-300 font-bold">
                  {{ syncSecondsAgo }}s ago
                </span>
              </div>
            </div>
          </div>

          <!-- CARD 3: LAYOUT & OBS BROWSER SOURCE URL (STEP 3) -->
          <div class="bdo-panel rounded-lg p-5 space-y-4">
            <div
              class="flex items-center justify-between border-b border-[#362f27] pb-3"
            >
              <div class="flex items-center space-x-2.5">
                <span
                  class="w-6 h-6 rounded bg-[#3a3026] text-[#dfcaa2] border border-[#584938] flex items-center justify-center font-mono font-bold text-xs"
                >
                  3
                </span>
                <h3
                  class="font-serif font-bold text-sm tracking-wide text-white uppercase"
                >
                  Layout &amp; OBS Browser Source URL
                </h3>
              </div>
              <span class="text-[11px] font-mono text-[#c5a059]">
                AUTO-REFRESH 20s
              </span>
            </div>

            <!-- Layout Selector Toggle (Vertical vs Horizontal) -->
            <div class="space-y-2">
              <label
                class="text-[11px] font-semibold uppercase tracking-wider text-stone-400"
              >
                Choose Overlay Layout
              </label>
              <div class="grid grid-cols-2 gap-3">
                <!-- Vertical Option -->
                <button
                  type="button"
                  class="p-3 rounded-lg text-left transition cursor-pointer"
                  :class="
                    selectedLayout === 'vertical'
                      ? 'border-2 border-[#826744] bg-[#29221b] shadow'
                      : 'border border-[#362f27] bg-[#1a1817] hover:border-[#584938]'
                  "
                  @click="selectedLayout = 'vertical'"
                >
                  <div class="flex items-center justify-between mb-1.5">
                    <span
                      class="font-serif font-bold text-xs"
                      :class="
                        selectedLayout === 'vertical'
                          ? 'text-white'
                          : 'text-stone-300'
                      "
                    >
                      Vertical Card
                    </span>
                    <span
                      class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40"
                      :class="
                        selectedLayout === 'vertical'
                          ? 'text-[#dfcaa2]'
                          : 'text-stone-400'
                      "
                    >
                      340 × 520 px
                    </span>
                  </div>
                  <p class="text-[11px] text-stone-400 leading-tight">
                    Best for webcam sidebars, chat docks, or corners.
                  </p>
                </button>

                <!-- Horizontal Option -->
                <button
                  type="button"
                  class="p-3 rounded-lg text-left transition cursor-pointer"
                  :class="
                    selectedLayout === 'horizontal'
                      ? 'border-2 border-[#826744] bg-[#29221b] shadow'
                      : 'border border-[#362f27] bg-[#1a1817] hover:border-[#584938]'
                  "
                  @click="selectedLayout = 'horizontal'"
                >
                  <div class="flex items-center justify-between mb-1.5">
                    <span
                      class="font-serif font-bold text-xs"
                      :class="
                        selectedLayout === 'horizontal'
                          ? 'text-white'
                          : 'text-stone-300'
                      "
                    >
                      Horizontal Bar
                    </span>
                    <span
                      class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40"
                      :class="
                        selectedLayout === 'horizontal'
                          ? 'text-[#dfcaa2]'
                          : 'text-stone-400'
                      "
                    >
                      790 × 200 px
                    </span>
                  </div>
                  <p class="text-[11px] text-stone-400 leading-tight">
                    Best for top/bottom game bars &amp; ticker overlays.
                  </p>
                </button>
              </div>
            </div>

            <!-- Generated Secret OBS URL Input Box -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label
                  class="text-[11px] font-semibold uppercase tracking-wider text-stone-400"
                >
                  Your Private OBS Browser Source URL
                </label>
                <button
                  v-if="sessionToken"
                  type="button"
                  class="text-[10px] font-mono text-[#c5a059] hover:underline cursor-pointer"
                  @click="isTokenMasked = !isTokenMasked"
                >
                  {{ isTokenMasked ? "Show Secret Token" : "Hide Token" }}
                </button>
              </div>
              <div class="flex space-x-2">
                <div class="relative flex-grow">
                  <input
                    :value="displayedObsUrl"
                    readonly
                    type="text"
                    class="w-full bg-[#121110] border border-[#584938] rounded px-3 py-2 text-xs font-mono text-[#dfcaa2] focus:outline-none select-all"
                    @copy.prevent="copyObsUrl"
                  />
                </div>
                <button
                  type="button"
                  class="px-3.5 py-2 border rounded text-xs font-bold text-white transition flex items-center space-x-1.5 flex-shrink-0 cursor-pointer"
                  :class="
                    copiedUrl
                      ? 'bg-emerald-800 border-emerald-500'
                      : 'bg-[#2c241c] hover:bg-[#382f24] border-[#826744] hover:border-[#c5a059]'
                  "
                  @click="copyObsUrl"
                >
                  <svg
                    class="w-4 h-4 text-[#c5a059]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                  <span>{{ copiedUrl ? "COPIED!" : "Copy URL" }}</span>
                </button>
              </div>
            </div>

            <!-- Chatbot Command Setup (Nightbot / StreamElements) -->
            <div class="space-y-1.5 pt-2 border-t border-[#362f27]">
              <div class="flex items-center justify-between">
                <label
                  class="text-[11px] font-semibold uppercase tracking-wider text-stone-400"
                >
                  Twitch &amp; Kick Chat Command (!solare)
                </label>
                <div class="flex items-center space-x-1">
                  <button
                    type="button"
                    class="px-2 py-0.5 text-[10px] font-mono rounded transition cursor-pointer"
                    :class="
                      selectedChatBot === 'nightbot'
                        ? 'font-bold bg-[#382d21] text-[#dfcaa2] border border-[#826744]'
                        : 'text-stone-400 bg-[#1a1817] border border-[#362f27] hover:border-[#584938]'
                    "
                    @click="selectedChatBot = 'nightbot'"
                  >
                    Nightbot
                  </button>
                  <button
                    type="button"
                    class="px-2 py-0.5 text-[10px] font-mono rounded transition cursor-pointer"
                    :class="
                      selectedChatBot === 'streamelements'
                        ? 'font-bold bg-[#382d21] text-[#dfcaa2] border border-[#826744]'
                        : 'text-stone-400 bg-[#1a1817] border border-[#362f27] hover:border-[#584938]'
                    "
                    @click="selectedChatBot = 'streamelements'"
                  >
                    StreamElements
                  </button>
                </div>
              </div>
              <div class="flex space-x-2">
                <div class="relative flex-grow">
                  <input
                    :value="displayedChatCommand"
                    readonly
                    type="text"
                    class="w-full bg-[#121110] border border-[#584938] rounded px-3 py-2 text-xs font-mono text-[#dfcaa2] focus:outline-none select-all"
                    @copy.prevent="copyChatCommand"
                  />
                </div>
                <button
                  type="button"
                  class="px-3.5 py-2 border rounded text-xs font-bold text-white transition flex items-center space-x-1.5 flex-shrink-0 cursor-pointer"
                  :class="
                    copiedChatCommand
                      ? 'bg-emerald-800 border-emerald-500'
                      : 'bg-[#2c241c] hover:bg-[#382f24] border-[#826744] hover:border-[#c5a059]'
                  "
                  @click="copyChatCommand"
                >
                  <svg
                    class="w-4 h-4 text-[#c5a059]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                    />
                  </svg>
                  <span>{{ copiedChatCommand ? "COPIED!" : "Copy Cmd" }}</span>
                </button>
              </div>
              <p class="text-[10px] text-stone-400">
                Paste in your stream chat to add
                <span class="font-mono text-stone-300">!solare</span> (or change
                to <span class="font-mono text-stone-300">!pdl</span> /
                <span class="font-mono text-stone-300">!rank</span>).
              </p>
            </div>

            <!-- Security Callout Note -->
            <div
              class="rounded bg-[#1a1714] border-l-2 border-l-[#826744] border-y border-r border-[#362f27] p-2.5 text-[11px] text-stone-400 leading-relaxed"
            >
              <span class="text-stone-200 font-semibold">Security Note:</span>
              Keep this URL private. Anyone with your token URL can view your
              overlay, and whenever you click
              <strong class="text-stone-300">"Reset Session"</strong> here, your
              OBS overlay updates automatically within 20 seconds without
              changing the URL!
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN (7-8 Cols on desktop): LIVE INTERACTIVE PREVIEW CANVAS & WARNING -->
        <div class="lg:col-span-7 xl:col-span-8 space-y-4 lg:sticky lg:top-4">
          <!-- Preview Canvas Panel -->
          <div class="bdo-panel rounded-lg p-5 space-y-4">
            <!-- Top Bar: "SOLARE OVERLAY CARD PREVIEW" with Test Rating Slider -->
            <div
              class="rounded bg-[#151413] border border-[#3b342a] p-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div class="flex items-center space-x-3">
                <img
                  src="/images/solare/solare-icon-game@4x.png"
                  alt="Solare"
                  class="w-6 h-6 object-contain"
                />
                <div>
                  <h4
                    class="font-serif font-black text-xs uppercase tracking-wider text-white"
                  >
                    SOLARE OVERLAY CARD PREVIEW
                  </h4>
                  <p class="text-[10px] text-stone-400 font-sans">
                    Block 3 rotates automatically every 10s (or click Block 3 to
                    toggle manually)
                  </p>
                </div>
              </div>

              <!-- Test Rating Slider -->
              <div class="flex items-center space-x-2 text-xs font-mono">
                <span class="text-stone-400 text-[11px]">Test Rating:</span>
                <input
                  v-model.number="previewRatingOverride"
                  type="range"
                  min="200"
                  max="2500"
                  step="25"
                  class="accent-[#c5a059] w-24 h-1.5 bg-[#2a241e] rounded cursor-pointer"
                />
                <span
                  class="px-2 py-0.5 rounded bg-[#1f1b18] border border-[#584938] text-[#dfcaa2] font-bold text-xs min-w-[48px] text-center"
                >
                  {{ previewCardData.rating }}
                </span>
              </div>
            </div>

            <!-- Sub-header indicator: Preview Format Toggle -->
            <div class="flex items-center justify-between">
              <div
                class="w-full flex flex-wrap items-center justify-between gap-2 bg-[#151413] border border-[#3b342a] rounded-lg p-1.5"
              >
                <span
                  class="text-[11px] font-mono text-stone-400 uppercase tracking-wider px-2 font-semibold"
                >
                  Preview Format:
                </span>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded text-xs font-mono transition flex items-center gap-1.5 cursor-pointer"
                    :class="
                      selectedLayout === 'vertical'
                        ? 'font-bold bg-[#382d21] text-[#dfcaa2] border border-[#826744] shadow-sm'
                        : 'font-medium bg-[#1e1c1b] text-stone-400 border border-[#362f27] hover:border-[#584938] hover:text-stone-200'
                    "
                    @click="selectedLayout = 'vertical'"
                  >
                    <svg
                      class="w-3.5 h-3.5 text-[#c5a059]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <rect
                        width="12"
                        height="18"
                        x="6"
                        y="3"
                        rx="2"
                        stroke-width="2"
                      />
                    </svg>
                    <span>Vertical (340px)</span>
                  </button>
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded text-xs font-mono transition flex items-center gap-1.5 cursor-pointer"
                    :class="
                      selectedLayout === 'horizontal'
                        ? 'font-bold bg-[#382d21] text-[#dfcaa2] border border-[#826744] shadow-sm'
                        : 'font-medium bg-[#1e1c1b] text-stone-400 border border-[#362f27] hover:border-[#584938] hover:text-stone-200'
                    "
                    @click="selectedLayout = 'horizontal'"
                  >
                    <svg
                      class="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <rect
                        width="18"
                        height="12"
                        x="3"
                        y="6"
                        rx="2"
                        stroke-width="2"
                      />
                    </svg>
                    <span>Horizontal (790px)</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- The Live Stage Surface with our previously approved SolareCard -->
            <div
              class="rounded-lg bg-checkerboard min-h-[580px] p-2 sm:p-4 flex items-center justify-center relative overflow-hidden transition-all duration-300 border border-[#362f27]"
            >
              <div
                class="relative z-10 transition-transform duration-300 flex items-center justify-center"
                :class="
                  selectedLayout === 'horizontal'
                    ? 'scale-[0.42] sm:scale-[0.72] md:scale-[0.85] lg:scale-[0.82] xl:scale-[0.94] 2xl:scale-100 origin-center'
                    : ''
                "
              >
                <SolareCard :data="previewCardData" :layout="selectedLayout" />
              </div>
            </div>

            <!-- Preview Stage Footer Controls -->
            <div
              class="flex items-center justify-between text-[11px] font-mono text-stone-400 px-1 pt-1"
            >
              <div class="flex items-center space-x-3">
                <span>
                  Interactive Preview — Click Block 3 on the card to toggle
                  between Live Session &amp; Combat Averages
                </span>
              </div>
            </div>
          </div>

          <!-- IMPORTANT WARNING BANNER (IN ENGLISH) -->
          <div
            class="rounded-lg bg-[#1c1a19] border-2 border-amber-600/50 p-5 shadow-xl space-y-3 relative overflow-hidden"
          >
            <div class="flex items-start space-x-3.5">
              <div
                class="w-9 h-9 rounded-md bg-[#2a2218] border border-amber-500/50 text-amber-400 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div class="flex-grow space-y-2.5">
                <div
                  class="flex flex-wrap items-center justify-between gap-2 border-b border-[#3b3329] pb-2"
                >
                  <h4
                    class="font-serif font-black text-sm md:text-base uppercase tracking-wider text-amber-400 flex items-center gap-2"
                  >
                    <span>IMPORTANT: CHECK YOUR LAST PROCESSED MATCH</span>
                  </h4>
                  <span
                    class="text-xs font-mono px-2.5 py-1 rounded bg-amber-950/80 text-amber-300 border border-amber-600/60 font-bold uppercase tracking-wider"
                  >
                    Server Delay (2–5 min)
                  </span>
                </div>
                <p
                  class="text-sm text-stone-200 leading-relaxed font-sans font-medium"
                >
                  Before clicking
                  <strong
                    class="text-[#dfcaa2] font-bold font-mono px-1 py-0.5 rounded bg-black/40 border border-[#584938]"
                  >
                    "Start / Reset Today's Session"
                  </strong>
                  , verify in
                  <strong
                    class="text-white font-bold underline decoration-[#c5a059]"
                  >
                    Step 1
                  </strong>
                  whether the last match recorded by the system is actually your
                  most recent game. Due to Black Desert's official server delay
                  (2 to 5 minutes to publish match data), starting a session
                  before your previous match has been processed may cause that
                  earlier match to be counted in today's session.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { getClassName, getSkillBranch } from "~/utils/solareTier.js";

useSeoMeta({
  title: "BDO Arena of Solare OBS Stream Overlay & Rating Tracker",
  description:
    "Free real-time Black Desert Online (BDO) Arena of Solare stream overlay for OBS Studio. Track your rank tier, live session rating delta (PTS), win streak bonus, Win/Loss ratio, and combat averages across SA, NA, EU, KR, JP, RU, TR, and TW. Overlay de Arena de Solare para BDO.",
  keywords:
    "BDO Solare Overlay, Arena of Solare OBS Overlay, Overlay de Solare BDO, BDO Stream Widget, BDO Rating Tracker, BDO PDL Tracker, Arena de Solare Ranking BDO, Black Desert OBS Overlay",
  ogTitle: "BDO Arena of Solare OBS Stream Overlay — Down Attack",
  ogDescription:
    "Real-time OBS browser widget for BDO Arena of Solare with live session rating tracking, win streak bonuses, and combat averages across all regions.",
  twitterTitle: "BDO Arena of Solare OBS Stream Overlay — Down Attack",
  twitterDescription:
    "Real-time OBS browser widget for BDO Arena of Solare with live session rating tracking, win streak bonuses, and combat averages across all regions.",
});

definePageMeta({
  header: {
    name: "Solare Overlay",
    icon: "/icons/overlay.png",
  },
});

const STORAGE_KEY = "down_attack_solare_overlay_v1";
const regions = ["SA", "NA", "EU", "KR", "JP", "RU", "TR", "TW"];

const selectedRegion = ref("SA");
const familyNameInput = ref("Okazaki");
const selectedLayout = ref("vertical");

const isSearching = ref(false);
const searchStatus = ref("demo"); // 'demo' | 'loading' | 'found' | 'error'
const searchErrorMessage = ref("");

const sessionToken = ref("");
const startingRatingInput = ref(null);
const isSavingSession = ref(false);
const sessionButtonLabel = ref("START / RESET TODAY'S SESSION");
const sessionFeedbackMessage = ref("");
const sessionFeedbackIsError = ref(false);

const isTokenMasked = ref(true);
const copiedUrl = ref(false);
const selectedChatBot = ref("nightbot");
const copiedChatCommand = ref(false);
const portraitImgError = ref(false);

const previewRatingOverride = ref(null);
const syncSecondsAgo = ref(5);
let syncClockInterval = null;

// Demo fallback data (matches Stitch reference when no live search is loaded yet)
const demoOverlayData = {
  region: "SA",
  user_nickname: "Okazaki",
  user_no: "777001",
  current_ranking: 65,
  class_type: 20,
  skill_branch_type: 2,
  rating: 2080,
  latest_record_no: 930004,
  latest_match: {
    record_no: 930004,
    is_winner: true,
    kills: 5,
    deaths: 2,
    cc: 11,
    damage_done: 214000,
    damage_taken: 138000,
    recovery: 96000,
    performance_score: 152,
    award: "mvp",
    match_date: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
  },
  overall: {
    wins: 79,
    losses: 50,
    draws: 0,
    total_games: 129,
    winrate: 61.25,
  },
  averages: {
    damage_done: 185000,
    damage_taken: 145000,
    cc: 9.8,
    recovery: 103000,
    kills: 3.7,
    deaths: 2.3,
  },
  session: {
    anchor_rating: 1996,
    anchor_record_no: 930000,
    session_start_record_no: 930000,
    wins: 4,
    losses: 2,
    draws: 0,
    total_games: 6,
    winrate: 66.7,
    net_pdl: 84,
    recent_deltas: [28, 32, -26, 31, 19],
  },
};

const livePlayerData = ref(null);

const activePlayerData = computed(() => {
  return livePlayerData.value || demoOverlayData;
});

const activeLatestMatch = computed(() => {
  return activePlayerData.value?.latest_match || null;
});

function formatCompactStat(val) {
  const num = Number(val) || 0;
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${Math.round(num / 1000)}K`;
  }
  return String(num);
}

function formatRelativeMatchTime(isoDate) {
  if (!isoDate) return "";
  const timeMs = new Date(isoDate).getTime();
  if (Number.isNaN(timeMs)) return "";

  const diffSec = Math.max(0, Math.floor((Date.now() - timeMs) / 1000));
  if (diffSec < 60) {
    return "Just now";
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

const activeEffectiveRating = computed(() => {
  if (
    activePlayerData.value.rating !== null &&
    activePlayerData.value.rating !== undefined
  ) {
    return Number(activePlayerData.value.rating);
  }
  if (
    startingRatingInput.value !== null &&
    startingRatingInput.value !== "" &&
    !Number.isNaN(Number(startingRatingInput.value))
  ) {
    return Number(startingRatingInput.value);
  }
  return 2080;
});

const previewCardData = computed(() => {
  const base = activePlayerData.value;
  const effectiveRating =
    previewRatingOverride.value !== null
      ? Number(previewRatingOverride.value)
      : activeEffectiveRating.value;

  return {
    ...base,
    rating: effectiveRating,
  };
});

watch(
  () => activePlayerData.value?.class_type,
  () => {
    portraitImgError.value = false;
  },
);

const playerPortraitUrl = computed(() => {
  const classType = activePlayerData.value?.class_type;
  if (classType === null || classType === undefined) return null;
  return `/images/solare/classes/${classType}.jpg`;
});

const activeClassName = computed(() =>
  getClassName(activePlayerData.value?.class_type),
);

const activeSpecName = computed(() =>
  getSkillBranch(
    activePlayerData.value?.class_type,
    activePlayerData.value?.skill_branch_type,
  ),
);

const latestMatchDelta = computed(() => {
  const deltas = activePlayerData.value?.session?.recent_deltas;
  if (Array.isArray(deltas) && deltas.length > 0) {
    return deltas[0];
  }
  return null;
});

const sessionStatusPrefix = computed(() => {
  if (sessionToken.value) {
    return "Live Session Running";
  }
  return "Preview Session";
});

const fullObsUrl = computed(() => {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://down-attack.com";
  if (sessionToken.value) {
    return `${origin}/solare/overlay?token=${encodeURIComponent(sessionToken.value)}&layout=${selectedLayout.value}`;
  }
  const targetNick = (
    livePlayerData.value?.user_nickname ||
    familyNameInput.value ||
    "Okazaki"
  ).trim();
  const targetRegion = (
    livePlayerData.value?.region ||
    selectedRegion.value ||
    "SA"
  ).toUpperCase();
  return `${origin}/solare/overlay?nick=${encodeURIComponent(targetNick)}&region=${encodeURIComponent(targetRegion)}&layout=${selectedLayout.value}`;
});

const displayedObsUrl = computed(() => {
  if (!sessionToken.value || !isTokenMasked.value) {
    return fullObsUrl.value;
  }
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://down-attack.com";
  const rawToken = sessionToken.value;
  const masked =
    rawToken.length > 12
      ? `${rawToken.slice(0, 6)}••••••••${rawToken.slice(-4)}`
      : rawToken;
  return `${origin}/solare/overlay?token=${masked}&layout=${selectedLayout.value}`;
});

function buildChatCommand(urlStr) {
  if (selectedChatBot.value === "streamelements") {
    return `!cmd add !solare \${customapi.${urlStr}}`;
  }
  return `!addcom !solare $(urlfetch ${urlStr})`;
}

const fullChatCommand = computed(() => {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://down-attack.com";
  if (sessionToken.value) {
    return buildChatCommand(
      `${origin}/api/v1/solare/chat?token=${encodeURIComponent(sessionToken.value)}`,
    );
  }
  const targetNick = (
    livePlayerData.value?.user_nickname ||
    familyNameInput.value ||
    "Okazaki"
  ).trim();
  const targetRegion = (
    livePlayerData.value?.region ||
    selectedRegion.value ||
    "SA"
  ).toUpperCase();
  return buildChatCommand(
    `${origin}/api/v1/solare/chat?nick=${encodeURIComponent(targetNick)}&region=${encodeURIComponent(targetRegion)}`,
  );
});

const displayedChatCommand = computed(() => {
  if (!sessionToken.value || !isTokenMasked.value) {
    return fullChatCommand.value;
  }
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://down-attack.com";
  const rawToken = sessionToken.value;
  const masked =
    rawToken.length > 12
      ? `${rawToken.slice(0, 6)}••••••••${rawToken.slice(-4)}`
      : rawToken;
  return buildChatCommand(`${origin}/api/v1/solare/chat?token=${masked}`);
});

function saveStateToStorage() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        region: selectedRegion.value,
        nick: familyNameInput.value,
        token: sessionToken.value,
        layout: selectedLayout.value,
        rating: startingRatingInput.value,
      }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

watch([selectedRegion, selectedLayout], () => {
  saveStateToStorage();
});

function selectRegion(reg) {
  selectedRegion.value = reg;
}

function resetBaselineInput() {
  if (
    activePlayerData.value?.rating !== null &&
    activePlayerData.value?.rating !== undefined
  ) {
    startingRatingInput.value = Number(activePlayerData.value.rating);
  } else {
    startingRatingInput.value = null;
  }
  previewRatingOverride.value = null;
}

async function handleSearchPlayer() {
  const trimmedNick = familyNameInput.value.trim();
  if (!trimmedNick) return;

  isSearching.value = true;
  searchStatus.value = "loading";
  searchErrorMessage.value = "";

  try {
    const params = new URLSearchParams();
    params.set("nick", trimmedNick);
    params.set("region", selectedRegion.value);

    const isSamePlayerSession =
      sessionToken.value &&
      livePlayerData.value &&
      livePlayerData.value.user_nickname?.toLowerCase() ===
        trimmedNick.toLowerCase() &&
      livePlayerData.value.region === selectedRegion.value;

    // If stored token matches same player & region, pass token to also load active session
    if (isSamePlayerSession) {
      params.set("token", sessionToken.value);
    }

    const response = await fetch(`/api/v1/solare/overlay?${params.toString()}`);
    const body = await response.json();

    if (!response.ok) {
      searchStatus.value = "error";
      searchErrorMessage.value =
        body?.message || "Player not found in this region.";
      return;
    }

    if (!isSamePlayerSession && sessionToken.value) {
      sessionToken.value = "";
    }

    livePlayerData.value = body;
    searchStatus.value = "found";
    previewRatingOverride.value = null;
    syncSecondsAgo.value = 0;

    if (body.rating !== null && body.rating !== undefined) {
      startingRatingInput.value = Number(body.rating);
    }
    saveStateToStorage();
  } catch {
    searchStatus.value = "error";
    searchErrorMessage.value = "Unable to connect to server.";
  } finally {
    isSearching.value = false;
  }
}

async function handleStartOrResetSession() {
  const targetNick = (
    livePlayerData.value?.user_nickname ||
    familyNameInput.value ||
    ""
  ).trim();
  if (!targetNick) {
    sessionFeedbackIsError.value = true;
    sessionFeedbackMessage.value = "Please enter your Family Name in Step 1.";
    return;
  }

  const rawRating = startingRatingInput.value;
  const hasExplicitRating =
    rawRating !== null &&
    rawRating !== undefined &&
    String(rawRating).trim() !== "" &&
    !Number.isNaN(Number(rawRating));

  if (!hasExplicitRating && !sessionToken.value) {
    sessionFeedbackIsError.value = true;
    sessionFeedbackMessage.value =
      "Please enter your current in-game Starting Rating (PTS) above before starting a session.";
    return;
  }

  isSavingSession.value = true;
  sessionButtonLabel.value = "RESETTING SESSION...";
  sessionFeedbackMessage.value = "";
  sessionFeedbackIsError.value = false;

  try {
    const payload = {
      nick: targetNick,
      region: selectedRegion.value,
    };

    if (hasExplicitRating) {
      payload.rating = Number(rawRating);
    }

    if (sessionToken.value) {
      payload.token = sessionToken.value;
    }

    let response = await fetch("/api/v1/solare/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    let body = await response.json();

    // If stored token no longer exists in DB (e.g. after a DB reset or different player), create a fresh session automatically
    if ((response.status === 404 || response.status === 403) && payload.token) {
      sessionToken.value = "";
      delete payload.token;
      response = await fetch("/api/v1/solare/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      body = await response.json();
    }

    if (!response.ok) {
      sessionFeedbackIsError.value = true;
      sessionFeedbackMessage.value =
        body?.message || "Could not start session. Verify player name.";
      sessionButtonLabel.value = "START / RESET TODAY'S SESSION";
      return;
    }

    sessionToken.value = body.token;
    startingRatingInput.value = Number(body.anchor_rating);
    previewRatingOverride.value = null;
    saveStateToStorage();

    // Refresh overlay data using the newly created/reset session token
    const overlayRes = await fetch(
      `/api/v1/solare/overlay?token=${encodeURIComponent(body.token)}`,
    );
    if (overlayRes.ok) {
      livePlayerData.value = await overlayRes.json();
      searchStatus.value = "found";
      syncSecondsAgo.value = 0;
    }

    sessionButtonLabel.value = `SESSION LIVE (${body.anchor_rating} BASELINE)`;
    sessionFeedbackIsError.value = false;
    sessionFeedbackMessage.value = `Session baseline set to ${body.anchor_rating} PTS. OBS overlay will update within 20s!`;

    setTimeout(() => {
      sessionButtonLabel.value = "START / RESET TODAY'S SESSION";
    }, 3000);
  } catch {
    sessionFeedbackIsError.value = true;
    sessionFeedbackMessage.value = "Network error while starting session.";
    sessionButtonLabel.value = "START / RESET TODAY'S SESSION";
  } finally {
    isSavingSession.value = false;
  }
}

async function copyObsUrl() {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  try {
    if (!sessionToken.value && searchStatus.value === "found") {
      await handleStartOrResetSession();
    }
    await navigator.clipboard.writeText(fullObsUrl.value);
    copiedUrl.value = true;
    setTimeout(() => {
      copiedUrl.value = false;
    }, 2000);
  } catch {
    // Fallback ignored
  }
}

async function copyChatCommand() {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  try {
    if (!sessionToken.value && searchStatus.value === "found") {
      await handleStartOrResetSession();
    }
    await navigator.clipboard.writeText(fullChatCommand.value);
    copiedChatCommand.value = true;
    setTimeout(() => {
      copiedChatCommand.value = false;
    }, 2000);
  } catch {
    // Fallback ignored
  }
}

async function syncDashboardOverlay() {
  if (isSearching.value || isSavingSession.value) return;
  if (!sessionToken.value && searchStatus.value !== "found") return;

  try {
    const params = new URLSearchParams();
    if (sessionToken.value) {
      params.set("token", sessionToken.value);
    } else if (livePlayerData.value?.user_nickname) {
      params.set("nick", livePlayerData.value.user_nickname);
      params.set("region", livePlayerData.value.region || selectedRegion.value);
    } else {
      return;
    }

    const res = await fetch(`/api/v1/solare/overlay?${params.toString()}`);
    if (res.ok) {
      const body = await res.json();
      livePlayerData.value = body;
      if (body.rating !== null && body.rating !== undefined) {
        startingRatingInput.value = Number(body.rating);
      }
    }
  } catch {
    // Silent background sync error ignored
  }
}

onMounted(async () => {
  syncClockInterval = setInterval(() => {
    if (syncSecondsAgo.value >= 20) {
      syncSecondsAgo.value = 1;
      syncDashboardOverlay();
    } else {
      syncSecondsAgo.value += 1;
    }
  }, 1000);

  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.region && regions.includes(saved.region)) {
      selectedRegion.value = saved.region;
    }
    if (saved.nick) {
      familyNameInput.value = saved.nick;
    }
    if (saved.layout === "horizontal" || saved.layout === "vertical") {
      selectedLayout.value = saved.layout;
    }
    if (typeof saved.rating === "number") {
      startingRatingInput.value = saved.rating;
    }
    if (saved.token) {
      sessionToken.value = saved.token;
      const res = await fetch(
        `/api/v1/solare/overlay?token=${encodeURIComponent(saved.token)}`,
      );
      if (res.ok) {
        const body = await res.json();
        livePlayerData.value = body;
        searchStatus.value = "found";
        if (body.rating !== null && body.rating !== undefined) {
          startingRatingInput.value = Number(body.rating);
        }
      } else if (res.status === 404) {
        sessionToken.value = "";
        saveStateToStorage();
      }
    }
  } catch {
    // Ignore storage read errors
  }
});

onUnmounted(() => {
  if (syncClockInterval) {
    clearInterval(syncClockInterval);
  }
});
</script>

<style scoped>
.bdo-panel {
  background: linear-gradient(180deg, #1d1b1a 0%, #151413 100%);
  border: 1px solid #584938;
  box-shadow:
    0 10px 30px -5px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(223, 202, 162, 0.12);
}

.bdo-panel-inner {
  background: #201d1b;
  border: 1px solid #362f27;
}

.gold-gradient-btn {
  background: linear-gradient(180deg, #96774e 0%, #685032 100%);
  border: 1px solid #dfcaa2;
  box-shadow:
    0 4px 14px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transition: all 0.2s ease;
}

.gold-gradient-btn:hover {
  background: linear-gradient(180deg, #aa895a 0%, #795e3c 100%);
  box-shadow:
    0 6px 18px rgba(197, 160, 89, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transform: translateY(-1px);
}

.bg-checkerboard {
  background-color: #161514;
  background-image:
    linear-gradient(45deg, #1c1a19 25%, transparent 25%),
    linear-gradient(-45deg, #1c1a19 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1c1a19 75%),
    linear-gradient(-45deg, transparent 75%, #1c1a19 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0px;
}
</style>

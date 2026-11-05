<template>
  <!-- VERTICAL LAYOUT (Portrait - 340px) -->
  <aside
    v-if="layout === 'vertical'"
    class="w-[340px] min-w-[340px] max-w-[340px] shrink-0 bg-[#181615] rounded text-white overflow-hidden solare-outer-frame shadow-2xl select-none"
    data-purpose="stream-card-overlay-vertical"
  >
    <!-- Header -->
    <header
      class="bg-[#826744] px-3 h-9 flex items-center justify-between text-neutral-100 font-bold border-b border-[#5e492d]"
    >
      <div class="flex items-center gap-2 tracking-wide min-w-0">
        <img
          src="/images/solare/solare-icon-game@4x.png"
          alt="Arena of Solare"
          class="h-6 w-auto object-contain shrink-0"
        />
        <h1 class="text-sm font-black tracking-normal uppercase truncate">
          Arena of Solare
        </h1>
      </div>
      <div
        class="flex items-center gap-2 text-xs font-black tracking-wider shrink-0"
      >
        <span
          class="bg-[#654e30] px-2 py-0.5 rounded text-xs font-black uppercase text-amber-200"
        >
          {{ regionLabel }}
        </span>
        <div
          aria-label="Help"
          class="help-pill inline-flex items-center overflow-hidden rounded transition-all duration-500 ease-out cursor-default leading-none"
          :class="
            activeView === 1
              ? 'bg-[#2a2420]/75 border border-[#dfcaa2]/40 px-1.5 py-0.5 shadow-inner'
              : 'border border-transparent px-0.5 py-0.5'
          "
        >
          <span
            class="transition-colors duration-300 text-sm font-bold leading-none shrink-0"
            :class="
              activeView === 1
                ? 'text-amber-200'
                : 'text-neutral-100 hover:text-yellow-200'
            "
          >
            ?
          </span>
          <span
            class="help-pill-text overflow-hidden whitespace-nowrap font-mono text-[10px] font-black tracking-normal text-[#f1e5d3]"
            :class="
              activeView === 1
                ? 'max-w-[120px] opacity-100 ml-1'
                : 'max-w-0 opacity-0 ml-0'
            "
          >
            {{ siteDomainLabel }}
          </span>
        </div>
        <span
          aria-label="Close"
          class="hover:text-yellow-200 transition-colors cursor-default leading-none text-sm font-bold"
        >
          ✕
        </span>
      </div>
    </header>

    <div class="p-2.5 space-y-2.5">
      <!-- Block 1: Player Profile Card -->
      <section
        class="bg-[#201d1b] rounded solare-inner-border p-2.5 h-[108px] flex items-center gap-3"
        data-purpose="player-profile"
      >
        <div
          class="relative rounded overflow-hidden border border-[#524434] shadow-md flex-shrink-0 w-[68px] h-[88px] bg-black"
        >
          <img
            v-if="portraitUrl && !portraitError"
            :src="portraitUrl"
            :alt="`${nickname} Portrait`"
            class="w-full h-full object-cover object-top"
            @error="portraitError = true"
          />
          <div
            v-else
            class="w-full h-full flex items-center justify-center bg-[#141210] text-[#a3845b] text-xs font-black uppercase"
          >
            {{ className.slice(0, 3) }}
          </div>
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 min-w-0">
            <h2
              class="text-xl font-black tracking-tight text-white leading-tight truncate"
            >
              {{ nickname }}
            </h2>
            <span
              v-if="rankingNumber"
              class="bg-[#302a24] text-[#cfbe9e] text-xs font-black px-2 py-0.5 rounded border border-[#4d4031] shrink-0"
            >
              #{{ rankingNumber }}
            </span>
          </div>
          <p
            class="text-xs font-extrabold text-[#d2c3af] tracking-wide mt-1.5 truncate uppercase"
          >
            {{ regionLabel }} • {{ className }} ({{ skillBranch }})
          </p>
        </div>
      </section>

      <!-- Block 2: Rank, MMR & Overall Winrate -->
      <section
        class="bg-[#201d1b] rounded solare-inner-border p-3 text-center"
        data-purpose="rank-and-winrate"
      >
        <div class="flex justify-center mb-1">
          <div class="w-24 h-24 flex items-center justify-center">
            <img
              :src="tierInfo.badge_url"
              :alt="tierInfo.name"
              class="w-full h-full object-contain drop-shadow"
            />
          </div>
        </div>

        <p
          class="text-xs font-black text-[#ebdcc6] tracking-wider uppercase truncate"
        >
          {{ tierInfo.name }}
        </p>
        <div
          class="text-3xl font-black text-[#f1e5d3] tracking-tighter leading-none mt-1 mb-3 drop-shadow"
        >
          {{ formattedRating }}
        </div>

        <div class="pt-2.5 border-t border-[#362e26]/80 text-xs font-extrabold">
          <div class="flex justify-between items-center text-[#ebdcc6] mb-1.5">
            <span class="tracking-wide">MATCHES: {{ overallTotalGames }}</span>
            <span class="tracking-wide text-white font-black">
              WIN RATE {{ overallWinrateFormatted }}%
            </span>
          </div>

          <div
            class="w-full h-2 bg-[#2d2723] rounded-full overflow-hidden flex shadow-inner"
          >
            <div
              class="h-full bg-[#10b981] transition-all duration-500"
              :style="{ width: `${overallWinBarPercent}%` }"
            />
            <div
              class="h-full bg-[#ef4444] transition-all duration-500"
              :style="{ width: `${100 - overallWinBarPercent}%` }"
            />
          </div>

          <div
            class="flex justify-between items-center mt-1.5 text-xs font-black leading-none"
          >
            <span class="text-[#10b981]">{{ overallWins }}W</span>
            <span class="text-[#ef4444]">{{ overallLosses }}L</span>
          </div>
        </div>
      </section>

      <!-- Block 3: Auto-Rotating Combat Averages <-> Live Session -->
      <section
        class="bg-[#201d1b] rounded solare-inner-border p-2.5 relative overflow-hidden cursor-pointer select-none"
        data-purpose="toggleable-stats-card"
        title="Click to switch view"
        @click="toggleView"
      >
        <div class="relative h-[208px]">
          <!-- VIEW 0: COMBAT AVERAGES -->
          <div
            class="view-card absolute inset-0 flex flex-col justify-between"
            :class="
              activeView === 0
                ? 'view-active'
                : 'view-hidden-left pointer-events-none'
            "
          >
            <div
              class="flex items-center justify-between pb-1.5 border-b border-[#362f27]"
            >
              <h3
                class="text-xs font-black uppercase tracking-wider text-[#ebdcc6]"
              >
                Combat Averages
              </h3>
              <span
                class="bg-[#2a2420] border border-[#483d31] text-amber-100 text-xs font-extrabold px-2 py-0.5 rounded shadow-inner"
              >
                K/D {{ kdRatio }}
              </span>
            </div>

            <div class="grid grid-cols-2 gap-2 text-center my-auto">
              <div class="stat-box rounded py-2 px-1">
                <span
                  class="block text-[11px] uppercase font-extrabold text-[#c2b4a3] tracking-wider mb-0.5"
                >
                  AVG DAMAGE
                </span>
                <span
                  class="block text-xl font-black text-white tracking-tight leading-tight"
                >
                  {{ formatCompactNumber(averages.damage_done) }}
                </span>
              </div>

              <div class="stat-box rounded py-2 px-1">
                <span
                  class="block text-[11px] uppercase font-extrabold text-[#c2b4a3] tracking-wider mb-0.5"
                >
                  DMG TAKEN
                </span>
                <span
                  class="block text-xl font-black text-white tracking-tight leading-tight"
                >
                  {{ formatCompactNumber(averages.damage_taken) }}
                </span>
              </div>

              <div class="stat-box rounded py-2 px-1">
                <span
                  class="block text-[11px] uppercase font-extrabold text-[#c2b4a3] tracking-wider mb-0.5"
                >
                  AVG CC
                </span>
                <span
                  class="block text-xl font-black text-white tracking-tight leading-tight"
                >
                  {{ averages.cc }}
                </span>
              </div>

              <div class="stat-box rounded py-2 px-1">
                <span
                  class="block text-[11px] uppercase font-extrabold text-[#c2b4a3] tracking-wider mb-0.5"
                >
                  AVG HEAL
                </span>
                <span
                  class="block text-xl font-black text-[#10b981] tracking-tight leading-tight"
                >
                  {{ formatCompactNumber(averages.recovery) }}
                </span>
              </div>
            </div>

            <footer
              class="pt-1.5 h-7 flex justify-between items-center text-xs font-bold text-[#d2c3af] px-1 border-t border-[#362f27]/70 whitespace-nowrap"
            >
              <div>
                Kills/Match:
                <strong class="text-white font-black text-xs">
                  {{ averages.kills }}
                </strong>
              </div>
              <div>
                Deaths/Match:
                <strong class="text-white font-black text-xs">
                  {{ averages.deaths }}
                </strong>
              </div>
            </footer>
          </div>

          <!-- VIEW 1: LIVE SESSION -->
          <div
            class="view-card absolute inset-0 flex flex-col justify-between"
            :class="
              activeView === 1
                ? 'view-active'
                : 'view-hidden-right pointer-events-none'
            "
          >
            <div
              class="flex items-center justify-between pb-1.5 border-b border-[#362f27]"
            >
              <div class="flex items-center gap-1.5">
                <span class="relative flex h-2.5 w-2.5">
                  <span
                    class="live-dot-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                  />
                  <span
                    class="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#10b981]"
                  />
                </span>
                <h3
                  class="text-xs font-black uppercase tracking-wider text-[#10b981]"
                >
                  Live Session
                </h3>
              </div>
              <span
                class="bg-[#2a2420] border border-[#483d31] text-[#10b981] text-xs font-extrabold px-2 py-0.5 rounded shadow-inner"
              >
                WIN RATE {{ sessionWinrateFormatted }}%
              </span>
            </div>

            <div class="grid grid-cols-2 gap-2 text-center flex-1 my-2">
              <div
                class="stat-box rounded px-1 flex flex-col items-center justify-center"
              >
                <span
                  class="block text-[11px] uppercase font-extrabold text-[#c2b4a3] tracking-wider mb-1"
                >
                  TODAY RECORD
                </span>
                <div
                  class="text-2xl font-black tracking-tight leading-none flex items-center justify-center gap-1.5"
                >
                  <span class="text-[#10b981]">{{ sessionWins }}W</span>
                  <span class="text-[#635748] text-base font-bold">-</span>
                  <span class="text-[#ef4444]">{{ sessionLosses }}L</span>
                </div>
              </div>

              <div
                class="stat-box rounded px-1 flex flex-col items-center justify-center"
              >
                <span
                  class="block text-[11px] uppercase font-extrabold text-[#c2b4a3] tracking-wider mb-1"
                >
                  NET RATING
                </span>
                <div
                  class="text-2xl font-black tracking-tight leading-none drop-shadow-sm"
                  :class="
                    sessionNetPdl >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'
                  "
                >
                  {{ formattedNetPdl }}
                  <span class="text-xs font-extrabold text-[#cfbe9e]">PTS</span>
                </div>
              </div>
            </div>

            <footer
              class="pt-1.5 h-7 flex items-center justify-between px-1 border-t border-[#362f27]/70 whitespace-nowrap"
            >
              <span
                class="text-[11px] uppercase font-black tracking-wider text-[#ebdcc6] shrink-0"
              >
                LAST 5:
              </span>
              <div
                v-if="recentDeltas.length > 0"
                class="flex items-center gap-1 shrink-0"
              >
                <span
                  v-for="(delta, idx) in recentDeltas"
                  :key="idx"
                  class="text-[11px] font-black px-1.5 py-0.5 rounded leading-none border"
                  :class="
                    delta >= 0
                      ? 'bg-[#10b981]/15 border-[#10b981]/40 text-[#10b981]'
                      : 'bg-[#ef4444]/15 border-[#ef4444]/40 text-[#ef4444]'
                  "
                >
                  {{ delta >= 0 ? `+${delta}` : delta }}
                </span>
              </div>
              <span v-else class="text-[11px] font-bold text-[#948a80]">
                No matches yet
              </span>
            </footer>
          </div>
        </div>

        <!-- Pagination Dots -->
        <div class="flex justify-center items-center gap-1.5 mt-2">
          <button
            type="button"
            aria-label="Go to Combat Averages"
            class="h-1 rounded-full transition-all duration-300"
            :class="
              activeView === 0 ? 'w-4 bg-[#826744]' : 'w-1.5 bg-[#42392f]'
            "
            @click.stop="setView(0)"
          />
          <button
            type="button"
            aria-label="Go to Live Session"
            class="h-1 rounded-full transition-all duration-300"
            :class="
              activeView === 1 ? 'w-4 bg-[#10b981]' : 'w-1.5 bg-[#42392f]'
            "
            @click.stop="setView(1)"
          />
        </div>
      </section>
    </div>
  </aside>

  <!-- HORIZONTAL LAYOUT (Landscape - 790px) -->
  <main
    v-else
    class="w-[790px] max-w-full bg-[#191515] rounded-md overflow-hidden border border-[#524436] golden-frame text-[#ded7ce] shadow-2xl select-none"
    data-purpose="solare-stream-banner-horizontal"
  >
    <!-- Header -->
    <header
      class="bg-[#8c734b] text-[#fbf6ec] h-9 px-3 flex items-center justify-between shadow-sm select-none"
    >
      <div class="flex items-center gap-2.5">
        <img
          src="/images/solare/solare-icon-game@4x.png"
          alt="Arena of Solare"
          class="h-5 w-auto object-contain filter drop-shadow"
        />
        <h1
          class="text-[16px] font-black tracking-wide drop-shadow-sm text-white uppercase"
        >
          Arena of Solare
        </h1>
      </div>

      <div
        class="flex items-center gap-3 text-[14px] font-black text-[#fbf6ec]"
      >
        <span
          class="tracking-wider bg-[#2a2420]/50 border border-[#dfcaa2]/30 px-2 py-0.5 rounded text-[13px]"
        >
          {{ regionLabel }}
        </span>
        <div
          aria-label="Help"
          class="help-pill inline-flex items-center overflow-hidden rounded transition-all duration-500 ease-out cursor-default leading-none"
          :class="
            activeView === 1
              ? 'bg-[#2a2420]/75 border border-[#dfcaa2]/40 px-2 py-0.5 shadow-inner'
              : 'border border-transparent px-0.5 py-0.5 opacity-90 hover:opacity-100'
          "
        >
          <span
            class="transition-colors duration-300 text-[15px] font-bold leading-none shrink-0"
            :class="activeView === 1 ? 'text-[#dfcaa2]' : 'text-[#fbf6ec]'"
          >
            ?
          </span>
          <span
            class="help-pill-text overflow-hidden whitespace-nowrap font-mono text-[12px] font-black tracking-normal text-[#fbf6ec]"
            :class="
              activeView === 1
                ? 'max-w-[150px] opacity-100 ml-1.5'
                : 'max-w-0 opacity-0 ml-0'
            "
          >
            {{ siteDomainLabel }}
          </span>
        </div>
        <span
          class="cursor-default opacity-90 hover:opacity-100 text-[16px] font-bold leading-none"
        >
          ✕
        </span>
      </div>
    </header>

    <!-- Main 3-Column Content Grid -->
    <div class="p-3.5 flex items-stretch gap-4">
      <!-- Column 1: Rank Badge & Solare Rating -->
      <section
        class="flex flex-col items-center justify-between min-w-[145px] pr-3 border-r border-[#383029]/80"
      >
        <div class="flex flex-col items-center justify-center pt-0.5">
          <img
            :src="tierInfo.badge_url"
            :alt="tierInfo.name"
            class="w-[104px] h-[104px] object-contain drop-shadow scale-105"
          />
        </div>
        <div class="text-center w-full mt-1">
          <p
            class="text-[14px] font-extrabold text-[#dfcaa2] tracking-tight leading-tight uppercase"
          >
            {{ tierInfo.name }}
          </p>
          <p
            class="text-[31px] font-black text-white tracking-tight leading-none mt-1"
          >
            {{ formattedRating }}
          </p>
        </div>
      </section>

      <!-- Column 2: Player Profile, Class & Overall Winrate -->
      <section
        class="flex flex-col justify-between flex-grow min-w-[270px] pr-3 border-r border-[#383029]/80"
      >
        <div class="flex items-start gap-3">
          <div
            class="relative rounded-md overflow-hidden border border-[#9b835e] shadow-md bg-[#110e0e] shrink-0 w-[88px] h-[116px]"
          >
            <img
              v-if="portraitUrl && !portraitError"
              :src="portraitUrl"
              :alt="`${nickname} Portrait`"
              class="w-full h-full object-cover object-top"
              @error="portraitError = true"
            />
            <div
              v-else
              class="w-full h-full flex items-center justify-center bg-[#141210] text-[#dfcaa2] text-sm font-black uppercase"
            >
              {{ className.slice(0, 3) }}
            </div>
          </div>

          <div class="pt-0.5 flex flex-col justify-start min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="text-[25px] font-black text-white tracking-tight leading-tight truncate"
              >
                {{ nickname }}
              </span>
              <span
                v-if="rankingNumber"
                class="bg-[#2a2420] text-[#dfcaa2] border border-[#524436] text-[13px] font-black px-2 py-0.5 rounded leading-none shadow-sm"
              >
                #{{ rankingNumber }}
              </span>
            </div>
            <p
              class="text-[13px] font-black text-[#dfcaa2] tracking-wider mt-1 uppercase truncate"
            >
              {{ regionLabel }} • {{ className }} ({{ skillBranch }})
            </p>
          </div>
        </div>

        <div class="mt-2">
          <div
            class="flex justify-between items-end text-[12px] font-bold tracking-tight mb-1 text-[#b5aba0]"
          >
            <span class="text-[#ece2d3] uppercase tracking-wider text-[12px]">
              MATCHES:
              <strong class="text-white font-black text-[13px]">
                {{ overallTotalGames }}
              </strong>
            </span>
            <span class="text-[#ece2d3] uppercase tracking-wider text-[12px]">
              WIN RATE
              <strong class="text-[#10b981] font-black text-[13px]">
                {{ overallWinrateFormatted }}%
              </strong>
            </span>
          </div>

          <div
            class="w-full h-2 bg-[#2a2420] rounded-full overflow-hidden flex shadow-inner"
          >
            <div
              class="bg-[#10b981] h-full transition-all duration-500"
              :style="{ width: `${overallWinBarPercent}%` }"
            />
            <div
              class="bg-[#f43f5e] h-full transition-all duration-500"
              :style="{ width: `${100 - overallWinBarPercent}%` }"
            />
          </div>

          <div
            class="flex justify-between text-[14px] font-black tracking-tight mt-1"
          >
            <span class="text-[#10b981]">{{ overallWins }}W</span>
            <span class="text-[#f43f5e]">{{ overallLosses }}L</span>
          </div>
        </div>
      </section>

      <!-- Column 3: Dynamic Rotation (Combat Averages <-> Live Session) -->
      <section
        class="relative w-[280px] shrink-0 h-[166px] overflow-hidden cursor-pointer select-none"
        title="Click to switch view"
        @click="toggleView"
      >
        <!-- View 0: Combat Averages -->
        <div
          class="absolute inset-0 flex flex-col justify-between pb-3 transition-all duration-500 ease-in-out"
          :class="
            activeView === 0
              ? 'opacity-100 translate-x-0 pointer-events-auto'
              : 'opacity-0 -translate-x-4 pointer-events-none'
          "
        >
          <div class="flex items-center justify-between pb-1">
            <h2
              class="text-[12px] font-black text-[#dfcaa2] tracking-wider uppercase"
            >
              COMBAT AVERAGES
            </h2>
            <span
              class="bg-[#241e1b] border border-[#524436] text-white text-[12px] font-black px-2 py-0.5 rounded shadow-sm"
            >
              K/D {{ kdRatio }}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-1.5 my-0.5">
            <div
              class="bg-[#211b19] border border-[#362e27] rounded px-2 py-1 flex flex-col justify-center shadow-sm"
            >
              <span
                class="text-[11px] font-extrabold text-[#c9beb0] uppercase tracking-wider leading-none"
              >
                AVG DAMAGE
              </span>
              <span
                class="text-[20px] font-black text-white tracking-tight leading-tight mt-0.5"
              >
                {{ formatCompactNumber(averages.damage_done) }}
              </span>
            </div>

            <div
              class="bg-[#211b19] border border-[#362e27] rounded px-2 py-1 flex flex-col justify-center shadow-sm"
            >
              <span
                class="text-[11px] font-extrabold text-[#c9beb0] uppercase tracking-wider leading-none"
              >
                DMG TAKEN
              </span>
              <span
                class="text-[20px] font-black text-white tracking-tight leading-tight mt-0.5"
              >
                {{ formatCompactNumber(averages.damage_taken) }}
              </span>
            </div>

            <div
              class="bg-[#211b19] border border-[#362e27] rounded px-2 py-1 flex flex-col justify-center shadow-sm"
            >
              <span
                class="text-[11px] font-extrabold text-[#c9beb0] uppercase tracking-wider leading-none"
              >
                AVG CC
              </span>
              <span
                class="text-[20px] font-black text-white tracking-tight leading-tight mt-0.5"
              >
                {{ averages.cc }}
              </span>
            </div>

            <div
              class="bg-[#211b19] border border-[#362e27] rounded px-2 py-1 flex flex-col justify-center shadow-sm"
            >
              <span
                class="text-[11px] font-extrabold text-[#c9beb0] uppercase tracking-wider leading-none"
              >
                AVG HEAL
              </span>
              <span
                class="text-[20px] font-black text-[#10b981] tracking-tight leading-tight mt-0.5"
              >
                {{ formatCompactNumber(averages.recovery) }}
              </span>
            </div>
          </div>

          <div
            class="flex items-center justify-between text-[12px] font-bold text-[#dfcaa2] pt-0.5"
          >
            <span>
              Kills/Match:
              <strong class="text-white font-black text-[13px]">
                {{ averages.kills }}
              </strong>
            </span>
            <span>
              Deaths/Match:
              <strong class="text-white font-black text-[13px]">
                {{ averages.deaths }}
              </strong>
            </span>
          </div>
        </div>

        <!-- View 1: Live Session -->
        <div
          class="absolute inset-0 flex flex-col justify-between pb-3 transition-all duration-500 ease-in-out"
          :class="
            activeView === 1
              ? 'opacity-100 translate-x-0 pointer-events-auto'
              : 'opacity-0 translate-x-4 pointer-events-none'
          "
        >
          <div class="flex items-center justify-between pb-1">
            <div class="flex items-center gap-1.5">
              <span class="relative flex h-2 w-2">
                <span
                  class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                />
                <span
                  class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_6px_#10b981]"
                />
              </span>
              <h2
                class="text-[12px] font-black text-[#dfcaa2] tracking-wider uppercase"
              >
                LIVE SESSION
              </h2>
            </div>
            <span
              class="bg-[#241e1b] border border-[#483d34] text-[#10b981] text-[12px] font-black px-2 py-0.5 rounded shadow-sm"
            >
              WIN RATE {{ sessionWinrateFormatted }}%
            </span>
          </div>

          <div class="grid grid-cols-2 gap-1.5 my-0.5">
            <div
              class="bg-[#211b19] border border-[#362e27] rounded px-2 py-1.5 flex flex-col justify-between shadow-sm"
            >
              <span
                class="text-[11px] font-extrabold text-[#c9beb0] uppercase tracking-wider leading-none"
              >
                TODAY RECORD
              </span>
              <div class="flex items-baseline gap-1 mt-1">
                <span
                  class="text-[20px] font-black text-[#10b981] tracking-tight leading-tight"
                >
                  {{ sessionWins }}W
                </span>
                <span class="text-[14px] font-bold text-[#63574c]">-</span>
                <span
                  class="text-[20px] font-black text-[#f43f5e] tracking-tight leading-tight"
                >
                  {{ sessionLosses }}L
                </span>
              </div>
            </div>

            <div
              class="bg-[#211b19] border border-[#362e27] rounded px-2 py-1.5 flex flex-col justify-between shadow-sm"
            >
              <span
                class="text-[11px] font-extrabold text-[#c9beb0] uppercase tracking-wider leading-none"
              >
                NET RATING
              </span>
              <div class="flex items-baseline gap-1 mt-1">
                <span
                  class="text-[20px] font-black tracking-tight leading-tight"
                  :class="
                    sessionNetPdl >= 0
                      ? 'text-[#10b981] drop-shadow-[0_0_8px_rgba(16,185,129,0.35)]'
                      : 'text-[#f43f5e] drop-shadow-[0_0_8px_rgba(244,63,94,0.35)]'
                  "
                >
                  {{ formattedNetPdl }}
                </span>
                <span
                  class="text-[12px] font-extrabold text-[#dfcaa2] tracking-wider"
                >
                  PTS
                </span>
              </div>
            </div>
          </div>

          <div
            class="flex items-center justify-between text-[12px] font-bold text-[#dfcaa2] pt-0.5"
          >
            <span
              class="text-[11px] font-black uppercase tracking-wider text-[#dfcaa2]"
            >
              LAST 5:
            </span>
            <div v-if="recentDeltas.length > 0" class="flex items-center gap-1">
              <span
                v-for="(delta, idx) in recentDeltas"
                :key="idx"
                class="text-[11px] font-black px-1.5 py-0.5 rounded leading-none shadow-sm border"
                :class="
                  delta >= 0
                    ? 'bg-[#10b981]/20 border-[#10b981]/60 text-[#10b981]'
                    : 'bg-[#f43f5e]/20 border-[#f43f5e]/60 text-[#f43f5e]'
                "
              >
                {{ delta >= 0 ? `+${delta}` : delta }}
              </span>
            </div>
            <span v-else class="text-[11px] font-bold text-[#9a8f85]">
              No matches yet
            </span>
          </div>
        </div>

        <!-- Pagination Dots -->
        <div
          class="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1.5 pb-0.5"
        >
          <button
            type="button"
            aria-label="Go to Combat Averages"
            class="h-1 rounded-full transition-all duration-300"
            :class="
              activeView === 0 ? 'w-3 bg-[#dfcaa2]' : 'w-1.5 bg-[#4a3f36]'
            "
            @click.stop="setView(0)"
          />
          <button
            type="button"
            aria-label="Go to Live Session"
            class="h-1 rounded-full transition-all duration-300"
            :class="
              activeView === 1 ? 'w-3 bg-[#dfcaa2]' : 'w-1.5 bg-[#4a3f36]'
            "
            @click.stop="setView(1)"
          />
        </div>
      </section>
    </div>
  </main>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import {
  getTierInfo,
  getClassName,
  getSkillBranch,
} from "~/utils/solareTier.js";

const props = defineProps({
  data: {
    type: Object,
    required: true,
  },
  layout: {
    type: String,
    default: "vertical",
  },
  autoRotateMs: {
    type: Number,
    default: 10000,
  },
});

const activeView = ref(1);
const portraitError = ref(false);
let rotationTimer = null;

watch(
  () => props.data?.class_type,
  () => {
    portraitError.value = false;
  },
);

const regionLabel = computed(() =>
  String(props.data?.region || "SA").toUpperCase(),
);

const siteDomainLabel = computed(() => {
  if (typeof window !== "undefined" && window.location?.host) {
    const host = window.location.host.replace(/^www\./i, "");
    if (
      !host.startsWith("localhost") &&
      !host.startsWith("127.0.0.1") &&
      !host.endsWith(".vercel.app")
    ) {
      return host;
    }
  }
  return "down-attack.com";
});

const nickname = computed(
  () => props.data?.user_nickname || props.data?.nickname || "Unknown",
);

const rankingNumber = computed(
  () => props.data?.current_ranking ?? props.data?.ranking ?? null,
);

const classType = computed(
  () => props.data?.class_type ?? props.data?.character?.class_id ?? 0,
);

const skillBranchType = computed(() => props.data?.skill_branch_type ?? 1);

const className = computed(() => getClassName(classType.value));

const skillBranch = computed(
  () =>
    props.data?.character?.skill_branch ||
    getSkillBranch(classType.value, skillBranchType.value),
);

const portraitUrl = computed(() => {
  if (props.data?.character?.portrait_url) {
    return props.data.character.portrait_url;
  }
  if (classType.value !== null && classType.value !== undefined) {
    return `/images/solare/classes/${classType.value}.jpg`;
  }
  return "";
});

const ratingValue = computed(() => {
  if (props.data?.rating !== null && props.data?.rating !== undefined) {
    return Number(props.data.rating);
  }
  if (props.data?.tier?.rating !== undefined) {
    return Number(props.data.tier.rating);
  }
  return 0;
});

const tierInfo = computed(() =>
  getTierInfo(ratingValue.value, rankingNumber.value),
);

const formattedRating = computed(() => {
  if (props.data?.rating === null && !props.data?.tier?.rating) {
    return "—";
  }
  return ratingValue.value.toLocaleString("en-US");
});

const overallWins = computed(() =>
  Number(props.data?.overall?.wins ?? props.data?.history?.wins ?? 0),
);

const overallLosses = computed(() =>
  Number(props.data?.overall?.losses ?? props.data?.history?.losses ?? 0),
);

const overallTotalGames = computed(() =>
  Number(
    props.data?.overall?.total_games ??
      props.data?.history?.matches ??
      overallWins.value + overallLosses.value,
  ),
);

const overallWinrate = computed(() => {
  if (props.data?.overall?.winrate !== undefined) {
    return Number(props.data.overall.winrate);
  }
  if (overallTotalGames.value === 0) return 0;
  return Number(
    ((overallWins.value / overallTotalGames.value) * 100).toFixed(1),
  );
});

const overallWinrateFormatted = computed(() => overallWinrate.value.toFixed(1));

const overallWinBarPercent = computed(() => {
  if (overallTotalGames.value === 0) return 50;
  return Math.min(100, Math.max(0, overallWinrate.value));
});

const averages = computed(() => ({
  damage_done: Number(props.data?.averages?.damage_done ?? 0),
  damage_taken: Number(props.data?.averages?.damage_taken ?? 0),
  cc: Number(props.data?.averages?.cc ?? props.data?.averages?.cc_applied ?? 0),
  recovery: Number(props.data?.averages?.recovery ?? 0),
  kills: Number(props.data?.averages?.kills ?? 0),
  deaths: Number(props.data?.averages?.deaths ?? 0),
}));

const kdRatio = computed(() => {
  const k = averages.value.kills;
  const d = averages.value.deaths;
  if (d <= 0) return k.toFixed(2);
  return (k / d).toFixed(2);
});

const sessionWins = computed(() => Number(props.data?.session?.wins ?? 0));
const sessionLosses = computed(() => Number(props.data?.session?.losses ?? 0));
const sessionNetPdl = computed(() => Number(props.data?.session?.net_pdl ?? 0));
const formattedNetPdl = computed(() =>
  sessionNetPdl.value >= 0
    ? `+${sessionNetPdl.value}`
    : `${sessionNetPdl.value}`,
);

const sessionWinrateFormatted = computed(() => {
  const total = sessionWins.value + sessionLosses.value;
  if (total === 0) return "0.0";
  return ((sessionWins.value / total) * 100).toFixed(1);
});

const recentDeltas = computed(() =>
  Array.isArray(props.data?.session?.recent_deltas)
    ? props.data.session.recent_deltas.slice(0, 5)
    : [],
);

function formatCompactNumber(value) {
  const num = Number(value) || 0;
  if (num >= 1000) {
    return `${Math.round(num / 1000)}K`;
  }
  return String(num);
}

function setView(index) {
  activeView.value = index;
  resetTimer();
}

function toggleView() {
  activeView.value = activeView.value === 0 ? 1 : 0;
  resetTimer();
}

function resetTimer() {
  if (rotationTimer) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
  if (props.autoRotateMs > 0) {
    rotationTimer = setInterval(() => {
      activeView.value = activeView.value === 0 ? 1 : 0;
    }, props.autoRotateMs);
  }
}

onMounted(() => {
  resetTimer();
});

onUnmounted(() => {
  if (rotationTimer) {
    clearInterval(rotationTimer);
  }
});
</script>

<style scoped>
.solare-outer-frame {
  border: 1px solid #584938;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.85);
}

.solare-inner-border {
  border: 1px solid #362f27;
}

.stat-box {
  background: linear-gradient(180deg, #24201e 0%, #1a1817 100%);
  border: 1px solid #3d352c;
}

.golden-frame {
  box-shadow:
    inset 0 0 0 1px rgba(223, 202, 162, 0.25),
    0 12px 30px rgba(0, 0, 0, 0.85);
}

.view-card {
  transition:
    opacity 0.4s ease,
    transform 0.4s ease;
}

.view-active {
  opacity: 1;
  transform: translateX(0);
}

.view-hidden-left {
  opacity: 0;
  transform: translateX(-16px);
}

.view-hidden-right {
  opacity: 0;
  transform: translateX(16px);
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(1.2);
  }
}

.live-dot-pulse {
  animation: live-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.help-pill-text {
  transition:
    max-width 0.45s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.35s ease,
    margin-left 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}
</style>

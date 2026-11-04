<template>
  <div class="min-h-screen bg-[#222122] text-[#ffedd4] flex flex-col">
    <header class="w-full">
      <!-- 1st Row: Upper Bronze Bar (Title & Active Tab Icon) -->
      <div class="w-full bg-[#775d3a] px-4 h-8 flex items-center space-x-2">
        <span
          class="w-6 h-6 shrink-0 bg-[#ffedd4] inline-block transition-colors"
          :style="{
            mask: `url(${currentTab.icon}) no-repeat center / contain`,
            WebkitMask: `url(${currentTab.icon}) no-repeat center / contain`,
          }"
        />
        <span class="font-semibold text-sm text-[#ffedd4] whitespace-nowrap">
          {{ currentTab.name }}
        </span>

        <div
          v-if="!authIsLoading"
          class="flex-1 bg-[#775d3a] justify-end h-8 flex items-center space-x-2"
        >
          <button
            v-if="!isAuthenticated"
            type="button"
            class="flex items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity"
            @click="login"
          >
            <span
              class="w-6 h-6 bg-[#ffedd4] inline-block transition-colors"
              :style="{
                mask: `url(/icons/discord_login.png) no-repeat center / contain`,
                WebkitMask: `url(/icons/discord_login.png) no-repeat center / contain`,
              }"
            />
            <span class="font-semibold text-sm text-[#ffedd4]"> Login </span>
          </button>

          <div v-else class="relative group flex items-center">
            <img
              :src="avatarUrl"
              alt="User Avatar"
              class="w-7 h-7 rounded-full cursor-pointer border border-[#ffedd4]/40"
            />

            <div
              class="absolute right-0 top-full pt-1 hidden group-hover:block z-50"
            >
              <button
                type="button"
                class="bg-[#323134] border border-[#ffedd4]/20 text-[#ffedd4] hover:text-[#d7ad70] text-xs font-semibold px-3 py-1.5 rounded shadow-lg whitespace-nowrap"
                @click="logout"
              >
                Logout
              </button>
            </div>
          </div>
          <a
            type="button"
            class="text-[#f5ebd9]/70 hover:text-[#d7ad70] text-sm font-bold w-6 h-6 flex items-center justify-center transition-colors cursor-pointer"
            title="Close"
            href="/"
          >
            ✕
          </a>
        </div>
      </div>

      <!-- 2nd Row: Dark Bar with Centered Icons & Reactive Colors -->
      <div
        class="w-full bg-[#323134] px-4 h-10 flex justify-center items-center space-x-3"
      >
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.id"
          :to="tab.path"
          class="relative h-full px-3 transition-all focus:outline-none flex items-center justify-center group"
          :title="tab.name"
        >
          <!-- Icon changing color reactively using CSS Mask -->
          <span
            class="w-6 h-6 inline-block transition-colors duration-200"
            :class="
              activeTab === tab.id
                ? 'bg-[#ffedd4]'
                : 'bg-[#5d5856] group-hover:bg-[#ffedd4]/70'
            "
            :style="{
              mask: `url(${tab.icon}) no-repeat center / contain`,
              WebkitMask: `url(${tab.icon}) no-repeat center / contain`,
            }"
          />
          <span
            v-if="activeTab === tab.id"
            class="absolute bottom-0 inset-x-0 h-0.5 bg-[#ffedd4]"
          />
        </NuxtLink>
      </div>
    </header>

    <main class="flex-1">
      <slot />
    </main>

    <!-- BEGIN: SiteFooter -->
    <footer
      class="w-full bg-[#141517] text-[#cfd2dc]"
      data-purpose="site-footer"
    >
      <div class="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 py-12 lg:py-16">
        <!-- Primary Navigation Grid: Features, Community, and Legal -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-10 lg:gap-16 pb-12">
          <!-- BEGIN: FeaturesColumn -->
          <div class="flex flex-col space-y-4" data-purpose="features-column">
            <h3
              class="text-xs font-semibold tracking-wider text-[#848895] uppercase"
            >
              Features
            </h3>
            <ul class="space-y-3.5">
              <li>
                <NuxtLink
                  to="/solare"
                  class="group inline-flex items-center gap-3 text-[14px] text-[#cfd2dc] hover:text-white transition-colors duration-150"
                >
                  <span
                    class="w-4 h-4 bg-[#848895] group-hover:bg-white transition-colors duration-150 shrink-0 inline-block"
                    :style="{
                      mask: `url(/icons/overlay.png) no-repeat center / contain`,
                      WebkitMask: `url(/icons/overlay.png) no-repeat center / contain`,
                    }"
                  />
                  <span>Arena of Solare Search</span>
                </NuxtLink>
              </li>
              <li>
                <NuxtLink
                  to="/solare/overlay"
                  class="group inline-flex items-center gap-3 text-[14px] text-[#cfd2dc] hover:text-white transition-colors duration-150"
                >
                  <span
                    class="w-4 h-4 bg-[#848895] group-hover:bg-white transition-colors duration-150 shrink-0 inline-block"
                    :style="{
                      mask: `url(/icons/overlay.png) no-repeat center / contain`,
                      WebkitMask: `url(/icons/overlay.png) no-repeat center / contain`,
                    }"
                  />
                  <span>Arena of Solare Overlay</span>
                </NuxtLink>
              </li>
              <li>
                <NuxtLink
                  to="/calculator"
                  class="group inline-flex items-center gap-3 text-[14px] text-[#cfd2dc] hover:text-white transition-colors duration-150"
                >
                  <span
                    class="w-4 h-4 bg-[#848895] group-hover:bg-white transition-colors duration-150 shrink-0 inline-block"
                    :style="{
                      mask: `url(/icons/sword.png) no-repeat center / contain`,
                      WebkitMask: `url(/icons/sword.png) no-repeat center / contain`,
                    }"
                  />
                  <span>Calculator</span>
                </NuxtLink>
              </li>
            </ul>
          </div>
          <!-- END: FeaturesColumn -->

          <!-- BEGIN: CommunityColumn -->
          <div class="flex flex-col space-y-4" data-purpose="community-column">
            <h3
              class="text-xs font-semibold tracking-wider text-[#848895] uppercase"
            >
              Community
            </h3>
            <ul class="space-y-3.5">
              <li>
                <a
                  href="https://discord.gg/kNYvABEHJ3"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="group inline-flex items-center gap-3 text-[14px] text-[#cfd2dc] hover:text-white transition-colors duration-150"
                >
                  <span
                    class="w-4 h-4 bg-[#848895] group-hover:bg-white transition-colors duration-150 shrink-0 inline-block"
                    :style="{
                      mask: `url(/icons/discord.png) no-repeat center / contain`,
                      WebkitMask: `url(/icons/discord.png) no-repeat center / contain`,
                    }"
                  />
                  <span>Discord</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/ZelsL/down_attack"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="group inline-flex items-center gap-3 text-[14px] text-[#cfd2dc] hover:text-white transition-colors duration-150"
                >
                  <span
                    class="w-4 h-4 bg-[#848895] group-hover:bg-white transition-colors duration-150 shrink-0 inline-block"
                    :style="{
                      mask: `url(/icons/github.svg) no-repeat center / contain`,
                      WebkitMask: `url(/icons/github.svg) no-repeat center / contain`,
                    }"
                  />
                  <span>GitHub</span>
                </a>
              </li>
            </ul>
          </div>
          <!-- END: CommunityColumn -->

          <!-- BEGIN: LegalColumn -->
          <div class="flex flex-col space-y-4" data-purpose="legal-column">
            <h3
              class="text-xs font-semibold tracking-wider text-[#848895] uppercase"
            >
              Legal
            </h3>
            <ul class="space-y-3.5">
              <li>
                <NuxtLink
                  to="/terms"
                  class="text-[14px] text-[#cfd2dc] hover:text-white transition-colors duration-150 block"
                >
                  Terms of Service
                </NuxtLink>
              </li>
              <li>
                <NuxtLink
                  to="/privacy"
                  class="text-[14px] text-[#cfd2dc] hover:text-white transition-colors duration-150 block"
                >
                  Privacy Policy
                </NuxtLink>
              </li>
            </ul>
          </div>
          <!-- END: LegalColumn -->
        </div>

        <!-- BEGIN: BottomBar (Copyright Disclaimer & Subtle Social Badges) -->
        <div
          class="pt-6 border-t border-[#23252a] flex flex-col md:flex-row items-center justify-between gap-4"
          data-purpose="footer-bottom-bar"
        >
          <!-- Left: Legal Disclaimer -->
          <p class="text-[13px] text-[#848895] text-center md:text-left">
            Down Attack is not affiliated with Pearl Abyss or Black Desert
            Online. © 2026 Down Attack
          </p>

          <!-- Right: Subtle Quick Social Icons -->
          <div class="flex items-center space-x-4 text-[#848895]">
            <a
              aria-label="Discord"
              class="group hover:text-white transition-colors duration-150 flex items-center"
              href="https://discord.gg/kNYvABEHJ3"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span
                class="w-4 h-4 bg-[#848895] group-hover:bg-white transition-colors duration-150 inline-block"
                :style="{
                  mask: `url(/icons/discord.png) no-repeat center / contain`,
                  WebkitMask: `url(/icons/discord.png) no-repeat center / contain`,
                }"
              />
            </a>
            <a
              aria-label="GitHub"
              class="group hover:text-white transition-colors duration-150 flex items-center"
              href="https://github.com/ZelsL/down_attack"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span
                class="w-4 h-4 bg-[#848895] group-hover:bg-white transition-colors duration-150 inline-block"
                :style="{
                  mask: `url(/icons/github.svg) no-repeat center / contain`,
                  WebkitMask: `url(/icons/github.svg) no-repeat center / contain`,
                }"
              />
            </a>
          </div>
        </div>
        <!-- END: BottomBar -->
      </div>
    </footer>
    <!-- END: SiteFooter -->
  </div>
</template>

<script setup>
import { computed, onMounted } from "vue";

const { fetchUser, isAuthenticated, avatarUrl, login, logout, authIsLoading } =
  useAuth();

onMounted(() => {
  fetchUser();
});

const route = useRoute();
const customHeader = useHeader();

// Application tabs list
const tabs = [
  {
    id: "home",
    name: "Home",
    icon: "/icons/home.png",
    path: "/",
  },
  {
    id: "calculator",
    name: "Calculator",
    icon: "/icons/sword.png",
    path: "/calculator",
  },
  {
    id: "solare",
    name: "Arena of Solare",
    icon: "/icons/overlay.png",
    path: "/solare",
  },
  {
    id: "discord",
    name: "Discord",
    icon: "/icons/discord.png",
    path: "https://discord.gg/kNYvABEHJ3",
  },
  {
    id: "github",
    name: "GitHub",
    icon: "/icons/github.svg",
    path: "https://github.com/ZelsL/down_attack",
  },
];

// Dynamically compute the active tab based on route path
const activeTab = computed(() => {
  if (route.path.startsWith("/calculator")) {
    return "calculator";
  }
  if (route.path.startsWith("/solare")) {
    return "solare";
  }
  if (route.path === "/") {
    return "home";
  }
  return "";
});

// Dynamically compute the active tab data for the upper bar
const currentTab = computed(() => {
  if (
    customHeader.value &&
    (customHeader.value.name || customHeader.value.icon)
  ) {
    return {
      name: customHeader.value.name || "",
      icon: customHeader.value.icon || "",
    };
  }

  if (route.meta?.header) {
    return {
      name: route.meta.header.name || "",
      icon: route.meta.header.icon || "",
    };
  }

  return tabs.find((t) => t.id === activeTab.value) || tabs[0];
});
</script>

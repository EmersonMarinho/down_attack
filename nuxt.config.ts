import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join, dirname } from "node:path";

const require = createRequire(import.meta.url);

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: ["@nuxt/eslint", "@nuxt/icon"],
  nitro: {
    preset: "vercel",
  },
  hooks: {
    "nitro:init"(nitro) {
      nitro.hooks.hook("compiled", () => {
        // 1. Copia as migrations para a Serverless Function
        const srcMigrations = resolve("infra", "migrations");
        const destMigrations = join(
          nitro.options.output.serverDir,
          "infra",
          "migrations",
        );
        cpSync(srcMigrations, destMigrations, { recursive: true });

        // 2. Copia babel.cjs do jiti (carregado dinamicamente em runtime pelo node-pg-migrate)
        const jitiPkg = require.resolve("jiti/package.json");
        const babelSrc = join(dirname(jitiPkg), "dist", "babel.cjs");
        const jitiDest = join(
          nitro.options.output.serverDir,
          "node_modules",
          "jiti",
          "dist",
        );
        mkdirSync(jitiDest, { recursive: true });
        cpSync(babelSrc, join(jitiDest, "babel.cjs"));
      });
    },
  },
  app: {
    head: {
      htmlAttrs: {
        lang: "en",
      },
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "theme-color", content: "#1e1d1e" },
        {
          name: "description",
          content:
            "Free Black Desert Online (BDO) PvP Damage & Combo Calculator with Effective HP (HPE) curves, Garmoth build import, and live Arena of Solare OBS stream overlay. Calculadora de dano PvP e overlay de Solare para BDO.",
        },
        {
          name: "keywords",
          content:
            "BDO PvP Calculator, Black Desert Online Damage Calculator, Calculadora BDO, Calculadora de Dano BDO, BDO Arena of Solare Overlay, Overlay Solare BDO, BDO OBS Overlay, BDO Effective HP, BDO Combo Builder, Garmoth Import, Down Attack",
        },
        { property: "og:site_name", content: "Down Attack" },
        { property: "og:type", content: "website" },
        {
          property: "og:image",
          content: "/images/solare/solare-icon-game@4x.png",
        },
        { name: "twitter:card", content: "summary" },
      ],
      link: [
        { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossorigin: "",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap",
        },
      ],
      script: [
        // Shows the skill details (tooltip) when hovering Bdolytics links
        { src: "https://bdolytics.com/tooltip/script.js", async: true },
      ],
    },
  },
  css: ["~/assets/css/main.css"],
  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },
});

<template>
  <section v-if="groups.length" class="solare-gear-card">
    <header class="solare-gear-header">
      <span class="solare-gear-title">GEAR</span>
      <span v-if="title" class="solare-gear-subtitle">{{ title }}</span>
      <span v-if="source" class="solare-gear-source">{{ source }}</span>
    </header>

    <div class="solare-gear-groups">
      <div v-for="group in groups" :key="group.key" class="solare-gear-group">
        <span class="solare-gear-group-label">{{ group.label }}</span>
        <div class="solare-gear-row">
          <div
            v-for="slot in group.slots"
            :key="slot.key"
            class="solare-gear-slot"
          >
            <div
              class="solare-gear-item"
              :title="`${slot.label}: ${slot.name}`"
            >
              <img
                v-if="slot.icon"
                :src="slot.icon"
                :alt="slot.name"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div v-if="slot.crystals.length" class="solare-gear-crystals">
              <div
                v-for="(crystal, index) in slot.crystals"
                :key="index"
                class="solare-gear-crystal"
                :class="{ 'is-empty': !crystal.icon }"
                :title="crystal.name"
              >
                <img
                  v-if="crystal.icon"
                  :src="crystal.icon"
                  :alt="crystal.name"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="crystalSets.length" class="solare-gear-group">
        <span class="solare-gear-group-label">CRYSTALS</span>
        <div class="solare-gear-sets">
          <div
            v-for="set in crystalSets"
            :key="set.id"
            class="solare-gear-set"
            :title="`${set.name} (set effect active in this match)`"
          >
            <img v-if="set.icon" :src="set.icon" :alt="set.name" />
            <span>{{ set.label }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import {
  buildSolareGearGroups,
  getSolareCrystalSetLabel,
} from "~/utils/solareGear.js";

const props = defineProps({
  // 14 entries of [itemId, crystal1?, crystal2?] (see SOLARE_GEAR_SLOTS)
  gear: { type: Array, default: () => [] },
  // Combined crystal set effects found in the replay: [{ crystal_id, tier }]
  sets: { type: Array, default: () => [] },
  title: { type: String, default: "" },
  source: { type: String, default: "" },
});

const groups = computed(() => buildSolareGearGroups(props.gear));
const crystalSets = computed(() =>
  (props.sets || []).map(getSolareCrystalSetLabel),
);
</script>

<style scoped>
.solare-gear-card {
  background: #16171b;
  border: 1px solid #26272c;
  border-radius: 10px;
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.solare-gear-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.solare-gear-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #9a9aa3;
}

.solare-gear-subtitle {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
  color: #ece7df;
}

.solare-gear-source {
  margin-left: auto;
  font-size: 11px;
  color: #7d7e86;
}

.solare-gear-sets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.solare-gear-set {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 10px 0 6px;
  border: 1px solid #34353b;
  border-radius: 6px;
  background: #1b1c21;
  font-size: 12px;
  color: #d4af6a;
  white-space: nowrap;
}

.solare-gear-set img {
  width: 26px;
  height: 26px;
  object-fit: contain;
}

.solare-gear-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 18px 36px;
}

.solare-gear-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.solare-gear-group-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #6f7078;
}

.solare-gear-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.solare-gear-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.solare-gear-item {
  width: 44px;
  height: 44px;
  border: 1px solid #c9a24a;
  border-radius: 6px;
  background: radial-gradient(circle at 50% 35%, #2a2b31 0%, #18191d 75%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
  transition:
    transform 0.15s ease,
    border-color 0.15s ease;
}

.solare-gear-item:hover {
  transform: translateY(-1px);
  border-color: #e6c172;
}

.solare-gear-item img {
  width: 38px;
  height: 38px;
  object-fit: contain;
}

.solare-gear-crystals {
  display: flex;
  gap: 3px;
}

.solare-gear-crystal {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: #1d1e23;
  border: 1px solid #2f3036;
  display: flex;
  align-items: center;
  justify-content: center;
}

.solare-gear-crystal img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.solare-gear-crystal.is-empty {
  border-style: dashed;
}

@media (max-width: 640px) {
  .solare-gear-groups {
    gap: 14px;
  }
  .solare-gear-row {
    gap: 6px;
  }
  .solare-gear-item {
    width: 40px;
    height: 40px;
  }
  .solare-gear-item img {
    width: 34px;
    height: 34px;
  }
}
</style>

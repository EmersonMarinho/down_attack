<template>
  <div v-if="slots.length" class="solare-gear-strip">
    <template v-for="(group, index) in groups" :key="group.key">
      <span v-if="index > 0" class="solare-gear-strip-sep" />
      <div
        v-for="slot in group.slots"
        :key="slot.key"
        class="solare-gear-strip-item"
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
    </template>
    <div
      v-for="set in crystalSets"
      :key="set.id"
      class="solare-gear-strip-set"
      :title="`${set.name} (set effect active in this match)`"
    >
      <img v-if="set.icon" :src="set.icon" :alt="set.name" loading="lazy" />
      <span>{{ set.label }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  buildSolareGearGroups,
  getSolareCrystalSetLabel,
} from "~/utils/solareGear.js";

const props = defineProps({
  gear: { type: Array, default: () => [] },
  sets: { type: Array, default: () => [] },
});

const groups = computed(() => buildSolareGearGroups(props.gear));
const slots = computed(() => groups.value.flatMap((g) => g.slots));
const crystalSets = computed(() =>
  (props.sets || []).map(getSolareCrystalSetLabel),
);
</script>

<style scoped>
.solare-gear-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}

.solare-gear-strip-item {
  width: 26px;
  height: 26px;
  border: 1px solid rgba(201, 162, 74, 0.7);
  border-radius: 4px;
  background: #18191d;
  display: flex;
  align-items: center;
  justify-content: center;
}

.solare-gear-strip-item img {
  width: 22px;
  height: 22px;
  object-fit: contain;
}

.solare-gear-strip-sep {
  width: 6px;
}

.solare-gear-strip-set {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  margin-left: 6px;
  padding: 0 6px 0 3px;
  border: 1px solid #34353b;
  border-radius: 4px;
  background: #1b1c21;
  font-size: 11px;
  color: #d4af6a;
  white-space: nowrap;
}

.solare-gear-strip-set img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
</style>

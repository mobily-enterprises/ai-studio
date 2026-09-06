<template>
  <BaseEdge
    :id="id"
    :interaction-width="interactionWidth"
    :label="label"
    :label-bg-border-radius="labelBgBorderRadius"
    :label-bg-padding="labelBgPadding"
    :label-bg-style="labelBgStyle"
    :label-show-bg="labelShowBg"
    :label-style="labelStyle"
    :label-x="edgePath[1]"
    :label-y="edgePath[2]"
    :marker-end="markerEnd"
    :marker-start="markerStart"
    :path="edgePath[0]"
    :style="style"
  />
</template>

<script setup>
import { computed } from "vue";
import { BaseEdge } from "@vue-flow/core";

import { createErdOrthogonalPath } from "../erdRelationships.js";

const props = defineProps({
  data: {
    default: () => ({}),
    type: Object
  },
  id: {
    required: true,
    type: String
  },
  interactionWidth: {
    default: 20,
    type: Number
  },
  label: {
    default: "",
    type: [String, Object]
  },
  labelBgBorderRadius: {
    default: 0,
    type: Number
  },
  labelBgPadding: {
    default: () => [0, 0],
    type: Array
  },
  labelBgStyle: {
    default: () => ({}),
    type: Object
  },
  labelShowBg: {
    default: false,
    type: Boolean
  },
  labelStyle: {
    default: () => ({}),
    type: Object
  },
  markerEnd: {
    default: "",
    type: String
  },
  markerStart: {
    default: "",
    type: String
  },
  sourceX: {
    required: true,
    type: Number
  },
  sourceY: {
    required: true,
    type: Number
  },
  sourcePosition: {
    default: "right",
    type: String
  },
  style: {
    default: () => ({}),
    type: Object
  },
  targetX: {
    required: true,
    type: Number
  },
  targetY: {
    required: true,
    type: Number
  },
  targetPosition: {
    default: "left",
    type: String
  }
});

const edgePath = computed(() => createErdOrthogonalPath({
  laneX: props.data?.laneX,
  sourcePosition: props.sourcePosition,
  sourceTrackOffset: props.data?.sourceTrackOffset,
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  targetPosition: props.targetPosition,
  targetTrackOffset: props.data?.targetTrackOffset,
  targetX: props.targetX,
  targetY: props.targetY
}));
</script>

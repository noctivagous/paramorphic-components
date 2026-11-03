// Paramorphic framework: public entry point.
// Layer order follows README 9.1: kernel conventions + shared types,
// components (Grid real, others stubbed), morph library (presets),
// plan I/O. No React, no network below components/GridViewport.
export * from "./types";
export * from "./graph-kernel";
export * from "./tilings";
export * from "./occupancy";
export * from "./engine";
export * from "./presets";
export * from "./plan";
export * from "./traversal";
export * from "./editing";
export * from "./derivation";
export * from "./morphs/formulas";
export * from "./morphs/framing";
export * from "./adapters/audio";
export { DirectionCompass, GridViewport } from "./components/GridViewport";
export type { GridViewportProps } from "./components/GridViewport";
export * from "./components/stubs";

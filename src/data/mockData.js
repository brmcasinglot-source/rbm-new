/**
 * mockData.js — Legacy compatibility shim.
 * Both dashboards now import from store.js instead.
 * This file can be safely deleted once all imports are updated.
 */
export { getReports as mockData, getAwarenessContent as awarenessContent } from "./store.js";

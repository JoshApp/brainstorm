// Import FIRST (before any game module) to stub Vite asset imports under tsx.
import { register } from 'node:module';
register('./vite-asset-hooks.mjs', import.meta.url);

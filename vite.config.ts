import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
// Vite React Refresh injects an inline preamble in development. The packaged app
// keeps its strict CSP; only the local HMR page omits that meta tag.
export default defineConfig({plugins:[react(),{name:'local-preview-csp',enforce:'pre',transformIndexHtml(html,context){return context.server?html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/,''):html;}}], define:{global:'globalThis'}, build:{target:'es2022',rollupOptions:{input:{app:fileURLToPath(new URL('./index.html',import.meta.url)),desktop:fileURLToPath(new URL('./desktop.html',import.meta.url)),learning:fileURLToPath(new URL('./learning.html',import.meta.url))}}}});

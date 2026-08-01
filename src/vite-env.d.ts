/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Bug-report collector (see src/report/bug-report.ts). Both optional — unset
// means "no upload", and the report falls back to the share/download path.
interface ImportMetaEnv {
  /** REST endpoint that accepts a JSON insert (e.g. a Supabase /rest/v1/reports URL). */
  readonly VITE_REPORT_ENDPOINT?: string;
  /** Anon/public key sent as apikey + bearer. Safe to embed (RLS = insert-only). */
  readonly VITE_REPORT_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/* Eltes — public configuration (safe to publish)
   --------------------------------------------------------------------------
   The Supabase URL and the *publishable* key are public identifiers: they are
   shipped to every browser by design, and row-level security decides what the
   holder may read or write. The service_role key and the Resend API key are
   never here — they live only in Supabase Edge Function secrets.

   Leave this file empty (or delete it) and Eltes runs exactly as before:
   a local profile in this browser, with the welcome email sent by a server
   you run yourself (`npm start` → POST /api/email/welcome).
   -------------------------------------------------------------------------- */
window.ELTES_CONFIG = {
  supabaseUrl: 'https://odemzfpgercjitrrdlvk.supabase.co',
  supabaseAnonKey: 'sb_publishable_Cibcmscgz4asLmS2wessmA_p07xhye5',
  siteUrl: 'https://gefrus112.github.io/eltes/',
  functionsPath: '/functions/v1',
  mailFunction: 'eltes-mail'
};

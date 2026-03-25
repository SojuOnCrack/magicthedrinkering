/**
 * CommanderForge — Cloudflare Pages Function
 * /auth/callback  — Supabase OAuth-Redirect-Handler
 *
 * Supabase leitet OAuth-Logins (z.B. Google) an diese URL zurück.
 * Der Hash-Fragment (#access_token=...) wird vom Supabase-Client
 * im Browser selbst verarbeitet — wir leiten einfach auf / weiter.
 *
 * Eintrag in Supabase Dashboard:
 *   Authentication → URL Configuration → Redirect URLs
 *   → https://deine-domain.pages.dev/auth/callback
 *     https://deine-custom-domain.com/auth/callback
 */

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Supabase schickt den Token als Hash-Fragment — dieser landet
  // nie auf dem Server. Wir leiten einfach zur App weiter und
  // lassen den Supabase JS-Client den Hash auswerten.
  return Response.redirect(url.origin + '/', 302);
}

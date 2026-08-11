// Shared guard for the write/cron endpoints. When CRON_SECRET is set, callers
// must present it via either:
//   - Authorization: Bearer <CRON_SECRET>   (Vercel Cron sends this automatically)
//   - ?token=<CRON_SECRET>                   (convenient for manual/browser calls)
// When CRON_SECRET is unset, endpoints are open (fine for private/dev projects).

export function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const auth = request.headers.get('authorization') || '';
  if (auth === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get('token') === secret) return true;

  return false;
}

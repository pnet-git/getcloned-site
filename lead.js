// POST /api/lead
// Writes a homepage lead to Supabase `website_leads`.
// Env vars required (set these in Vercel > Settings > Environment Variables):
//   SUPABASE_URL          e.g. https://waocacqbyppyosekpdoh.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (server-side only, never in the browser)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    const selected_option = body.selected_option ? String(body.selected_option).slice(0, 120) : null;
    const routed_to = body.routed_to ? String(body.routed_to).slice(0, 120) : null;
    const other_detail = body.other_detail ? String(body.other_detail).slice(0, 1000) : null;

    // basic email sanity check
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      return res.status(400).json({ ok: false, error: 'Invalid email' });
    }

    const row = {
      email,
      selected_option,
      routed_to,
      other_detail,
      source: 'getcloned_home',
      user_agent: (req.headers['user-agent'] || '').slice(0, 500),
      referrer: (req.headers['referer'] || '').slice(0, 500)
    };

    const r = await fetch(`${SUPABASE_URL}/rest/v1/website_leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Supabase insert failed:', r.status, detail);
      return res.status(502).json({ ok: false, error: 'Could not save' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Lead handler error:', err);
    return res.status(500).json({ ok: false, error: 'Unexpected error' });
  }
}

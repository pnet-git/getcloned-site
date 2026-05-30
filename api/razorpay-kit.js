import crypto from 'crypto';

const KIT_API_KEY = process.env.KIT_API_KEY;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const KIT_TAG_ID = '19878292';

export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Debug: confirm env vars are loaded
  if (!KIT_API_KEY) {
    return res.status(500).json({ error: 'KIT_API_KEY not set in environment' });
  }

  const rawBody = await getRawBody(req);

  // Signature verification disabled for now
  // Will re-enable after flow is confirmed working

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const event = body?.event;
  if (event !== 'payment.captured' && event !== 'payment_link.paid') {
    return res.status(200).json({ message: 'Event ignored', event });
  }

  // Extract email
  let email = null;
  try {
    const p = body.payload;
    email =
      p?.payment?.entity?.email ||
      p?.payment_link?.entity?.customer_details?.contact_email ||
      null;
  } catch (e) {
    return res.status(400).json({ error: 'Email extraction failed', detail: e.message });
  }

  if (!email) {
    return res.status(400).json({ error: 'No email in payload' });
  }

  const KIT_HEADERS = {
    'Authorization': `Bearer ${KIT_API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Step 1: Find OR create subscriber by email using upsert
  let subscriberId = null;
  try {
    // Use create (upsert) — if exists Kit returns existing subscriber
    const upsertRes = await fetch('https://api.kit.com/v4/subscribers', {
      method: 'POST',
      headers: KIT_HEADERS,
      body: JSON.stringify({ email_address: email })
    });
    const upsertData = await upsertRes.json();
    subscriberId = upsertData?.subscriber?.id || null;

    if (!subscriberId) {
      return res.status(500).json({
        error: 'Upsert failed',
        status: upsertRes.status,
        kit_response: upsertData
      });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Kit upsert error', detail: e.message });
  }

  // Step 2: Tag the subscriber
  try {
    const tagRes = await fetch(`https://api.kit.com/v4/tags/${KIT_TAG_ID}/subscribers`, {
      method: 'POST',
      headers: KIT_HEADERS,
      body: JSON.stringify({ subscriber_id: subscriberId })
    });
    const tagData = await tagRes.json();
    return res.status(200).json({
      success: true,
      email,
      subscriber_id: subscriberId,
      tag_response: tagData
    });
  } catch (e) {
    return res.status(500).json({ error: 'Tag failed', detail: e.message });
  }
}

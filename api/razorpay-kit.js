import crypto from 'crypto';

const KIT_API_KEY = process.env.KIT_API_KEY;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const KIT_TAG_ID = '19878292';

// Tell Vercel NOT to parse the body — we'll do it manually
// This is critical for webhook signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

// Read raw body from request stream
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

  // Read raw body
  const rawBody = await getRawBody(req);

  // Verify Razorpay signature
  if (RAZORPAY_WEBHOOK_SECRET) {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(401).json({ error: 'No signature header' });
    }
    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Only handle payment.captured and payment_link.paid
  const event = body?.event;
  if (event !== 'payment.captured' && event !== 'payment_link.paid') {
    return res.status(200).json({ message: 'Event ignored', event });
  }

  // Extract email
  let email = null;
  try {
    const payload = body.payload;
    email =
      payload?.payment?.entity?.email ||
      payload?.payment_link?.entity?.customer_details?.contact_email ||
      null;
  } catch (e) {
    return res.status(400).json({ error: 'Could not extract email', detail: e.message });
  }

  if (!email) {
    return res.status(400).json({ error: 'No email found in payload' });
  }

  // Find subscriber in Kit
  let subscriberId = null;
  try {
    const findRes = await fetch(
      `https://api.kit.com/v4/subscribers?email_address=${encodeURIComponent(email)}`,
      {
        headers: {
          'Authorization': `Bearer ${KIT_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Kit-Api-Version': '2024-07-24'
        }
      }
    );
    const findData = await findRes.json();
    if (findData.subscribers && findData.subscribers.length > 0) {
      subscriberId = findData.subscribers[0].id;
    }
  } catch (e) {
    return res.status(500).json({ error: 'Kit lookup failed', detail: e.message });
  }

  // Create if not found
  if (!subscriberId) {
    try {
      const createRes = await fetch('https://api.kit.com/v4/subscribers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KIT_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Kit-Api-Version': '2024-07-24'
        },
        body: JSON.stringify({ email_address: email, state: 'active' })
      });
      const createData = await createRes.json();
      subscriberId = createData.subscriber?.id;
    } catch (e) {
      return res.status(500).json({ error: 'Kit create failed', detail: e.message });
    }
  }

  if (!subscriberId) {
    return res.status(500).json({ error: 'No subscriber ID' });
  }

  // Tag the subscriber
  try {
    await fetch(`https://api.kit.com/v4/tags/${KIT_TAG_ID}/subscribers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIT_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Kit-Api-Version': '2024-07-24'
      },
      body: JSON.stringify({ subscriber_id: subscriberId })
    });
    return res.status(200).json({ success: true, email, subscriber_id: subscriberId });
  } catch (e) {
    return res.status(500).json({ error: 'Tag failed', detail: e.message });
  }
}

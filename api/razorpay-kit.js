// Vercel Serverless Function
// Razorpay payment.captured webhook → Kit tag getcloned-paid-confirmed
// Endpoint: getcloned.in/api/razorpay-kit

const crypto = require('crypto');

const KIT_API_KEY = process.env.KIT_API_KEY;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const KIT_TAG_ID = '19878292'; // getcloned-paid-confirmed

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Razorpay webhook signature
  if (RAZORPAY_WEBHOOK_SECRET) {
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Only handle payment.captured events
  const event = req.body.event;
  if (event !== 'payment.captured' && event !== 'payment_link.paid' && event !== 'payment_page.paid') {
    return res.status(200).json({ message: 'Event ignored', event });
  }

  // Extract email from Razorpay payload
  let email = null;
  try {
    const payload = req.body.payload;
    // Try payment_link.paid / payment_page.paid structure
    email =
      payload?.payment?.entity?.email ||
      payload?.payment_link?.entity?.customer_details?.contact_email ||
      payload?.payment_page?.entity?.customer_details?.email ||
      null;
  } catch (e) {
    return res.status(400).json({ error: 'Could not extract email', detail: e.message });
  }

  if (!email) {
    return res.status(400).json({ error: 'No email found in payload' });
  }

  // Step 1: Find or create subscriber in Kit by email
  let subscriberId = null;
  try {
    const findRes = await fetch(`https://api.kit.com/v4/subscribers?email_address=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${KIT_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Kit-Api-Version': '2024-07-24'
      }
    });
    const findData = await findRes.json();
    if (findData.subscribers && findData.subscribers.length > 0) {
      subscriberId = findData.subscribers[0].id;
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to look up subscriber', detail: e.message });
  }

  // If not found in Kit, create them
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
      return res.status(500).json({ error: 'Failed to create subscriber', detail: e.message });
    }
  }

  if (!subscriberId) {
    return res.status(500).json({ error: 'Could not get subscriber ID' });
  }

  // Step 2: Add tag getcloned-paid-confirmed
  try {
    const tagRes = await fetch(`https://api.kit.com/v4/tags/${KIT_TAG_ID}/subscribers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIT_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Kit-Api-Version': '2024-07-24'
      },
      body: JSON.stringify({ subscriber_id: subscriberId })
    });
    const tagData = await tagRes.json();
    return res.status(200).json({
      success: true,
      email,
      subscriber_id: subscriberId,
      tag: 'getcloned-paid-confirmed',
      kit_response: tagData
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to add tag', detail: e.message });
  }
}

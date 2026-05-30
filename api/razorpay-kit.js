// Vercel Serverless Function
// Razorpay payment.captured webhook → Kit tag getcloned-paid-confirmed

import crypto from 'crypto';

const KIT_API_KEY = process.env.KIT_API_KEY;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const KIT_TAG_ID = '19878292'; // getcloned-paid-confirmed

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Log incoming request for debugging
  console.log('Razorpay webhook received:', {
    event: req.body?.event,
    headers: req.headers
  });

  // Verify Razorpay webhook signature
  if (RAZORPAY_WEBHOOK_SECRET) {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      console.log('No signature header found');
      return res.status(401).json({ error: 'No signature' });
    }
    const body = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature !== expected) {
      console.log('Signature mismatch');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Only handle payment.captured and payment_link.paid
  const event = req.body?.event;
  if (event !== 'payment.captured' && event !== 'payment_link.paid') {
    return res.status(200).json({ message: 'Event ignored', event });
  }

  // Extract email from Razorpay payload
  let email = null;
  try {
    const payload = req.body.payload;
    email =
      payload?.payment?.entity?.email ||
      payload?.payment_link?.entity?.customer_details?.contact_email ||
      null;
    console.log('Extracted email:', email);
  } catch (e) {
    return res.status(400).json({ error: 'Could not extract email', detail: e.message });
  }

  if (!email) {
    return res.status(400).json({ error: 'No email found in payload' });
  }

  // Step 1: Find subscriber in Kit by email
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
    console.log('Kit subscriber lookup:', findData);
    if (findData.subscribers && findData.subscribers.length > 0) {
      subscriberId = findData.subscribers[0].id;
    }
  } catch (e) {
    return res.status(500).json({ error: 'Failed to look up subscriber', detail: e.message });
  }

  // Step 2: If not found, create them
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
      console.log('Kit subscriber created:', createData);
      subscriberId = createData.subscriber?.id;
    } catch (e) {
      return res.status(500).json({ error: 'Failed to create subscriber', detail: e.message });
    }
  }

  if (!subscriberId) {
    return res.status(500).json({ error: 'Could not get subscriber ID' });
  }

  // Step 3: Add tag getcloned-paid-confirmed
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
    console.log('Tag applied:', tagData);
    return res.status(200).json({
      success: true,
      email,
      subscriber_id: subscriberId,
      tag: 'getcloned-paid-confirmed'
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to add tag', detail: e.message });
  }
}

import crypto from 'crypto';
import { z } from 'zod';

const pendingPhoneCodes = new Map();

const googleSchema = z.object({ idToken: z.string().min(10) });
const phoneStartSchema = z.object({ phone: z.string().min(8) });
const phoneVerifySchema = z.object({ phone: z.string().min(8), code: z.string().length(6) });

export function signupWithGoogle(req, res) {
  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  return res.status(201).json({
    message: 'Google signup accepted (mock verification)',
    user: {
      id: crypto.randomUUID(),
      provider: 'google',
      displayName: 'Sikka Traveler',
      preferredLanguage: 'en'
    },
    tokens: {
      accessToken: crypto.randomBytes(24).toString('hex')
    }
  });
}

export function startPhoneSignup(req, res) {
  const parsed = phoneStartSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const code = '123456';
  pendingPhoneCodes.set(parsed.data.phone, code);

  return res.status(202).json({
    message: 'Verification code sent (mock)',
    channel: 'sms',
    expiresInSec: 300
  });
}

export function verifyPhoneSignup(req, res) {
  const parsed = phoneVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const expected = pendingPhoneCodes.get(parsed.data.phone);
  if (expected !== parsed.data.code) {
    return res.status(401).json({ message: 'Invalid code' });
  }
  pendingPhoneCodes.delete(parsed.data.phone);

  return res.status(201).json({
    message: 'Phone signup verified',
    user: {
      id: crypto.randomUUID(),
      provider: 'phone',
      phone: parsed.data.phone
    },
    tokens: {
      accessToken: crypto.randomBytes(24).toString('hex')
    }
  });
}

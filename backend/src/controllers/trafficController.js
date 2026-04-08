import { z } from 'zod';
import { getTrafficSnapshot } from '../mocks/externalApis.js';

const schema = z.object({ lat: z.coerce.number(), lng: z.coerce.number() });

export async function getTraffic(req, res) {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = await getTrafficSnapshot(parsed.data.lat, parsed.data.lng);
  return res.json(data);
}

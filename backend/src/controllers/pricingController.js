import { z } from 'zod';
import { estimateTaxiPrice } from '../mocks/externalApis.js';

const schema = z.object({
  start_lat: z.coerce.number(),
  start_lng: z.coerce.number(),
  end_lat: z.coerce.number(),
  end_lng: z.coerce.number()
});

export async function getTaxiPrice(req, res) {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { start_lat, start_lng, end_lat, end_lng } = parsed.data;
  const estimate = await estimateTaxiPrice(start_lat, start_lng, end_lat, end_lng);
  return res.json(estimate);
}

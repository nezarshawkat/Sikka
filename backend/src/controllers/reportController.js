import { z } from 'zod';

const schema = z.object({
  report_type: z.string().min(2),
  description: z.string().min(5),
  lat: z.number(),
  lng: z.number(),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending')
});

export async function reportRoute(req, res) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  return res.status(201).json({ message: 'Report accepted', report: parsed.data });
}

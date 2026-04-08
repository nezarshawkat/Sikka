import { z } from 'zod';
import { getCachedRoute, setCachedRoute } from '../services/cacheService.js';
import { planRoutes } from '../services/routingService.js';

const routeQuerySchema = z.object({
  start_lat: z.coerce.number(),
  start_lng: z.coerce.number(),
  end_lat: z.coerce.number(),
  end_lng: z.coerce.number(),
  route_type: z.enum(['cheapest', 'fastest', 'balanced', 'comfort', 'tourist']).default('balanced')
});

export async function getRoute(req, res) {
  const parsed = routeQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { start_lat, start_lng, end_lat, end_lng, route_type } = parsed.data;
  const cacheKey = `route_${start_lat}_${start_lng}_${end_lat}_${end_lng}_${route_type}`;

  const cached = await getCachedRoute(cacheKey);
  if (cached) return res.json({ cached: true, ...cached });

  const routes = planRoutes({
    start: { lat: start_lat, lng: start_lng },
    end: { lat: end_lat, lng: end_lng },
    routeType: route_type
  });

  const payload = {
    routeType: route_type,
    scenarios: routes,
    generatedAt: new Date().toISOString()
  };

  await setCachedRoute(cacheKey, payload);
  return res.json({ cached: false, ...payload });
}

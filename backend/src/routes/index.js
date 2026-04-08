import { Router } from 'express';
import { getRoute } from '../controllers/routeController.js';
import { getTraffic } from '../controllers/trafficController.js';
import { getTaxiPrice } from '../controllers/pricingController.js';
import { reportRoute } from '../controllers/reportController.js';
import authRouter from './auth.js';

const router = Router();

router.get('/route', getRoute);
router.get('/traffic', getTraffic);
router.get('/taxi-price', getTaxiPrice);
router.post('/report-route', reportRoute);
router.use('/auth', authRouter);

export default router;

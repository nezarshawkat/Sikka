import { Router } from 'express';
import { signupWithGoogle, startPhoneSignup, verifyPhoneSignup } from '../controllers/authController.js';

const authRouter = Router();

authRouter.post('/google-signup', signupWithGoogle);
authRouter.post('/phone-signup/start', startPhoneSignup);
authRouter.post('/phone-signup/verify', verifyPhoneSignup);

export default authRouter;

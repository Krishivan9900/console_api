import { Router } from 'express';
import { jwtAuthMiddleware, requireRole } from '@surefy/middleware/jwtAuth.middleware';
import AuthController from '@surefy/console/http/controllers/auth.controller';
import messageController from '../app/http/controllers/message.controller';
import { uploadMediaMiddleware } from '@surefy/middleware/upload.middleware';
import catalogController from '../app/http/controllers/catalog.controller';

const AuthRoute = Router();
  
// Public routes (no authentication required)
AuthRoute.post('/login', AuthController.login);
AuthRoute.post('/register', AuthController.register); 
AuthRoute.post('/register-company', AuthController.onboard);
AuthRoute.post('/stored-chat-session',AuthController.storedChatSession);
AuthRoute.post('/send-message',  messageController.sendPublicMessage);
AuthRoute.post('/check-user',AuthController.checkExistUser);
AuthRoute.post('/media', uploadMediaMiddleware, AuthController.uploadMedia);
AuthRoute.post('/check-category',AuthController.getVariantByCategory )
AuthRoute.post('/org-variants/sync',catalogController.syncOrganizationVarinats)

AuthRoute.get("/verify", AuthController.verify);

//Reset-password
AuthRoute.post('/verify-otp', AuthController.verifyOtp);
AuthRoute.post('/reset-password', AuthController.forgotPassword);
AuthRoute.post('/send-otp', AuthController.sendOtp);

// Protected routes (JWT authentication required)
AuthRoute.get('/profile', jwtAuthMiddleware, AuthController.getProfile);
AuthRoute.post('/change-password', jwtAuthMiddleware, AuthController.changePassword);

// Admin routes (superadmin only)
AuthRoute.post(
  '/create-admin',
  jwtAuthMiddleware,
  requireRole('superadmin'),
  AuthController.createAdmin
);

export default AuthRoute;

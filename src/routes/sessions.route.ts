import { Router } from 'express';
import sessionController from '../app/http/controllers/session.controller';
import { checkPlanLimit } from '@surefy/middleware/plan.middleware';

const SessionRoute = Router();

// Message operations - require authentication (applied at route group level)
SessionRoute.get('/data',  sessionController.getStoredSessions);
SessionRoute.put('/:queryId/data', sessionController.updateCustomerQuery)


export default SessionRoute;
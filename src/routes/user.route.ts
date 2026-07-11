import { Router } from 'express';
import CompanyController from '@surefy/console/http/controllers/company.controller';

const UserRoute = Router();

// All company endpoints - JWT authentication applied at route group level
// Only admins can create/manage companies
UserRoute.post('/', CompanyController.onboard); // Admin creates new company
UserRoute.post('/create', CompanyController.createUser); // Admin creates new user under company

UserRoute.get('/', CompanyController.getUser);
UserRoute.get('/reminder',CompanyController.getReminders)


UserRoute.get('/all', CompanyController.getAll);
UserRoute.get('/:userId', CompanyController.getUserById);
UserRoute.put('/:userId', CompanyController.updateUser);
UserRoute.delete('/:id', CompanyController.deleteCompanyUser);
UserRoute.post('/:id/regenerate-keys', CompanyController.regenerateKeys);


UserRoute.get('/stats', CompanyController.getUserStats)
UserRoute.get('/plan/status', CompanyController.checkUserPlanStatus)


export default UserRoute;
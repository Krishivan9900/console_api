import { Request, Response } from 'express';
import { successResponse, tryCatchAsync } from '@surefy/utils/Controller';
import { HttpStatusCode } from '@surefy/utils/HttpStatusCode';
import { AuthRequest } from '@surefy/middleware/auth.middleware';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import { v4 as uuidv4, validate as uuidValidate } from "uuid";
import sessionService from '../../services/session.service';

class SessionController{
    /**
     * GET
     * stored_chatbot_session_data
     */
    getStoredSessions = tryCatchAsync(async (req: AuthRequest, res: Response) => {
        const filters = {
            status: req.query.status,
            phone_number_id: req.query.phone_number,
            search: req.query.search,
            page: req.query.page,
            limit: req.query.limit,
        };

        const storedSessions = await sessionService.storedSession(req.companyId!,filters)
        successResponse(req, res, "Stored session retrived succesfully", storedSessions)
    })

    updateCustomerQuery = tryCatchAsync(async (req: AuthRequest, res: Response) => {
        const { queryId } = req.params
        const updateSession = await sessionService.updateStoredSession(
            req.companyId!, req.userId!, queryId, req.body
        )
        successResponse(req, res, "Update Query Session", updateSession)
    })
}

export default new SessionController();
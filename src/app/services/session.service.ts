import HTTP404Error from '@surefy/exceptions/HTTP404Error';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import storesSessionModel from '../models/storesSession.model';

class SessionService{
    async storedSession(company_id:string,filters:any){
        const session_data = await storesSessionModel.getSessionsByCompanyId(company_id,filters)
        return session_data || []
    }


    async updateStoredSession(company_id:string,user_id:string,queryId:string,data:any){
        return await storesSessionModel.update(queryId,{
            user_id:user_id,
            company_id:company_id,
            status:data.status
        })
    }
}

export default new SessionService()
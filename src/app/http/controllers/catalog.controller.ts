import { Request, Response } from 'express';
import { successResponse, tryCatchAsync } from '@surefy/utils/Controller';
import { HttpStatusCode } from '@surefy/utils/HttpStatusCode';
import { AuthRequest } from '@surefy/middleware/auth.middleware';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import productGroupModel from '../../models/productGroup.model';
import catalogService from '../../services/catalog.service';
import { errorResponse } from '@surefy/utils/Controller';
import { request } from 'http';

class catalogController {
    /**
     * POST /v1/catalog/groups
     * Create New Product Group
     */
    createProductGroup = tryCatchAsync(async (req: AuthRequest, res: Response) => {
        const { group_name, categories,catalog_id } = req.body
        if (!Array.isArray(categories)) {
            throw new Error("Categories must be an array");
        }
        const productGroup = await catalogService.createGroup({
            group_name,
            categories,
            catalog_id,
            user_id: req.userId!,
            company_id: req.companyId!,
            group_status: "active",
            group_item_counts: 0
        })
        successResponse(req, res, 'Group Created successfully', productGroup, HttpStatusCode.CREATED)
    })

    /**
     * POST /v1/catalog/groups/:groupId/variants
     * Create New Group Variant
     */
    createGroupVariants = tryCatchAsync(async (req: AuthRequest, res: Response) => {
        try {
            const { groupId } = req.params
            let variants;

            if (typeof req.body.requests === 'string') {
                variants = JSON.parse(req.body.requests);
            } else {
                variants = req.body.requests;
            }

            const catalog_id = req.body.catalog_id;
            const files = (req.files || []) as Express.Multer.File[];

            const result = await catalogService.createGroupVariants(
                groupId,
                catalog_id,
                variants,
                files
            )

            successResponse(req, res, "Groups variants created successfully", result, HttpStatusCode.CREATED)
        } catch (error: any) {
            console.error("Created Group Variants Error:", error);
            return errorResponse(
                req,
                res,
                error.message || "Internal Server Error",
                error.details || null,
                error.statusCode || HttpStatusCode.INTERNAL_SERVER_ERROR
            );
        }
    })


    
    /**
     * GET /v1/groups/
     */
    getCatalogGroups = tryCatchAsync(async(req:AuthRequest,res:Response)=>{
        try{
            const catalogGroups = await catalogService.getAllCatalogGroups(req.companyId!,req.userId!)
            successResponse(req,res,"Retrived successfully all catalog groups",catalogGroups,HttpStatusCode.OK)
        }catch(error:any){
            return res.status(error.statusCode || 500).json({
                success:false,
                message:error.message || "Something went wrong"
            })
        }
    })


    
    /**
     * PUT /v1/groups/:groupId
     */
    updateGroupCatalog = tryCatchAsync(async(req:AuthRequest,res:Response)=>{

    })

    /**
     * DELETE /v1/groups/:groupId
     */
    deleteGroupCatalog = tryCatchAsync(async(req:AuthRequest,res:Response)=>{

    })



    /**
     * GET /v1/groups/:groupId/variants
     */
    getGroupVariants = tryCatchAsync(async(req:AuthRequest,res:Response)=>{
        try{
            const{groupId} = req.params
            const catalogGroups = await catalogService.getAllGroupVariants(req.companyId!,req.userId!,groupId)
            successResponse(req,res,"Retrived successfully all catalog groups",catalogGroups,HttpStatusCode.OK)
        }catch(error:any){
            return res.status(error.statusCode || 500).json({
                success:false,
                message:error.message || "Something went wrong"
            })
        }
    })

    /**    
     * PUT /v1/variants/:variantId
     */
    updateGroupVariant = tryCatchAsync(async(req:AuthRequest,res:Response)=>{
        try{
            const{variantId} = req.params
            const updateVariant = await catalogService.updateGroupVariant(variantId)
            successResponse(req,res,"Update Product Variant successfully",updateVariant,HttpStatusCode.OK)
        }catch(error:any){
            return res.status(error.statusCode || 500).json({
                success:false,
                message:error.message || "Something went wrong"
            })
        }
    })

    /**
     * DELETE /variants/:variantId
     */
    deleteGroupVariants = tryCatchAsync(async(req:AuthRequest,res:Response)=>{

    })

    /**
     * GET /variants/sync
     */
    syncMetaCatalogVariant = tryCatchAsync(async(req:AuthRequest,res:Response)=>{
        try{
            const{catalogId} = req.params
            const syncMetaCatalog = await catalogService.syncMetaCatalogVariant(catalogId)
            successResponse(req,res,"Sync Meta-variant successfully",syncMetaCatalog,HttpStatusCode.OK)
        }catch(error:any){
            return res.status(error.statusCode || 500).json({
                success:false,
                message:error.message || "Something went wrong"
            })
        }
    })

    /**
     * GET /org-variants/sync
     */
    syncOrganizationVarinats = tryCatchAsync(async(req:Request,res:Response)=>{
        try{
            const authHeader:any = req.headers['authorization'];
            const token = authHeader.substring(7)
            console.log("JWT Auth Middleware - Authorization header:", token); // Debug log
            const user_id = "ccc7bb1d-39b4-4d67-b687-c1a03a314146"
            const company_id = "cb2a7274-f7c0-41e6-b752-71991edb699c"
            const syncAllCatalog = await catalogService.syncOrganizationCatalog(user_id,company_id,token) 
            successResponse(req,res,"Sync Meta-variant successfully",syncAllCatalog,HttpStatusCode.OK)
        }catch(error:any){
            return res.status(error.statusCode || 500).json({
                success:false,
                message:error.message || "Something went wrong"
            })
        }
    })


}

export default new catalogController()








// id?:string,
// company_id:string,
// user_id:string,
// group_name:string,
// group_status:string
// group_item_counts?:string,
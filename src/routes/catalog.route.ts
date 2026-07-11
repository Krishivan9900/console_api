import { Router } from 'express';
import { uploadMutipleMedia } from '@surefy/middleware/upload.middleware';
import catalogController from '../app/http/controllers/catalog.controller';

const catalogRoute = Router()

catalogRoute.get('/groups', catalogController.getCatalogGroups)
catalogRoute.post('/groups',catalogController.createProductGroup)
// catalogRoute.get('/groups/:groupId',catalogController.createProductGroup)
// catalogRoute.put('/groups/:groupId',catalogController.updateProductGr)
// catalogRoute.delete('/groups/:groupId',catalogController.createProductGroup)


/**
 * Product Variants
 */
catalogRoute.post('/groups/:groupId/variants',
                  uploadMutipleMedia ,
                  catalogController.createGroupVariants
                )
catalogRoute.get('/groups/:groupId/variants',catalogController.getGroupVariants)

// catalogRoute.put('/groups/variants/:variantId')
// catalogRoute.get('/groups/variants/:variantId')
// catalogRoute.delete('/groups/variants/:variantId')

catalogRoute.get('/groups/variants/:catalogId/sync', catalogController.syncMetaCatalogVariant)


export default catalogRoute


//                 POST   /catalog/groups
// GET    /catalog/groups
// GET    /catalog/groups/:groupId
// PUT    /catalog/groups/:groupId
// DELETE /catalog/groups/:groupId

// POST   /catalog/groups/:groupId/variants
// GET    /catalog/groups/:groupId/variants
// GET    /catalog/variants/:variantId
// PUT    /catalog/variants/:variantId
// DELETE /catalog/variants/:variantId
import { ProductVariantData } from "../interfaces/catalog.interface";
import productVariantModel from "../models/productVariant.model";

interface CreateVariantInput extends ProductVariantData{
    product_group_id:string;
    retailer_id:string;
    meta_status:string;
}

class catalogRepository{
    async createVariant(data:CreateVariantInput){
        const variant = await productVariantModel.create({
            product_group_id: data.product_group_id,
            retailer_id:data.retailer_id,
            
            name:data.name,
            description:data.description,

            availability:data.availability,
            condition:data.condition,

            price:data.price,
            currency:data.currency,

            brand:data.brand,
            url:data.url,

            image_url:data.image_url,
            color:data.color,
            size:data.size,

            inventory:0,
            meta_status:data.meta_status
        })
        return variant
    }
}

export default new catalogRepository();
export interface productGroups{
    id?:string,
    company_id:string,
    user_id:string,
    group_name:string,
    categories:string[]
    group_status:string,
    catalog_id:string,
    group_item_counts?:number,
}

export interface ProductVariantData{
    name:string,
    description:string,
    
    color?:string,
    size?:string,

    price:number,
    currency:string,

    availability:string,
    condition:string,

    brand:string,
    url:string,

    image_index?:string,
    image_url?:string
}

export interface ProductVariant{
    method: "CREATE" | "UPDATE" | "DELETE";
    item_type: "PRODUCT_ITEM";

    retailer_id:string,

    data:ProductVariantData
}

export interface CreateGroupVariantsRequest{
    calalog_id:string;
    requests:ProductVariant[]
}


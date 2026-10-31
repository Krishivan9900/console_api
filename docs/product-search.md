# Product search and recommendations

The booking search and Meta catalog fallback share the rules in
`src/app/services/productSearch.logic.ts`.

- Search uses all meaningful query words across product name, description,
  brand, category, subcategory, size and color. It no longer checks only the
  first two words or searches opaque retailer IDs.
- Literal matches rank before related recommendations. Numeric specifications
  use complete tokens: `160` does not count as a literal match for `1600`.
  Alternative specifications can appear in the related section.
- Synonym groups cover tarpaulins, fertilizers, seeds, pipes/hoses, sprayers and
  tractors, including selected Hindi and Telugu names. Common English spelling
  mistakes and singular/plural names are also supported.
- Related recommendations come from actual catalog products. For example,
  `GSM` first finds products such as `160 GSM-18*24`; their tarpaulin descriptions
  also identify related tarps. Variants with the same source `product_id` can be
  recommended too. Expansion is one step and never pads results with unrelated
  products.
- Results contain at most **28 distinct retailer IDs total**, across the
  **Matching products** and **Related recommendations** sections. Deleted,
  rejected, failed and explicitly unavailable products are excluded when that
  metadata is present. The local database search stays within the requested
  catalog and loads searchable metadata before ranking.

Add future product vocabulary to `RELATED_TERMS`; this is a deterministic
catalog search, without an external AI service or generated product listings.

`POST /v1/auth/check-category` keeps the existing `data` array of retailer IDs
and adds `search_term`, `catalog_id` and `product_matches` with names and
`matching`/`recommended` classifications. The product node reuses this ranked
response when the catalog and query match, avoiding another catalog download.
It also reads catalog IDs from the existing nested flow message configuration.
No flow reimport or database migration is required.

Run:

```sh
npm run test:product-search
npm run build
```

Tests cover GSM and related tarps, spelling/synonym matches, numeric specs,
empty/unknown queries, catalog isolation, the combined 28-item limit, and actual
booking flows in English, Hindi and Telugu. Database and Meta calls are stubbed;
tests do not send WhatsApp messages.

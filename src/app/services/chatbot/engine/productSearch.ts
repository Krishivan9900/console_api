import chatSessionModel from "@surefy/console/app/models/chatSession.model";
import productGroupModel from "@surefy/console/models/productGroup.model";
import metaService, { PRODUCT_LIST_MAX_ITEMS } from "@surefy/console/services/meta.service";
import { normalizeProductSearch, ProductSearchMatch, rankProductMatches } from '../../productSearch.logic';

// Meta product_list limits
const MAX_PRODUCTS = PRODUCT_LIST_MAX_ITEMS;
const HEADER_MAX = 60;

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map<string, { expiresAt: number; products: any[] }>();

/**
 * Send Product Message node
 * - retailerId set  → send that single product
 * - retailerId empty → search the Meta catalog with the customer's last answer
 *   and send at most 28 matching/recommended products for the WhatsApp cart
 */
export const executeProductMessageNode = async ({ bot, session, currentNode }: any) => {
  const attrs = currentNode.data?.attributes || {};
  const catalogId = attrs.catalogId || attrs.message?.interactive?.action?.catalog_id || (await resolveCatalogId(bot));

  if (!catalogId) {
    console.error("❌ Product message: no catalog id configured for bot", bot.id);
    return { type: "text", text: "Products are not available right now. Please try again later." };
  }

  if (attrs.retailerId) {
    return {
      type: "interactive",
      interactive: {
        type: "product",
        body: { text: attrs.body || "Tap to view this product" },
        ...(attrs.footer ? { footer: { text: attrs.footer } } : {}),
        action: { catalog_id: catalogId, product_retailer_id: attrs.retailerId },
      },
    };
  }

  const questionNode = findPreviousQuestionNode(bot, currentNode);
  const searchTerm = String(
    session.variables?.[attrs.searchVariable] ??
      session.variables?.[questionNode?.data?.attributes?.variable] ??
      session.last_message ??
      ""
  ).trim();

  let matches: ProductSearchMatch[] = [];
  try {
    // The booking flow already queried the local catalog through check-category.
    // Reuse that response only for this exact search and catalog, preserving rank.
    const response = session.variables?.http_response;
    if (response?.success === true && response.catalog_id === catalogId &&
        normalizeProductSearch(response.search_term) === normalizeProductSearch(searchTerm) &&
        Array.isArray(response.product_matches)) {
      const seen = new Set<string>();
      matches = response.product_matches.filter((product: any) => {
        if (!product.retailer_id || seen.has(product.retailer_id)) return false;
        seen.add(product.retailer_id); return true;
      }).slice(0, MAX_PRODUCTS).map((product: any) => ({
        product, matchType: product.match_type === 'recommended' ? 'recommended' : 'matching', score: 0,
      }));
    } else {
      matches = rankProductMatches(await getCatalogProducts(catalogId), searchTerm, MAX_PRODUCTS);
    }
  } catch (error: any) {
    console.error("❌ Catalog search failed:", error?.response?.data || error.message);
  }

  console.log(`🔎 Catalog search "${searchTerm}" → ${matches.length} recommendation(s)`);

  // No match: stay on the question so the next reply is searched again
  if (matches.length === 0) {
    if (questionNode) {
      await chatSessionModel.update(session.id, { current_node_id: questionNode.id });
    }
    return {
      type: "text",
      text: `Sorry, we couldn't find any product matching "${searchTerm}". Please type another product name, or type menu to return.`,
    };
  }

  // Continue the flow if the builder connected a next node, otherwise allow another search
  const nextEdge = bot.edges.find((e: any) => e.source === currentNode.id);
  const nextNodeId = nextEdge?.target || questionNode?.id;
  if (nextNodeId) {
    await chatSessionModel.update(session.id, { current_node_id: nextNodeId });
  }

  const shown = matches.slice(0, MAX_PRODUCTS);
  const body = (attrs.body || `Showing ${shown.length} matching and related product(s) for "{{search}}". Tap View items to choose.`)
    .replace(/\{\{\s*search\s*\}\}/g, searchTerm);

  return {
    type: "interactive",
    interactive: {
      type: "product_list",
      header: { type: "text", text: truncate(attrs.header || `Results for "${searchTerm}"`, HEADER_MAX) },
      body: { text: body },
      ...(attrs.footer ? { footer: { text: attrs.footer } } : {}),
      action: {
        catalog_id: catalogId,
        sections: buildSections(shown),
      },
    },
  };
};

/**
 * Shared matching rules for the local catalog API and Meta catalog fallback.
 */
export function searchProducts(products: any[], searchTerm: string) {
  return rankProductMatches(products, searchTerm, MAX_PRODUCTS).map(match => match.product);
}

async function getCatalogProducts(catalogId: string) {
  const cached = catalogCache.get(catalogId);
  if (cached && cached.expiresAt > Date.now()) return cached.products;

  const products = await metaService.getAllCatalogProducts(catalogId);
  catalogCache.set(catalogId, { products, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS });
  return products;
}

async function resolveCatalogId(bot: any): Promise<string | undefined> {
  const groups = await productGroupModel.getCatalogGroups(bot.company_id, bot.user_id);
  return groups.find((g: any) => g.catalog_id)?.catalog_id || process.env.META_CATALOG_ID;
}

function findPreviousQuestionNode(bot: any, node: any) {
  const visited = new Set<string>([node.id]);
  let targets = [node.id];
  while (targets.length) {
    const previous = bot.edges.filter((edge: any) => targets.includes(edge.target) && !visited.has(edge.source))
      .map((edge: any) => bot.nodes.find((candidate: any) => candidate.id === edge.source)).filter(Boolean);
    const question = previous.find((candidate: any) => candidate.data?.key === '@whatsapp/ask-question');
    if (question) return question;
    targets = previous.map((candidate: any) => candidate.id);
    targets.forEach((id: string) => visited.add(id));
  }
  return undefined;
}

function buildSections(matches: ProductSearchMatch[]) {
  return (['matching', 'recommended'] as const).map(matchType => ({
    title: matchType === 'matching' ? 'Matching products' : 'Related recommendations',
    product_items: matches.filter(match => match.matchType === matchType)
      .map(match => ({ product_retailer_id: match.product.retailer_id })),
  })).filter(section => section.product_items.length);
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

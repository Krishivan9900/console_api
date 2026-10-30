import chatSessionModel from "@surefy/console/app/models/chatSession.model";
import productGroupModel from "@surefy/console/models/productGroup.model";
import metaService, { PRODUCT_LIST_MAX_ITEMS } from "@surefy/console/services/meta.service";

// Meta product_list limits
const MAX_PRODUCTS = PRODUCT_LIST_MAX_ITEMS;
const MAX_SECTIONS = 10;
const SECTION_TITLE_MAX = 24;
const HEADER_MAX = 60;

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map<string, { expiresAt: number; products: any[] }>();

const STOP_WORDS = new Set([
  "i", "a", "an", "the", "to", "for", "of", "and", "or", "in", "on", "me", "my",
  "want", "need", "book", "buy", "order", "please", "show", "some", "get", "give",
]);

/**
 * Send Product Message node
 * - retailerId set  → send that single product
 * - retailerId empty → search the Meta catalog with the customer's last answer
 *   and send every matching product as a product_list (customer adds to cart from there)
 */
export const executeProductMessageNode = async ({ bot, session, currentNode }: any) => {
  const attrs = currentNode.data?.attributes || {};
  const catalogId = attrs.catalogId || (await resolveCatalogId(bot));

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

  let products: any[] = [];
  try {
    products = searchProducts(await getCatalogProducts(catalogId), searchTerm);
  } catch (error: any) {
    console.error("❌ Catalog search failed:", error?.response?.data || error.message);
  }

  console.log(`🔎 Catalog search "${searchTerm}" → ${products.length} match(es)`);

  // No match: stay on the question so the next reply is searched again
  if (products.length === 0) {
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

  const shown = products.slice(0, MAX_PRODUCTS);
  const body = (attrs.body || `Found ${products.length} product(s) for "{{search}}". Tap View items and add them to your cart.`)
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
 * Match products on every keyword the customer typed (name, brand, category, description).
 * A product is included if it matches at least one keyword; best matches come first.
 */
export function searchProducts(products: any[], searchTerm: string) {
  const phrase = normalize(searchTerm);
  const keywords = phrase
    .split(" ")
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));

  if (keywords.length === 0) return [];

  return products
    .filter((p) => p.retailer_id && p.availability !== "out of stock" && p.review_status !== "rejected")
    .map((product) => {
      const name = normalize(product.name);
      const other = normalize([product.brand, product.category, product.description, product.retailer_id].join(" "));

      let score = name.includes(phrase) ? 10 : 0;
      for (const keyword of keywords) {
        if (matchesWord(name, keyword)) score += 3;
        else if (matchesWord(other, keyword)) score += 1;
      }
      return { product, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ product }) => product);
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
  const incoming = bot.edges.filter((e: any) => e.target === node.id);
  return incoming
    .map((e: any) => bot.nodes.find((n: any) => n.id === e.source))
    .find((n: any) => n?.data?.key === "@whatsapp/ask-question");
}

function buildSections(products: any[]) {
  const byCategory = new Map<string, string[]>();
  for (const product of products) {
    const category = truncate(String(product.category || "Products").split(">").pop()!.trim(), SECTION_TITLE_MAX);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(product.retailer_id);
  }

  const sections = [...byCategory.entries()].map(([title, ids]) => ({ title, ids }));

  // Too many categories for one message: fold the rest into the last section
  if (sections.length > MAX_SECTIONS) {
    const overflow = sections.splice(MAX_SECTIONS - 1);
    sections.push({ title: "More products", ids: overflow.flatMap((s) => s.ids) });
  }

  return sections.map(({ title, ids }) => ({
    title,
    product_items: ids.map((id) => ({ product_retailer_id: id })),
  }));
}

function matchesWord(text: string, keyword: string) {
  if (text.includes(keyword)) return true;
  // Plural/singular and partial words, e.g. "seeds" ↔ "seed", "fertiliser" ↔ "fertil"
  return keyword.length >= 3 && text.split(" ").some((word) => word.startsWith(keyword) || (word.length >= 4 && keyword.startsWith(word)));
}

function normalize(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

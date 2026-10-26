const fs = require('node:fs');
const path = require('node:path');
const { v5: uuid } = require('uuid');

const DEFAULT_API = 'https://console-api-z4hc.onrender.com';
const DEFAULT_PHONE = '760184003848443';
const DEFAULT_CATALOG = '795853123055079';
const id = name => uuid(`https://krishivan.com/flows/unified/v1/${name}`, uuid.URL);

function buildUnifiedFlow({
  apiBaseUrl = DEFAULT_API,
  phoneNumberId = DEFAULT_PHONE,
  catalogId = DEFAULT_CATALOG,
  registrationFlow = require('../customer-registration.fixed.json'),
} = {}) {
  const flow = JSON.parse(JSON.stringify(registrationFlow));
  const api = apiBaseUrl.replace(/\/+$/, '');
  flow.name = 'Krishivan registration and services';
  flow.phoneNumberIds = [phoneNumberId];
  const node = nodeId => flow.nodes.find(n => n.id === nodeId);
  const add = (name, key, title, attributes) => {
    const nodeId = id(name);
    flow.nodes.push({
      id: nodeId, type: 'action', position: { x: 6400 + (flow.nodes.length % 5) * 500, y: Math.floor(flow.nodes.length / 5) * 300 },
      data: { key, title, type: 'action', nextHandle: !key.startsWith('@condition/'), attributes },
    });
    return nodeId;
  };
  const edge = (source, target, handle = 'default', branch) => {
    const sourceHandle = branch === undefined ? handle : `condition-${branch}-${source}`;
    flow.edges.push({
      id: id(`edge/${source}/${sourceHandle}/${target}`), source, target, sourceHandle, targetHandle: 'in',
      data: { sourceHandle, targetHandle: 'in', ...(branch === undefined ? {} : { condition: branch, branch }) },
    });
  };
  const redirect = (source, target) => {
    flow.edges = flow.edges.filter(e => e.source !== source);
    edge(source, target);
  };
  const condition = (name, title, conditions, operator = 'and') =>
    add(name, '@condition/condition-action', title, { conditions, operator });
  const equals = (field, value) => ({ field: `{{${field}}}`, comparator: 'equals', value });
  const notEmpty = field => ({ field: `{{${field}}}`, comparator: 'is_not_empty' });
  const text = (name, title, body) => add(name, '@whatsapp/send-text-message', title, {
    message: { type: 'text', text: { body, preview_url: false } },
  });
  const question = (name, title, body, variable, type = 'text') => add(name, '@whatsapp/ask-question', title, {
    variable, message: { type: 'text', text: { body, preview_url: false } }, format: { type },
  });
  const http = (name, title, endpoint, body) => add(name, '@http/http-request', title, {
    method: 'POST', url: `${api}${endpoint}`, headers: [{ key: 'Content-Type', value: 'application/json' }],
    params: [], body: JSON.stringify(body, null, 2), continueOnHttpError: true,
  });
  const buttons = (name, title, body, options, variable) => {
    const nodeId = add(name, '@whatsapp/send-button-message', title, {
      ...(variable ? { variable } : {}),
      message: { type: 'interactive', interactive: {
        type: 'button', body: { text: body },
        action: { buttons: options.map(([value, label]) => ({ type: 'reply', reply: { id: `${name}/${value}`, title: label } })) },
      } },
    });
    return { nodeId, connect: (value, target) => edge(nodeId, target, `${name}/${value}`) };
  };

  const trigger = flow.nodes.find(n => n.type === 'trigger');
  trigger.data.attributes.receiverIds = [phoneNumberId];
  trigger.data.attributes.keywords = [
    'hii', 'hi', 'hello', 'hey', 'hii i need help', 'hii i want to register under',
    'register', 'registration', 'menu', 'services', 'order', 'booking', 'ai',
  ];
  const registrationLanguage = node('3f7e0e2e-1ff7-4f43-8508-54747fbecb5d');
  registrationLanguage.data.attributes.variable = 'native_language';
  registrationLanguage.data.attributes.message.interactive.action.buttons[2].reply.title = 'తెలుగు';

  // FPO selections go straight to GST; the other roles retain their existing questions.
  for (const menu of flow.nodes.filter(n => n.data.attributes?.variable === 'role')) {
    for (const selection of flow.edges.filter(e => e.source === menu.id)) {
      const emailQuestion = node(selection.target);
      if (emailQuestion?.data.attributes?.variable !== 'email') continue;
      const gstQuestion = flow.edges.filter(e => e.source === emailQuestion.id)
        .map(e => node(e.target)).find(n => n?.data.attributes?.variable === 'gstin');
      if (gstQuestion) selection.target = gstQuestion.id;
    }
  }

  // Check the local users database, the same database used by registration and orders.
  // The GST verification service remains on its existing AWS endpoint.
  for (const n of flow.nodes) {
    const a = n.data.attributes || {};
    if (a.url?.includes('/check-user')) {
      a.url = `${api}/v1/auth/check-user`;
      a.body = JSON.stringify({ session_data: '{{phone_number}}' }, null, 2);
      a.headers = [{ key: 'Content-Type', value: 'application/json' }];
      a.params = [];
    } else if (a.url?.includes('/stored-chat-session')) {
      a.url = `${api}/v1/auth/stored-chat-session`;
      a.headers = [{ key: 'Content-Type', value: 'application/json' }];
      a.params = [];
    }
  }

  const languageMenu = buttons('service-language', 'Choose service language',
    'Welcome to Krishivan. Please select your preferred language.',
    [['en', 'English'], ['hi', 'हिंदी'], ['te', 'తెలుగు']], 'native_language');
  const registrationStart = registrationLanguage.id;
  const lookupFailure = '1a7e3ca8-74e0-408a-9164-4e490ea3cb50';
  const registeredConditions = () => [
    equals('http_response.success', true), notEmpty('http_response.data.id'),
    { field: '{{http_response.data.deleted_at}}', comparator: 'is_empty' },
  ];
  // A failed lookup is never evidence that a customer needs to register.
  const missing = condition('service-user-missing', 'Service user confirmed missing', [
    equals('http_status', 200), equals('http_response.success', false), equals('http_response.message', 'User not found'),
  ]);
  edge(missing, registrationStart, undefined, true);
  edge(missing, lookupFailure, undefined, false);
  const gate = (name, destination) => {
    const lookup = http(`${name}/lookup`, 'Check registration before service', '/v1/auth/check-user', { session_data: '{{phone_number}}' });
    const exists = condition(`${name}/exists`, 'Registered for this service?', registeredConditions());
    edge(lookup, exists);
    edge(exists, destination, undefined, true);
    edge(exists, missing, undefined, false);
    return lookup;
  };

  const translations = {
    en: {
      service: 'Please choose a Krishivan service.', order: 'Order / Booking', ai: 'AI services', leads: 'FPO lead import',
      aiMenu: 'Choose an AI service.', chat: 'Chat support', image: 'Image detection', back: 'Main menu',
      product: 'Which product or service would you like to book? Enter its name. Type menu to return.',
      noProducts: 'No matching products were found. Please enter another product name, or type menu to return.',
      problem: 'Please describe your problem so we can guide you.', photo: 'Please upload a photo for image detection.',
      unavailable: 'This service is currently unavailable. Please try again later or choose another service.',
    },
    hi: {
      service: 'कृपया अपनी सेवा चुनें।', order: 'ऑर्डर / बुकिंग', ai: 'एआई सेवाएँ', leads: 'FPO लीड आयात',
      aiMenu: 'कृपया एआई सेवा चुनें।', chat: 'चैट सहायता', image: 'छवि पहचान', back: 'मुख्य मेनू',
      product: 'किस उत्पाद या सेवा की बुकिंग करनी है? उसका नाम लिखें। वापस जाने के लिए menu लिखें।',
      noProducts: 'कोई उत्पाद नहीं मिला। दूसरा नाम लिखें या वापस जाने के लिए menu लिखें।',
      problem: 'कृपया अपनी समस्या विस्तार से लिखें।', photo: 'कृपया छवि पहचान के लिए फोटो अपलोड करें।',
      unavailable: 'यह सेवा अभी उपलब्ध नहीं है। कृपया बाद में प्रयास करें या दूसरी सेवा चुनें।',
    },
    te: {
      service: 'దయచేసి మీ సేవను ఎంచుకోండి.', order: 'ఆర్డర్ / బుకింగ్', ai: 'AI సేవలు', leads: 'FPO లీడ్ దిగుమతి',
      aiMenu: 'AI సేవను ఎంచుకోండి.', chat: 'చాట్ సహాయం', image: 'చిత్ర గుర్తింపు', back: 'ప్రధాన మెనూ',
      product: 'ఏ ఉత్పత్తి లేదా సేవ కావాలి? దాని పేరు పంపండి. తిరిగి రావడానికి menu పంపండి.',
      noProducts: 'ఉత్పత్తులు కనుగొనబడలేదు. మరో పేరు పంపండి లేదా menu పంపండి.',
      problem: 'దయచేసి మీ సమస్యను వివరంగా పంపండి.', photo: 'చిత్ర గుర్తింపు కోసం ఫోటోను అప్లోడ్ చేయండి.',
      unavailable: 'ఈ సేవ ప్రస్తుతం అందుబాటులో లేదు. తరువాత ప్రయత్నించండి లేదా మరొక సేవను ఎంచుకోండి.',
    },
  };
  const serviceMenus = {};
  const importPrompts = {};
  for (const [language, t] of Object.entries(translations)) {
    const menu = buttons(`services/${language}`, `Services (${language})`, t.service,
      [['booking', t.order], ['ai', t.ai], ['import', t.leads]], 'service');
    serviceMenus[language] = menu.nodeId;
    languageMenu.connect(language, menu.nodeId);
    const unavailable = text(`unavailable/${language}`, `Service unavailable (${language})`, t.unavailable);
    edge(unavailable, menu.nodeId);
    const aiMenu = buttons(`ai/${language}`, `AI services (${language})`, t.aiMenu,
      [['chat', t.chat], ['image', t.image], ['back', t.back]], 'ai_service');
    menu.connect('ai', aiMenu.nodeId);
    aiMenu.connect('back', menu.nodeId);

    const productQuestion = question(`booking/${language}/product`, `Booking product (${language})`, t.product, 'product_name');
    menu.connect('booking', gate(`booking/${language}`, productQuestion));
    const products = http(`booking/${language}/products`, 'Find products in catalog', '/v1/auth/check-category', {
      session_data: { category: '{{product_name}}', catalog_id: catalogId },
    });
    edge(productQuestion, products);
    const productExists = condition(`booking/${language}/found`, 'Matching products found?', [
      equals('http_response.success', true), notEmpty('http_response.data'),
    ]);
    edge(products, productExists);
    const catalog = add(`booking/${language}/catalog`, '@whatsapp/send-product-message', `Booking catalog (${language})`, {
      message: { type: 'interactive', interactive: { type: 'product_list', action: { catalog_id: catalogId } } },
    });
    edge(productExists, catalog, undefined, true);
    const noProducts = condition(`booking/${language}/empty`, 'Product search completed without matches?', [
      equals('http_status', 200), equals('http_response.success', false),
      equals('http_response.message', 'No matching product variants found'),
    ]);
    edge(productExists, noProducts, undefined, false);
    const retryProduct = question(`booking/${language}/retry`, `Try another product (${language})`, t.noProducts, 'product_name');
    edge(noProducts, retryProduct, undefined, true);
    edge(noProducts, unavailable, undefined, false);
    edge(retryProduct, products);

    for (const kind of ['chat', 'image']) {
      const prompt = question(`ai/${language}/${kind}/question`, `${kind} request (${language})`,
        kind === 'chat' ? t.problem : t.photo, kind === 'chat' ? 'chat' : 'image_url', kind === 'chat' ? 'text' : 'image');
      aiMenu.connect(kind, gate(`ai/${language}/${kind}`, prompt));
      // Preserve the supplied AI request envelope. No service calls the registration endpoint.
      const request = http(`ai/${language}/${kind}/request`, `${kind} AI request (${language})`,
        `/api/ai/${kind === 'chat' ? 'chat' : 'image-detection'}`, { data: '{{variable}}' });
      edge(prompt, request);
      const success = condition(`ai/${language}/${kind}/success`, 'AI answer received?', [
        equals('http_response.success', true), notEmpty('http_response.data.answer'),
      ]);
      edge(request, success);
      const answer = text(`ai/${language}/${kind}/answer`, `AI answer (${language})`, '{{http_response.data.answer}}');
      edge(success, answer, undefined, true);
      edge(success, unavailable, undefined, false);
      edge(answer, menu.nodeId);
    }
    // This exact prompt also makes the existing sender attach the generated Excel sample.
    const importPrompt = language === 'en'
      ? 'd9dd4067-8559-4f77-9988-9940228a534a'
      : question(`import/${language}/upload`, `FPO lead upload (${language})`,
        'Please Import excel file for onboarding fpo leads', 'excel_file', 'document');
    const promptNode = node(importPrompt);
    promptNode.data.title = `FPO lead upload (${language})`;
    promptNode.data.attributes.resumeOnFpoImport = true;
    importPrompts[language] = importPrompt;
    menu.connect('import', gate(`import/${language}`, importPrompt));
    redirect(importPrompt, menu.nodeId);
  }

  // FPO registration retains the original upload step; other roles continue to services.
  const hindi = condition('registration-services/hindi', 'Continue registration in Hindi?', [
    equals('native_language', 'हिंदी'), equals('native_language', 'hindi'),
  ], 'or');
  const telugu = condition('registration-services/telugu', 'Continue registration in Telugu?', [
    equals('native_language', 'తెలుగు'), equals('native_language', 'telugu'),
  ], 'or');
  edge(hindi, serviceMenus.hi, undefined, true);
  edge(hindi, telugu, undefined, false);
  edge(telugu, serviceMenus.te, undefined, true);
  edge(telugu, serviceMenus.en, undefined, false);
  const fpoWelcomeLanguages = {
    '19b0b848-0763-40b8-94f4-5e1360f40434': 'en',
    '20804977-a74d-4e8c-bd50-64d3b1064ee2': 'hi',
    'dd6c1d42-01f1-43fd-a630-4a9e3b89ec36': 'te',
  };
  for (const n of flow.nodes) {
    if (n.data.attributes?.message?.text?.body === '{{registration_welcome}}') {
      const fpoLanguage = fpoWelcomeLanguages[n.id];
      redirect(n.id, fpoLanguage ? importPrompts[fpoLanguage] : hindi);
    }
  }
  // Existing users never finish at an "already exists" dead end.
  for (const nodeId of ['82f4c893-a7ea-4fe9-b551-d8e7730e12bc', '5a0f6f4c-3d00-4f3b-977e-e2557926fa52',
    '708c9957-d4df-42f2-ae7d-9ef2969c7545', 'd0136e35-35b2-4534-a728-45f80003c2d1']) {
    node(nodeId).data.attributes.message.text.body = 'Welcome back to Krishivan.';
    redirect(nodeId, languageMenu.nodeId);
  }
  for (const nodeId of ['32a52064-9175-4ba0-834b-4e065ec394b5', '1617c2fb-b009-47f0-9bc8-d29854fd7bc1',
    '256f6b68-07bd-49cb-9b59-32bbbf27b184', '407175f3-0765-44e4-b039-9c29367ec369']) {
    node(nodeId).data.attributes.conditions = registeredConditions();
  }

  // Remove obsolete, unreachable nodes.
  const reachable = new Set([trigger.id]);
  const pending = [trigger.id];
  while (pending.length) {
    const sourceId = pending.shift();
    for (const e of flow.edges.filter(e => e.source === sourceId)) {
      if (!reachable.has(e.target)) { reachable.add(e.target); pending.push(e.target); }
    }
  }
  flow.nodes = flow.nodes.filter(n => reachable.has(n.id));
  flow.edges = flow.edges.filter(e => reachable.has(e.source) && reachable.has(e.target));
  // Interactive handles must be stored in edge JSON, because database rows have no sourceHandle column.
  for (const e of flow.edges) {
    const source = node(e.source);
    if (['@whatsapp/send-button-message', '@whatsapp/send-list-message'].includes(source.data.key)) {
      e.data = { ...e.data, button_id: e.sourceHandle, sourceHandle: e.sourceHandle };
    }
  }
  return flow;
}

if (require.main === module) {
  const output = path.join(__dirname, '..', 'krishivan-unified.flow.json');
  const flow = buildUnifiedFlow();
  fs.writeFileSync(output, `${JSON.stringify(flow, null, 2)}\n`);
  console.log(`Wrote ${output}: ${flow.nodes.length} nodes, ${flow.edges.length} edges.`);
}

module.exports = { buildUnifiedFlow };

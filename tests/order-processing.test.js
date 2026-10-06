const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function runtime(options = {}) {
  const source = ts.createSourceFile('message.service.ts', fs.readFileSync(path.join(__dirname, '../src/app/services/message.service.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const serviceClass = source.statements.find(node => ts.isClassDeclaration(node));
  const methods = ['processIncomingOrderMessage', 'rejectIncomingOrder', 'productOrderProcessor', 'leadOrderConfirmation'];
  const sourceText = `class MessageService { ${serviceClass.members.filter(member => methods.includes(member.name?.getText(source))).map(member => member.getText(source)).join('\n')} }\nnew MessageService();`;
  const calls = { users: [], parent: [], products: [], orders: [], replies: [], confirmations: [], sessions: [], updates: [] };
  class BadRequest extends Error { constructor({ message }) { super(message); this.statusCode = 400; } }
  const service = vm.runInNewContext(ts.transpileModule(sourceText, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    console: { log() {}, warn() {} }, HTTP400Error: BadRequest,
    userModel: {
      findByPhone: async phone => { calls.users.push(phone); return options.customer; },
      findById: async id => { calls.parent.push(id); return options.fpo; },
    },
    productVariantModel: { findByRetailerId: async id => { calls.products.push(id); return options.products?.[id]; } },
    axios: { post: async (url, payload) => {
      calls.orders.push({ url, payload });
      if (options.apiError) throw options.apiError;
      return { data: options.apiResponse ?? { success: true, orderId: 'registered-order' } };
    } },
    chatSessionModel: {
      findActiveByPhoneNumberId: async (...args) => { calls.sessions.push(args); return { id: 'current-session' }; },
      update: async (...args) => { calls.updates.push(args); },
    },
  });
  service.sendChatBotMessage = async (...args) => { calls.replies.push(args); return {}; };
  service.sendMessage = async data => { calls.confirmations.push(data); return {}; };
  return { service, calls };
}

const customer = { id: 'customer', parent_user_id: 'fpo', role_id: 'FARMER-1', company_id: 'company' };
const fpo = { id: 'fpo', phone: '919876543210' };
function orderData() {
  return {
    from: '919372597458', phoneNumberId: 'receiving-number', catalogId: 'catalog', orderId: 'incoming-message',
    selectedProducts: ['product-1'],
    orderDetails: [{ productId: 'product-1', productName: 'Tarpaulin', quantity: 2, salePrice: '4000.00', unit: '2', category: 'hardware', subCategory: 'tarpaulins', discount: 0 }],
  };
}

test('unknown or deleted customers receive a registration reply without a parent lookup or order submission', async () => {
  for (const invalidCustomer of [undefined, { ...customer, deleted_at: new Date() }]) {
    const { service, calls } = runtime({ customer: invalidCustomer });
    const result = await service.productOrderProcessor(orderData());
    assert.equal(result.reason, 'CUSTOMER_NOT_FOUND');
    assert.equal(calls.parent.length, 0);
    assert.equal(calls.orders.length, 0);
    assert.equal(calls.replies.length, 1);
    assert.equal(calls.confirmations.length, 0);
  }
});

test('null or absent parent_user_id is handled without querying an undefined FPO ID', async () => {
  for (const parent_user_id of [null, undefined, '']) {
    const { service, calls } = runtime({ customer: { ...customer, parent_user_id } });
    const result = await service.productOrderProcessor(orderData());
    assert.equal(result.success, false);
    assert.equal(result.reason, 'FPO_NOT_MAPPED');
    assert.equal(calls.parent.length, 0);
    assert.equal(calls.orders.length, 0);
    assert.match(calls.replies[0][2].text, /not linked to an FPO/);
  }
});

test('missing, deleted, or phoneless FPO records do not cause destructuring errors', async () => {
  for (const invalidFpo of [undefined, { ...fpo, deleted_at: new Date() }, { id: 'fpo' }]) {
    const { service, calls } = runtime({ customer, fpo: invalidFpo });
    const result = await service.productOrderProcessor(orderData());
    assert.equal(result.reason, 'FPO_NOT_FOUND');
    assert.deepEqual(calls.parent, ['fpo']);
    assert.equal(calls.orders.length, 0);
    assert.equal(calls.replies.length, 1);
  }
});

test('missing customer role blocks an incomplete booking payload', async () => {
  const { service, calls } = runtime({ customer: { ...customer, role_id: null }, fpo });
  assert.equal((await service.productOrderProcessor(orderData())).reason, 'CUSTOMER_ROLE_MISSING');
  assert.equal(calls.orders.length, 0);
});

test('valid mappings submit the order, calculate totals, and confirm using the receiving number', async () => {
  const { service, calls } = runtime({ customer, fpo });
  const result = await service.productOrderProcessor(orderData());
  assert.equal(result.data.orderId, 'registered-order');
  assert.equal(calls.orders.length, 1);
  const payload = calls.orders[0].payload;
  assert.equal(payload.firm, fpo.phone);
  assert.equal(payload.user_id, customer.role_id);
  assert.equal(payload.createdById, customer.parent_user_id);
  assert.equal(payload.total_price, 8000);
  assert.equal(payload.cart[0].category[0], 'hardware');
  assert.equal(payload.cart[0].subcategory[0], 'tarpaulins');
  assert.equal(calls.confirmations[0].phone_number_id, 'receiving-number');
  assert.match(calls.confirmations[0].text.body, /registered-order/);
  assert.equal(calls.replies.length, 0);
  assert.deepEqual(calls.sessions, [['919372597458', 'receiving-number']]);
  assert.equal(calls.updates[0][0], 'current-session');
});

test('failed external booking does not send success or close the conversation', async () => {
  const { service, calls } = runtime({ customer, fpo, apiResponse: { success: false } });
  await service.productOrderProcessor(orderData());
  assert.equal(calls.confirmations.length, 0);
  assert.equal(calls.sessions.length, 0);
  assert.equal(calls.updates.length, 0);
});

test('upstream failures propagate for webhook retry rather than reporting a successful order', async () => {
  const apiError = new Error('Order service unavailable');
  const { service, calls } = runtime({ customer, fpo, apiError });
  await assert.rejects(service.productOrderProcessor(orderData()), error => error === apiError);
  assert.equal(calls.confirmations.length, 0);
  assert.equal(calls.updates.length, 0);
});

test('webhook quantities and DB category fields survive order construction', async () => {
  const { service, calls } = runtime({ customer, fpo, products: {
    retailer: { id: 'product-1', retailer_id: 'retailer', name: 'Tarpaulin', price: '4000.00', quantity: '99', unit: '2', category: 'hardware', sub_category: 'tarpaulins' },
  } });
  await service.processIncomingOrderMessage({ type: 'order', from: '919372597458', phone_number_id: 'receiving-number', id: 'incoming-message', order: { catalog_id: 'catalog', product_items: [{ product_retailer_id: 'retailer', quantity: '2' }] } });
  const payload = calls.orders[0].payload;
  assert.equal(payload.cart[0].qty, 2);
  assert.equal(payload.total_price, 8000);
  assert.equal(payload.cart[0].category[0], 'hardware');
  assert.equal(payload.cart[0].subcategory[0], 'tarpaulins');
  assert.equal(payload.cart[0].discount, 0);
});

test('missing products reject the complete order instead of silently dropping lines', async () => {
  const { service, calls } = runtime({ customer, fpo });
  const result = await service.processIncomingOrderMessage({ type: 'order', from: 'customer-phone', phone_number_id: 'receiving-number', id: 'message', order: { catalog_id: 'catalog', product_items: [{ product_retailer_id: 'missing', quantity: 1 }] } });
  assert.equal(result.reason, 'PRODUCT_NOT_FOUND');
  assert.equal(calls.orders.length, 0);
  assert.equal(calls.users.length, 0);
  assert.equal(calls.replies.length, 1);
});

test('malformed order messages fail validation before product or user queries', async () => {
  const validMessage = { type: 'order', from: 'customer-phone', phone_number_id: 'receiving-number', id: 'message', order: { catalog_id: 'catalog', product_items: [{ product_retailer_id: 'retailer', quantity: 1 }] } };
  for (const invalidMessage of [null, {}, { type: 'order' }, { ...validMessage, from: undefined }, { ...validMessage, order: { catalog_id: 'catalog', product_items: [] } }, { ...validMessage, order: { ...validMessage.order, product_items: [{ product_retailer_id: 'retailer', quantity: 0 }] } }]) {
    const { service, calls } = runtime();
    await assert.rejects(service.processIncomingOrderMessage(invalidMessage), error => error.statusCode === 400);
    assert.equal(calls.products.length, 0);
    assert.equal(calls.users.length, 0);
  }
});

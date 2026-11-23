const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const text = fs.readFileSync(path.join(__dirname, '../docs/frontend/WhySoft7.jsx'), 'utf8');
const source = ts.createSourceFile('WhySoft7.jsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
let handler;
let heroHandler;
const buttons = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleFormSubmit') handler = node.initializer.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleGetFreeSetupClick') heroHandler = node.initializer.getText(source);
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'motion.button' &&
    node.attributes.properties.some(attr => attr.name?.getText(source) === 'type' && attr.initializer?.text === 'submit')) buttons.push(node);
  ts.forEachChild(node, visit);
}
visit(source);

function runtime({ fetchResult, fetchError, invalid = false, form = {}, fetchImplementation } = {}) {
  const requests = [], submitted = [], errors = [], states = [], timers = new Map();
  let timerId = 0;
  const context = {
    LEAD_API_URL: '/api/why-soft7-leads', AbortController,
    requestInFlightRef: { current: false }, activeRequestRef: { current: null },
    popupCloseTimerRef: { current: null }, mountedRef: { current: true },
    console: { error() {} }, toast: { error: message => errors.push(message) },
    setSubmittingForm: value => states.push(value),
    setFormErrors: update => update({}), setShowExitPopup() {},
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, config) => {
      requests.push({ url, config });
      if (fetchImplementation) return fetchImplementation(config);
      if (fetchError) throw fetchError;
      return fetchResult || new Response(JSON.stringify({ success: true }), { status: 201 });
    },
  };
  for (const name of ['aboveFold', 'features', 'bottom', 'popup']) {
    context[`${name}Form`] = { name: '  Sample Person  ', phone: ' 9876543210 ', company: ' Example ', volume: '10k-50k', ...form };
    context[`set${name[0].toUpperCase()}${name.slice(1)}FormSubmitted`] = value => submitted.push({ form: name, value });
  }
  const submit = vm.runInNewContext(`(${handler})`, context);
  return {
    requests, submitted, errors, states, context,
    event: () => ({ preventDefault() {}, currentTarget: { tagName: 'BUTTON', form: { reportValidity: () => !invalid } } }),
    submit, timeout: () => [...timers.values()][0](),
  };
}

test('the full component parses and all four buttons and forms point to the shared request handler', () => {
  assert.equal(source.parseDiagnostics.length, 0);
  assert.equal(buttons.length, 4);
  const forms = buttons.map(button => {
    const click = button.attributes.properties.find(attr => attr.name?.getText(source) === 'onClick').getText(source);
    return click.includes('handleGetFreeSetupClick') ? 'aboveFold' : click.match(/handleFormSubmit\(e, '([^']+)'\)/)[1];
  });
  assert.deepEqual(forms.sort(), ['aboveFold', 'bottom', 'features', 'popup']);
  assert.equal((text.match(/onSubmit=\{\(e\) => handleFormSubmit/g) || []).length, 3);
  assert(text.includes('onSubmit={handleGetFreeSetupClick}'));
});

test('every button path posts its trimmed form and marks success only after the response', async () => {
  for (const name of ['aboveFold', 'features', 'bottom', 'popup']) {
    const rt = runtime();
    const click = name === 'aboveFold'
      ? vm.runInNewContext(`(${heroHandler})`, { handleFormSubmit: rt.submit })
      : event => rt.submit(event, name);
    await click(rt.event());
    assert.equal(rt.requests.length, 1);
    assert.equal(rt.requests[0].url, '/api/why-soft7-leads');
    assert.equal(rt.requests[0].config.method, 'POST');
    assert.deepEqual(JSON.parse(rt.requests[0].config.body), {
      name: 'Sample Person', phone: '9876543210', company: 'Example', volume: '10k-50k', source: name,
    });
    assert.deepEqual(rt.submitted, [{ form: name, value: true }]);
    assert.deepEqual(rt.states, [name, null]);
    assert.equal(rt.errors.length, 0);
  }
});

test('invalid browser fields and whitespace-only required values do not send a request', async () => {
  for (const options of [{ invalid: true }, { form: { name: '   ' } }, { form: { phone: '  ' } }, { form: { company: '' } }]) {
    const rt = runtime(options);
    await rt.submit(rt.event(), 'aboveFold');
    assert.equal(rt.requests.length, 0);
    assert.equal(rt.submitted.length, 0);
  }
});

test('a click followed by another submission while pending produces only one POST', async () => {
  let release;
  const rt = runtime({ fetchImplementation: () => new Promise(resolve => { release = resolve; }) });
  const first = rt.submit(rt.event(), 'features');
  await rt.submit(rt.event(), 'features');
  assert.equal(rt.requests.length, 1);
  assert.equal(rt.submitted.length, 0);
  release(new Response(JSON.stringify({ success: true }), { status: 201 }));
  await first;
  assert.equal(rt.submitted.length, 1);
  assert.equal(rt.context.requestInFlightRef.current, false);
});

test('HTTP errors, application errors, HTML responses and network failures never show success', async () => {
  for (const options of [
    { fetchResult: new Response(JSON.stringify({ error: { message: 'Route not found' } }), { status: 404 }) },
    { fetchResult: new Response(JSON.stringify({ message: 'Service unavailable' }), { status: 500 }) },
    { fetchResult: new Response(JSON.stringify({ success: false, message: 'Could not save' }), { status: 200 }) },
    { fetchResult: new Response('<!doctype html><html>Application</html>', { status: 200 }) },
    { fetchError: new Error('Failed to fetch') },
  ]) {
    const rt = runtime(options);
    await rt.submit(rt.event(), 'bottom');
    assert.equal(rt.submitted.length, 0);
    assert.equal(rt.errors.length, 1);
    assert.equal(rt.states.at(-1), null);
    assert.equal(rt.context.requestInFlightRef.current, false);
  }
});

test('a timed-out request restores the button and reports the timeout', async () => {
  const rt = runtime({ fetchImplementation: config => new Promise((_, reject) => {
    config.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
  }) });
  const result = rt.submit(rt.event(), 'popup');
  rt.timeout();
  await result;
  assert.equal(rt.submitted.length, 0);
  assert.match(rt.errors[0], /timed out/);
  assert.equal(rt.context.requestInFlightRef.current, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentTargets } from '../lib/deployTargets.js';
test('authentication migration scopes only its functions and includes indexes',()=>{
  const plan=deploymentTargets(['functions/index.js','functions/lib/appAuth.js'],"+export { appAuth } from './lib/appAuth.js';");
  assert.ok(plan.includes('functions:appAuth'));
  assert.ok(!plan.split(',').includes('functions'));
  assert.ok(plan.includes('firestore:indexes'));
});
test('unknown index body or unrelated source changes keep broad fallback',()=>{
  assert.ok(deploymentTargets(['functions/index.js'],'+export const newFeature = 1;').startsWith('functions,'));
  assert.ok(deploymentTargets(['functions/index.js'],"+export { unknownFunction } from './lib/appAuth.js';").startsWith('functions,'));
  assert.equal(deploymentTargets(['functions/mcp/server.js']),'functions:mcp');
  assert.ok(deploymentTargets(['functions/lib/appAuth.js'],'',false).startsWith('functions,'));
});

test('MCP photo/finance changes do not redeploy unrelated app, calendar, or rules',()=>{
  assert.equal(deploymentTargets(['functions/mcp/tools/events.js','functions/mcp/tools/finance.js','functions/lib/moneyExpression.js','src/components/shared/PhotoLightbox.jsx']),'functions:mcp');
});
test('test and rules changes alone do not overwrite production functions',()=>{
  assert.equal(deploymentTargets(['functions/test/appAuth.test.js','firestore.rules']),'firestore:rules,firestore:indexes');
});
test('scoped read helper stays within app functions',()=>{
  const plan=deploymentTargets(['functions/lib/appAuth.js','functions/lib/appScopedReads.js']);
  assert.ok(plan.includes('functions:appReadData'));
  assert.ok(plan.includes('functions:appWidgetData'));
  assert.ok(!plan.split(',').includes('functions'));
});

test('calendar detachment deploys its consumers without deploying unrelated functions', () => {
  const files = ['functions/index.js', 'functions/lib/appAuth.js', 'functions/lib/detachOccurrence.js',
    'functions/lib/appRecurrence.js', 'functions/lib/recurring.js', 'functions/mcp/tools/events.js'];
  const diff = '@@ -370 +370 @@ export const sendEventNotification = onDocumentCreated(\n'
    + '-    if (!event.data) return;\n'
    + '+    if (!event.data || event.data.data().detachedFrom) return;';
  const plan = deploymentTargets(files, diff).split(',');
  for (const target of ['mcp', 'appWriteData', 'sendEventNotification', 'syncEventReminders', 'dailyScheduleDigest']) {
    assert.ok(plan.includes('functions:' + target));
  }
  assert.ok(!plan.includes('functions'));
  assert.ok(deploymentTargets(files, diff + '\n+anotherChange();').startsWith('functions,'));
});

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
  assert.ok(deploymentTargets(['functions/mcp/server.js']).startsWith('functions,'));
  assert.ok(deploymentTargets(['functions/lib/appAuth.js'],'',false).startsWith('functions,'));
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

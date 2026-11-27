export const APP_FUNCTIONS = ['appAuth','appAccount','appReadData','appWriteData','appSharedSchedule','appWidgetData','appProfileChanged','appAdminCredentialChanged','appStaffCredentialChanged','appReadEventChanged','appReadReportChanged','appReadCalendarChanged','appReadAssignmentChanged','appReadUserChanged','confirmMonthlySettlement','calendarFeed','widgetEventChanged','widgetCalChanged'];

// Fail back to the existing whole-functions deployment for unknown runtime
// changes. This migration must not redeploy unrelated MCP/Google/ICS code.
export function deploymentTargets(files, indexDiff = '', configUnchanged = true) {
  const runtime = files.filter(f=>f.startsWith('functions/') && !f.startsWith('functions/test/') && !['functions/lib/deployTargets.js','functions/scripts/deploy-targets.mjs'].includes(f));
  if(configUnchanged && runtime.length && runtime.every(f=>f.startsWith('functions/mcp/')||f==='functions/lib/moneyExpression.js')) {
    return ['functions:mcp',...(files.includes('firestore.rules')?['firestore:rules']:[]),...(files.includes('firestore.indexes.json')?['firestore:indexes']:[])].join(',');
  }
  const lines = indexDiff.split("\n").filter(line =>
    (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));
  const onlyDetachNotification = indexDiff.includes("export const sendEventNotification") && lines.length === 2
    && lines.includes("-    if (!event.data) return;")
    && lines.includes("+    if (!event.data || event.data.data().detachedFrom) return;");
  if (configUnchanged && onlyDetachNotification && runtime.includes("functions/lib/detachOccurrence.js")
    && runtime.every(file => file.startsWith("functions/mcp/") || [
      "functions/index.js", "functions/lib/appAuth.js", "functions/lib/detachOccurrence.js",
      "functions/lib/appRecurrence.js", "functions/lib/recurring.js",
    ].includes(file))) {
    return ["functions:mcp", "functions:sendEventNotification", "functions:syncEventReminders", "functions:dailyScheduleDigest", ...APP_FUNCTIONS.map(name => "functions:" + name),
      ...(files.includes("firestore.rules") ? ["firestore:rules"] : []),
      ...(files.includes("firestore.indexes.json") ? ["firestore:indexes"] : []),
    ].join(",");
  }
  const allowed = new Set(['functions/index.js','functions/lib/appAuth.js','functions/lib/sharedSchedule.js','functions/lib/appAuthCore.js','functions/lib/appRecurrence.js','functions/lib/appScopedReads.js','functions/lib/appReadChanges.js','functions/lib/widgetPush.js','functions/lib/settlement.js','functions/lib/settlementApi.js']);
  const oldFeed='    const visible = expanded.filter(ev => ev.start >= cutoff && ev.start <= horizon);';
  const newFeed='    const visible = expanded.filter(ev => ev.calId === cal && ev.start >= cutoff && ev.start <= horizon);';
  if(indexDiff.includes('-'+oldFeed)&&indexDiff.includes('+'+newFeed))indexDiff=indexDiff.replace('-'+oldFeed,'').replace('+'+newFeed,'');
  const added = indexDiff.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).map(l=>l.slice(1)).join('\n');
  const removed = indexDiff.split('\n').some(l=>l.startsWith('-')&&!l.startsWith('---')&&l.slice(1).trim());
  const knownExports=[...added.matchAll(/export\s*\{([^}]+)\}/g)].every(m=>m[1].split(',').every(n=>APP_FUNCTIONS.includes(n.trim())));
  const exportsOnly = knownExports && !removed && added.replace(/export\s*\{[^}]+\}\s*from\s*['"]\.\/lib\/(appAuth|settlementApi)\.js['"];?/g,'').trim()==='';
  const broad = !configUnchanged || runtime.some(f=>!allowed.has(f)) || (runtime.includes('functions/index.js')&&!exportsOnly);
  const functions = broad ? ['functions'] : runtime.length ? APP_FUNCTIONS.map(n=>'functions:'+n) : [];
  return [...functions,'firestore:rules','firestore:indexes'].join(',');
}

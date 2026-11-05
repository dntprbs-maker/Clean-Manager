import { execFileSync } from 'node:child_process';
import { deploymentTargets } from '../lib/deployTargets.js';
const [before,after]=process.argv.slice(2);
if(!/^[0-9a-f]{40}$/.test(before||'')||!/^[0-9a-f]{40}$/.test(after||'')) {
  // A missing/initial push baseline cannot safely infer a smaller scope.
  console.log('functions,firestore:rules,firestore:indexes');
} else {
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
  try {
    const files=git('diff','--name-only',before,after).trim().split('\n');
    const index=git('diff','--unified=0',before,after,'--','functions/index.js');
    const productionConfig=ref=>{const d=JSON.parse(git('show',ref+':firebase.json'));delete d.emulators;return JSON.stringify(d);};
    console.log(deploymentTargets(files,index,productionConfig(before)===productionConfig(after)));
  } catch { console.log('functions,firestore:rules,firestore:indexes'); }
}

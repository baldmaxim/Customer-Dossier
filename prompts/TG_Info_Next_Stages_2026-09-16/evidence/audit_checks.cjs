'use strict';
// Isolated source-level probes. No real DB, model, HTTP server, or source requests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ROOT = path.resolve(process.argv[2] || process.cwd());
const OUTPUT = path.resolve(process.argv[3] || path.join(process.cwd(), 'archive-audit-results.json'));
let ts;
for (const loc of [path.join(ROOT, 'backend/node_modules/typescript'), 'typescript', process.env.TG_INFO_TYPESCRIPT_PATH]) {
  if (!loc) continue; try { ts = require(loc); break; } catch {}
}
if (!ts) throw new Error('TypeScript compiler is required. Use the existing backend development dependencies; this script installs nothing.');
function loader(mocks = {}) {
  const cache = new Map();
  function load(rel) {
    const file = path.resolve(ROOT, rel);
    const key = path.relative(ROOT, file).replaceAll('\\', '/');
    if (Object.prototype.hasOwnProperty.call(mocks, key)) return mocks[key];
    if (cache.has(file)) return cache.get(file).exports;
    if (!file.startsWith(ROOT + path.sep)) throw new Error('outside repository');
    const src = fs.readFileSync(file, 'utf8');
    const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file });
    const mod = { exports: {} }; cache.set(file, mod);
    const req = name => {
      if (name === 'node:crypto') return require(name);
      if (name.startsWith('node:')) throw new Error('Built-in dependency not allowed in probe: ' + name);
      if (!name.startsWith('.')) throw new Error('External import not allowed in isolated probe: ' + name);
      let target = path.resolve(path.dirname(file), name).replace(/\.js$/, '.ts');
      if (!path.extname(target)) target += '.ts';
      return load(path.relative(ROOT, target));
    };
    vm.runInThisContext('(function(require,module,exports){\n'+out.outputText+'\n})', {filename:file})(req, mod, mod.exports);
    return mod.exports;
  }
  return load;
}
const results=[];
function observe(id, name, observed, reproduced, limit) { results.push({id,name,observed,reproduced,method:'isolated execution of repository code with synthetic inputs',limit:limit||'Not a PostgreSQL/browser/integration test.'}); }
const base = {id:1,version:1,title:'SYN_CASE',companyId:10,companyName:'SYN_Company',companyStatus:'selected',companyNameClaimed:null,projectId:20,projectName:'SYN_Project',projectNameClaimed:null,scopeBuilding:'корпус 2',workPackage:'water_supply',workPackageLabel:'водоснабжение',claimedRole:'contractor',claimedClientCompanyId:30,claimedClientCompanyName:'SYN_Client',claimedClientName:null,claimedTerms:null};
const fact = overrides => ({assertionId:1,version:1,predicate:'participates_in_project',role:'contractor',eventType:null,status:'candidate',origin:'extraction',needsRevalidation:false,polarity:'positive',modality:'reported_fact',subjectCompanyId:10,subjectCompanyName:'SYN_Company',subjectProjectId:null,objectCompanyId:null,objectCompanyName:null,objectProjectId:20,objectProjectName:'SYN_Project',counterpartyCompanyId:null,counterpartyCompanyName:null,contextProjectId:null,scopeBuilding:'корпус 2',workPackage:'water_supply',workPackageLabel:'водоснабжение',validFrom:'2026-01-01',validTo:null,periodPrecision:'day',caseNumber:null,proceduralRole:null,counterpartyRole:null,eventStage:null,eventOutcome:null,valueType:null,valueNumeric:null,valueCurrency:null,attributedTo:null,evidence:[{id:1,stance:'supports',quote:'Синтетическое основание.',revisionId:1,sourceItemId:1,sourceTitle:'Синтетический источник',publishedAt:'2026-09-01T00:00:00Z',dedupHash:'synthetic'}],...overrides});
const build = loader()('backend/src/dossier/caseDossier.ts').buildCaseDossier;
const dossier = (companyFacts, casePatch={}) => build({caseRow:{...base,...casePatch},generatedAt:'2026-09-16T00:00:00Z',refresh:{active:null,lastFailure:null,running:false,stale:false,staleReasons:[]},identityStatus:null,homonyms:[],companyFacts,projectFacts:[],projectState:[],openQueue:[]});
let d = dossier([fact({predicate:'contract',role:'subcontract',subjectCompanyId:30,subjectCompanyName:'SYN_Client',objectCompanyId:10,objectCompanyName:'SYN_Company',objectProjectId:null,contextProjectId:null})]);
observe('R01','Contract without project marks case chain documented',{status:d.chain.status,text:d.chain.documented[0]?.text},d.chain.status==='documented');
d = dossier([fact({}),fact({assertionId:2,polarity:'negative',scopeBuilding:'корпус 1'})]);
observe('R02','Negative about another building overrides case role',{status:d.role.status,contradictions:d.role.contradictions.length},d.role.status==='contradicted');
d = dossier([fact({}),fact({assertionId:3,polarity:'negative',status:'rejected'})]);
observe('R03','Rejected negative still overrides case role',{status:d.role.status,text:d.role.contradictions[0]?.text},d.role.status==='contradicted');
d = dossier([fact({scopeBuilding:null})]);
observe('R04','Unknown building counted as established for selected building',{status:d.role.status,established:d.role.established.length},d.role.status==='reported' && d.role.established.length===1);
d = dossier([fact({predicate:'contract',role:'subcontract',subjectCompanyId:30,subjectCompanyName:'SYN_Client',objectCompanyId:10,objectCompanyName:'SYN_Company',objectProjectId:null,contextProjectId:20,scopeBuilding:'корпус 1',workPackage:'electrical'})]);
observe('R05','Contract for another building/work package confirms chain',{status:d.chain.status,documented:d.chain.documented.length},d.chain.status==='documented');
const control=dossier([fact({scopeBuilding:'корпус 1'})]);
observe('C01','Positive control: explicitly different building is separated',{status:control.role.status,otherBuildings:control.role.otherBuildings.length},control.role.status==='not_established' && control.role.otherBuildings.length===1);
const invModule=loader({'backend/src/config/env.ts':{env:{}}})('backend/src/release/inventory.ts');
const inv={version:'local-inventory@1',takenAt:'2026-09-16',database:{name:'tg_info_test',host:'local',port:1,isTestTarget:true},migrations:{applied:20,last:'020_dossier_snapshots.sql'},counts:{assertions:1},integrity:[],sources:[],reviews:{total:0,byDecision:{}},snapshots:{total:0,redacted:0,hashAlgorithms:[]},flags:{}};
let other=structuredClone(inv); other.database.name='tg_info_test_restore'; other.migrations={applied:19,last:'019_dossier_cases.sql'};
let diff=invModule.diffInventory(inv,other);
observe('R06','Migration mismatch only note, comparison equal',{equal:diff.equal,notes:diff.notes},diff.equal===true && diff.notes.length>0);
other=structuredClone(inv);other.database.name='tg_info_test_restore';inv.counts.review_decisions=0;
diff=invModule.diffInventory(inv,other);
observe('R07','Missing empty table is treated as zero',{equal:diff.equal,counts:diff.counts},diff.equal===true);
async function asyncChecks(){
  let buildCalls=0;
  const fakeClient={query:async sql=>({rows:sql.startsWith('SELECT id, payload_hash')?[{id:7,payload_hash:'old-case-payload'}]:[],rowCount:0})};
  const snap=loader({'backend/src/db/pool.ts':{getPool:()=>fakeClient,withTransaction:fn=>fn(fakeClient)},'backend/src/snapshot/availability.ts':{},'backend/src/snapshot/build.ts':{buildSnapshotPayload:async()=>{buildCalls++;throw new Error('must not get here');},HistoricalCutoffError:class extends Error{},SNAPSHOT_SCHEMA_VERSION:'x'},'backend/src/snapshot/canonical.ts':{HASH_ALGORITHM:'sha256',payloadHash:()=>''}})('backend/src/snapshot/repository.ts');
  const s=await snap.createSnapshot({caseId:999,effectiveFrom:null,effectiveTo:null,knowledgeCutoff:null,idempotencyKey:'same-key-different-case',actor:'operator'});
  observe('R08','Snapshot key replay bypasses request case/filters check',{returned:s,buildCalls},s.replayed===true && s.id===7 && buildCalls===0,'DB lookup mocked to return an existing key. Confirms replay branch, not a real concurrency test.');
  let calls=0,policyLookups=0; const queries=[]; let revoked=false;
  const db={query:async(sql,params)=>{queries.push(sql);if(sql.includes('s.access_status')||sql.includes('policy_expires_at')) policyLookups++;
    if(sql.startsWith('SELECT body, published_at'))return {rows:[{body:'abcdefgh',published_at:null,source_item_id:1}]};
    if(sql.startsWith('SELECT status, fencing_token'))return {rows:[{status:'running',fencing_token:1}]};
    if(sql.startsWith('SELECT id, chunk_index'))return {rows:[{id:1,chunk_index:0,range_start:0,range_end:4,status:'pending',attempts:0},{id:2,chunk_index:1,range_start:4,range_end:8,status:'pending',attempts:0}]};
    if(sql.includes('RETURNING attempts'))return {rows:[{attempts:1}]};
    return {rows:[],rowCount:1};}};
  const runMod=loader({'backend/src/db/pool.ts':{getPool:()=>db,withTransaction:fn=>fn(db)},'backend/src/ingest/policy.ts':{approvedPolicySql:()=> 'POLICY_APPROVED',evaluateSourcePolicy:()=>({allowed:!revoked})},'backend/src/reprocess/candidates.ts':{buildCandidates:()=>{throw new Error('unused');}},'backend/src/reprocess/chunking.ts':{planCodePointChunks:()=>[{index:0,start:0,end:4,text:'abcd'},{index:1,start:4,end:8,text:'efgh'}],computeCoverage:()=>({complete:true,coveredChars:8})},'backend/src/reprocess/provider.ts':{}})('backend/src/reprocess/runs.ts');
  try{await runMod.processRun({provider:'synthetic',model:'MODEL_B',schemaVersion:'extract@3',params:{},extract:async()=>{calls++;revoked=true;return {ok:true,data:{doc_relevant:false},rawResponse:'{}',usage:{tokensIn:0,tokensOut:0,latencyMs:0}};}},{runId:1,revisionId:1,fencingToken:1,owner:'SYNTHETIC',chunker:{chunkSize:4,maxChunks:2,overlap:0}},{beforeFinalize:async()=>{throw new Error('PROBE_STOP_BEFORE_FINALIZE');}});}catch(e){if(e.message!=='PROBE_STOP_BEFORE_FINALIZE')throw e;}
  observe('R09','No policy recheck between two provider calls',{providerCalls:calls,policyLookups,revokedAfterFirst:true},calls===2 && policyLookups===0,'Executor and chunk planning mocked; no source text/model/DB contacted. Does not test racing revocation during an already in-flight call.');
  const fpReads=queries.filter(q=>q.includes('fingerprint'));
  observe('R10','processRun does not validate runtime provider fingerprint',{providerCalls:calls,fingerprintReads:fpReads.length},calls===2 && fpReads.length===0,'Confirms processRun accepts externally supplied provider without querying recorded fingerprint. Queue/DB integration not executed.');
}
function syntaxScan(){
  const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','dist'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(ts|tsx)$/.test(e.name))files.push(p);}}walk(ROOT);
  const syntax=[];const missing=[];let transpiled=0,relativeImports=0;
  for(const file of files){const src=fs.readFileSync(file,'utf8');const sf=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);for(const d of sf.parseDiagnostics||[])syntax.push({file:path.relative(ROOT,file),message:ts.flattenDiagnosticMessageText(d.messageText,' ')});
  if(!file.endsWith('.d.ts')){ts.transpileModule(src,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});transpiled++;}
  for(const m of src.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g)){relativeImports++;let p=path.resolve(path.dirname(file),m[1]);const candidates=[p,p.replace(/\.js$/,'.ts'),p.replace(/\.js$/,'.tsx'),p+'.ts',p+'.tsx',path.join(p,'index.ts'),path.join(p,'index.tsx')];if(!candidates.some(x=>fs.existsSync(x)))missing.push({file:path.relative(ROOT,file),path:m[1]});}}
  return {typescript:ts.version,files:files.length,transpiled,syntaxDiagnostics:syntax,relativeImports,unresolvedRelativeImports:missing,note:'Syntactic parsing/transpilation and local path checks only; NOT typecheck, full build, or dependency API validation.'};
}
(async()=>{await asyncChecks();const output={version:'archive-audit@1',source:ROOT,node:process.version,checkedAt:new Date().toISOString(),results,scan:syntaxScan(),limitations:['No Docker/PostgreSQL/browser/model/live sources were started.','npm ci failed due to EAI_AGAIN registry.npmjs.org; full unit/typecheck/build not rerun.','Mocks isolate code branches, not database transactions or runtime concurrency.']};fs.writeFileSync(OUTPUT,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});

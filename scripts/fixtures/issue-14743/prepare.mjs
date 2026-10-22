import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
const home = process.argv[2];
if (!home?.startsWith("/tmp/issue-14743-"))
  throw new Error("Use a disposable /tmp/issue-14743- home");
mkdirSync(`${home}/userdata`, { recursive: true });
const cleanup = {
  worktreeAfterDays: null,
  worktreeSettledAfterDays: null,
  worktreeOnMerge: false,
  worktreeOnDelete: false,
  worktreeUnchanged: false,
  browserArtifactsAfterDays: null,
  logsAfterDays: null,
  worktreeKeepWhen: "uncommitted-changes",
};
writeFileSync(
  `${home}/userdata/settings.json`,
  JSON.stringify({ storageCleanup: cleanup, projectSettingsOverrides: {} }, null, 2),
);
mkdirSync(`${home}/project`, { recursive: true });
execFileSync("git", ["init", "--quiet", `${home}/project`]);
for (const [name, sha] of [
  ["before", "22840ab943b8418744b48223411e46ba4fdcef1a"],
  ["after", "d28e64cfc1a2d17f12681a22b6487fbc05023821"],
]) {
  const src = execFileSync(
    "git",
    ["show", `${sha}:apps/web/src/components/settings/StorageSettings.tsx`],
    { cwd: root, encoding: "utf8" },
  );
  const control = src.slice(
    src.indexOf("function RetentionControl("),
    src.indexOf("const KEEP_WHEN_LABELS"),
  );
  const dir = `${root}/apps/web/src/evidence-14743`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}/${name}.tsx`,
    `import React,{useState,useRef,useLayoutEffect} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {Switch} from '../components/ui/switch';\nimport {NumberField,NumberFieldDecrement,NumberFieldGroup,NumberFieldIncrement,NumberFieldInput} from '../components/ui/number-field';\nimport '../index.css';\n${control}\nconst logs=[];let pending=[];let publish;let reset;window.proof={logs,pending,resolve:(id,ok,value)=>{const p=pending.find(p=>p.id===id);if(!p)throw new Error("Unknown pending request "+id);if(p.settled)throw new Error("Already settled request "+id);p.settled=true;logs.push({ack:id,ok,value,at:new Date().toISOString()});if(value!==undefined)publish(value);p.resolve(ok)},broadcast:v=>{logs.push({broadcast:v});publish(v)},reset:()=>reset()};\nfunction App(){const [value,setValue]=useState(null);const [key,setKey]=useState(0);const [mode,setMode]=useState('success');const [log,setLog]=useState([]);publish=setValue;reset=()=>{setValue(null);setKey(k=>k+1);pending.length=0;logs.length=0;setLog([])};return <main className="p-8 space-y-6"><h1>Actual RetentionControl component harness — ${name}</h1><p>Controlled callback outcomes; NOT real scoped runner / persistence proof.</p><p>Source ${sha}; pending requests require explicit acknowledgement.</p><label>Callback mode <select value={mode} onChange={e=>setMode(e.target.value)}><option>success</option><option>pending</option><option>failure</option></select></label><section className="flex items-center justify-between border p-4"><span>Delete inactive worktrees</span><RetentionControl key={key} label="Delete inactive worktrees" value={value} onChange={v=>{const id=logs.filter(x=>'request' in x).length+1;logs.push({request:id,value:v,at:new Date().toISOString()});setLog([...logs]);if(mode==='success'){setValue(v);return Promise.resolve(true)}if(mode==='failure')return Promise.resolve(false);return new Promise(resolve=>pending.push({id,value:v,resolve}))}}/></section><button onClick={()=>reset()}>Reset seed</button><button onClick={()=>setLog([...logs])}>Refresh log</button><button>Outside focus target</button><pre>{JSON.stringify({authoritative:value,requests:log},null,2)}</pre></main>}createRoot(document.getElementById('root')).render(<App/>);`,
  );
  writeFileSync(
    `${root}/apps/web/evidence-14743-${name}.html`,
    `<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/src/evidence-14743/${name}.tsx"></script></body></html>`,
  );
}
console.log(
  "Prepared fresh isolated home and exact-source component harnesses. Start dev with --home-dir " +
    home,
);

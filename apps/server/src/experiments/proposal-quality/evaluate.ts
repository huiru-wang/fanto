/** Offline scorer for live-agent replay exports; NOT a keyword-based decision classifier. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

type TestCase = {id:string;domain:string;expected:{decision:string;changeKind?:string;targetProjectAlias?:string}};
type Outcome = {id:string;decision:string;changeKind?:string;targetProjectAlias?:string};

const file=resolve(dirname(fileURLToPath(import.meta.url)),"cases.json");
const cases=JSON.parse(readFileSync(file,"utf8")) as TestCase[];
const path=process.argv[2];
if(!path) {console.error("Usage: pnpm exec tsx src/experiments/proposal-quality/evaluate.ts results.json");process.exit(1);}
const outcomes=JSON.parse(readFileSync(resolve(path),"utf8")) as Outcome[];
const byId=new Map(outcomes.map(row=>[row.id,row]));
let correct=0,complete=0;const errors:unknown[]=[];const totals:Record<string,{matched:number;tested:number}>={};
for(const c of cases){
 const actual=byId.get(c.id);if(!actual)continue;complete++;
 const expected=c.expected;
 const pass=actual.decision===expected.decision && (expected.decision!=="extend" ||
   (actual.changeKind===expected.changeKind&&actual.targetProjectAlias===expected.targetProjectAlias));
 if(pass)correct++;else errors.push({id:c.id,domain:c.domain,expected,actual});
 totals[c.domain]??={matched:0,tested:0};totals[c.domain]!.tested++;if(pass)totals[c.domain]!.matched++;
}
console.log(JSON.stringify({total:cases.length,reported:complete,correct,exactMatch:complete?correct/complete:null,byDomain:totals,errors},null,2));
if(complete!==cases.length||errors.length)process.exitCode=1;

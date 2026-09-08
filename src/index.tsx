import { K8s, registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Alert, Box, Chip, Dialog, DialogContent, DialogTitle, Divider, Stack, Typography } from '@mui/material';
import React from 'react';
import PenroseObserver from './penrose';

type Score = number | null;
type FabricStatus = {node:string; observedAt?:string; frr?:{bgp?:unknown}; pathRankings?:Record<string,unknown>;
  peerRoutes?:Array<{name?:string;provider?:string;failureDomain?:string;gateway?:string;tunnel?:string;asn?:number}>;
  routeDynamics?:{samples?:number;bgpChanges?:number;routeChanges?:number}; [key:string]:unknown};
type QualitySnapshot = {sourceNode:string;sourcePlane:string;observedAt?:string;
  paths?:Array<{lossRatio?:number;p95Ms?:number}>;dns?:Array<{failureRatio?:number}>;
  history?:{windowSamples?:number;lossStdDev?:number;p95StdDevMs?:number};[key:string]:unknown};
type OsiSnapshot = {observedAt:string;o:Score;s:Score;i:Score};
type Row = OsiSnapshot & {node:string;confidence:Score;diagnosis:string;evidence:unknown;history:OsiSnapshot[]};

const FRESHNESS_MS=120000; const HISTORY_KEY='re8ch.advanced-fabric.osi-history.v1'; const HISTORY_LIMIT=96;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const rounded=(v:Score)=>v===null?null:Math.round(v*1000)/1000;
const fresh=(v?:{observedAt?:string})=>{const t=Date.parse(v?.observedAt||'');return Number.isFinite(t)&&Date.now()-t<=FRESHNESS_MS;};

function bgpPeers(value:any):[number,number]{let up=0; let total=0;function visit(v:any){if(!v||typeof v!=='object')return;
  for(const [key,child] of Object.entries(v))if(key==='peers'&&child&&typeof child==='object')for(const peer of Object.values(child) as any[]){
    total++;if(String(peer?.state||peer?.peerState).toLowerCase()==='established')up++;}else visit(child);}visit(value);return[up,total];}

function score(status:FabricStatus,quality:QualitySnapshot[]):Omit<Row,'history'>{
  const samples=quality.filter(x=>x.sourceNode===status.node); const current=samples.filter(fresh);
  const host=current.find(x=>x.sourcePlane==='host'); const pod=current.find(x=>x.sourcePlane==='pod');
  const paths=current.flatMap(x=>x.paths||[]);let o:Score=null; let s:Score=null; let i:Score=null;
  if(paths.length&&paths.every(x=>x.lossRatio!==undefined)){
    const success=paths.reduce((sum,x)=>sum+1-clamp(Number(x.lossRatio)),0)/paths.length;
    const latency=paths.map(x=>x.p95Ms).filter((x):x is number=>Number.isFinite(x));
    if(latency.length)o=clamp(.7*success+.3*Math.exp(-Math.max(...latency)/200));
  }
  const histories=current.map(x=>x.history).filter(Boolean) as NonNullable<QualitySnapshot['history']>[];
  const dynamics=status.routeDynamics;
  if(histories.length===2&&histories.every(x=>Number(x.windowSamples||0)>=3)&&Number(dynamics?.samples||0)>=3){
    const loss=Math.max(...histories.map(x=>Number(x.lossStdDev||0)));
    const latency=Math.max(...histories.map(x=>Number(x.p95StdDevMs||0)));
    const churn=(Number(dynamics?.bgpChanges||0)+Number(dynamics?.routeChanges||0))/Math.max(1,Number(dynamics?.samples));
    s=clamp(1-(.5*clamp(loss/.25)+.3*clamp(latency/200)+.2*clamp(churn)));
  }
  const names=new Set(Object.values(status.pathRankings||{}).flatMap((items:any)=>(items||[]).map((x:any)=>x.peer).filter(Boolean)));
  const peers=(status.peerRoutes||[]).filter(x=>names.has(x.name));
  const dims:Array<'provider'|'asn'|'failureDomain'|'gateway'|'tunnel'>=['provider','asn','failureDomain','gateway','tunnel'];
  if(peers.length&&peers.every(p=>dims.every(k=>p[k]!==undefined&&p[k]!=='')))
    i=dims.reduce((sum,k)=>sum+clamp(new Set(peers.map(p=>String(p[k]))).size/peers.length),0)/dims.length;
  const dnsFailures=(x?:QualitySnapshot)=>(x?.dns||[]).filter(d=>Number(d.failureRatio||0)>0).length;
  const loss=Math.max(...paths.map(x=>Number(x.lossRatio||0)),0);let diagnosis='Measured dataplane is inside the current envelope.';
  if(!host||!pod)diagnosis='Host/pod evidence is incomplete or stale.';
  else if(dnsFailures(host)>0&&dnsFailures(pod)===0)diagnosis='Host resolver and pod DNS datapath diverge.';
  else if(loss>=.25)diagnosis='Host and pod evidence indicates shared dataplane or upstream degradation.';
  else if(loss>0)diagnosis='Partial dataplane degradation is present.';
  else {const [up,total]=bgpPeers(status.frr?.bgp);if(total>0&&up<total)diagnosis='BGP is incomplete without matching measured dataplane degradation.';}
  const known=[o,s,i].filter(x=>x!==null).length; const planes=Number(Boolean(host))+Number(Boolean(pod));
  const observedAt=[status.observedAt,...current.map(x=>x.observedAt)].filter(Boolean).sort().at(-1)||'';
  return {node:status.node,observedAt,o:rounded(o),s:rounded(s),i:rounded(i),confidence:rounded(clamp(known/3*.75+planes/2*.25)),
    diagnosis,evidence:{status,quality:samples}};
}

function readHistory():Record<string,OsiSnapshot[]>{try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'{}');}catch{return{};}}
function persist(rows:Array<Omit<Row,'history'>>){const stored=readHistory();for(const row of rows){if(!row.observedAt)continue;
  const values=stored[row.node]||[];if(!values.some(x=>x.observedAt===row.observedAt)){values.push({observedAt:row.observedAt,o:row.o,s:row.s,i:row.i});
    values.sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));stored[row.node]=values.slice(-HISTORY_LIMIT);}}
  try{localStorage.setItem(HISTORY_KEY,JSON.stringify(stored));}catch{/* optional */}return stored;}

const axes={o:{x:54,y:8},s:{x:9,y:87},i:{x:99,y:87}}; const center={x:54,y:61};
function point(axis:keyof typeof axes,value:number){return{x:center.x+(axes[axis].x-center.x)*value,y:center.y+(axes[axis].y-center.y)*value};}
function timeColor(index:number,total:number){const t=total<=1?1:index/(total-1);return{stroke:`hsl(${215-35*t} 78% ${72-27*t}%)`,opacity:.12+.83*t,width:.8+1.8*t};}
function Triangle({row,onClick}:{row:Row;onClick:()=>void}){const history=row.history.slice(-18);return <Box component="button" onClick={onClick}
  aria-label={`Inspect ${row.node} O S I evidence`} sx={{border:0,background:'transparent',p:0,cursor:'pointer',display:'flex',alignItems:'center',gap:1,color:'inherit'}}>
  <svg width="112" height="98" viewBox="0 0 108 96" role="img"><polygon points="54,8 9,87 99,87" fill="none" stroke="currentColor" strokeOpacity=".18"/>
  {Object.values(axes).map((p,index)=><line key={index} x1="54" y1="61" x2={p.x} y2={p.y} stroke="currentColor" strokeOpacity=".12"/>)}
  {history.map((snapshot,index)=>{if([snapshot.o,snapshot.s,snapshot.i].some(x=>x===null))return null;const c=timeColor(index,history.length);
    const points=([['o',snapshot.o],['s',snapshot.s],['i',snapshot.i]] as const).map(([a,v])=>{const p=point(a,v as number);return`${p.x},${p.y}`;}).join(' ');
    return <polygon key={snapshot.observedAt} points={points} fill="none" stroke={c.stroke} strokeOpacity={c.opacity} strokeWidth={c.width}/>;})}
  {(['o','s','i'] as const).map(a=>row[a]===null?null:(()=>{const p=point(a,row[a] as number);return<circle key={a} cx={p.x} cy={p.y} r="2.8" fill="#1565c0"/>;})())}
  <text x="54" y="7" textAnchor="middle" fontSize="9" fill="currentColor">O</text><text x="5" y="94" fontSize="9" fill="currentColor">S</text>
  <text x="103" y="94" textAnchor="end" fontSize="9" fill="currentColor">I</text></svg><Typography variant="body2" sx={{fontWeight:600}}>{row.node}</Typography></Box>;}
const value=(v:Score)=>v===null?'—':v.toFixed(3);
function delta(history:OsiSnapshot[],key:'o'|'s'|'i'){if(history.length<2)return'—';const a=history.at(-1)?.[key]; const b=history.at(-2)?.[key];
  if(a===null||a===undefined||b===null||b===undefined)return'—';const d=a-b;return`${d>=0?'+':''}${d.toFixed(3)}`;}
function parse(item:any,key:string){try{return JSON.parse(item.jsonData?.data?.[key]||item.data?.[key]);}catch{return null;}}

function Dashboard(){const[maps,error]=K8s.ResourceClasses.ConfigMap.useList({namespace:'kube-system'} as any);
  const statuses=(maps||[]).filter((x:any)=>x.metadata?.labels?.['networking.re8ch.com/node-status']==='true').map((x:any)=>parse(x,'status.json')).filter(Boolean)
    .sort((a:FabricStatus,b:FabricStatus)=>a.node.localeCompare(b.node)) as FabricStatus[];
  const quality=(maps||[]).filter((x:any)=>x.metadata?.labels?.['app.kubernetes.io/component']==='network-quality').map((x:any)=>parse(x,'result.json')).filter(Boolean) as QualitySnapshot[];
  const clusterHistory=(maps||[]).filter((x:any)=>x.metadata?.name==='advanced-fabric-osi-history')
    .map((x:any)=>parse(x,'history.json')).find(Boolean)?.nodes as Record<string,OsiSnapshot[]>|undefined;
  const computed=statuses.map(x=>score(x,quality)); const signature=computed.map(x=>`${x.node}:${x.observedAt}:${x.o}:${x.s}:${x.i}`).join('|');
  const[history,setHistory]=React.useState<Record<string,OsiSnapshot[]>>({});React.useEffect(()=>setHistory(persist(computed)),[signature]);
  const rows=computed.map(x=>({...x,history:clusterHistory?.[x.node]||history[x.node]||[{observedAt:x.observedAt,o:x.o,s:x.s,i:x.i}]}));const[selected,setSelected]=React.useState<Row|null>(null);
  const unknown=rows.filter(x=>[x.o,x.s,x.i].some(v=>v===null)).length;
  return <Box sx={{p:2}}><Typography variant="h4">Advanced Fabric</Typography><Typography color="text.secondary" sx={{mb:2}}>O/S/I network-state geometry · continuous time color · missing evidence stays unknown.</Typography>
  {error&&<Alert severity="error">Unable to read evidence: {String(error)}</Alert>}{unknown>0&&<Alert severity="info" sx={{mb:2}}>{unknown} nodes have unknown dimensions; they are intentionally not rendered as zero.</Alert>}
  <SectionBox title="Per-node O / S / I evolution"><Table data={rows} columns={[
    {header:'Node',accessorFn:(r:Row)=><Triangle row={r} onClick={()=>setSelected(r)}/>},{header:'O',accessorFn:(r:Row)=>value(r.o)},
    {header:'S',accessorFn:(r:Row)=>value(r.s)},{header:'I',accessorFn:(r:Row)=>value(r.i)},{header:'ΔO',accessorFn:(r:Row)=>delta(r.history,'o')},
    {header:'ΔS',accessorFn:(r:Row)=>delta(r.history,'s')},{header:'ΔI',accessorFn:(r:Row)=>delta(r.history,'i')},
    {header:'Confidence',accessorFn:(r:Row)=>value(r.confidence)},{header:'Observed',accessorFn:(r:Row)=>r.observedAt?new Date(r.observedAt).toLocaleString():'—'}] as any}/></SectionBox>
  <Stack direction="row" spacing={1} alignItems="center" sx={{mt:1}}><Typography variant="caption">Older</Typography>{[0,1,2,3,4,5].map((_,i,a)=>{const c=timeColor(i,a.length);return<Box key={i} sx={{width:24,height:4,bgcolor:c.stroke,opacity:c.opacity}}/>;})}<Typography variant="caption">Newest</Typography></Stack>
  <Dialog open={Boolean(selected)} onClose={()=>setSelected(null)} maxWidth="lg" fullWidth>{selected&&<><DialogTitle>{selected.node} · evidence and inference</DialogTitle><DialogContent>
    <Stack direction="row" spacing={1} sx={{mb:2}}><Chip label={`O ${value(selected.o)}`}/><Chip label={`S ${value(selected.s)}`}/><Chip label={`I ${value(selected.i)}`}/><Chip label={`Confidence ${value(selected.confidence)}`} color="primary"/></Stack>
    <Typography variant="subtitle2">Rule-based diagnosis</Typography><Typography sx={{mb:2}}>{selected.diagnosis}</Typography><Divider sx={{mb:2}}/>
    <Typography variant="subtitle2">Timestamped O/S/I snapshots</Typography><Box component="pre" sx={{overflow:'auto',fontSize:12}}>{JSON.stringify(selected.history,null,2)}</Box>
    <Typography variant="subtitle2">Raw evidence</Typography><Box component="pre" sx={{overflow:'auto',fontSize:12,maxHeight:420}}>{JSON.stringify(selected.evidence,null,2)}</Box>
  </DialogContent></>}</Dialog></Box>;}

registerSidebarEntry({name:'advanced-fabric',url:'/advanced-fabric',icon:'mdi:router-network',parent:'',label:'Advanced Fabric'});
registerRoute({path:'/advanced-fabric',sidebar:'advanced-fabric',name:'Advanced Fabric',component:()=><Dashboard/>});
registerSidebarEntry({name:'penrose-triangle',url:'/penrose-triangle',icon:'mdi:triangle-outline',parent:'',label:'Penrose Triangle'});
registerRoute({path:'/penrose-triangle',sidebar:'penrose-triangle',name:'Penrose Triangle Observer',component:()=><PenroseObserver/>});

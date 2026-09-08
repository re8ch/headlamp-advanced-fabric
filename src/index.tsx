import { K8s, registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, StatusLabel, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Alert, Box, Chip, Dialog, DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import React from 'react';
import PenroseObserver from './penrose';

type Score = number | null;
type FabricStatus = {node:string; observedAt?:string; datapath?:{mode?:string;tunnelInterfaces?:string[]}; frr?:{state?:string;bgp?:unknown};
  bgpRib?:Array<{prefix:string;paths:any[]}>;ecmpRoutes?:unknown[];pathRankings?:Record<string,unknown>;
  peerRoutes?:Array<{name?:string;provider?:string;failureDomain?:string;gateway?:string;tunnel?:string;asn?:number}>;
  routeDynamics?:{samples?:number;bgpChanges?:number;routeChanges?:number}; [key:string]:unknown};
type QualitySnapshot = {sourceNode:string;sourcePlane:string;observedAt?:string;
  paths?:Array<{lossRatio?:number;p95Ms?:number}>;dns?:Array<{failureRatio?:number;p95Ms?:number}>;
  history?:{windowSamples?:number;lossStdDev?:number;p95StdDevMs?:number};[key:string]:unknown};
type OsiSnapshot = {observedAt:string;o:Score;s:Score;i:Score;confidenceO?:number;confidenceS?:number;confidenceI?:number};
type Row = OsiSnapshot & {node:string;diagnosis:string;evidence:unknown;history:OsiSnapshot[]};

function bgpPeers(value:any):[number,number]{let up=0; let total=0;function visit(v:any){if(!v||typeof v!=='object')return;
  for(const [key,child] of Object.entries(v))if(key==='peers'&&child&&typeof child==='object')for(const peer of Object.values(child) as any[]){
    total++;if(String(peer?.state||peer?.peerState).toLowerCase()==='established')up++;}else visit(child);}visit(value);return[up,total];}

const axes={o:{x:54,y:8},s:{x:9,y:87},i:{x:99,y:87}}; const center={x:54,y:61};
function point(axis:keyof typeof axes,value:number){return{x:center.x+(axes[axis].x-center.x)*value,y:center.y+(axes[axis].y-center.y)*value};}
function timeColor(index:number,total:number){const t=total<=1?1:index/(total-1);return{stroke:`hsl(${215-35*t} 78% ${72-27*t}%)`,opacity:.12+.83*t,width:.8+1.8*t};}
function Triangle({row,onClick}:{row:Row;onClick:()=>void}){const history=row.history.slice(-18);return <Box component="button" onClick={onClick}
  aria-label={`Inspect ${row.node} O S I evidence`} sx={{border:0,background:'transparent',p:0,cursor:'pointer',display:'flex',alignItems:'center',gap:1,color:'inherit'}}>
  <svg width="112" height="98" viewBox="0 0 108 96" role="img"><polygon points="54,8 9,87 99,87" fill="none" stroke="currentColor" strokeOpacity=".18"/>
  {Object.values(axes).map((p,index)=><line key={index} x1="54" y1="61" x2={p.x} y2={p.y} stroke="currentColor" strokeOpacity=".12"/>)}
  {history.map((snapshot,index)=>{const c=timeColor(index,history.length);const available=([['o',snapshot.o],['s',snapshot.s],['i',snapshot.i]] as const)
    .filter((entry):entry is [keyof typeof axes,number]=>entry[1]!==null&&entry[1]!==undefined).map(([a,v])=>point(a,v));
    if(available.length===0)return null;if(available.length===1)return <line key={snapshot.observedAt} x1={center.x} y1={center.y} x2={available[0].x} y2={available[0].y} stroke={c.stroke} strokeOpacity={c.opacity} strokeWidth={c.width}/>;
    const points=[...available,...(available.length===3?[available[0]]:[])].map(p=>`${p.x},${p.y}`).join(' ');
    return <polyline key={snapshot.observedAt} points={points} fill="none" stroke={c.stroke} strokeOpacity={c.opacity} strokeWidth={c.width}/>;})}
  {(['o','s','i'] as const).map(a=>row[a]===null?null:(()=>{const p=point(a,row[a] as number);return<circle key={a} cx={p.x} cy={p.y} r="2.8" fill="#1565c0"/>;})())}
  <text x="54" y="7" textAnchor="middle" fontSize="9" fill="currentColor">O</text><text x="5" y="94" fontSize="9" fill="currentColor">S</text>
  <text x="103" y="94" textAnchor="end" fontSize="9" fill="currentColor">I</text></svg><Typography variant="body2" sx={{fontWeight:600}}>{row.node}</Typography></Box>;}
const value=(v:Score)=>v===null?'—':v.toFixed(3);
function delta(history:OsiSnapshot[],key:'o'|'s'|'i'){if(history.length<2)return'—';const a=history.at(-1)?.[key]; const b=history.at(-2)?.[key];
  if(a===null||a===undefined||b===null||b===undefined)return'—';const d=a-b;return`${d>=0?'+':''}${d.toFixed(3)}`;}
function parse(item:any,key:string){try{return JSON.parse(item.jsonData?.data?.[key]||item.data?.[key]);}catch{return null;}}
function confidence(row:Row){return `O ${value(row.confidenceO??null)} · S ${value(row.confidenceS??null)} · I ${value(row.confidenceI??null)}`;}

function Dashboard(){const[maps,error]=K8s.ResourceClasses.ConfigMap.useList({namespace:'kube-system'} as any);
  const statuses=(maps||[]).filter((x:any)=>x.metadata?.labels?.['networking.re8ch.com/node-status']==='true').map((x:any)=>parse(x,'status.json')).filter(Boolean)
    .sort((a:FabricStatus,b:FabricStatus)=>a.node.localeCompare(b.node)) as FabricStatus[];
  const quality=(maps||[]).filter((x:any)=>x.metadata?.labels?.['app.kubernetes.io/component']==='network-quality').map((x:any)=>parse(x,'result.json')).filter(Boolean) as QualitySnapshot[];
  const clusterHistory=(maps||[]).filter((x:any)=>x.metadata?.name==='advanced-fabric-osi-history')
    .map((x:any)=>parse(x,'history.json')).find(Boolean)?.nodes as Record<string,OsiSnapshot[]>|undefined;
  const inference=(maps||[]).filter((x:any)=>x.metadata?.name==='advanced-fabric-inference').map((x:any)=>parse(x,'inference.json')).find(Boolean) as any;
  const inferenceRows=Array.isArray(inference)?inference:(inference?.nodes||inference?.items||[]);
  const rows=Object.entries(clusterHistory||{}).map(([node,rawHistory])=>{const history=[...rawHistory].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
    const latest=history.at(-1)!;const status=statuses.find(x=>x.node===node);return{...latest,node,history,
      diagnosis:inferenceRows.find((x:any)=>x.node===node)?.diagnosis||'No rule-based diagnosis.',evidence:{status,quality:quality.filter(x=>x.sourceNode===node)}};});
  const[selected,setSelected]=React.useState<Row|null>(null);
  const unknown=rows.filter(x=>[x.o,x.s,x.i].some(v=>v===null)).length;
  const qualityRows=quality.map(item=>{const paths=item.paths||[];const dns=item.dns||[];return{source:`${item.sourceNode}/${item.sourcePlane}`,
    observed:item.observedAt?new Date(item.observedAt).toLocaleString():'unknown',pathSamples:paths.length,failedPaths:paths.filter(x=>Number(x.lossRatio||0)>0).length,
    pathP95:paths.length?Math.max(...paths.map(x=>Number(x.p95Ms||0))):0,dnsSamples:dns.length,failedDns:dns.filter(x=>Number(x.failureRatio||0)>0).length,
    dnsP95:dns.length?Math.max(...dns.map(x=>Number(x.p95Ms||0))):0};});
  const[selectedNode,setSelectedNode]=React.useState('');const effectiveNode=statuses.some(x=>x.node===selectedNode)?selectedNode:statuses[0]?.node||'';
  const inspected=statuses.find(x=>x.node===effectiveNode);const ecmpRows=(inspected?.ecmpRoutes||[]).map((route:any)=>({destination:route.dst||'default',protocol:route.protocol||'—',metric:route.metric??'—',nextHops:(route.nexthops||[]).map((hop:any)=>`${hop.gateway||'on-link'} · ${hop.dev||'?'} · weight ${hop.weight||1}`)}));
  const decisionRows=Object.entries(inspected?.pathRankings||{}).flatMap(([profile,paths]:any)=>(paths||[]).map((path:any,index:number)=>({profile,rank:index+1,peer:path.peer,pathType:path.pathType||'—',score:path.score,quota:path.quotaPressure?.tier||'unknown',price:path.priceStatus||'unknown'})));
  const peerRows=(inspected?.peerRoutes||[]).map((peer:any)=>({name:peer.name,role:peer.role||'—',class:peer.class||'—',internalIP:peer.internalIP||'—',acceleratedIP:peer.acceleratedIP||'—',podCIDR:peer.podCIDR||'—'}));
  const bgpRows=(inspected?.bgpRib||[]).flatMap((route:any)=>(route.paths||[]).map((path:any)=>({prefix:route.prefix,peer:path.peer||'—',nextHops:path.nextHops||[],asPath:path.asPath||'local',best:Boolean(path.best),multipath:Boolean(path.multipath),reason:path.best?'best':path.multipath?'multipath':'candidate only'})));
  return <Box sx={{p:2}}><Typography variant="h4">Advanced Fabric</Typography><Typography color="text.secondary" sx={{mb:2}}>O/S/I network-state geometry · continuous time color · missing evidence stays unknown.</Typography>
  {error&&<Alert severity="error">Unable to read evidence: {String(error)}</Alert>}{unknown>0&&<Alert severity="info" sx={{mb:2}}>{unknown} nodes have unknown dimensions; they are intentionally not rendered as zero.</Alert>}
  <SectionBox title="Per-node O / S / I evolution"><Table data={rows} columns={[
    {header:'Node',accessorFn:(r:Row)=><Triangle row={r} onClick={()=>setSelected(r)}/>},{header:'O',accessorFn:(r:Row)=>value(r.o)},
    {header:'S',accessorFn:(r:Row)=>value(r.s)},{header:'I',accessorFn:(r:Row)=>value(r.i)},{header:'ΔO',accessorFn:(r:Row)=>delta(r.history,'o')},
    {header:'ΔS',accessorFn:(r:Row)=>delta(r.history,'s')},{header:'ΔI',accessorFn:(r:Row)=>delta(r.history,'i')},
    {header:'Confidence',accessorFn:(r:Row)=>confidence(r)},{header:'Observed',accessorFn:(r:Row)=>r.observedAt?new Date(r.observedAt).toLocaleString():'—'}] as any}/></SectionBox>
  <Stack direction="row" spacing={1} alignItems="center" sx={{mt:1}}><Typography variant="caption">Older</Typography>{[0,1,2,3,4,5].map((_,i,a)=>{const c=timeColor(i,a.length);return<Box key={i} sx={{width:24,height:4,bgcolor:c.stroke,opacity:c.opacity}}/>;})}<Typography variant="caption">Newest</Typography></Stack>
  <SectionBox title={`Raw measurement continuity (${quality.length} sources)`}><Table data={qualityRows} columns={[{header:'Source',accessorKey:'source'},{header:'Observed',accessorKey:'observed'},{header:'Path samples',accessorKey:'pathSamples'},{header:'Paths with loss',accessorKey:'failedPaths'},{header:'Worst path p95 ms',accessorKey:'pathP95'},{header:'DNS samples',accessorKey:'dnsSamples'},{header:'DNS failures',accessorKey:'failedDns'},{header:'Worst DNS p95 ms',accessorKey:'dnsP95'}] as any}/></SectionBox>
  <SectionBox title={`Node network status (${statuses.length})`}><Table data={statuses} columns={[{header:'Node',accessorKey:'node'},{header:'Datapath',accessorFn:(x:FabricStatus)=><Chip size="small" color={x.datapath?.mode==='native'?'success':'warning'} label={x.datapath?.mode||'unknown'}/>},{header:'Tunnel interface',accessorFn:(x:FabricStatus)=>x.datapath?.tunnelInterfaces?.join(', ')||'—'},{header:'FRR',accessorFn:(x:FabricStatus)=><StatusLabel status={x.frr?.state==='active'?'success':'error'}>{x.frr?.state||'unknown'}</StatusLabel>},{header:'BGP established',accessorFn:(x:FabricStatus)=>bgpPeers(x.frr?.bgp).join('/')},{header:'ECMP routes',accessorFn:(x:FabricStatus)=>x.ecmpRoutes?.length||0},{header:'Known peers',accessorFn:(x:FabricStatus)=>x.peerRoutes?.length||0},{header:'Observed',accessorFn:(x:FabricStatus)=>x.observedAt?new Date(x.observedAt).toLocaleString():'unknown'}] as any}/></SectionBox>
  <Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{my:2}} alignItems="center"><FormControl size="small" sx={{minWidth:280}}><InputLabel id="af-node-label">Inspect node</InputLabel><Select labelId="af-node-label" label="Inspect node" value={effectiveNode} onChange={event=>setSelectedNode(event.target.value)}>{statuses.map(x=><MenuItem key={x.node} value={x.node}>{x.node}</MenuItem>)}</Select></FormControl>{inspected&&<Stack direction="row" spacing={1} flexWrap="wrap"><Chip label={`Kernel ECMP sets ${ecmpRows.length}`}/><Chip label={`BGP candidate paths ${bgpRows.length}`}/><Chip label={`Candidate decisions ${decisionRows.length}`}/><Chip label={`Known peers ${peerRows.length}`}/></Stack>}</Stack>
  <SectionBox title={`${effectiveNode||'Node'}: kernel ECMP routes`}><Table data={ecmpRows} columns={[{header:'Destination',accessorKey:'destination'},{header:'Protocol',accessorKey:'protocol'},{header:'Metric',accessorKey:'metric'},{header:'Next hops / weight',accessorFn:(r:any)=><Stack direction="row" gap={.5} flexWrap="wrap">{r.nextHops.map((hop:string)=><Chip key={hop} size="small" label={hop}/>)}</Stack>}] as any}/></SectionBox>
  <SectionBox title={`${effectiveNode||'Node'}: path decisions`}><Table data={decisionRows} columns={[{header:'Profile',accessorKey:'profile'},{header:'Rank',accessorKey:'rank'},{header:'Peer',accessorKey:'peer'},{header:'Path type',accessorKey:'pathType'},{header:'Score',accessorKey:'score'},{header:'Quota',accessorKey:'quota'},{header:'Price',accessorKey:'price'}] as any}/></SectionBox>
  <SectionBox title={`${effectiveNode||'Node'}: BGP candidate / selected paths`}><Table data={bgpRows} columns={[{header:'Prefix',accessorKey:'prefix'},{header:'Peer',accessorKey:'peer'},{header:'Next hops',accessorFn:(r:any)=><Stack direction="row" gap={.5} flexWrap="wrap">{r.nextHops.map((hop:string)=><Chip key={hop} size="small" label={hop}/>)}</Stack>},{header:'AS path',accessorKey:'asPath'},{header:'Selection',accessorFn:(r:any)=><Chip size="small" color={r.best?'success':r.multipath?'primary':'default'} label={r.reason}/>} ] as any}/></SectionBox>
  <SectionBox title={`${effectiveNode||'Node'}: peer inventory`}><Table data={peerRows} columns={[{header:'Peer',accessorKey:'name'},{header:'Class',accessorKey:'class'},{header:'Role',accessorKey:'role'},{header:'Internal IP',accessorKey:'internalIP'},{header:'Accelerated IP',accessorKey:'acceleratedIP'},{header:'PodCIDR',accessorKey:'podCIDR'}] as any}/></SectionBox>
  <Dialog open={Boolean(selected)} onClose={()=>setSelected(null)} maxWidth="lg" fullWidth>{selected&&<><DialogTitle>{selected.node} · evidence and inference</DialogTitle><DialogContent>
    <Stack direction="row" spacing={1} sx={{mb:2}}><Chip label={`O ${value(selected.o)} · c ${value(selected.confidenceO??null)}`}/><Chip label={`S ${value(selected.s)} · c ${value(selected.confidenceS??null)}`}/><Chip label={`I ${value(selected.i)} · c ${value(selected.confidenceI??null)}`}/></Stack>
    <Typography variant="subtitle2">Rule-based diagnosis</Typography><Typography sx={{mb:2}}>{selected.diagnosis}</Typography><Divider sx={{mb:2}}/>
    <Typography variant="subtitle2">Timestamped O/S/I snapshots</Typography><Box component="pre" sx={{overflow:'auto',fontSize:12}}>{JSON.stringify(selected.history,null,2)}</Box>
    <Typography variant="subtitle2">Raw evidence</Typography><Box component="pre" sx={{overflow:'auto',fontSize:12,maxHeight:420}}>{JSON.stringify(selected.evidence,null,2)}</Box>
  </DialogContent></>}</Dialog></Box>;}

registerSidebarEntry({name:'advanced-fabric',url:'/advanced-fabric',icon:'mdi:router-network',parent:'',label:'Advanced Fabric'});
registerRoute({path:'/advanced-fabric',sidebar:'advanced-fabric',name:'Advanced Fabric',component:()=><Dashboard/>});
registerSidebarEntry({name:'penrose-triangle',url:'/penrose-triangle',icon:'mdi:triangle-outline',parent:'',label:'Penrose Triangle'});
registerRoute({path:'/penrose-triangle',sidebar:'penrose-triangle',name:'Penrose Triangle Observer',component:()=><PenroseObserver/>});

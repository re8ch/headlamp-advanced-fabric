import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, StatusLabel, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/lib/k8s/crd';
import { Alert, alpha, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Select, Stack, Tab, Tabs, TextField, Typography, useTheme } from '@mui/material';
import React from 'react';

const crd = (kind: string, pluralName: string, isNamespaced: boolean) => makeCustomResourceClass({
  apiInfo: [{group: 'scheduling.re8ch.com', version: 'v1alpha1'}], kind, pluralName,
  singularName: pluralName.replace(/ies$/, 'y').replace(/s$/, ''), isNamespaced,
});
const NodeProfile = crd('NodeProfile', 'nodeprofiles', false);
const SchedulerProfile = crd('SchedulerProfile', 'schedulerprofiles', false);
const ServiceOutcomePolicy = crd('ServiceOutcomePolicy', 'serviceoutcomepolicies', true);
const DisturbanceWindow = crd('DisturbanceWindow', 'disturbancewindows', true);
const PenroseOperation = crd('PenroseOperation', 'penroseoperations', true);
const DeviceClass = makeCustomResourceClass({apiInfo: [{group: 'resource.k8s.io', version: 'v1'}], kind: 'DeviceClass', pluralName: 'deviceclasses', singularName: 'deviceclass', isNamespaced: false});
const ResourceSlice = makeCustomResourceClass({apiInfo: [{group: 'resource.k8s.io', version: 'v1'}], kind: 'ResourceSlice', pluralName: 'resourceslices', singularName: 'resourceslice', isNamespaced: false});
const ResourceClaim = makeCustomResourceClass({apiInfo: [{group: 'resource.k8s.io', version: 'v1'}], kind: 'ResourceClaim', pluralName: 'resourceclaims', singularName: 'resourceclaim', isNamespaced: true});

const raw = (item: any) => item?.jsonData || item || {};
const schedulerName = (pod: any) => raw(pod).spec?.schedulerName || 'default-scheduler';
const colorsByScheduler: Record<string, string> = {'default-scheduler': '#455a64', 're8ch-dynamic-scheduler': '#00897b', mixed: '#8e24aa'};

type Scores = {resilience: number; efficiency: number | null; stability: number};
type Outcome = {key: string; namespace: string; service: string; group: string; cohort: string; scores: Scores;
  completeness: number; complete: boolean; pareto: boolean; desired: Scores; missing: string[]; evidence: any; available: string};
type Point = {x: number; y: number; row: Outcome};
const vertices = {resilience: {x: 360, y: 42}, efficiency: {x: 650, y: 458}, stability: {x: 70, y: 458}};
function point(row: Outcome): Point {
  const r = row.scores.resilience;
  const e = row.scores.efficiency || 0;
  const s = row.scores.stability;
  const total = r + e + s || 1;
  return {x: (r * vertices.resilience.x + e * vertices.efficiency.x + s * vertices.stability.x) / total,
    y: (r * vertices.resilience.y + e * vertices.efficiency.y + s * vertices.stability.y) / total, row};
}
function cross(o: Point, a: Point, b: Point) { return (a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x); }
function hull(points: Point[]) {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a,b) => a.x-b.x || a.y-b.y);
  const lower: Point[] = [];
  const upper: Point[] = [];
  for (const p of sorted) { while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function percentile(values: number[], q: number) { const s=[...values].sort((a,b)=>a-b); return s[Math.floor((s.length-1)*q)] ?? 0; }
function quantileEnvelope(rows: Outcome[]) {
  if (rows.length < 5) return hull(rows.map(point));
  const axes: (keyof Scores)[] = ['resilience','efficiency','stability'];
  const bounds = Object.fromEntries(axes.map(axis => [axis, [percentile(rows.map(r=>Number(r.scores[axis]||0)),.1), percentile(rows.map(r=>Number(r.scores[axis]||0)),.9)]]));
  const central = rows.filter(row => axes.every(axis => Number(row.scores[axis]||0) >= bounds[axis][0] && Number(row.scores[axis]||0) <= bounds[axis][1]));
  return hull((central.length >= 3 ? central : rows).map(point));
}
function path(points: Point[]) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x-8} ${points[0].y} a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0`;
  return `${points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')} Z`;
}

function Triangle({rows}: {rows: Outcome[]}) {
  const theme = useTheme();
  const eligible = rows.filter(row => row.complete && row.scores.efficiency !== null);
  const cohorts = new Map<string, Outcome[]>();
  eligible.forEach(row => cohorts.set(row.cohort, [...(cohorts.get(row.cohort)||[]), row]));
  return <Box>
    <svg viewBox="0 0 720 510" width="100%" style={{maxHeight: 570}} role="img" aria-label="Penrose Service outcome triangle">
      <polygon points="360,42 650,458 70,458" fill="none" stroke={theme.palette.divider} strokeWidth="2"/>
      {[.25,.5,.75].map(level => <line key={level} x1={360*level+70*(1-level)} y1={42*level+458*(1-level)} x2={360*level+650*(1-level)} y2={42*level+458*(1-level)} stroke={alpha(theme.palette.text.secondary,.2)}/>)}
      <text x="360" y="24" textAnchor="middle" fill={theme.palette.text.primary}>Resilience</text>
      <text x="675" y="482" textAnchor="end" fill={theme.palette.text.primary}>Efficiency</text>
      <text x="45" y="482" fill={theme.palette.text.primary}>Stability</text>
      {[...cohorts].map(([cohort,outcomes],i) => { const color=colorsByScheduler[cohort] || theme.palette.augmentColor({color:{main:['#3949ab','#f4511e','#7cb342'][i%3]}}).main; const envelope=quantileEnvelope(outcomes);
        return <g key={cohort}>
          <path d={path(envelope)} fill={alpha(color,.14)} stroke={color} strokeWidth="3" strokeLinejoin="round"/>
          {outcomes.map(row => { const p=point(row); return <circle key={row.key} cx={p.x} cy={p.y} r={row.pareto?7:5} fill={color} fillOpacity={Math.max(.25,row.completeness)} stroke={row.pareto?theme.palette.text.primary:color} strokeWidth={row.pareto?2:1}>
            <title>{`${row.namespace}/${row.service} · ${cohort}\nR ${row.scores.resilience} · E ${row.scores.efficiency} · S ${row.scores.stability}\nCompleteness ${Math.round(row.completeness*100)}%`}</title>
          </circle>})}
        </g>;})}
    </svg>
    <Stack direction="row" justifyContent="center" gap={2} flexWrap="wrap">
      {[...cohorts].map(([name,values]) => <Chip key={name} size="small" label={`${name} (${values.length})`} sx={{borderColor: colorsByScheduler[name], borderWidth:2}} variant="outlined"/>)}
      <Chip size="small" label={`Incomplete / excluded (${rows.length-eligible.length})`} variant="outlined"/>
    </Stack>
  </Box>;
}

function paretoByGroup(rows: Outcome[]) {
  const groups = new Map<string, Outcome[]>();
  rows.filter(r=>r.complete).forEach(row => groups.set(row.group,[...(groups.get(row.group)||[]),row]));
  groups.forEach(items => items.forEach(candidate => {
    candidate.pareto = !items.some(other => other !== candidate &&
      other.scores.resilience >= candidate.scores.resilience && Number(other.scores.efficiency) >= Number(candidate.scores.efficiency) && other.scores.stability >= candidate.scores.stability &&
      (other.scores.resilience > candidate.scores.resilience || Number(other.scores.efficiency) > Number(candidate.scores.efficiency) || other.scores.stability > candidate.scores.stability));
  }));
  return rows;
}

function OperationDialog({open,onClose,schedulers}: {open:boolean;onClose:()=>void;schedulers:string[]}) {
  const [namespace,setNamespace]=React.useState('default');
  const [workload,setWorkload]=React.useState('');
  const [scheduler,setScheduler]=React.useState(schedulers[0]||'re8ch-dynamic-scheduler');
  const [error,setError]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const preview = {patch: [{op:'replace', path:'/spec/template/spec/schedulerName', value:scheduler}], impact: `${namespace}/Deployment/${workload}`, risk:'Pods change scheduler only on recreation; no Pod is evicted.'};
  async function submit() { setBusy(true); setError(''); try { await (PenroseOperation as any).apiEndpoint.post({apiVersion:'scheduling.re8ch.com/v1alpha1',kind:'PenroseOperation',metadata:{generateName:'switch-scheduler-',namespace},spec:{action:'SwitchScheduler',targetRef:{apiVersion:'apps/v1',kind:'Deployment',namespace,name:workload},preview,approved:false}}); onClose(); } catch(e) { setError(String(e)); } finally { setBusy(false); } }
  return <Dialog open={open} onClose={onClose} fullWidth><DialogTitle>Preview scheduler operation</DialogTitle><DialogContent><Stack gap={2} sx={{pt:1}}>
    <TextField label="Namespace" value={namespace} onChange={e=>setNamespace(e.target.value)}/><TextField label="Deployment" value={workload} onChange={e=>setWorkload(e.target.value)}/>
    <FormControl><InputLabel>Registered scheduler</InputLabel><Select label="Registered scheduler" value={scheduler} onChange={e=>setScheduler(e.target.value)}>{schedulers.map(x=><MenuItem value={x} key={x}>{x}</MenuItem>)}</Select></FormControl>
    <Alert severity="info"><pre style={{whiteSpace:'pre-wrap',margin:0}}>{JSON.stringify(preview,null,2)}</pre></Alert>
    <Alert severity="warning">提交后仅创建未批准的 PenroseOperation；operator/admin 复核并批准后控制器才可执行。</Alert>{error&&<Alert severity="error">{error}</Alert>}
  </Stack></DialogContent><DialogActions><Button onClick={onClose}>Cancel</Button><Button disabled={!workload||busy} onClick={submit} variant="contained">Create operation</Button></DialogActions></Dialog>;
}

export default function PenroseObserver() {
  const [tab,setTab]=React.useState(0);
  const [operationOpen,setOperationOpen]=React.useState(false);
  const [nodes,nodeError]=K8s.ResourceClasses.Node.useList(); const [pods,podError]=K8s.ResourceClasses.Pod.useList();
  const [profiles,profileError]=(NodeProfile as any).useList(); const [schedulerProfiles,schedulerError]=(SchedulerProfile as any).useList();
  const [policies,policyError]=(ServiceOutcomePolicy as any).useList(); const [disturbances,disturbanceError]=(DisturbanceWindow as any).useList();
  const [operations]=(PenroseOperation as any).useList(); const [deviceClasses]=(DeviceClass as any).useList(); const [slices]=(ResourceSlice as any).useList(); const [claims]=(ResourceClaim as any).useList();
  const profileByNode=new Map<string,any>(); (profiles||[]).forEach((p:any)=>{const v=raw(p); [v.spec?.nodeName,...(v.spec?.aliases||[])].forEach((n:string)=>profileByNode.set(n,v));});
  const nodeRows=(nodes||[]).map((n:any)=>{const v=raw(n); const p=profileByNode.get(v.metadata?.name); const labels=v.metadata?.labels||{}; return {name:v.metadata?.name,ready:v.status?.conditions?.some((c:any)=>c.type==='Ready'&&c.status==='True'),provider:p?.spec?.background?.provider||labels['scheduling.re8ch.com/provider']||'—',region:p?.spec?.background?.region||'—',environment:p?.spec?.background?.environment||labels['scheduling.re8ch.com/environment']||'—',reliability:p?.spec?.reliability?.class||labels['scheduling.re8ch.com/reliability-class']||'—',failureDomain:labels['scheduling.re8ch.com/failure-domain']||p?.spec?.failureDomains?.host||'—',trimaran:labels['scheduling.re8ch.com/trimaran-ready']==='true',cpu:v.status?.allocatable?.cpu,memory:v.status?.allocatable?.memory,dra:p?.spec?.capabilities?.draDeviceClasses||[]};}).sort((a:any,b:any)=>a.name.localeCompare(b.name));
  const policyRows:Outcome[]=paretoByGroup((policies||[]).map((item:any)=>{const v=raw(item); const s=v.status?.observation?.scores||{}; const desired=v.spec?.desired||{}; const completeness=Number(v.status?.observation?.completeness||0); return {key:v.metadata?.uid||`${v.metadata?.namespace}/${v.metadata?.name}`,namespace:v.metadata?.namespace,service:v.spec?.serviceRef?.name||v.metadata?.name,group:v.spec?.comparisonGroup||v.spec?.serviceRef?.name,cohort:v.status?.cohort||'not-observed',scores:{resilience:Number(s.resilience||0),efficiency:s.efficiency===null||s.efficiency===undefined?null:Number(s.efficiency),stability:Number(s.stability||0)},desired:{resilience:Number(desired.resilience||0),efficiency:Number(desired.efficiency||0),stability:Number(desired.stability||0)},completeness,complete:Boolean(v.status?.observation?.complete)&&completeness>=Number(v.spec?.observation?.minimumCompleteness||.8),pareto:false,missing:v.status?.observation?.missingEvidence||[],evidence:v.status?.observation?.evidence||{},available:`${v.status?.observation?.evidence?.readyEndpoints??'—'}/${v.status?.observation?.evidence?.expectedEndpoints??'—'}`};}));
  const schedulerRows=(schedulerProfiles||[]).map((x:any)=>{const v=raw(x); const condition=v.status?.conditions?.find((c:any)=>c.type==='Ready'); return {name:v.metadata?.name,scheduler:v.spec?.schedulerName,mode:v.spec?.managementMode,plugins:v.spec?.plugins||[],coverage:v.status?.metricsCoverage,eligible:v.status?.eligibleNodes,revision:v.status?.revision,ready:condition?.status==='True',reason:condition?.reason||'Not observed'};});
  const disturbanceRows=(disturbances||[]).map((x:any)=>{const v=raw(x);return {namespace:v.metadata?.namespace,name:v.metadata?.name,source:v.spec?.source,started:v.spec?.startedAt,ended:v.spec?.endedAt||'Active',phase:v.status?.phase||'baseline',services:v.status?.affectedServices||0};});
  const operationRows=(operations||[]).map((x:any)=>{const v=raw(x);return {namespace:v.metadata?.namespace,name:v.metadata?.name,action:v.spec?.action,target:`${v.spec?.targetRef?.kind||'?'}/${v.spec?.targetRef?.name||'?'}`,approved:v.spec?.approved,phase:v.status?.phase||'Preview',revision:v.status?.appliedRevision||'—'};});
  const schedulerNames=schedulerRows.map((x:any)=>x.scheduler).filter((x:string)=>x!=='default-scheduler');
  const errors=[nodeError,podError,profileError,schedulerError,policyError,disturbanceError].filter(Boolean);
  const podCohorts=new Map<string,number>(); (pods||[]).forEach((p:any)=>podCohorts.set(schedulerName(p),(podCohorts.get(schedulerName(p))||0)+1));
  return <Box sx={{p:2}}>
    <Typography variant="h4">Penrose Triangle Observer</Typography><Typography color="text.secondary">观察 Service outcome 与控制器共同作用，不替调度器做 trade-off。</Typography>
    {errors.length>0&&<Alert severity="warning" sx={{mt:2}}>部分分析数据源尚未安装或无权读取：{errors.map(String).join('; ')}</Alert>}
    <Stack direction="row" gap={1} sx={{my:2}} flexWrap="wrap"><Chip label={`${nodeRows.length} nodes`}/><Chip label={`${schedulerRows.length} scheduler profiles`}/><Chip label={`${policyRows.length} services`}/><Chip color="success" label={`${policyRows.filter(x=>x.complete).length} complete observations`}/><Chip label={`${disturbanceRows.length} disturbances`}/></Stack>
    <Tabs value={tab} onChange={(_,v)=>setTab(v)} variant="scrollable" scrollButtons="auto"><Tab label="Overview"/><Tab label="Services"/><Tab label="Scheduler Profiles"/><Tab label="Node Profiles"/><Tab label="Disturbances"/><Tab label="Resources / DRA"/></Tabs>
    {tab===0&&<><SectionBox title="Scheduler outcome 10–90% envelopes"><Triangle rows={policyRows}/></SectionBox><Alert severity="info" sx={{mt:2}}>只有 completeness 达标且三轴均有窗口化证据的观测进入轮廓和 Pareto；透明度表示证据完整度，描边点表示同 comparison group 内的 Pareto frontier。</Alert></>}
    {tab===1&&<SectionBox title="Service outcomes"><Table data={policyRows} columns={[{header:'Service',accessorFn:(r:any)=>`${r.namespace}/${r.service}`},{header:'Comparison group',accessorKey:'group'},{header:'Cohort',accessorKey:'cohort'},{header:'Endpoints',accessorKey:'available'},{header:'R / E / S',accessorFn:(r:any)=>`${r.scores.resilience} / ${r.scores.efficiency??'Unknown'} / ${r.scores.stability}`},{header:'Desired',accessorFn:(r:any)=>`${r.desired.resilience} / ${r.desired.efficiency} / ${r.desired.stability}`},{header:'Completeness',accessorFn:(r:any)=><StatusLabel status={r.complete?'success':'warning'}>{Math.round(r.completeness*100)}%</StatusLabel>},{header:'Missing evidence',accessorFn:(r:any)=>r.missing.join(', ')||'—'},{header:'Pareto',accessorFn:(r:any)=><Chip size="small" color={r.pareto?'success':'default'} label={r.complete?(r.pareto?'frontier':'dominated'):'incomplete'}/>} ] as any}/></SectionBox>}
    {tab===2&&<><Stack direction="row" justifyContent="flex-end" sx={{my:2}}><Button variant="contained" onClick={()=>setOperationOpen(true)}>Preview workload scheduler switch</Button></Stack><SectionBox title="Registered scheduler profiles"><Table data={schedulerRows} columns={[{header:'Scheduler',accessorKey:'scheduler'},{header:'Management',accessorKey:'mode'},{header:'Ready',accessorFn:(r:any)=><StatusLabel status={r.ready?'success':'error'}>{r.ready?'Ready':r.reason}</StatusLabel>},{header:'Metrics coverage',accessorFn:(r:any)=>r.coverage===undefined?'—':`${Math.round(r.coverage*100)}%`},{header:'Eligible nodes',accessorKey:'eligible'},{header:'Plugins / bounded weight',accessorFn:(r:any)=><Stack direction="row" gap={.5}>{r.plugins.map((p:any)=><Chip size="small" key={p.name} label={`${p.name} ${p.weight} [${p.bounds?.minimum}-${p.bounds?.maximum}]`}/>)}</Stack>},{header:'Observed pods',accessorFn:(r:any)=>podCohorts.get(r.scheduler)||0},{header:'Revision',accessorKey:'revision'}] as any}/></SectionBox><SectionBox title="Audited operations"><Table data={operationRows} columns={[{header:'Operation',accessorFn:(r:any)=>`${r.namespace}/${r.name}`},{header:'Action',accessorKey:'action'},{header:'Target',accessorKey:'target'},{header:'Approved',accessorKey:'approved'},{header:'Phase',accessorKey:'phase'},{header:'Revision',accessorKey:'revision'}] as any}/></SectionBox></>}
    {tab===3&&<SectionBox title="Node provenance, capability and projection"><Table data={nodeRows} columns={[{header:'Node',accessorKey:'name'},{header:'Ready',accessorFn:(r:any)=><StatusLabel status={r.ready?'success':'error'}>{r.ready?'Ready':'NotReady'}</StatusLabel>},{header:'Provider / region',accessorFn:(r:any)=>`${r.provider} / ${r.region}`},{header:'Environment',accessorKey:'environment'},{header:'Reliability',accessorKey:'reliability'},{header:'Failure domain',accessorKey:'failureDomain'},{header:'Trimaran',accessorFn:(r:any)=><Chip size="small" color={r.trimaran?'success':'warning'} label={r.trimaran?'fresh':'missing'}/>},{header:'CPU',accessorKey:'cpu'},{header:'Memory',accessorKey:'memory'},{header:'DRA classes',accessorFn:(r:any)=>r.dra.join(', ')||'—'}] as any}/></SectionBox>}
    {tab===4&&<><Alert severity="info" sx={{my:2}}>此处只标记真实或人工观察窗口，不注入故障、关机或驱逐 Pod。</Alert><SectionBox title="Disturbance trajectories"><Table data={disturbanceRows} columns={[{header:'Window',accessorFn:(r:any)=>`${r.namespace}/${r.name}`},{header:'Source',accessorKey:'source'},{header:'Started',accessorKey:'started'},{header:'Ended',accessorKey:'ended'},{header:'Trajectory phase',accessorKey:'phase'},{header:'Affected services',accessorKey:'services'}] as any}/></SectionBox></>}
    {tab===5&&<Stack gap={2} sx={{mt:2}}><SectionBox title="Dynamic Resource Allocation"><Table data={[...(deviceClasses||[]).map((x:any)=>({kind:'DeviceClass',namespace:'—',name:raw(x).metadata?.name,node:'cluster',driver:raw(x).spec?.selectors?.[0]?.cel?.expression||'—'})),...(slices||[]).map((x:any)=>({kind:'ResourceSlice',namespace:'—',name:raw(x).metadata?.name,node:raw(x).spec?.nodeName||'all',driver:raw(x).spec?.driver||'—'})),...(claims||[]).map((x:any)=>({kind:'ResourceClaim',namespace:raw(x).metadata?.namespace,name:raw(x).metadata?.name,node:raw(x).status?.allocation?.nodeSelector?.nodeSelectorTerms?.[0]?.matchExpressions?.[0]?.values?.join(', ')||'pending',driver:'—'}))]} columns={[{header:'Kind',accessorKey:'kind'},{header:'Namespace',accessorKey:'namespace'},{header:'Name',accessorKey:'name'},{header:'Node / allocation',accessorKey:'node'},{header:'Driver / selector',accessorKey:'driver'}] as any}/></SectionBox><Alert severity="info">Storage、Gateway 与 Cilium 证据由 collector 汇总到每个 ServiceOutcomePolicy；缺少相应指标时会降低 completeness，不会被当作完美状态。</Alert></Stack>}
    <OperationDialog open={operationOpen} onClose={()=>setOperationOpen(false)} schedulers={schedulerNames}/>
  </Box>;
}

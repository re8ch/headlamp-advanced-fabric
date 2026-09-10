import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, StatusLabel, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Alert, Box, Chip, FormControl, InputLabel, MenuItem, Select, Stack, Typography, useTheme } from '@mui/material';
import React from 'react';

const TradeoffTriangle = K8s.crd.makeCustomResourceClass({ apiInfo: [{ group: 'networking.re8ch.com', version: 'v1alpha1' }], kind: 'TradeoffTriangle', pluralName: 'tradeofftriangles', singularName: 'tradeofftriangle', isNamespaced: false });
const NetworkObservationEpisode = K8s.crd.makeCustomResourceClass({ apiInfo: [{ group: 'networking.re8ch.com', version: 'v1alpha1' }], kind: 'NetworkObservationEpisode', pluralName: 'networkobservationepisodes', singularName: 'networkobservationepisode', isNamespaced: false });
const raw = (item: any) => item?.jsonData || item || {};
function parse(item: any, key: string) { try { return JSON.parse(raw(item).data?.[key]); } catch { return null; } }

export const STRUCTURAL_QUANTITIES: Record<string, string> = {
  Q: 'Forwarding quality: reachability, loss and RTT for the same endpoint and protocol.',
  K: 'Convergence responsiveness measured from completed, naturally occurring network episodes.',
  H: 'Path persistence and switching behaviour observed over time.',
  C: 'Control-plane activity: updates, withdrawals, flaps and RIB/FIB changes.',
  R: 'Simultaneously usable route redundancy, not merely configured route count.',
  D: 'Verified failure-domain diversity across tunnels, gateways, ASNs and shared dependencies.',
};
const STRUCTURE_SYMBOLS: Record<string, string[]> = {
  Q: ['a_reach', 'l_path', 't_rtt', 'b_rx'], K: ['t_state', 't_conv', 't_recover', 'delta_ribfib'],
  H: ['p_route', 'x_nh', 't_persist', 'f_switch', 'a_osc'],
  C: ['u_bgp', 'w_bgp', 'lambda_flap', 'delta_ribfib', 'n_path_change'],
  R: ['w_ecmp', 'm_route', 'n_peer', 'n_nh', 'n_if', 'n_alt'],
  D: ['n_tun', 'n_gw', 'n_asn', 'g_dep', 'n_alt'],
};
type Point = { time: number; value: number };
type Series = { symbol: string; dimension?: string; unit: string; points: Point[] };
const EMPTY_HISTORY: any[] = [];

export const OBSERVABLE_DATASOURCES = [
  {
    name: 'VictoriaMetrics',
    queryPath: '/api/v1/namespaces/observability-system/services/http:vmselect-re8ch-metrics:8481/proxy/select/0/prometheus/api/v1/query_range',
  },
  {
    name: 'VictoriaMetrics recovery',
    queryPath: '/api/v1/namespaces/observability-system/services/http:vmsingle-opencost:8428/proxy/api/v1/query_range',
  },
] as const;

type MeasurementEnvelope = {
  node: string;
  envelopeComplete?: boolean;
  measurements?: Array<{ symbol?: string; state?: string; observationStatus?: string }>;
};

export function liveObservationState(envelope: MeasurementEnvelope | undefined, fallback: any) {
  if (!envelope?.measurements?.length) return fallback || {};
  const records = new Map(envelope.measurements.map(item => [item.symbol, item]));
  const missingSymbols = [...new Set(envelope.measurements
    .filter(item => item.state !== 'observed')
    .map(item => item.symbol)
    .filter((symbol): symbol is string => Boolean(symbol)))];
  const observed = envelope.measurements.filter(item => item.state === 'observed').length;
  const required = 31;
  const latent = Object.fromEntries(Object.entries(STRUCTURE_SYMBOLS).map(([name, symbols]) => {
    const availableSymbols = symbols.filter(symbol => records.get(symbol)?.state === 'observed');
    const missing = symbols.filter(symbol => !availableSymbols.includes(symbol));
    return [name, {
      state: missing.length ? (availableSymbols.length ? 'Partial' : 'NotObserved') : 'Observed',
      requiredSymbols: symbols,
      availableSymbols,
      missingSymbols: missing,
      reason: 'observation-derived component vector; no scalar mapping',
    }];
  }));
  return {
    ...(fallback || {}),
    latent,
    trackingReady: envelope.envelopeComplete === true && observed === required && missingSymbols.length === 0,
    trackingGate: { required, observed, missingSymbols },
  };
}

function historiesToSeries(history: any[]): Series[] {
  const output = new Map<string, Series>();
  for (const point of history || []) {
    const time = Date.parse(point.observedAt || '') / 1000;
    if (!Number.isFinite(time)) continue;
    for (const [symbol, item] of Object.entries(point.values || {}) as any) {
      if (!Number.isFinite(Number(item?.value))) continue;
      if (!output.has(symbol)) output.set(symbol, { symbol, unit: item?.unit || '', points: [] });
      output.get(symbol)!.points.push({ time, value: Number(item.value) });
    }
  }
  return [...output.values()];
}

function useObservableSeries(node: string, rangeSeconds: number, fallback: any[]) {
  const [series, setSeries] = React.useState<Series[]>([]);
  const [error, setError] = React.useState('');
  const [source, setSource] = React.useState('collector preview');
  React.useEffect(() => {
    let active = true;
    if (!node) return () => undefined;
    const end = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({ query: `advanced_fabric_observable{node="${node.replace(/["\\]/g, '')}",plane="node"}`, start: String(end - rangeSeconds), end: String(end), step: String(Math.max(15, Math.floor(rangeSeconds / 240))) });
    (async () => {
      const failures: string[] = [];
      for (const datasource of OBSERVABLE_DATASOURCES) {
        try {
          const response: any = await ApiProxy.request(`${datasource.queryPath}?${params.toString()}`, { method: 'GET', isJSON: false });
          if (!response?.ok) throw new Error(`HTTP ${response?.status || 'unavailable'}`);
          const payload = await response.json();
          if (payload?.status !== 'success') throw new Error(payload?.error || 'query failed');
          const next = (payload?.data?.result || []).map((item: any) => ({
            symbol: item.metric?.symbol,
            dimension: item.metric?.dimension,
            unit: item.metric?.unit || '',
            points: (item.values || []).map(([time, value]: [number, string]) => ({ time: Number(time), value: Number(value) })),
          })).filter((item: Series) => item.symbol && item.points.length);
          if (!next.length) throw new Error('no samples in range');
          if (!active) return;
          setSeries(next);
          setSource(datasource.name);
          setError('');
          return;
        } catch (reason) {
          failures.push(`${datasource.name}: ${String(reason)}`);
        }
      }
      if (!active) return;
      setSeries(historiesToSeries(fallback));
      setSource('collector preview');
      setError(`Time-series sources returned no usable samples; showing the bounded collector preview. ${failures.join('; ')}`);
    })();
    return () => { active = false; };
  }, [node, rangeSeconds, fallback]);
  return { series, error, source };
}

function Sparkline({ series, eventTime }: { series?: Series; eventTime?: number }) {
  const theme = useTheme(); const points = series?.points || [];
  if (!points.length) return <Typography color="text.secondary">No samples in range.</Typography>;
  const times = points.map(point => point.time); const values = points.map(point => point.value);
  const minT = Math.min(...times); const maxT = Math.max(...times); const minV = Math.min(...values); const maxV = Math.max(...values);
  const x = (value: number) => 5 + ((value - minT) / Math.max(1, maxT - minT)) * 190;
  const y = (value: number) => 55 - ((value - minV) / Math.max(1e-9, maxV - minV)) * 45;
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.time)} ${y(point.value)}`).join(' ');
  const eventX = eventTime && eventTime >= minT && eventTime <= maxT ? x(eventTime) : null;
  return <svg viewBox="0 0 200 62" width="100%" role="img" aria-label={`${series?.symbol} tracking chart`}><line x1="5" y1="55" x2="195" y2="55" stroke={theme.palette.divider} />{eventX !== null && <line x1={eventX} y1="5" x2={eventX} y2="55" stroke={theme.palette.warning.main} strokeDasharray="3 2" />}<path d={path} fill="none" stroke={theme.palette.primary.main} strokeWidth="2" /><text x="5" y="10" fontSize="7" fill={theme.palette.text.secondary}>{maxV.toPrecision(4)}</text><text x="5" y="53" fontSize="7" fill={theme.palette.text.secondary}>{minV.toPrecision(4)}</text></svg>;
}

function StructurePanel({ name, series, eventTime }: { name: string; series: Series[]; eventTime?: number }) {
  return <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}><Typography variant="h6">{name} · {STRUCTURAL_QUANTITIES[name]}</Typography><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(240px, 1fr))' }, gap: 1.5, mt: 1.5 }}>{(STRUCTURE_SYMBOLS[name] || []).flatMap(symbol => { const matches = series.filter(item => item.symbol === symbol); const facets = matches.length ? matches : [undefined]; return facets.map((item, index) => <Box key={`${symbol}-${item?.dimension || index}`} sx={{ bgcolor: 'background.default', borderRadius: 1, p: 1 }}><Stack direction="row" justifyContent="space-between"><Typography fontWeight={700}>{symbol}{item?.dimension ? ` · ${item.dimension}` : ''}</Typography><Typography variant="caption" color="text.secondary">{item?.unit || 'raw unit'}</Typography></Stack><Sparkline series={item} eventTime={eventTime} /></Box>); })}</Box></Box>;
}

export default function TradeoffObservatory({ maps, measurements }: { maps: any[]; measurements: MeasurementEnvelope[] }) {
  const [triangles, triangleError] = (TradeoffTriangle as any).useList({ refetchInterval: 15000 });
  const [episodes, episodeError] = (NetworkObservationEpisode as any).useList({ refetchInterval: 15000 });
  const structural = (maps || []).map(item => parse(item, 'observations.json')).find(Boolean)?.nodes || {};
  const nodes = [...new Set([...Object.keys(structural), ...(measurements || []).map(item => item.node)])].sort(); const [selectedNode, setSelectedNode] = React.useState('');
  const node = nodes.includes(selectedNode) ? selectedNode : nodes[0] || ''; const envelope = (measurements || []).find(item => item.node === node); const nodeData = liveObservationState(envelope, structural[node]);
  const [rangeSeconds, setRangeSeconds] = React.useState(86400); const { series, error, source } = useObservableSeries(node, rangeSeconds, nodeData.history || EMPTY_HISTORY);
  const triangleItems = (triangles || []).map(raw); const [selectedTriangle, setSelectedTriangle] = React.useState('');
  const triangleName = triangleItems.some((item: any) => item.metadata?.name === selectedTriangle) ? selectedTriangle : triangleItems[0]?.metadata?.name || '';
  const triangle = triangleItems.find((item: any) => item.metadata?.name === triangleName); const vertices = triangle?.spec?.vertices || ['Q', 'K', 'H'];
  const episodeItems = (episodes || []).map(raw).filter((item: any) => item.spec?.subjectRef?.name === node).sort((a: any, b: any) => String(b.spec?.detectedAt).localeCompare(String(a.spec?.detectedAt)));
  const latestEpisode = episodeItems[0] || nodeData.latestEpisode; const eventTime = Date.parse(latestEpisode?.spec?.detectedAt || latestEpisode?.startedAt || '') / 1000;
  const latent = nodeData.latent || {}; const vertexRows = Object.entries(latent).map(([name, value]: any) => ({ name, state: value.state, available: (value.availableSymbols || []).join(', ') || '—', missing: (value.missingSymbols || []).join(', ') || '—', reason: value.reason }));
  const gate = nodeData.trackingGate || {}; const ready = nodeData.trackingReady === true;
  return <Box><Typography variant="h4">Advanced Fabric · Tracking Observatory</Typography><Typography color="text.secondary">Observation-only Q/K/H/C/R/D tracking in original units. Relationship views align common trends and episode cursors only.</Typography>{(triangleError || episodeError) && <Alert severity="error" sx={{ my: 2 }}>Unable to read observation APIs: {String(triangleError || episodeError)}</Alert>}<Alert severity="info" sx={{ my: 2 }}>Tracking opens independently per node after all 31 observation channels are valid. A quiet event-conditioned channel is recorded as right-censored and remains numerically empty; only broken, stale or incomplete evidence blocks tracking.</Alert><Stack direction={{ xs: 'column', md: 'row' }} gap={2} sx={{ my: 2 }}><FormControl size="small" sx={{ minWidth: 260 }}><InputLabel id="tracking-subject">Node</InputLabel><Select labelId="tracking-subject" label="Node" value={node} onChange={event => setSelectedNode(event.target.value)}>{nodes.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</Select></FormControl><FormControl size="small" sx={{ minWidth: 180 }}><InputLabel id="tracking-range">Time range</InputLabel><Select labelId="tracking-range" label="Time range" value={rangeSeconds} onChange={event => setRangeSeconds(Number(event.target.value))}><MenuItem value={3600}>1 hour</MenuItem><MenuItem value={21600}>6 hours</MenuItem><MenuItem value={86400}>24 hours</MenuItem><MenuItem value={7776000}>90 days</MenuItem></Select></FormControl><FormControl size="small" sx={{ minWidth: 280 }}><InputLabel id="tracking-relationship">Relationship</InputLabel><Select labelId="tracking-relationship" label="Relationship" value={triangleName} onChange={event => setSelectedTriangle(event.target.value)}>{triangleItems.map((item: any) => <MenuItem key={item.metadata?.name} value={item.metadata?.name}>{item.spec?.vertexLabel || item.metadata?.name}</MenuItem>)}</Select></FormControl><Chip color={ready ? 'success' : 'warning'} label={`${gate.observed || 0}/${gate.required || 31} valid · ${ready ? 'tracking ready' : 'blocked'}`} /><Chip label={`${episodeItems.length} natural episodes`} />{ready && <Chip variant="outlined" label={`series: ${source}`} />}</Stack>{!ready && <Alert severity="warning" sx={{ mb: 2 }}>Tracking and relationship charts are blocked for {node || 'this node'}. Broken, stale or incomplete channels: {(gate.missingSymbols || []).join(', ') || 'measurement envelope unavailable'}.</Alert>}{ready && error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}{ready && <><SectionBox title="Q/K/H/C/R/D tracking"><Alert severity="info" sx={{ mb: 2 }}>b_rx facets preserve the available Hubble/Gateway dimensions and original units. Zero is valid only for a completed observation window. Event-conditioned facets can be empty during a quiet window; that is a valid right-censored observation, not zero and not missing evidence.</Alert><Stack gap={2}>{Object.keys(STRUCTURE_SYMBOLS).map(name => <StructurePanel key={name} name={name} series={series} eventTime={eventTime} />)}</Stack></SectionBox><SectionBox title={`${triangle?.spec?.vertexLabel || vertices.join('–')} relationship · synchronized common trends`}><Alert severity="info" sx={{ mb: 2 }}>These panels share one time range and natural-episode cursor. They do not produce a combined score or directional conclusion.</Alert><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: `repeat(${Math.min(vertices.length, 3)}, minmax(300px, 1fr))` }, gap: 2 }}>{vertices.map((name: string) => <StructurePanel key={name} name={name} series={series} eventTime={eventTime} />)}</Box></SectionBox></>}<SectionBox title={`${node || 'Node'} structural measurement completeness`}><Table data={vertexRows} columns={[{ header: 'Quantity', accessorKey: 'name' }, { header: 'Meaning', accessorFn: (item: any) => STRUCTURAL_QUANTITIES[item.name] || '—' }, { header: 'Evidence state', accessorFn: (item: any) => <StatusLabel status={item.state === 'Observed' ? 'success' : item.state === 'Partial' ? 'warning' : 'unknown'}>{item.state}</StatusLabel> }, { header: 'Available measurements', accessorKey: 'available' }, { header: 'Missing measurements', accessorKey: 'missing' }, { header: 'Representation', accessorKey: 'reason' }] as any} /></SectionBox></Box>;
}

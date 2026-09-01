import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, StatusLabel, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Alert, Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import React from 'react';

type SharedService = {
  name: string;
  kind: string;
  direction: 'owner-to-consumer' | 'consumer-to-owner' | 'bidirectional';
  endpoint?: string;
  access?: string;
  status?: string;
};

type ConnectedCluster = {
  context: string;
  displayName: string;
  role: 'hub' | 'controlled-subcluster';
  owner: string;
  relationship: string;
  sharedServices?: SharedService[];
};

type Catalog = {
  observedFrom: string;
  refreshSeconds: number;
  clusters: ConnectedCluster[];
};

type Probe = {alive: boolean; checkedAt: number; version?: string; error?: string};

const raw = (item: any) => item?.jsonData || item || {};
const clusterOf = (item: any) => item?.cluster || item?._clusterName || '';

function parseCatalog(item: any): Catalog | null {
  try {
    return JSON.parse(raw(item).data?.['catalog.json'] || '');
  } catch {
    return null;
  }
}

function readyNode(item: any) {
  return raw(item).status?.conditions?.some((condition: any) =>
    condition.type === 'Ready' && condition.status === 'True');
}

function AmongClusters() {
  const [catalogMap, catalogError] = K8s.ResourceClasses.ConfigMap.useGet(
    'among-clusters-catalog', 'headlamp', {cluster: 're8ch-k3s'} as any);
  const catalog = parseCatalog(catalogMap);
  const configured = K8s.useClustersConf() || {};
  const contexts = (catalog?.clusters || []).map(item => item.context)
    .filter(context => Boolean(configured[context]));
  const refreshMs = Math.max(10, catalog?.refreshSeconds || 15) * 1000;
  const [probes, setProbes] = React.useState<Record<string, Probe>>({});
  const [nodes, nodeError] = K8s.ResourceClasses.Node.useList({clusters: contexts, refetchInterval: refreshMs} as any);
  const [namespaces, namespaceError] = K8s.ResourceClasses.Namespace.useList({clusters: contexts, refetchInterval: refreshMs} as any);
  const [pods, podError] = K8s.ResourceClasses.Pod.useList({clusters: contexts, refetchInterval: refreshMs} as any);
  const [services, serviceError] = K8s.ResourceClasses.Service.useList({clusters: contexts, refetchInterval: refreshMs} as any);

  React.useEffect(() => {
    let active = true;
    async function probe() {
      const checkedAt = Date.now();
      const results = await Promise.all(contexts.map(async context => {
        try {
          const version = await K8s.getVersion(context);
          return [context, {alive: true, checkedAt, version: String(version.gitVersion || version.git_version || 'reachable')}] as const;
        } catch (error) {
          return [context, {alive: false, checkedAt, error: String(error)}] as const;
        }
      }));
      if (active) setProbes(Object.fromEntries(results));
    }
    probe();
    const timer = window.setInterval(probe, refreshMs);
    return () => { active = false; window.clearInterval(timer); };
  }, [contexts.join('|'), refreshMs]);

  const rows = (catalog?.clusters || []).map(cluster => {
    const available = Boolean(configured[cluster.context]);
    const probe = probes[cluster.context];
    const clusterNodes = (nodes || []).filter(item => clusterOf(item) === cluster.context);
    const ready = clusterNodes.filter(readyNode).length;
    const clusterPods = (pods || []).filter(item => clusterOf(item) === cluster.context);
    const runningPods = clusterPods.filter(item => raw(item).status?.phase === 'Running').length;
    const nsCount = (namespaces || []).filter(item => clusterOf(item) === cluster.context).length;
    const serviceCount = (services || []).filter(item => clusterOf(item) === cluster.context).length;
    const state = !available ? 'Not configured' : !probe ? 'Probing' : !probe.alive ? 'Unreachable' :
      clusterNodes.length > 0 && ready < clusterNodes.length ? 'Degraded' : 'Alive';
    return {...cluster, available, probe, state, nodes: clusterNodes.length, ready, pods: clusterPods.length,
      runningPods, namespaces: nsCount, serviceCount};
  });
  const sharedRows = (catalog?.clusters || []).flatMap(cluster => (cluster.sharedServices || []).map(service => ({
    cluster: cluster.displayName, owner: cluster.owner, ...service,
  })));
  const alive = rows.filter(row => row.state === 'Alive').length;
  const loading = rows.some(row => row.state === 'Probing');
  const resourceErrors = [nodeError, namespaceError, podError, serviceError].filter(Boolean);

  return <Box sx={{p: 2}}>
    <Typography variant="h4">AmongClusters</Typography>
    <Typography color="text.secondary">受控多集群连接、实时存活度、资源概况与双方显式发布的共享服务。</Typography>
    {loading && <LinearProgress sx={{mt: 2}}/>}
    {catalogError && <Alert severity="error" sx={{mt: 2}}>无法读取 AmongClusters catalog：{String(catalogError)}</Alert>}
    {!catalogError && !catalog && <Alert severity="warning" sx={{mt: 2}}>AmongClusters catalog 尚未安装或格式无效。</Alert>}
    {resourceErrors.length > 0 && <Alert severity="warning" sx={{mt: 2}}>部分集群概况无权读取或暂时不可达；Alive 仍由独立 API 探测判定。</Alert>}
    <Stack direction="row" gap={1} sx={{my: 2}} flexWrap="wrap">
      <Chip label={`${rows.length} managed contexts`}/>
      <Chip color="success" label={`${alive} alive`}/>
      <Chip color={rows.some(row => row.state === 'Unreachable') ? 'error' : 'default'} label={`${rows.filter(row => row.state === 'Unreachable').length} unreachable`}/>
      <Chip label={`${sharedRows.length} published services`}/>
    </Stack>
    <SectionBox title="Connected cluster overview">
      <Table data={rows} columns={[
        {header: 'Cluster', accessorFn: (row: any) => <Stack><Typography>{row.displayName}</Typography><Typography variant="caption" color="text.secondary">{row.context}</Typography></Stack>},
        {header: 'Owner / role', accessorFn: (row: any) => `${row.owner} / ${row.role}`},
        {header: 'Alive', accessorFn: (row: any) => <StatusLabel status={row.state === 'Alive' ? 'success' : row.state === 'Degraded' || row.state === 'Probing' ? 'warning' : 'error'}>{row.state}</StatusLabel>},
        {header: 'Kubernetes', accessorFn: (row: any) => row.probe?.version || '—'},
        {header: 'Nodes ready', accessorFn: (row: any) => `${row.ready}/${row.nodes}`},
        {header: 'Pods running', accessorFn: (row: any) => `${row.runningPods}/${row.pods}`},
        {header: 'Namespaces', accessorKey: 'namespaces'},
        {header: 'Services', accessorKey: 'serviceCount'},
        {header: 'Last API probe', accessorFn: (row: any) => row.probe?.checkedAt ? new Date(row.probe.checkedAt).toLocaleTimeString() : '—'},
      ] as any}/>
    </SectionBox>
    <SectionBox title="Explicitly published services between cluster owners">
      <Table data={sharedRows} columns={[
        {header: 'Cluster', accessorKey: 'cluster'},
        {header: 'Service', accessorKey: 'name'},
        {header: 'Kind', accessorKey: 'kind'},
        {header: 'Direction', accessorFn: (row: any) => <Chip size="small" label={row.direction} color={row.direction === 'bidirectional' ? 'primary' : 'default'}/>},
        {header: 'Endpoint', accessorKey: 'endpoint'},
        {header: 'Access contract', accessorKey: 'access'},
        {header: 'Declared status', accessorFn: (row: any) => <StatusLabel status={row.status === 'active' ? 'success' : 'warning'}>{row.status || 'declared'}</StatusLabel>},
      ] as any}/>
    </SectionBox>
    <Alert severity="info" sx={{mt: 2}}>共享服务表是双方 owner-reviewed 的发布契约，不代表自动共享数据、Secret、Service 网络或跨组织管理员权限。API 探测失败也不会自动修改目标集群。</Alert>
  </Box>;
}

export default AmongClusters;

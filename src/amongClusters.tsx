import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, StatusLabel, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Alert, Box, Chip, Stack, Typography } from '@mui/material';
import React from 'react';

const apiInfo = [{group: 'collaboration.re8ch.com', version: 'v1alpha1'}];
const resourceClass = (kind: string, singularName: string, pluralName: string) =>
  K8s.crd.makeCustomResourceClass({apiInfo, kind, singularName, pluralName, isNamespaced: false});
const CollaborationCluster = resourceClass('CollaborationCluster', 'collaborationcluster', 'collaborationclusters');
const CollaborationRelationship = resourceClass('CollaborationRelationship', 'collaborationrelationship', 'collaborationrelationships');
const PublishedService = resourceClass('PublishedService', 'publishedservice', 'publishedservices');
const CollaborationEvent = resourceClass('CollaborationEvent', 'collaborationevent', 'collaborationevents');
const raw = (item: any) => item?.jsonData || item || {};
const nameOf = (item: any) => raw(item).metadata?.name || '';
const timeText = (value?: string) => value ? new Date(value).toLocaleString() : 'Never';
const statusColor = (state?: string) => state === 'Alive' || state === 'Active' ? 'success' : state === 'Degraded' || state === 'Proposed' ? 'warning' : 'error';

export default function AmongClusters() {
  const options = {cluster: 're8ch-k3s', refetchInterval: 15000} as any;
  const [clusters, clusterError] = CollaborationCluster.useList(options);
  const [relationships, relationshipError] = CollaborationRelationship.useList(options);
  const [services, serviceError] = PublishedService.useList(options);
  const [events, eventError] = CollaborationEvent.useList(options);
  const errors = [clusterError, relationshipError, serviceError, eventError].filter(Boolean);
  const clusterRows = (clusters || []).map((item: any) => { const value = raw(item); return {
    name: nameOf(item), owner: value.spec?.owner, state: value.status?.state || 'Unreachable',
    version: value.status?.kubernetesVersion || '—', heartbeat: value.status?.lastHeartbeatTime,
    sequence: value.status?.lastSequence || 0, ...value.status?.summary}; });
  const relationshipRows = (relationships || []).map((item: any) => { const value = raw(item); return {
    name: nameOf(item), participants: (value.spec?.participants || []).join(' ↔ '),
    state: value.status?.state || 'Proposed', reason: value.status?.reason || '—'}; });
  const serviceRows = (services || []).map((item: any) => { const value = raw(item); return {
    name: nameOf(item), publisher: value.spec?.publisher, consumers: (value.spec?.consumers || []).join(', '),
    kind: value.spec?.kind, direction: value.spec?.direction, endpoint: value.spec?.endpoint || '—',
    access: value.spec?.accessContract, state: value.status?.state || 'Proposed', healthy: value.status?.healthy,
    observedAt: value.status?.lastObservedTime}; });
  const eventRows = (events || []).map((item: any) => raw(item)).sort((a: any, b: any) =>
    String(b.spec?.occurredAt || '').localeCompare(String(a.spec?.occurredAt || ''))).slice(0, 50);
  const alive = clusterRows.filter((row: any) => row.state === 'Alive').length;
  return <Box sx={{p: 2}}>
    <Typography variant="h4">AmongClusters</Typography>
    <Typography color="text.secondary">独立 AmongClusters 服务记录的集群协作状态、签名过程与显式服务契约。</Typography>
    {errors.length > 0 && <Alert severity="error" sx={{mt: 2}}>AmongClusters service unavailable。UI 不会回退为浏览器直接探测远端集群。</Alert>}
    <Stack direction="row" gap={1} sx={{my: 2}} flexWrap="wrap">
      <Chip label={`${clusterRows.length} registered clusters`}/><Chip color="success" label={`${alive} alive`}/>
      <Chip label={`${relationshipRows.filter((row: any) => row.state === 'Active').length} active relationships`}/>
      <Chip label={`${serviceRows.filter((row: any) => row.state === 'Active').length} active published services`}/>
    </Stack>
    <SectionBox title="Connected cluster overview"><Table data={clusterRows} columns={[
      {header: 'Cluster', accessorKey: 'name'}, {header: 'Owner', accessorKey: 'owner'},
      {header: 'State', accessorFn: (row: any) => <StatusLabel status={statusColor(row.state)}>{row.state}</StatusLabel>},
      {header: 'Kubernetes', accessorKey: 'version'}, {header: 'Nodes ready', accessorFn: (row: any) => `${row.nodesReady || 0}/${row.nodesTotal || 0}`},
      {header: 'Pods running', accessorFn: (row: any) => `${row.podsRunning || 0}/${row.podsTotal || 0}`},
      {header: 'Namespaces', accessorKey: 'namespaces'}, {header: 'Services', accessorKey: 'services'},
      {header: 'Last heartbeat', accessorFn: (row: any) => timeText(row.heartbeat)},] as any}/></SectionBox>
    <SectionBox title="Collaboration relationships"><Table data={relationshipRows} columns={[
      {header: 'Relationship', accessorKey: 'name'}, {header: 'Participants', accessorKey: 'participants'},
      {header: 'State', accessorFn: (row: any) => <StatusLabel status={statusColor(row.state)}>{row.state}</StatusLabel>},
      {header: 'Reason', accessorKey: 'reason'},] as any}/></SectionBox>
    <SectionBox title="Explicitly published services"><Table data={serviceRows} columns={[
      {header: 'Service', accessorKey: 'name'}, {header: 'Publisher', accessorKey: 'publisher'}, {header: 'Consumers', accessorKey: 'consumers'},
      {header: 'Kind', accessorKey: 'kind'}, {header: 'Direction', accessorKey: 'direction'}, {header: 'Endpoint', accessorKey: 'endpoint'},
      {header: 'Access contract', accessorKey: 'access'},
      {header: 'State', accessorFn: (row: any) => <StatusLabel status={statusColor(row.state)}>{row.state}</StatusLabel>},
      {header: 'Last observation', accessorFn: (row: any) => timeText(row.observedAt)},] as any}/></SectionBox>
    <SectionBox title="Recent signed collaboration events"><Table data={eventRows} columns={[
      {header: 'Cluster', accessorFn: (row: any) => row.spec?.clusterID}, {header: 'Sequence', accessorFn: (row: any) => row.spec?.sequence},
      {header: 'Type', accessorFn: (row: any) => row.spec?.type}, {header: 'Subject', accessorFn: (row: any) => row.spec?.subject || '—'},
      {header: 'Occurred at', accessorFn: (row: any) => timeText(row.spec?.occurredAt)},] as any}/></SectionBox>
    <Alert severity="info" sx={{mt: 2}}>Alive、关系和服务状态全部来自 AmongClusters 服务。Headlamp 登录只控制 UI 对 Hub CRD 的读取权限，不参与远端集群探测。</Alert>
  </Box>;
}

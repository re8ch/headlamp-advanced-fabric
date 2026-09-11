import { ApiProxy, K8s, registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { serviceProxyBase } from './contract';
import TradeoffObservatory, { ObservationClient } from './tradeoff';

const AdvancedFabric = K8s.crd.makeCustomResourceClass({
  apiInfo: [{ group: 'networking.advfab.org', version: 'v1alpha1' }],
  kind: 'AdvancedFabric',
  pluralName: 'advancedfabrics',
  singularName: 'advancedfabric',
  isNamespaced: false,
});

function Dashboard() {
  const [fabrics, error] = (AdvancedFabric as any).useList({ refetchInterval: 15000 });
  const items = (fabrics || []).map((item: any) => item?.jsonData || item || {});
  const published = items.find((item: any) => item.status?.observationAPI?.ready === true);
  const discovery = published?.status?.observationAPI;
  const serviceRef = discovery?.serviceRef;
  const supported = discovery?.apiVersion === 'v1' && Array.isArray(discovery?.capabilities);
  const client = React.useMemo<ObservationClient | null>(() => {
    if (!serviceRef || !supported) return null;
    const base = serviceProxyBase(serviceRef);
    return async path => {
      const response: any = await ApiProxy.request(`${base}${path}`, {
        method: 'GET',
        isJSON: false,
      });
      if (!response?.ok)
        throw new Error(
          `Advanced Fabric observation API returned HTTP ${response?.status || 'unavailable'}`
        );
      return response.json();
    };
  }, [serviceRef?.namespace, serviceRef?.name, serviceRef?.port, supported]);

  if (error)
    return <Alert severity="error">Unable to discover Advanced Fabric: {String(error)}</Alert>;
  if (!fabrics) return <CircularProgress aria-label="Discovering Advanced Fabric" />;
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4">Advanced Fabric</Typography>
      <Typography color="text.secondary">
        Read-only network evidence supplied by the installed Advanced Fabric instance.
      </Typography>
      {!published && (
        <Alert severity="warning" sx={{ my: 2 }}>
          No Advanced Fabric instance currently publishes a ready observation API.
        </Alert>
      )}
      {published && !supported && (
        <Alert severity="error" sx={{ my: 2 }}>
          This plugin requires observation API v1. The installed instance advertises an incompatible
          version.
        </Alert>
      )}
      {client && <TradeoffObservatory client={client} capabilities={discovery.capabilities} />}
    </Box>
  );
}

registerSidebarEntry({
  name: 'advanced-fabric',
  url: '/advanced-fabric',
  icon: 'mdi:router-network',
  parent: '',
  label: 'Advanced Fabric',
});
registerRoute({
  path: '/advanced-fabric',
  sidebar: 'advanced-fabric',
  name: 'Advanced Fabric',
  component: () => <Dashboard />,
});

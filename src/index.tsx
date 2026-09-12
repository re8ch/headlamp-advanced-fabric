import { ApiProxy, registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { serviceProxyBase } from './contract';
import TradeoffObservatory, { ObservationClient } from './tradeoff';

function useAdvancedFabrics() {
  const [state, setState] = React.useState<{ items?: any[]; error?: string }>({});
  React.useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response: any = await ApiProxy.request(
          '/apis/networking.advfab.org/v1alpha1/advancedfabrics',
          { method: 'GET', isJSON: false }
        );
        if (!response?.ok)
          throw new Error(`AdvancedFabric discovery returned HTTP ${response?.status}`);
        const document = await response.json();
        if (active) setState({ items: document?.items || [] });
      } catch (error) {
        if (active) setState(previous => ({ ...previous, error: String(error) }));
      }
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  return state;
}

function Dashboard() {
  const fabrics = useAdvancedFabrics();
  const items = fabrics.items || [];
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

  if (fabrics.error && !fabrics.items)
    return <Alert severity="error">Unable to discover Advanced Fabric: {fabrics.error}</Alert>;
  if (!fabrics.items) return <CircularProgress aria-label="Discovering Advanced Fabric" />;
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

# Headlamp Advanced Fabric

Headlamp Advanced Fabric is a read-only UI client for the public Advanced Fabric
observation API. It discovers the API from
`AdvancedFabric.status.observationAPI` and accesses the advertised Kubernetes
Service through the Kubernetes Service Proxy.

The plugin does not scan implementation ConfigMaps, query a metrics database,
derive structural coordinates, or provide fixed/demo/fallback observations.
Missing producer data remains unavailable in the UI. Relationship polygons are
drawn only when the producer supplies all three synchronized coordinates.

## Requirements

- `networking.advfab.org/v1alpha1` `AdvancedFabric` CRD;
- observation API `v1` with the advertised `subjects`, `snapshots`,
  `relationships`, `relationship-series`, and `episodes` capabilities; and
- RBAC for `get/list/watch` on `AdvancedFabric` plus `get` on the advertised
  Service proxy.

## Build

```sh
npm ci
npm run tsc
npm run lint
npm run build
npm run package
```

# Headlamp Advanced Fabric

[![Artifact Hub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/headlamp-advanced-fabric)](https://artifacthub.io/packages/search?repo=headlamp-advanced-fabric)

Standard Headlamp plugin for inspecting Advanced Fabric node datapath mode,
FRR/BGP/BFD health, kernel ECMP routes, per-node path decisions and the
NWQ-1/DNSQ-1 network and DNS measurement surface.

## Build

```sh
npm ci
npm run tsc
npm run build
npm run package
```

The plugin expects `networking.re8ch.com/node-status=true` and
`app.kubernetes.io/component=network-quality` ConfigMaps in `kube-system`,
produced by the Advanced Fabric Helm chart.

## Penrose Triangle Observer

The `Penrose Triangle` sidebar page is a read-only scheduling observability
surface. It shows NodeProfile or projected node labels, allocatable capacity,
installed kube-scheduler profiles and plugins, observed scheduler assignments,
and WorkloadTriangle Desired/Actual state. If the scheduling CRDs are not yet
installed, the Kubernetes Node, Pod and scheduler ConfigMap views remain
available.

Kubernetes does not persist every scheduler scoring candidate. The first
version therefore distinguishes declared policy and final Pod binding from a
future simulator/observer evidence feed instead of presenting inferred scores
as scheduler decisions.

The service-outcome model, disturbance trajectory and Pareto contract are
documented in [`docs/PENROSE_OBSERVER.md`](docs/PENROSE_OBSERVER.md).

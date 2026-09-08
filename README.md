# Headlamp Advanced Fabric

The Advanced Fabric landing page consumes the controller's formal, timestamped
O/S/I states; it never derives scores in the browser. Missing evidence remains
unknown, and per-dimension confidence is displayed separately from each value.

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

The primary overview selects one Service or Node assessment and renders one
large O/S/I card rather than a table of miniature triangles. Optimality,
stability, and failure independence remain mathematically independent `[0,1]`
axes; missing axes are omitted, not plotted as zero. Service cards also show the
measured inflow counters, rates, window, sample count, confidence, and formula
operands published by the controller. Existing measurement, node, ECMP, BGP,
decision and peer tables remain available below the selected assessment.

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

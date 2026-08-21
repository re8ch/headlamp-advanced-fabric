# Headlamp Advanced Fabric

Standard Headlamp plugin for inspecting Advanced Fabric node datapath mode,
FRR/BGP/BFD health, kernel ECMP routes and per-node path decisions.

## Build

```sh
npm ci
npm run tsc
npm run build
npm run package
```

The plugin expects `networking.re8ch.com/node-status=true` ConfigMaps in
`kube-system`, produced by the Advanced Fabric Helm chart.

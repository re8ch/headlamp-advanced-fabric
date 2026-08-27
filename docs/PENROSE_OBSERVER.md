# Penrose Observer design

Penrose Observer evaluates service-level outcomes. It does not choose a point
on the triangle, change scheduler weights, bind Pods, evict Pods, or recommend a
winner without showing the observed evidence.

## Triangle

- **Resilience**: the service remains correct through a declared disturbance.
  Inputs include available replicas, independent failure domains, endpoint
  continuity, volume/claim accessibility and recovery success.
- **Efficiency**: useful service work per reserved compute, memory, storage,
  network and cost. It is measured over a window rather than inferred from the
  node selected for one Pod.
- **Stability**: outcome variance and control-plane churn. Inputs include SLO
  variance, reschedules, restarts, endpoint changes, route changes, volume
  attach/detach and controller reconciliation volume.

Scores are independent `[0,100]` coordinates. They do not sum to 100. A point
is on the Pareto frontier when no other observed strategy/window is at least as
good on all three axes and strictly better on one.

## Unit of evaluation

The identity is `(cluster, namespace, service/workload, strategy cohort,
observation window)`. Pods are evidence, not evaluation subjects. A cohort is
the combined policy actually affecting the service:

- scheduler/profile: upstream kube-scheduler, scheduler-plugins or Volcano;
- network: Cilium policy/routing and service load balancing;
- ingress: Gateway/Ingress controller and endpoint propagation;
- storage: DRA, CSI provisioning, attach/mount and recovery controllers.

## Disturbance trajectory

Each disturbance creates an immutable experiment/run identifier. The observer
records points at baseline, impact, degraded steady state, recovery and settled
state. Events may be planned chaos tests or naturally detected node/network/
storage incidents. A trajectory point contains scores, raw metrics, controller
events, configuration revisions and confidence/completeness flags.

The browser currently calculates a transparent live snapshot. The production
collector should persist trajectories in VictoriaMetrics/PostgreSQL and expose
read-only projection ConfigMaps or a namespaced API to Headlamp. Missing
network, ingress or storage evidence must reduce completeness; it must never be
silently converted into a perfect score.

## Initial comparison

Start with two explicitly named cohorts:

1. `default-scheduler`: the K3s/upstream baseline.
2. `re8ch-dynamic-scheduler`: scheduler-plugins with Trimaran, using a distinct
   scheduler name rather than replacing `default-scheduler`.

The live scheduler-plugins deployment currently publishes the
`default-scheduler` profile, so its Pods are indistinguishable from the
baseline by `spec.schedulerName`. Separate naming and canary workloads are a
prerequisite for a valid comparison. Volcano becomes a third cohort after its
Scheduler and queue policy are observed and a service-level canary is opted in.

## Safety

Collection is read-only. Disturbance injection is a separate, explicitly
authorized workflow. Pareto status describes the observed dataset only; it is
not an instruction to migrate a stable service or alter its disruption budget.

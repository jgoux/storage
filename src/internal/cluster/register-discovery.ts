import { registerClusterDiscovery } from './cluster'

// The cloud SDKs behind these are heavy (@kubernetes/client-node alone is ~17 MB
// of source), so only the full server entry registers them. Each one is still
// loaded lazily, and only when CLUSTER_DISCOVERY selects it.
registerClusterDiscovery('ECS', async () => {
  const { ClusterDiscoveryECS } = await import('./ecs')
  return new ClusterDiscoveryECS()
})

registerClusterDiscovery('EKS', async () => {
  const { ClusterDiscoveryEKS } = await import('./eks')
  return new ClusterDiscoveryEKS()
})

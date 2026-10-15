// Minimal server entry: the same server as start/server without the optional
// subsystems that are heavy to load or need native code. Nothing here imports
// them, so none of them end up in the module graph of this entry:
//
//   - OpenTelemetry tracing and metrics (TRACING_ENABLED, OTEL_METRICS_ENABLED,
//     the /metrics endpoint): the settings are ignored.
//   - fs-xattr: the file backend keeps its metadata in sidecar files
//     (FILE_STORAGE_METADATA=xattr is rejected at startup).
//   - ECS and EKS cluster discovery (CLUSTER_DISCOVERY): ignored with a warning.
//   - ioredis: the image rate limiter only supports RATE_LIMITER_DRIVER=memory
//     (redis is rejected when the render routes register).
//   - pino transport worker threads: logs go to stdout synchronously
//     (LOG_STDOUT_SYNC defaults to true, see ./minimal-defaults).
//   - The multi-tenant admin app (and profiling routes that live behind it):
//     MULTI_TENANT=true is rejected.
import './minimal-defaults'
import { logger } from '@internal/monitoring'
import { getConfig } from '../config'
import { close, startServer } from './main'

export { close }

const { tracingEnabled, otelMetricsEnabled, prometheusMetricsEnabled } = getConfig()
const ignored = Object.entries({
  TRACING_ENABLED: tracingEnabled,
  OTEL_METRICS_ENABLED: otelMetricsEnabled,
  PROMETHEUS_METRICS_ENABLED: prometheusMetricsEnabled,
})
  .filter(([, enabled]) => enabled)
  .map(([name]) => name)

if (ignored.length > 0) {
  logger.warn(
    { type: 'startup' },
    `[Server] ${ignored.join(', ')} ignored: the minimal server entry does not include tracing or metrics`
  )
}

startServer()

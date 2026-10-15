import type { FastifyReply, FastifyRequest } from 'fastify'

type MetricsRequestHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

let metricsRequestHandler: MetricsRequestHandler | undefined

/**
 * Called by ./otel-metrics once the Prometheus exporter exists. The /metrics
 * routes depend on this module instead of on otel-metrics itself, so entries
 * that never import otel-metrics (see start/server-minimal) do not pull the
 * OpenTelemetry SDK, its exporters and host metrics into their module graph.
 */
export function registerMetricsRequestHandler(handler: MetricsRequestHandler) {
  metricsRequestHandler = handler
}

export async function handleMetricsRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!metricsRequestHandler) {
    reply.status(404).send('Metrics not enabled')
    return
  }

  return metricsRequestHandler(request, reply)
}

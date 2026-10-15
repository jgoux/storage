// Full server entry. Every optional subsystem is linked in here (and only
// here): tracing, OTel metrics, the xattr file metadata store, ECS/EKS cluster
// discovery, the Redis rate limiter and the multi-tenant admin app.
// start/server-minimal is the same server without them.
import './tracing'
import '@internal/monitoring/otel-metrics'
import '@internal/cluster/register-discovery'
import '@storage/backend/register-xattr'
import '../http/routes/render/rate-limiter-redis'

import buildAdmin from '../admin-app'
import { close, startServer } from './main'

export { close }

startServer({ buildAdmin })

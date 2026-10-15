// Defaults for start/server-minimal, set before anything reads the config:
// log to stdout from the main thread instead of through a pino transport
// worker thread.
process.env.LOG_STDOUT_SYNC ??= 'true'

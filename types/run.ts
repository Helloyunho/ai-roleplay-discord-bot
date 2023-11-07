export interface Run {
  id: string
  thread_id: string
  status: 'queued' | 'in_progress' | 'failed' | 'completed' | 'expired'
  last_error: {
    code: 'server_error' | 'rate_limit_exceeded'
    message: string
  } | null
}

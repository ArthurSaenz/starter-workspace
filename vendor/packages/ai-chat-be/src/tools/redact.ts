// A driver error can carry the connection string it was built from, credentials and all.
// Every place a cause is turned into text — a log line (FR-28) or a tool result the model
// relays to the traveller — goes through here first.
const CONNECTION_STRING = /postgres(?:ql)?:\/\/\S+/giu

export const redactSecrets = (value: string): string => {
  return value.replace(CONNECTION_STRING, '[redacted]')
}

export const toSafeErrorMessage = (err: unknown): string => {
  return redactSecrets(err instanceof Error ? err.message : String(err))
}

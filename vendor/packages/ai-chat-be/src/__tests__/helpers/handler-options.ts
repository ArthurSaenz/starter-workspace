import type { ChatAppIdentity } from '../../lambda/copilotkit.js'
import type { CustomerSessionIdentity } from '../../lambda/customerSession.js'
import { MemoryStorage } from './memory-storage.js'

// What the NomaDream host passes (apps/ai/api/src/lib/chat-identity.ts), so the suites read today's texts.
export const TEST_APP: ChatAppIdentity = { name: 'NomaDream', organizationId: 'nomadream' }
export const TEST_SESSION: CustomerSessionIdentity = { issuer: 'nomadream-client-api', audience: 'nomadream-client' }

/** The host-supplied part of `createCopilotkitHandlers`'s options, on a fresh in-memory store. */
export const hostOptions = (storage: MemoryStorage = new MemoryStorage()) => {
  return { storage, app: TEST_APP, session: TEST_SESSION }
}

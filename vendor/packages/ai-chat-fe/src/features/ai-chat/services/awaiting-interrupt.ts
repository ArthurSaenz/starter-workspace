import { UseAgentUpdate, useAgent } from '@copilotkit/react-core/v2'

type Agent = ReturnType<typeof useAgent>['agent']

/** The interrupts `agent` still holds open, minus the expired ones: those can no longer be answered. */
export const openInterrupts = (agent: Agent, now = Date.now()): Agent['pendingInterrupts'] => {
  return agent.pendingInterrupts.filter((interrupt) => {
    return interrupt.expiresAt === undefined || Date.parse(interrupt.expiresAt) > now
  })
}

/**
 * True while the agent's last run ended on an interrupt nobody has answered yet. Any other run
 * started meanwhile — the composer's Enter, a suggestion pill — is refused by `@ag-ui/client`
 * before it leaves the browser ("Thread has 1 pending interrupt(s) not addressed by resume"), so a
 * composer that must wait for the answer reads this flag. Only valid inside the provider, i.e. in a
 * slot or in `AIChat`'s `children`.
 */
export const useAwaitingInterrupt = (agentId?: string): boolean => {
  // Run status is enough: the interrupt list is written by RUN_FINISHED and cleared by the next one,
  // and the run's end re-renders after both.
  const { agent } = useAgent({ agentId, updates: [UseAgentUpdate.OnRunStatusChanged] })

  return !agent.isRunning && openInterrupts(agent).length > 0
}

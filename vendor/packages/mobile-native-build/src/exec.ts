import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'

export interface ExecOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  input?: string
  capture?: boolean
}

export interface ExecResult {
  status: number
  stdout: Buffer
  stderr: Buffer
}

export type Exec = (file: string, args: string[], options: ExecOptions) => ExecResult

export const spawnExec: Exec = (file, args, { cwd, env, input, capture }) => {
  const result = spawnSync(file, args, {
    cwd,
    env,
    input,
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 1024 * 1024 * 1024,
  })

  if (result.error) throw result.error

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
  }
}

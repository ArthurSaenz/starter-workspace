#!/usr/bin/env node
import process from 'node:process'

import { spawnExec } from './exec.ts'
import { XCODE_DEVELOPER_DIR, main } from './run.ts'

process.exitCode = main(process.argv.slice(2), {
  exec: spawnExec,
  cwd: process.cwd(),
  env: process.env,
  log: (line) => {
    process.stdout.write(`${line}\n`)
  },
  warn: console.warn,
  error: console.error,
  xcodeDeveloperDir: XCODE_DEVELOPER_DIR,
})

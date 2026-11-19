export const EXIT_FAILURE = 1
export const EXIT_USAGE = 2

export class CliError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode: number = EXIT_USAGE) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

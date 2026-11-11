export class SiteIndexError extends Error {
  readonly issues: string[]

  constructor(message: string, issues: string[] = [], options?: ErrorOptions) {
    super(issues.length > 0 ? `${message}\n  - ${issues.join('\n  - ')}` : message, options)
    this.name = 'SiteIndexError'
    this.issues = issues
  }
}

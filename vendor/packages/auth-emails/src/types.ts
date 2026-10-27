export interface AuthEmailBrand {
  name: string
  logoUrl?: string
  /** Any CSS colour; inline because Tailwind classes are resolved at build time, not per host. */
  primaryColor?: string
}

export interface AuthEmailCopy {
  subject: string
  preview: string
  heading: string
  intro: string
  buttonLabel: string
  expiryPrefix: string
  warning: string
}

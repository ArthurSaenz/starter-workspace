import { DEFAULT_AUTH_EMAIL_COPY } from '../src/create-auth-email-renderer.js'
import { MagicLinkEmail } from '../src/magic-link-email.js'

const InvitePreview = () => {
  return (
    <MagicLinkEmail
      link="https://app.example.com/auth/verify?token=0123456789abcdef"
      expiry="3 days"
      brand={{ name: 'Acme' }}
      copy={DEFAULT_AUTH_EMAIL_COPY.invite}
    />
  )
}

export default InvitePreview

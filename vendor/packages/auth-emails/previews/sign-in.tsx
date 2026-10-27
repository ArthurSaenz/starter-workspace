import { MagicLinkEmail } from '../src/MagicLinkEmail.js'
import { DEFAULT_AUTH_EMAIL_COPY } from '../src/createAuthEmailRenderer.js'

// `email dev` lists every default export in this folder as a template.
const SignInPreview = () => {
  return (
    <MagicLinkEmail
      link="https://app.example.com/auth/verify?token=0123456789abcdef"
      expiry="15 minutes"
      brand={{ name: 'Acme' }}
      copy={DEFAULT_AUTH_EMAIL_COPY['sign-in']}
    />
  )
}

export default SignInPreview

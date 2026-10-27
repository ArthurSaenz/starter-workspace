import { Body, Button, Container, Head, Heading, Hr, Html, Img, Preview, Section, Tailwind, Text } from 'react-email'

import type { AuthEmailBrand, AuthEmailCopy } from './types.js'

export interface MagicLinkEmailProps {
  link: string
  expiry: string
  brand: AuthEmailBrand
  copy: AuthEmailCopy
}

export const MagicLinkEmail = (props: MagicLinkEmailProps) => {
  const { link, expiry, brand, copy } = props

  return (
    <Html lang="en">
      <Head />
      <Preview>{copy.preview}</Preview>
      <Tailwind>
        <Body className="m-0 bg-gray-100 py-10 font-sans">
          <Container className="mx-auto max-w-120 rounded-lg bg-white p-8">
            {brand.logoUrl ? <Img src={brand.logoUrl} alt={brand.name} height="32" className="mb-6" /> : null}
            <Heading as="h1" className="m-0 mb-4 text-2xl font-semibold text-gray-900">
              {copy.heading}
            </Heading>
            <Text className="m-0 mb-6 text-base leading-6 text-gray-700">{copy.intro}</Text>
            <Section className="mb-6">
              <Button
                href={link}
                className="rounded-md px-5 py-3 text-base font-medium text-white"
                style={{ backgroundColor: brand.primaryColor ?? '#111827' }}
              >
                {copy.buttonLabel}
              </Button>
            </Section>
            <Text className="m-0 mb-2 text-sm text-gray-500">
              {copy.expiryPrefix} {expiry}.
            </Text>
            <Text className="m-0 text-sm break-all text-gray-500">{link}</Text>
            <Hr className="my-6 border-gray-200" />
            <Text className="m-0 text-xs text-gray-400">{copy.warning}</Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

import type { ReactElement } from 'react'

interface BadProps {
  label: string
}

const SOME_CONSTANT = 'wedge'

function Bad(props: BadProps): ReactElement {
  const { label } = props

  return <div>{label}</div>
}

export { Bad, SOME_CONSTANT }

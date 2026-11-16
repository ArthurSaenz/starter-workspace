export interface UnknownKindProps {
  subject: 'cell' | 'filter'
  kind: string
}

/**
 * What a config `kind` with no renderer draws. A throw during render would take the whole table
 * down over one misconfigured entry; this keeps the rest working and names the typo on screen.
 */
export const UnknownKind = (props: UnknownKindProps) => {
  const { subject, kind } = props

  return <span className="text-destructive text-sm">{`Unknown ${subject} kind: "${kind}"`}</span>
}

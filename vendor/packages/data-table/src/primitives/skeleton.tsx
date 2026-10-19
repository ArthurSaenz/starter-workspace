import { cn } from './cn'

export type SkeletonProps = React.ComponentProps<'div'>

export const Skeleton = (props: SkeletonProps) => {
  const { className, ...rest } = props

  return <div data-slot="skeleton" className={cn('bg-accent animate-pulse rounded-md', className)} {...rest} />
}

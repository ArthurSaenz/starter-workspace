import { Suspense, lazy, useEffect, useState } from 'react'

/**
 * @see https://vike.dev/ClientOnly
 */
export const clientOnly = <T extends React.ComponentType<any>>(
  load: () => Promise<{ default: T } | T>,
): React.ComponentType<React.ComponentProps<T> & { fallback?: React.ReactNode }> => {
  // Client side: always bundled by Vite, import.meta.env.SSR === false
  // Server side: may or may not be bundled by Vite, import.meta.env.SSR === true || import.meta.env === undefined
  // eslint-disable-next-line ts/ban-ts-comment
  // @ts-expect-error
  import.meta.env ??= { SSR: true }
  if (import.meta.env.SSR) {
    return (props) => {
      return <>{props.fallback}</>
    }
  }
  const Component = lazy(() => {
    return load()
      .then((LoadedComponent) => {
        return 'default' in LoadedComponent ? LoadedComponent : { default: LoadedComponent }
      })
      .catch((error) => {
        console.error('Component loading failed:', error)

        return {
          default: (() => {
            return <p>Error loading component.</p>
          }) as any,
        }
      })
  })

  return ({ ref, ...props }: any & { ref?: React.RefObject<any | null> }) => {
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
      setMounted(true)
    }, [])
    if (!mounted) {
      return <>{props.fallback}</>
    }
    const { fallback, ...rest } = props

    return (
      <Suspense fallback={<>{props.fallback}</>}>
        <Component {...rest} ref={ref} />
      </Suspense>
    )
  }
}

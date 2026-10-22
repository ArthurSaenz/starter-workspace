import type { SiteIndexConfig } from './types.js'

export interface RenderRobotsOptions {
  /** `false` on non-production envs: every agent is disallowed and no sitemap is advertised. */
  crawlable: boolean
}

const renderAgent = (userAgent: string, crawlable: boolean): string[] => {
  return [`User-agent: ${userAgent}`, crawlable ? 'Allow: /' : 'Disallow: /', '']
}

export const renderRobots = (config: SiteIndexConfig, options: RenderRobotsOptions): string => {
  const { crawlable } = options
  const lines = [...renderAgent('*', crawlable)]

  if (config.robots.aiBots.length > 0) {
    lines.push('# AI crawlers')

    for (const bot of config.robots.aiBots) {
      lines.push(...renderAgent(bot, crawlable))
    }
  }

  if (crawlable) lines.push(`Sitemap: ${new URL('/sitemap.xml', config.origin).href}`, '')

  return lines.join('\n')
}

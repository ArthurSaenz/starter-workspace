/** A page size the table can divide by: `pageSize` arrives from config, where 0, a negative or NaN is possible. */
export const normalizePageSize = (pageSize: number): number => {
  return Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 1
}

export interface ServerPage {
  /** 1-based, inside `1..totalPages`. */
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

/**
 * The page a server-paged table is on. `page` is the consumer's state: it can outlive a shrinking
 * `totalCount` for a render, or start out of range, so every reader goes through this.
 */
export const resolveServerPage = (args: { page: number; pageSize: number; totalCount: number }): ServerPage => {
  const pageSize = normalizePageSize(args.pageSize)
  const totalCount = Number.isFinite(args.totalCount) ? Math.max(0, args.totalCount) : 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const page = Number.isNaN(args.page) ? 1 : Math.min(Math.max(1, Math.trunc(args.page)), totalPages)

  return { page, pageSize, totalCount, totalPages }
}

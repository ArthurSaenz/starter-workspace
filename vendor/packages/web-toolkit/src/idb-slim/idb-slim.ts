import * as idb from 'idb-keyval'

/**
 * https://github.com/sach2211/idbcache
 */

const EXPIRY_PREFIX = '__ExpiryTimeStamp__'

const expiryKeyOf = (key: IDBValidKey) => {
  return `${EXPIRY_PREFIX}${String(key)}`
}

/**
 * Stores a value in IndexedDB with a time-to-live expiry.
 *
 * @param key - A key to identify the value.
 * @param value - A value associated with the key.
 * @param ttl - Time to live in seconds.
 * @example
 *     await set('session', { token: 'abc' }, 3600)
 */
export const set = async <T>(key: string, value: T, ttl: number) => {
  try {
    const timeToExpire = Date.now() + ttl * 1000

    // One transaction, value first: a value that cannot be stored must not leave a fresh expiry behind.
    await idb.setMany([
      [key, value],
      [expiryKeyOf(key), timeToExpire],
    ])

    // Once the keys are set, remove any expired keys.
    removeExpiredKeys()
  } catch (error) {
    console.error(error)
  }
}

/**
 * Retrieves a value from IndexedDB if it exists and has not expired.
 *
 * @param key - A key to identify the data.
 * @returns returns the value associated with the key if its exists and is not expired. Returns `null` otherwise
 * @example
 *     const session = await get<{ token: string }>('session')
 */
export const get = async <T = unknown>(key: IDBValidKey): Promise<T | null> => {
  try {
    if (isInternalExpiryTimestampKey(key)) {
      const payload = await idb.get(key)

      return payload
    }

    const timeStamp = await idb.get(expiryKeyOf(key))

    if (timeStamp > Date.now()) {
      const data = await idb.get(key)

      return data
    }
    // Key has expired => delete it and return null;
    remove(key).catch(console.error)

    return null
  } catch (error) {
    console.error(error)

    return null
  }
}

/** Deletes a key together with its expiry entry; either one may be passed. Rejects when IndexedDB fails. */
export const remove = (key: IDBValidKey): Promise<void> => {
  const pair = isInternalExpiryTimestampKey(key) ? [key, key.slice(EXPIRY_PREFIX.length)] : [key, expiryKeyOf(key)]

  return idb.delMany(pair)
}

/** Deletes everything in the store. Rejects when IndexedDB fails. */
export const flush = (): Promise<void> => {
  return idb.clear()
}

const all = () => {
  return idb.keys()
}

const isInternalExpiryTimestampKey = (key: IDBValidKey): key is string => {
  return typeof key === 'string' && key.startsWith(EXPIRY_PREFIX)
}

/**
 * Returns all internal expiry timestamp keys currently stored in IndexedDB.
 *
 * @example
 *     const keys = await getAllInternalTimestampKeys()
 */
const getAllInternalTimestampKeys = async (): Promise<IDBValidKey[] | null> => {
  try {
    const keys = await all()

    const internalKeys = keys.filter((thisKey: IDBValidKey) => {
      return isInternalExpiryTimestampKey(thisKey)
    })

    return internalKeys
  } catch (error) {
    console.error(error)

    return null
  }
}

/**
 * Removes all keys from IndexedDB whose TTL has elapsed.
 *
 * @example
 *     await removeExpiredKeys()
 */
export const removeExpiredKeys = async () => {
  // Every step below catches its own IndexedDB failure, so this never rejects.
  const keys = await getAllInternalTimestampKeys()

  if (!keys) return

  const p = keys.map(async (thisKey: IDBValidKey) => {
    return get(thisKey).then((value) => {
      return Date.now() > (value as number) ? remove(thisKey).catch(console.error) : null
    })
  })

  await Promise.all(p)
}

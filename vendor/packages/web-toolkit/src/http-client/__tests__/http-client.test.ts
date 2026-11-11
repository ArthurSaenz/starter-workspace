import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpClient, ServerError } from '..'

const json = (body: unknown, init: ResponseInit = {}) => {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

const clientFor = (...responses: Array<Response | Error | string>) => {
  const fetchInstance = vi.fn<typeof fetch>()

  for (const response of responses) {
    if (response instanceof Response) {
      fetchInstance.mockResolvedValueOnce(response)
    } else {
      fetchInstance.mockRejectedValueOnce(response)
    }
  }

  return { client: new HttpClient('https://api.test', fetchInstance), fetchInstance }
}

const requestOf = (fetchInstance: ReturnType<typeof vi.fn<typeof fetch>>, call = 0) => {
  const [url, init] = fetchInstance.mock.calls[call]!

  return { url, init: init!, headers: init!.headers as Headers }
}

const rejectionOf = async <E = Error>(promise: Promise<unknown>): Promise<E> => {
  try {
    await promise
  } catch (error) {
    return error as E
  }

  throw new Error('expected a rejection')
}

afterEach(() => {
  vi.useRealTimers()
  delete window.AwsWafIntegration
})

describe('httpClient.fetch', () => {
  it('sends a GET to baseUrl + uri and parses a JSON body', async () => {
    const { client, fetchInstance } = clientFor(json({ id: 1 }, { headers: { etag: 'abc' } }))

    const response = await client.fetch<{ id: number }>('/users/1')

    expect(response).toMatchObject({ ok: true, status: 200, body: { id: 1 } })
    expect(response.headers?.etag).toBe('abc')

    const { url, init, headers } = requestOf(fetchInstance)

    expect(url).toBe('https://api.test/users/1')
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin' })
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('puts the token into both auth headers', async () => {
    const { client, fetchInstance } = clientFor(json({}))

    await client.fetch('/me', { token: 'tkn', headers: { 'x-extra': '1' } })

    const { headers } = requestOf(fetchInstance)

    expect(headers.get('authorization')).toBe('tkn')
    expect(headers.get('mv-auth')).toBe('tkn')
    expect(headers.get('x-extra')).toBe('1')
  })

  it('pOSTs a JSON-encoded body when no method is given', async () => {
    const { client, fetchInstance } = clientFor(json({}))

    await client.fetch('/users', { body: { name: 'a' } })

    expect(requestOf(fetchInstance).init).toMatchObject({ method: 'POST', body: '{"name":"a"}' })
  })

  it('sends a string body as given under a JSON content-type', async () => {
    const { client, fetchInstance } = clientFor(json({}))

    await client.fetch('/users', { body: '{"name":"a"}' })

    expect(requestOf(fetchInstance).init.body).toBe('{"name":"a"}')
  })

  it('keeps an explicit method for a request with a body', async () => {
    const { client, fetchInstance } = clientFor(json({}))

    await client.fetch('/users/1', { method: 'PUT', body: { name: 'a' } })

    expect(requestOf(fetchInstance).init.method).toBe('PUT')
  })

  it('lets the browser set the multipart content-type for FormData', async () => {
    const { client, fetchInstance } = clientFor(json({}))
    const form = new FormData()

    form.append('file', 'x')

    await client.fetch('/upload', { method: 'POST', body: form })

    const { init, headers } = requestOf(fetchInstance)

    expect(init.body).toBe(form)
    expect(headers.has('content-type')).toBe(false)
  })

  it('sends a non-JSON body as is', async () => {
    const { client, fetchInstance } = clientFor(json({}))

    await client.fetch('/raw', { method: 'POST', body: 'a=1', headers: { 'content-type': 'text/plain' } })

    expect(requestOf(fetchInstance).init.body).toBe('a=1')
  })

  it('neither sends a content-type nor parses the body for HEAD', async () => {
    const { client, fetchInstance } = clientFor(new Response(null, { headers: { 'content-type': 'application/json' } }))

    const response = await client.fetch('/ping', { method: 'HEAD' })

    expect(response.body).toBe('')
    expect(requestOf(fetchInstance).headers.has('content-type')).toBe(false)
  })

  it('returns a 206 body as text', async () => {
    const { client } = clientFor(json({ a: 1 }, { status: 206 }))

    expect((await client.fetch('/range')).body).toBe('{"a":1}')
  })

  it('returns a non-JSON body as text', async () => {
    const { client } = clientFor(new Response('hello', { headers: { 'content-type': 'text/plain' } }))

    expect((await client.fetch('/text')).body).toBe('hello')
  })

  it('returns an empty JSON-typed body (304, 204) instead of failing to parse it', async () => {
    const { client } = clientFor(json(undefined, { status: 304 }), json(undefined, { status: 204 }))

    await expect(client.fetch('/manifest')).resolves.toMatchObject({ status: 304, body: '' })
    await expect(client.fetch('/delete')).resolves.toMatchObject({ status: 204, body: '' })
  })

  it('keeps the status of an error whose body is not the JSON its content-type claims', async () => {
    const { client } = clientFor(
      new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'application/json' } }),
    )

    const error = await rejectionOf<Error>(client.fetch('/users'))

    expect(error.message).toBe('API Layer: 502 - https://api.test/users')
    expect(error.cause).toMatchObject({ status: 502, body: '<html>Bad Gateway</html>' })
  })

  it('refuses a successful response whose JSON is corrupt', async () => {
    const { client } = clientFor(new Response('{"a":', { headers: { 'content-type': 'application/json' } }))

    const error = await rejectionOf<Error>(client.fetch('/users'))

    expect(error.message).toBe('API Layer: invalid JSON - https://api.test/users')
    expect(error.cause).toBeInstanceOf(SyntaxError)
  })

  it('throws an API Layer error with the response as cause for other statuses', async () => {
    const { client } = clientFor(json({ reason: 'nope' }, { status: 404 }))

    await expect(client.fetch('/missing')).rejects.toMatchObject({
      message: 'API Layer: 404 - https://api.test/missing',
      cause: { status: 404, body: { reason: 'nope' } },
    })
  })

  it('throws a ServerError for status 570', async () => {
    const { client } = clientFor(json({ type: 'SOLD_OUT', message: 'Sold out', extraData: { id: 7 } }, { status: 570 }))

    const error = await rejectionOf<ServerError<string>>(client.fetch('/book', { body: { id: 7 } }))

    expect(error).toBeInstanceOf(ServerError)
    expect(error).toMatchObject({ type: 'SOLD_OUT', message: 'Sold out', extraData: { id: 7 } })
    expect(error.metaData.req.body).toEqual({ id: 7 })
    expect(error.metaData.res.status).toBe(570)
  })

  it('falls back to defaults for a 570 without a usable body', async () => {
    const { client } = clientFor(json(null, { status: 570 }))

    await expect(client.fetch('/book')).rejects.toMatchObject({
      type: 'SERVER_ERROR',
      message: 'Server error message',
      extraData: {},
    })
  })

  it('wraps a network failure, whatever was thrown', async () => {
    const failure = new TypeError('Failed to fetch')
    const { client } = clientFor(failure, 'waf blocked')

    await expect(client.fetch('/a')).rejects.toMatchObject({
      message: 'Network error: Failed to fetch',
      cause: failure,
    })
    await expect(client.fetch('/a')).rejects.toMatchObject({ message: 'Network error: waf blocked' })
  })

  it('goes through the AWS WAF fetch when asked and available', async () => {
    const wafFetch = vi.fn<(args: unknown) => Promise<Response>>().mockResolvedValue(json({ waf: true }))

    window.AwsWafIntegration = { fetch: wafFetch }

    const { client, fetchInstance } = clientFor()

    await expect(client.fetch('/a', {}, { isAwsFetchWrap: true })).resolves.toMatchObject({ body: { waf: true } })
    expect(fetchInstance).not.toHaveBeenCalled()
  })

  describe('cancellation', () => {
    const abortableFetch = () => {
      return vi.fn<typeof fetch>((_url, init) => {
        return new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => {
            reject(init!.signal!.reason)
          })
        })
      })
    }

    it('rejects an aborted request with the platform AbortError, unwrapped', async () => {
      const fetchInstance = abortableFetch()
      const controller = new AbortController()
      const pending = new HttpClient('https://api.test', fetchInstance).fetch('/a', { signal: controller.signal })

      controller.abort()

      const error = await rejectionOf<DOMException>(pending)

      expect(error).toBe(controller.signal.reason)
      expect(error.name).toBe('AbortError')
      expect(requestOf(fetchInstance).init.signal).toBe(controller.signal)
    })

    it('makes no further attempt once a retried request is aborted', async () => {
      const fetchInstance = abortableFetch()
      const controller = new AbortController()

      const pending = new HttpClient('https://api.test', fetchInstance).fetch(
        '/a',
        { signal: controller.signal },
        { retries: 3 },
      )

      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetchInstance).toHaveBeenCalledOnce()
    })

    it('stops waiting between retries as soon as it is aborted', async () => {
      vi.useFakeTimers()

      const { client, fetchInstance } = clientFor(new Error('down'))
      const controller = new AbortController()
      const pending = client.fetch('/a', { signal: controller.signal }, { retries: 3, delay: 1000 })

      await vi.advanceTimersByTimeAsync(500)
      controller.abort()

      await expect(pending).rejects.toBe(controller.signal.reason)
      expect(fetchInstance).toHaveBeenCalledOnce()
    })
  })

  describe('retries', () => {
    it('waits `delay` between attempts', async () => {
      vi.useFakeTimers()

      const { client, fetchInstance } = clientFor(new Error('down'), json({ ok: 1 }))
      const pending = client.fetch('/a', {}, { retries: 2, delay: 1000 })

      await vi.advanceTimersByTimeAsync(999)
      expect(fetchInstance).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toMatchObject({ body: { ok: 1 } })
      expect(fetchInstance).toHaveBeenCalledTimes(2)
    })

    it('gives up after `retries` attempts with the last error', async () => {
      const { client, fetchInstance } = clientFor(new Error('one'), new Error('two'))

      await expect(client.fetch('/a', {}, { retries: 2 })).rejects.toMatchObject({ message: 'Network error: two' })
      expect(fetchInstance).toHaveBeenCalledTimes(2)
    })

    it('still makes the request when only a delay is configured', async () => {
      const { client, fetchInstance } = clientFor(json({}), json({}))

      await client.fetch('/a', {}, { retries: 0, delay: 10 })
      await client.fetch('/a', {}, { delay: 10 })

      expect(fetchInstance).toHaveBeenCalledTimes(2)
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod-v4'

import { defineServerTool } from '../tools/types.js'

const echoSpec = {
  name: 'echo',
  description: 'Echo the word back.',
  inputSchema: z.object({ word: z.string() }),
  outputSchema: z.object({ word: z.string() }),
  execute: async ({ word }: { word: string }) => {
    return { word }
  },
}

const echoTool = defineServerTool(echoSpec)

const listTool = defineServerTool({
  name: 'list',
  description: 'A tool whose output MCP cannot carry.',
  inputSchema: z.object({}),
  outputSchema: z.array(z.string()),
  execute: async () => {
    return ['a']
  },
})

describe('defineServerTool', () => {
  it('answers arguments that do not match the input schema with what was wrong, without running the body', async () => {
    const execute = vi.fn(async ({ word }: { word: string }) => {
      return { word }
    })

    const guarded = defineServerTool({ ...echoSpec, execute })

    await expect(guarded.execute({ word: 7 })).resolves.toEqual({
      error: expect.stringMatching(/^invalid arguments: .*expected string.*word/su),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses arguments that do not match over MCP as a tool error, not a thrown failure', async () => {
    const refused = await echoTool.handler({})

    expect(refused.isError).toBe(true)
    expect(refused.structuredContent).toEqual({ error: expect.stringMatching(/^invalid arguments: /u) })
    expect(JSON.parse(refused.content[0].text)).toEqual(refused.structuredContent)
  })

  it('serves the parsed result as MCP text and structured content', async () => {
    await expect(echoTool.handler({ word: 'hi' })).resolves.toEqual({
      content: [{ type: 'text', text: '{"word":"hi"}' }],
      structuredContent: { word: 'hi' },
    })
  })

  it('refuses an output MCP structuredContent cannot hold', async () => {
    await expect(listTool.handler({})).rejects.toThrow(/must return a JSON object/)
  })
})

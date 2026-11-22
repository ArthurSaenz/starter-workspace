import type { CopilotChatInput } from '@copilotkit/react-core/v2'
import type { ComponentProps, ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { Locator } from 'vitest/browser'
import { page, userEvent } from 'vitest/browser'

import { OpenToolsMenu, QueueFiles } from '../__stories__/kit/composer.js'
import { AIChatRootContainer as AIChat } from '../containers/ai-chat-root-container.js'
import type { AiChatProps } from '../types.js'
import { NOMADREAM_PRESET, REPLY, VOICE_TRANSCRIPT, installRuntimeScenario, scenarios } from './helpers/index.js'
import type { FakeRuntime, RuntimeScenario } from './helpers/index.js'

// The Composer area: what its stories show, asserted. The stories open on the composer's state;
// these pick files, open menus, send, and check the wire.
// Already covered elsewhere: stop generation (ai-chat-states.test.tsx, "stop posts the stop route
// but never aborts the run"), the `/info` transcription override itself (fake-runtime.test.ts).

type Screen = Awaited<ReturnType<typeof render>>
type ChatProps = NonNullable<AiChatProps['chat']>
type SendItButtonProps = ComponentProps<typeof CopilotChatInput.SendButton>

const ATTACHMENT_QUEUE = 'copilot-attachment-queue'
const ADD_MENU_BUTTON = 'copilot-add-menu-button'
const SEND_BUTTON = 'copilot-send-button'
const USER_MESSAGE = 'copilot-user-message'
const START_TRANSCRIBE_BUTTON = 'copilot-start-transcribe-button'
const FINISH_TRANSCRIBE_BUTTON = 'copilot-finish-transcribe-button'
const DRAFT = 'Three weeks in May.'
// Radix portals the menu to `<body>`, outside the rendered container.
const MENU_CONTENT = '[data-slot="dropdown-menu-content"]'
const ITINERARY_TEXT = 'Day 1: Bangkok. Day 2: Ayutthaya.'

const itineraryFile = () => {
  return new File([ITINERARY_TEXT], 'itinerary.txt', { type: 'text/plain' })
}

// `toHaveTextContent` matches the whole text here; a chip or a bubble also carries other text.
const expectTextToContain = async (locator: Locator, text: string) => {
  await vi.waitFor(() => {
    expect(locator.element().textContent).toContain(text)
  })
}

// CopilotChat is `h-full`; without a bounded parent it collapses to zero height.
const mount = (element: ReactElement) => {
  return render(<div style={{ height: 600 }}>{element}</div>)
}

const withChat = (chat: ChatProps, children?: ReactElement) => {
  return mount(
    <AIChat {...NOMADREAM_PRESET} chat={{ ...NOMADREAM_PRESET.chat, ...chat }}>
      {children}
    </AIChat>,
  )
}

// The "+" button opens the OS picker, which no test can drive, so the files go to CopilotChat's own
// hidden input — unfiltered, because the `accept` check under test is CopilotKit's, not the browser's.
const pickFiles = (screen: Screen, files: File[]) => {
  const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')

  if (!input) throw new Error('attachments are off: no file input mounted')

  const transfer = new DataTransfer()

  for (const file of files) transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

// Headless Chromium has no microphone and can hang on getUserMedia, so the "microphone" is an
// oscillator: a real MediaStream that react-core's own MediaRecorder still encodes to webm/opus.
const stubMicrophone = () => {
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const destination = context.createMediaStreamDestination()

  oscillator.connect(destination)
  oscillator.start()

  // Resumed on the call, which follows the mic click: a context created before any user gesture
  // starts suspended, and a suspended one records an empty blob.
  const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async () => {
    await context.resume()

    return destination.stream
  })

  // Counts what react-core's recorder hands its own `ondataavailable`, from the same events: a
  // recorder stopped before its first encoded slice posts an empty blob, and under load a fixed
  // wait can end before the audio thread has produced one.
  let recordedBytes = 0
  const start = MediaRecorder.prototype.start

  vi.spyOn(MediaRecorder.prototype, 'start').mockImplementation(function (this: MediaRecorder, timeslice?: number) {
    this.addEventListener('dataavailable', (event) => {
      recordedBytes += event.data.size
    })
    start.call(this, timeslice)
  })

  return {
    getUserMedia,
    recordedBytes: () => {
      return recordedBytes
    },
    close: () => {
      return context.close()
    },
  }
}

// CopilotChat submits on Enter (a keydown on the textarea), not on a newline in the value.
const send = async (screen: Screen, text: string) => {
  await screen.getByRole('textbox').fill(text)
  await userEvent.keyboard('{Enter}')
}

describe('composer', () => {
  let runtime: FakeRuntime

  const install = (scenario: RuntimeScenario = scenarios.default) => {
    runtime = installRuntimeScenario(scenario)
  }

  afterEach(() => {
    runtime.restore()
    vi.restoreAllMocks()
  })

  describe('attachments', () => {
    it('are off by default: the "+" button is disabled and no file input is mounted', async () => {
      install()

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await expect.element(screen.getByTestId(ADD_MENU_BUTTON)).toBeDisabled()
      expect(screen.container.querySelector('input[type="file"]')).toBeNull()
    })

    it('queue an accepted file and report a rejected one through onUploadFailed', async () => {
      install(scenarios.attachments)
      const onUploadFailed = vi.fn()

      const screen = await withChat({ attachments: { enabled: true, accept: 'text/plain', onUploadFailed } })

      await expect.element(screen.getByTestId(ADD_MENU_BUTTON)).toBeEnabled()

      pickFiles(screen, [itineraryFile(), new File(['not really a png'], 'photo.png', { type: 'image/png' })])

      await expectTextToContain(screen.getByTestId(ATTACHMENT_QUEUE), 'itinerary.txt')
      expect(screen.getByTestId(ATTACHMENT_QUEUE).element().textContent).not.toContain('photo.png')
      expect(onUploadFailed).toHaveBeenCalledTimes(1)
      expect(onUploadFailed).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'invalid-type', file: expect.objectContaining({ name: 'photo.png' }) }),
      )
      expect(runtime.runs).toHaveLength(0)
    })

    it('go out as a document part of the user message, and the queue empties', async () => {
      install(scenarios.attachments)

      const screen = await withChat({ attachments: { enabled: true } })

      await expect.element(screen.getByTestId(ADD_MENU_BUTTON)).toBeEnabled()
      pickFiles(screen, [itineraryFile()])
      await expectTextToContain(screen.getByTestId(ATTACHMENT_QUEUE), 'itinerary.txt')

      await send(screen, 'what is in my file?')

      await vi.waitFor(() => {
        expect(runtime.runs).toHaveLength(1)
      })
      const last = runtime.runs[0]?.body.messages?.at(-1)

      expect(last).toMatchObject({
        role: 'user',
        content: [
          { type: 'text', text: 'what is in my file?' },
          {
            type: 'document',
            source: { type: 'data', mimeType: 'text/plain', value: expect.any(String) },
            metadata: { filename: 'itinerary.txt' },
          },
        ],
      })
      const parts = last?.content as unknown as Array<{ source?: { value: string } }>

      expect(atob(parts[1]?.source?.value ?? '')).toBe(ITINERARY_TEXT)
      await expectTextToContain(screen.getByTestId(USER_MESSAGE), 'what is in my file?')
      await expect.element(screen.getByTestId(ATTACHMENT_QUEUE)).not.toBeInTheDocument()
    })

    it('queueFiles opens the story with the file already queued', async () => {
      install(scenarios.attachments)
      const files = [itineraryFile()]

      const screen = await withChat({ attachments: { enabled: true } }, <QueueFiles files={files} />)

      await expectTextToContain(screen.getByTestId(ATTACHMENT_QUEUE), 'itinerary.txt')
      expect(runtime.runs).toHaveLength(0)
    })
  })

  describe('auto-focus', () => {
    it('focuses the textarea on mount, so typing without a click sends', async () => {
      install()

      const screen = await withChat({ input: { autoFocus: true } })

      await expect.element(screen.getByRole('textbox')).toHaveFocus()

      await userEvent.keyboard('hello{Enter}')

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(runtime.runs).toHaveLength(1)
      expect(runtime.runs[0]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: 'hello' })
    })
  })

  describe('input slots', () => {
    it('a custom send button replaces the arrow, follows the empty-input state and sends', async () => {
      install()

      const SendItButton = (props: SendItButtonProps) => {
        return (
          <button type="button" onClick={props.onClick} disabled={props.disabled}>
            Send it
          </button>
        )
      }

      const screen = await withChat({ input: { sendButton: SendItButton } })
      const sendIt = screen.getByRole('button', { name: 'Send it' })

      await expect.element(sendIt).toBeDisabled()
      expect(screen.getByTestId(SEND_BUTTON).query()).toBeNull()

      await screen.getByRole('textbox').fill('hello')

      await expect.element(sendIt).toBeEnabled()

      await sendIt.click()

      await expect.element(screen.getByText(REPLY)).toBeVisible()
      expect(runtime.runs).toHaveLength(1)
      expect(runtime.runs[0]?.body.messages?.at(-1)).toMatchObject({ role: 'user', content: 'hello' })
    })
  })

  describe('tools menu', () => {
    it('the "+" button opens the menu; an item calls its action and closes it', async () => {
      install()
      const compareProgrammes = vi.fn()

      const screen = await withChat({
        input: { toolsMenu: [{ label: 'Compare programmes', action: compareProgrammes }] },
      })

      await expect.element(screen.getByTestId(ADD_MENU_BUTTON)).toBeEnabled()

      await screen.getByTestId(ADD_MENU_BUTTON).click()

      await expect.element(page.getByRole('menuitem', { name: 'Compare programmes' })).toBeVisible()

      await page.getByRole('menuitem', { name: 'Compare programmes' }).click()

      expect(compareProgrammes).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => {
        expect(document.body.querySelector(MENU_CONTENT)).toBeNull()
      })
      expect(runtime.runs).toHaveLength(0)
    })

    it('openToolsMenu opens the story with the menu open', async () => {
      install()

      await withChat({ input: { toolsMenu: [{ label: 'Compare programmes', action: vi.fn() }] } }, <OpenToolsMenu />)

      await expect.element(page.getByRole('menuitem', { name: 'Compare programmes' })).toBeVisible()
    })
  })

  // The Lambda advertises transcription only with GEMINI_API_KEY set; the default /info is the keyless one.
  describe('voice input', () => {
    let microphone: ReturnType<typeof stubMicrophone> | undefined

    afterEach(async () => {
      await microphone?.close()
      microphone = undefined
    })

    // Records until MediaRecorder has handed over a non-empty slice, then finishes — the check-mark button.
    const dictate = async (screen: Screen) => {
      await screen.getByTestId(START_TRANSCRIBE_BUTTON).click()
      await expect.element(screen.getByTestId(FINISH_TRANSCRIBE_BUTTON)).toBeVisible()
      await expect
        .poll(
          () => {
            return microphone?.recordedBytes() ?? 0
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0)
      await screen.getByTestId(FINISH_TRANSCRIBE_BUTTON).click()
    }

    it('shows the mic only when /info advertises transcription, and never calls /transcribe on its own', async () => {
      install(scenarios.voice)

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await expect.element(screen.getByTestId(START_TRANSCRIBE_BUTTON)).toBeVisible()
      expect(runtime.requests).toContainEqual(expect.objectContaining({ method: 'GET', path: '/info' }))
      expect(runtime.transcribes).toEqual([])
    })

    it('has no mic on the default /info', async () => {
      install()

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await expect.element(screen.getByRole('textbox')).toBeVisible()
      await expect.element(screen.getByTestId(ADD_MENU_BUTTON)).toBeInTheDocument()
      expect(screen.getByTestId(START_TRANSCRIBE_BUTTON).query()).toBeNull()
    })

    it('posts the recording as multipart `audio` and appends the transcript to the draft, sending nothing', async () => {
      install(scenarios.voice)
      microphone = stubMicrophone()

      const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

      await screen.getByRole('textbox').fill(DRAFT)
      await dictate(screen)

      await expect.element(screen.getByRole('textbox')).toHaveValue(`${DRAFT} ${VOICE_TRANSCRIPT}`)
      expect(microphone.getUserMedia).toHaveBeenCalledWith({ audio: true })
      expect(runtime.transcribes).toHaveLength(1)

      const audio = runtime.transcribes[0]?.audio

      expect(audio?.name).toBe('recording.webm')
      expect(audio?.type).toMatch(/^audio\/webm/)
      expect(audio?.size).toBeGreaterThan(0)
      expect(runtime.runs).toHaveLength(0)
    })

    // Two 429s reach this route: the provider's (`rate_limited`, which react-core names) and the
    // Lambda's own per-traveller throttle, whose body react-core does not recognise.
    it.each([
      ['the provider rate-limits', scenarios.voiceRateLimited, 'Too many requests. Please wait a moment.'],
      ['the Lambda throttles', { transcribe: { kind: 'http', status: 429 } }, 'Transcription failed'],
    ] satisfies Array<[string, RuntimeScenario, string]>)(
      'shows react-core’s error and leaves the draft untouched when %s',
      async (_case, scenario, message) => {
        install(scenario)
        microphone = stubMicrophone()

        const screen = await mount(<AIChat {...NOMADREAM_PRESET} />)

        await screen.getByRole('textbox').fill(DRAFT)
        await dictate(screen)

        await expect.element(screen.getByText(message, { exact: true })).toBeVisible()
        expect(runtime.transcribes).toHaveLength(1)
        await expect.element(screen.getByRole('textbox')).toHaveValue(DRAFT)
        await expect.element(screen.getByTestId(START_TRANSCRIBE_BUTTON)).toBeVisible()
      },
    )
  })
})

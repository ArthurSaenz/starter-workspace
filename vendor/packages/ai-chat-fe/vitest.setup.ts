import { setProjectAnnotations } from '@storybook/react'
import { beforeAll } from 'vitest'

import * as preview from './.storybook/preview.js'

// The React entry, never `storybook/preview-api`: only the framework entry seeds the project
// annotations with React's `renderToCanvas`. Without it a composed story's `mount()` throws before
// anything reaches the DOM, which is what the 2026-09-20 18:48 spike's 18 blank failure screenshots were.
const project = setProjectAnnotations([preview])

beforeAll(project.beforeAll)

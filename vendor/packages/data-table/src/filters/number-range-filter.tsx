import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'
import type { ChangeEvent } from 'react'
import { useEffect, useState } from 'react'

import type { NumberRangeFilterConfig, NumberRangeValue } from '../config/filter-config'
import { cn } from '../primitives/cn'
import { Input } from '../primitives/input'

export interface NumberRangeFilterProps {
  config: NumberRangeFilterConfig
}

/** Bare control for `NumberRangeFilterConfig` — the filter bar supplies the label. */
export const NumberRangeFilter = (props: NumberRangeFilterProps) => {
  const { config } = props

  const { value, onChange, bounds, step = 1, unitSymbol, className } = config

  const [position, setPosition] = useState<[number, number]>([value.min, value.max])

  useEffect(() => {
    setPosition([value.min, value.max])
  }, [value.min, value.max])

  const commit = (next: NumberRangeValue) => {
    const clamped = clampRange(next, bounds)

    setPosition([clamped.min, clamped.max])
    onChange(clamped)
  }

  const handleSliderChange = (next: number | number[]) => {
    const [min, max] = next as [number, number]

    setPosition([min, max])
  }

  const handleSliderCommit = (next: number | number[]) => {
    const [min, max] = next as [number, number]

    commit({ min, max })
  }

  // An entry that would cross the other handle is held as a draft until blur: committing it per
  // keystroke would swap the ends mid-typing (the "2" of "200" lands below the minimum).
  const canCommitMin = (min: number) => {
    return clampEdge(min, bounds) <= value.max
  }

  const canCommitMax = (max: number) => {
    return clampEdge(max, bounds) >= value.min
  }

  return (
    <div className={cn('grid w-56 gap-3', className)}>
      <div className="px-1 pt-2">
        <Slider
          range
          value={position}
          min={bounds.min}
          max={bounds.max}
          step={step}
          allowCross={false}
          pushable={false}
          onChange={handleSliderChange}
          onChangeComplete={handleSliderCommit}
        />
      </div>
      <div className="flex items-center gap-2">
        <NumberRangeInput
          value={value.min}
          min={bounds.min}
          max={value.max}
          step={step}
          unitSymbol={unitSymbol}
          ariaLabel={T.minLabel}
          canCommitLive={canCommitMin}
          onCommit={(min) => {
            commit({ min, max: value.max })
          }}
        />
        <span className="text-muted-foreground text-xs">{T.to}</span>
        <NumberRangeInput
          value={value.max}
          min={value.min}
          max={bounds.max}
          step={step}
          unitSymbol={unitSymbol}
          ariaLabel={T.maxLabel}
          canCommitLive={canCommitMax}
          onCommit={(max) => {
            commit({ min: value.min, max })
          }}
        />
      </div>
    </div>
  )
}

interface NumberRangeInputProps {
  value: number
  min: number
  max: number
  step: number
  unitSymbol?: string
  ariaLabel: string
  canCommitLive: (next: number) => boolean
  onCommit: (next: number) => void
}

const NumberRangeInput = (props: NumberRangeInputProps) => {
  const { value, min, max, step, unitSymbol, ariaLabel, canCommitLive, onCommit } = props

  const [draft, setDraft] = useState<string | null>(null)
  const [draftBase, setDraftBase] = useState(value)

  if (draftBase !== value) {
    setDraftBase(value)
    setDraft(null)
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    const parsed = parseNumberInput(raw)

    if (parsed !== undefined && canCommitLive(parsed)) {
      setDraft(null)
      onCommit(parsed)

      return
    }

    setDraft(raw)
  }

  const handleBlur = () => {
    if (draft === null) {
      return
    }

    const parsed = parseNumberInput(draft)

    setDraft(null)

    if (parsed !== undefined) {
      onCommit(parsed)
    }
  }

  return (
    <div className="relative flex-1">
      {unitSymbol ? (
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs">
          {unitSymbol}
        </span>
      ) : null}
      <Input
        type="number"
        value={draft ?? value}
        min={min}
        max={max}
        step={step}
        onChange={handleChange}
        onBlur={handleBlur}
        aria-label={ariaLabel}
        className={cn('h-9', unitSymbol && 'pl-6')}
      />
    </div>
  )
}

/** `Number('')` is 0, so an emptied field would otherwise commit the value 0. */
const parseNumberInput = (raw: string): number | undefined => {
  if (raw.trim() === '') {
    return undefined
  }

  const parsed = Number(raw)

  return Number.isFinite(parsed) ? parsed : undefined
}

const clampEdge = (edge: number, bounds: NumberRangeValue): number => {
  return Math.min(Math.max(edge, bounds.min), bounds.max)
}

const clampRange = (next: NumberRangeValue, bounds: NumberRangeValue): NumberRangeValue => {
  const min = clampEdge(next.min, bounds)
  const max = clampEdge(next.max, bounds)

  return min <= max ? { min, max } : { min: max, max: min }
}

const T = {
  minLabel: 'Minimum',
  maxLabel: 'Maximum',
  to: '–',
} as const

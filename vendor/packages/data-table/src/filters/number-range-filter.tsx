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

  const handleMinInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value)

    if (Number.isNaN(parsed)) {
      return
    }

    commit({ min: parsed, max: value.max })
  }

  const handleMaxInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value)

    if (Number.isNaN(parsed)) {
      return
    }

    commit({ min: value.min, max: parsed })
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
          onChange={handleMinInputChange}
        />
        <span className="text-muted-foreground text-xs">{T.to}</span>
        <NumberRangeInput
          value={value.max}
          min={value.min}
          max={bounds.max}
          step={step}
          unitSymbol={unitSymbol}
          ariaLabel={T.maxLabel}
          onChange={handleMaxInputChange}
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
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}

const NumberRangeInput = (props: NumberRangeInputProps) => {
  const { value, min, max, step, unitSymbol, ariaLabel, onChange } = props

  return (
    <div className="relative flex-1">
      {unitSymbol ? (
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs">
          {unitSymbol}
        </span>
      ) : null}
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        aria-label={ariaLabel}
        className={cn('h-9', unitSymbol && 'pl-6')}
      />
    </div>
  )
}

const clampRange = (next: NumberRangeValue, bounds: NumberRangeValue): NumberRangeValue => {
  const min = Math.min(Math.max(next.min, bounds.min), bounds.max)
  const max = Math.max(Math.min(next.max, bounds.max), bounds.min)

  return min <= max ? { min, max } : { min: max, max: min }
}

const T = {
  minLabel: 'Minimum',
  maxLabel: 'Maximum',
  to: '–',
} as const

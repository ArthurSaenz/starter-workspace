import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Calendar } from '../primitives/calendar'
import { Checkbox } from '../primitives/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../primitives/dropdown-menu'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { ScrollArea } from '../primitives/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'
import { Skeleton } from '../primitives/skeleton'
import { Switch } from '../primitives/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table'
import { Textarea } from '../primitives/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

describe('vendored primitives smoke', () => {
  it('mounts Button', async () => {
    const screen = await render(<Button>Click me</Button>)

    await expect.element(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('mounts Input', async () => {
    const screen = await render(<Input placeholder="type here" />)

    await expect.element(screen.getByPlaceholder('type here')).toBeInTheDocument()
  })

  it('mounts Textarea', async () => {
    const screen = await render(<Textarea placeholder="notes" />)

    await expect.element(screen.getByPlaceholder('notes')).toBeInTheDocument()
  })

  it('mounts Switch', async () => {
    const screen = await render(<Switch aria-label="toggle" />)

    await expect.element(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('mounts Checkbox', async () => {
    const screen = await render(<Checkbox aria-label="check" />)

    await expect.element(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('mounts Badge', async () => {
    const screen = await render(<Badge>New</Badge>)

    await expect.element(screen.getByText('New')).toBeInTheDocument()
  })

  it('mounts Table', async () => {
    const screen = await render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Row value</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    await expect.element(screen.getByText('Row value')).toBeInTheDocument()
  })

  it('mounts Skeleton', async () => {
    const screen = await render(<Skeleton data-testid="skeleton" />)

    await expect.element(screen.getByTestId('skeleton')).toBeInTheDocument()
  })

  it('mounts Label', async () => {
    const screen = await render(<Label htmlFor="field">Field label</Label>)

    await expect.element(screen.getByText('Field label')).toBeInTheDocument()
  })

  it('mounts ScrollArea', async () => {
    const screen = await render(
      <ScrollArea>
        <div>scrollable content</div>
      </ScrollArea>,
    )

    await expect.element(screen.getByText('scrollable content')).toBeInTheDocument()
  })

  it('mounts a composed Select without throwing', async () => {
    const screen = await render(
      <Select defaultOpen defaultValue="one">
        <SelectTrigger>
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one">One</SelectItem>
        </SelectContent>
      </Select>,
    )

    await expect.element(screen.getByRole('option', { name: 'One' })).toBeInTheDocument()
  })

  it('mounts a composed DropdownMenu without throwing', async () => {
    const screen = await render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Action</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    await expect.element(screen.getByText('Action')).toBeInTheDocument()
  })

  it('mounts a composed Popover without throwing', async () => {
    const screen = await render(
      <Popover defaultOpen>
        <PopoverTrigger>Open popover</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>,
    )

    await expect.element(screen.getByText('Popover body')).toBeInTheDocument()
  })

  it('mounts a composed Tooltip without throwing', async () => {
    const screen = await render(
      <Tooltip defaultOpen>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tooltip text</TooltipContent>
      </Tooltip>,
    )

    await expect.element(screen.getByText('Tooltip text')).toBeInTheDocument()
  })

  it('mounts Calendar', async () => {
    const screen = await render(<Calendar mode="single" />)

    await expect.element(screen.getByRole('grid')).toBeInTheDocument()
  })
})

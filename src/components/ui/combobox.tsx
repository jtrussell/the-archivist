import * as React from 'react'
import { cn } from '../../lib/utils'
import { Input } from './input'

export interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  className?: string
}

/**
 * Text input with a dropdown of existing options. Typing filters the list;
 * any free-form value is allowed (used to create new labels).
 */
const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(
  ({ value, onChange, options, placeholder, className }, ref) => {
    const [open, setOpen] = React.useState(false)
    const [highlighted, setHighlighted] = React.useState(-1)

    const filtered = value.trim()
      ? options.filter(
          (o) =>
            o.toLowerCase().includes(value.trim().toLowerCase()) &&
            o !== value
        )
      : options

    const select = (option: string) => {
      onChange(option)
      setOpen(false)
      setHighlighted(-1)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        setOpen(true)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((h) => Math.max(h - 1, 0))
      } else if (e.key === 'Enter') {
        if (open && highlighted >= 0 && highlighted < filtered.length) {
          e.preventDefault()
          select(filtered[highlighted])
        } else {
          setOpen(false)
        }
      } else if (e.key === 'Escape') {
        setOpen(false)
        setHighlighted(-1)
      }
    }

    return (
      <div className={cn('relative', className)}>
        <Input
          ref={ref}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setHighlighted(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setHighlighted(-1)
          }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        {open && filtered.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-input bg-popover text-popover-foreground shadow-lg">
            {filtered.map((option, i) => (
              <li key={option}>
                <button
                  type="button"
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    i === highlighted && 'bg-accent text-accent-foreground'
                  )}
                  // mousedown fires before the input's blur closes the list
                  onMouseDown={(e) => {
                    e.preventDefault()
                    select(option)
                  }}
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
)
Combobox.displayName = 'Combobox'

export { Combobox }

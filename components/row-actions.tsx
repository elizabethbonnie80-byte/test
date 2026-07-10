'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * A single entry in a RowActions menu. Either navigates (`href`) or runs `onSelect`.
 * `destructive` tints the item red (delete/cancel). Falsy entries are ignored, so callers can
 * inline conditionals: `[cond && { label, onSelect }, …]`.
 */
export type RowAction = {
  label: string
  icon?: ReactNode
  onSelect?: () => void
  href?: string
  destructive?: boolean
  disabled?: boolean
}

/**
 * One compact "Actions ▾" dropdown per table/list row — replaces stacks of side-by-side buttons so
 * the actions column never grows with the number of actions (used across the admin tables and the
 * broker Deal Room). Pass the visible actions; conditional ones can be included as falsy and skipped.
 */
export function RowActions({
  actions,
  label,
  align = 'end',
  disabled,
}: {
  actions: (RowAction | false | null | undefined)[]
  label: string
  align?: 'start' | 'center' | 'end'
  disabled?: boolean
}) {
  const items = actions.filter((a): a is RowAction => !!a)
  if (items.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1" disabled={disabled}>
          {label}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {items.map((a, i) =>
          a.href ? (
            <DropdownMenuItem key={i} asChild disabled={a.disabled}>
              <Link
                href={a.href}
                className={`cursor-pointer ${a.destructive ? 'text-destructive focus:text-destructive' : ''}`}
              >
                {a.icon}
                {a.label}
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={i}
              onSelect={a.onSelect}
              disabled={a.disabled}
              className={`cursor-pointer ${a.destructive ? 'text-destructive focus:text-destructive' : ''}`}
            >
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

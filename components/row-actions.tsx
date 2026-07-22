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

  // `--accent` is a strong blue, so a highlighted row is a solid blue bar with white text.
  //  * destructive rows use the menu's own destructive variant (red text on a red tint) instead of
  //    red-on-blue. The extra svg rule covers the `href` case, where the icon sits inside the <Link>
  //    and the variant's own `> svg` rule cannot reach it.
  //  * everything else forces its icon to the accent foreground while highlighted — an icon carrying
  //    its own colour (the green "Mark paid" check) is exempt from the menu's default rule and would
  //    otherwise stay green on the blue bar.
  const itemClass = (a: RowAction) =>
    a.destructive
      ? 'cursor-pointer [&_svg]:!text-destructive'
      : 'cursor-pointer focus:[&_svg]:!text-accent-foreground'

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
            <DropdownMenuItem
              key={i}
              asChild
              disabled={a.disabled}
              variant={a.destructive ? 'destructive' : 'default'}
            >
              <Link href={a.href} className={itemClass(a)}>
                {a.icon}
                {a.label}
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={i}
              onSelect={a.onSelect}
              disabled={a.disabled}
              variant={a.destructive ? 'destructive' : 'default'}
              className={itemClass(a)}
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

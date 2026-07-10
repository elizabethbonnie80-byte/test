'use client'

import { type Option } from '@/lib/enums'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * Shared filter-field primitives for the two places that edit a saved-filter's single-value criteria:
 * the New Deals / Maturing ad-hoc Filters sidepanel and the lender Settings saved-filter editor. Both
 * had their own near-identical copies (`EnumField`/`NumberField` vs `FilterEnumSelect`/`FilterNumber`)
 * that drifted only in label styling — unified here so a filter row looks the same in both surfaces.
 */

/** Single-select bound to a nullable enum criterion (`anyLabel` = criterion not set / not scored). */
export function EnumField<T extends string>({
  label,
  anyLabel,
  options,
  value,
  onChange,
}: {
  label: string
  anyLabel: string
  options: Option<T>[]
  value: T | null
  onChange: (v: T | null) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">{label}</Label>
      <Select value={value ?? 'any'} onValueChange={(v) => onChange(v === 'any' ? null : (v as T))}>
        <SelectTrigger className="bg-muted/50 h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">{anyLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Numeric input bound to a nullable number criterion. */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">{label}</Label>
      <Input
        type="number"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.trim() === '' ? null : Number(e.target.value))}
        className="bg-muted/50 h-9"
      />
    </div>
  )
}

/** A min–max pair of numeric inputs bound to two nullable number criteria. */
export function RangeField({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
  minPlaceholder,
  maxPlaceholder,
}: {
  label: string
  min: number | null
  max: number | null
  onMinChange: (v: number | null) => void
  onMaxChange: (v: number | null) => void
  minPlaceholder: string
  maxPlaceholder: string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={min ?? ''}
          placeholder={minPlaceholder}
          onChange={(e) => onMinChange(e.target.value.trim() === '' ? null : Number(e.target.value))}
          className="bg-muted/50 h-9"
        />
        <span className="text-muted-foreground text-xs shrink-0">–</span>
        <Input
          type="number"
          value={max ?? ''}
          placeholder={maxPlaceholder}
          onChange={(e) => onMaxChange(e.target.value.trim() === '' ? null : Number(e.target.value))}
          className="bg-muted/50 h-9"
        />
      </div>
    </div>
  )
}

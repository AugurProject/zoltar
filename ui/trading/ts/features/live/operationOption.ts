import type { ViewTabOption } from '@zoltar/ui-core-shared/types/components.js'

/** A workflow switcher option whose disabled state carries its reason; an enabled option never shows one. */
export function operationOption<TValue extends string>(value: TValue, label: string, disabled: boolean, reason: string | undefined): ViewTabOption<TValue> {
	return disabled && reason !== undefined ? { value, label, disabled, reason } : { value, label, disabled }
}

import { isRecord } from '../infrastructure/json-validation.ts'

type Guard<T> = (value: unknown) => value is T

export const stringValue: Guard<string> = (value): value is string => typeof value === 'string'
export const numberValue: Guard<number> = (value): value is number => typeof value === 'number' && Number.isFinite(value)
export const booleanValue: Guard<boolean> = (value): value is boolean => typeof value === 'boolean'
export const unknownValue: Guard<unknown> = (_value): _value is unknown => true

export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
	return (value): value is T | undefined => value === undefined || guard(value)
}

export function array<T>(guard: Guard<T>): Guard<T[]> {
	return (value): value is T[] => Array.isArray(value) && value.every(item => guard(item))
}

export function oneOf<const T extends string | number | boolean>(...choices: readonly T[]): Guard<T> {
	return (value): value is T => choices.some(choice => choice === value)
}

// Every declared field, including optional fields, must have a runtime guard.
// Extra fields remain available for forward-compatible API additions.
export function object<T extends object>(fields: { [K in keyof T]-?: Guard<T[K]> }): Guard<T> {
	return (value): value is T => {
		if (!isRecord(value)) return false
		for (const key in fields) if (!fields[key](value[key])) return false
		return true
	}
}

export function dictionary<T>(guard: Guard<T>): Guard<Record<string, T>> {
	return (value): value is Record<string, T> => isRecord(value) && Object.values(value).every(item => guard(item))
}

export function decode<T>(value: unknown, guard: Guard<T>, label: string): T {
	if (!guard(value)) throw new Error(`Bot returned an invalid ${label}`)
	return value
}

export function union<A, B>(left: Guard<A>, right: Guard<B>): Guard<A | B> {
	return (value): value is A | B => left(value) || right(value)
}

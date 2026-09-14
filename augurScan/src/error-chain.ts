import { errorChain } from '../../shared/core/ts/errors/errorChain.ts'
export const errorChainIncludes = (error: unknown, names: ReadonlySet<string>): boolean => {
	for (const current of errorChain(error)) {
		if ('name' in current && typeof current.name === 'string' && names.has(current.name)) return true
	}
	return false
}

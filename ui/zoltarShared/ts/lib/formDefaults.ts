import type { ZoltarMigrationFormState } from '../types/app.js'

export function getDefaultZoltarMigrationFormState(): ZoltarMigrationFormState {
	return {
		amount: '',
		outcomeIndexes: [],
	}
}

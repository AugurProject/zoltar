// Temporary shim: re-export Zoltar form defaults from '@zoltar/ui-zoltar/lib/formDefaults.js' once that module lands (owned by the zoltar agent).
import type { ZoltarMigrationFormState } from '@zoltar/ui-zoltar/types/app.js'

export function getDefaultZoltarMigrationFormState(): ZoltarMigrationFormState {
	return {
		amount: '0.0',
		outcomeIndexes: '',
	}
}

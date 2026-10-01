import type { MarketType } from '@zoltar/ui-core-shared/types/contracts.js'

export type { AccountState, TransactionLifecycleParameters, WriteOperationContext, WriteOperationsParameters } from '@zoltar/ui-core-shared/types/app.js'

export const ZOLTAR_ROUTES = ['deploy', 'zoltar', 'not-found'] as const
export type Route = (typeof ZOLTAR_ROUTES)[number]

export type MarketFormState = {
	answerUnit: string
	categoricalOutcomes: string[]
	description: string
	scalarIncrement: string
	scalarMax: string
	scalarMin: string
	title: string
	endTime: string
	marketType: MarketType
	startTime: string
}

export type ZoltarMigrationFormState = {
	amount: string
	/** Selected outcome indexes in the order the user picked them. */
	outcomeIndexes: readonly bigint[]
}

import type { Address } from '@zoltar/shared/ethereum'

export type AccountAddress = Address

export enum QuestionOutcome {
	Invalid,
	Yes,
	No,
	None,
}

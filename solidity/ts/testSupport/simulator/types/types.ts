import type { Address } from '@zoltar/core-shared/evm/ethereum'

export type AccountAddress = Address

export enum QuestionOutcome {
	Invalid,
	Yes,
	No,
	None,
}

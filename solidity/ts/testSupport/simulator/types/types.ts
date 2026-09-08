import type { Address } from '@zoltar/shared/evm/ethereum'

export type AccountAddress = Address

export enum QuestionOutcome {
	Invalid,
	Yes,
	No,
	None,
}

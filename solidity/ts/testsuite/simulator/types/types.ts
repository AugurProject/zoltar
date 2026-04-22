import type { Address } from 'viem'

export type AccountAddress = Address

export enum QuestionOutcome {
	Invalid,
	Yes,
	No,
	None,
}

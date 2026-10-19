import { validatePortfolioEconomics } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { parsePortfolioAmount } from './draft.js'

export type CuratedAdmissionMode = 'open' | 'fixed'
export type PortfolioCreationDraft = {
	targetHealthPercent: string
	purchaseFeePercent: string
	minimumPurchaseFee: string
	completionReward: string
	ownershipChangeFee: string
}

export const defaultPortfolioCreationDraft = (): PortfolioCreationDraft => ({ targetHealthPercent: '120', purchaseFeePercent: '1', minimumPurchaseFee: '0.001', completionReward: '0.00025', ownershipChangeFee: '0.001' })

function basisPoints(value: string, label: string) {
	if (!/^\d+(\.\d{0,2})?$/.test(value.trim())) throw new Error(`${label} must be a nonnegative percentage with at most two decimal places.`)
	const [whole, fraction = ''] = value.trim().split('.')
	if (whole === undefined) throw new Error(`Enter ${label.toLowerCase()}.`)
	return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

export function parsePortfolioCreationEconomics(draft: PortfolioCreationDraft) {
	const config = {
		targetHealthFactorBps: basisPoints(draft.targetHealthPercent, 'Target health'),
		purchaseFeeBps: basisPoints(draft.purchaseFeePercent, 'Purchase fee'),
		minimumPurchaseFeeAttoEth: parsePortfolioAmount(draft.minimumPurchaseFee),
		completionRewardAttoEth: parsePortfolioAmount(draft.completionReward),
		ownershipChangeFeeAttoEth: parsePortfolioAmount(draft.ownershipChangeFee),
	}
	validatePortfolioEconomics(config)
	return config
}

export function parseFixedPortfolioQuestions(input: string) {
	const values = input
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean)
	if (values.length === 0) throw new Error('Enter at least one approved question ID.')
	return [
		...new Set(
			values.map(value => {
				if (!/^(0x[\da-fA-F]+|\d+)$/.test(value)) throw new Error('Use decimal or hexadecimal question IDs separated by commas or spaces.')
				const id = BigInt(value)
				if (id >= 1n << 256n) throw new Error('Question ID must fit uint256.')
				return id
			}),
		),
	].sort((left, right) => {
		if (left < right) return -1
		if (left > right) return 1
		return 0
	})
}

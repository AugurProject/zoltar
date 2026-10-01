import { weth9Abi } from '@zoltar/bot-shared/contracts/abi'
import { ethSpend, tokenSpend } from '../input-funding.ts'
import { disabled, eligible, encodeStep, eventEvidence, planBase } from '../planning.ts'
import type { OperationDefinition } from '../types.ts'
import { tokenDebit } from './planning.ts'

export function wethDefinition(mode: 'wrap' | 'unwrap'): OperationDefinition {
	const id = `open-oracle.weth.${mode}`
	return {
		buildPlan(snapshot, options) {
			const value = mode === 'wrap' ? ethSpend(snapshot, options, id) : tokenSpend(snapshot, snapshot.deployments.weth, options, id)
			if (value === 0n) return undefined
			return planBase({
				definitionId: id,
				ecosystem: 'open-oracle',
				label: `${mode} WETH`,
				metadata: { amountAttoEth: value.toString() },
				postconditions: [mode === 'wrap' ? 'WETH increases and ETH decreases by the wrapped principal plus gas' : 'WETH decreases and ETH increases by the unwrapped principal less gas'],
				risk: 'low',
				snapshot,
				steps: [
					encodeStep({
						abi: weth9Abi,
						args: mode === 'unwrap' ? [value] : undefined,
						evidence: [eventEvidence(snapshot.deployments.weth, mode === 'wrap' ? 'Deposit(address,uint256)' : 'Withdrawal(address,uint256)')],
						functionName: mode === 'wrap' ? 'deposit' : 'withdraw',
						id: mode,
						label: `${mode} WETH`,
						to: snapshot.deployments.weth,
						value: mode === 'wrap' ? value : undefined,
						walletAssetDebits: mode === 'unwrap' ? tokenDebit(snapshot, snapshot.deployments.weth, value) : [],
					}),
				],
			})
		},
		classification: 'selectable',
		contract: 'WETH9',
		description: `${mode === 'wrap' ? 'Wraps spendable ETH as WETH' : 'Returns a bounded WETH balance to ETH'}.`,
		discoveryInputs: ['ETH reserve', 'WETH balance', 'spend caps'],
		ecosystem: 'open-oracle',
		evaluate(snapshot, options) {
			const value = mode === 'wrap' ? ethSpend(snapshot, options, id) : tokenSpend(snapshot, snapshot.deployments.weth, options, id)
			return eligible(value === 0n ? `No ${mode === 'wrap' ? 'ETH' : 'WETH'} is spendable` : undefined)
		},
		id,
		label: `${mode} WETH`,
		method: mode === 'wrap' ? 'deposit' : 'withdraw',
		risk: 'low',
	}
}

export const approveWeth: OperationDefinition = {
	buildPlan: () => undefined,
	classification: 'prerequisite',
	contract: 'WETH9',
	description: 'A bounded exact WETH allowance is automatically composed into OpenOracle and coordinator workflows.',
	discoveryInputs: ['WETH allowances', 'selected workflow WETH requirement'],
	ecosystem: 'open-oracle',
	evaluate: () => disabled('Prerequisites are composed into selectable plans'),
	id: 'token.weth.approve',
	label: 'Approve WETH',
	method: 'approve',
	risk: 'medium',
}

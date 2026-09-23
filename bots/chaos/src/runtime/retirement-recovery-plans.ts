import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { erc1155Abi, erc20Abi, openOracleAbi, twoWayConstantProductPairAbi, weth9Abi } from '@zoltar/bot-shared/contracts/abi'
import { encodeStep, planBase } from '../operations/planning.ts'
import type { EcosystemSnapshot, OperationPlan } from '../operations/types.ts'
import { assertSafeRetirementRecipient, type DurableRetirementState } from '../state/retirement.ts'

export function buildAllowanceRevocationPlan(snapshot: EcosystemSnapshot, seed: number): OperationPlan | undefined {
	const internalApproval = [...snapshot.wallet.tokens].sort((left, right) => left.address.localeCompare(right.address)).find(token => BigInt(token.openOracleInternalAllowanceToSelf ?? '0') > 0n)
	if (internalApproval !== undefined) {
		return {
			...planBase({
				definitionId: 'retirement.allowance.revoke-open-oracle-internal',
				ecosystem: 'open-oracle',
				label: 'Revoke OpenOracle internal allowance',
				metadata: { owner: snapshot.wallet.address, spender: snapshot.wallet.address, token: internalApproval.address },
				postconditions: ['The wallet-to-self OpenOracle internal allowance is zero'],
				risk: 'low',
				snapshot,
				steps: [
					encodeStep({
						abi: openOracleAbi,
						args: [snapshot.wallet.address, internalApproval.address, 0n],
						evidence: [
							{
								abi: 'function internalAllowance(address owner,address spender,address token) view returns (uint256)',
								args: [snapshot.wallet.address, snapshot.wallet.address, internalApproval.address],
								contract: snapshot.deployments.openOracle,
								expected: '0',
								functionName: 'internalAllowance',
								kind: 'storage-postcondition',
								relation: 'equals',
							},
						],
						functionName: 'approveInternal',
						id: 'revoke-open-oracle-internal',
						label: 'Revoke OpenOracle internal allowance',
						to: snapshot.deployments.openOracle,
					}),
				],
			}),
			planningSeed: seed,
		}
	}
	const tokenApproval = [...snapshot.wallet.tokens]
		.sort((left, right) => left.address.localeCompare(right.address))
		.flatMap(token =>
			Object.entries(token.allowances)
				.filter(([, amount]) => BigInt(amount) > 0n)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([spender]) => ({ spender: getAddress(spender), token: token.address })),
		)[0]
	if (tokenApproval !== undefined) {
		return {
			...planBase({
				definitionId: 'retirement.allowance.revoke-erc20',
				ecosystem: 'trading',
				label: 'Revoke known ERC-20 allowance',
				metadata: { spender: tokenApproval.spender, token: tokenApproval.token },
				postconditions: ['The exact known ERC-20 allowance is zero'],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: erc20Abi, args: [tokenApproval.spender, 0n], functionName: 'approve', id: 'revoke-erc20', label: 'Revoke ERC-20 allowance', to: tokenApproval.token })],
			}),
			planningSeed: seed,
		}
	}
	const shareApproval = [...snapshot.wallet.shares]
		.sort((left, right) => left.shareToken.localeCompare(right.shareToken))
		.flatMap(shares =>
			Object.entries(shares.isApprovedForAll)
				.filter(([, approved]) => approved)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([operator]) => ({ operator: getAddress(operator), token: shares.shareToken })),
		)[0]
	if (shareApproval !== undefined) {
		return {
			...planBase({
				definitionId: 'retirement.allowance.revoke-erc1155',
				ecosystem: 'trading',
				label: 'Revoke known ERC-1155 operator',
				metadata: { operator: shareApproval.operator, token: shareApproval.token },
				postconditions: ['The exact known ERC-1155 operator approval is false'],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: erc1155Abi, args: [shareApproval.operator, false], functionName: 'setApprovalForAll', id: 'revoke-erc1155', label: 'Revoke ERC-1155 operator', to: shareApproval.token })],
			}),
			planningSeed: seed,
		}
	}
	const lpApproval = [...snapshot.wallet.lpTokens].sort((left, right) => left.pair.localeCompare(right.pair)).find(lp => BigInt(lp.allowanceToRouter) > 0n)
	if (lpApproval === undefined) return undefined
	return {
		...planBase({
			definitionId: 'retirement.allowance.revoke-lp',
			ecosystem: 'trading',
			label: 'Revoke known LP-token router allowance',
			metadata: { pair: lpApproval.pair, router: snapshot.deployments.tradingRouter },
			postconditions: ['The LP-token router allowance is zero'],
			risk: 'low',
			snapshot,
			steps: [encodeStep({ abi: twoWayConstantProductPairAbi, args: [snapshot.deployments.tradingRouter, 0n], functionName: 'approve', id: 'revoke-lp', label: 'Revoke LP-token allowance', to: lpApproval.pair })],
		}),
		planningSeed: seed,
	}
}

export function buildNativeOpenOracleCreditPlan(snapshot: EcosystemSnapshot, retirement: DurableRetirementState, seed: number): OperationPlan | undefined {
	if (retirement.recipient === undefined) return undefined
	assertSafeRetirementRecipient(retirement.recipient, snapshot.wallet.address)
	const credit = BigInt(snapshot.wallet.openOracleEthCredit)
	if (credit <= 1n) return undefined
	const amount = credit - 1n
	return {
		...planBase({
			definitionId: 'retirement.open-oracle.withdraw-native',
			ecosystem: 'open-oracle',
			label: 'Withdraw native OpenOracle credit',
			metadata: { amount: amount.toString(), recipient: retirement.recipient },
			postconditions: ['OpenOracle native credit retains exactly its mandatory one-unit sentinel and pays the recoverable balance to the signer'],
			risk: 'low',
			snapshot,
			steps: [
				encodeStep({
					abi: openOracleAbi,
					args: [zeroAddress, amount, retirement.recipient],
					evidence: [{ abi: 'function tokenHolder(address owner,address token) view returns (uint256)', args: [snapshot.wallet.address, zeroAddress], contract: snapshot.deployments.openOracle, expected: '1', functionName: 'tokenHolder', kind: 'storage-postcondition', relation: 'equals' }],
					functionName: 'withdrawTo',
					id: 'withdraw-native-credit',
					label: 'Withdraw native OpenOracle credit to signer',
					to: snapshot.deployments.openOracle,
				}),
			],
		}),
		planningSeed: seed,
	}
}

export type RetirementSweepLimits = {
	maximumEthAttoEth: bigint
	maximumGasCostAttoEth: bigint
	maximumRepAttoRep: bigint
	minimumEthReserveAttoEth: bigint
}

export function buildAssetSweepPlan(snapshot: EcosystemSnapshot, retirement: DurableRetirementState, seed: number, limits?: RetirementSweepLimits): OperationPlan | undefined {
	if (!retirement.policies.sweepAssets || retirement.recipient === undefined || limits === undefined) return undefined
	assertSafeRetirementRecipient(retirement.recipient, snapshot.wallet.address)
	const weth = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())
	if (retirement.policies.unwrapWeth && weth !== undefined && BigInt(weth.balance) > 0n) {
		const amount = BigInt(weth.balance) < limits.maximumEthAttoEth ? BigInt(weth.balance) : limits.maximumEthAttoEth
		return {
			...planBase({
				definitionId: 'retirement.sweep.unwrap-weth',
				ecosystem: 'trading',
				label: 'Unwrap WETH for retirement',
				metadata: { amount: amount.toString() },
				postconditions: ['The selected WETH balance is converted to native ETH'],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: weth9Abi, args: [amount], functionName: 'withdraw', id: 'unwrap-weth', label: 'Unwrap WETH', to: snapshot.deployments.weth, walletAssetDebits: [{ amount: amount.toString(), asset: snapshot.deployments.weth, category: 'weth', kind: 'erc20' }] })],
			}),
			planningSeed: seed,
		}
	}
	return undefined
}

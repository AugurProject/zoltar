import { describe, expect, test } from 'bun:test'
import { coordinatorAbi, escalationGameAbi, securityPoolAbi, securityPoolForkerAbi } from '../../src/contracts/abi.ts'
import {
	peripherals_EscalationGame_EscalationGame as escalationGameArtifact,
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	peripherals_SecurityPool_SecurityPool as securityPoolArtifact,
	peripherals_SecurityPoolForker_SecurityPoolForker as securityPoolForkerArtifact,
} from '../../../../solidity/ts/types/contractArtifact.ts'

type AbiParameter = {
	components?: readonly AbiParameter[]
	indexed?: boolean
	name: string
	type: string
}

type AbiItem = {
	inputs?: readonly AbiParameter[]
	name?: string
	outputs?: readonly AbiParameter[]
	stateMutability?: string
	type: string
}

function normalizeParameters(parameters: readonly AbiParameter[] | undefined): unknown {
	return parameters?.map(parameter => ({
		...(parameter.components === undefined ? {} : { components: normalizeParameters(parameter.components) }),
		...(parameter.indexed === undefined ? {} : { indexed: parameter.indexed }),
		name: parameter.name,
		type: parameter.type,
	}))
}

function normalizeInputs(parameters: readonly AbiParameter[] | undefined): unknown {
	return parameters?.map(parameter => ({
		...(parameter.components === undefined ? {} : { components: normalizeParameters(parameter.components) }),
		...(parameter.indexed === undefined ? {} : { indexed: parameter.indexed }),
		name: '',
		type: parameter.type,
	}))
}

function normalizeItem(item: AbiItem) {
	return {
		inputs: item.type === 'function' ? normalizeInputs(item.inputs) : normalizeParameters(item.inputs),
		name: item.name,
		outputs: item.type === 'function' ? normalizeInputs(item.outputs) : normalizeParameters(item.outputs),
		stateMutability: item.stateMutability,
		type: item.type,
	}
}

function requireItem(abi: readonly AbiItem[], type: 'event' | 'function', name: string) {
	const item = abi.find(candidate => candidate.type === type && candidate.name === name)
	if (item === undefined) throw new Error(`Missing ${type} ${name}`)
	return item
}

function expectConformant(botAbi: readonly AbiItem[], contractAbi: readonly AbiItem[], type: 'event' | 'function', name: string) {
	expect(normalizeItem(requireItem(botAbi, type, name))).toEqual(normalizeItem(requireItem(contractAbi, type, name)))
}

describe('liquidator contract ABI conformance', () => {
	test('tracks the generated SecurityPool capacity and health interface', () => {
		for (const name of ['securityVaults', 'escalationGame', 'getPoolAccountingSnapshot', 'getVaultOpenInterestAttoEth', 'vaultBadDebtAttoEth', 'totalCapacityOwnershipAttoRep', 'minimumSecurityBondDebtAttoEth', 'minimumVaultRepDepositAttoRep', 'depositRepToVault']) {
			expectConformant(securityPoolAbi, securityPoolArtifact.abi, 'function', name)
		}
		expectConformant(escalationGameAbi, escalationGameArtifact.abi, 'function', 'disputeStakedRepByVaultAttoRep')
		expectConformant(securityPoolForkerAbi, securityPoolForkerArtifact.abi, 'function', 'forkData')
	})

	test('tracks the generated coordinator liquidation route and staged-operation tuple', () => {
		for (const name of ['getActiveStagedOperations', 'requestPriceIfNeededAndStageLiquidation', 'requestPriceIfNeededAndStageOperation']) {
			expectConformant(coordinatorAbi, coordinatorArtifact.abi, 'function', name)
		}
		for (const name of ['StagedOperationQueued', 'LiquidationRouteStaged', 'ExecutedStagedOperation']) {
			expectConformant(coordinatorAbi, coordinatorArtifact.abi, 'event', name)
		}
	})
})

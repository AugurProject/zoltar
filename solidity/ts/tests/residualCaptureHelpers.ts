import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame } from '../types/contractArtifact'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import type { WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { getSecurityPoolsEscalationGame } from '../testSupport/simulator/utils/contracts/securityPool'

const ATTO_REP = 10n ** 18n
const lowLosingPrincipal = 100n * ATTO_REP
const bindingLosingPrincipal = 200n * ATTO_REP
const winningPrincipal = 300n * ATTO_REP

// Ordinary-game stakes whose low Invalid side is paid to backing providers at source.
export const ordinaryEscalationPrincipals = {
	lowLosingPrincipal,
	bindingLosingPrincipal,
	winningPrincipal,
	totalPrincipal: lowLosingPrincipal + bindingLosingPrincipal + winningPrincipal,
}

export async function advancePastOrdinaryEscalationDeadline(client: WriteClient, mockWindow: AnvilWindowEthereum, securityPool: Address) {
	const escalationGame = await getSecurityPoolsEscalationGame(client, securityPool)
	const activationTime = await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGame,
		functionName: 'activationTime',
		args: [],
	})
	await mockWindow.setTime(activationTime + 49n * DAY + 1n)
	return escalationGame
}

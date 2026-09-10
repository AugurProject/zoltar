import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { createOpenOracleReportInstance, disputeOracleReport, loadOpenOracleReportDetails, loadOpenOracleWithdrawableBalances, settleOracleReport, withdrawOpenOracleBalance } from '../../../protocol/openOracle.js'
import { approveErc20 } from '@zoltar/ui-zoltar-shared/protocol/tokenActions.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { parseOpenOracleCreateFormSubmission } from '../lib/openOracle.js'
import type { WriteOperationsParameters } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { OpenOracleActionResult, OpenOracleReportDetails, OpenOracleWithdrawableBalances } from '@zoltar/ui-core-shared/types/contracts.js'
import type { OpenOracleRawReadResult, OpenOracleReadClient } from '../lib/openOracleTokenAccess.js'

export type UseOpenOracleOperationsParameters = WriteOperationsParameters & {
	enabled: boolean
	onReportSettled?: () => Promise<void> | void
}
export type OpenOracleProductionWriteClient = ReturnType<typeof createWalletWriteClient>
export type UseOpenOracleOperationsDependencies<TWriteClient = OpenOracleProductionWriteClient> = {
	approveErc20: (client: TWriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: 'approveToken1' | 'approveToken2') => Promise<OpenOracleActionResult>
	createConnectedReadClient: () => OpenOracleReadClient
	createOpenOracleReportInstance: (client: TWriteClient, parameters: ReturnType<typeof parseOpenOracleCreateFormSubmission>) => Promise<OpenOracleActionResult>
	createWalletWriteClient: (accountAddress: Address, callbacks?: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient
	disputeOracleReport: (client: TWriteClient, openOracleAddress: Address, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, currentAmount2: bigint, stateHash: Hash) => Promise<OpenOracleActionResult>
	loadOpenOracleReportDetails: (openOracleAddress: Address, reportId: bigint) => Promise<OpenOracleReportDetails>
	loadOpenOracleWithdrawableBalances: (openOracleAddress: Address, holder: Address, token1: Address, token2: Address) => Promise<OpenOracleWithdrawableBalances>
	readOptionalMulticall: (contracts: readonly unknown[]) => Promise<readonly OpenOracleRawReadResult[]>
	settleOracleReport: (client: TWriteClient, openOracleAddress: Address, reportId: bigint) => Promise<OpenOracleActionResult>
	withdrawOpenOracleBalance: (client: TWriteClient, openOracleAddress: Address, token: Address, amount: bigint, recipient: Address) => Promise<OpenOracleActionResult>
}

export const defaultUseOpenOracleOperationsDependencies: UseOpenOracleOperationsDependencies = {
	approveErc20: async (client, tokenAddress, spenderAddress, amount, action) => await approveErc20(client, tokenAddress, spenderAddress, amount, action),
	createConnectedReadClient: () => {
		const client = createConnectedReadClient()
		return {
			getBalance: async parameters => await client.getBalance(parameters),
			readContract: async parameters => await client.readContract(parameters),
		}
	},
	createOpenOracleReportInstance: async (client, parameters) => await createOpenOracleReportInstance(client, parameters),
	createWalletWriteClient,
	disputeOracleReport: async (client, openOracleAddress, reportId, tokenToSwap, newAmount1, newAmount2, currentAmount2, stateHash) => await disputeOracleReport(client, openOracleAddress, reportId, tokenToSwap, newAmount1, newAmount2, currentAmount2, stateHash),
	loadOpenOracleReportDetails: async (openOracleAddress, reportId) => await loadOpenOracleReportDetails(createConnectedReadClient(), openOracleAddress, reportId),
	loadOpenOracleWithdrawableBalances: async (openOracleAddress, holder, token1, token2) => await loadOpenOracleWithdrawableBalances(createConnectedReadClient(), openOracleAddress, holder, token1, token2),
	readOptionalMulticall: async contracts => await readOptionalMulticall(createConnectedReadClient(), contracts),
	settleOracleReport: async (client, openOracleAddress, reportId) => await settleOracleReport(client, openOracleAddress, reportId),
	withdrawOpenOracleBalance: async (client, openOracleAddress, token, amount, recipient) => await withdrawOpenOracleBalance(client, openOracleAddress, token, amount, recipient),
}

import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { LiquidationFundingPreview } from '../../../types/contracts.js'
import type { UseSecurityPoolsOverviewDependencies } from './securityPoolsOverviewDependencies.js'

export async function resolveLiquidationFunding<TWriteClient>(dependencies: UseSecurityPoolsOverviewDependencies<TWriteClient>, writeClient: TWriteClient, managerAddress: Address, walletAddress: Address, proposedRepPerEthPrice?: bigint): Promise<LiquidationFundingPreview> {
	const queueOperationValueAttoEth = await dependencies.loadOracleManagerQueueOperationEthValue(writeClient, managerAddress)
	if (queueOperationValueAttoEth === 0n) {
		return {
			currentRepBalanceAttoRep: 0n,
			currentWethBalanceAttoEth: 0n,
			initialReportRepRequiredAttoRep: 0n,
			initialReportWethRequiredAttoEth: 0n,
			queueOperationValueAttoEth,
			totalWalletEthRequiredAttoEth: 0n,
			wethShortfallAttoEth: 0n,
		}
	}
	const fundingRequirement = await dependencies.loadCoordinatorInitialReportFundingRequirement(writeClient, managerAddress, walletAddress, proposedRepPerEthPrice)
	return {
		currentRepBalanceAttoRep: fundingRequirement.currentRepBalanceAttoRep,
		currentWethBalanceAttoEth: fundingRequirement.currentWethBalanceAttoEth,
		initialReportRepRequiredAttoRep: fundingRequirement.requiredRepAttoRep,
		initialReportWethRequiredAttoEth: fundingRequirement.maximumInitialAttoWeth,
		queueOperationValueAttoEth,
		totalWalletEthRequiredAttoEth: queueOperationValueAttoEth + fundingRequirement.wethShortfallAttoEth,
		wethShortfallAttoEth: fundingRequirement.wethShortfallAttoEth,
	}
}

export function getLiquidationFundingPreviewRequestKey(managerAddress: Address, walletAddress: Address, environmentRefreshKey: number, proposedRepPerEthPrice?: bigint) {
	return `${environmentRefreshKey}:${managerAddress.toLowerCase()}:${walletAddress.toLowerCase()}:${proposedRepPerEthPrice?.toString() ?? 'automatic'}`
}

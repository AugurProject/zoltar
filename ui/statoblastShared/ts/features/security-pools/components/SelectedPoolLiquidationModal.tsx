import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ListedSecurityPool, OracleManagerDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import type { SecurityPoolWorkflowRouteContentProps } from '../../types.js'
import type { SecurityPoolStateModel } from '../lib/securityPoolState.js'
import { LiquidationModal } from './LiquidationModal.js'

type SelectedPoolLiquidationModalProps = SecurityPoolWorkflowRouteContentProps & {
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	isOnActiveAppChain: boolean
	liquidationPoolOracleManagerError: string | undefined
	poolState: SecurityPoolStateModel
	selectedPool: ListedSecurityPool | undefined
}

/** Maps the selected-pool route props onto the liquidation modal. */
export function SelectedPoolLiquidationModal({
	accountState,
	closeLiquidationModal,
	currentPoolOracleManagerDetails,
	isOnActiveAppChain,
	liquidationApprovalDetails,
	liquidationApprovalError,
	liquidationApprovalId,
	liquidationDebtEthAmount,
	liquidationFundingPreview,
	liquidationFundingPreviewError,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationPoolOracleManagerError,
	liquidationReceiverVault,
	liquidationReceiverVaultSummary,
	liquidationReceiverVaultSummaryError,
	liquidationReceiverVaultSummaryResolved,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	liquidationTimeoutMinutes,
	loadingLiquidationApproval,
	loadingLiquidationFundingPreview,
	loadingLiquidationReceiverVaultSummary,
	loadingPoolOracleManager,
	maximumLiquidationDebtAttoEth,
	onLiquidationAmountChange,
	onLiquidationApprovalIdChange,
	onLiquidationReceiverVaultChange,
	onLiquidationTimeoutMinutesChange,
	onLoadLiquidationApproval,
	onLoadLiquidationFundingPreview,
	onLoadLiquidationReceiverVaultSummary,
	onLoadPoolOracleManager,
	onQueueLiquidation,
	onSelectedPoolViewChange,
	poolState,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	securityPoolLiquidationError,
	securityPoolOverviewActiveAction,
	securityPoolOverviewResult,
	selectedPool,
	uiPriceOracle,
}: SelectedPoolLiquidationModalProps) {
	return (
		<LiquidationModal
			accountAddress={accountState.address}
			closeLiquidationModal={closeLiquidationModal}
			currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
			isOnActiveAppChain={isOnActiveAppChain}
			liquidationDebtEthAmount={liquidationDebtEthAmount}
			maximumLiquidationDebtAttoEth={maximumLiquidationDebtAttoEth}
			liquidationManagerAddress={liquidationManagerAddress}
			liquidationFundingPreview={liquidationFundingPreview}
			liquidationFundingPreviewError={liquidationFundingPreviewError}
			liquidationModalOpen={liquidationModalOpen}
			liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
			liquidationTimeoutMinutes={liquidationTimeoutMinutes}
			loadingPoolOracleManager={loadingPoolOracleManager}
			loadingLiquidationFundingPreview={loadingLiquidationFundingPreview}
			liquidationTargetVault={liquidationTargetVault}
			liquidationReceiverVault={liquidationReceiverVault}
			liquidationApprovalId={liquidationApprovalId}
			liquidationApprovalDetails={liquidationApprovalDetails}
			liquidationApprovalError={liquidationApprovalError}
			liquidationReceiverVaultSummaryError={liquidationReceiverVaultSummaryError}
			liquidationReceiverVaultSummaryResolved={liquidationReceiverVaultSummaryResolved}
			loadingLiquidationApproval={loadingLiquidationApproval}
			loadingLiquidationReceiverVaultSummary={loadingLiquidationReceiverVaultSummary}
			onLoadPoolOracleManager={onLoadPoolOracleManager}
			onLoadLiquidationFundingPreview={onLoadLiquidationFundingPreview}
			onLoadLiquidationApproval={onLoadLiquidationApproval}
			onLoadLiquidationReceiverVaultSummary={onLoadLiquidationReceiverVaultSummary}
			onSelectedPoolViewChange={onSelectedPoolViewChange}
			poolState={poolState}
			poolOracleManagerError={liquidationPoolOracleManagerError}
			repPerEthPrice={repPerEthPrice}
			repPerEthSource={repPerEthSource}
			repPerEthSourceUrl={repPerEthSourceUrl}
			uiPriceOracle={uiPriceOracle}
			selectedPool={selectedPool}
			securityPoolOverviewActiveAction={securityPoolOverviewActiveAction}
			securityPoolLiquidationError={securityPoolLiquidationError}
			securityPoolOverviewResult={securityPoolOverviewResult}
			walletBalanceAttoEth={accountState.ethBalanceAttoEth}
			receiverVaultSummary={liquidationReceiverVaultSummary ?? selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationReceiverVault))}
			targetVaultSummary={selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationTargetVault))}
			onLiquidationAmountChange={onLiquidationAmountChange}
			onLiquidationReceiverVaultChange={onLiquidationReceiverVaultChange}
			onLiquidationApprovalIdChange={onLiquidationApprovalIdChange}
			onLiquidationTimeoutMinutesChange={onLiquidationTimeoutMinutesChange}
			onQueueLiquidation={onQueueLiquidation}
		/>
	)
}

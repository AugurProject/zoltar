import { MainnetGateSection } from './MainnetGateSection.js'
import { DeploymentSection } from './DeploymentSection.js'
import { ForkAuctionSection } from './ForkAuctionSection.js'
import { MarketSection } from './MarketSection.js'
import { OpenOracleSection } from './OpenOracleSection.js'
import { ReportingSection } from './ReportingSection.js'
import { SecurityPoolSection } from './SecurityPoolSection.js'
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js'
import { SecurityVaultSection } from './SecurityVaultSection.js'
import { TradingSection } from './TradingSection.js'
import { assertNever } from '../lib/assert.js'
import type { AppRouteContentProps } from '../types/components.js'

export function AppRouteContent(props: AppRouteContentProps) {
	if (props.wrongNetworkMessage !== undefined) {
		return <MainnetGateSection message={props.wrongNetworkMessage} />
	}

	switch (props.route) {
		case 'deploy':
			return (
				<>
					{props.deploymentSections.map(section => (
						<DeploymentSection key={section.title} title={section.title} steps={section.steps} allSteps={props.deploymentStatuses} accountAddress={props.accountState.address} isMainnet={props.accountState.isMainnet} busyStepId={props.busyStepId} onDeploy={props.deployStep} />
					))}
				</>
			)
		case 'markets':
			return <MarketSection accountState={props.accountState} deploymentStatuses={props.deploymentStatuses} marketForm={props.marketForm} marketCreating={props.marketCreating} marketResult={props.marketResult} marketError={props.marketError} onMarketFormChange={props.onMarketFormChange} onCreateMarket={props.createMarket} onResetMarket={props.onResetMarket} />
		case 'security-pools':
			return (
				<SecurityPoolSection
					accountState={props.accountState}
					deploymentStatuses={props.deploymentStatuses}
					lastCreatedQuestionId={props.lastCreatedQuestionId}
					marketDetails={props.marketDetails}
					loadingMarketDetails={props.loadingMarketDetails}
					securityPoolCreating={props.securityPoolCreating}
					securityPoolError={props.securityPoolError}
					securityPoolForm={props.securityPoolForm}
					securityPoolResult={props.securityPoolResult}
					onLoadLatestMarket={() => {
						if (props.lastCreatedQuestionId === undefined) return
						props.onSecurityPoolFormChange({ marketId: props.lastCreatedQuestionId })
						void props.loadMarketById(props.lastCreatedQuestionId)
					}}
					onLoadMarket={props.loadMarket}
					onSecurityPoolFormChange={props.onSecurityPoolFormChange}
					onCreateSecurityPool={props.createPool}
				/>
			)
		case 'security-pools-overview':
			return <SecurityPoolsOverviewSection accountState={props.accountState} liquidationAmount={props.liquidationAmount} liquidationTargetVault={props.liquidationTargetVault} loadingSecurityPools={props.loadingSecurityPools} onLiquidationAmountChange={props.onLiquidationAmountChange} onLiquidationTargetVaultChange={props.onLiquidationTargetVaultChange} onLoadSecurityPools={props.loadSecurityPools} onQueueLiquidation={props.onQueueLiquidation} securityPoolOverviewError={props.securityPoolOverviewError} securityPoolOverviewResult={props.securityPoolOverviewResult} securityPools={props.securityPools} />
		case 'security-vaults':
			return <SecurityVaultSection accountState={props.accountState} loadingSecurityVault={props.loadingSecurityVault} onApproveRep={props.onApproveRep} onDepositRep={props.onDepositRep} onLoadSecurityVault={props.loadSecurityVault} onRedeemFees={props.onRedeemFees} onRedeemRep={props.onRedeemRep} onSecurityVaultFormChange={props.onSecurityVaultFormChange} onUpdateVaultFees={props.onUpdateVaultFees} securityVaultDetails={props.securityVaultDetails} securityVaultError={props.securityVaultError} securityVaultForm={props.securityVaultForm} securityVaultResult={props.securityVaultResult} />
		case 'open-oracle':
			return <OpenOracleSection accountState={props.accountState} loadingOracleManager={props.loadingOracleManager} onApproveToken1={props.onApproveToken1} onApproveToken2={props.onApproveToken2} onLoadOracleManager={props.loadOracleManager} onOpenOracleFormChange={props.onOpenOracleFormChange} onRequestPrice={props.onRequestPrice} onSettleReport={props.onSettleReport} onSubmitInitialReport={props.onSubmitInitialReport} openOracleError={props.openOracleError} openOracleForm={props.openOracleForm} openOracleResult={props.openOracleResult} oracleManagerDetails={props.oracleManagerDetails} />
		case 'reporting':
			return <ReportingSection accountState={props.accountState} loadingReportingDetails={props.loadingReportingDetails} onLoadReporting={props.loadReporting} onReportOutcome={props.onReportOutcome} onReportingFormChange={props.onReportingFormChange} onWithdrawEscalation={props.onWithdrawEscalation} reportingDetails={props.reportingDetails} reportingError={props.reportingError} reportingForm={props.reportingForm} reportingResult={props.reportingResult} />
		case 'fork-auctions':
			return <ForkAuctionSection accountState={props.accountState} forkAuctionDetails={props.forkAuctionDetails} forkAuctionError={props.forkAuctionError} forkAuctionForm={props.forkAuctionForm} forkAuctionResult={props.forkAuctionResult} loadingForkAuctionDetails={props.loadingForkAuctionDetails} onClaimAuctionProceeds={props.onClaimAuctionProceeds} onCreateChildUniverse={props.onCreateChildUniverse} onFinalizeTruthAuction={props.onFinalizeTruthAuction} onForkAuctionFormChange={props.onForkAuctionFormChange} onForkWithOwnEscalation={props.onForkWithOwnEscalation} onInitiateFork={props.onInitiateFork} onLoadForkAuction={props.loadForkAuction} onMigrateEscalationDeposits={props.onMigrateEscalationDeposits} onMigrateRepToZoltar={props.onMigrateRepToZoltar} onMigrateVault={props.onMigrateVault} onRefundLosingBids={props.onRefundLosingBids} onStartTruthAuction={props.onStartTruthAuction} onSubmitBid={props.onSubmitBid} />
		case 'trading':
			return <TradingSection accountState={props.accountState} onCreateCompleteSet={props.onCreateCompleteSet} onRedeemCompleteSet={props.onRedeemCompleteSet} onTradingFormChange={props.onTradingFormChange} tradingError={props.tradingError} tradingForm={props.tradingForm} tradingResult={props.tradingResult} />
		default:
			return assertNever(props.route)
	}
}

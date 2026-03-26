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

export function AppRouteContent({ deployment, forkAuction, market, openOracle, reporting, route, securityPool, securityPoolsOverview, securityVault, trading, wrongNetworkMessage }: AppRouteContentProps) {
	if (wrongNetworkMessage !== undefined) {
		return <MainnetGateSection message={wrongNetworkMessage} />
	}

	switch (route) {
		case 'deploy':
			return (
				<>
					{deployment.deploymentSections.map(section => (
						<DeploymentSection key={section.title} title={section.title} steps={section.steps} allSteps={deployment.deploymentStatuses} accountAddress={deployment.accountAddress} isMainnet={deployment.isMainnet} busyStepId={deployment.busyStepId} onDeploy={deployment.onDeploy} />
					))}
				</>
			)
		case 'markets':
			return <MarketSection accountState={market.accountState} deploymentStatuses={market.deploymentStatuses} marketForm={market.marketForm} marketCreating={market.marketCreating} marketResult={market.marketResult} marketError={market.marketError} onMarketFormChange={market.onMarketFormChange} onCreateMarket={market.onCreateMarket} onResetMarket={market.onResetMarket} />
		case 'security-pools':
			return (
				<SecurityPoolSection
					accountState={securityPool.accountState}
					deploymentStatuses={securityPool.deploymentStatuses}
					lastCreatedQuestionId={securityPool.lastCreatedQuestionId}
					marketDetails={securityPool.marketDetails}
					loadingMarketDetails={securityPool.loadingMarketDetails}
					securityPoolCreating={securityPool.securityPoolCreating}
					securityPoolError={securityPool.securityPoolError}
					securityPoolForm={securityPool.securityPoolForm}
					securityPoolResult={securityPool.securityPoolResult}
					onLoadLatestMarket={() => {
						if (securityPool.lastCreatedQuestionId === undefined) return
						securityPool.onSecurityPoolFormChange({ marketId: securityPool.lastCreatedQuestionId })
						void securityPool.onLoadMarketById(securityPool.lastCreatedQuestionId)
					}}
					onLoadMarket={securityPool.onLoadMarket}
					onLoadMarketById={securityPool.onLoadMarketById}
					onSecurityPoolFormChange={securityPool.onSecurityPoolFormChange}
					onCreateSecurityPool={securityPool.onCreateSecurityPool}
				/>
			)
		case 'security-pools-overview':
			return <SecurityPoolsOverviewSection accountState={securityPoolsOverview.accountState} liquidationAmount={securityPoolsOverview.liquidationAmount} liquidationTargetVault={securityPoolsOverview.liquidationTargetVault} loadingSecurityPools={securityPoolsOverview.loadingSecurityPools} onLiquidationAmountChange={securityPoolsOverview.onLiquidationAmountChange} onLiquidationTargetVaultChange={securityPoolsOverview.onLiquidationTargetVaultChange} onLoadSecurityPools={securityPoolsOverview.onLoadSecurityPools} onQueueLiquidation={securityPoolsOverview.onQueueLiquidation} securityPoolOverviewError={securityPoolsOverview.securityPoolOverviewError} securityPoolOverviewResult={securityPoolsOverview.securityPoolOverviewResult} securityPools={securityPoolsOverview.securityPools} />
		case 'security-vaults':
			return <SecurityVaultSection accountState={securityVault.accountState} loadingSecurityVault={securityVault.loadingSecurityVault} onApproveRep={securityVault.onApproveRep} onDepositRep={securityVault.onDepositRep} onLoadSecurityVault={securityVault.onLoadSecurityVault} onRedeemFees={securityVault.onRedeemFees} onRedeemRep={securityVault.onRedeemRep} onSecurityVaultFormChange={securityVault.onSecurityVaultFormChange} onUpdateVaultFees={securityVault.onUpdateVaultFees} securityVaultDetails={securityVault.securityVaultDetails} securityVaultError={securityVault.securityVaultError} securityVaultForm={securityVault.securityVaultForm} securityVaultResult={securityVault.securityVaultResult} />
		case 'open-oracle':
			return <OpenOracleSection accountState={openOracle.accountState} loadingOracleManager={openOracle.loadingOracleManager} onApproveToken1={openOracle.onApproveToken1} onApproveToken2={openOracle.onApproveToken2} onLoadOracleManager={openOracle.onLoadOracleManager} onOpenOracleFormChange={openOracle.onOpenOracleFormChange} onQueueOperation={openOracle.onQueueOperation} onRequestPrice={openOracle.onRequestPrice} onSettleReport={openOracle.onSettleReport} onSubmitInitialReport={openOracle.onSubmitInitialReport} openOracleError={openOracle.openOracleError} openOracleForm={openOracle.openOracleForm} openOracleResult={openOracle.openOracleResult} oracleManagerDetails={openOracle.oracleManagerDetails} />
		case 'reporting':
			return <ReportingSection accountState={reporting.accountState} loadingReportingDetails={reporting.loadingReportingDetails} onLoadReporting={reporting.onLoadReporting} onReportOutcome={reporting.onReportOutcome} onReportingFormChange={reporting.onReportingFormChange} onWithdrawEscalation={reporting.onWithdrawEscalation} reportingDetails={reporting.reportingDetails} reportingError={reporting.reportingError} reportingForm={reporting.reportingForm} reportingResult={reporting.reportingResult} />
		case 'fork-auctions':
			return (
				<ForkAuctionSection
					accountState={forkAuction.accountState}
					forkAuctionDetails={forkAuction.forkAuctionDetails}
					forkAuctionError={forkAuction.forkAuctionError}
					forkAuctionForm={forkAuction.forkAuctionForm}
					forkAuctionResult={forkAuction.forkAuctionResult}
					loadingForkAuctionDetails={forkAuction.loadingForkAuctionDetails}
					onClaimAuctionProceeds={forkAuction.onClaimAuctionProceeds}
					onCreateChildUniverse={forkAuction.onCreateChildUniverse}
					onFinalizeTruthAuction={forkAuction.onFinalizeTruthAuction}
					onForkAuctionFormChange={forkAuction.onForkAuctionFormChange}
					onForkUniverse={forkAuction.onForkUniverse}
					onForkWithOwnEscalation={forkAuction.onForkWithOwnEscalation}
					onInitiateFork={forkAuction.onInitiateFork}
					onLoadForkAuction={forkAuction.onLoadForkAuction}
					onMigrateEscalationDeposits={forkAuction.onMigrateEscalationDeposits}
					onMigrateRepToZoltar={forkAuction.onMigrateRepToZoltar}
					onMigrateVault={forkAuction.onMigrateVault}
					onRefundLosingBids={forkAuction.onRefundLosingBids}
					onStartTruthAuction={forkAuction.onStartTruthAuction}
					onSubmitBid={forkAuction.onSubmitBid}
					onWithdrawBids={forkAuction.onWithdrawBids}
				/>
			)
		case 'trading':
			return <TradingSection accountState={trading.accountState} onCreateCompleteSet={trading.onCreateCompleteSet} onMigrateShares={trading.onMigrateShares} onRedeemCompleteSet={trading.onRedeemCompleteSet} onRedeemShares={trading.onRedeemShares} onTradingFormChange={trading.onTradingFormChange} tradingError={trading.tradingError} tradingForm={trading.tradingForm} tradingResult={trading.tradingResult} />
		default:
			return assertNever(route)
	}
}

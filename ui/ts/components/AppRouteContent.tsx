import { DeploymentRouteContent } from './DeploymentRouteContent.js'
import { MainnetGateSection } from './MainnetGateSection.js'
import { MarketSection } from './MarketSection.js'
import { NotFoundSection } from './NotFoundSection.js'
import { OpenOracleSection } from './OpenOracleSection.js'
import { SecurityPoolsSection } from './SecurityPoolsSection.js'
import { assertNever } from '../lib/assert.js'
import type { AppRouteContentProps } from '../types/components.js'

export function AppRouteContent({ deployment, market, openOracle, route, securityPool, securityPoolWorkflow, securityPoolsOverview, wrongNetworkMessage }: AppRouteContentProps) {
	if (wrongNetworkMessage !== undefined) {
		return <MainnetGateSection message={wrongNetworkMessage} />
	}

	switch (route) {
		case 'deploy': {
			return <DeploymentRouteContent accountAddress={deployment.accountAddress} busyStepId={deployment.busyStepId} deployNextMissingPending={deployment.deployNextMissingPending} deploymentSections={deployment.deploymentSections} deploymentStatuses={deployment.deploymentStatuses} isLoadingDeploymentStatuses={deployment.isLoadingDeploymentStatuses} isMainnet={deployment.isMainnet} onDeploy={deployment.onDeploy} onDeployNextMissing={deployment.onDeployNextMissing} />
		}
		case 'zoltar':
			return (
				<MarketSection
					accountState={market.accountState}
					loadingZoltarForkAccess={market.loadingZoltarForkAccess}
					loadingZoltarQuestionCount={market.loadingZoltarQuestionCount}
					loadingZoltarQuestions={market.loadingZoltarQuestions}
					loadingZoltarUniverse={market.loadingZoltarUniverse}
					marketForm={market.marketForm}
					marketCreating={market.marketCreating}
					marketError={market.marketError}
					marketResult={market.marketResult}
					onApproveZoltarForkRep={market.onApproveZoltarForkRep}
					onCreateMarket={market.onCreateMarket}
					onForkZoltar={market.onForkZoltar}
					onLoadZoltarQuestions={market.onLoadZoltarQuestions}
					onLoadZoltarUniverse={market.onLoadZoltarUniverse}
					onMarketFormChange={market.onMarketFormChange}
					onUseQuestionForFork={market.onUseQuestionForFork}
					onUseQuestionForPool={market.onUseQuestionForPool}
					onZoltarForkQuestionIdChange={market.onZoltarForkQuestionIdChange}
					zoltarForkAllowance={market.zoltarForkAllowance}
					zoltarForkError={market.zoltarForkError}
					zoltarForkPending={market.zoltarForkPending}
					zoltarForkQuestionId={market.zoltarForkQuestionId}
					zoltarForkRepBalance={market.zoltarForkRepBalance}
					zoltarForkResult={market.zoltarForkResult}
					zoltarQuestionCount={market.zoltarQuestionCount}
					zoltarQuestions={market.zoltarQuestions}
					zoltarUniverse={market.zoltarUniverse}
				/>
			)
		case 'security-pools':
			return (
				<SecurityPoolsSection
					createPool={{
						accountState: securityPool.accountState,
						checkingDuplicateOriginPool: securityPool.checkingDuplicateOriginPool,
						duplicateOriginPoolExists: securityPool.duplicateOriginPoolExists,
						lastCreatedQuestionId: securityPool.lastCreatedQuestionId,
						marketDetails: securityPool.marketDetails,
						loadingMarketDetails: securityPool.loadingMarketDetails,
						securityPoolCreating: securityPool.securityPoolCreating,
						securityPoolError: securityPool.securityPoolError,
						securityPoolForm: securityPool.securityPoolForm,
						securityPools: securityPool.securityPools,
						securityPoolResult: securityPool.securityPoolResult,
						onLoadLatestMarket: () => {
							if (securityPool.lastCreatedQuestionId === undefined) return
							securityPool.onSecurityPoolFormChange({ marketId: securityPool.lastCreatedQuestionId })
							void securityPool.onLoadMarketById(securityPool.lastCreatedQuestionId)
						},
						onLoadMarket: securityPool.onLoadMarket,
						onLoadMarketById: securityPool.onLoadMarketById,
						onSecurityPoolFormChange: securityPool.onSecurityPoolFormChange,
						onCreateSecurityPool: securityPool.onCreateSecurityPool,
					}}
					overview={securityPoolsOverview}
					workflow={securityPoolWorkflow}
				/>
			)
		case 'open-oracle':
			return <OpenOracleSection accountState={openOracle.accountState} loadingOracleManager={openOracle.loadingOracleManager} onApproveToken1={openOracle.onApproveToken1} onApproveToken2={openOracle.onApproveToken2} onLoadOracleManager={openOracle.onLoadOracleManager} onOpenOracleFormChange={openOracle.onOpenOracleFormChange} onQueueOperation={openOracle.onQueueOperation} onRequestPrice={openOracle.onRequestPrice} onSettleReport={openOracle.onSettleReport} onSubmitInitialReport={openOracle.onSubmitInitialReport} openOracleError={openOracle.openOracleError} openOracleForm={openOracle.openOracleForm} openOracleResult={openOracle.openOracleResult} oracleManagerDetails={openOracle.oracleManagerDetails} />
		case 'not-found':
			return <NotFoundSection />
		default:
			return assertNever(route)
	}
}

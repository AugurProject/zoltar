import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import { useEffect, useId, useState } from 'preact/hooks'
import type { ComponentChildren, ComponentProps } from 'preact'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js'
import type { ListedSecurityPool, SecurityPoolVaultSummary, SecurityVaultDetails } from '../../../types/contracts.js'
import { getVaultNotLiquidatableReason } from '../lib/liquidation.js'
import { getVaultLiquidationLauncherBlocker } from '../lib/liquidationModalGuards.js'
import { isOracleManagerPriceUsable } from '../lib/securityVault.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { SecurityPoolWorkflowRouteContentProps, ViewTabOption } from '../../types.js'
import type { SelectedVaultView } from '../hooks/useSelectedVaultWorkflowState.js'
import { SecurityPoolVaultDirectory } from './SecurityPoolVaultDirectory.js'
import { SecurityVaultSection } from './SecurityVaultSection.js'
import * as liquidationCopy from '../../../copy/liquidation.js'

type PoolState = ComponentProps<typeof SecurityVaultSection>['poolState']

export function SecurityPoolVaultWorkspace({
	browseEmptyState,
	currentPoolOracleManagerDetails,
	isOnActiveAppChain,
	liquidationEnabled,
	onOpenLiquidationModal,
	onSelectedPoolViewChange,
	poolState,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	securityVault,
	selectedPool,
	selectedVaultDetails,
	selectedVaultExistsOnchain,
	selectedVaultIsOwnedByAccount,
	selectedVaultLoadNotice,
	selectedVaultOwner,
	selectedVaultOwnerInput,
	selectedVaultViewOptions,
	setVaultView,
	vaultView,
	walletAddress,
}: {
	browseEmptyState: ComponentChildren
	currentPoolOracleManagerDetails: ComponentProps<typeof SecurityVaultSection>['oracleManagerDetails']
	isOnActiveAppChain: boolean
	liquidationEnabled: boolean
	onOpenLiquidationModal: SecurityPoolWorkflowRouteContentProps['onOpenLiquidationModal']
	onSelectedPoolViewChange: SecurityPoolWorkflowRouteContentProps['onSelectedPoolViewChange']
	poolState: PoolState
	repPerEthPrice: SecurityPoolWorkflowRouteContentProps['repPerEthPrice']
	repPerEthSource: SecurityPoolWorkflowRouteContentProps['repPerEthSource']
	repPerEthSourceUrl: SecurityPoolWorkflowRouteContentProps['repPerEthSourceUrl']
	securityVault: SecurityPoolWorkflowRouteContentProps['securityVault']
	selectedPool: ListedSecurityPool | undefined
	selectedVaultDetails: SecurityVaultDetails | undefined
	selectedVaultExistsOnchain: boolean
	selectedVaultIsOwnedByAccount: boolean
	selectedVaultLoadNotice: ComponentChildren
	selectedVaultOwner: string
	selectedVaultOwnerInput: string
	selectedVaultViewOptions: ViewTabOption<SelectedVaultView>[]
	setVaultView: (view: SelectedVaultView) => void
	vaultView: SelectedVaultView
	walletAddress: string | undefined
}) {
	const [lookupOwner, setLookupOwner] = useState(selectedVaultOwnerInput)
	useEffect(() => setLookupOwner(selectedVaultOwnerInput), [selectedVaultOwnerInput])
	const chainTimestamp = useChainTimestamp()
	const liquidationReasonIdPrefix = useId()
	// The launchers check the price the protocol guard uses, so a vault that is healthy on-chain is never offered for liquidation.
	const protocolRepPerEthPrice = currentPoolOracleManagerDetails !== undefined && isOracleManagerPriceUsable(currentPoolOracleManagerDetails, chainTimestamp) ? currentPoolOracleManagerDetails.lastPrice : undefined
	const getNotLiquidatableReason = (vault: SecurityPoolVaultSummary | undefined) =>
		vault === undefined ? undefined : getVaultNotLiquidatableReason({ minLiquidationPriceDistanceBps: currentPoolOracleManagerDetails?.minLiquidationPriceDistanceBps, repPerEthPrice: protocolRepPerEthPrice, statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps, targetVaultSummary: vault })
	const isWalletVault = (vaultAddress: string) => walletAddress !== undefined && sameCaseInsensitiveText(walletAddress, vaultAddress)
	const getLiquidationLauncherBlocker = ({ notLiquidatableReason, vaultExistsOnchain, vaultLoaded }: { notLiquidatableReason: string | undefined; vaultExistsOnchain: boolean; vaultLoaded: boolean }) =>
		getVaultLiquidationLauncherBlocker({ hasWallet: walletAddress !== undefined, isOnActiveAppChain, liquidationEnabled, notLiquidatableReason, vaultExistsOnchain, vaultLoaded, wrongNetworkReason: getWrongNetworkReason() })

	const showVaultDetails = vaultView === 'selected-vault' || (vaultView === 'vault-by-address' && selectedVaultOwner !== '' && sameCaseInsensitiveText(lookupOwner.trim(), selectedVaultOwner))
	return (
		<div className='workflow-stack vault-workspace'>
			{selectedVaultLoadNotice}
			{securityVault.securityVaultError === undefined ? undefined : (
				<>
					{!showVaultDetails ? <ErrorNotice message={securityVault.securityVaultError} /> : undefined}
					<button
						type='button'
						className='secondary'
						disabled={securityVault.loadingSecurityVault}
						onClick={() => {
							void securityVault.onLoadSecurityVault()
						}}
					>
						{commonCopy.retry}
					</button>
				</>
			)}

			<div className='vault-workspace-toolbar'>
				<ViewTabs
					ariaLabel={securityPoolCopy.selectedPoolVaultViews}
					className='vault-content-switch'
					semantics='switcher'
					variant='segmented'
					size='compact'
					value={vaultView}
					onChange={nextView => {
						if (nextView === 'selected-vault' && walletAddress !== undefined && !sameCaseInsensitiveText(selectedVaultOwner, walletAddress)) {
							securityVault.onSecurityVaultFormChange({ selectedVaultOwner: walletAddress })
							void securityVault.onLoadSecurityVault(walletAddress)
						}
						setVaultView(nextView)
					}}
					options={selectedVaultViewOptions}
				/>
			</div>
			{vaultView === 'vault-by-address' ? (
				<div className='vault-address-lookup'>
					<LookupFieldRow
						label={securityPoolCopy.selectedVaultOwner}
						value={lookupOwner}
						onInput={setLookupOwner}
						placeholder={commonCopy.hexValuePlaceholder}
						action={
							<button
								className='secondary'
								onClick={() => {
									securityVault.onSecurityVaultFormChange({ selectedVaultOwner: lookupOwner.trim() })
									setVaultView('vault-by-address')
									void securityVault.onLoadSecurityVault(lookupOwner.trim())
								}}
								disabled={securityVault.loadingSecurityVault || lookupOwner.trim() === ''}
							>
								{securityVault.loadingSecurityVault ? <LoadingText announce={false}>{commonCopy.refreshingData}</LoadingText> : workspaceCopy.openVault}
							</button>
						}
					/>
				</div>
			) : undefined}

			{vaultView === 'browse-vaults' ? (
				<div>
					<SecurityPoolVaultDirectory
						emptyState={browseEmptyState}
						pool={selectedPool}
						renderActions={vault => {
							if (selectedPool === undefined) return undefined
							// The connected wallet's own vault can never be liquidated by it, so its row offers no liquidation.
							const ownVault = isWalletVault(vault.vaultAddress)
							const liquidationBlocker = ownVault ? undefined : getLiquidationLauncherBlocker({ notLiquidatableReason: getNotLiquidatableReason(vault), vaultExistsOnchain: true, vaultLoaded: true })
							const liquidationReasonId = `${liquidationReasonIdPrefix}-${vault.vaultAddress}`
							return (
								<>
									<div className='actions'>
										<button
											className='secondary'
											type='button'
											onClick={() => {
												securityVault.onSecurityVaultFormChange({ selectedVaultOwner: vault.vaultAddress.toString() })
												setVaultView(ownVault ? 'selected-vault' : 'vault-by-address')
												void securityVault.onLoadSecurityVault(vault.vaultAddress.toString())
											}}
										>
											{workspaceCopy.openVault}
										</button>
										{ownVault ? undefined : (
											<button aria-describedby={liquidationBlocker === undefined ? undefined : liquidationReasonId} className='secondary' disabled={liquidationBlocker !== undefined} type='button' onClick={() => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress)}>
												{liquidationCopy.liquidateVault}
											</button>
										)}
									</div>
									{liquidationBlocker === undefined ? undefined : <UserMessage className='detail vault-liquidation-reason' id={liquidationReasonId} detail={liquidationBlocker} />}
								</>
							)
						}}
						renderBadge={vault => (selectedVaultOwner !== '' && sameCaseInsensitiveText(selectedVaultOwner, vault.vaultAddress) ? <Badge tone='ok'>{commonCopy.selected}</Badge> : undefined)}
						repPerEthPrice={repPerEthPrice}
						repPerEthSource={repPerEthSource}
						repPerEthSourceUrl={repPerEthSourceUrl}
					/>
				</div>
			) : undefined}
			{showVaultDetails ? (
				<SecurityVaultSection
					{...securityVault}
					compactLayout
					extraReadinessActions={
						// The owned vault never offers liquidation, so its launcher is removed rather than shown disabled.
						selectedVaultIsOwnedByAccount
							? []
							: [
									(() => {
										const blocker = getLiquidationLauncherBlocker({
											notLiquidatableReason: getNotLiquidatableReason(selectedVaultDetails === undefined ? undefined : selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, selectedVaultDetails.vaultAddress))),
											vaultExistsOnchain: selectedVaultExistsOnchain,
											vaultLoaded: selectedVaultDetails !== undefined,
										})
										return {
											actionLabel: liquidationCopy.liquidateVault,
											...(blocker === undefined ? {} : { blocker }),
											description: securityPoolCopy.liquidationWorkflowDescription,
											key: 'liquidate-vault',
											readiness: blocker === undefined ? 'ready' : 'blocked',
											...(selectedPool === undefined || selectedVaultDetails === undefined || selectedVaultOwner === '' || blocker !== undefined ? {} : { onAction: () => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, selectedVaultDetails.vaultAddress) }),
										}
									})(),
								]
					}
					autoLoadVault
					modalFirst
					onViewPriceOracle={() => onSelectedPoolViewChange('price-oracle')}
					onViewStagedOperations={() => onSelectedPoolViewChange('staged-operations')}
					oracleManagerDetails={currentPoolOracleManagerDetails}
					poolState={poolState}
					selectedPoolTotalPoolHeldAttoRep={selectedPool?.totalPoolHeldAttoRep}
					selectedPoolTotalUnderwritingLimitAttoEth={selectedPool?.totalUnderwritingLimitAttoEth}
					selectedMarketTitle={selectedPool?.marketDetails.title}
					showHeader={false}
					showLookupSection={false}
					showSecurityPoolAddressInput={false}
				/>
			) : undefined}
		</div>
	)
}

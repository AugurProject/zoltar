import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren, ComponentProps } from 'preact'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js'
import type { ListedSecurityPool, SecurityVaultDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { SecurityPoolWorkflowRouteContentProps, ViewTabOption } from '../../types.js'
import type { SelectedVaultView } from '../hooks/useSelectedVaultWorkflowState.js'
import { SecurityPoolVaultDirectory } from './SecurityPoolVaultDirectory.js'
import { SecurityVaultSection } from './SecurityVaultSection.js'

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
								{securityVault.loadingSecurityVault ? <LoadingText announce={false}>{securityPoolCopy.refreshing}</LoadingText> : workspaceCopy.openVault}
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
						renderActions={vault =>
							selectedPool === undefined ? undefined : (
								<div className='actions'>
									<button
										className='secondary'
										onClick={() => {
											securityVault.onSecurityVaultFormChange({ selectedVaultOwner: vault.vaultAddress.toString() })
											setVaultView(walletAddress !== undefined && sameCaseInsensitiveText(walletAddress, vault.vaultAddress) ? 'selected-vault' : 'vault-by-address')
											void securityVault.onLoadSecurityVault(vault.vaultAddress.toString())
										}}
									>
										{securityPoolCopy.selectVault}
									</button>
									<details className='vault-more-actions'>
										<summary>{workspaceCopy.moreActions}</summary>
										<button
											className='secondary'
											onClick={() => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress, vault.capacityOwnershipAttoRep)}
											disabled={walletAddress === undefined || !isOnActiveAppChain || !liquidationEnabled}
											title={!isOnActiveAppChain && walletAddress !== undefined ? getWrongNetworkReason() : securityPoolCopy.reviewLiquidation}
										>
											{securityPoolCopy.reviewLiquidation}
										</button>
									</details>
								</div>
							)
						}
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
					extraReadinessActions={[
						(() => {
							const canUseActions = walletAddress !== undefined && selectedVaultIsOwnedByAccount && selectedVaultDetails !== undefined && isOnActiveAppChain
							const blocker = selectedVaultDetails !== undefined && !selectedVaultExistsOnchain ? securityPoolCopy.missingVaultDetail : undefined
							return {
								actionLabel: securityPoolCopy.reviewLiquidation,
								...(blocker === undefined ? {} : { blocker }),
								description: securityPoolCopy.liquidationWorkflowDescription,
								key: 'liquidate-vault',
								readiness: blocker === undefined && liquidationEnabled && canUseActions ? 'ready' : 'blocked',
								...(selectedPool === undefined || selectedVaultDetails === undefined || selectedVaultOwner === '' || !liquidationEnabled || !selectedVaultExistsOnchain || !canUseActions
									? {}
									: { onAction: () => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, selectedVaultDetails.vaultAddress, selectedVaultDetails.capacityOwnershipAttoRep) }),
							}
						})(),
					]}
					autoLoadVault
					modalFirst
					onViewStagedOperations={() => onSelectedPoolViewChange('staged-operations')}
					oracleManagerDetails={currentPoolOracleManagerDetails}
					poolState={poolState}
					selectedPoolTotalPoolHeldAttoRep={selectedPool?.totalPoolHeldAttoRep}
					selectedPoolTotalCapacityOwnershipAttoRep={selectedPool?.totalCapacityOwnershipAttoRep}
					selectedMarketTitle={selectedPool?.marketDetails.title}
					showHeader={false}
					showLookupSection={false}
					showSecurityPoolAddressInput={false}
				/>
			) : undefined}
		</div>
	)
}

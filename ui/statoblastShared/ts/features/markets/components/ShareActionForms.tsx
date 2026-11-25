import * as copy from '../../../copy/trading.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { ActionLauncherCard } from '@zoltar/ui-core-shared/components/ActionLauncherCard.js'
import type { ComponentProps } from 'preact'
import { useId } from 'preact/hooks'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import type { OperationModalProps } from '@zoltar/ui-core-shared/types/components.js'

export type ShareAction = 'mint' | 'redeem-complete-sets' | 'migrate-shares' | 'redeem-shares'
type ShareActions = readonly { value: ShareAction; reason: string | undefined }[]

const labels = {
	mint: copy.mintSets,
	'redeem-complete-sets': copy.redeemSets,
	'migrate-shares': copy.migrateShares,
	'redeem-shares': copy.redeemResolvedShares,
} satisfies Record<ShareAction, string>

const cardCopy = {
	mint: { label: copy.mintCompleteSets, description: copy.completeSetMintDescription },
	'redeem-complete-sets': { label: copy.redeemCompleteSets, description: copy.completeSetBurnDescription },
	'migrate-shares': { label: copy.migrateForkedShares, description: copy.shareMigrationDescription },
	'redeem-shares': { label: copy.redeemResolvedShares, description: copy.resolvedShareRedemptionDescription },
}

export function ShareActionCards({ actions, onSelect, walletBlocksFirst }: { actions: ShareActions; onSelect(action: ShareAction): void; walletBlocksFirst: ComponentProps<typeof ActionLauncherCard>['walletBlocksFirst'] }) {
	return (
		<div className='vault-action-launcher-grid'>
			{actions.map(({ value, reason }) => {
				const { label, description } = cardCopy[value]
				return <ActionLauncherCard key={value} walletBlocksFirst={walletBlocksFirst} action={{ key: value, title: label, actionLabel: label, description, readiness: reason === undefined ? 'ready' : 'blocked', ...(reason === undefined ? { onAction: () => onSelect(value) } : { blocker: reason }) }} />
			})}
		</div>
	)
}

export function ShareActionTabs({ id, actions, selected, onSelect }: { id: string; actions: ShareActions; selected: ShareAction | undefined; onSelect(action: ShareAction): void }) {
	return (
		<>
			<ViewTabs
				ariaLabel={copy.shareActions}
				variant='segmented'
				value={selected ?? 'none'}
				onChange={action => {
					if (action !== 'none') onSelect(action)
				}}
				options={actions.map(({ value, reason }) => ({
					value,
					label: labels[value],
					id: `${id}-${value}-tab`,
					panelId: `${id}-${value}`,
					...(reason === undefined ? {} : { disabled: true, reason, describedById: `${id}-${value}-reason` }),
				}))}
			/>
			{actions.some(action => action.reason !== undefined) && (
				<ul className='statoblast-share-action-reasons'>
					{actions.flatMap(({ value, reason }) =>
						reason === undefined
							? []
							: [
									<li key={value} id={`${id}-${value}-reason`}>
										<strong>{labels[value]}</strong> · {reason}
									</li>,
								],
					)}
				</ul>
			)}
		</>
	)
}

export function ShareActionForm({ inlineId, action, ...form }: OperationModalProps & { inlineId: string | undefined; action: ShareAction }) {
	const descriptionElementId = useId()
	if (inlineId === undefined) return <OperationModal {...form} />
	if (!form.isOpen) return undefined
	const id = `${inlineId}-${action}`
	return (
		<section id={id} role='tabpanel' aria-labelledby={`${id}-tab`} aria-describedby={form.description === undefined ? undefined : descriptionElementId} className='statoblast-share-action-form'>
			<h3>{form.title}</h3>
			{form.description !== undefined && (
				<p id={descriptionElementId} className='detail'>
					{form.description}
				</p>
			)}
			{form.children}
		</section>
	)
}

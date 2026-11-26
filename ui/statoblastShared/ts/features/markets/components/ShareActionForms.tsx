import * as copy from '../../../copy/trading.js'
import type { ComponentChildren } from 'preact'
import { useId } from 'preact/hooks'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'

export type ShareAction = 'mint' | 'redeem-complete-sets' | 'migrate-shares' | 'redeem-shares'
type ShareActions = readonly { value: ShareAction; reason: string | undefined }[]

const labels = {
	mint: copy.mintSets,
	'redeem-complete-sets': copy.redeemSets,
	'migrate-shares': copy.migrateShares,
	'redeem-shares': copy.redeemResolvedShares,
} satisfies Record<ShareAction, string>

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

export function ShareActionForm({ panelId, action, isOpen, description, title, children }: { panelId: string; action: ShareAction; isOpen: boolean; description?: string | undefined; title: string; children: ComponentChildren }) {
	const descriptionElementId = useId()
	if (!isOpen) return undefined
	const id = `${panelId}-${action}`
	return (
		<section id={id} role='tabpanel' aria-labelledby={`${id}-tab`} aria-describedby={description === undefined ? undefined : descriptionElementId} className='statoblast-share-action-form'>
			<h3>{title}</h3>
			{description !== undefined && (
				<p id={descriptionElementId} className='detail'>
					{description}
				</p>
			)}
			{children}
		</section>
	)
}

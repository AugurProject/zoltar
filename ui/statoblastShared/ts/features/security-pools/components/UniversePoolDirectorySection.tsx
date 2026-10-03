import * as universeCopy from '@zoltar/ui-core-shared/copy/universes.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { UniverseOutcomeNavigation } from '@zoltar/ui-zoltar-shared/features/universes/components/UniverseOutcomeNavigation.js'
import { navigateToUniverse } from '@zoltar/ui-core-shared/navigation/universeNavigation.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { getUniversePresentation, type UserMessagePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UniverseBrowser } from '@zoltar/ui-core-shared/components/UniverseBrowser.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type UniversePoolDirectorySectionProps = {
	activeUniverseId: bigint
	zoltarUniverse: ZoltarUniverseSummary | undefined
	universeMissing?: boolean | undefined
	universeError?: string | undefined
	onRetryUniverse?: (() => void) | undefined
	onMigrateRep?: (() => void) | undefined
}

function withoutActionHint(presentation: UserMessagePresentation) {
	const { actionHint, ...remaining } = presentation
	void actionHint
	return remaining
}

/** Universe details require no scan of the pool or vault registries. */
export function UniversePoolDirectorySection({ activeUniverseId, zoltarUniverse, universeMissing = false, universeError, onRetryUniverse, onMigrateRep }: UniversePoolDirectorySectionProps) {
	if (zoltarUniverse === undefined) {
		const presentation = getUniversePresentation(universeMissing ? 'missing' : 'loading')
		const hint =
			presentation === undefined ? undefined : (
				<StateHint
					title={universeMissing ? universeCopy.universeNotFoundTitle : undefined}
					presentation={universeMissing ? { key: 'not_found', badgeLabel: commonCopy.notFound, badgeTone: 'blocked' } : withoutActionHint(presentation)}
					actions={
						universeMissing ? (
							<button type='button' className='secondary' onClick={() => navigateToUniverse(0n)}>
								{commonCopy.goToGenesisUniverse}
							</button>
						) : undefined
					}
				/>
			)
		return universeError === undefined ? hint : <RetryableNotice onRetry={onRetryUniverse} retryLabel={commonCopy.retry} presentation={{ key: 'load_failed', badgeLabel: commonCopy.error, badgeTone: 'blocked', detail: universeError }} />
	}
	return (
		<UniverseBrowser
			actions={
				onMigrateRep !== undefined ? (
					<button className={zoltarUniverse.hasForked ? 'primary' : 'secondary'} type='button' onClick={onMigrateRep}>
						{zoltarUniverse.hasForked ? zoltarCopy.migrateRep : zoltarCopy.previewMigration}
					</button>
				) : undefined
			}
			activeUniverseId={activeUniverseId}
			navigation={zoltarUniverse.relatedUniversesLoaded === false ? <UniverseOutcomeNavigation universe={zoltarUniverse} /> : undefined}
			universe={zoltarUniverse}
		/>
	)
}

import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getZoltarContractAddresses } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import * as copy from '../../../copy/securityPoolPage.js'
import * as poolCopy from '../../../copy/securityPool.js'
import { statoblastPageHref } from '../../../lib/routing.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import { checkStatoblastEntries } from '../../../protocol/statoblastEntries.js'
import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { useStatoblastPageRefresh, type RegisterStatoblastPageRefresh } from '../../useStatoblastPageRefresh.js'
import { SecurityPoolButton, type SecurityPoolActions } from './SecurityPoolControls.js'

type ApprovedQuestion = { id: bigint; title?: string | undefined; registered: boolean; prepared: boolean; reason?: string | undefined }
type FixedQuestions = Extract<SecurityPoolAccountSnapshot['admission'], { mode: 'fixed' }>
type Props = {
	pool: Address
	universeId: bigint
	admission: FixedQuestions
	actions: SecurityPoolActions
	forked: boolean
	enabled: boolean
	environmentKey: number
	paging: boolean
	onPreviousPage: () => void
	onNextPage: () => void
	registerPageRefresh: RegisterStatoblastPageRefresh | undefined
}

async function readApprovedQuestions(pool: Address, universeId: bigint, ids: readonly bigint[]): Promise<ApprovedQuestion[]> {
	if (ids.length === 0) return []
	const client = withStatoblastRequestTimeout(createConnectedReadClient(), copy.savedQuestionReadFailed)
	const block = await client.getBlock()
	if (block.number === undefined) throw new Error(copy.questionLookupBlockUnavailable)
	const entries = await checkStatoblastEntries(
		client,
		ids.map(questionId => ({ pool, questionId, universeId })),
		block.number,
		true,
	)
	const { zoltarQuestionData: address } = getZoltarContractAddresses()
	const abi = ZoltarQuestionData_ZoltarQuestionData.abi
	const details = await readOptionalMulticall(
		client,
		ids.flatMap(id => [
			{ address, abi, functionName: 'questions', args: [id] },
			{ address, abi, functionName: 'getOutcomeLabels', args: [id, 0n, 3n] },
		]),
		block.number,
	)
	return ids.map((id, index) => {
		const status = entries[index]?.status
		const question = details[2 * index]
		const labels = details[2 * index + 1]
		const registered = status === 'question' || status === 'unprepared-question'
		let reason: string | undefined
		if (status !== 'unregistered-question' && !registered) reason = copy.couldNotVerifyQuestion
		if (question?.status !== 'success' || !Array.isArray(question.result) || labels?.status !== 'success' || !Array.isArray(labels.result)) return { id, registered, prepared: status === 'question', reason: copy.couldNotVerifyQuestion }
		const [questionTitle, , , endTime] = question.result
		const title = typeof questionTitle === 'string' && questionTitle !== '' ? questionTitle : undefined
		if (reason === undefined && !registered) {
			if (typeof endTime !== 'bigint' || endTime === 0n) reason = copy.notAQuestion
			else if (endTime <= block.timestamp) reason = copy.questionEnded
			else if (labels.result.length !== 2 || labels.result[0] !== 'Yes' || labels.result[1] !== 'No') reason = poolCopy.questionOutcomeRegistrationRequired
		}
		return { id, title, registered, prepared: status === 'question', reason }
	})
}

export function SecurityPoolApprovedQuestions({ pool, universeId, admission, actions, forked, enabled, environmentKey, paging, onPreviousPage, onNextPage, registerPageRefresh }: Props) {
	const key = `${environmentKey}:${pool}:${universeId}:${admission.questions.join(',')}`
	const [rows, setRows] = useState<{ key: string; value: readonly ApprovedQuestion[] }>()
	const [error, setError] = useState<string>()
	const [pending, setPending] = useState(false)
	const generation = useRef(0)
	const active = useRef(false)
	const reload = async () => {
		if (!enabled || active.current || document.hidden) return
		const id = ++generation.current
		const guard = createActiveEnvironmentGuard()
		const current = () => id === generation.current && guard.isCurrent()
		active.current = true
		setPending(true)
		setError(undefined)
		try {
			const approved = await readApprovedQuestions(pool, universeId, admission.questions)
			if (current()) setRows({ key, value: approved })
		} catch (failure) {
			if (current()) setError(failure instanceof Error ? failure.message : copy.savedQuestionReadFailed)
		} finally {
			if (id === generation.current) {
				active.current = false
				setPending(false)
			}
		}
	}
	useEffect(() => {
		void reload()
		return () => {
			generation.current++
			active.current = false
		}
	}, [key, enabled])
	useBlockRefresh(() => void reload(), enabled)
	useStatoblastPageRefresh(registerPageRefresh, reload)
	const currentRows = rows?.key === key ? rows.value : []
	return (
		<SectionBlock title={copy.approvedQuestionsTitle} description={copy.approvedQuestionsHere(admission.questionCount)}>
			<RetryableNotice message={error} retryLabel={copy.tryAgain} onRetry={() => void reload()} disabled={pending} />
			<table className='statoblast-watchlist-table' role='table'>
				<thead>
					<tr>
						<th scope='col'>{copy.question}</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{admission.questions.map((id, index) => {
						const row = currentRows[index]
						const questionId = formatQuestionIdHex(id)
						const href = statoblastPageHref({ kind: 'question', pool, questionId: id, tab: 'shares' }, universeId)
						return (
							<tr key={questionId} role='row'>
								<td role='cell'>
									{row?.title !== undefined && (row.prepared ? <a href={href}>{row.title}</a> : <strong>{row.title}</strong>)}
									<IdentifierValue value={questionId} abbreviated />
								</td>
								<td role='cell'>
									{row?.registered === true ? (
										<Badge tone='ok'>{copy.questionRegistered}</Badge>
									) : (
										<SecurityPoolButton
											model={actions}
											action='registerSecurityPoolQuestion'
											label={copy.registerQuestion}
											pendingLabel={copy.registeringQuestion}
											reason={forked ? copy.universeForked : row === undefined ? (pending ? copy.checking : copy.couldNotVerifyQuestion) : (row.reason ?? actions.approvedRegistrationReason(id))}
											onClick={async () => {
												await actions.register(id)
												await reload()
											}}
										/>
									)}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
			<PaginationControls hasPreviousPage={admission.questionStart > 0n} hasNextPage={admission.questionStart + 64n < admission.questionCount} loading={paging} onPreviousPage={onPreviousPage} onNextPage={onNextPage} />
			<p className='detail'>{copy.registeringMovesNoFunds}</p>
		</SectionBlock>
	)
}

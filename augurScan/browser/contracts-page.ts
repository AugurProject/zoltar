import type { ContractRecord } from './browser-types.ts'
import { contractDeploymentStatus, contractRegistrySection, type ContractRegistrySection } from './live-update.ts'

export interface ContractsPageDeps {
	readonly lookup: (selector: string) => HTMLElement
	readonly contractItems: readonly ContractRecord[]
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly internalEvidenceLink: (base: string, type: string, value: string | number, label: string) => HTMLAnchorElement
	readonly number: (value: string | number | bigint | null | undefined) => string
	readonly age: (value: string | number | Date | null | undefined) => string
	readonly exactTimestamp: (value: string | number | Date | null | undefined) => string
}

export const renderContractsPage = (deps: ContractsPageDeps) => {
	const { lookup: $, contractItems, element, internalEvidenceLink, number, age, exactTimestamp } = deps
	const pageScrollY = window.scrollY
	const list = $('#contract-list')
	if (contractItems.length === 0) {
		list.replaceChildren(element('div', 'state-placeholder', 'No system contracts are registered for this network.'))
		list.setAttribute('aria-busy', 'false')
		return
	}
	const sectionOrder: readonly ContractRegistrySection[] = ['Protocol contracts', 'System dependencies', 'Discovered contracts']
	const displayedContractItems = [...contractItems].sort((left, right) => sectionOrder.indexOf(contractRegistrySection(left)) - sectionOrder.indexOf(contractRegistrySection(right)))
	const scrollLeft = list.scrollLeft
	const scrollTop = list.scrollTop
	const focusedContractAddress = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.contract-row')?.dataset.contractAddress : undefined
	const focusedAction = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-contract-action]')?.dataset.contractAction : undefined
	const groupScrollPositions = new Map(
		[...list.querySelectorAll<HTMLElement>('.contract-group[data-contract-group]')].flatMap(group => {
			const name = group.dataset.contractGroup
			const rows = group.querySelector<HTMLElement>('.contract-group-rows')
			return name === undefined || rows === null ? [] : [[name, rows.scrollLeft] as const]
		}),
	)
	const existingRows = new Map([...list.querySelectorAll<HTMLElement>('.contract-row[data-contract-address]')].map(row => [row.dataset.contractAddress, row]))
	const groupedRows = new Map<ContractRegistrySection, HTMLElement[]>()
	for (const contract of displayedContractItems) {
		const status = contractDeploymentStatus(contract)
		const addressKey = contract.address.toLowerCase()
		const row = existingRows.get(addressKey) ?? element('article', 'contract-row')
		row.dataset.contractAddress = addressKey
		const head = element('span', 'contract-row-head')
		const deployment = contract.deployment_block ? internalEvidenceLink(contract.explorer_base_url, 'block', contract.deployment_block, `${contract.deployment_block_exact === false ? 'Deployed at or before' : 'Deployed at'} #${number(contract.deployment_block)}`) : element('span', '', status.label)
		deployment.className = `deployment-status ${status.tone}`
		deployment.dataset.contractAction = `${addressKey}:deployment`
		const deploymentDetails = element('span', 'contract-deployment')
		deploymentDetails.append(deployment)
		head.append(element('strong', '', contract.label), deploymentDetails)
		if (contract.deployment_timestamp) {
			const deployed = element('time', 'data-note', `${contract.deployment_block_exact === false ? 'At or before ' : ''}${new Date(contract.deployment_timestamp).toLocaleDateString('en-GB')} · ${age(contract.deployment_timestamp)}`)
			deployed.dateTime = exactTimestamp(contract.deployment_timestamp)
			deployed.title = exactTimestamp(contract.deployment_timestamp)
			deploymentDetails.append(deployed)
		}
		const address = internalEvidenceLink(contract.explorer_base_url, 'address', contract.address, contract.address)
		address.className = 'contract-address-link'
		address.dataset.contractAction = `${addressKey}:address`
		row.replaceChildren(head, address)
		const section = contractRegistrySection(contract)
		const rows = groupedRows.get(section) ?? []
		rows.push(row)
		groupedRows.set(section, rows)
	}
	const sections = sectionOrder.flatMap(sectionName => {
		const rows = groupedRows.get(sectionName)
		if (rows === undefined || rows.length === 0) return []
		const section = element('section', 'contract-group')
		section.dataset.contractGroup = sectionName
		const rowList = element('div', 'contract-group-rows')
		rowList.append(...rows)
		section.append(rowList)
		return [section]
	})
	list.replaceChildren(...sections)
	for (const section of list.querySelectorAll<HTMLElement>('.contract-group[data-contract-group]')) {
		const name = section.dataset.contractGroup
		const rows = section.querySelector<HTMLElement>('.contract-group-rows')
		if (name !== undefined && rows !== null) rows.scrollLeft = groupScrollPositions.get(name) ?? 0
	}
	list.scrollLeft = scrollLeft
	list.scrollTop = scrollTop
	window.scrollTo({ top: pageScrollY, behavior: 'instant' })
	if (focusedAction !== undefined) document.querySelector<HTMLElement>(`[data-contract-action="${focusedAction}"]`)?.focus({ preventScroll: true })
	else if (focusedContractAddress !== undefined) list.querySelector<HTMLElement>(`[data-contract-address="${focusedContractAddress}"]`)?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true })
	list.setAttribute('aria-busy', 'false')
}

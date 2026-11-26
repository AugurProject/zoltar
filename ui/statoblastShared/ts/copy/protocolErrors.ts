export const claimErrors = {
	blockUnavailable: 'Could not confirm the block for this claim. Refresh and retry.',
	blockChanged: 'Claim block changed repeatedly. Refresh and retry.',
	blockUnverified: 'Claim block could not be verified.',
}

export const deploymentErrors = {
	contractAddressMissing: 'Could not verify a required address for deployment.',
	contractCodeInvalid: 'The deployment code does not match the expected contract.',
	libraryLayoutMissing: 'Could not prepare the code for deployment.',
	statusCheckMissing: 'Could not prepare the deployment status check.',
}

export const reviewErrors = {
	transactionFailed: 'Transaction failed.',
	fundingFailed: 'Funding failed. Remaining transactions were not sent.',
	fundingSelection: 'Choose a funding step that is still needed.',
	reviewNotReady: 'Open the transaction review and try again.',
	walletChanged: 'The wallet changed. Review the action again.',
	networkChanged: 'The network changed. Review the action again.',
	fundingEstimate: 'Could not calculate report funding amounts. Retry before sending any transactions.',
	reportingDeposit: 'Couldn’t review this reporting deposit.',
	tokenApproval: 'Cannot review this token approval.',
	tokenDetails: 'Could not read token details for approval. Retry before sending any transactions.',
	planMissing: 'Could not prepare the transaction. Review the action again.',
	deploymentMissing: 'The signed deployment is missing.',
	preparedChanged: 'The prepared transaction changed.',
	planChanged: 'The transaction plan changed. No further transactions were sent. Review the action again.',
	approvalChanged: 'The approval amount changed. Review the action again.',
	approvalSelection: 'Invalid token approval selection.',
	fundingChanged: 'Funding requirements changed. Review balances and approvals again before sending.',
	planStarted: 'Cannot change a transaction plan after it has started.',
	fundingMissing: 'Could not prepare the funding step. Review the action again.',
}

export const oracleErrors = {
	tokenDetails: 'Could not read the token details.',
	blockResponse: 'Unexpected block response',
	reportSummary: 'Could not read the report summary.',
	baseBalance: 'Insufficient base token balance to fund the report.',
	quoteBalance: 'Insufficient quote token balance to fund the report.',
	rewardAndFundingBalance: 'Insufficient ETH for report funding and the settler reward. Gas is additional.',
	rewardBalance: 'Insufficient ETH for the settler reward. Gas is additional.',
	receiptUnverified: 'Could not verify the report in the transaction receipt.',
	withdrawalWallet: 'Connect a wallet to check the balance before withdrawing.',
	withdrawalChanged: 'The withdrawable balance changed. Review the withdrawal again.',
	reportStateUnavailable: 'Could not read the report state needed to settle it.',
	settlementWallet: 'Connect a wallet to check the report before settling it.',
	settlementChanged: 'This report changed onchain. Review the latest settlement state again.',
	settlementNotReady: 'This report is not ready to settle. Refresh its settlement time.',
	disputeChanged: 'This report changed onchain while the dispute was being prepared. Retry to use the latest state.',
	swapDirection: 'The dispute price direction does not match the selected swap token.',
	disputeClock: 'Could not check whether disputes are open. Try again before sending.',
}

export const questionErrors = {
	idMismatch: 'The registered question does not match this ID.',
	poolMissing: 'Question has no security pool.',
}

export const shareErrors = {
	invalidRecoveryAmount: 'Enter a valid amount of REP for recovery.',
	recoveryFundsUnavailable: 'Recovery REP funding is unavailable.',
	mintCapacityBlock: 'Mint capacity requires a mined block.',
	balancesResponse: 'Could not read the share balances.',
	mintPoolUnverified: 'Could not verify how this market’s security pool was created.',
	feeQuote: 'Could not read the collateral fee quote.',
	mintingClosed: 'Minting closed when the question ended.',
	purchaseQuote: 'Could not read the REP purchase quote.',
	mintBalance: 'Insufficient collateral for minting and purchase fees.',
	recoveryQuoteChanged: 'Recovery REP quote changed. Review the amount again.',
	mintReviewBlock: 'Mint review requires a mined block.',
}

export const reportErrors = {
	reportingChanged: 'Reporting changed. Review the question again.',
	reportAmountChanged: 'The report amount changed. Review the report again.',
	reportingNotOpen: 'Reporting opens when the question ends.',
	depositOutcome: 'The recorded deposit has a different outcome.',
	repeatedDeposit: 'The deposit history repeats an entry.',
	incompleteHistory: 'The parent question did not return the full deposit history.',
	unverifiedHistory: 'Couldn’t verify the parent question’s deposit history.',
	savingDepositTimedOut: 'Saving the report deposit timed out.',
	inheritedDepositsUnverified: 'Couldn’t verify the inherited deposits.',
	depositOrder: 'Couldn’t verify the order of recorded deposits.',
	invalidSavedDeposit: 'A saved parent deposit record is invalid.',
	missingClaimedDeposit: 'A claimed deposit is missing from the deposit history.',
	claimedDepositsUnverified: 'Couldn’t verify which inherited deposits have already been claimed.',
	searchBlock: 'Deposit search requires a confirmed block.',
	searchChainChanged: 'The chain changed during the deposit search. Retry this page.',
}

export const poolErrors = {
	deploymentCode: 'Could not verify the deployment code.',
	poolUnverified: 'Could not verify how this security pool was created.',
	setupBlock: 'Security pool setup requires a mined block.',
	protocolMismatch: 'Security pool uses unrecognized protocol contracts.',
	auctionContractMismatch: 'Could not verify the auction setup contract for this security pool.',
	setupStage: 'Invalid security pool setup stage.',
	setupChanged: 'Security pool setup changed. Refresh and retry.',
	poolChanged: 'Chain changed while reading the security pool. Refresh and try again.',
	poolServicesMismatch: 'The capital contract is linked to a different pool operations contract.',
	poolForkMismatch: 'The capital contract is linked to a different fork contract.',
	modulesMismatch: 'The security pool is linked to contracts from another universe or protocol.',
	poolReadBlock: 'Security pool snapshot requires a mined block.',
	approvedQuestionCount: 'Invalid approved question count.',
	approvedQuestionPage: 'Invalid approved question page.',
	approvedQuestionId: 'Invalid approved question ID.',
	selectApprovedQuestion: 'Choose at least one approved question.',
	approvedQuestionOrder: 'Choose increasing unique question IDs.',
}

export const priceErrors = {
	feedMismatch: 'Could not verify the price feed for this pool.',
	validReportId: 'Enter a valid report ID for this price feed.',
	reportNotFromFeed: 'This report does not belong to this price feed.',
	reportReadMismatch: 'Could not verify the report and its funding for this price feed.',
	reportStateChanged: 'Report state changed. Refresh and retry.',
	reportFundingMismatch: 'Could not verify the funding address for this price feed.',
	branchPriceUnavailable: 'Branch price feed is unavailable.',
}

export const auctionErrors = {
	auctionNotVerified: 'Could not verify the auction for this pool.',
	auctionChanged: 'The auction changed. Refresh and retry.',
	positionCode: 'Could not verify the auction position contract.',
	positionAddress: 'The auction position address does not match the selected bid.',
	positionPool: 'Could not verify the pool for this auction position.',
	positionVersion: 'The auction position uses unexpected contract code.',
	positionNotFromPool: 'Auction position does not belong to the selected security pool and bidder.',
	closingStatus: 'Could not check whether the auction has closed.',
	fillMismatch: 'The winning bid does not match this auction position.',
	positionMismatch: 'Could not verify the auction position.',
	collateralContractMismatch: 'The address holding auction collateral does not match this pool.',
}

export const forkErrors = {
	forkChanged: 'The fork state changed. Refresh and retry.',
	questionUnregistered: 'Question is not registered in this security pool.',
	collateralRecovery: 'Could not verify how much collateral can be recovered.',
}

export const entryErrors = {
	poolUnavailable: 'Could not check the pool address.',
	poolVerification: 'Could not verify this security pool.',
	questionVerification: 'Could not verify this question.',
	noVerification: 'Could not verify the page address.',
}

export const pageErrors = {
	incompletePage: 'Saved page is incomplete.',
	invalidPageRead: 'The saved page could not be refreshed.',
}

export const watchlistErrors = {
	refreshBlock: 'Watchlist refresh requires a mined block.',
	invalidFile: 'Not a Statoblast watchlist file.',
	wrongNetwork: 'This file is for another network.',
	importBlock: 'Watchlist import requires a mined block.',
	importNetworkChanged: 'The network changed during watchlist import. Try again.',
	importChainChanged: 'The chain changed during watchlist import. Try again.',
}

export const unexpectedResponse = (label: string) => `Unexpected ${label} response`
export const contractCodeUnverified = (label: string) => `Could not verify the ${label} code.`
export const contractSettingsMismatch = (label: string) => `The ${label} has unexpected settings.`
export const contractLinkMismatch = (label: string) => `The ${label} is linked to a different contract.`
export const reportMissingStoredState = (id: bigint) => `OpenOracle report #${id} is unavailable: it was created without stored state.`
export const reportStateMismatch = (id: bigint) => `OpenOracle report #${id} stored state does not match its onchain state hash. Retry to load the latest state.`
export const safeIntegerRangeExceeded = (label: string) => `${label} exceeds the maximum safe integer range`

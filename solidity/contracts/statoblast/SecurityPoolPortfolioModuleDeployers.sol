// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolCapitalFeeStreams } from './SecurityPoolCapitalFeeStreams.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { SecurityPoolCreationCodeDeployer } from './SecurityPoolCreationCode.sol';

/// @dev Creation code is separated so every deployment helper fits EIP-170.
/// Each returned instance binds its immutable authority to the supplied portfolio.
contract SecurityPoolCapitalLedgerDeployer is SecurityPoolCreationCodeDeployer {
	constructor() SecurityPoolCreationCodeDeployer(type(SecurityPoolCapitalLedger).creationCode) {}

	function create(address authority, Zoltar zoltar, uint248 universeId, uint256 multiplier, uint256 minimumCommitment, uint256 minimumReserve, uint48 vestingDuration) external returns (SecurityPoolCapitalLedger) {
		return
			SecurityPoolCapitalLedger(_deploy(abi.encode(authority, zoltar, universeId, multiplier, minimumCommitment, minimumReserve, vestingDuration)));
	}
}
contract SecurityPoolCommitmentIndexDeployer {
	function create(address authority) external returns (SecurityPoolCommitmentIndex) {
		return new SecurityPoolCommitmentIndex(authority);
	}
}
contract SecurityPoolCapitalFeeStreamsDeployer {
	function create(address authority, uint48 timestamp, uint48 vestingDuration) external returns (SecurityPoolCapitalFeeStreams) {
		return new SecurityPoolCapitalFeeStreams(authority, timestamp, vestingDuration);
	}
}
contract SecurityPoolSettlementBookDeployer {
	function create(address authority, uint256 minimumOutcomeRate) external returns (SecurityPoolSettlementBook) {
		return new SecurityPoolSettlementBook(authority, minimumOutcomeRate);
	}
}
contract SecurityPoolPortfolioSettlementDeployer {
	function create(address authority) external returns (SecurityPoolPortfolioSettlement) {
		return new SecurityPoolPortfolioSettlement(authority);
	}
}
contract SecurityPoolReporterLedgerDeployer {
	function create(address authority, Zoltar zoltar) external returns (SecurityPoolReporterLedger) {
		return new SecurityPoolReporterLedger(authority, zoltar);
	}
}

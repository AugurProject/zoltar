// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolBoundClones } from './SecurityPoolBoundClones.sol';
import { SecurityPoolCapitalLifecycleDelegate } from './SecurityPoolCapitalLifecycleDelegate.sol';
import { SecurityPoolCapitalRepairAuctionDelegate } from './SecurityPoolCapitalRepairAuctionDelegate.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolCapitalFeeStreams } from './SecurityPoolCapitalFeeStreams.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolSettlement } from './SecurityPoolSettlement.sol';
import { SecurityPoolServices } from './SecurityPoolServices.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { SecurityPoolCreationCodeDeployer } from './SecurityPoolCreationCode.sol';

/// @dev Creation code is separated so every deployment helper fits EIP-170.
/// Each returned instance binds its immutable authority to the supplied security pool.
contract SecurityPoolCapitalLedgerDeployer is SecurityPoolCreationCodeDeployer {
	SecurityPoolCapitalLifecycleDelegate
		public
		immutable lifecycleDelegate = new SecurityPoolCapitalLifecycleDelegate();
	constructor() SecurityPoolCreationCodeDeployer(type(SecurityPoolCapitalLedger).creationCode) {}

	function createImplementation(Zoltar zoltar, uint256 multiplier, uint256 minimumCommitment, SecurityPoolCapitalFeeStreamsDeployer modules) external returns (SecurityPoolCapitalLedger) {
		return
			SecurityPoolCapitalLedger(_deploy(abi.encode(msg.sender, zoltar, multiplier, minimumCommitment, lifecycleDelegate, modules.repairAuctionDelegate())));
	}

	function create(SecurityPoolCapitalLedger implementation, uint248 universeId) external returns (SecurityPoolCapitalLedger capital) {
		require(implementation.securityPool() == msg.sender, 'Only capital security pool');
		address rep = address(implementation.zoltar().getRepToken(universeId));
		require(rep != address(0), 'Capital REP unavailable');
		capital = SecurityPoolCapitalLedger(SecurityPoolBoundClones.create(address(implementation), abi.encodePacked(universeId, rep)));
	}
}
contract SecurityPoolCommitmentIndexDeployer {
	SecurityPoolCommitmentIndex public immutable implementation = new SecurityPoolCommitmentIndex();

	function create(address authority) external returns (SecurityPoolCommitmentIndex index) {
		index = SecurityPoolCommitmentIndex(SecurityPoolBoundClones.create(address(implementation), abi.encodePacked(authority)));
		index.initialize();
	}
}
contract SecurityPoolCapitalFeeStreamsDeployer {
	SecurityPoolCapitalRepairAuctionDelegate
		public
		immutable repairAuctionDelegate = new SecurityPoolCapitalRepairAuctionDelegate();
	SecurityPoolCapitalFeeStreams public immutable implementation = new SecurityPoolCapitalFeeStreams();

	function create(address authority, uint48 timestamp, uint48 vestingDuration) external returns (SecurityPoolCapitalFeeStreams streams) {
		streams = SecurityPoolCapitalFeeStreams(SecurityPoolBoundClones.create(address(implementation), abi.encodePacked(authority)));
		streams.initialize(timestamp, vestingDuration);
	}
}
contract SecurityPoolSettlementBookDeployer is SecurityPoolCreationCodeDeployer {
	/// @dev Daily bucket numbers below the fee-end ceiling fit in 17 bits.
	uint48 public constant FEE_END_GRANULARITY = 1 days;
	constructor() SecurityPoolCreationCodeDeployer(type(SecurityPoolSettlementBook).creationCode) {}
	function create(address authority, uint256 minimumOutcomeRate) external returns (SecurityPoolSettlementBook) {
		return SecurityPoolSettlementBook(_deploy(abi.encode(authority, minimumOutcomeRate, FEE_END_GRANULARITY)));
	}
}
contract SecurityPoolSettlementDeployer {
	function create(address authority) external returns (SecurityPoolSettlement) {
		return new SecurityPoolSettlement(authority, ICollateralConfig(authority).collateralToken());
	}
}
contract SecurityPoolServicesDeployer is SecurityPoolCreationCodeDeployer {
	constructor() SecurityPoolCreationCodeDeployer(type(SecurityPoolServices).creationCode) {}
	function create(address authority) external returns (SecurityPoolServices) {
		return SecurityPoolServices(payable(_deploy(abi.encode(authority))));
	}
}
contract SecurityPoolReporterLedgerDeployer {
	function create(address authority, Zoltar zoltar) external returns (SecurityPoolReporterLedger) {
		return new SecurityPoolReporterLedger(authority, zoltar);
	}
}

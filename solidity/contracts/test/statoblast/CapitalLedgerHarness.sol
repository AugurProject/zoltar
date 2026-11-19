// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCapitalLedger } from '../../statoblast/SecurityPoolCapitalLedger.sol';
import { SecurityPoolCapitalState } from '../../statoblast/SecurityPoolCapitalState.sol';
import {
	SecurityPoolCapitalLedgerDeployer,
	SecurityPoolCommitmentIndexDeployer,
	SecurityPoolCapitalFeeStreamsDeployer
} from '../../statoblast/SecurityPoolPortfolioModuleDeployers.sol';
import { ICapitalFeeStreams } from '../../statoblast/interfaces/ICapitalAccounting.sol';
import { SecurityPoolCommitmentIndex } from '../../statoblast/SecurityPoolCommitmentIndex.sol';
import { WETH9 } from '../../statoblast/WETH9.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { Zoltar } from '../../Zoltar.sol';

contract CapitalLedgerZoltarMock {
	ReputationToken public immutable token;
	uint256 public forkTime;
	constructor() {
		token = new ReputationToken(address(this));
		token.initialize(1, 11_000_000e18, 1);
	}
	function getRepToken(uint248) external view returns (ReputationToken) {
		return token;
	}
	function getForkTime(uint248) external view returns (uint256) {
		return forkTime;
	}
	function getForkChoiceDeadline(uint248) external view returns (uint256) {
		return forkTime == 0 ? 0 : forkTime + 8 weeks;
	}
	function mint(address owner, uint256 amount) external {
		token.mint(owner, amount);
	}
	function burnRep(uint248, uint256 amount) external {
		token.burn(msg.sender, amount);
	}
	function setFork(uint256 timestamp) external {
		forkTime = timestamp;
	}
}

contract CapitalLedgerTestComponents {
	SecurityPoolCapitalLedgerDeployer public immutable capitalDeployer;
	SecurityPoolCapitalFeeStreamsDeployer
		public
		immutable streamsDeployer = new SecurityPoolCapitalFeeStreamsDeployer();
	SecurityPoolCommitmentIndexDeployer private immutable indexDeployer = new SecurityPoolCommitmentIndexDeployer();
	constructor(SecurityPoolCapitalLedgerDeployer deployer) {
		capitalDeployer = deployer;
	}
	function createIndex(address authority) external returns (SecurityPoolCommitmentIndex) {
		return indexDeployer.create(authority);
	}
	function createStreams(address authority, uint48 duration) external returns (ICapitalFeeStreams) {
		return ICapitalFeeStreams(address(streamsDeployer.create(authority, uint48(block.timestamp), duration)));
	}
}

contract CapitalLedgerHarness {
	WETH9 public collateralToken;
	uint256 public targetPriceErrorForDispute;
	uint256 public acceptedEpoch;
	// Synthetic observations are already confirmed by the harness.
	uint48 public constant settlementTime = 0;
	SecurityPoolCapitalLedger public immutable ledger;
	CapitalLedgerZoltarMock public immutable zoltar;
	ReputationToken public immutable token;
	constructor(CapitalLedgerTestComponents components) {
		collateralToken = new WETH9();
		zoltar = new CapitalLedgerZoltarMock();
		token = zoltar.token();
		SecurityPoolCapitalLedgerDeployer deployer = components.capitalDeployer();
		SecurityPoolCapitalLedger implementation = deployer.createImplementation(Zoltar(address(zoltar)), 10_500, 1e15, components.streamsDeployer());
		ledger = deployer.create(implementation, 1);
		ledger.initialize(components.createIndex(address(ledger)), components.createStreams(address(ledger), 1 days), address(0), address(0));
	}
	function mint(address owner, uint256 amount) external {
		zoltar.mint(owner, amount);
	}
	function checkpointCapitalFees(uint248, uint48) external {}
	function priceFeed(uint248) external view returns (address) {
		return address(this);
	}
	function validateExposure() external pure {}
	function setPriceError(uint256 priceError) external {
		targetPriceErrorForDispute = priceError;
	}
	function forkController() external pure returns (address) {
		return address(0);
	}
	function setPrice(uint256 price, uint48 until) external {
		++acceptedEpoch;
		ledger.acceptPrice(price, until);
	}
	function checkpointAndSetPrices(uint256 first, uint256 second, uint48 until) external {
		ledger.checkpoint();
		++acceptedEpoch;
		ledger.acceptPrice(first, until);
		++acceptedEpoch;
		ledger.acceptPrice(second, until);
	}
	function setDemand(uint256 demand) external {
		ledger.setDemand(demand);
	}
	function fundFees() external payable {
		collateralToken.deposit{value: msg.value}();
		collateralToken.approve(address(ledger), msg.value);
		ledger.fundVestedFees(msg.value, 0);
	}
	function fundRepFees(uint256 amount) external {
		zoltar.mint(address(this), amount);
		token.approve(address(ledger), amount);
		ledger.fundVestedFees(0, amount);
	}
	function setFork(uint256 timestamp) external {
		zoltar.setFork(timestamp);
		ledger.freeze();
	}
	function beginImport() external {
		ledger.beginForkImport();
	}
	function exportChoice(address owner) external {
		ledger.exportChoice(owner);
	}
	function releaseForkBacking() external {
		ledger.releaseForkBacking();
	}
	function importChoice(address owner, SecurityPoolCapitalLedger.ChoicePosition calldata position, uint256 target) external {
		ledger.importChoice(owner, position, target);
	}
	function finishImport(uint256 demand) external {
		ledger.finishForkImport(demand);
	}
	/// @dev Populate the production import path, including custody.
	/// Profiles exercise clustered keys and alternating healthy/unhealthy owners.
	function importChoices(uint256 start, uint256 count, bool alternating) external {
		uint256 principal;
		for (uint256 i = start; i < start + count; i++) {
			uint256 baseRep = 42 ether;
			if (alternating) baseRep = i % 2 == 0 ? 21 ether : 84 ether;
			uint256 rep = baseRep + i * 1e12;
			uint96 batch = uint96(i % 3);
			ledger.importChoice(address(uint160(0x1000 + i)), SecurityPoolCapitalState.ChoicePosition(rep, 20 ether, batch, batch == 0 ? 0 : 10 ether), 10_000);
			principal += rep;
		}
		zoltar.mint(address(ledger), principal);
	}
	receive() external payable {}
}

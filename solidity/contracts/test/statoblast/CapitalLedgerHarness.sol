// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCapitalLedger } from '../../statoblast/SecurityPoolCapitalLedger.sol';
import { ICapitalFeeStreams } from '../../statoblast/interfaces/ICapitalAccounting.sol';
import { SecurityPoolCommitmentIndex } from '../../statoblast/SecurityPoolCommitmentIndex.sol';
import { SecurityPoolCapitalFeeStreams } from '../../statoblast/SecurityPoolCapitalFeeStreams.sol';
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
	function createIndex(address authority) external returns (SecurityPoolCommitmentIndex) {
		return new SecurityPoolCommitmentIndex(authority);
	}
	function createStreams(address authority) external returns (ICapitalFeeStreams) {
		return
			ICapitalFeeStreams(address(new SecurityPoolCapitalFeeStreams(authority, uint48(block.timestamp), 1 days)));
	}
}

contract CapitalLedgerHarness {
	SecurityPoolCapitalLedger public immutable ledger;
	CapitalLedgerZoltarMock public immutable zoltar;
	ReputationToken public immutable token;
	constructor(CapitalLedgerTestComponents components) {
		zoltar = new CapitalLedgerZoltarMock();
		token = zoltar.token();
		ledger = new SecurityPoolCapitalLedger(address(this), Zoltar(address(zoltar)), 1, 10_500, 1e15, 1e14, 1 days);
		ledger.initialize(components.createIndex(address(ledger)), components.createStreams(address(ledger)), address(0));
	}
	function mint(address owner, uint256 amount) external {
		zoltar.mint(owner, amount);
	}
	function checkpointCapitalFees(uint248, uint48) external {}
	function priceFeed(uint248) external view returns (address) {
		return address(this);
	}
	function validateExposure() external pure {}
	function forkController() external pure returns (address) {
		return address(0);
	}
	function setPrice(uint256 price, uint48 until) external {
		ledger.acceptPrice(price, until);
	}
	function cureAndSetPrices(uint96 id, uint256 first, uint256 second, uint48 until) external {
		ledger.cure(id);
		ledger.acceptPrice(first, until);
		ledger.acceptPrice(second, until);
	}
	function setDemand(uint256 demand) external {
		ledger.setDemand(demand);
	}
	function fundFees() external payable {
		ledger.fundVestedFees{value: msg.value}(0);
	}
	function fundRepFees(uint256 amount) external {
		zoltar.mint(address(this), amount);
		token.approve(address(ledger), amount);
		ledger.fundVestedFees(amount);
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
	function importChoice(address owner, SecurityPoolCapitalLedger.ChoicePosition calldata position, uint256 target) external payable {
		ledger.importChoice{value: msg.value}(owner, position, target);
	}
	function importAuction(address owner, uint256 rep, uint256 commitment, uint256 target) external payable {
		ledger.importAuctionPosition{value: msg.value}(owner, rep, commitment, target);
	}
	function finishImport(uint256 demand) external {
		ledger.finishForkImport(demand);
	}
	receive() external payable {}
}

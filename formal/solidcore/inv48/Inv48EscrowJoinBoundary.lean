import Inv48EscrowJoin
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowJoin
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

/-- Successful argument encoding suffices at the open request boundary. No REP
    response, call success, decoded Boolean, or normal epilogue is assumed. -/
theorem prefixIntoTransferOnEncoding (n m : Nat) (t : FunctionTable) (c : Context)
    (r ready encodedRuntime : Runtime) (encodedValue : Value) (payer amount sponsor oracle collateral rep gas old : Nat)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (O : r.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : r.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (E : r.lookupLocal? "escrow" = some (.word old))
    (hp : payer < 2^160) (ha : amount < 2^256) (hr : rep < 2^256)
    (notConstruction : c.construction = false)
    (trace encodingTrace : Interaction.Transcript)
    (prelude : ExecutesOK (Stmt.evalList (n+3) t c r prefixStatements) trace (.normal ready))
    (encoding : ExecutesOK (Expr.eval c ready EscrowTrace.calldataExpr)
      encodingTrace (encodedValue,encodedRuntime)) :
    ∃ (bytes : List Byte) (response : CreateResponse) (pullTrace : Interaction.Transcript),
      trace = [⟨.external (snapshotWorld c r.state)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)), response⟩] ++ pullTrace ∧
      (decodeCreateResponse response "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      ready.lookupLocal? "payer" = some (.word payer) ∧
      ready.lookupLocal? "repAmount" = some (.word amount) ∧
      ready.lookupLocal? "escrow" = some (.word (u256ToWord response.address)) ∧
      u256ToWord response.address < 2^160 ∧
      Stmt.eval (m+2) t c ready EscrowTrace.transferStmt =
        (selfDispatchCall c ready.state .call rep
          (EscrowTrace.calldata payer (u256ToWord response.address) amount) 0 none >>=
          EscrowTrace.transferReply (m+1) t c ready) := by
  obtain ⟨bytes,response,pullTrace,joined,success,payerLocal,amountLocal,escrowLocal,repLocal⟩ :=
    prefixOriginalLocals n t c r ready payer amount sponsor oracle collateral rep gas old
      P A S O C R G E trace prelude
  have canonical := norm_u256ToWord response.address
  have addressBound := transferEncodingSuccessful c ready payer
    (u256ToWord response.address) amount payerLocal escrowLocal amountLocal
    ha canonical hp encodedValue encodedRuntime encodingTrace encoding
  exact ⟨bytes,response,pullTrace,joined,success,payerLocal,amountLocal,escrowLocal,addressBound,
    EscrowTrace.transferTree m t c ready rep payer (u256ToWord response.address) amount
      payerLocal escrowLocal amountLocal repLocal hp addressBound ha hr notConstruction⟩

#print axioms prefixIntoTransferOnEncoding
end Inv48.EscrowJoin

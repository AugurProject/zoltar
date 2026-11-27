import Inv48EscrowJoin
import Inv48EscrowJoinShape
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowJoin
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

theorem generatedConsecutivePrefix : (EscrowTrace.actualStatements.drop 4).take 3 = prefixStatements := by
  apply List.ext_getElem?
  intro i
  match i with
  | 0 => simpa [prefixStatements] using actualCreation
  | 1 => simpa [prefixStatements] using actualPullBlock
  | 2 => simpa [prefixStatements] using actualBooleanDeclaration
  | i+3 => simp [List.getElem?_take,show ¬ i+3 < 3 by omega,prefixStatements]

theorem generatedConsecutiveTransfer : (EscrowTrace.actualStatements.drop 4).take 4 =
    prefixStatements ++ [EscrowTrace.transferStmt] := by
  apply List.ext_getElem?
  intro i
  match i with
  | 0 => simpa [prefixStatements] using actualCreation
  | 1 => simpa [prefixStatements] using actualPullBlock
  | 2 => simpa [prefixStatements] using actualBooleanDeclaration
  | 3 => simpa [prefixStatements] using EscrowTrace.actualTransfer
  | i+4 => simp [List.getElem?_take,show ¬ i+4 < 4 by omega,prefixStatements]

/-- The composed proof applies to consecutive indexed statements of the fresh
    public executable model, with its actual function table. -/
theorem generatedPrefixOriginalLocals (n : Nat) (c : Context) (r final : Runtime)
    (payer amount sponsor oracle collateral rep gas old : Nat)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (O : r.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : r.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (E : r.lookupLocal? "escrow" = some (.word old))
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList (n+3) Inv48.Source.model.core.table c r
      ((EscrowTrace.actualStatements.drop 4).take 3)) trace (.normal final)) :
    ∃ (bytes : List Byte) (response : CreateResponse) (pullTrace : Interaction.Transcript),
      trace = [⟨.external (snapshotWorld c r.state)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)), response⟩] ++ pullTrace ∧
      (decodeCreateResponse response "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      final.lookupLocal? "payer" = some (.word payer) ∧
      final.lookupLocal? "repAmount" = some (.word amount) ∧
      final.lookupLocal? "escrow" = some (.word (u256ToWord response.address)) ∧
      final.lookupLocal? "rep" = some (.word rep) := by
  rw [generatedConsecutivePrefix] at run
  exact prefixOriginalLocals n _ c r final payer amount sponsor oracle collateral rep gas old
    P A S O C R G E trace run

/-- One execution premise for the complete consecutive generated segment.
    There are no assumed post-create/pre-transfer live locals or pure callees. -/
theorem generatedIntoTransfer (n : Nat) (c : Context) (r final : Runtime)
    (payer amount sponsor oracle collateral rep gas old : Nat)
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
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList (n+3) Inv48.Source.model.core.table c r
      ((EscrowTrace.actualStatements.drop 4).take 4)) trace (.normal final)) :
    ∃ (ready : Runtime) (before after : Interaction.Transcript)
      (bytes : List Byte) (response : CreateResponse) (pullTrace : Interaction.Transcript),
      trace = before ++ after ∧
      before = [⟨.external (snapshotWorld c r.state)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)), response⟩] ++ pullTrace ∧
      (decodeCreateResponse response "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      ready.lookupLocal? "payer" = some (.word payer) ∧
      ready.lookupLocal? "repAmount" = some (.word amount) ∧
      ready.lookupLocal? "escrow" = some (.word (u256ToWord response.address)) ∧
      u256ToWord response.address < 2^160 ∧
      Stmt.eval (n+3) Inv48.Source.model.core.table c ready EscrowTrace.transferStmt =
        (selfDispatchCall c ready.state .call rep
          (EscrowTrace.calldata payer (u256ToWord response.address) amount) 0 none >>=
          EscrowTrace.transferReply (n+2) Inv48.Source.model.core.table c ready) := by
  rw [generatedConsecutiveTransfer] at run
  obtain ⟨ready,before,after,joined,prelude,suffix⟩ := appendNormal _ _ _ _ _ _ _ _ run
  obtain ⟨transferred,tt,empty,_,transfer,rest⟩ := sequenceNormal _ _ _ _ _ _ _ _ suffix
  rw [Stmt.evalList] at rest
  have last := pureResult _ _ _ rest
  cases last.2
  obtain ⟨bytes,response,pullTrace,created,success,payerLocal,amountLocal,escrowLocal,bound,tree⟩ :=
    prefixIntoTransfer n (n+1) Inv48.Source.model.core.table c r ready final
      payer amount sponsor oracle collateral rep gas old P A S O C R G E
      hp ha hr notConstruction before tt prelude transfer
  exact ⟨ready,before,after,bytes,response,pullTrace,joined,created,success,
    payerLocal,amountLocal,escrowLocal,bound,tree⟩

#print axioms generatedConsecutiveTransfer
#print axioms generatedIntoTransfer
#print axioms generatedConsecutivePrefix
#print axioms generatedPrefixOriginalLocals
end Inv48.EscrowJoin

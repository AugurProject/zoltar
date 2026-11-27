import Inv48EscrowJoinAssign
import Inv48EscrowJoinPull
import Inv48EscrowJoinLocals
import Inv48EscrowJoinEncode
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowJoin
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def prefixStatements : List Stmt :=
  [.assign (.var "escrow") creationExpr,pullBlock,.varDecl .bool "_sol_hoist_0" none]

/-- Composition begins before constructor evaluation. All live-local premises
    refer to this original runtime, never to a post-create or pre-transfer one.
    The actual create response fixes escrow; pull's argument block and scope
    pop preserve it, payer, repAmount, and rep; the Boolean temporary is included. -/
theorem prefixOriginalLocals (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
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
    (run : ExecutesOK (Stmt.evalList (n+3) t c r prefixStatements) trace (.normal final)) :
    ∃ (bytes : List Byte) (response : CreateResponse) (pullTrace : Interaction.Transcript),
      trace = [⟨.external (snapshotWorld c r.state)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)), response⟩] ++ pullTrace ∧
      (decodeCreateResponse response "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      final.lookupLocal? "payer" = some (.word payer) ∧
      final.lookupLocal? "repAmount" = some (.word amount) ∧
      final.lookupLocal? "escrow" = some (.word (u256ToWord response.address)) ∧
      final.lookupLocal? "rep" = some (.word rep) := by
  unfold prefixStatements at run
  obtain ⟨assigned,ct,tail,joined,create,rest⟩ := sequenceNormal _ _ _ _ _ _ _ _ run
  obtain ⟨created,bytes,response,creation,success,locals,stored⟩ :=
    creationAssignment (n+2) t c r assigned sponsor oracle collateral rep gas old S O C R G E ct create
  have createdE : created.lookupLocal? "escrow" = some (.word old) := by
    simpa only [Runtime.lookupLocal?,locals] using E
  have facts (query : String) := runtimeAssignedWord created assigned "escrow" query old
    (u256ToWord response.address) createdE stored
  obtain ⟨pulled,pt,after,joinedPull,pull,rest⟩ := sequenceNormal _ _ _ _ _ _ _ _ rest
  have pullLocals := pullBlockNormal n t c assigned pulled pt pull
  obtain ⟨declared,bt,empty,joinedBool,decl,rest⟩ := sequenceNormal _ _ _ _ _ _ _ _ rest
  rw [Stmt.eval] at decl
  have boolResult := pureResult _ _ _ decl
  cases boolResult.2
  rw [Stmt.evalList] at rest
  have last := pureResult _ _ _ rest
  cases last.2
  refine ⟨bytes,response,pt,?_,success,?_,?_,?_,?_⟩
  · rw [creation,joinedPull,joinedBool,boolResult.1,last.1] at joined
    simpa only [List.nil_append,List.append_nil] using joined
  all_goals
    rw [declaredOther pulled "_sol_hoist_0" _ Ty.bool.defaultValue (by decide)]
    change LocalEnv.lookup? pulled.locals _ = _
    rw [pullLocals]
    change assigned.lookupLocal? _ = _
  · have original : created.lookupLocal? "payer" = some (.word payer) := by
      simpa only [Runtime.lookupLocal?,locals] using P
    simpa only [if_neg (by decide : "escrow" ≠ "payer"),original] using facts "payer"
  · have original : created.lookupLocal? "repAmount" = some (.word amount) := by
      simpa only [Runtime.lookupLocal?,locals] using A
    simpa only [if_neg (by decide : "escrow" ≠ "repAmount"),original] using facts "repAmount"
  · simpa only [if_pos rfl] using facts "escrow"
  · have original : created.lookupLocal? "rep" = some (.word rep) := by
      simpa only [Runtime.lookupLocal?,locals] using R
    simpa only [if_neg (by decide : "escrow" ≠ "rep"),original] using facts "rep"

/-- The composed prelude feeds the original payer and amount, and the actual
    newly created escrow, into the real REP transfer interaction tree. A normal
    transfer run supplies successful ABI preparation and hence address
    canonicality; arbitrary creation responses are not globally constrained. -/
theorem prefixIntoTransfer (n m : Nat) (t : FunctionTable) (c : Context)
    (r ready final : Runtime) (payer amount sponsor oracle collateral rep gas old : Nat)
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
    (trace transferTrace : Interaction.Transcript)
    (prelude : ExecutesOK (Stmt.evalList (n+3) t c r prefixStatements) trace (.normal ready))
    (transfer : ExecutesOK (Stmt.eval (m+2) t c ready EscrowTrace.transferStmt)
      transferTrace (.normal final)) :
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
  have addressBound := normalTransferAddress m t c ready final rep payer
    (u256ToWord response.address) amount payerLocal escrowLocal amountLocal repLocal
    ha canonical transferTrace transfer
  exact ⟨bytes,response,pullTrace,joined,success,payerLocal,amountLocal,escrowLocal,addressBound,
    EscrowTrace.transferTree m t c ready rep payer (u256ToWord response.address) amount
      payerLocal escrowLocal amountLocal repLocal hp addressBound ha hr notConstruction⟩

#print axioms prefixIntoTransfer
#print axioms prefixOriginalLocals
end Inv48.EscrowJoin

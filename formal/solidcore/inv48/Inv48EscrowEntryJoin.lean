import Inv48EscrowEntryCompose
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def publicPrepared (c : Context) (state : State) (response : Runtime)
    (payer sponsor weth amount halt bounty gas rep : Nat) : Runtime :=
  prepared (entry c state payer sponsor weth amount halt bounty gas).pushScope response rep

/-- All former local-binding premises are instantiated from public arguments,
return defaults and the explicit lookup response. No intermediate local is an input. -/
theorem publicPreparedLocals (c : Context) (state : State) (response : Runtime)
    (payer sponsor weth amount halt bounty gas rep : Nat) :
    let r := publicPrepared c state response payer sponsor weth amount halt bounty gas rep
    r.lookupLocal? "payer" = some (.word payer) ∧
    r.lookupLocal? "repAmount" = some (.word amount) ∧
    r.lookupLocal? "sponsor" = some (.word sponsor) ∧
    r.lookupLocal? "rep" = some (.word rep) ∧
    r.lookupLocal? "callbackGasLimit" = some (.word gas) ∧
    r.lookupLocal? "escrow" = some (.word 0) := by
  simp [publicPrepared,prepared,entry,frame,Runtime.pushScope,Runtime.lookupLocal?,
    LocalEnv.lookup?,Frame.lookup?]

/-- A directly usable entry-to-created-escrow join. The execution premise is
for the actual generated consecutive create/pull/transfer statements, starting
at the runtime COMPUTED from the original public arguments and lookup response. -/
theorem publicPreparedIntoTransfer (n : Nat) (c : Context) (state : State)
    (response final : Runtime) (payer sponsor weth amount halt bounty gas rep oracle collateral : Nat)
    (O : response.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : response.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (hp : payer < 2^160) (ha : amount < 2^256) (hr : rep < 2^256)
    (notConstruction : c.construction = false)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList (n+3) Inv48.Source.model.core.table c
      (publicPrepared c state response payer sponsor weth amount halt bounty gas rep)
      ((EscrowTrace.actualStatements.drop 4).take 4)) trace (.normal final)) :
    ∃ (ready : Runtime) (before after : Interaction.Transcript)
      (bytes : List Byte) (created : CreateResponse) (pullTrace : Interaction.Transcript),
      trace = before ++ after ∧
      before = [⟨.external (snapshotWorld c response.state)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)), created⟩] ++ pullTrace ∧
      (decodeCreateResponse created "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      ready.lookupLocal? "payer" = some (.word payer) ∧
      ready.lookupLocal? "repAmount" = some (.word amount) ∧
      ready.lookupLocal? "escrow" = some (.word (u256ToWord created.address)) ∧
      u256ToWord created.address < 2^160 ∧
      Stmt.eval (n+3) Inv48.Source.model.core.table c ready EscrowTrace.transferStmt =
        (selfDispatchCall c ready.state .call rep
          (EscrowTrace.calldata payer (u256ToWord created.address) amount) 0 none >>=
          EscrowTrace.transferReply (n+2) Inv48.Source.model.core.table c ready) := by
  obtain ⟨P,A,S,R,G,E⟩ := publicPreparedLocals c state response payer sponsor weth amount halt bounty gas rep
  exact generatedIntoTransfer n c _ final payer amount sponsor oracle collateral rep gas 0
    P A S O C R G E hp ha hr notConstruction trace run

/-- Open-boundary counterpart: no REP reply or Boolean result is required. -/
theorem publicPreparedOnEncoding (n m : Nat) (c : Context) (state : State)
    (response ready encodedRuntime : Runtime) (encodedValue : Value)
    (payer sponsor weth amount halt bounty gas rep oracle collateral : Nat)
    (O : response.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : response.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (hp : payer < 2^160) (ha : amount < 2^256) (hr : rep < 2^256)
    (notConstruction : c.construction = false)
    (trace encodingTrace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList (n+3) Inv48.Source.model.core.table c
      (publicPrepared c state response payer sponsor weth amount halt bounty gas rep)
      ((EscrowTrace.actualStatements.drop 4).take 3)) trace (.normal ready))
    (encoding : ExecutesOK (Expr.eval c ready EscrowTrace.calldataExpr)
      encodingTrace (encodedValue,encodedRuntime)) :
    ∃ (bytes : List Byte) (created : CreateResponse) (pullTrace : Interaction.Transcript),
      trace = [⟨.external (snapshotWorld c response.state)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)), created⟩] ++ pullTrace ∧
      (decodeCreateResponse created "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      ready.lookupLocal? "payer" = some (.word payer) ∧
      ready.lookupLocal? "repAmount" = some (.word amount) ∧
      ready.lookupLocal? "escrow" = some (.word (u256ToWord created.address)) ∧
      u256ToWord created.address < 2^160 ∧
      Stmt.eval (m+2) Inv48.Source.model.core.table c ready EscrowTrace.transferStmt =
        (selfDispatchCall c ready.state .call rep
          (EscrowTrace.calldata payer (u256ToWord created.address) amount) 0 none >>=
          EscrowTrace.transferReply (m+1) Inv48.Source.model.core.table c ready) := by
  obtain ⟨P,A,S,R,G,E⟩ := publicPreparedLocals c state response payer sponsor weth amount halt bounty gas rep
  rw [generatedConsecutivePrefix] at run
  exact prefixIntoTransferOnEncoding n m _ c _ ready encodedRuntime encodedValue
    payer amount sponsor oracle collateral rep gas 0 P A S O C R G E hp ha hr
    notConstruction trace encodingTrace run encoding

#print axioms publicPreparedLocals
#print axioms publicPreparedIntoTransfer
#print axioms publicPreparedOnEncoding
end Inv48.EscrowEntry

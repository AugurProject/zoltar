import Inv48EndToEndFundingChild
import Inv48QuoteTransportGenerated
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.InitialTransfer
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- Ordered actual CREATE and REP CALL events in one execution transcript. -/
def Contains (c : Context) (payer amount rep : Nat) (trace : Interaction.Transcript) : Prop :=
  ∃ (lookupState : State) (ready : Runtime) (bytes : List Byte)
    (created : CreateResponse) (answer : CallResponse)
    (pullTrace rest : Interaction.Transcript),
    trace = [⟨.external (snapshotWorld c lookupState)
      (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)),created⟩] ++
      pullTrace ++ [⟨.external (snapshotWorld c ready.state)
        (.call (buildCallRequest c .call rep
          (Inv48.EscrowTrace.calldata payer (u256ToWord created.address) amount) 0 none)),answer⟩] ++ rest ∧
    (decodeCreateResponse created "SharedPoolReportEscrow" bytes 0 none).success = true ∧
    u256ToWord created.address < 2^160

theorem generatedTranscript (n : Nat) (c : Context) (r final : Runtime)
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
    (openWorld : c.selfDispatch? = none)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList (n+3) Inv48.Source.model.core.table c r
      ((EscrowTrace.actualStatements.drop 4).take 4)) trace (.normal final)) :
    Contains c payer amount rep trace := by
  rw [generatedConsecutiveTransfer] at run
  obtain ⟨ready,before,after,joined,prelude,suffix⟩ := appendNormal _ _ _ _ _ _ _ _ run
  obtain ⟨transferred,tt,empty,tailEq,transfer,restRun⟩ := sequenceNormal _ _ _ _ _ _ _ _ suffix
  rw [Stmt.evalList] at restRun
  have last := pureResult _ _ _ restRun
  have afterEq : after = tt := by simpa only [last.1,List.append_nil] using tailEq
  obtain ⟨bytes,created,pullTrace,creation,success,P',A',E',bound,tree⟩ :=
    prefixIntoTransfer n (n+1) Inv48.Source.model.core.table c r ready transferred
      payer amount sponsor oracle collateral rep gas old P A S O C R G E
      hp ha hr notConstruction before tt prelude transfer
  rw [tree,openDispatchRequest c ready.state rep _ _ openWorld] at transfer
  cases transfer with
  | request answer tail =>
    rename_i transferTail
    refine ⟨r.state,ready,bytes,created,answer,pullTrace,transferTail,?_,success,bound⟩
    simp only [joined,creation,afterEq,List.append_assoc,List.singleton_append]

end Inv48.InitialTransfer

import Inv48QuoteSegmentEventsAggregatePrefix
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteSegmentEvents
open Inv48.CollateralReadDecoded Inv48.CollateralMinimum Inv48.ExposureHeap Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false
theorem decodedReadSingleton (n : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript) (d : Deployment c r)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle c r d.root (bytes d) tr)
    (run : Interaction.Executes (Stmt.eval (n+2) table c r
      (Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 universeView))) tr (.ok (.normal final))) :
    ∃ out x rest,
      tr = {query := (.external (snapshotWorld c r.state)
        (.call (buildCallRequest c .staticcall d.root (bytes d) 0 none))),answer := out} :: rest ∧
      rest = [] ∧ out.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded out x ∧
      final = (oracleNext c d.base (runtimeCode d.implementation d.universeBytes d.token)
        (decode d.universeBytes) d.root x out).popScope ∧
      final.lookupLocal? Inv03.Bodies.tmp = some (.word x) := by
  obtain ⟨sourceLocal,small,E,read⟩ := bindings c r d
  have clean : (bytes d).map normByte = bytes d := Inv12.wireClean _ _
  obtain ⟨out,x,event,success,fit,decoded⟩ := Inv48.MinimumSuccessWords.readWordRecovered
    n table c r final d.root _ (bytes d) tr E clean read d.rootFit d.away env run
  obtain ⟨rest,split⟩ := event
  have Z := Inv12.wordFromRead c r _ _ (Inv08.Authority.literal _ _ 0 (by decide))
  unfold Inv48.Minima.readWord at run
  rw [Stmt.eval] at run
  simp only [read,Z,E,Value.expectWord,Value.asBytes?,show Shared.norm d.root=d.root from Nat.mod_eq_of_lt d.rootFit,
    clean,show Shared.norm 0=0 by rfl,selfDispatchKindOk,d.away,Bool.true_and,Bool.false_and,
    Bool.not_false,Bool.not_true,Bool.and_false,Bool.false_or,Bool.false_eq_true,if_false] at run
  unfold selfDispatchCall at run
  simp only [selfDispatchKindOk,d.away,Bool.and_false,Bool.false_eq_true,if_false] at run
  unfold emitLowLevelCall at run
  rw [split] at run
  cases run with
  | request answer tail =>
    have accept : AbiCleanups.acceptOrUnspecified [.uint 256] [.word x]=true := by
      simp [AbiCleanups.acceptOrUnspecified,AbiCleanups.accept,AbiCleanup.accepts,Shared.norm]
      exact Nat.mod_lt _ (by decide)
    have frame : BindingDecl.bindArgs? [⟨"__ext0",.uint256,false⟩] [.word x]=some [("__ext0",.word x)] := rfl
    have ret : abiDecodeValuesExcept? [.uint256] ((decodeCallResponse out .staticcall d.root (bytes d) 0 none).output.map normByte)=.ok [.word x] := decoded
    simp only [Interaction.bind] at tail
    simp only [show (decodeCallResponse out .staticcall d.root (bytes d) 0 none).success=true from success,
      if_true,List.map_cons,List.map_nil,ret,accept,frame] at tail
    let next := oracleNext c d.base (runtimeCode d.implementation d.universeBytes d.token)
      (decode d.universeBytes) d.root x out
    have written : ((Inv48.Minima.wordReply c r d.root (bytes d) out).withFrame [("__ext0",.word x)]).assignLocal? Inv03.Bodies.tmp (.word x)=some next := by
      simp only [d.stage]
      exact concrete_written c d.base _ _ d.root x out
    have prior : ((Inv48.Minima.wordReply c r d.root (bytes d) out).withFrame [("__ext0",.word x)]).lookupLocal? Inv03.Bodies.tmp=some (.word 0) := by
      simp only [d.stage]
      rfl
    have copy := Inv48.Minima.copyClean n table c _ next Inv03.Bodies.tmp "__ext0" 0 x prior fit rfl written
    change Interaction.Executes (Stmt.eval (n+1) table c
      ((Inv48.Minima.wordReply c r d.root (bytes d) out).withFrame [("__ext0",.word x)])
      (.assign (.var Inv03.Bodies.tmp) (.castOp .uintCleanup 256 (.var "__ext0"))) >>= fun result =>
        pure (result.mapRuntime Runtime.popScope)) rest (.ok (.normal final)) at tail
    rw [copy] at tail
    cases tail
    exact ⟨out,x,[],split,rfl,success,fit,decoded,rfl,concrete_captured c d.base _ _ d.root x out⟩
end Inv48.QuoteSegmentEvents

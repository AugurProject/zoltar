import Inv48QuoteMinimumEventsRep
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteMinimumEvents
open Inv48.CollateralMinimum Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false
theorem collateralReadSingleton (n : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript) (u root : Nat)
    (sourceLocal : r.lookupLocal? universeView = some (.word u))
    (small : u < 2^248)
    (locals : r.locals = [[(tmp,.word 0),(universeView,.word u),(tmp,.word u)],[],[],[("_ret0",.word 0)]])
    (rootValue : (Expr.immutable "securityPool").evalWithRuntimeByContext c r = .ok (.word root,r))
    (rootFit : root < Inv32Division.R) (away : wordEq root c.self = false)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle c r root (Inv12.wireBytes 2603245787 [u]) tr)
    (run : Interaction.Executes (Stmt.eval (n+2) table c r
      (Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 universeView))) tr (.ok (.normal final))) :
    ∃ out x rest,
      tr = {query := (.external (snapshotWorld c r.state)
        (.call (buildCallRequest c .staticcall root (Inv12.wireBytes 2603245787 [u]) 0 none))),answer := out} :: rest ∧
      rest = [] ∧ out.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded out x ∧
      final.lookupLocal? Inv03.Bodies.tmp = some (.word x) := by
  have E := Inv48.Minima.oracleCalldata c r 2603245787 u universeView (by decide) small sourceLocal
  have read := rootValue
  have clean : (Inv12.wireBytes 2603245787 [u]).map normByte = (Inv12.wireBytes 2603245787 [u]) := Inv12.wireClean _ _
  obtain ⟨out,x,event,success,fit,decoded⟩ := Inv48.MinimumSuccessWords.readWordRecovered
    n table c r final root _ (Inv12.wireBytes 2603245787 [u]) tr E clean read rootFit away env run
  obtain ⟨rest,split⟩ := event
  have Z := Inv12.wordFromRead c r _ _ (Inv08.Authority.literal _ _ 0 (by decide))
  unfold Inv48.Minima.readWord at run
  rw [Stmt.eval] at run
  simp only [read,Z,E,Value.expectWord,Value.asBytes?,show Shared.norm root=root from Nat.mod_eq_of_lt rootFit,
    clean,show Shared.norm 0=0 by rfl,selfDispatchKindOk,away,Bool.true_and,Bool.false_and,
    Bool.not_false,Bool.not_true,Bool.and_false,Bool.false_or,Bool.false_eq_true,if_false] at run
  unfold selfDispatchCall at run
  simp only [selfDispatchKindOk,away,Bool.and_false,Bool.false_eq_true,if_false] at run
  unfold emitLowLevelCall at run
  rw [split] at run
  cases run with
  | request answer tail =>
    have accept : AbiCleanups.acceptOrUnspecified [.uint 256] [.word x]=true := by
      simp [AbiCleanups.acceptOrUnspecified,AbiCleanups.accept,AbiCleanup.accepts,Shared.norm]
      exact Nat.mod_lt _ (by decide)
    have frame : BindingDecl.bindArgs? [⟨"__ext0",.uint256,false⟩] [.word x]=some [("__ext0",.word x)] := rfl
    have ret : abiDecodeValuesExcept? [.uint256] ((decodeCallResponse out .staticcall root (Inv12.wireBytes 2603245787 [u]) 0 none).output.map normByte)=.ok [.word x] := decoded
    simp only [Interaction.bind] at tail
    simp only [show (decodeCallResponse out .staticcall root (Inv12.wireBytes 2603245787 [u]) 0 none).success=true from success,
      if_true,List.map_cons,List.map_nil,ret,accept,frame] at tail
    let next : Runtime := {((Inv48.Minima.wordReply c r root (Inv12.wireBytes 2603245787 [u]) out).withFrame [("__ext0",.word x)]) with
      locals := [[("__ext0",.word x)],[(tmp,.word x),(universeView,.word u),(tmp,.word u)],[],[],[("_ret0",.word 0)]]}
    have written : ((Inv48.Minima.wordReply c r root (Inv12.wireBytes 2603245787 [u]) out).withFrame [("__ext0",.word x)]).assignLocal? Inv03.Bodies.tmp (.word x)=some next := by
      simp [next,Inv48.Minima.wordReply,Inv12.replied,Runtime.recordExternalInteraction,
        Runtime.withFrame,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
        LocalEnv.assign?,Frame.assign?,Value.coerceLike?,locals,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,universeView]
    have prior : ((Inv48.Minima.wordReply c r root (Inv12.wireBytes 2603245787 [u]) out).withFrame [("__ext0",.word x)]).lookupLocal? Inv03.Bodies.tmp=some (.word 0) := by
      simp [Inv48.Minima.wordReply,Inv12.replied,Runtime.recordExternalInteraction,
        Runtime.withFrame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,locals,
        tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,universeView]
    have copy := Inv48.Minima.copyClean n table c _ next Inv03.Bodies.tmp "__ext0" 0 x prior fit rfl written
    change Interaction.Executes (Stmt.eval (n+1) table c
      ((Inv48.Minima.wordReply c r root (Inv12.wireBytes 2603245787 [u]) out).withFrame [("__ext0",.word x)])
      (.assign (.var Inv03.Bodies.tmp) (.castOp .uintCleanup 256 (.var "__ext0"))) >>= fun result =>
        pure (result.mapRuntime Runtime.popScope)) rest (.ok (.normal final)) at tail
    rw [copy] at tail
    cases tail
    refine ⟨out,x,[],split,rfl,success,fit,decoded,?_⟩
    simp [next,Runtime.popScope,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
      tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0]
end Inv48.QuoteMinimumEvents

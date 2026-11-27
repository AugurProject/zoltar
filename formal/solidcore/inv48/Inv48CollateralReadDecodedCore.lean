import Inv48MinimumCollateralTraceCompose
import Inv48ExposureHeapCore
import Inv48MinimumSuccessWordsOracle
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralReadDecoded
open Inv48.CloneRead Inv48.CollateralMinimum Inv48.ExposureHeap
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

/-- Deployment binding at the recovered suspension, not a successful helper run.
`stage` explicitly assumes the live sourceLocal/memory frame is the generated clone
stage. This theorem does not derive that binding from earlier prefix execution.
Immutable metadata is arbitrary, subject to its actual coercion preserving root. -/
structure Deployment (c : Context) (r : Runtime) where
  base : Runtime
  implementation : List Nat
  universeBytes : List Nat
  token : List Nat
  hi : implementation.length = 20
  hu : universeBytes.length = 31
  ht : token.length = 20
  cu : ∀ b ∈ universeBytes, b < 256
  ct : ∀ b ∈ token, b < 256
  selfFit : c.self < Inv32Division.R
  code : r.state.envAccountCode c c.self = runtimeCode implementation universeBytes token
  stage : r = oracleStage (oracleEntry base) (runtimeCode implementation universeBytes token) (decode universeBytes)
  root : Nat
  field : ImmutableField
  found : c.immutableField? "securityPool" = some field
  stored : r.state.immutable? "securityPool" = some (.word root)
  coercion : field.ty.coerceValue? (.word root) = some (.word root)
  rootFit : root < Inv32Division.R
  away : wordEq root c.self = false

def bytes (d : Deployment c r) := Inv12.wireBytes 2603245787 [decode d.universeBytes]

theorem bindings (c : Context) (r : Runtime) (d : Deployment c r) :
    r.lookupLocal? universeView = some (.word (decode d.universeBytes)) ∧
    decode d.universeBytes < 2^248 ∧
    (Inv48.Minima.oracleData 2603245787 universeView).evalWithRuntimeByContext c r =
      .ok (.bytes (bytes d),r) ∧
    (Expr.immutable "securityPool").evalWithRuntimeByContext c r = .ok (.word d.root,r) := by
  have sourceLocal : r.lookupLocal? universeView = some (.word (decode d.universeBytes)) := by
    simp only [d.stage]
    simp [oracleStage,universeStage,oracleEntry,scalarFrame,Inv48.CloneGetters.post,Runtime.allocMemory,
      Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
      Runtime.pushScope,tmp,Inv03.Bodies.tmp,Inv32CeilFlags.h0,universeView]
  exact ⟨sourceLocal,universe_bounds _ d.hu d.cu,
    Inv48.Minima.oracleCalldata c r _ _ _ (by decide) (universe_bounds _ d.hu d.cu) sourceLocal,
    Inv48.Minima.immutableRead c r _ d.field d.root d.found d.stored d.coercion⟩

/-- Invert the actual request and then its actual continuation. The post-world,
interaction record, ABI scope and popped scope are retained in the final runtime. -/
theorem decodedRead (n : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript) (d : Deployment c r)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle c r d.root (bytes d) tr)
    (run : Interaction.Executes (Stmt.eval (n+2) table c r
      (Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 universeView))) tr (.ok (.normal final))) :
    ∃ out x rest,
      tr = {query := (.external (snapshotWorld c r.state)
        (.call (buildCallRequest c .staticcall d.root (bytes d) 0 none))),answer := out} :: rest ∧
      out.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded out x ∧
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
    exact ⟨out,x,[],split,success,fit,decoded,rfl,concrete_captured c d.base _ _ d.root x out⟩
end Inv48.CollateralReadDecoded

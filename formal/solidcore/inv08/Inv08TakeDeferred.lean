import Inv08TakeDeferredRun
import Inv08ReleasePublic
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.TakeDeferred
open FundingHistory
def output (c : Context) (s : State) := {post (Release.entryState c s) with constructorOutput? := none}

/-- Execute the source-generated withdrawal, returning each original bucket before clearing both. -/
theorem generated (n : Nat) (c : Context) (s : State) (fields : c.storageFields=model.core.context.storageFields)
    (free : c.value=0) (clone : Authority.Clone c (Release.baseRuntime c s))
    (positive : 0<stored s .duration) (ef : stored s .ethDeferred<R) (rf : stored s .repDeferred<R) :
    TypeCheck.CheckedContract.callTargetWithContext? (n+43) model (.name "takeDeferred") c s [] =
      some (.returned (output c s) [.word (stored s .ethDeferred),.word (stored s .repDeferred)]) := by
  let r := Release.baseRuntime c s
  let a := stored s .ethDeferred
  let b := stored s .repDeferred
  let dst := {(Authority.post c r).withFrame (frame a b) with state:=post r.state}
  have X := execute n c r fields clone positive ef rf
  change Stmt.eval _ _ _ _ body.value = pure (.normal dst) at X
  rw [←generatedBody] at X
  have noValue : fn.acceptsValue c.value=true := by rw [free]; simp [FunctionDef.acceptsValue,wordEq]
  have run : fn.evalBodyEntry (n+43) model.core.table c s []=some (pure (.normal dst)) := by
    unfold FunctionDef.evalBodyEntry
    rw [noValue,initial]; exact congrArg some X
  have outputs : fn.collectReturns dst = .ok [.word a,.word b] := by
    unfold FunctionDef.collectReturns
    rw [results]
    simp [collectReturnBindings,collectReturnBindings.collect,Inv32Library.decl,dst,Runtime.lookupLocal?,
      Runtime.withFrame,frame,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Ty.coerceValue?,Bind.bind,Except.bind]
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [dispatch]
  change fn.call? _ _ _ _ _ = _
  unfold FunctionDef.call? FunctionDef.call
  rw [run]
  change some (fn.callBodyResult s (.normal dst)) = _
  simp only [FunctionDef.callBodyResult,outputs,List.map_cons,List.map_nil,Value.untagFixedBytes]
  rfl

theorem outputStorage (c : Context) (s : State) : (output c s).storage=(post s).storage := rfl

theorem accounts (c : Context) (H : Accounts s d fs paid) (sep : Separated fs.length) :
    Accounts (output c s) d fs paid :=
  transport _ _ (outputStorage c s) (preserve H sep 0 0)

theorem fieldAfter (c : Context) (s : State) (k : Field) : stored (output c s) k = stored (post s) k := by
  apply scalarCongr; simp [State.loadSlot,outputStorage]
end Inv08.TakeDeferred

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for th in #[``Inv08.TakeDeferred.generated,``Inv08.TakeDeferred.accounts] do
    for dep in ← collectAxioms th do
      unless allowed.contains dep do throwError "Unexpected deferred withdrawal axiom {dep}"

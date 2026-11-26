import Inv08AddStreamForward
import Inv08AddStreamPublicShape
import Inv08ReleasePublic
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.AddStream
open ExpiryStorage FundingHistory
def outputState (c : Context) (s : State) (f : Funding) (p : Record) :=
  {post (Release.entryState c s) f p with constructorOutput? := none}
def modBody := Inv03.Bodies.block [Authority.callerGuard,Authority.initializedGuard,
  Inv32Shapes.Stmt_captureReturn (Inv32Shapes.seq []) (Inv03.Bodies.block [forwardCall])]

set_option maxHeartbeats 1000000 in
theorem publicBodyRuns (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (clone : Authority.Clone c r) (fields : c.storageFields=model.core.context.storageFields)
    (clock : EnvWord.blockTimestamp.eval c=f.time) (dom : Domain r.state f p) (stages : StageReads r.state f p)
    (pf : p.endAt<2^48) :
    publicBody.value.eval (n+44) model.core.table c (r.withFrame (frame f))=pure (.normal
      ((afterFunding (Authority.post c r) f p).withFrame (frame f))) := by
  let t := model.core.table
  let base := r.withFrame (frame f)
  let root := base.pushScope.pushScope
  let guard := root.pushScope
  let a := Authority.post c guard
  let dest := afterFunding a f p
  have Y := forward (n+28) c a.pushScope f p rfl rfl fields clock dom stages pf
  have nested := Inv32Blocks.one (n+39) t c a (afterFunding a.pushScope f p) forwardCall.value Y
  have captured := Inv32Internal.capture (n+40) t c a dest [] (.block [forwardCall.value]) nested
  have auth := Authority.onlyCapitalLedger (n+1) c guard [.captureReturn [] (.block [forwardCall.value])] clone fields dom.positive
  have seq : Stmt.evalList (n+41) t c guard [Authority.callerGuard.value,Authority.initializedGuard.value,.captureReturn [] (.block [forwardCall.value])] =
      pure (.normal dest) := auth.trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] captured).trans (by rw [Stmt.evalList]))
  have M : modBody.value.eval (n+42) t c root = pure (.normal dest.popScope) := Inv32Hoist.block _ _ _ root dest _ seq
  have N := Inv32Blocks.one (n+42) t c base.pushScope dest.popScope modBody.value M
  have U := paramEval (n+42) c base.pushScope "ethAmount" f.eth rfl (lt_of_le_of_lt (Nat.le_add_left _ _) dom.ethSum) (by dsimp [base]; funding_assign)
  have V := paramEval (n+42) c base.pushScope "repAmount" f.rep rfl (lt_of_le_of_lt (Nat.le_add_left _ _) dom.repSum) (by dsimp [base]; funding_assign)
  have restore : dest.popScope.popScope.popScope=(afterFunding (Authority.post c r) f p).withFrame (frame f) := by
    simp only [dest,afterFunding,allocated,a,guard,root,base,Authority.post,Authority.bytes,
      Runtime.allocMemory,Runtime.popScope,Runtime.pushScope,Runtime.withFrame,List.drop]
  rw [←restore]
  apply Inv32Hoist.block (n+43) t c base dest.popScope.popScope _
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ U).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ V).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] N).trans (by rw [Stmt.evalList])))

/-- An authorized, current funding call commits exactly its two balances, cumulative expiry and two numerators. -/
theorem generated (n : Nat) (c : Context) (s : State) (f : Funding) (p : Record) (free : c.value=0)
    (clone : Authority.Clone c (Release.baseRuntime c s)) (fields : c.storageFields=model.core.context.storageFields)
    (clock : EnvWord.blockTimestamp.eval c=f.time) (dom : Domain (Release.entryState c s) f p)
    (stages : StageReads (Release.entryState c s) f p) (pf : p.endAt<2^48) :
    TypeCheck.CheckedContract.callTargetWithContext? (n+44) model (.name "addStream") c s [.word f.eth,.word f.rep] =
      some (.returned (outputState c s f p) []) := by
  let r := Release.baseRuntime c s
  let dst := (afterFunding (Authority.post c r) f p).withFrame (frame f)
  have X := publicBodyRuns n c r f p clone fields clock dom stages pf
  change Stmt.eval _ _ _ _ publicBody.value = pure (.normal dst) at X
  rw [←generatedBody] at X
  have noValue : fn.acceptsValue c.value=true := by rw [free]; simp [FunctionDef.acceptsValue,wordEq]
  have run : fn.evalBodyEntry (n+44) model.core.table c s [.word f.eth,.word f.rep]=some (pure (.normal dst)) := by
    unfold FunctionDef.evalBodyEntry
    rw [noValue,initial]; exact congrArg some X
  have outputs : fn.collectReturns dst = .ok [] := by
    unfold FunctionDef.collectReturns
    rw [results]; rfl
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [dispatch]
  change fn.call? _ _ _ _ _ = _
  unfold FunctionDef.call? FunctionDef.call
  rw [run]
  change some (fn.callBodyResult s (.normal dst)) = _
  simp only [FunctionDef.callBodyResult,outputs,List.map_nil]
  rfl
end Inv08.AddStream

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for dep in ← collectAxioms ``Inv08.AddStream.generated do
    unless allowed.contains dep do throwError "Unexpected funding execution axiom {dep}"

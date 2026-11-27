import Inv44Loop
import Inv08ReleasePublic
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44
theorem execute (fuel : Nat) (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields)
    (cap : count r.state≤256) (size : wordLengths c r.state) :
    let n := count r.state
    let m := mask (hasCode c r.state) n
    body.value.eval (fuel+9+n) model.core.table c (r.withFrame (frame 0))=pure (.normal (r.withFrame (frame m))) := by
  let t := model.core.table
  let n := count r.state
  let m := mask (hasCode c r.state) n
  let src := r.withFrame (frame 0)
  let dst := r.withFrame (frame m)
  have F := scan fuel n 0 c r fields cap (by omega) size
  let ix := indexed r n 0 0
  let endIx := indexed r n n m
  have L : loop.value.eval ((fuel+5+n)+1) t c ix=pure (.normal endIx) := by
    change Stmt.eval _ _ _ _ (.forLoop .skip loopTest.value step.value work.value)=_
    rw [Stmt.eval]
    have skip : Stmt.eval (fuel+5+n) t c ix.pushScope .skip=pure (.normal ix.pushScope) := by
      rw [show fuel+5+n=(fuel+4+n)+1 by omega,Stmt.eval]
    change (do match ← Stmt.eval (fuel+5+n) t c ix.pushScope .skip with
               | .normal init => do let result ← Stmt.evalFor (fuel+5+n) t c init loopTest.value step.value work.value
                                    pure (result.mapRuntime Runtime.popScope)
               | result=>pure (result.mapRuntime Runtime.popScope))=_
    rw [skip];simp only [Inv08.Authority.bindPure]
    change Stmt.evalFor _ t c ix.pushScope _ _ _=pure (.normal endIx.pushScope) at F
    rw [F];rfl
  have zero := Inv32Hoist.declEval (fuel+5+n) t c (counted r n 0).pushScope "index" .uint256 (.word 0) 0 rfl rfl
  have inner : (Inv03.Bodies.block [indexDecl,loop]).value.eval ((fuel+5+n)+2) t c (counted r n 0)=pure (.normal (counted r n m)) := by
    apply Inv32Hoist.block _ _ _ _ endIx _
    apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ zero)
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] L).trans (by rw [Stmt.evalList])
  have countExpr := countRead c src.pushScope.pushScope fields (lt_of_le_of_lt cap (by decide))
  have re := Inv32Hoist.declEval (fuel+5+n+1) t c src.pushScope.pushScope "count" .uint256 _ n (countExpr _ (Nat.le_succ _)) rfl
  have middle : (Inv03.Bodies.block [countDecl,Inv03.Bodies.block [indexDecl,loop]]).value.eval ((fuel+5+n)+3) t c src.pushScope=pure (.normal dst.pushScope) := by
    apply Inv32Hoist.block _ _ _ _ (counted r n m) _
    apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ re)
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] inner).trans (by rw [Stmt.evalList])
  have skip : Stmt.eval ((fuel+5+n)+3) t c src.pushScope .skip=pure (.normal src.pushScope) := by rw [Stmt.eval]
  change body.value.eval (fuel+9+n) t c src=pure (.normal dst)
  rw [show fuel+9+n=(fuel+5+n)+4 by omega]
  apply Inv32Hoist.block _ _ _ _ dst.pushScope _
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] middle).trans (by rw [Stmt.evalList])

def entry := Inv08.Release.entryState
def output (c : Context) (s : State) := {entry c s with constructorOutput? := none}

/-- The public generated view scans the on-chain dynamic array against runtime code in this call's world. -/
theorem getDeploymentMask (fuel : Nat) (c : Context) (s : State) (fields : c.storageFields=model.core.context.storageFields)
    (free : c.value=0) (cap : count s≤256) (size : wordLengths c (entry c s)) :
    TypeCheck.CheckedContract.callTargetWithContext? (fuel+265) model (.name "getDeploymentMask") c s [] =
      some (.returned (output c s) [.word (mask (hasCode c (entry c s)) (count s))]) := by
  let r := Inv08.Release.baseRuntime c s
  let n := count s
  let m := mask (hasCode c r.state) n
  let dst := r.withFrame (frame m)
  have X := execute (fuel+(256-n)) c r fields cap size
  change Stmt.eval (fuel+(256-n)+9+n) _ _ _ body.value=pure (.normal dst) at X
  have fuelEq : fuel+(256-n)+9+n=fuel+265 := by
    calc
      _ = fuel+((256-n)+n)+9 := by ac_rfl
      _ = _ := by rw [Nat.sub_add_cancel (show n≤256 from cap)]
  rw [fuelEq,←source] at X
  have noValue : fn.acceptsValue c.value=true := by rw [free]; simp [FunctionDef.acceptsValue,wordEq]
  have run : fn.evalBodyEntry (fuel+265) model.core.table c s []=some (pure (.normal dst)) := by
    unfold FunctionDef.evalBodyEntry;rw [noValue,initial];exact congrArg some X
  have outputs : fn.collectReturns dst=.ok [.word m] := by
    unfold FunctionDef.collectReturns;rw [returns]
    simp [collectReturnBindings,collectReturnBindings.collect,Inv32Library.decl,dst,Runtime.lookupLocal?,
      Runtime.withFrame,frame,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Ty.coerceValue?,Bind.bind,Except.bind]
  unfold TypeCheck.CheckedContract.callTargetWithContext?
  rw [dispatch];change fn.call? _ _ _ _ _=_
  unfold FunctionDef.call? FunctionDef.call;rw [run]
  change some (fn.callBodyResult s (.normal dst))=_
  simp only [FunctionDef.callBodyResult,outputs,List.map_cons,List.map_nil,Value.untagFixedBytes];rfl
end Inv44

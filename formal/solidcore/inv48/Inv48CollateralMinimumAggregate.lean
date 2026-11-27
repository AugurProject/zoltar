import Inv48CollateralMinimumHoist
open SolidCore.Solidity.Source
namespace Inv48.CollateralMinimum
open Inv48.SymbolicClone Inv48.CloneRead Inv48.CloneGetters
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

def universeStage (r : Runtime) (code : List Nat) (u : Nat) :=
  (post r code).declareLocal tmp (.word u)
def oracleStage (r : Runtime) (code : List Nat) (u : Nat) :=
  ((universeStage r code u).declareLocal universeView (.word u)).declareLocal tmp (.word 0)

theorem universeHoist (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<R)
    (boundary : r.state.envAccountCode c c.self=runtimeCode implementation universeBytes token) :
    (Stmt.eval (n+46) table c (r.declareLocal tmp (.word 0))
      (hoist universeRet universeKey)).runWith rows =
      .ok (.normal (universeStage r (runtimeCode implementation universeBytes token) (decode universeBytes))) := by
  let code := runtimeCode implementation universeBytes token
  let r0 := r.declareLocal tmp (.word 0)
  let s := visible r0.pushScope code universeRet (decode universeBytes)
  let next := (universeStage r code (decode universeBytes)).pushScope.declareLocal universeRet (.word (decode universeBytes))
  have call := universe_visible n c r0.pushScope universeRet implementation universeBytes token hi hu ht cu ct selfWord boundary
  have run := hoistRun (n+43) c r0 s next rows universeRet universeKey (decode universeBytes)
    (congrArg (SolI.runWith rows) call)
    (by cases h : r.locals <;> simp [s,r0,visible,post,Runtime.allocMemory,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,tmp,universeRet,h,tmp,Inv32CeilFlags.h0,Inv03.Bodies.tmp,universeView,universeRet,universeStage,post,Runtime.allocMemory])
    (visible_lookup _ _ _ _)
    (by cases h : r.locals <;> simp [s,r0,next,visible,universeStage,post,Runtime.allocMemory,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?,tmp,universeRet,h,tmp,Inv32CeilFlags.h0,Inv03.Bodies.tmp,universeView,universeRet,universeStage,post,Runtime.allocMemory])
  exact run

theorem aggregateListRun (n : Nat) (c : Context) (r next : Runtime) (rows : ScriptedResponder)
    (implementation universeBytes token : List Nat) (root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<R)
    (boundary : r.state.envAccountCode c c.self=runtimeCode implementation universeBytes token)
    (rootValue : (Expr.immutable "securityPool").evalWithRuntimeByContext c
      (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes)) = .ok (.word root,oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes)))
    (exposureFits : exposure<Inv32Division.R) (rootFits : root<Inv32Division.R)
    (away : wordEq root c.self=false) (success : out.success=true)
    (answer : rows.answerCall? (snapshotWorld c (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes)).state)
      (buildCallRequest c .staticcall root (Inv12.wireBytes 2603245787 [decode universeBytes]) 0 none)=some out)
    (decoded : abiDecodeValuesExcept? [.uint256] ((byteArrayToBytes out.returnData).map normByte)=.ok [.word exposure])
    (written : ((Inv48.Minima.wordReply c (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes)) root (Inv12.wireBytes 2603245787 [decode universeBytes]) out).withFrame [("__ext0",.word exposure)]).assignLocal? tmp (.word exposure)=some next)
    (captured : next.popScope.lookupLocal? tmp=some (.word exposure)) :
    (Stmt.evalList (n+46) table c r aggregateList).runWith rows=
      .ok (.returned next.popScope [.word exposure]) := by
  let code := runtimeCode implementation universeBytes token
  let u := decode universeBytes
  let a := universeStage r code u
  let b := a.declareLocal universeView (.word u)
  let d := oracleStage r code u
  have small : u<2^248 := universe_bounds universeBytes hu cu
  have lookup : a.lookupLocal? tmp=some (.word u) := by
    cases h : r.locals <;> simp [a,universeStage,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,post,Runtime.allocMemory,h]
  have fit : u<Inv32Division.R := small.trans (by decide)
  have clean : Expr.eval c a (.castOp .uintCleanup 248 (.var tmp))=pure (.word u,a) := by
    have cast : uintCleanup? c.checked 248 (.word u)=.ok (.word u) := by
      have smallNum := small
      norm_num at smallNum
      simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,SolidCore.Solidity.Shared.norm,
        Nat.mod_eq_of_lt (show u<SolidCore.Solidity.Shared.wordModulus from fit),Nat.mod_eq_of_lt small,small,smallNum,Nat.mod_eq_of_lt smallNum,Bind.bind,Except.bind]
    unfold Expr.eval
    rw [Expr.evalFuel]
    change (do let p ← Expr.evalFuel (0+1) c a (.var tmp); let v ← liftM (uintCleanup? c.checked 248 p.1); pure (v,p.2) : SolI (Value × Runtime)) = _
    rw [Inv32Guards.readWord _ _ _ _ _ lookup]
    change (do let v ← liftM (uintCleanup? c.checked 248 (.word u)); pure (v,a) : SolI (Value × Runtime)) = _
    rw [cast]; rfl
  have decl := Inv32Hoist.declEval (n+45) table c a universeView .uint256 _ u clean (by rw [Ty.coerceValue?])
  have oracle := Inv48.Minima.oracleReadRun (n+44) c d next rows 2603245787 u root exposure universeView out (by decide) small
    (by cases h : r.locals <;> simp [d,oracleStage,universeStage,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,post,Runtime.allocMemory,h,tmp,Inv32CeilFlags.h0,Inv03.Bodies.tmp,universeView,universeRet,universeStage,post,Runtime.allocMemory])
    rootValue exposureFits rootFits away success answer decoded
    (by cases h : r.locals <;> simp [d,oracleStage,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,h,tmp,Inv32CeilFlags.h0,Inv03.Bodies.tmp,universeView,universeRet,universeStage,post,Runtime.allocMemory]) written
  have ret := Inv32CompareValues.retOne (n+45) table c next.popScope (.castOp .uintCleanup 256 (.var tmp)) exposure
    (Inv32Guards.clean _ c next.popScope (.var tmp) exposure exposureFits (Inv32Guards.readWord _ _ _ _ _ captured))
  unfold aggregateList
  apply seqRun _ _ _ _ _ _ _ _ (congrArg (SolI.runWith rows) (decl_none (n+45) table c r .uint256 tmp))
  simp only [Ty.defaultValue]
  apply seqRun _ _ _ _ _ _ _ _ (universeHoist n c r rows implementation universeBytes token hi hu ht cu ct selfWord boundary)
  apply seqRun _ _ _ _ _ _ _ _ (congrArg (SolI.runWith rows) decl)
  apply seqRun _ _ _ _ _ _ _ _ (congrArg (SolI.runWith rows) (decl_none (n+45) table c b .uint256 tmp))
  simp only [Ty.defaultValue]
  apply seqRun _ _ _ _ _ _ _ _ oracle
  rw [Stmt.evalList,ret]
  rfl
end Inv48.CollateralMinimum

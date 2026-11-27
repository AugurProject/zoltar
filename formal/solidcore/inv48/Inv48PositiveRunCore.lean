import Inv48PositiveSyntax
import Inv48PositiveRoundCore
import Inv32QuoteGuard
import Inv32QuoteExpr
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32FloorFastPath
namespace Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem maxStep (n : Nat) (ctx : Context) (r : Runtime) (p c rep : Nat)
    (hc : c<R) (positive : 0<p) (budget : rep*10^18 ≤ (R-1)*p)
    (call : Stmt.eval (n+20) Inv48.Source.model.core.table ctx (maxStage r p c rep 0 0)
      (.internalCall [maxRet] maxKey [.var a0,.var a1]) =
      internalCallAssign (maxStage r p c rep 0 0) [maxRet] [.word (Inv48.minimum c rep p)]) :
    Stmt.eval (n+22) Inv48.Source.model.core.table ctx (saved (phase3 r p c rep) h3 0) maxCode =
      pure (.normal (phase4 r p c rep)) := by
  let v := Inv48.minimum c rep p
  have fq : roundedRep rep p<R := (rounded_fits_iff rep p positive).mpr budget
  have castOk : uintCast? 256 (.word (roundedRep rep p)) = .ok (.word (roundedRep rep p)) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,show SolidCore.Solidity.Shared.norm (roundedRep rep p) = roundedRep rep p from Nat.mod_eq_of_lt fq,
      Nat.mod_eq_of_lt fq,Bind.bind,Except.bind]; exact fq
  have pre : runList ctx.checked (saved (phase3 r p c rep) h3 0).pushScope maxArgs =
      some (maxStage r p c rep 0 0) := by
    simp [maxArgs,runList,declare,declareZero,cleanWord,castWord,clean,Inv32Scalar.cast,localWord,
      locals,maxStage,phase3,phase2,phase1,root,start,saved,h0,h1,h2,h3,a0,a1,maxRet,
      Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,Runtime.withFrame,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,Ty.coerceValue?,Ty.defaultValue,
      Inv32Guards.cleanupWord ctx.checked c hc,Inv32Guards.cleanupWord ctx.checked (roundedRep rep p) fq,
      castOk,projectWord]
  have H := hoist (n+20) Inv48.Source.model.core.table ctx (saved (phase3 r p c rep) h3 0)
    (maxStage r p c rep 0 0) (maxStage r p c rep 0 v) (maxStage r p c rep v v)
    h3 maxRet maxKey maxArgs [.var a0,.var a1] v (by simp [maxArgs,listDepth,declare,declareZero]) pre call
    (by dsimp [maxStage,phase3,phase2,phase1,root,start,h0,h1,h2,h3,a0,a1,maxRet]; positive_store)
    (by rfl) (by rfl)
    (by dsimp [maxStage,phase3,phase2,phase1,root,start,h0,h1,h2,h3,a0,a1,maxRet]; positive_store)
  simpa [maxCode,maxStage,phase4,saved,Runtime.popScope,Runtime.pushScope] using H

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem positiveCondition (ctx : Context) (r : Runtime) (p : Nat) (hp : p<R) (positive : 0<p) :
    Expr.eval ctx (root r p) condition = pure (.word 1,root r p) := by
  let src := root r p
  have read := Inv32Guards.clean 3 ctx src (.var "proposedRepPerEthPrice") p hp
    (Inv32Guards.readWord 2 ctx src "proposedRepPerEthPrice" p rfl)
  change Expr.evalFuel 5 ctx src condition = _
  unfold condition
  rw [Expr.evalFuel] <;> try (intro bad; cases bad)
  change (do
    let (right,next) ← Expr.evalFuel 4 ctx src (.word 0)
    let (left,final) ← Expr.evalFuel 4 ctx next (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice"))
    let value ← liftM (BinaryOp.apply ctx.checked .ne left right)
    pure (value,final)) = _
  rw [show Expr.evalFuel 4 ctx src (.word 0) = pure (.word 0,src) from rfl]
  change (do
    let (left,final) ← Expr.evalFuel 4 ctx src (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice"))
    let value ← liftM (BinaryOp.apply ctx.checked .ne left (.word 0))
    pure (value,final)) = _
  rw [read]
  have eq0 : wordEq p 0 = false := by
    change (p%R == 0%R) = false
    simp [Nat.mod_eq_of_lt hp,Nat.ne_of_gt positive]
  have bin : BinaryOp.apply ctx.checked .ne (.word p) (.word 0) = .ok (.word 1) := by
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,
      Bind.bind,Except.bind,
      show SolidCore.Solidity.Shared.norm p = p from Nat.mod_eq_of_lt hp,
      show SolidCore.Solidity.Shared.norm 0 = 0 by decide,
      eq0,boolWord]
  simp only [pb]
  change (do
    let value ← liftM (BinaryOp.apply ctx.checked .ne (.word p) (.word 0))
    pure (value,src)) = _
  rw [bin]
  rfl

#print axioms maxStep
#print axioms positiveCondition
#print axioms bodyForm
end Inv48.Positive

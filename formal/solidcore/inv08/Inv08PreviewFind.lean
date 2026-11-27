import Inv08PreviewShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.Preview
def frame (tm id : Nat) : Frame := [("until",.word tm),("ethAmount",.word 0),("repAmount",.word 0),("expiredId",.word id)]
def root (r : Runtime) (tm id : Nat) := (r.withFrame (frame tm id)).pushScope.pushScope
def temp (r : Runtime) (tm id v : Nat) := (root r tm id).declareLocal tmp (.word v)
def entered (r : Runtime) (tm id v : Nat) := (temp r tm id v).pushScope.declareLocal a0 (.word tm)
def marked (r : Runtime) (tm id v ans : Nat) := (entered r tm id v).declareLocal er (.word ans)
macro "preview_write" : tactic => `(tactic|
  simp [marked,entered,temp,root,frame,tmp,a0,a1,er,ie,ir,
    internalCallAssign,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
    Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.withFrame,Runtime.pushScope,
    LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])

theorem clock (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (T : r.lookupLocal? "until"=some (.word tm))
    (h : Ready r.state tm) : forward.value.eval (n+1) t c r = pure (.normal r) := by
  let old := stored r.state .through
  have le : old≤tm := h.forward
  have oldFit := lt_of_le_of_lt le h.time
  have timeFit := lt_trans h.time (by decide : 2^48<R)
  have A := Expiry.local48 c r "until" tm h.time T
  have B := Expiry.scalarField c r .through old fields rfl oldFit
  have word : Source.BinaryOp.apply c.checked .ge (.word tm) (.word old) = .ok (.word 1) := by
    have order : ¬Shared.toEvmWord tm < Shared.toEvmWord old := by
      change ¬ (tm%R)%R < (old%R)%R
      simp [Nat.mod_eq_of_lt timeFit,Nat.mod_eq_of_lt (lt_of_le_of_lt le timeFit),Nat.not_lt_of_ge le]
    simp [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,
      Source.BinaryOp.applyWord,Shared.ltWord,Shared.liftEvmBinary,EvmYul.UInt256.lt,order,Bind.bind,Except.bind,
      boolWord,wordTruthy]
    rfl
  exact Inv32QuoteGuard.requireEval n t c r _ true "Fee time moved backwards"
    (ReleaseQuote.binary A B .ge (by intro x; cases x) (by intro x; cases x) word _ (Nat.le_succ _))

theorem findExec (n : Nat) (c : Context) (r : Runtime) (tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (h : Ready r.state tm) :
    find.value.eval (n+60) model.core.table c (temp r tm 0 0) = pure (.normal (temp r tm 0 (q r.state tm))) := by
  let t := model.core.table
  let id := q r.state tm
  let inside := (temp r tm 0 0).pushScope
  let pre := marked r tm 0 0 0
  let after := marked r tm 0 0 id
  have A := Inv32Hoist.declEval (n+58) t c inside a0 .uint256 _ tm (Expiry.local48 c inside "until" tm h.time rfl _ (Nat.le_succ _)) (by rfl)
  have Z := Inv32FloorStart.zero (n+58) t c (entered r tm 0 0) er
  have C := Expiry.call n c pre a0 [er] tm rfl h.time fields h.ordered h.settled
  have store : internalCallAssign pre [er] [.word id] = pure (.normal after) := by dsimp [pre,after]; preview_write
  have cap := Inv32Internal.capture _ _ _ _ _ [er] _ (C.trans store)
  have P := Inv32Temps.copy (n+58) t c after (marked r tm 0 id id) tmp er 0 id rfl rfl
    (by dsimp [after]; preview_write)
  exact Inv32Hoist.block _ _ _ _ (marked r tm 0 id id) _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] P).trans (by rw [Stmt.evalList])))))
end Inv08.Preview

import Inv08AddStreamShapes
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes
set_option maxHeartbeats 3000000
namespace Inv08.AddStream
open FundingHistory ExpiryStorage
structure Domain (s : State) (f : Funding) (previous : Record) : Prop where
  nowEq : stored s .through = f.time
  positive : 0 < stored s .duration
  endFits : f.time + stored s .duration < 2^48
  funded : f.eth≠0 ∨ f.rep≠0
  ethSum : stored s .ethOut+f.eth<R
  repSum : stored s .repOut+f.rep<R
  ethBudget : stored (withOutstanding s f) .ethOut + (withOutstanding s f).loadSlot 3 < 2^128
  repBudget : stored (withOutstanding s f) .repOut + (withOutstanding s f).loadSlot 4 < 2^128
  idFit : nextId s f previous < 2^48
  recordFit : Fits (add (stored s .duration) previous f)
  ethCursor : stored s .ethCursor+f.eth*f.time<R
  repCursor : stored s .repCursor+f.rep*f.time<R

theorem maxReads (c : Context) (r : Runtime) (bits : Nat) (h : bits≤256) :
    Inv40.Reads c r (maximum bits).value (2^bits-1) := by
  have bound : 2^bits-1<R := lt_of_lt_of_le (by have := Nat.two_pow_pos bits; omega)
    (Nat.pow_le_pow_right (by decide) h)
  have v := ReleaseQuote.readClean (Authority.castBits (Authority.literal c r _ bound) 256 (by decide) (by decide) bound) bound
  exact Authority.yes (Authority.literal c r 1 (by decide)) v
theorem fieldRead (c : Context) (r : Runtime) (k : Field) (fields : c.storageFields=model.core.context.storageFields)
    (fits : stored r.state k < R) : Inv40.Reads c r (fieldWord k).value (stored r.state k) :=
  ReleaseQuote.readClean (reads c r k fields) fits
theorem neRead (c : Context) (a b : Nat) (af : a<R) (bf : b<R) :
    Source.BinaryOp.apply c.checked .ne (.word a) (.word b) = .ok (.word (if a=b then 0 else 1)) := by
  change (Except.ok (ε:=RevertData) (Value.word (boolWord (!wordEq a b))))=_
  by_cases eqn : a=b <;> simp [wordEq,boolWord,show Shared.norm a=a from Nat.mod_eq_of_lt af,
    show Shared.norm b=b from Nat.mod_eq_of_lt bf,eqn]
theorem requireHolds (n : Nat) (c : Context) (r : Runtime) (test : Source.Expr) (message : String) (h : Inv40.Reads c r test 1) :
    Stmt.eval (n+1) model.core.table c r (.requireStmt test (some message)) = pure (.normal r) :=
  Inv32QuoteGuard.requireEval n _ _ _ _ true message (h _ (Nat.le_succ _))
theorem timeOK (n : Nat) (c : Context) (r : Runtime) (tm : Nat) (atTime : EnvWord.blockTimestamp.eval c=tm)
    (fields : c.storageFields=model.core.context.storageFields) (time : stored r.state .through=tm) (fit : tm<R) :
    timeGuard.value.eval (n+1) model.core.table c r = pure (.normal r) := by
  have l := fieldRead c r .through fields (time ▸ fit)
  rw [time] at l
  have clock : Inv40.Reads c r timeExpr.value tm := by
    intro fuel enough
    cases fuel with
    | zero => change 1≤0 at enough; omega
    | succ n => change Expr.evalFuel _ c r (.env .blockTimestamp) = _; rw [Expr.evalFuel]; exact congrArg (fun x => pure (Value.word x,r)) atTime
                all_goals intro h; cases h
  exact requireHolds _ _ _ _ _ (ReleaseQuote.binary l (ReleaseQuote.readClean clock fit) .eq
    (by intro h; cases h) (by intro h; cases h) (by simpa using Inv32WideGuards.eqWord c.checked tm tm fit fit))
theorem endOK (n : Nat) (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields)
    (fit : stored r.state .through+stored r.state .duration<2^48) :
    endGuard.value.eval (n+1) model.core.table c r = pure (.normal r) := by
  let t := stored r.state .through
  let d := stored r.state .duration
  have whole : t+d<R := lt_trans fit (by decide)
  have tf := lt_of_le_of_lt (Nat.le_add_right _ _) whole
  have df := lt_of_le_of_lt (Nat.le_add_left _ _) whole
  have a := ReleaseQuote.readClean (Authority.castBits (reads c r .through fields) 256 (by decide) (by decide) tf) tf
  have total := Authority.double (ReleaseQuote.binary a (fieldRead c r .duration fields df) .add
    (by intro h; cases h) (by intro h; cases h) (Inv40.addWords _ t d whole)) whole
  have h : t+d ≤ 2^48-1 := Nat.le_pred_of_lt fit
  have cmp : Source.BinaryOp.apply c.checked .le (.word (t+d)) (.word (2^48-1)) = .ok (.word 1) := by
    change Source.BinaryOp.apply false .le _ _ = _
    rw [Inv32WideGuards.leWord (t+d) (2^48-1) whole (by decide), if_pos h]
  exact requireHolds _ _ _ _ _ (ReleaseQuote.binary total (maxReads _ _ 48 (by decide)) .le
    (by intro h; cases h) (by intro h; cases h) cmp)
theorem amountOK (n : Nat) (c : Context) (r : Runtime) (a b : Nat) (af : a<R) (bf : b<R) (nonempty : a≠0 ∨ b≠0)
    (A : r.lookupLocal? "ethAmount"=some (.word a)) (B : r.lookupLocal? "repAmount"=some (.word b)) :
    amountGuard.value.eval (n+1) model.core.table c r = pure (.normal r) := by
  have left := ReleaseQuote.binary (ReleaseQuote.readClean (localReads c r _ a A) af) (Authority.literal c r 0 (by decide)) .ne
    (by intro h; cases h) (by intro h; cases h) (neRead _ a 0 af (by decide))
  have right := ReleaseQuote.binary (ReleaseQuote.readClean (localReads c r _ b B) bf) (Authority.literal c r 0 (by decide)) .ne
    (by intro h; cases h) (by intro h; cases h) (neRead _ b 0 bf (by decide))
  change Inv40.Reads c r (nonzero "ethAmount").value _ at left
  change Inv40.Reads c r (nonzero "repAmount").value _ at right
  apply requireHolds
  intro fuel enough
  change 9≤fuel at enough
  cases fuel with
  | zero => omega
  | succ k =>
    change Expr.evalFuel _ c r (.binary .boolOr (nonzero "ethAmount").value (nonzero "repAmount").value) = _
    rw [Expr.evalFuel,left _ (by change 4≤k;omega)]
    by_cases h : a=0
    · have hb : b≠0 := nonempty.resolve_left (by simpa using h)
      simp only [h,Authority.bindPure]
      change (do let (v,s) ← Expr.evalFuel k c r (nonzero "repAmount").value
                 let w ← liftM v.expectWord
                 pure (Value.word (boolWord (wordTruthy w)),s)) = _
      rw [right _ (by change 4≤k; omega),if_neg hb]; rfl
    · rw [if_neg h]; rfl
end Inv08.AddStream

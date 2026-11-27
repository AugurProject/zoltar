import Inv36Bindings
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32QuoteExpr Inv32Actions Inv32Scalar Inv32FloorStart
open Inv32Normal Inv32Dispatch
namespace Inv36Source
def quote (c p : Nat) : Option (Nat × Nat) :=
  if 0<p ∧ p<10000 ∧ 0<(amounts c p).1 ∧ 0<(amounts c p).2 then some (amounts c p) else none

private theorem inputGuard (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (p : Nat)
    (hp : p<R) (P : locals r pn = some p) :
    Stmt.eval (n+1) t c r paramGuard = pure (if 0<p ∧ p<10000 then .normal r else .reverted r (.error "Invalid initial price")) := by
  let a := positive pn
  let b := Inv32Product.ltF (w pn) bps
  let fu := (Expr.binary .boolAnd a.core b.core).orderFuel
  have L := a.sound fu c r (locals r) _ (by decide) (Inv32QuoteGuard.modeled _) (positiveValue _ _ _ _ hp P)
  have B := comparison c.checked (locals r) (w pn) bps _ _ hp (by decide) (Inv32ProductValues.cleanup (localWord pn) _ _ _ hp P) (bpsValue _ _)
  have H := b.sound fu c r (locals r) _ (by decide) (Inv32QuoteGuard.modeled _) B
  simpa [a,b,paramGuard] using Inv32QuoteGuard.requireEval n t c r _ _ "Invalid initial price" (Inv32QuoteGuard.both _ _ _ _ _ _ _ L H)

private theorem outputGuard (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (y z : Nat)
    (hy : y<R) (hz : z<R) (Y : locals r yn = some y) (Z : locals r nn = some z) :
    Stmt.eval (n+1) t c r amountGuard = pure (if 0<y ∧ 0<z then .normal r else .reverted r (.error "Initial reserves round to zero")) := by
  let fu := (Expr.binary .boolAnd (positive yn).core (positive nn).core).orderFuel
  have A := (positive yn).sound fu c r (locals r) _ (by decide) (Inv32QuoteGuard.modeled _) (positiveValue _ _ _ _ hy Y)
  have B := (positive nn).sound fu c r (locals r) _ (by decide) (Inv32QuoteGuard.modeled _) (positiveValue _ _ _ _ hz Z)
  simpa [amountGuard] using Inv32QuoteGuard.requireEval n t c r _ _ "Initial reserves round to zero" (Inv32QuoteGuard.both _ _ _ _ _ _ _ A B)

private theorem choose (n : Nat) (c : Context) (r : Runtime) (a p : Nat) (ha : a<R) (valid : 0<p ∧ p<10000) :
    Stmt.eval (n+17) model.core.table c (base r a p 0 0) (.ifElse switchExpr (branch true) (branch false)) =
      pure (.normal (base r a p (amounts a p).1 (amounts a p).2)) := by
  let root := base r a p 0 0
  have hp : p<R := lt_trans valid.2 (by decide : 10000<R)
  have ge : Source.BinaryOp.apply c.checked .ge (.word p) (.word 5000) =
      .ok (.word (if 5000≤p then 1 else 0)) := by
    have h : (Shared.toEvmWord p < Shared.toEvmWord 5000) ↔ p < 5000 := by
      change (p%R)%R < (5000%R)%R ↔ _
      simp [Nat.mod_eq_of_lt hp,show 5000%R=5000 by decide]
    simp [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,Source.BinaryOp.applyWord,
      Shared.ltWord,Shared.liftEvmBinary,EvmYul.UInt256.lt,h,Bind.bind,Except.bind]
    by_cases b : p<5000
    · simp [b,boolWord,wordTruthy,show ¬5000≤p by omega]; decide
    · simp [b,boolWord,wordTruthy,show 5000≤p by omega]; rfl
  let e := binary .ge (by intro h; cases h) (by intro h; cases h) (w pn) (literal 5000)
  have read : Expr.eval c root switchExpr = pure (.word (if 5000≤p then 1 else 0),root) := by
    apply evalFormula e _ _ _ (by decide)
    have v := Inv32ProductValues.cleanup (localWord pn) c.checked (locals root) p hp (by rfl)
    change (w pn).run c.checked (locals root) = some p at v
    simp only [e,binary,v,literal,show normWord 5000=5000 by decide]
    change projectWord (Source.BinaryOp.apply c.checked .ge (.word p) (.word 5000)) = _
    rw [ge]; rfl
  dsimp [root] at read
  rw [Stmt.eval]; dsimp only; rw [read]
  by_cases h : 5000≤p
  · rw [if_pos h]; simpa [amounts,h] using upperBranch n c r a p ha valid h
  · rw [if_neg h]; simpa [amounts,h] using lowerBranch n c r a p ha valid (by omega)

theorem bounded (a p : Nat) (ha : a<R) (valid : 0<p ∧ p<10000) :
    (amounts a p).1<R ∧ (amounts a p).2<R := by
  have bound (m d : Nat) (hd : 0<d) (h : m≤d) : a*m/d<R :=
    lt_of_le_of_lt (le_trans (Nat.div_le_div_right (Nat.mul_le_mul_left a h)) (le_of_eq (Nat.mul_div_cancel _ hd))) ha
  unfold amounts; split
  · exact ⟨bound _ _ valid.1 (by omega),ha⟩
  · exact ⟨ha,bound _ _ (by omega) (by omega)⟩

private theorem guarded (n : Nat) (ctx : Context) (r : Runtime) (a p : Nat) (ha : a<R) (hp : p<R) :
    Ends ((quote a p).map fun z => base r a p z.1 z.2)
      (Stmt.evalList (n+17) model.core.table ctx (base r a p 0 0)
        [paramGuard,.ifElse switchExpr (branch true) (branch false),amountGuard]) := by
  let root := base r a p 0 0
  let t := model.core.table
  have G := inputGuard (n+16) t ctx root p hp rfl
  by_cases valid : 0<p ∧ p<10000
  case neg =>
    have bad : quote a p = none := if_neg (by aesop)
    rw [bad]; rw [if_neg valid] at G
    exact reject _ _ _ _ _ _ ⟨_,_,G⟩
  rw [if_pos valid] at G
  apply step _ _ _ _ _ _ _ _ G
  apply step _ _ _ _ _ _ _ _ (choose n ctx r a p ha valid)
  have b := bounded a p ha valid
  have last := outputGuard (n+16) t ctx (base r a p (amounts a p).1 (amounts a p).2)
    _ _ b.1 b.2 rfl rfl
  by_cases ok : 0<(amounts a p).1 ∧ 0<(amounts a p).2
  · rw [if_pos ok] at last
    rw [show quote a p = some (amounts a p) from if_pos ⟨valid.1,valid.2,ok⟩]
    exact (seqStep _ _ _ _ _ _ [] last).trans (by rw [Stmt.evalList])
  · rw [if_neg ok] at last
    rw [show quote a p = none from if_neg (by aesop)]
    exact reject _ _ _ _ _ [] ⟨_,_,last⟩

theorem execute (n : Nat) (ctx : Context) (r : Runtime) (a p : Nat) (ha : a<R) (hp : p<R) :
    Ends ((quote a p).map fun z => r.withFrame (frm a p z.1 z.2))
      (Stmt.eval (n+19) model.core.table ctx (r.withFrame (frm a p 0 0)) initializeCode) := by
  let src := r.withFrame (frm a p 0 0)
  let outer := src.pushScope
  let t := model.core.table
  have inner := block _ t ctx outer _ _ (guarded n ctx r a p ha hp)
  have A := Inv32FloorFastPath.cleanParamExec (n+17) t ctx outer cn a ha rfl (by dsimp [outer,src]; write_initial)
  have B := Inv32FloorFastPath.cleanParamExec (n+17) t ctx outer pn p hp rfl (by dsimp [outer,src]; write_initial)
  have S : Stmt.eval (n+18) t ctx outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have whole := block _ t ctx src _ _ (step _ _ _ _ _ _ _ _ A (step _ _ _ _ _ _ _ _ B
    (step _ _ _ _ _ _ _ _ S (step _ _ _ _ _ _ _ _ S (Inv32InverseCall.single _ _ _ _ _ _ inner)))))
  cases h : quote a p <;> rw [h] at whole <;> exact whole
end Inv36Source

import Inv32Rounding
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv32Eval

theorem mulmodExpression (fuel : Nat) (ctx : Context) (rt : Runtime) (x y den : Source.Expr)
    (a b d : Nat) (ha : a < R) (hb : b < R) (hd : d < R) (pos : 0 < d)
    (ex : Source.Expr.evalFuel fuel ctx rt x = pure (.word a, rt))
    (ey : Source.Expr.evalFuel fuel ctx rt y = pure (.word b, rt))
    (ed : Source.Expr.evalFuel fuel ctx rt den = pure (.word d, rt)) :
    Source.Expr.evalFuel (fuel+1) ctx rt (.mulMod x y den) =
      pure (.word (a*b%d), rt) := by
  have bindOk {α β : Type} (v : α) (k : α → SolI β) : (pure v >>= k) = k v := rfl
  have liftOk (n : Nat) : (liftM (.ok n : Except RevertData Nat) : SolI Nat) = pure n := rfl
  have word (n : Nat) (h : n < R) : (Value.word n).expectWord = .ok n := by
    change Except.ok (n%R) = _
    rw [Nat.mod_eq_of_lt h]
  rw [Source.Expr.evalFuel]
  simp only [ed, ey, ex, bindOk, word a ha,
    word b hb, word d hd, liftOk, Inv32Rounding.remainder a b d ha hb hd pos]
theorem binary (fuel : Nat) (ctx : Context) (rt : Runtime) (op : Source.BinaryOp)
    (strictAnd : op ≠ .boolAnd) (strictOr : op ≠ .boolOr)
    (x y : Source.Expr) (a b result : Source.Value)
    (ex : Source.Expr.evalFuel fuel ctx rt x = pure (a, rt))
    (ey : Source.Expr.evalFuel fuel ctx rt y = pure (b, rt))
    (operation : op.apply ctx.checked a b = .ok result) :
    Source.Expr.evalFuel (fuel+1) ctx rt (.binary op x y) = pure (result, rt) := by
  have bindOk {α β : Type} (v : α) (k : α → SolI β) : (pure v >>= k) = k v := rfl
  rw [Source.Expr.evalFuel]
  simp only [ey, ex, bindOk, operation]
  rfl
  all_goals assumption

theorem divideWords (checked : Bool) (lo d : Nat) (hl : lo < R) (hd : d < R) (pos : 0 < d) :
    Source.BinaryOp.apply checked .div (.word lo) (.word d) = .ok (.word (lo/d)) := by
  have nz : Shared.norm d ≠ 0 := by
    change d%R ≠ 0
    rw [Nat.mod_eq_of_lt hd]
    omega
  have v (n : Nat) (hn : n < R) : (Shared.toEvmWord n).val.val = n := by
    change (n%R)%R = n
    simp [Nat.mod_eq_of_lt hn]
  have divOk : Source.checkedDiv checked lo d = .ok (lo/d) := by
    rw [Source.checkedDiv,if_neg nz]
    change Except.ok (((Shared.toEvmWord lo).val.val / (Shared.toEvmWord d).val.val) % R) = _
    rw [v lo hl,v d hd,Nat.mod_eq_of_lt (lt_of_le_of_lt (Nat.div_le_self _ _) hl)]
  simp [Source.BinaryOp.apply, Value.forceAbiLazy, Source.BinaryOp.applyWord, divOk,
    Source.BinaryOp.preservesFixedBytesWidth, Bind.bind, Except.bind]

end Inv32Eval

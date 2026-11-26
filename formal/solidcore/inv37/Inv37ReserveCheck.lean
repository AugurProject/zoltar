import Inv32QuoteGuard

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32QuoteExpr Inv32Scalar
namespace Inv37Source

private def atLeast (balance minimum : String) : Formula :=
  binary .ge (by intro h; cases h) (by intro h; cases h) (w balance) (w minimum)

private theorem compareBalances (c : Context) (r : Runtime) (b m : String) (actual limit : Nat)
    (ha : actual < R) (hl : limit < R)
    (hb : locals r b = some actual) (hm : locals r m = some limit) :
    (atLeast b m).run c.checked (locals r) = some (boolWord (decide (limit ≤ actual))) := by
  have order : (Shared.toEvmWord actual < Shared.toEvmWord limit) ↔ actual < limit := by
    change (actual % R) % R < (limit % R) % R ↔ _
    simp [Nat.mod_eq_of_lt ha, Nat.mod_eq_of_lt hl]
  have ge : Source.BinaryOp.apply c.checked .ge (.word actual) (.word limit) =
      .ok (.word (if limit ≤ actual then 1 else 0)) := by
    simp [Source.BinaryOp.apply, Value.forceAbiLazy, Source.BinaryOp.preservesFixedBytesWidth,
      Source.BinaryOp.applyWord, Shared.ltWord, Shared.liftEvmBinary, EvmYul.UInt256.lt,
      order, Bind.bind, Except.bind]
    by_cases smaller : actual < limit
    · simp [smaller, boolWord, wordTruthy, show ¬ limit ≤ actual by omega]; decide
    · simp [smaller, boolWord, wordTruthy, show limit ≤ actual by omega]; rfl
  have a := Inv32ProductValues.cleanup (localWord b) c.checked (locals r) actual ha hb
  have l := Inv32ProductValues.cleanup (localWord m) c.checked (locals r) limit hl hm
  change (w b).run _ _ = _ at a
  change (w m).run _ _ = _ at l
  simp [atLeast, binary, a, l, ge, projectWord, boolWord]

def reserveCheck := Stmt.requireStmt (.binary .boolAnd
  (atLeast "yesBalance" "minimumYes").core (atLeast "noBalance" "minimumNo").core)
  (some "Balance below expected")

theorem reserveCheckResult (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (y no my mn : Nat) (hy : y < R) (hn : no < R) (hmy : my < R) (hmn : mn < R)
    (Y : locals r "yesBalance" = some y) (N : locals r "noBalance" = some no)
    (MY : locals r "minimumYes" = some my) (MN : locals r "minimumNo" = some mn) :
    Stmt.eval (n+1) t c r reserveCheck =
      pure (if my ≤ y ∧ mn ≤ no then .normal r else .reverted r (.error "Balance below expected")) := by
  let left := atLeast "yesBalance" "minimumYes"
  let right := atLeast "noBalance" "minimumNo"
  let fuel := (Expr.binary .boolAnd left.core right.core).orderFuel
  have L := left.sound fuel c r (locals r) _ (by decide) (Inv32QuoteGuard.modeled _)
    (compareBalances _ _ _ _ _ _ hy hmy Y MY)
  have N' := right.sound fuel c r (locals r) _ (by decide) (Inv32QuoteGuard.modeled _)
    (compareBalances _ _ _ _ _ _ hn hmn N MN)
  simpa [reserveCheck,left,right] using Inv32QuoteGuard.requireEval n t c r _ _
    "Balance below expected" (Inv32QuoteGuard.both _ _ _ _ _ _ _ L N')

end Inv37Source

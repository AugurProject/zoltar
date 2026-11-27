import Inv48MinimumSuccessWordsArithmetic
import Inv48MinimaTail
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessWords
open Inv32Division Inv48.RequestDispatch
set_option maxHeartbeats 20000000
set_option maxRecDepth 65536
set_option linter.unusedSimpArgs false
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

/-- Checked evaluation of the collateral source expression rejects an
unrepresentable sum. This is expression failure, not an assumed result budget. -/
theorem additionExprOverflow (c : Context) (r : Runtime) (left right : String)
    (a b : Nat) (ha : a < Inv32Division.R) (hb : b < Inv32Division.R)
    (large : Inv32Division.R ≤ a+b) (ch : c.checked = true)
    (A : r.lookupLocal? left = some (.word a)) (B : r.lookupLocal? right = some (.word b)) :
    Expr.eval c r (Inv48.MinimaAdd.checkedSum left right).core =
      throw (SolidityFailure.revert .overflow) := by
  have raw : checkedAdd true a b = .error .overflow := by
    simp only [checkedAdd,show SolidCore.Solidity.Shared.norm a = a from Nat.mod_eq_of_lt ha,
      show SolidCore.Solidity.Shared.norm b = b from Nat.mod_eq_of_lt hb]
    rw [if_pos (by simpa using large)]
  have h : BinaryOp.apply c.checked .add (.word a) (.word b) = .error .overflow := by
    simp [ch,BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,BinaryOp.applyWord,raw,Bind.bind,Except.bind]
  have sumThrows (k : Nat) : Expr.evalFuel (k+3) c r (Inv48.MinimaAdd.sum left right).core = throw (SolidityFailure.revert .overflow) := by
    change Expr.evalFuel _ _ _ (.binary .add (Inv48.MinimaAdd.q left).core (Inv48.MinimaAdd.flag right).core) = _
    rw [Expr.evalFuel]
    have Qa : Expr.evalFuel (k+2) c r (Inv48.MinimaAdd.q left).core = pure (.word a,r) := Inv32Guards.clean _ _ _ _ _ ha (Inv32Guards.readWord _ _ _ _ _ A)
    have Fb : Expr.evalFuel (k+2) c r (Inv48.MinimaAdd.flag right).core = pure (.word b,r) := Inv32Guards.clean _ _ _ _ _ hb (Inv32Guards.readWord _ _ _ _ _ B)
    simp only [Qa,Fb,pb,h]; rfl
    all_goals intro h; cases h
  change Expr.evalFuel (_+3+1+1) c r (.castOp .uintCleanup 256
    (.castOp .uintCleanup 256 (Inv48.MinimaAdd.sum left right).core)) = _
  rw [Expr.evalFuel,Expr.evalFuel,sumThrows]
  rfl

/-- Invert the actual collateral helper's sum declaration. Formula and bound
are consequences of normal completion at this site, with no sum-fit premise. -/
theorem collateralDeclarationRecovered (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (base exposure : Nat) (trace : Interaction.Transcript)
    (baseFits : base < R) (exposureFits : exposure < R) (checked : c.checked = true)
    (A : r.lookupLocal? Inv48.Minima.operand = some (.word base))
    (B : r.lookupLocal? Inv48.Minima.ceilLocal = some (.word (Inv03.ceilQuot exposure 100)))
    (run : Interaction.Executes (Stmt.eval (n+1) t c r
      (.varDecl .uint256 Inv48.Minima.sumLocal
        (some (Inv48.MinimaAdd.checkedSum Inv48.Minima.operand Inv48.Minima.ceilLocal).core)))
      trace (.ok (.normal final))) :
    base + Inv03.ceilQuot exposure 100 < R ∧
    final = r.declareLocal Inv48.Minima.sumLocal (.word (base + Inv03.ceilQuot exposure 100)) ∧
    trace = [] := by
  have ceilFits := exposureCeilingFits exposure exposureFits
  have fit : base + Inv03.ceilQuot exposure 100 < R := by
    by_contra large
    have bad := additionExprOverflow c r Inv48.Minima.operand Inv48.Minima.ceilLocal
      base (Inv03.ceilQuot exposure 100) baseFits ceilFits (Nat.le_of_not_gt large) checked A B
    rw [Stmt.eval] at run
    dsimp only at run
    rw [bad] at run
    cases run
  have value := Inv48.MinimaAdd.value n t c r Inv48.Minima.operand Inv48.Minima.ceilLocal
    base (Inv03.ceilQuot exposure 100) baseFits ceilFits fit checked
    (by simp [Inv32Actions.locals,A]) (by simp [Inv32Actions.locals,B])
  have good := Inv32Hoist.declEval n t c r Inv48.Minima.sumLocal .uint256 _
    (base + Inv03.ceilQuot exposure 100) value (by rw [Ty.coerceValue?])
  rw [good] at run
  cases run
  exact ⟨fit,rfl,rfl⟩
end Inv48.MinimumSuccessWords

import Inv48MinimumSuccessWordsCollateral
import Inv48GeneratedGetterTails
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessWords
open Inv48.Minima Inv32Division Inv32Actions Inv32Scalar Inv32Product Inv32Hoist
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
set_option linter.unusedSimpArgs false

/-- If the actual collateral tail's sum does not fit, its deterministic checked
execution reverts. Only the exposure and immutable operand reads are inputs. -/
theorem collateralTailOverflow (n : Nat) (c : Context) (r : Runtime) (x base : Nat)
    (small : x<R) (bsmall : base<R) (large : R ≤ base+Inv03.ceilQuot x 100)
    (checked : c.checked=true)
    (X : r.lookupLocal? Inv03.Bodies.tmp=some (.word x))
    (B : r.lookupLocal? operand=some (.word base)) :
    ∃ failed, Stmt.evalList (n+16) Inv48.Source.model.core.table c r collateralTail =
      pure (.reverted failed .overflow) := by
  let table := Inv48.Source.model.core.table
  let t := table
  let q := Inv03.ceilQuot x 100
  let a := r.declareLocal exposureLocal (.word x)
  let b := Inv32OneArg.store a Inv03.Bodies.tmp q
  let d := b.declareLocal ceilLocal (.word q)
  let final := d.declareLocal sumLocal (.word (base+q))
  have qfit : q<R := exposureCeilingFits x small
  have read : Expr.eval c r (.castOp .uintCleanup 256 (.var Inv03.Bodies.tmp)) = pure (.word x,r) :=
    Inv32Guards.clean _ c r (.var Inv03.Bodies.tmp) x small (Inv32Guards.readWord _ c r _ _ X)
  have first := declEval (n+15) t c r exposureLocal .uint256 _ x read (by rw [Ty.coerceValue?])
  have rounded := Inv48.MinimaCeil.hoist table Inv48.Minima.TableCheck.generatedLinks.2.2.1 Inv48.Minima.TableCheck.generatedLinks.2.2.2 n c a exposureLocal x small (by simp [Inv32CeilFlags.h0,localWord,Inv32FloorHoist.start,Inv32OneArg.store,a,exposureLocal,Inv03.Bodies.tmp])
  have copied : Expr.eval c b (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var Inv03.Bodies.tmp))) =
      pure (.word q,b) := by
    exact evalFormula (Inv32QuoteExpr.castCopy Inv03.Bodies.tmp) c b q (by decide)
      (Inv32QuoteExpr.castValue _ _ _ _ qfit (by simp [Inv32CeilFlags.h0,localWord,locals,b,Inv32OneArg.store]))
  have copy := declEval (n+15) t c b ceilLocal .uint256 _ q copied (by rw [Ty.coerceValue?])
  have baseread : d.lookupLocal? operand = some (.word base) := by
    simp [Inv32CeilFlags.h0,localWord,locals,d,b,a,Inv32OneArg.store,operand,exposureLocal,ceilLocal,Inv03.Bodies.tmp,B]
  have bad := additionExprOverflow c d operand ceilLocal base q bsmall qfit large checked baseread
    (by cases H : b.locals <;> simp [d,Runtime.lookupLocal?,Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,H])
  have sumStep : Stmt.eval (n+16) t c d (.varDecl .uint256 sumLocal
      (some (Inv48.MinimaAdd.checkedSum operand ceilLocal).core)) = pure (.reverted d .overflow) := by
    rw [Stmt.eval]
    dsimp only
    rw [bad]
    rfl
  refine ⟨d,?_⟩
  unfold collateralTail
  rw [Stmt.evalList,first]
  change Stmt.evalList (n+16) t c a _ = _
  rw [Stmt.evalList,Inv32FloorStart.zero]
  change Stmt.evalList (n+16) t c (Inv32OneArg.store a Inv03.Bodies.tmp 0) _ = _
  rw [Stmt.evalList,rounded]
  change Stmt.evalList (n+16) t c b _ = _
  rw [Stmt.evalList,copy]
  change Stmt.evalList (n+16) t c d _ = _
  rw [Stmt.evalList,sumStep]
  rfl

/-- Actual successful collateral-tail execution recovers C and its bound. No
returned budget or successful alternative execution is a premise. -/
theorem collateralTailRecovered (n : Nat) (c : Context) (r final : Runtime)
    (x base : Nat) (values : List Value) (trace : Interaction.Transcript)
    (small : x<R) (bsmall : base<R) (checked : c.checked=true)
    (X : r.lookupLocal? Inv03.Bodies.tmp=some (.word x))
    (B : r.lookupLocal? operand=some (.word base))
    (run : Interaction.Executes (Stmt.evalList (n+16) Inv48.Source.model.core.table c r collateralTail)
      trace (.ok (.returned final values))) :
    base+Inv03.ceilQuot x 100 < R ∧ values = [.word (base+Inv03.ceilQuot x 100)] ∧
      final = tailState r x base ∧ trace = [] := by
  have fit : base+Inv03.ceilQuot x 100 < R := by
    by_contra large
    obtain ⟨failed,bad⟩ := collateralTailOverflow n c r x base small bsmall (Nat.le_of_not_gt large) checked X B
    rw [bad] at run
    cases run
  rw [generatedCollateralTail n c r x base small bsmall fit checked X B] at run
  cases run
  exact ⟨fit,rfl,rfl,rfl⟩

/-- Actual successful REP tail returns R = ceil(repExposure/100). Its word
bound follows from the decoded exposure bound, without a budget premise. -/
theorem repTailRecovered (n : Nat) (c : Context) (r final : Runtime)
    (x : Nat) (values : List Value) (trace : Interaction.Transcript)
    (small : x<R) (X : r.lookupLocal? Inv03.Bodies.tmp=some (.word x))
    (run : Interaction.Executes (Stmt.evalList (n+16) Inv48.Source.model.core.table c r repTail)
      trace (.ok (.returned final values))) :
    Inv03.ceilQuot x 100 < R ∧ values = [.word (Inv03.ceilQuot x 100)] ∧ trace = [] := by
  rw [generatedRepTail n c r x small X] at run
  cases run
  exact ⟨exposureCeilingFits x small,rfl,rfl⟩
end Inv48.MinimumSuccessWords

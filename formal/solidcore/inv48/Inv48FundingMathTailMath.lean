import Inv48ExposureHeapCanonical
import Inv48MinimaCeilHoist
import Inv48RoundedTableCheck
import Inv48WholeQuoteTail
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.FundingMathTail
set_option maxRecDepth 65536
set_option maxHeartbeats 5000000
abbrev table := Inv48.Source.model.core.table

def ceilLink : Inv32Library.LinkAt table Inv04.Shapes.ceilKey
    [.word "a",.word "b"] [.word "_ret0"] Inv04.Shapes.ceilShape.value :=
  Inv48.Minima.TableCheck.checkedLink _ _ _ _ _
    (by have h := Inv48.Minima.TableCheck.certified
        simp only [Inv48.Minima.TableCheck.checks,Bool.and_eq_true] at h
        exact h.1.2)

def uintLink := Inv48.FeedBinding.generatedLinks.2.2.2.2
abbrev productLink := Inv48.FeedBinding.generatedLinks.1
abbrev floorLink := Inv48.FeedBinding.generatedLinks.2.1

/-- Exact caller result of the checked ceilDiv body; no caller frame premise. -/
theorem ceilCaller (n : Nat) (c : Context) (r : Runtime) (src : String) (x : Nat)
    (fit : x<R)
    (read : (Inv32FloorHoist.start r Inv03.Bodies.tmp 0).lookupLocal? src = some (.word x)) :
    Stmt.eval (n+16) table c (Inv32OneArg.store r Inv03.Bodies.tmp 0)
      (Inv48.MinimaCeil.code src).value =
        pure (.normal (Inv32OneArg.store r Inv03.Bodies.tmp (Inv03.ceilQuot x 100))) :=
  Inv48.MinimaCeil.hoist table ceilLink uintLink n c r src x fit read

/-- Old-cell readback follows by inverting the actual helper execution. -/
theorem ceilOldCell (n : Nat) (c : Context) (r final : Runtime) (src : String) (x id : Nat)
    (fit : x<R)
    (read : (Inv32FloorHoist.start r Inv03.Bodies.tmp 0).lookupLocal? src = some (.word x))
    (run : Stmt.eval (n+16) table c (Inv32OneArg.store r Inv03.Bodies.tmp 0)
      (Inv48.MinimaCeil.code src).value = pure (.normal final)) :
    final.loadMemory? id = r.loadMemory? id := by
  rw [ceilCaller n c r src x fit read] at run
  have eq : final = Inv32OneArg.store r Inv03.Bodies.tmp (Inv03.ceilQuot x 100) := by
    injection run with eq
    injection eq with eq
    exact Result.normal.inj eq.symm
  subst final
  rfl

abbrev floorCaller := @Inv32FloorHoist.successAt
end Inv48.FundingMathTail

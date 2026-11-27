import Inv48FundingMathTailSuffix
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.FundingMathTail
set_option maxRecDepth 65536
set_option maxHeartbeats 5000000

/-- Instantiate the actual floor library and derive its caller frame by
inversion of execution; the heap equality is a conclusion, never a premise. -/
theorem floorFrame (n : Nat) (c : Context) (r final : Runtime)
    (ex ey ed : Expr) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (pos : 0<d) (fit : x*y/d<R)
    (args : Inputs c r h0 ex ey ed x y d)
    (run : Stmt.eval (n+15) table c (Inv32OneArg.store r h0 0)
      (code h0 ex ey ed) = pure (.normal final)) :
    final.memory = r.memory ∧
    final.lookupLocal? "quote" = r.lookupLocal? "quote" ∧
    ∀ id, final.loadMemory? id = r.loadMemory? id := by
  have actual := successAt table productLink floorLink n c r h0 ex ey ed x y d
    hx hy hd pos fit args (by decide) (by decide) (by decide) (by decide)
  rw [actual] at run
  have eq : final = Inv32OneArg.store r h0 (x*y/d) := by
    injection run with eq
    injection eq with eq
    exact Result.normal.inj eq.symm
  subst final
  exact ⟨rfl,Inv48.WholeQuote.store_other r _ "quote" (by decide),fun _ => rfl⟩

/-- The ceilDiv caller has the same execution-derived frame. -/
theorem ceilFrame (n : Nat) (c : Context) (r final : Runtime) (src : String) (x : Nat)
    (fit : x<R)
    (read : (start r Inv03.Bodies.tmp 0).lookupLocal? src = some (.word x))
    (run : Stmt.eval (n+16) table c (Inv32OneArg.store r Inv03.Bodies.tmp 0)
      (Inv48.MinimaCeil.code src).value = pure (.normal final)) :
    final.memory = r.memory ∧
    final.lookupLocal? "quote" = r.lookupLocal? "quote" ∧
    ∀ id, final.loadMemory? id = r.loadMemory? id := by
  rw [ceilCaller n c r src x fit read] at run
  have eq : final = Inv32OneArg.store r Inv03.Bodies.tmp (Inv03.ceilQuot x 100) := by
    injection run with eq
    injection eq with eq
    exact Result.normal.inj eq.symm
  subst final
  exact ⟨rfl,Inv48.WholeQuote.store_other r _ "quote" (by decide),fun _ => rfl⟩
end Inv48.FundingMathTail

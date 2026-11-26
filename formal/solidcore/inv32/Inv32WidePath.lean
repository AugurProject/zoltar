import Inv32WideExecution
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FactorRun
namespace Inv32WidePath
abbrev sameEffects := Inv32WideExecution.sameEffects
theorem tail (n : Nat) (c : Context) (r : Runtime) (x y d : Nat)
    (hx : x<R) (hy : y<R) (hd : d<R) (wide : 0<x*y/R) (fits : x*y/R<d) :
    ∃ next, sameEffects next r ∧
      Stmt.evalList (n+8) Inv32Dispatch.model.core.table {c with checked := false}
        (base r x y d).pushScope instructions = pure (.returned next [.word (x*y/d)]) := by
  obtain ⟨next,eff,h⟩ := Inv32WideExecution.tail n c r x y d hx hy hd wide fits
  exact ⟨next,eff, h.trans (congrArg (fun v => pure (.returned next [Value.word v]) : Nat → SolI Result)
    (Inv32WideMath.result _ _ _ hd wide fits))⟩
end Inv32WidePath

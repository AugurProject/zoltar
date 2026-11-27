import Inv48QuoteRangeFromSuccessGuards
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.QuoteRangeFromSuccess
open Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- Inversion at the real guard suffix. Word fits prevent cleanup modulo from
being confused with a bound on the original Nat. No range conclusion is assumed. -/
theorem suffixRanges (n : Nat) (t : FunctionTable) (c : Context) (r after : Runtime)
    (rows : ScriptedResponder) (tail : List Stmt)
    (id a rep halt exposure settlement bounty : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a rep halt exposure settlement))
    (read : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (ha : a<R) (hr : rep<R) (hh : halt<R) (hb : bounty<R)
    (run : (Stmt.evalList (n+1) t c r (upperGuards++tail)).runWith rows = .ok (.normal after)) :
    a≤2^128-1 ∧ rep≤2^128-1 ∧ halt≤2^128-1 ∧ bounty≤2^96-1 := by
  have run0 := run
  simp only [upperGuards,List.cons_append,List.nil_append] at run0
  have b0 : a≤2^128-1 := by
    by_contra bad
    have fail := upperFailure n t c r id 0 a (2^128-1)
      [.word a,.word rep,.word halt,.word exposure,.word settlement] "WETH report exceeds uint128"
      ref mem rfl (by decide) ha (by decide) (by omega)
    rw [Stmt.evalList,fail] at run0
    cases run0
  have step0 := upperPreserves n t c r id 0 a (2^128-1)
    [.word a,.word rep,.word halt,.word exposure,.word settlement] "WETH report exceeds uint128"
    ref mem rfl (by decide) (by decide) b0
  rw [Stmt.evalList,step0] at run0
  change (Stmt.evalList (n+1) t c r _).runWith rows = .ok (.normal after) at run0
  have b1 : rep≤2^128-1 := by
    by_contra bad
    have fail := upperFailure n t c r id 1 rep (2^128-1)
      [.word a,.word rep,.word halt,.word exposure,.word settlement] "REP report exceeds uint128"
      ref mem rfl (by decide) hr (by decide) (by omega)
    rw [Stmt.evalList,fail] at run0
    cases run0
  have step1 := upperPreserves n t c r id 1 rep (2^128-1)
    [.word a,.word rep,.word halt,.word exposure,.word settlement] "REP report exceeds uint128"
    ref mem rfl (by decide) (by decide) b1
  rw [Stmt.evalList,step1] at run0
  change (Stmt.evalList (n+1) t c r _).runWith rows = .ok (.normal after) at run0
  have b2 : halt≤2^128-1 := by
    by_contra bad
    have fail := upperFailure n t c r id 2 halt (2^128-1)
      [.word a,.word rep,.word halt,.word exposure,.word settlement] "Oracle escalation halt amount exceeds uint128 maximum"
      ref mem rfl (by decide) hh (by decide) (by omega)
    rw [Stmt.evalList,fail] at run0
    cases run0
  have step2 := upperPreserves n t c r id 2 halt (2^128-1)
    [.word a,.word rep,.word halt,.word exposure,.word settlement] "Oracle escalation halt amount exceeds uint128 maximum"
    ref mem rfl (by decide) (by decide) b2
  rw [Stmt.evalList,step2] at run0
  change (Stmt.evalList (n+1) t c r _).runWith rows = .ok (.normal after) at run0
  have b3 : bounty≤2^96-1 := by
    by_contra bad
    have fail := bountyFailure n t c r bounty read hb (by omega)
    rw [Stmt.evalList,fail] at run0
    cases run0
  exact ⟨b0,b1,b2,b3⟩

#print axioms suffixRanges
end Inv48.QuoteRangeFromSuccess

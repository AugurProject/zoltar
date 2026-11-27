import Inv48QuoteRangeFromSuccessSuffix
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.QuoteRangeFromSuccess
open Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl

theorem guardsFailure (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a rep halt exposure settlement bounty : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a rep halt exposure settlement))
    (read : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (ha : a<R) (hr : rep<R) (hh : halt<R) (hb : bounty<R)
    (bad : ¬ (a≤2^128-1 ∧ rep≤2^128-1 ∧ halt≤2^128-1 ∧ bounty≤2^96-1)) :
    ∃ message, Stmt.evalList (n+1) t c r upperGuards = pure (.reverted r (.error message)) := by
  by_cases b0 : a≤2^128-1
  case neg =>
    have fail := upperFailure n t c r id 0 a (2^128-1)
      [.word a,.word rep,.word halt,.word exposure,.word settlement] "WETH report exceeds uint128"
      ref mem rfl (by decide) ha (by decide) (by omega)
    refine ⟨"WETH report exceeds uint128",?_⟩
    simp only [upperGuards,Stmt.evalList]
    simp only [fail,pb]
  have step0 := upperPreserves n t c r id 0 a (2^128-1)
    [.word a,.word rep,.word halt,.word exposure,.word settlement] "WETH report exceeds uint128"
    ref mem rfl (by decide) (by decide) b0
  by_cases b1 : rep≤2^128-1
  case neg =>
    have fail := upperFailure n t c r id 1 rep (2^128-1)
      [.word a,.word rep,.word halt,.word exposure,.word settlement] "REP report exceeds uint128"
      ref mem rfl (by decide) hr (by decide) (by omega)
    refine ⟨"REP report exceeds uint128",?_⟩
    simp only [upperGuards,Stmt.evalList]
    simp only [step0,pb]
    simp only [fail,pb]
  have step1 := upperPreserves n t c r id 1 rep (2^128-1)
    [.word a,.word rep,.word halt,.word exposure,.word settlement] "REP report exceeds uint128"
    ref mem rfl (by decide) (by decide) b1
  by_cases b2 : halt≤2^128-1
  case neg =>
    have fail := upperFailure n t c r id 2 halt (2^128-1)
      [.word a,.word rep,.word halt,.word exposure,.word settlement] "Oracle escalation halt amount exceeds uint128 maximum"
      ref mem rfl (by decide) hh (by decide) (by omega)
    refine ⟨"Oracle escalation halt amount exceeds uint128 maximum",?_⟩
    simp only [upperGuards,Stmt.evalList]
    simp only [step0,pb]
    simp only [step1,pb]
    simp only [fail,pb]
  have step2 := upperPreserves n t c r id 2 halt (2^128-1)
    [.word a,.word rep,.word halt,.word exposure,.word settlement] "Oracle escalation halt amount exceeds uint128 maximum"
    ref mem rfl (by decide) (by decide) b2
  have b3 : 2^96-1<bounty := by omega
  refine ⟨"Oracle settler reward exceeds uint96 maximum",?_⟩
  simp only [upperGuards,Stmt.evalList]
  simp only [step0,step1,step2,bountyFailure n t c r bounty read hb b3,pb]

#print axioms guardsFailure
end Inv48.QuoteRangeFromSuccess

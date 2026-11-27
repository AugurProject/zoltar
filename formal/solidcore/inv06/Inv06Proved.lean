import Inv06HarnessBindings
import Inv06Redemption
import Inv05Proved
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv06
def redeem (s : State) (cash units rem b : Nat) :=
  CheckedWordCall.read Inv03.model s "cashForUnits" (Harness.args cash units rem b)
theorem publicRedeem (s : State) (cash units rem b : Nat) (cap : cash<2^128) (book : units<2^128)
    (balance : b≤units) (le : rem≤cash*10^9) :
    redeem s cash units rem b = some (Cash.payment cash units rem b) := by
  let c := CheckedWordCall.ctx Inv03.model
  have ev := Harness.execute 49963 c (CheckedWordCall.initial c s) cash units rem b cap book balance le
  rw [←Harness.checkedBody] at ev
  exact CheckedWordCall.returnsWord _ Harness.fn _ s _ _ _ (Option.some_get _).symm
    (Harness.frameOk _ _ _ _) Harness.returns Harness.accepts ev

theorem fundedRedemption (s : State) (cash units rem deposit added : Nat)
    (cashCap : cash+deposit<2^128) (unitCap : units+added<2^128)
    (up : 0<units) (funded : rem<cash*10^9)
    (mint : Inv05.mint s deposit units (cash*10^9-rem) = some added) :
    ∃ paid, redeem s (cash+deposit) (units+added) rem added = some paid ∧ (paid=deposit ∨ paid=deposit-1) := by
  let net := cash*10^9-rem
  have dp : deposit<2^128 := lt_of_le_of_lt (Nat.le_add_left _ _) cashCap
  have ub : units<R := lt_of_le_of_lt (Nat.le_add_right _ _) (lt_trans unitCap (by decide))
  have nc : net<R := lt_of_le_of_lt (Nat.sub_le _ _)
    (lt_trans (Nat.mul_lt_mul_of_pos_right (lt_of_le_of_lt (Nat.le_add_right _ _) cashCap) (by decide : 0<10^9)) (by decide))
  have np : 0<net := Nat.sub_pos_of_lt funded
  have netAfter : (cash+deposit)*10^9-rem=net+deposit*10^9 := by dsimp [net]; rw [Nat.add_mul]; omega
  have cover : rem≤(cash+deposit)*10^9 := by rw [Nat.add_mul]; omega
  have call := publicRedeem s _ _ rem added cashCap unitCap (Nat.le_add_left _ _) cover
  refine ⟨_,call,?_⟩
  have issued := mint
  rw [Inv05.publicMint _ _ _ _ dp ub nc up np] at issued
  have high := (Inv05.incumbentValue _ _ _ _ _ dp ub nc up np mint).1
  unfold Cash.payment
  by_cases zero : deposit=0
  · subst deposit
    change some 0=some added at issued
    cases issued
    simp
  · simp only [Inv05.result,if_neg zero,Inv05.quote] at issued
    split at issued
    · rename_i h
      cases issued
      have gate := h.2
      simp only [Inv05.permitted,Bool.and_eq_true,decide_eq_true_eq] at gate
      rw [if_neg gate.1,if_neg (by omega),netAfter]
      exact immediate deposit units net _ up gate.2 high
    · contradiction
/-- The newly created settlement book is cash-funded at (0,0,0). On its first
mint all issued units belong to that deposit, including the zero-deposit boundary. -/
theorem firstRedemption (s : State) (deposit : Nat) (cap : deposit<2^128) (book : deposit*10^9<2^128) :
    Inv05.mint s deposit 0 0 = some (deposit*10^9) ∧
    redeem s deposit (deposit*10^9) 0 (deposit*10^9) = some deposit := by
  constructor
  · simpa [Inv05.allUnits] using Inv05.mintAllUnits s deposit 0 0 cap (by decide) (by decide) (Or.inl rfl)
  · have pay := publicRedeem s deposit (deposit*10^9) 0 (deposit*10^9) cap book (by rfl) (Nat.zero_le _)
    by_cases z : deposit=0
    · simpa [z,Cash.payment] using pay
    · simpa [Cash.payment,z] using pay

theorem immediateRedemption (s : State) (cash units rem deposit added : Nat)
    (cashCap : cash+deposit<2^128) (unitCap : units+added<2^128)
    (book : (cash=0 ∧ units=0 ∧ rem=0) ∨ (0<units ∧ rem<cash*10^9))
    (mint : Inv05.mint s deposit units (cash*10^9-rem) = some added) :
    ∃ paid, redeem s (cash+deposit) (units+added) rem added = some paid ∧ (paid=deposit ∨ paid=deposit-1) := by
  rcases book with ⟨rfl,rfl,rfl⟩ | ⟨up,np⟩
  · simp only [Nat.zero_add] at *
    have init := Inv05.mintAllUnits s deposit 0 0 cashCap (by decide) (by decide) (Or.inl rfl)
    change Inv05.mint s deposit 0 0 = some added at mint
    rw [mint] at init
    change some added = some (deposit*10^9) at init
    cases init
    exact ⟨deposit,(firstRedemption s deposit cashCap unitCap).2,Or.inl rfl⟩
  · exact fundedRedemption s cash units rem deposit added cashCap unitCap up np mint
end Inv06

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for dep in ← collectAxioms ``Inv06.immediateRedemption do
    unless allowed.contains dep do throwError "Unexpected INV-06 axiom {dep}"

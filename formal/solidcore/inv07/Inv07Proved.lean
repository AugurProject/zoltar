import Inv06Proved

open SolidCore.Solidity.Source
namespace Inv07

private theorem residual (u b n s : Nat) (up : 0<u) (sp : 0<s) (balance : b≤u) :
    let p := b*n/(u*s)
    p*s≤n ∧ n*(u-b) ≤ (n-p*s)*u ∧ (n-p*s)*u-n*(u-b)<u*s := by
  let p := b*n/(u*s)
  let left := n*(u-b)
  let right := (n-p*s)*u
  have bound : p*(u*s)≤b*n := Nat.div_mul_le_self _ _
  have all : (p*s)*u≤n*u := by
    calc
      (p*s)*u = p*(u*s) := by ac_rfl
      _ ≤ b*n := bound
      _ ≤ u*n := Nat.mul_le_mul_right n balance
      _ = n*u := Nat.mul_comm _ _
  have enough := Nat.le_of_mul_le_mul_right all up
  have remainder := Nat.mod_add_div (b*n) (u*s)
  have small := Nat.mod_lt (b*n) (Nat.mul_pos up sp)
  have split : left+n*b=n*u := by dsimp [left]; rw [←Nat.mul_add,Nat.sub_add_cancel balance]
  have cash : right+(p*s)*u=n*u := by dsimp [right]; rw [←Nat.add_mul,Nat.sub_add_cancel enough]
  rw [Nat.mul_comm (u*s) _, show p*(u*s)=(p*s)*u by ac_rfl] at remainder
  rw [Nat.mul_comm n b] at split
  change p*s≤n ∧ left≤right ∧ right-left<u*s
  omega

/-- A partial burn preserves or increases the remaining net backing per unit.
The cross-multiplied increase is less than one raw cash unit times the original
unit supply. The final burn pays the entire raw cash balance including carry. -/
theorem remainingBacking (state : State) (cash units carry : Nat)
    (cap : cash<2^128) (book : units<2^128) (up : 0<units) (backed : carry≤cash*10^9) :
    let net := cash*10^9-carry
    (∀ burned, burned<units → ∃ paid, Inv06.redeem state cash units carry burned = some paid ∧
      paid=burned*net/(units*10^9) ∧ paid*10^9≤net ∧
      net*(units-burned) ≤ (net-paid*10^9)*units ∧
      (net-paid*10^9)*units-net*(units-burned)<units*10^9) ∧
    Inv06.redeem state cash units carry units = some cash := by
  dsimp only
  constructor
  · intro burned partialBurn
    have call := Inv06.publicRedeem state cash units carry burned cap book (Nat.le_of_lt partialBurn) backed
    have price : Inv06.Cash.payment cash units carry burned = burned*(cash*10^9-carry)/(units*10^9) := by
      by_cases z : burned=0
      · simp [Inv06.Cash.payment,z]
      · simp [Inv06.Cash.payment,z,Nat.ne_of_lt partialBurn,Inv03.rawValue]
    rw [price] at call
    exact ⟨_,call,rfl,residual units burned _ _ up (by decide) (Nat.le_of_lt partialBurn)⟩
  · simpa [Inv06.Cash.payment,Nat.ne_of_gt up] using Inv06.publicRedeem state cash units carry units cap book (Nat.le_refl _) backed
end Inv07

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for dep in ← collectAxioms ``Inv07.remainingBacking do
    unless allowed.contains dep do throwError "Unexpected INV-07 axiom {dep}"

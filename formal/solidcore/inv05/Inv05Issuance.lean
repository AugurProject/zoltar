import Lean
namespace Inv05
theorem issuance (cash units net : Nat) (funded : 0<net) :
    let deposit := cash*10^9
    let added := deposit*units/net
    added*net ≤ deposit*units ∧ deposit*units-added*net < net ∧
      net*(units+added) ≤ (net+deposit)*units := by
  dsimp only
  let p := cash*10^9*units
  have conserved := Nat.mod_add_div p net
  have residual := Nat.mod_lt p funded
  rw [Nat.mul_comm net (p/net)] at conserved
  change p/net*net ≤ p ∧ p-p/net*net < net ∧ net*(units+p/net) ≤ (net+cash*10^9)*units
  rw [Nat.mul_add,Nat.add_mul,Nat.mul_comm net (p/net)]
  change p/net*net ≤ p ∧ p-p/net*net < net ∧ net*units+p/net*net ≤ net*units+p
  omega
end Inv05

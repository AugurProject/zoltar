import Inv01PriceBoundary
import Inv02Bindings
import Inv02Call
import Inv02Target

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv02

private theorem accepts : getter.acceptsValue (Call.ctx indexModel).value = true := by native_decide

abbrev maximumHealthyPrice := Call.maximumHealthyPrice indexModel
private abbrev publicPrice := Call.publicPrice indexModel getter (Option.some_get _).symm getterParams getterReturns
  getterBody productLinked floorLinked accepts

/-- Both external calls return the same price for any positive number of representable lots. -/
theorem gridPrice (s : State) (r k m n : Nat) (kp : 0<k) (mp : 0<m) (np : 0<n)
    (grid : m/m.gcd 10000 ∣ r) (repFits : n*r<R) (commitFits : n*k<R) (multFits : m<R)
    (baseFits : n*r*10000/m<R) (priceFits : price r k m<R) :
    maximumHealthyPrice s r k m = some (price r k m) ∧
    maximumHealthyPrice s (n*r) (n*k) m = some (price r k m) := by
  have repLe : r≤n*r := Nat.le_mul_of_pos_left _ np
  have commitLe : k≤n*k := Nat.le_mul_of_pos_left _ np
  have baseLe : r*10000/m≤n*r*10000/m := Nat.div_le_div_right (Nat.mul_le_mul_right 10000 repLe)
  have eq := scaled r k m n mp np grid
  exact ⟨publicPrice s r k m (lt_of_le_of_lt repLe repFits) (lt_of_le_of_lt commitLe commitFits)
    multFits kp mp (lt_of_le_of_lt baseLe baseFits) priceFits,
    (publicPrice s _ _ m repFits commitFits multFits (Nat.mul_pos np kp) mp baseFits (lt_of_eq_of_lt eq priceFits)).trans
      (congrArg some eq)⟩
/-- The REP supply cap discharges both mulDiv output bounds for auction lots. -/
theorem cappedGridPrice (s : State) (r k m n : Nat) (kp : 0<k) (mp : 0<m) (np : 0<n)
    (grid : m/m.gcd 10000 ∣ r) (cap : n*r≤11000000*10^18) (commitFits : n*k<R) (multFits : m<R) :
    maximumHealthyPrice s r k m = some (price r k m) ∧
    maximumHealthyPrice s (n*r) (n*k) m = some (price r k m) := by
  have oneCap := le_trans (Nat.le_mul_of_pos_left r np) cap
  exact gridPrice s r k m n kp mp np grid (lt_of_le_of_lt cap (by decide)) commitFits multFits
    (Inv01.boundedInverseFits _ _ _ cap mp (Nat.mul_pos np kp)).1
    (Inv01.boundedInverseFits _ _ _ oneCap mp kp).2

end Inv02

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for name in #[``Inv02.gridPrice,``Inv02.cappedGridPrice,``Inv02.voluntaryTargetRoundsSeparately] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-02 axiom {dep}"

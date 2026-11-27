import Inv44Getter
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv44
/-- Each bit of the actual public return is code presence at its configured address at read time;
duplicate addresses agree, high bits are zero, and the last permitted bit is included. -/
theorem deploymentMask (fuel : Nat) (c : Context) (s : State) (fields : c.storageFields=model.core.context.storageFields)
    (free : c.value=0) (cap : count s≤256) (size : wordLengths c (entry c s)) :
    ∃ m, TypeCheck.CheckedContract.callTargetWithContext? (fuel+265) model (.name "getDeploymentMask") c s [] =
      some (.returned (output c s) [.word m]) ∧
      (∀ i, i<count s → m.testBit i= !((entry c s).envAccountCode c (address s i)).isEmpty) ∧
      (∀ i j, i<count s → j<count s → address s i=address s j → m.testBit i=m.testBit j) ∧
      (∀ i, count s≤i → m.testBit i=false) ∧
      (count s=256 → m.testBit 255= !((entry c s).envAccountCode c (address s 255)).isEmpty) := by
  let p := hasCode c (entry c s)
  let n := count s
  refine ⟨mask p n,getDeploymentMask fuel c s fields free cap size,?_,?_,?_,?_⟩
  · intro i h;exact (bit p n i).trans (by simp [show i<n from h,p,hasCode];rfl)
  · intro i j hi hj equal
    apply duplicate p n i j hi hj
    change (!((entry c s).envAccountCode c (address s i)).isEmpty) = (!((entry c s).envAccountCode c (address s j)).isEmpty)
    rw [equal]
  · intro i hi;rw [bit,decide_eq_false (Nat.not_lt_of_ge hi)];rfl
  · intro hi
    have lt : 255<n := by change 255<count s;rw [hi];decide
    exact (bit p n 255).trans (by simp [lt,p,hasCode];rfl)
end Inv44

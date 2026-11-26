import Inv44
import Inv44ConstructorSuccess
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44
/-- A fresh successful deployment records its input array. A later public read uses current code
at those addresses, including duplicate addresses and index 255. -/
theorem constructedMask (deployFuel readFuel sender : Nat) (createCtx readCtx : Context) (s : State) (xs : List Nat)
    (deployFields : createCtx.storageFields=model.core.context.storageFields) (events : createCtx.eventDecls=model.core.context.eventDecls)
    (empty : s.loadSlot 0=0) (cap : xs.length≤256) (valid : Constructor.valid xs)
    (readFields : readCtx.storageFields=model.core.context.storageFields) (free : readCtx.value=0)
    (sizes : wordLengths readCtx (entry readCtx (Constructor.deployed deployFuel createCtx s sender xs))) :
    let configured := Constructor.deployed deployFuel createCtx s sender xs
    TypeCheck.CheckedContract.constructWithContext? (deployFuel+3) model createCtx s sender 0 [Constructor.array xs]=some (.returned configured []) ∧
    count configured=xs.length ∧
    (∀ i (h : i<xs.length), address configured i=xs[i]) ∧
    (∃ m, TypeCheck.CheckedContract.callTargetWithContext? (readFuel+265) model (.name "getDeploymentMask") readCtx configured [] =
        some (.returned (output readCtx configured) [.word m]) ∧
      (∀ i (h : i<xs.length), m.testBit i= !((entry readCtx configured).envAccountCode readCtx xs[i]).isEmpty) ∧
      (∀ i j (a : i<xs.length) (b : j<xs.length), xs[i]=xs[j] → m.testBit i=m.testBit j) ∧
      (∀ i, xs.length≤i → m.testBit i=false) ∧
      (∀ h : xs.length=256, m.testBit 255= !((entry readCtx configured).envAccountCode readCtx (xs[255]'(by omega))).isEmpty)) := by
  let configured := Constructor.deployed deployFuel createCtx s sender xs
  let base := entry (Constructor.context deployFuel createCtx sender) s
  have N : count configured=xs.length := Constructor.installCount xs base cap
  have A (i : Nat) (ok : i<xs.length) : address configured i=xs[i] := by
    have small := valid xs[i] (List.getElem_mem ok)
    have normalized : Shared.Account.addressWord xs[i]=xs[i] := by
      unfold Shared.Account.addressWord
      rw [show Shared.norm xs[i]=xs[i] from Nat.mod_eq_of_lt (lt_trans small (by decide : 2^160<R))]
      exact Nat.mod_eq_of_lt small
    exact (Constructor.installAddress xs base i ok cap).trans normalized
  obtain ⟨m,call,bits,duplicates,high,_⟩ := deploymentMask readFuel readCtx configured readFields free (N ▸ cap) sizes
  refine ⟨Constructor.construct deployFuel createCtx s sender xs deployFields events empty cap valid,N,A,m,call,?_,?_,?_,?_⟩
  · intro i ok
    simpa only [A i ok] using bits i (N ▸ ok)
  · intro i j hi hj same
    exact duplicates i j (N ▸ hi) (N ▸ hj) ((A i hi).trans (same.trans (A j hj).symm))
  · intro i hi;exact high i (N ▸ hi)
  · intro h
    have hi : 255<xs.length := by omega
    simpa only [A 255 hi] using bits 255 (N ▸ hi)
end Inv44

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for th in #[``Inv44.deploymentMask,``Inv44.constructedMask,``Inv44.Constructor.rejectsOversize] do
    for dep in ← collectAxioms th do
      unless allowed.contains dep do throwError "Unexpected INV-44 axiom {dep}"

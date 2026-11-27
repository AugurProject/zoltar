import Inv32Observed
open Inv32Division Inv32Dispatch Inv32Wrapper Inv32Observed
namespace Inv32Source
theorem inverseExecution (x y a f : Nat) (hx : x<R) (hy : y<R) (ha : a<R) (hf : f<R) :
    quote "quoteExactOutput" x y a f =
      observation ((Inv32.quoteExactOutput x y a f).map (fun q => (q,Inv32InverseCall.netFee x y a q))) := by
  apply publicQuote .inverse _ _ _ _ _ hx hy ha hf
  let r := work initial .inverse x y a f 0 0
  have run := Inv32InverseCall.call 49963 ctx r s0 s1 s2 s3 (targets .inverse) x y a f hx hy ha hf rfl rfl rfl rfl
  unfold Inv32InverseCall.Binds at run
  cases Q : Inv32.quoteExactOutput x y a f <;> rw [Q] at run <;> exact run
theorem inverseSound : InverseSound := by
  intro x y a f q hx hy ha hf ret
  obtain ⟨paid,h⟩ := ret
  rw [inverseExecution x y a f hx hy ha hf] at h
  cases Q : Inv32.quoteExactOutput x y a f with
  | none => simp [Q,observation] at h
  | some v =>
    have pair : v=q ∧ Inv32InverseCall.netFee x y a v=paid := by simpa [Q,observation] using h
    rw [pair.1]
end Inv32Source

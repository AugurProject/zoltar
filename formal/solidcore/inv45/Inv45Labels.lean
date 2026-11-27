import Inv45Text
open Inv45.Decimal
namespace Inv45.Text
theorem signedInjective : Function.Injective signed := by
  intro u v eq
  have noDash (n : Nat) : 45∉numeric n := by
    intro mem;have := allowed n 45 mem;omega
  by_cases un : u<0 <;> by_cases vn : v<0
  · simp only [signed,if_pos un,if_pos vn,List.cons.injEq,true_and] at eq
    have e := numericInjective eq
    have a := Int.eq_neg_natAbs_of_nonpos un.le
    have b := Int.eq_neg_natAbs_of_nonpos vn.le
    exact a.trans ((congrArg (fun n : Nat => -(n:Int)) e).trans b.symm)
  · simp only [signed,if_pos un,if_neg vn] at eq
    exact False.elim (noDash _ (eq ▸ List.mem_cons_self))
  · simp only [signed,if_neg un,if_pos vn] at eq
    exact False.elim (noDash _ (eq.symm ▸ List.mem_cons_self))
  · simp only [signed,if_neg un,if_neg vn] at eq
    have e := numericInjective eq
    have a := Int.natAbs_of_nonneg (show 0≤u by omega)
    have b := Int.natAbs_of_nonneg (show 0≤v by omega)
    omega
theorem notSpace (v : Int) : ∀ch∈signed v, (ch != 32)=true := by
  intro b mem;unfold signed at mem
  split at mem
  · rcases List.mem_cons.mp mem with dash|num
    · simp [dash]
    · have := allowed _ _ num; simp;omega
  · have := allowed _ _ mem;simp;omega
theorem header (v : Int) (u : List Nat) (n : Nat) (k : Option Nat) :
    (label v u n k).takeWhile (· != 32)=signed v := by
  unfold label
  rw [List.takeWhile_append_of_pos (notSpace _)]
  cases u <;> cases k <;> simp [unitBytes,suffix]
theorem suffixInjective (n : Nat) : Function.Injective (suffix n) := by
  intro x y eq
  cases x with
  | none => cases y <;> simp_all [suffix]
  | some a =>
    cases y with
    | none => simp [suffix] at eq
    | some b =>
      change [32,40,116,105,99,107,32]++decimal a++[32,111,102,32]++decimal n++[41]=_ at eq
      simp only [suffix,List.append_left_inj,List.append_right_inj] at eq
      exact congrArg some (injective eq)
theorem labelDistinct (lo hi : Int) (n : Nat) (unit : List Nat) (x y : Nat) (rise : lo<hi) (pos : 0<n)
    (equal : label (Scale.display lo (hi-lo).toNat n x) unit n (Scale.tag (hi-lo).toNat n x)=
      label (Scale.display lo (hi-lo).toNat n y) unit n (Scale.tag (hi-lo).toNat n y)) : x=y := by
  have p := congrArg (List.takeWhile (· != 32)) equal
  simp only [header] at p
  have num := signedInjective p
  unfold label at equal
  rw [num] at equal
  have tick := suffixInjective n (List.append_cancel_left (List.append_cancel_left equal))
  apply Scale.pairInjective (d:=(hi-lo).toNat) (by omega) pos
  apply Prod.ext
  · exact Int.ofNat_inj.mp (Int.add_left_cancel num)
  · exact tick
end Inv45.Text

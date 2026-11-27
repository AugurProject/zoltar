import Inv12CallRun
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

theorem readList (c : Context) (r : Runtime) (exprs : List Source.Expr) (words : List Nat)
    (reads : List.Forall₂ (Inv40.Reads c r) exprs words) (fuel : Nat) (enough : Expr.listEvalFuel exprs≤fuel) :
    Expr.evalListFuel fuel c r exprs=pure (words.map Value.word,r) := by
  induction reads generalizing fuel with
  | nil => cases fuel <;> simp_all [Expr.listEvalFuel,Expr.evalListFuel]
  | @cons e v es vs head tail ih =>
    cases fuel with
    | zero => simp [Expr.listEvalFuel] at enough
    | succ k =>
      change e.orderFuel + Expr.listEvalFuel es + 1≤k+1 at enough
      rw [Expr.evalListFuel,head k (by omega)]
      simp only [Inv08.Authority.bindPure,ih k (by omega),List.map_cons]

theorem materialWords (c : Context) (r : Runtime) (xs : List Nat) :
    r.materializeForValueUseList c (xs.map Value.word)=.ok (xs.map Value.word) := by
  induction xs with
  | nil => rfl
  | cons x xs ih => simp [Runtime.materializeForValueUseList,Runtime.materializeForValueUse,
      Runtime.materializeForValueUseFuel,ih,Bind.bind,Except.bind]

theorem bytesClean (n v : Nat) : (wordToBytesBE n v).map normByte=wordToBytesBE n v := by
  induction n generalizing v with
  | zero => rfl
  | succ n ih => simp [wordToBytesBE,ih,normByte,Shared.Account.byte]
end Inv12

import Inv45TrimLoop
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Bytes
private def types : List Source.Ty→Nat→Bool
  | [],0=>true
  | .bytesCalldata::ts,n+1=>types ts n
  | _,_=>false
private theorem typesExact {ts n} (h : types ts n) : ts=List.replicate n .bytesCalldata := by
  induction n generalizing ts with
  | zero => cases ts <;> simp_all [types]
  | succ n ih =>
    cases ts with
    | nil => contradiction
    | cons t tail => cases t <;> simp_all [types,List.replicate_succ];exact ih h
def pack (xs : List (Pattern Source.Expr)) : Pattern Source.Expr where
  value:=.encode .packed none (List.replicate xs.length 0) (List.replicate xs.length .bytesCalldata) (seq xs).value
  test
    | .encode .packed none widths tys args => widths==List.replicate xs.length 0 &&
        types tys xs.length && (seq xs).test args
    | _=>false
  sound v h:=by
    split at h
    next widths tys args => simp only [Bool.and_eq_true,beq_iff_eq] at h;rw [h.1.1,typesExact h.1.2,(seq xs).sound _ h.2]
    next => contradiction
inductive ByteParts (c : Context) (r : Runtime) : List (Pattern Source.Expr)→List (List Nat)→Prop where
  | nil : ByteParts c r [] []
  | cons {e xs bs rest} (read : Inv45.Reads c r e.value (.bytes bs)) (sane : ∀x∈bs,x<256)
      (tail : ByteParts c r xs rest) : ByteParts c r (e::xs) (bs::rest)
theorem ByteParts.count {c r xs bs} (h : ByteParts c r xs bs) : xs.length=bs.length := by induction h <;> simp_all
theorem ByteParts.abi {c r xs bs} (h : ByteParts c r xs bs) :
    abiEncodePackedValues? (List.replicate xs.length 0) (List.replicate xs.length .bytesCalldata) (bs.map Value.bytes)=some bs.flatten := by
  induction h with
  | nil => rfl
  | cons rd sane tail ih => simp [List.replicate_succ,abiEncodePackedValues?,abiEncodePackedValue?,normBytes _ sane,ih]
theorem ByteParts.evalList {c r xs bs} (h : ByteParts c r xs bs) (fuel : Nat) (enough : Expr.listEvalFuel (seq xs).value≤fuel) :
    Expr.evalListFuel fuel c r (seq xs).value=pure (bs.map Value.bytes,r) := by
  induction h generalizing fuel with
  | nil =>
    cases fuel with | zero => change 1≤0 at enough;omega | succ f=>rfl
  | @cons e xs b bs rd sane tail ih =>
    change e.value.orderFuel+Expr.listEvalFuel (seq xs).value+1≤fuel at enough
    cases fuel with
    | zero => omega
    | succ f =>
      change Expr.evalListFuel (f+1) c r (e.value::(seq xs).value)=_
      rw [Expr.evalListFuel,rd _ (by omega)];simp only [Inv08.Authority.bindPure]
      rw [ih f (by omega)];rfl
theorem materialize (c : Context) (r : Runtime) (bs : List (List Nat)) :
    r.materializeForValueUseList c (bs.map Value.bytes)=.ok (bs.map Value.bytes) := by
  induction bs with
  | nil => rfl
  | cons b bs ih =>
    simp only [List.map_cons,Runtime.materializeForValueUseList,Runtime.materializeForValueUse,Runtime.materializeForValueUseFuel,ih]
    rfl
theorem packedRead {c r xs bs} (h : ByteParts c r xs bs) : Inv45.Reads c r (pack xs).value (.bytes bs.flatten) := by
  intro fuel enough
  change 0+Expr.listEvalFuel (seq xs).value+1≤fuel at enough
  cases fuel with
  | zero => omega
  | succ f =>
    change Expr.evalFuel (f+1) c r (.encode .packed none _ _ (seq xs).value)=_
    rw [Expr.evalFuel];dsimp only;rw [h.evalList f (by omega)]
    simp only [Inv08.Authority.bindPure,materialize,Inv08.Authority.liftPure,h.abi]
theorem literalBytes (c : Context) (r : Runtime) (bs : List Nat) (sane : ∀v∈bs,v<256) :
    Inv45.Reads c r (Decimal.bytesLiteral bs).value (.bytes bs) := by
  intro n hn;cases n with
  | zero=>change 1≤0 at hn;omega
  | succ n=>change (pure (Value.bytes (bs.map normByte),r) : SolI (Value × Runtime))=_;rw [normBytes _ sane]
end Inv45.Bytes

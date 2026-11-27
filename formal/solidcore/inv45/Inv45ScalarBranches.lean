import Inv45ScalarBytes
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
open Bytes
theorem nonzero {c r e v} (rd : Inv40.Reads c r (e : Pattern Source.Expr).value v) (fit : v<R) :
    Inv40.Reads c r (neZero e).value (if v=0 then 0 else 1) := by
  apply Inv08.ReleaseQuote.binary rd (Inv08.Authority.literal c r 0 (by decide)) .ne
    (by intro h;cases h) (by intro h;cases h)
  change Except.ok (Value.word (boolWord (!(wordEq v 0))))=_
  have N : Shared.norm v=v := Nat.mod_eq_of_lt fit
  by_cases zero : v=0
  · subst v;rfl
  · simp [wordEq,N,zero,boolWord,show Shared.norm 0=0 from rfl]
theorem tagRead (c : Context) (r : Runtime) (k d n : Nat) (K : k<R) (D : d<R) (N : n<R) (pos : 0<n)
    (payout : r.lookupLocal? "payout"=some (.word k)) (delta : r.lookupLocal? "diffU"=some (.word d))
    (ticks : r.lookupLocal? "numTicks"=some (.word n)) :
    Inv40.Reads c r tagCond.value (if d<n ∧ k*d%n≠0 then 1 else 0) := by
  let a := Expr_binary BinaryOp_lt (wvar "diffU") (wvar "numTicks")
  let b := neZero (clean (Expr_mulMod (varP "payout") (varP "diffU") (varP "numTicks")))
  have lhs : Inv40.Reads c r a.value (if d<n then 1 else 0) :=
    Inv08.ReleaseQuote.binary (MulDiv.wordVar _ _ _ _ D delta) (MulDiv.wordVar _ _ _ _ N ticks) .lt
      (by intro h;cases h) (by intro h;cases h) (Inv32QuoteExpr.lt _ _ _ D N)
  have rhs : Inv40.Reads c r b.value (if k*d%n=0 then 0 else 1) := nonzero
    (MulDiv.remainderRead (l:=varP "payout") (m:=varP "diffU") (dst:=varP "numTicks") (Inv08.localReads _ _ _ _ payout)
      (Inv08.localReads _ _ _ _ delta) (Inv08.localReads _ _ _ _ ticks) K D N pos) (lt_trans (Nat.mod_lt _ pos) N)
  intro fuel enough;change a.value.orderFuel+b.value.orderFuel+1≤fuel at enough
  cases fuel with
  | zero => omega
  | succ f =>
    change Expr.evalFuel (f+1) c r (.binary .boolAnd a.value b.value)=_
    rw [Expr.evalFuel,lhs f (by omega)]
    by_cases small : d<n
    · rw [if_pos small]
      change (do let (v,z) ← Expr.evalFuel f c r b.value
                 let w ← liftM v.expectWord
                 pure (Value.word (boolWord (wordTruthy w)),z))=_
      rw [rhs f (by omega)]
      by_cases eq : k*d%n=0
      · rw [if_pos eq,if_neg (by simp [eq])];rfl
      · rw [if_neg eq,if_pos ⟨small,eq⟩];rfl
    · rw [if_neg small,if_neg (by simp [small])]
      rfl
theorem appendUnit (fuel : Nat) (c : Context) (r : Runtime) (labId uniId : Nat) (lab unit : List Nat)
    (label : r.loadMemory? labId=some (.bytes lab)) (lBound : labId<r.nextMemory)
    (labelSane : ∀v∈lab,v<256) (unitSane : ∀v∈unit,v<256) (len : unit.length<R)
    (unitRef : Ref r "unit" uniId unit) :
    ∃z id, Retains r z ∧ id<z.nextMemory ∧ z.loadMemory? id=some (.bytes (lab++Text.unitBytes unit)) ∧
      Stmt.eval (fuel+2) model.core.table c (r.declareLocal "label" (.memoryRef labId)) withUnit.value=
        pure (.normal ((localsOf z r).declareLocal "label" (.memoryRef id))) := by
  let s := r.declareLocal "label" (.memoryRef labId)
  have u : Ref s "unit" uniId unit := ⟨(lookupDecl _ _ _ _ (by decide)).trans unitRef.pointer,unitRef.cell⟩
  have labelR : Ref s "label" labId lab := ⟨declarePtr _ _ _,label⟩
  have condition := nonzero (e:=size "unit") (Inv08.ReleaseQuote.readClean (Bytes.length c s _ _ _ u) len) len
  by_cases zero : unit=[]
  · rw [show unit.length=0 by simp [zero],if_pos rfl] at condition
    have sk := MulDiv.branchFalse (fuel+1) model.core.table c s addUnit Stmt_skip _ condition
    refine ⟨r,labId,unchanged _,lBound,by simpa [zero,Text.unitBytes] using label,sk.trans ?_⟩
    rw [show Stmt_skip.value=Stmt.skip from rfl,Stmt.eval];rfl
  · rw [if_neg (by simpa using zero)] at condition
    let bs := lab++32::unit
    let a := allocate s bs
    let done := (localsOf a r).declareLocal "label" (.memoryRef s.nextMemory)
    have parts : ByteParts c s [varP "label",Decimal.bytesLiteral [32],varP "unit"] [lab,[32],unit] :=
      .cons (val _ _ _ _ _ labelR) labelSane (.cons (literalBytes _ _ _ (by decide)) (by decide) (.cons (val _ _ _ _ _ u) unitSane .nil))
    have raw : (allocate s [lab,[32],unit].flatten).assignLocalRaw? "label" (.memoryRef s.nextMemory)=some done := by
      have H : [lab,[32],unit].flatten=bs := by simp [bs]
      rw [H];exact reassignTop (localsOf a r) _ labId _
    have exec := assignPack fuel model.core.table "label" labId done parts labelR.pointer raw
    have br := Inv32Blocks.branch (fuel+1) model.core.table c s _ addUnit.value .skip true (condition _ (by decide))
    refine ⟨a,s.nextMemory,⟨rfl,Nat.le_succ _,(allocated s _).memory⟩,Nat.lt_succ_self _,?_,br.trans exec⟩
    simpa [Text.unitBytes,zero,bs] using load s s.nextMemory bs
end Inv45.Scalar

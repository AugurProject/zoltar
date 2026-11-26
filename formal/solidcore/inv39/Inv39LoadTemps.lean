import Inv39WrapperTerms
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Auth
def ordinaryTemp (k : String) := ["from","to","value","validAfter","validBefore","nonce","v","r","s"].all (fun name=>!(k==name))
theorem tempSeen (p : Payment) (r : Runtime) (x : Source.Value) (k : String) (ok : ordinaryTemp k) (prior : Seen p r) : Seen p (r.declareLocal k x) := by
  simp [ordinaryTemp] at ok
  constructor <;> rw [otherDeclared] <;> first | exact prior.from_ | exact prior.to_ | exact prior.value | exact prior.after_ | exact prior.before_ | exact prior.nonce | exact prior.v | exact prior.r | exact prior.s | tauto
theorem temporaries (n : Nat) (c : Context) (r : Runtime) (p : Payment) (bs : List Source.Byte) (ss : List Source.Stmt)
    (w : Widths p) (seen : Seen p r) : Stmt.evalList (n+1) model.core.table c r (loadAll bs++ss)=Stmt.evalList (n+1) model.core.table c (temps r bs p) ss := by
  let t := model.core.table
  let q0 := r
  have seen0 : Seen p q0 := seen
  let q1 := q0.declareLocal "_ic_arg_0" (.fixedBytes 32 (hashOf bs))
  have seen1 : Seen p q1 := tempSeen _ _ _ _ (by decide) seen0
  have d0 := hashTemp n t c q0 bs
  let q2 := q1.declareLocal "_ic_arg_1" (.word p.from_)
  have seen2 : Seen p q2 := tempSeen _ _ _ _ (by decide) seen1
  have d1 := Inv32Hoist.declEval n t c q1 "_ic_arg_1" .address (.var "from") p.from_ (Inv32Guards.readWord _ _ _ _ _ seen1.from_) rfl
  let q3 := q2.declareLocal "_ic_arg_2" (.word p.to_)
  have seen3 : Seen p q3 := tempSeen _ _ _ _ (by decide) seen2
  have d2 := Inv32Hoist.declEval n t c q2 "_ic_arg_2" .address (.var "to") p.to_ (Inv32Guards.readWord _ _ _ _ _ seen2.to_) rfl
  let q4 := q3.declareLocal "_ic_arg_3" (.word p.value)
  have seen4 : Seen p q4 := tempSeen _ _ _ _ (by decide) seen3
  have d3 := Inv32Hoist.declEval n t c q3 "_ic_arg_3" .uint256 (.castOp .uintCleanup 256 (.var "value")) p.value (Child.readClean _ _ _ _ _ w.value seen3.value) rfl
  let q5 := q4.declareLocal "_ic_arg_4" (.word p.validAfter)
  have seen5 : Seen p q5 := tempSeen _ _ _ _ (by decide) seen4
  have d4 := Inv32Hoist.declEval n t c q4 "_ic_arg_4" .uint256 (.castOp .uintCleanup 256 (.var "validAfter")) p.validAfter (Child.readClean _ _ _ _ _ w.after_ seen4.after_) rfl
  let q6 := q5.declareLocal "_ic_arg_5" (.word p.validBefore)
  have seen6 : Seen p q6 := tempSeen _ _ _ _ (by decide) seen5
  have d5 := Inv32Hoist.declEval n t c q5 "_ic_arg_5" .uint256 (.castOp .uintCleanup 256 (.var "validBefore")) p.validBefore (Child.readClean _ _ _ _ _ w.before_ seen5.before_) rfl
  let q7 := q6.declareLocal "_ic_arg_6" (.fixedBytes 32 p.nonce)
  have seen7 : Seen p q7 := tempSeen _ _ _ _ (by decide) seen6
  have d6 := fixedVarDecl n p.nonce t c q6 "_ic_arg_6" "nonce" seen6.nonce w.nonce
  let q8 := q7.declareLocal "_ic_arg_7" (.word p.v)
  have seen8 : Seen p q8 := tempSeen _ _ _ _ (by decide) seen7
  have d7 := Inv32Hoist.declEval n t c q7 "_ic_arg_7" .uint256 (.castOp .uintCleanup 8 (.var "v")) p.v (vRead c q7 p.v w.v seen7.v) rfl
  let q9 := q8.declareLocal "_ic_arg_8" (.fixedBytes 32 p.r)
  have seen9 : Seen p q9 := tempSeen _ _ _ _ (by decide) seen8
  have d8 := fixedVarDecl n p.r t c q8 "_ic_arg_8" "r" seen8.r w.r
  let q10 := q9.declareLocal "_ic_arg_9" (.fixedBytes 32 p.s)
  have d9 := fixedVarDecl n p.s t c q9 "_ic_arg_9" "s" seen9.s w.s
  unfold loadAll; simp only [List.cons_append,List.nil_append]
  rw [
    seqStep _ _ _ _ _ _ _ d0,
    seqStep _ _ _ _ _ _ _ d1,
    seqStep _ _ _ _ _ _ _ d2,
    seqStep _ _ _ _ _ _ _ d3,
    seqStep _ _ _ _ _ _ _ d4,
    seqStep _ _ _ _ _ _ _ d5,
    seqStep _ _ _ _ _ _ _ d6,
    seqStep _ _ _ _ _ _ _ d7,
    seqStep _ _ _ _ _ _ _ d8,
    seqStep _ _ _ _ _ _ _ d9]
  rfl
end Inv39.Auth

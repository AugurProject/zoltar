import Inv45ByteStore
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Decimal
def withMemory (r : Runtime) (m : MemoryMap) := {r with memory:=m}
def slots (r : Runtime) (outId id n d : Nat) :=
  ((r.withFrame [(number,.word n),("_ret0",.memoryRef outId)]).pushScope).withFrame
    [("buffer",.memoryRef id),("digits",.word d),("tempValue",.word 0)]
def fill (d : Nat) (suffix : List Nat) := List.replicate d 0 ++ suffix
theorem fillValid (d : Nat) (suffix : List Nat) (S : ∀ch∈suffix,ch<256) : ∀ch∈fill d suffix,ch<256 := by
  intro ch member;rcases List.mem_append.mp member with m|s
  · have := List.eq_of_mem_replicate m;omega
  · exact S _ s
macro "digit_store" : tactic => `(tactic|
  simp [slots,number,Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,
    LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem preserveCast {c r k w e val} (E : Expr.eval c r (.castOp k w e)=pure (val,r)) :
    Expr.evalMemoryRefPreserving c r (.castOp k w e) = pure (val,r) := by
  unfold Expr.evalMemoryRefPreserving Expr.memoryRefOrValue
  rw [Expr.memoryRefOrValueFuel.eq_def];dsimp only
  change Expr.evalFuel (_+1) c r (.castOp k w e)=_ at E
  rw [E];rfl
theorem digitStep (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (outId id n d : Nat) (suffix : List Nat)
    (N : n<R) (D : d+1<R) (S : ∀ch∈suffix,ch<256) (buf : r.loadMemory? id=some (.bytes (fill (d+1) suffix))) :
    let byte := 48+n%10
    let dst := Bytes.overwrite r id (fill d (byte::suffix))
    Stmt.eval (fuel+2) t c (slots r outId id n (d+1)) digitBody.value = pure (.normal (slots dst outId id (n/10) d)) := by
  let b := 48+n%10
  let s := slots r outId id n (d+1)
  let m := slots r outId id n d
  let dst := Bytes.overwrite r id (fill d (b::suffix))
  let changed := slots dst outId id n d
  let done := slots dst outId id (n/10) d
  have subtract := Inv32QuoteExpr.subWord c.checked (d+1) 1 D (by decide) (by omega)
  rw [Nat.add_sub_cancel] at subtract
  have down := update fuel t c s.pushScope m.pushScope false "digits" (d+1) d rfl (by omega) subtract (by dsimp [m,s];digit_store)
  have byteread := digitRead c m.pushScope n N rfl
  have rhs : Expr.evalMemoryRefPreserving c m.pushScope encodedDigit.value=pure (.fixedBytes 1 b,m.pushScope) := by
    apply preserveCast
    exact byteread _ (Nat.le_succ _)
  have put : listUpdateAt? (fill (d+1) suffix) d b=some (fill d (b::suffix)) := by
    have h := Bytes.setIndex (List.replicate d 0) suffix 0 b
    simpa [fill,List.replicate_succ',List.append_assoc] using h
  have W := Bytes.assign fuel t c m.pushScope "buffer" (.var "digits") encodedDigit.value id d b _ _
    rfl (by omega) (Inv08.localReads _ _ _ _ rfl) rhs buf
    (by dsimp [b];have := Nat.mod_lt n (by decide : 0<10);omega) (fillValid _ _ S) put
  have divideN := divideExec fuel t c changed.pushScope done.pushScope number n rfl N (by dsimp [changed,done];digit_store)
  have list : Stmt.evalList (fuel+1) t c s.pushScope [(adjust false "digits").value,(writeByte encodedDigit).value,(divide number).value]=pure (.normal done.pushScope) := by
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ down).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ W).trans ?_
    exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ divideN).trans (by rw [Stmt.evalList])
  change Stmt.eval (fuel+2) t c s (.block [_,_,_])=_
  rw [Stmt.eval];dsimp only;rw [list];rfl
theorem scan (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (outId id n : Nat) (suffix : List Nat)
    (N : n<R) (S : ∀ch∈suffix,ch<256) (M : r.loadMemory? id=some (.bytes (fill (reversed n).length suffix))) :
    ∃ endMem : MemoryMap, let dst := withMemory r endMem
      dst.loadMemory? id=some (.bytes ((reversed n).reverse++suffix)) ∧
      (∀ j, j≠id → dst.loadMemory? j=r.loadMemory? j) ∧
      Stmt.evalWhile (fuel+3+(reversed n).length) t c (slots r outId id n (reversed n).length)
        (notZero number).value digitBody.value=pure (.normal (slots dst outId id 0 0)) := by
  induction n using Nat.strong_induction_on generalizing r suffix with
  | h n ih =>
    have test := testNonzero c (slots r outId id n (reversed n).length) number n N rfl
    by_cases z : n=0
    · subst n;rw [if_pos rfl] at test
      have empty : reversed 0=[] := by rw [reversed];rfl
      rw [empty] at M test ⊢
      refine ⟨r.memory,M,fun _ _=>rfl,?_⟩
      exact stopLoop _ _ _ _ _ _ test
    · rw [if_neg z] at test
      have digits : reversed n=(48+n%10)::reversed (n/10) := by rw [reversed,dif_neg z]
      rw [digits,List.length_cons] at M test ⊢
      let d := (reversed (n/10)).length
      let b := 48+n%10
      let mid := Bytes.overwrite r id (fill d (b::suffix))
      have fit : (reversed n).length≤78 := lengthBound n (lt_trans N (by decide : R<10^78))
      rw [digits,List.length_cons] at fit
      have step := digitStep (fuel+1+d) t c r outId id n d suffix N (lt_of_le_of_lt fit (by decide)) S M
      have nextBytes : ∀ch∈b::suffix,ch<256 := by
        intro ch mem;rcases List.mem_cons.mp mem with val|tail
        · dsimp [b] at val;have := Nat.mod_lt n (by decide : 0<10);omega
        · exact S ch tail
      obtain ⟨final,bytes,keep,finish⟩ := ih (n/10) (Nat.div_lt_self (Nat.pos_of_ne_zero z) (by decide)) mid (b::suffix)
        (lt_of_le_of_lt (Nat.div_le_self ..) N) nextBytes (Bytes.load _ _ _)
      refine ⟨final,?_,?_,?_⟩
      · simpa only [List.reverse_cons,List.append_assoc,List.singleton_append] using bytes
      · intro j diff;exact (keep j diff).trans (Bytes.elsewhere _ _ _ _ diff)
      · rw [show fuel+3+((reversed (n/10)).length+1)=(fuel+1+d+2)+1 by dsimp [d];omega,stepLoop _ _ _ _ _ _ _ test step]
        rw [show fuel+1+d+2=fuel+3+d by omega];exact finish
end Inv45.Decimal

import Inv45ByteAccess
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Bytes
def copyBuffer (before data after : List Nat) (i : Nat) :=
  (before ++ data.take i) ++ (List.replicate (data.length-i) 0 ++ after)
theorem copyUpdate (before data after : List Nat) (i : Nat) (inside : i<data.length) :
    listUpdateAt? (copyBuffer before data after i) (before.length+i) data[i]=
      some (copyBuffer before data after (i+1)) := by
  let front := before++data.take i
  have len : front.length=before.length+i := by simp [front,Nat.min_eq_left inside.le]
  have count : data.length-i=(data.length-(i+1))+1 := by omega
  have h := setIndex front (List.replicate (data.length-(i+1)) 0++after) 0 data[i]
  rw [len] at h
  simpa only [copyBuffer,List.take_succ_eq_append_getElem inside,count,List.replicate_succ,
    List.cons_append,List.append_assoc,List.singleton_append,front] using h
theorem copySane (a b c : List Nat) (i : Nat) (A : ∀v∈a,v<256) (B : ∀v∈b,v<256) (C : ∀v∈c,v<256) :
    ∀v∈copyBuffer a b c i,v<256 := by
  intro v here;unfold copyBuffer at here;simp only [List.mem_append] at here
  rcases here with (ha|hb)|(hz|hc)
  · exact A v ha
  · exact B v (List.mem_of_mem_take hb)
  · have := List.eq_of_mem_replicate hz;omega
  · exact C v hc
def active (r : Runtime) (mem : MemoryMap) (i : Nat) := ((Decimal.withMemory r mem).withFrame [("index",.word i)]).pushScope
def SameElsewhere (r : Runtime) (mem : MemoryMap) (id : Nat) :=
  ∀j, j≠id → (Decimal.withMemory r mem).loadMemory? j=r.loadMemory? j
structure CopyReads (c : Context) (r : Runtime) (id : Nat) (dest : String) (offset : Nat) (bs : List Nat)
    (limit idx rhs : Pattern Source.Expr) : Prop where
  limitRead : ∀m i, SameElsewhere r m id → Inv40.Reads c (active r m i) limit.value bs.length
  target : ∀m i, (active r m i).pushScope.lookupLocal? dest=some (.memoryRef id)
  indexRead : ∀m i, i<bs.length → SameElsewhere r m id → Inv40.Reads c (active r m i).pushScope idx.value (offset+i)
  byteRead : ∀m i (inside : i<bs.length), SameElsewhere r m id →
    Expr.evalMemoryRefPreserving c (active r m i).pushScope rhs.value=pure (.word bs[i],(active r m i).pushScope)
theorem copyLoop (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (id : Nat) (dest : String)
    (before data after : List Nat) (limit idx rhs : Pattern Source.Expr)
    (reads : CopyReads c r id dest before.length data limit idx rhs)
    (fits : before.length+data.length<R) (A : ∀v∈before,v<256) (B : ∀v∈data,v<256) (C : ∀v∈after,v<256)
    (initial : r.loadMemory? id=some (.bytes (copyBuffer before data after 0))) :
    ∃ final, SameElsewhere r final id ∧ (Decimal.withMemory r final).loadMemory? id=some (.bytes ((before++data)++after)) ∧
      Stmt.eval (fuel+data.length+6) t c r (loop limit (store dest idx rhs)).value=pure (.normal (Decimal.withMemory r final)) := by
  let test := Expr_binary BinaryOp_lt (wvar "index") limit
  let post := Decimal.adjust true "index"
  let work := block [store dest idx rhs]
  have scan (remaining i : Nat) (mem : MemoryMap) (left : i+remaining=data.length)
      (same : SameElsewhere r mem id) (bytes : (Decimal.withMemory r mem).loadMemory? id=some (.bytes (copyBuffer before data after i))) :
      ∃ final, SameElsewhere r final id ∧ (Decimal.withMemory r final).loadMemory? id=some (.bytes ((before++data)++after)) ∧
        Stmt.evalFor (fuel+remaining+4) t c (active r mem i) test.value post.value work.value=
          pure (.normal (active r final data.length)) := by
    induction remaining generalizing i mem with
    | zero =>
      simp only [Nat.add_zero] at left;subst i
      refine ⟨mem,same,by simpa [copyBuffer] using bytes,?_⟩
      have ix := MulDiv.wordVar c (active r mem data.length) "index" data.length (by omega) rfl
      have tf : Inv40.Reads c (active r mem data.length) test.value 0 := by
        apply Inv08.ReleaseQuote.binary ix (reads.limitRead mem _ same) .lt (by intro h;cases h) (by intro h;cases h)
        rw [Inv32QuoteExpr.lt _ _ _ (by omega) (by omega),if_neg (by omega)]
      have cond : Expr.eval c (active r mem data.length) test.value=pure (.word 0,active r mem data.length) := tf _ (by omega)
      rw [Stmt.evalFor,cond];rfl
    | succ k ih =>
      have inside : i<data.length := by omega
      let newBs := copyBuffer before data after (i+1)
      let mem' := mem.insertLoop id (.bytes newBs)
      let src := active r mem i
      let mid := active r mem' i
      let next := active r mem' (i+1)
      have write := assignValue false (fuel+k+2) t c src.pushScope dest idx.value rhs.value id (before.length+i) data[i] _ _
        (reads.target mem i) (by omega) (reads.indexRead mem i inside same) (reads.byteRead mem i inside same)
        bytes (B _ (List.getElem_mem ..)) (copySane before data after i A B C) (copyUpdate before data after i inside)
      have workExec : Stmt.eval (fuel+k+4) t c src work.value=pure (.normal mid) :=
        Inv32Blocks.one _ t c src mid.pushScope _ write
      have inc := Decimal.update (fuel+k+3) t c mid next true "index" i (i+1) rfl (by omega)
        (Inv40.addWords _ i 1 (by omega)) (by simp [mid,next,active,Runtime.assignLocal?,
          Runtime.lookupLocal?,Runtime.withFrame,Runtime.pushScope,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
      have ix := MulDiv.wordVar c src "index" i (by omega) rfl
      have tf : Inv40.Reads c src test.value 1 := by
        apply Inv08.ReleaseQuote.binary ix (reads.limitRead mem i same) .lt (by intro h;cases h) (by intro h;cases h)
        rw [Inv32QuoteExpr.lt _ _ _ (by omega) (by omega),if_pos inside]
      have cond : Expr.eval c src test.value=pure (.word 1,src) := tf _ (by omega)
      have same' : SameElsewhere r mem' id := by
        intro j ne;exact (elsewhere (Decimal.withMemory r mem) id j newBs ne).trans (same _ ne)
      obtain ⟨endMem,other,last,rest⟩ := ih (i+1) mem' (by omega) same' (load (Decimal.withMemory r mem) id newBs)
      refine ⟨endMem,other,last,?_⟩
      change Stmt.evalFor (fuel+(k+1)+4) t c src test.value post.value work.value=_
      rw [show fuel+(k+1)+4=fuel+k+4+1 by omega,Stmt.evalFor,cond]
      change (do match ← work.value.eval (fuel+k+4) t c src with
        | .normal m | .continued m=>do
          match ← post.value.eval (fuel+k+4) t c m with
          | .normal p=>Stmt.evalFor (fuel+k+4) t c p test.value post.value work.value
          | other=>pure other
        | .broke z=>pure (.normal z)
        | other=>pure other)=_
      rw [workExec];simp only [Inv08.Authority.bindPure]
      change (do match ← Stmt.eval (fuel+k+4) t c mid (Decimal.adjust true "index").value with
        | .normal p=>Stmt.evalFor (fuel+k+4) t c p test.value post.value work.value
        | other=>pure other)=_
      rw [inc];exact rest
  obtain ⟨m,other,last,run⟩ := scan data.length 0 r.memory (by omega) (fun _ _=>rfl) initial
  refine ⟨m,other,last,?_⟩
  let s := r.withFrame [("index",.word 0)]
  let d := (Decimal.withMemory r m).withFrame [("index",.word data.length)]
  have i0 := Add.declareWord (fuel+data.length+4) t "index" (e:=num 0) (Inv08.Authority.literal c r.pushScope 0 (by decide))
  have sk : Stmt.eval (fuel+data.length+4) t c s.pushScope .skip=pure (.normal s.pushScope) := by rw [Stmt.eval]
  have forExec : Stmt.eval (fuel+data.length+5) t c s (forLoop post work test).value=pure (.normal d) := by
    change Stmt.eval _ _ _ _ (.forLoop .skip test.value post.value work.value)=_
    rw [Stmt.eval];dsimp only;rw [sk];simp only [Inv08.Authority.bindPure]
    change Stmt.evalFor _ t c s.pushScope _ _ _=_ at run
    rw [run];rfl
  apply Inv32Hoist.block _ t c r d _
  refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ i0).trans ?_
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] forExec).trans (by rw [Stmt.evalList])
end Inv45.Bytes

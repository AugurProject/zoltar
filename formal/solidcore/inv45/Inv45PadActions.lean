import Inv45PadLoops
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Bytes
theorem aliasExec (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (dest src : String) (id : Nat)
    (ptr : r.lookupLocal? src=some (.memoryRef id)) :
    Stmt.eval (fuel+1) t c r (aliasBytes dest src).value=pure (.normal (r.declareLocal dest (.memoryRef id))) := by
  have lookup : r.lookupMemoryRef? src=some id := by simp [Runtime.lookupMemoryRef?,ptr]
  have ref : Expr.memoryRefOrValue c r (.var src)=pure (some id,none,r) := by
    change Expr.memoryRefOrValueFuel 3 c r (.var src)=_
    rw [Expr.memoryRefOrValueFuel.eq_def];dsimp only;rw [lookup]
  change Stmt.eval _ _ _ _ (.memoryVarDecl .bytesCalldata dest (some (.var src)))=_
  rw [Stmt.eval];dsimp only;rw [ref];rfl
theorem retRef (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (src : String) (id : Nat)
    (ptr : r.lookupLocal? src=some (.memoryRef id)) :
    Stmt.eval (fuel+1) t c r (ret (varP src)).value=pure (.returned r [.memoryRef id]) := by
  have ref : Expr.evalReturnValue c r (.var src)=pure (.memoryRef id,r) := by simp [Expr.evalReturnValue,Runtime.lookupMemoryRef?,ptr]
  have ls : Expr.evalReturnList c r [.var src]=pure ([.memoryRef id],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [.var src]=_
    simp only [Expr.evalReturnListFuel,ref,Inv08.Authority.bindPure]
  change Stmt.eval _ _ _ _ (.returnValues [.var src])=_
  rw [Stmt.eval];dsimp only;rw [ls];rfl
end Inv45.Bytes
namespace Inv45.Pad
open Bytes
theorem enoughRead (c : Context) (r : Runtime) (src : Nat) (xs : List Nat) (small : xs.length≤18)
    (ref : Ref r "valueBytes" src xs) (len : r.lookupLocal? "totalLength"=some (.word 18)) :
    Inv40.Reads c r (Shapes.ge (size "valueBytes") (wvar "totalLength")).value (if 18≤xs.length then 1 else 0) := by
  have bound : 18<R := by decide
  exact Inv08.ReleaseQuote.binary (Inv08.ReleaseQuote.readClean (Bytes.length c r _ _ _ ref) (by omega))
    (MulDiv.wordVar c r _ _ bound len) .ge (by intro h;cases h) (by intro h;cases h)
    (Add.geWord _ _ _ (by omega) bound)
def frame (r : Runtime) (src retId : Nat) := r.withFrame [("value",.memoryRef src),("totalLength",.word 18),("_ret0",.memoryRef retId)]
theorem runData (fuel : Nat) (c : Context) (r : Runtime) (src retId : Nat) (xs : List Nat)
    (small : xs.length≤18) (sane : ∀v∈xs,v<256) (bound : src<r.nextMemory)
    (cell : r.loadMemory? src=some (.bytes xs)) (cap : c.memoryAllocationLimit?=none) :
    ∃s id, Retains r s ∧ id<s.nextMemory ∧ s.loadMemory? id=some (.bytes (Text.pad xs)) ∧
      Stmt.evalList (fuel+25) model.core.table c (frame r src retId).pushScope.pushScope (actions.map Pattern.value)=
        pure (.returned s [.memoryRef id]) := by
  let t := model.core.table
  let a := (frame r src retId).pushScope.pushScope
  let b := a.declareLocal "valueBytes" (.memoryRef src)
  let p := r.nextMemory
  let buf := allocate b (List.replicate 18 0)
  let d := buf.declareLocal "padded" (.memoryRef p)
  let n := 18-xs.length
  let e := d.declareLocal "paddingLength" (.word n)
  have aliasExec := Bytes.aliasExec (fuel+24) t c a "valueBytes" "value" src rfl
  have ref : Ref b "valueBytes" src xs := ⟨rfl,cell⟩
  have cond := enoughRead c b src xs small ref rfl
  by_cases full : 18≤xs.length
  · rw [if_pos full] at cond
    have h := Inv32Blocks.branch (fuel+24) t c b _ (ret (varP "value")).value .skip true (cond _ (by decide))
    have stop := h.trans (Bytes.retRef (fuel+23) t c b "value" src rfl)
    refine ⟨b,src,⟨rfl,le_rfl,fun _ _=>rfl⟩,bound,by simpa [Text.pad,Nat.sub_eq_zero_of_le full] using cell,?_⟩
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ aliasExec).trans
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ ((actions.map Pattern.value).drop 2) _ stop
  · rw [if_neg full] at cond
    have word : 18<R := by decide
    have sk : Stmt.eval (fuel+25) t c b enough.value=pure (.normal b) :=
      (MulDiv.branchFalse (fuel+24) t c b _ _ _ cond).trans (by rw [show Stmt_skip.value=Stmt.skip from rfl,Stmt.eval])
    have al := Bytes.allocateBytes (fuel+24) t c b "padded" "totalLength" 18 rfl (by decide) cap
    have bufRet := allocated b (List.replicate 18 0)
    have refD : Ref d "valueBytes" src xs := ⟨rfl,(bufRet.memory src bound).trans cell⟩
    have del := Add.declareWord (fuel+24) t "paddingLength" (Add.subRead (l:=wvar "totalLength") (m:=size "valueBytes") (MulDiv.wordVar c d "totalLength" 18 word rfl)
      (Inv08.ReleaseQuote.readClean (Bytes.length c d _ _ _ refD) (by omega)) word (by omega) small)
    have fresh : e.loadMemory? p=some (.bytes (List.replicate 18 0)) := load b p _
    obtain ⟨m,first,filled,zs⟩ := zeroLoop (fuel+19-n) c e p xs.length small rfl rfl fresh
    let f := Decimal.withMemory e m
    have refF : Ref f "valueBytes" src xs := ⟨rfl,(first src (Nat.ne_of_lt bound)).trans refD.cell⟩
    obtain ⟨m',second,final,cp⟩ := appendLoop (fuel+19-xs.length) c f p src xs small sane (Nat.ne_of_lt bound) rfl refF rfl filled
    let g := Decimal.withMemory f m'
    have Z : fuel+19-n+(18-xs.length)+6=fuel+25 := by dsimp [n];omega
    have C : fuel+19-xs.length+xs.length+6=fuel+25 := by omega
    rw [Z] at zs;rw [C] at cp
    refine ⟨g,p,⟨rfl,Nat.le_succ _,?_⟩,Nat.lt_succ_self _,final,?_⟩
    · intro j lt
      exact (second j (Nat.ne_of_lt lt)).trans ((first j (Nat.ne_of_lt lt)).trans (bufRet.memory j lt))
    · apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ aliasExec).trans
      apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans
      apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ al).trans
      apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ del).trans
      apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ zs).trans
      apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cp).trans
      exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ (Bytes.retRef (fuel+24) t c g "padded" p rfl)
end Inv45.Pad

import Inv45DigitScan
import Inv45Allocation
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Decimal
def entry (r : Runtime) (v : Nat) := r.withFrame [(number,.word v),("_ret0",.bytes [])]
def prepared (r : Runtime) (v : Nat) := (Bytes.allocate r []).withFrame [(number,.word v),("_ret0",.memoryRef r.nextMemory)]
theorem localize (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat) :
    Stmt.eval (n+1) t c (entry r v).pushScope initRet.value=pure (.normal (prepared r v).pushScope) := by
  have ok : (entry r v).pushScope.localizeMemoryLocal .bytesCalldata "_ret0"=some (prepared r v).pushScope := by rfl
  change Stmt.eval _ _ _ _ (.memoryLocalize .bytesCalldata "_ret0")=_
  rw [Stmt.eval];dsimp only;rw [ok]
inductive Holds (r : Runtime) (bs : List Nat) : Value→Prop
  | direct : Holds r bs (.bytes bs)
  | ref {id} (bound : id<r.nextMemory) (cell : r.loadMemory? id=some (.bytes bs)) : Holds r bs (.memoryRef id)
theorem positiveData (fuel : Nat) (c : Context) (r : Runtime) (v : Nat) (V : v<R) (nonzero : 0<v) (cap : c.memoryAllocationLimit?=none) :
    ∃ m : MemoryMap, let a := Bytes.allocate r []
      let buf := Bytes.allocate a (List.replicate (reversed v).length 0)
      let dst := withMemory buf m
      Bytes.Retains r dst ∧ dst.loadMemory? a.nextMemory=some (.bytes (decimal v)) ∧
      Stmt.evalList (fuel+82) model.core.table c (prepared r v).pushScope.pushScope (data.map Pattern.value)=
        pure (.returned (slots dst r.nextMemory a.nextMemory 0 0) [.memoryRef a.nextMemory]) := by
  let t := model.core.table
  let a := Bytes.allocate r []
  let d := (reversed v).length
  let root := (prepared r v).pushScope
  let s := root.pushScope
  let countStart := countState root 0 v
  let countEnd := countState root d 0
  let buf := Bytes.allocate a (List.replicate d 0)
  have length : d≤78 := lengthBound v (lt_trans V (by decide : R<10^78))
  have size : d<R := lt_of_le_of_lt length (by decide)
  have test := MulDiv.eqZero (MulDiv.wordVar c s number v V rfl) V
  rw [if_neg (Nat.ne_of_gt nonzero)] at test
  let initial := Stmt_ifElse (MulDiv.equalZero (wvar number)) (ret (bytesLiteral [48])) Stmt_skip
  have sk : Stmt.eval (fuel+82) t c s initial.value=pure (.normal s) := by
    have no := MulDiv.branchFalse (fuel+81) t c s (ret (bytesLiteral [48])) Stmt_skip _ test
    exact no.trans (by rw [show Stmt_skip.value=Stmt.skip from rfl,Stmt.eval])
  have tmp := Add.declareWord (fuel+81) t "tempValue" (MulDiv.wordVar c s number v V rfl)
  have init := Inv32FloorStart.zero (fuel+81) t c (s.declareLocal "tempValue" (.word v)) "digits"
  have countR := count (fuel+(78-d)) t c root v 0 V (by simpa only [Nat.zero_add] using size)
  simp only [Nat.zero_add] at countR
  change Stmt.evalWhile (fuel+(78-d)+3+d) t c countStart _ _=pure (.normal countEnd) at countR
  rw [show fuel+(78-d)+3+d=fuel+81 by omega] at countR
  have countLoopR : Stmt.eval (fuel+82) t c countStart countLoop.value=pure (.normal countEnd) := by
    change Stmt.eval _ _ _ _ (.whileLoop _ _)=_;rw [Stmt.eval];exact countR
  have alloc := Bytes.buffer (fuel+81) t c countEnd d rfl length cap
  have empty : buf.loadMemory? a.nextMemory=some (.bytes (fill d [])) := by
    change (a.memory.insert a.nextMemory (.bytes (List.replicate d 0)))[a.nextMemory]?=_
    simp [fill]
  obtain ⟨final,cell,keep,run⟩ := scan (fuel+(78-d)) t c buf r.nextMemory a.nextMemory v [] V (by simp) empty
  let dst := withMemory buf final
  have stable : Bytes.Retains r dst := by
    refine ⟨rfl,by change r.nextMemory≤r.nextMemory+1+1;omega,?_⟩
    intro id less
    have early : id<a.nextMemory := Nat.lt_trans less (Nat.lt_succ_self _)
    exact (keep id (Nat.ne_of_lt early)).trans (((Bytes.allocated a _).memory id early).trans ((Bytes.allocated r []).memory id less))
  refine ⟨final,stable,?_,?_⟩
  · simpa only [decimal,if_neg (Nat.ne_of_gt nonzero),List.append_nil] using cell
  · have F : Stmt.eval (fuel+82) t c (slots buf r.nextMemory a.nextMemory v d) digitLoop.value=
        pure (.normal (slots dst r.nextMemory a.nextMemory 0 0)) := by
      change Stmt.eval _ _ _ _ (.whileLoop _ _)=_;rw [Stmt.eval]
      change Stmt.evalWhile (fuel+(78-d)+3+d) _ _ _ _ _=_ at run
      rwa [show fuel+(78-d)+3+d=fuel+81 by omega] at run
    let out := slots dst r.nextMemory a.nextMemory 0 0
    have retRef : Expr.evalReturnValue c out (.var "buffer")=pure (.memoryRef a.nextMemory,out) := by rfl
    have ls : Expr.evalReturnList c out [.var "buffer"]=pure ([.memoryRef a.nextMemory],out) := by
      change Expr.evalReturnListFuel (_+1+1) c out [.var "buffer"]=_
      simp only [Expr.evalReturnListFuel,retRef,Inv08.Authority.bindPure]
    have end' : Stmt.eval (fuel+82) t c out (ret (varP "buffer")).value=pure (.returned out [.memoryRef a.nextMemory]) := by
      change Stmt.eval _ _ _ _ (.returnValues [.var "buffer"])=_
      rw [Stmt.eval];dsimp only;rw [ls];rfl
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ tmp).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ init).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ countLoopR).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ alloc).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ F).trans ?_
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ end'
end Inv45.Decimal

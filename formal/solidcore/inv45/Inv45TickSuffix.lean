import Inv45ScalarBranches
import Inv45ScalarHoists
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
open Bytes
theorem declLookup (r : Runtime) (name k : String) (v : Value) :
    (r.declareLocal name v).lookupLocal? k=if k=name then some v else r.lookupLocal? k := by
  by_cases eq : k=name
  · subst k;simp [lookupHere]
  · rw [if_neg eq,lookupDecl _ _ _ _ eq]
theorem allocLookup (r : Runtime) (bs : List Nat) (k : String) : (allocate r bs).lookupLocal? k=r.lookupLocal? k := rfl
theorem localsLookup (r s : Runtime) (k : String) : (localsOf r s).lookupLocal? k=s.lookupLocal? k := rfl
theorem pushLookup (r : Runtime) (k : String) : r.pushScope.lookupLocal? k=r.lookupLocal? k := rfl
def pref := [32,40,116,105,99,107,32]
def separator := [32,111,102,32]
theorem suffixRun (fuel : Nat) (c : Context) (r : Runtime) (id k n : Nat) (bs : List Nat)
    (idBound : id<r.nextMemory) (label : r.loadMemory? id=some (.bytes bs)) (sane : ∀v∈bs,v<256)
    (payout : r.lookupLocal? "payout"=some (.word k)) (count : r.lookupLocal? "numTicks"=some (.word n))
    (K : k<R) (N : n<R) (cap : c.memoryAllocationLimit?=none) :
    ∃z final, Retains r z ∧ final<z.nextMemory ∧ z.loadMemory? final=some (.bytes (bs++Text.suffix n (some k))) ∧
      Stmt.eval (fuel+94) model.core.table c (r.declareLocal "label" (.memoryRef id)) (block tagSteps).value=
        pure (.normal ((localsOf z r).declareLocal "label" (.memoryRef final))) := by
  let t := model.core.table
  let s := r.declareLocal "label" (.memoryRef id)
  let a := s.pushScope.declareLocal "_sol_hoist_4" (.memoryRef id)
  let b := (allocate a pref).declareLocal "_sol_hoist_3" (.memoryRef a.nextMemory)
  let buf := allocate b []
  have init := Bytes.aliasExec (fuel+92) t c s.pushScope "_sol_hoist_4" "label" id (declarePtr _ _ _)
  have str := textInit (fuel+92) t c a "_sol_hoist_3" pref (by decide)
  have one := Bytes.blank (fuel+92) t c b Format.temp0
  have pR : (buf.declareLocal Format.temp0 (.memoryRef b.nextMemory)).lookupLocal? "payout"=some (.word k) := by
    simpa [buf,b,a,s,declLookup,allocLookup,pushLookup,Format.temp0] using payout
  obtain ⟨x,kId,keepX,kBound,kCell,kRun⟩ := Format.fetchDecimal (fuel+5) c buf "payout" b.nextMemory k pR K cap
  let d := (localsOf x buf).declareLocal Format.temp0 (.memoryRef kId)
  let e := (allocate d separator).declareLocal "_sol_hoist_2" (.memoryRef d.nextMemory)
  let arg := allocate e []
  have sep := textInit (fuel+92) t c d "_sol_hoist_2" separator (by decide)
  have two := Bytes.blank (fuel+92) t c e Format.temp1
  have nR : (arg.declareLocal Format.temp1 (.memoryRef e.nextMemory)).lookupLocal? "numTicks"=some (.word n) := by
    simpa [arg,e,d,buf,b,a,s,declLookup,allocLookup,localsLookup,pushLookup,Format.temp0,Format.temp1] using count
  obtain ⟨y,nId,keepY,nBound,nCell,nRun⟩ := Format.fetchNumTicks (fuel+5) c arg e.nextMemory n nR N cap
  let f := (localsOf y arg).declareLocal Format.temp1 (.memoryRef nId)
  have startKeep : Retains r b := ⟨rfl,Nat.le_succ _,(allocated a pref).memory⟩
  have bd : Retains b d := Bytes.trans (allocated b []) ⟨keepX.state,keepX.next,keepX.memory⟩
  have de : Retains d e := ⟨rfl,Nat.le_succ _,(allocated d separator).memory⟩
  have ef : Retains e f := Bytes.trans (allocated e []) ⟨keepY.state,keepY.next,keepY.memory⟩
  have df := Bytes.trans de ef
  have bf := Bytes.trans bd df
  have stable := Bytes.trans startKeep bf
  have b3 : Ref f "_sol_hoist_3" a.nextMemory pref := by
    refine ⟨?_,(bf.memory _ (Nat.lt_succ_self _)).trans (load a _ _)⟩
    simp [f,arg,e,d,buf,b,declLookup,allocLookup,localsLookup,Format.temp0,Format.temp1]
  have b4 : Ref f "_sol_hoist_4" id bs := by
    refine ⟨?_,(stable.memory _ idBound).trans label⟩
    simp [f,arg,e,d,buf,b,a,declLookup,allocLookup,localsLookup,Format.temp0,Format.temp1]
  have b0 : Ref f Format.temp0 kId (Decimal.decimal k) := by
    refine ⟨?_,(df.memory kId kBound).trans kCell⟩
    simp [f,arg,e,d,declLookup,localsLookup,allocLookup,Format.temp0,Format.temp1]
  have b2 : Ref f "_sol_hoist_2" d.nextMemory separator := by
    refine ⟨?_,(ef.memory _ (Nat.lt_succ_self _)).trans (load d _ _)⟩
    simp [f,arg,e,declLookup,localsLookup,allocLookup,Format.temp1]
  have b1 : Ref f Format.temp1 nId (Decimal.decimal n) := ⟨declarePtr _ _ _,nCell⟩
  have numSane (i : Nat) : ∀v∈Decimal.decimal i,v<256 := by intro v h;have := Decimal.decimalDigits h;omega
  let es := [varP "_sol_hoist_4",varP "_sol_hoist_3",varP Format.temp0,varP "_sol_hoist_2",varP Format.temp1,Decimal.bytesLiteral [41]]
  let vs := [bs,pref,Decimal.decimal k,separator,Decimal.decimal n,[41]]
  have parts : ByteParts c f es vs := .cons (val _ _ _ _ _ b4) sane (.cons (val _ _ _ _ _ b3) (by decide)
    (.cons (val _ _ _ _ _ b0) (numSane k) (.cons (val _ _ _ _ _ b2) (by decide)
      (.cons (val _ _ _ _ _ b1) (numSane n) (.cons (literalBytes _ _ _ (by decide)) (by decide) .nil)))))
  let z := allocate f vs.flatten
  let dst := (localsOf z r).declareLocal "label" (.memoryRef f.nextMemory)
  let done := dst.withFrame [(Format.temp1,.memoryRef nId),("_sol_hoist_2",.memoryRef d.nextMemory),
    (Format.temp0,.memoryRef kId),("_sol_hoist_3",.memoryRef a.nextMemory),("_sol_hoist_4",.memoryRef id)]
  have pLabel : f.lookupLocal? "label"=some (.memoryRef id) := by
    simp [f,arg,e,d,buf,b,a,s,declLookup,allocLookup,localsLookup,pushLookup,Format.temp0,Format.temp1]
  have raw : z.assignLocalRaw? "label" (.memoryRef f.nextMemory)=some done := by
    cases H : r.locals <;> simp [z,f,arg,e,d,buf,b,a,s,done,dst,allocate,localsOf,Runtime.assignLocalRaw?,Runtime.pushScope,
      Runtime.withFrame,Runtime.declareLocal,LocalEnv.declare,LocalEnv.assign?,Frame.assign?,H,Format.temp0,Format.temp1]
  have end' := assignPack (fuel+92) t "label" id done parts pLabel raw
  have list : Stmt.evalList (fuel+93) t c s.pushScope (tagSteps.map Pattern.value)=pure (.normal done) := by
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ init).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ str).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ one).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ kRun).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ sep).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ two).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ nRun).trans
    apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ end').trans
    change Stmt.evalList (fuel+93) _ _ _ []=_;rw [Stmt.evalList]
  refine ⟨z,f.nextMemory,Bytes.trans stable (allocated f vs.flatten),Nat.lt_succ_self _,?_,?_⟩
  · have eq : vs.flatten=bs++Text.suffix n (some k) := by simp [vs,pref,separator,Text.suffix,List.append_assoc]
    rw [←eq];exact load f _ _
  · change Stmt.eval _ _ _ _ (.block (tagSteps.map Pattern.value))=_
    rw [Stmt.eval];dsimp only;rw [list];rfl
end Inv45.Scalar

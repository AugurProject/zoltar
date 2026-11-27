import Inv48EscrowEntryCertificate
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

private theorem chooseChecked {α : Type} (o : Option α) (test : α → Bool)
    (h : o.any test = true) : ∃ x, o = some x ∧ test x = true := by
  cases o with
  | none => contradiction
  | some x => exact ⟨x,rfl,h⟩
noncomputable def pair : FunctionDef × InternalFunction :=
  Classical.choose (chooseChecked selections testPair checkedPair)
noncomputable def fn : FunctionDef := pair.1
noncomputable def lookupFn : InternalFunction := pair.2
theorem pairFound : selections = some pair :=
  (Classical.choose_spec (chooseChecked selections testPair checkedPair)).1
theorem pairChecked : testPair pair = true :=
  (Classical.choose_spec (chooseChecked selections testPair checkedPair)).2

private theorem selectionsSound (fo : Option FunctionDef) (go : Option InternalFunction)
    (f : FunctionDef) (g : InternalFunction)
    (h : (do let f ← fo; let g ← go; pure (f,g)) = some (f,g)) :
    fo = some f ∧ go = some g := by
  cases fo with
  | none => contradiction
  | some a =>
    cases go with
    | none => contradiction
    | some b => cases h; exact ⟨rfl,rfl⟩
theorem found : Inv48.Source.model.core.findFunctionByName? "createReportEscrow" = some fn :=
  (selectionsSound (Inv48.Source.model.core.findFunctionByName? "createReportEscrow")
    (Inv48.Source.model.core.table.lookup? "__internal_reputationToken()#[]") fn lookupFn pairFound).1
theorem lookupFound : Inv48.Source.model.core.table.lookup? "__internal_reputationToken()#[]" = some lookupFn :=
  (selectionsSound (Inv48.Source.model.core.findFunctionByName? "createReportEscrow")
    (Inv48.Source.model.core.table.lookup? "__internal_reputationToken()#[]") fn lookupFn pairFound).2

theorem allFacts : fn.params = params ∧ fn.returns = returns ∧ fn.payable = false ∧
    (outerOf fn).take 9 = prologue ∧ (outerOf fn).length = 10 ∧
    (innerOf fn).take 4 = preparation ∧
    (match fn.body with | .block _ => true | _ => false) = true ∧
    (match ((outerOf fn)[9]? : Option Stmt) with | some (.block _) => true | _ => false) = true ∧
    lookupFn.returns = [⟨"_ret0",.address,false⟩] := by
  have h := pairChecked
  change testPair (fn,lookupFn) = true at h
  simp only [testPair,Bool.and_eq_true,beq_iff_eq] at h
  have payable : fn.payable = false := by
    cases p : fn.payable <;> simp [p] at h ⊢
  exact ⟨paramPattern.sound _ h.1,returnPattern.sound _ h.2.1,payable,
    prologuePattern.sound _ h.2.2.2.1,h.2.2.2.2.1,
    preparationPattern.sound _ h.2.2.2.2.2.1,h.2.2.2.2.2.2.1,
    h.2.2.2.2.2.2.2.1,lookupReturnsPattern.sound _ h.2.2.2.2.2.2.2.2⟩
theorem metadata : fn.params = params ∧ fn.returns = returns ∧ fn.payable = false :=
  ⟨allFacts.1,allFacts.2.1,allFacts.2.2.1⟩
noncomputable def outer : List Stmt := outerOf fn

theorem actualPrologue : outer.take 9 = prologue := allFacts.2.2.2.1
theorem lookupReturns : lookupFn.returns = [⟨"_ret0",.address,false⟩] := allFacts.2.2.2.2.2.2.2.2

theorem statementsLink : EscrowTrace.actualStatements = innerOf fn := by
  unfold EscrowTrace.actualStatements
  rw [found]
  cases body : fn.body <;> simp [innerOf,outerOf,body]
  case block ss =>
    cases idx : ss[9]? with
    | none => simp [idx]
    | some st => cases st <;> simp [idx]
theorem actualPreparation : EscrowTrace.actualStatements.take 4 = preparation := by
  rw [statementsLink]
  exact allFacts.2.2.2.2.2.1

theorem bodyIsBlock : fn.body = .block outer := by
  have h := allFacts.2.2.2.2.2.2.1
  cases b : fn.body <;> simp [b] at h
  case block ss => simp [outer,outerOf,b]
theorem actualInner : outer[9]? = some (.block EscrowTrace.actualStatements) := by
  rw [statementsLink]
  have h := allFacts.2.2.2.2.2.2.2.1
  change (match (outer[9]? : Option Stmt) with | some (.block _) => true | _ => false) = true at h
  change outer[9]? = some (.block (match (outer[9]? : Option Stmt) with | some (.block ss) => ss | _ => []))
  cases idx : outer[9]? with
  | none => simp [idx] at h
  | some st => cases st <;> simp [idx] at h ⊢

theorem bodyDecomposition : fn.body = .block (prologue ++ [.block EscrowTrace.actualStatements]) := by
  rw [bodyIsBlock]
  congr 1
  have tail : outer.drop 9 = [.block EscrowTrace.actualStatements] := by
    apply List.ext_getElem?
    intro i
    cases i with
    | zero => simpa only [List.getElem?_drop,Nat.add_zero] using actualInner
    | succ i =>
      have len : outer.length = 10 := allFacts.2.2.2.2.1
      rw [List.getElem?_drop]
      have outside : outer[9+(i+1)]? = none := List.getElem?_eq_none (by omega)
      simp [outside]
  rw [← actualPrologue,← tail,List.take_append_drop]

#print axioms checkedPair
#print axioms metadata
#print axioms actualPreparation
#print axioms lookupFound
#print axioms bodyDecomposition
end Inv48.EscrowEntry

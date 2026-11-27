import Inv27Prices
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv03.Bodies
namespace Inv27

def quote (cons : Bool) (p e : Nat) : Answer :=
  if D≤e then .error "Invalid oracle uncertainty"
  else if cons then
    if maximum e<p then .error "Conservative oracle price exceeds uint256" else .value (upper p e)
  else .value (lower p e)
theorem evaluate (f : Nat) (c : Context) (r : Runtime) (p e : Nat) (hp : p<R) (he : e<R) (cons : Bool) :
    let src := r.withFrame (frame p e)
    Stmt.eval (f+22) table {c with checked := true} src (body cons).value =
      pure ((quote cons p e).atState src) := by
  unfold quote
  split
  · exact invalid _ _ _ _ _ hp he (by assumption) cons
  · rename_i good
    have good' := Nat.lt_of_not_ge good
    cases cons with
    | false => exact liquidation _ _ _ _ _ hp good' rfl
    | true =>
      simp only [if_true]
      split
      · exact tooLarge _ _ _ _ _ hp good' (by assumption)
      · exact conservative _ _ _ _ _ hp good' (by omega)

theorem outputFits (cons : Bool) (p e v : Nat) (hp : p<R) (h : quote cons p e = .value v) : v<R := by
  unfold quote at h
  split at h <;> try contradiction
  rename_i good
  split at h
  · split at h <;> try contradiction
    cases h
    exact lt_of_le_of_lt ((fits_iff p e (by omega)).mpr (by omega)) (by decide)
  · cases h; exact lt_of_le_of_lt (lowerLe _ _) hp

def apiName (cons : Bool) := if cons then "conservativePrice" else "liquidationPrice"
def slot (cons : Bool) := "_ret___library_OraclePriceMath_" ++ apiName cons ++ "_0"
def cs (r : Runtime) (p e : Nat) := ({r with locals:=[]}).withFrame (frame p e)
def called (r : Runtime) (cons : Bool) (p e : Nat) : SolI Result :=
  match quote cons p e with
  | .value v => internalCallAssign r [slot cons] [.word v]
  | .error msg => pure (.reverted (cs r p e) (.error msg))

theorem libraryCall (n : Nat) (c : Context) (r : Runtime) (p e : Nat) (hp : p<R) (he : e<R) (cons : Bool)
    (P : r.lookupLocal? a0 = some (.word p)) (E : r.lookupLocal? a1 = some (.word e)) :
    Stmt.eval (n+23) table c r (.internalCall [slot cons] (key cons) [.var a0,.var a1]) = called r cons p e := by
  obtain ⟨fn,found,ps,rs,bd⟩ := linked cons
  let empty := {r with locals := []}
  let src := cs r p e
  have enter : internalCallEnter? fn [.word p,.word e] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,cs,Runtime.withFrame]
  have ev := evaluate n c empty p e hp he cons
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32ProductCall.args _ _ _ _ _ _ P E) found enter ev]
  unfold called
  cases h : quote cons p e with
  | error msg => rfl
  | value v =>
    have out : coerceReturnBindingsRef fn.returns src [.word v] = .ok [.word v] := by
      rw [rs]; simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
        Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
    change coerceReturnBindingsRef fn.returns (empty.withFrame (frame p e)) [.word v] = .ok [.word v] at out
    simp only [Answer.atState,internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,out]
    rfl
end Inv27

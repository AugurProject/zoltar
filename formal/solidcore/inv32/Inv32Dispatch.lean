import Inv32Source
open SolidCore.Solidity
namespace Inv32Dispatch
def checked := TypeCheck.CheckedInput.contract Inv32Generated.importedSourceUnit "TwoWayConstantProductMathHarness"
theorem present : checked.toOption.isSome = true := by native_decide
def model := checked.toOption.get present
theorem checked_ok : checked = .ok model := by
  have lemma' (c : Except TypeCheck.TypeError TypeCheck.CheckedContract) (h : c.toOption.isSome) :
      c = .ok (c.toOption.get h) := by cases c with
    | ok _ => rfl
    | error _ => contradiction
  exact lemma' checked present

def args (x y a f : Nat) : List Source.Value := [.word x,.word y,.word a,.word f]
def observe : Option Source.CallResult → Inv32Source.Outcome
  | some (.returned _ [.word a,.word f]) => .returned a f
  | some (.reverted _ _) => .reverted
  | _ => .failed

def bodyCall (name : String) (vs : List Source.Value) : Option Source.CallResult := do
  let fn ← model.core.resolveCallFunction? (.name name) vs
  fn.call? 50000 model.core.table
    {model.core.context with selfDispatch? := some (Source.ABI.selfDispatchHook 50000 model.core 0)}
    Source.State.empty vs

theorem execution (name : String) (x y a f : Nat) :
    Inv32Source.quote name x y a f = observe (bodyCall name (args x y a f)) := by
  have trees : TypeCheck.CheckedContract.call? 50000 model (.name name) Source.State.empty (args x y a f) =
      bodyCall name (args x y a f) := by
    unfold TypeCheck.CheckedContract.call? Source.ABI.Contract.callSelfDispatch? Source.ABI.Contract.callWithSelfDispatch bodyCall
    cases model.core.resolveCallFunction? (.name name) (args x y a f) <;> rfl
  rw [← trees]
  unfold Inv32Source.quote
  rw [show TypeCheck.CheckedInput.contract Inv32Generated.importedSourceUnit "TwoWayConstantProductMathHarness" = .ok model from checked_ok]
  unfold args TypeCheck.CheckedContract.call
  simp only [List.map_cons, List.map_nil]
  cases TypeCheck.CheckedContract.call? 50000 model (.name name) Source.State.empty [.word x,.word y,.word a,.word f] with
  | none => rfl
  | some r =>
    cases r with
    | reverted => rfl
    | returned st vals =>
      cases vals with
      | nil => rfl
      | cons v vs =>
        cases v <;> try rfl
        cases vs with
        | nil => rfl
        | cons w ws => cases ws <;> cases w <;> rfl

inductive Direction | forward | inverse deriving DecidableEq
def method : Direction → String
  | .forward => "quoteExactInput"
  | .inverse => "quoteExactOutput"

def isWordParam (p : Source.BindingDecl) : Bool :=
  match p.ty with | .uint256 => true | _ => false

def selected? (d : Direction) := model.core.findFunctionByName? (method d)
theorem existsEntry (d : Direction) : (selected? d).isSome := by
  cases d <;> native_decide

def selected (d : Direction) := (selected? d).get (existsEntry d)

theorem fourWordParams (d : Direction) :
    ((selected d).params.map isWordParam) = [true,true,true,true] := by
  cases d <;> native_decide

private theorem bindWords (ps : List Source.BindingDecl) (ns : List Nat)
    (shape : ps.map isWordParam = ns.map (fun _ => true)) :
    (Source.BindingDecl.bindArgs? ps (ns.map Source.Value.word)).isSome := by
  induction ps generalizing ns with
  | nil => cases ns <;> simp_all [Source.BindingDecl.bindArgs?]
  | cons p ps ih =>
    cases ns with
    | nil => simp at shape
    | cons n ns =>
      simp only [List.map_cons, List.cons.injEq] at shape
      have t : p.ty = .uint256 := by
        have h := shape.1
        unfold isWordParam at h
        cases eq : p.ty <;> simp_all [eq]
      have tail := ih ns shape.2
      cases h : Source.BindingDecl.bindArgs? ps (List.map Source.Value.word ns) with
      | none => rw [h] at tail; contradiction
      | some bs => simp [Source.BindingDecl.bindArgs?, Source.BindingDecl.bindArg?, t,
                          Source.Ty.coerceValue?, h]

theorem dispatch (d : Direction) (x y a f : Nat) :
    model.core.resolveCallFunction? (.name (method d)) (args x y a f) = some (selected d) := by
  have chosen : selected? d = some (selected d) := (Option.some_get (existsEntry d)).symm
  obtain ⟨nameOk, before, after, decomp, skip⟩ := List.find?_eq_some_iff_append.mp chosen
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_, before, after, decomp, ?_⟩
  · have valid := bindWords (selected d).params [x,y,a,f] (fourWordParams d)
    change (Source.BindingDecl.bindArgs? (selected d).params (args x y a f)).isSome at valid
    simp only [Source.FunctionDef.initialFrame?, nameOk, Bool.true_and]
    cases h : Source.BindingDecl.bindArgs? (selected d).params (args x y a f) <;> simp_all
  · intro fn mem
    have absent := skip fn mem
    simp_all

theorem quoteExecutesSelectedBody (d : Direction) (x y a f : Nat) :
    Inv32Source.quote (method d) x y a f =
      observe ((selected d).call? 50000 model.core.table
        {model.core.context with selfDispatch? := some (Source.ABI.selfDispatchHook 50000 model.core 0)}
        Source.State.empty (args x y a f)) := by
  rw [execution]
  unfold bodyCall
  rw [dispatch]
  rfl
end Inv32Dispatch

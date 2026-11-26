import Inv40Generated
import Inv40Getter
import Inv32Shapes
import Inv32FlagCalls

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv40

open Inv32Shapes in
private def shapes : Pattern Source.Expr × Pattern Source.Expr := Id.run do
  let c := fun x => Expr_castOp CastKind_uintCleanup (lit 256) x
  let twice := fun x => c (c x)
  let arith := fun op x y => twice (Expr_binary op x y)
  let localVar := fun name => c (Expr_var (lit name))
  let num := fun n => Expr_word (lit n)
  let immutable : Pattern Source.Expr := {
    value := .immutable "forkThresholdDivisor"
    test := fun e => match e with | .immutable n => n == "forkThresholdDivisor" | _ => false
    sound := by
      intro e h
      split at h
      · simp_all
      · contradiction }
  let s := localVar "theoreticalSupplyAttoRep"
  let d := c immutable
  let t := localVar "forkThresholdAttoRep"
  return (arith BinaryOp_add (arith BinaryOp_div s d)
      (Expr_ternary (Expr_binary BinaryOp_eq (arith BinaryOp_mod s d) (num 0)) (num 0) (num 1)),
    arith BinaryOp_add (arith BinaryOp_div t (num 2)) (arith BinaryOp_mod t (num 2)))

open Inv32Shapes in
private def bodyPattern (g : Getter) : Pattern Source.Stmt := Id.run do
  let variableP := fun name => Expr_var (lit name)
  let clean := fun width x => Expr_castOp CastKind_uintCleanup (lit width) x
  let assign := fun name => Stmt_assign (LValue_var (lit name))
  let decl := fun name => Stmt_varDecl Ty_uint256 (lit name)
  let block := fun (ss : List (Pattern Source.Stmt)) => Stmt_block (ss.foldr List_cons List_nil)
  let arg := clean 248 (variableP "universeId")
  let ret := g.target
  let names := List_cons (lit ret) List_nil
  let call := Stmt_internalCall names (lit g.key) (List_cons (variableP "_ic_arg_0") List_nil)
  let fetch := block [decl "_ic_arg_0" (Option_some arg),decl ret Option_none,
    Stmt_captureReturn names call,assign "_sol_hoist_0" (variableP ret)]
  let value := match g with | .forkThreshold => shapes.1 | .nonDecisionThreshold => shapes.2
  return block [assign "universeId" arg,Stmt_skip,
    block [decl "_sol_hoist_0" Option_none,fetch,
      decl g.slot (Option_some (clean 256 (variableP "_sol_hoist_0"))),
      Stmt_returnValues (List_cons value List_nil)]]

private theorem bodyValue (g : Getter) : (bodyPattern g).value = g.body := by cases g <;> rfl

private def checked := TypeCheck.CheckedInput.contract Inv40Generated.importedSourceUnit "Zoltar"
private theorem present : checked.toOption.isSome = true := by native_decide
def model := checked.toOption.get present

def lookup (g : Getter) :=
  model.core.findFunctionByName? (match g with
    | .forkThreshold => "getForkThresholdAttoRep" | .nonDecisionThreshold => "getNonDecisionThresholdAttoRep")

private def checkBody (g : Getter) (body : Option Source.Stmt) :=
  (Inv32Shapes.Option_some (bodyPattern g)).test body
private theorem bodySound (g : Getter) (body : Option Source.Stmt) (h : checkBody g body = true) :
    body = some g.body := by
  have ok := (Inv32Shapes.Option_some (bodyPattern g)).sound _ h
  change body = some (bodyPattern g).value at ok
  rwa [bodyValue] at ok

theorem publicBody (g : Getter) :
    (lookup g).map FunctionDef.body = some g.body :=
  bodySound _ _ (by cases g <;> native_decide)

def signatureOK (f : InternalFunction) :=
  decide (Inv32Internal.decode f.params = some ["universeId"]) &&
  decide (Inv32Internal.decode f.returns = some ["_ret0"]) &&
  (bodyPattern .forkThreshold).test f.body

theorem signatureSound (f : InternalFunction) (ok : signatureOK f = true) :
    f.params = Inv32Internal.wordBindings ["universeId"] ∧
    f.returns = Inv32Internal.wordBindings ["_ret0"] ∧ f.body = Getter.forkThreshold.body := by
  simp only [signatureOK,Bool.and_eq_true,decide_eq_true_eq] at ok
  exact ⟨Inv32Internal.wordBindingsOf _ _ ok.1.1,Inv32Internal.wordBindingsOf _ _ ok.1.2,
    ((bodyPattern .forkThreshold).sound _ ok.2).trans (bodyValue _)⟩

theorem internalFound : ((model.core.table.lookup? Getter.nonDecisionThreshold.key).map signatureOK) = some true := by native_decide

end Inv40

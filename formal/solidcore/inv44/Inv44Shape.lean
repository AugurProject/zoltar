import Inv44Model
import Inv08AuthorityShapes
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv44
abbrev addresses := "deploymentAddresses"
def header : Pattern Expr := ⟨.storageRead .header addresses [],fun | .storageRead .header "deploymentAddresses" []=>true | _=>false,
  by intro x h; dsimp only at h; split at h <;> simp_all⟩
def element : Pattern Expr := ⟨.storageRead .element addresses [.var "index"],
  fun | .storageRead .element "deploymentAddresses" [.var "index"]=>true | _=>false,by intro x h;dsimp only at h;split at h <;> simp_all⟩
def code : Pattern Expr where
  value := .envBytesLookup .accountCode element.value
  test | .envBytesLookup .accountCode e => element.test e | _=>false
  sound _ h := by
    split at h
    · rw [element.sound _ h]
    · contradiction
def condition := Expr_binary BinaryOp_gt (clean (Inv08.Authority.length code)) (num 0)
def loopTest := Expr_binary BinaryOp_lt (wvar "index") (wvar "count")
def shift := clean (Inv08.Authority.convert 256 (Expr_binary Inv08.Authority.shiftOp (num 1) (varP "index")))
def setBit := Stmt_exprStmt (Expr_assignment (Option_some BinaryOp_bitOr) (Option_some (ValueCleanup_uint (lit 256))) (varP "deployedMask") shift)
def work := block [Stmt_ifElse condition (block [setBit]) Stmt_skip]
def step : Pattern Stmt := ⟨.exprStmt (.incDec .add false (some (.uint 256)) (.var "index")),
  fun | .exprStmt (.incDec .add false (some (.uint 256)) (.var "index"))=>true | _=>false,
  by intro x h;dsimp only at h;split at h <;> simp_all⟩
def loop : Pattern Stmt where
  value := .forLoop .skip loopTest.value step.value work.value
  test | .forLoop .skip t s b => loopTest.test t && step.test s && work.test b | _=>false
  sound _ h := by
    split at h
    · simp only [Bool.and_eq_true] at h;rw [loopTest.sound _ h.1.1,step.sound _ h.1.2,work.sound _ h.2]
    · contradiction
def indexDecl := Inv08.Expiry.typed "index" (num 0)
def countDecl := Inv08.Expiry.typed "count" (clean header)
def body := block [Stmt_skip,block [countDecl,block [indexDecl,loop]]]
theorem present : (model.core.findFunctionByName? "getDeploymentMask").isSome := by native_decide
def fn := (model.core.findFunctionByName? "getDeploymentMask").get present
theorem source : fn.body=body.value := body.sound _ (by native_decide)
theorem params : fn.params=[] := Inv32Library.sound fn.params [] (by native_decide)
theorem returns : fn.returns=[Inv32Library.decl (.word "deployedMask")] := Inv32Library.sound fn.returns [.word "deployedMask"] (by native_decide)
def frame (m : Nat) : Frame := [("deployedMask",.word m)]
theorem initial : fn.initialFrame? []=some (frame 0) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,returns]; simp [BindingDecl.bindArgs?,BindingDecl.defaultBinding,Inv32Library.decl,Ty.defaultValue,frame]
theorem dispatch : model.core.resolveCallFunction? (.name "getDeploymentMask") []=some fn := by
  have found : model.core.findFunctionByName? "getDeploymentMask"=some fn := (Option.some_get present).symm
  obtain ⟨nameOk,before,after,decomp,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,decomp,?_⟩
  · simp only [nameOk,initial,Option.isSome_some,Bool.true_and]
  · intro f mem; have absent := skip f mem; simp_all
end Inv44

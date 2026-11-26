import Inv08Release
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.Initialize
def initializer : Pattern Expr :=
  ⟨.immutable "initializer",fun | .immutable "initializer" => true | _ => false,by intro e h; dsimp only at h; split at h <;> simp_all⟩
def deployer := Authority.guard (Expr_binary BinaryOp_eq Authority.caller initializer) "Only fee streams deployer"
def viewName := "#view228"
def ledger := block [Authority.addressDecl tmp Option_none,Authority.via Authority.ledgerRet Authority.ledgerKey,
  Authority.addressDecl viewName (Option_some (varP tmp)),
  Authority.guard (Expr_binary Authority.neOp (varP viewName) (num 0)) "Invalid fee authority"]
def empty := Authority.guard (Expr_binary BinaryOp_eq (Expiry.clean48 Authority.duration) (Authority.convert 48 (num 0))) "Fee streams already initialized"
def time := Authority.guard (Expr_binary BinaryOp_le (wvar "timestamp") (clean Release.blockTime)) "Future fee checkpoint"
def positive := Authority.guard (Expr_binary Authority.neOp (Expiry.w48 "vestingDuration") (Authority.convert 48 (num 0))) "Invalid fee duration"
def actions := [deployer,ledger,empty,time,positive,ReleaseWrites.record48 "rewardDuration" "vestingDuration",ReleaseWrites.record48 "releasedThrough" "timestamp"]
def body := block [assign "timestamp" (Expiry.w48 "timestamp"),assign "vestingDuration" (Expiry.w48 "vestingDuration"),block actions]
theorem present : (model.core.findFunctionByName? "initialize").isSome := by native_decide
def fn := (model.core.findFunctionByName? "initialize").get present
theorem fromSource : fn.body=body.value := body.sound _ (by native_decide)
theorem params : fn.params=[Inv32Library.decl (.word "timestamp"),Inv32Library.decl (.word "vestingDuration")] :=
  Inv32Library.sound fn.params [.word "timestamp",.word "vestingDuration"] (by native_decide)
theorem results : fn.returns=[] := Inv32Library.sound fn.returns [] (by native_decide)
def frame (tm d : Nat) : Frame := [("timestamp",.word tm),("vestingDuration",.word d)]
theorem initial (tm d : Nat) : fn.initialFrame? [.word tm,.word d]=some (frame tm d) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,results]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,Inv32Library.decl,Ty.coerceValue?,frame]
theorem dispatch (tm d : Nat) : model.core.resolveCallFunction? (.name "initialize") [.word tm,.word d]=some fn := by
  have found : model.core.findFunctionByName? "initialize"=some fn := (Option.some_get present).symm
  obtain ⟨nameOk,before,after,decomp,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,decomp,?_⟩
  · simp only [nameOk,initial,Option.isSome_some,Bool.true_and]
  · intro f mem; have absent := skip f mem; simp_all
end Inv08.Initialize

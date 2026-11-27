import Inv39ChildBody
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv39.Transfer
abbrev tmp := "_sol_hoist_0"
abbrev result := "_ret__msgSender_0"
abbrev senderKey := "__internal__msgSender()#[]"
def address (s : String) := Stmt_varDecl Motion.addressTy (lit s)
def senderShape := block [Stmt_skip,block [ret ⟨.caller,fun | .caller => true | _ => false,
  by intro x h; dsimp only at h; split at h <;> simp_all⟩]]
def fetch := block [address result Option_none,
  Stmt_captureReturn (seq [lit result]) (Stmt_internalCall (seq [lit result]) (lit senderKey) List_nil), assign tmp (varP result)]
def go := block [address "_ic_arg_0" (Option_some (varP "owner")),address "_ic_arg_1" (Option_some (varP "to")),
  decl "_ic_arg_2" (Option_some (wvar "value")),
  Stmt_captureReturn List_nil (Stmt_internalCall List_nil (lit (Motion.key .transfer)) (seq [varP "_ic_arg_0",varP "_ic_arg_1",varP "_ic_arg_2"]))]
def shape := block [Stmt_skip,param "value",Stmt_skip,block [address tmp Option_none,fetch,address "owner" (Option_some (varP tmp)),go,ret (num 1)]]
private def isPublic (f : FunctionDef) : Bool := match f.params,f.returns with
  | [⟨"to",.address,false⟩,⟨"value",.uint256,false⟩],[⟨"_ret0",.bool,false⟩] => true | _,_ => false
private def isHelper (f : InternalFunction) : Bool := match f.params,f.returns with
  | [],[⟨"_ret0",.address,false⟩] => true | _,_ => false
private def checked (a : Option FunctionDef) (b : Option InternalFunction) :=
  ((a.map fun f => isPublic f && shape.test f.body) == some true) &&
  ((b.map fun f => isHelper f && senderShape.test f.body) == some true)
private theorem verified : checked (model.core.findFunctionByName? "transfer") (model.core.table.lookup? senderKey) := by native_decide
private theorem certify {α} (o : Option α) (m : α → Bool) (p : Pattern Stmt) (body : α → Stmt)
    (h : (o.map fun f => m f && p.test (body f))=some true) : ∃ f, o=some f ∧ m f ∧ body f=p.value := by
  cases o with
  | none => contradiction
  | some f =>
    simp only [Option.map_some,Option.some.injEq,Bool.and_eq_true] at h
    exact ⟨f,rfl,h.1,p.sound _ h.2⟩
theorem helper : ∃ f, model.core.table.lookup? senderKey=some f ∧ f.params=[] ∧ f.returns=[⟨"_ret0",.address,false⟩] ∧ f.body=senderShape.value := by
  have h := verified
  simp only [checked,beq_iff_eq,Bool.and_eq_true] at h
  obtain ⟨f,found,m,b⟩ := certify _ _ _ _ h.2
  refine ⟨f,found,?_,?_,b⟩ <;> unfold isHelper at m <;> split at m <;> simp_all
theorem publicLink : ∃ f, model.core.findFunctionByName? "transfer"=some f ∧ f.params=[⟨"to",.address,false⟩,⟨"value",.uint256,false⟩] ∧
    f.returns=[⟨"_ret0",.bool,false⟩] ∧ f.body=shape.value := by
  have h := verified
  simp only [checked,beq_iff_eq,Bool.and_eq_true] at h
  obtain ⟨f,found,m,b⟩ := certify _ _ _ _ h.1
  refine ⟨f,found,?_,?_,b⟩ <;> unfold isPublic at m <;> split at m <;> simp_all
end Inv39.Transfer

import Inv39UpdateBody
import Inv39Ledger
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv39.Motion
inductive Kind | mint | burn | transfer deriving DecidableEq
def addressTy : Pattern Ty := ⟨.address,(fun | .address => true | _ => false), by intro x h; dsimp only at h; split at h <;> simp_all⟩
def receiver (k : Kind) : Pattern Expr := match k with | .mint => varP "account" | .burn => num 0 | .transfer => varP "to"
def sender (k : Kind) : Pattern Expr := match k with | .mint => num 0 | .burn => varP "account" | .transfer => varP "from"
def forbid (n msg : String) : Pattern Stmt :=
  let bad : Pattern Stmt := ⟨.revertError (some msg), fun | .revertError (some s) => s==msg | _ => false,
    by intro x h; dsimp only at h; split at h <;> simp_all⟩
  Stmt_ifElse (ERC20.cond n) (block [bad]) Stmt_skip
def checks : Kind → List (Pattern Stmt)
  | .mint => [forbid "account" "ERC20 mint receiver must not be the zero address"]
  | .burn => [forbid "account" "ERC20 burn account must not be the zero address"]
  | .transfer => [forbid "from" "ERC20 transfer sender must not be the zero address",
    forbid "to" "ERC20 transfer receiver must not be the zero address"]
def argsBlock (k : Kind) := block [
  Stmt_varDecl addressTy (lit "_ic_arg_0") (Option_some (sender k)),
  Stmt_varDecl addressTy (lit "_ic_arg_1") (Option_some (receiver k)),
  decl "_ic_arg_2" (Option_some (wvar "value")),
  Stmt_captureReturn List_nil (Stmt_internalCall List_nil (lit updateKey) (seq [varP "_ic_arg_0",varP "_ic_arg_1",varP "_ic_arg_2"]))]
def shape (k : Kind) := block ((if k=.transfer then [Stmt_skip,Stmt_skip] else [Stmt_skip]) ++
  [param "value", block (checks k ++ [argsBlock k])])
def key : Kind → String
  | .mint => "__internal__mint(address,uint256)#[SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.uint 256]"
  | .burn => "__internal__burn(address,uint256)#[SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.uint 256]"
  | .transfer => "__internal__transfer(address,address,uint256)#[SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.address false, SolidCore.Solidity.Ty.uint 256]"
def params : Kind → List BindingDecl
  | .transfer => [⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩]
  | _ => [⟨"account",.address,false⟩,⟨"value",.uint256,false⟩]
def metaMatches (k : Kind) (f : InternalFunction) : Bool :=
  match k,f.params,f.returns with
  | .transfer,[⟨"from",.address,false⟩,⟨"to",.address,false⟩,⟨"value",.uint256,false⟩],[] => true
  | .mint,[⟨"account",.address,false⟩,⟨"value",.uint256,false⟩],[] => true
  | .burn,[⟨"account",.address,false⟩,⟨"value",.uint256,false⟩],[] => true
  | _,_,_ => false
private theorem certify (k : Kind) (o : Option InternalFunction) (test : (o.map fun f => metaMatches k f && (shape k).test f.body)=some true) :
    ∃ f, o=some f ∧ f.params=params k ∧ f.returns=[] ∧ f.body=(shape k).value := by
  cases o with
  | none => contradiction
  | some f =>
    simp only [Option.map_some,Option.some.injEq,Bool.and_eq_true] at test
    obtain ⟨metaOk,b⟩ := test
    refine ⟨f,rfl,?_,?_,(shape k).sound _ b⟩ <;> unfold metaMatches at metaOk <;> split at metaOk <;> simp_all [params]
set_option maxHeartbeats 3000000 in
theorem linked (k : Kind) : ∃ f, model.core.table.lookup? (key k)=some f ∧
    f.params=params k ∧ f.returns=[] ∧ f.body=(shape k).value := by
  apply certify
  cases k <;> native_decide
end Inv39.Motion

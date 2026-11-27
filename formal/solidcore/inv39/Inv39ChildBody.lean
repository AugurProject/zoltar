import Inv39MotionCall
import Inv39GetterBinding
import Inv39SupplyEvents
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv39.Child
abbrev Kind := SupplyEvents.Kind
def entryName : Kind → String | .mint => "mint" | .burn => "burn"
def motion : Kind → Motion.Kind | .mint => .mint | .burn => .burn
def authority : Pattern Stmt := ⟨.requireStmt (.binary .eq .caller (.immutable "zoltar")) (some "ReputationToken caller must be the Zoltar contract"),
  fun | .requireStmt (.binary .eq .caller (.immutable "zoltar")) (some "ReputationToken caller must be the Zoltar contract") => true | _ => false,
  by intro x h; dsimp only at h; split at h <;> simp_all⟩
def go (k : Kind) := block [Stmt_varDecl Motion.addressTy (lit "_ic_arg_0") (Option_some (varP "account")),
  decl "_ic_arg_1" (Option_some (wvar "valueAttoRep")),
  Stmt_captureReturn List_nil (Stmt_internalCall List_nil (lit (Motion.key (motion k))) (seq [varP "_ic_arg_0",varP "_ic_arg_1"]))]
def logged (k : Kind) : Pattern Stmt := match k with
  | .mint => ⟨.emitEvent "Mint" [.var "account",.var "valueAttoRep"],
      fun | .emitEvent "Mint" [.var "account",.var "valueAttoRep"] => true | _ => false,
      by intro x h; dsimp only at h; split at h <;> simp_all⟩
  | .burn => ⟨.emitEvent "Burn" [.var "account",.var "valueAttoRep",.storageRead .load "totalTheoreticalSupplyAttoRep" []],
      fun | .emitEvent "Burn" [.var "account",.var "valueAttoRep",.storageRead .load "totalTheoreticalSupplyAttoRep" []] => true | _ => false,
      by intro x h; dsimp only at h; split at h <;> simp_all⟩
abbrev supplyRet := "_ret_totalSupply_0"
abbrev tmp := "_sol_hoist_0"
def fetch := block [decl supplyRet Option_none,
  Stmt_captureReturn (seq [lit supplyRet]) (Stmt_internalCall (seq [lit supplyRet]) (lit "__internal_totalSupply()#[]") List_nil),
  assign tmp (varP supplyRet)]
def mintGuard := block [decl tmp Option_none,fetch,decl "#view1586" (Option_some (wvar tmp)),
  decl "#operand1587" (Option_some (wvar "valueAttoRep")),
  decl "#operand1588" (Option_some (Inv03.Bodies.clean (Inv03.Bodies.clean (Expr_binary BinaryOp_add (wvar "#view1586") (wvar "#operand1587"))))),
  decl "#operand1589" (Option_some (Inv03.Bodies.clean (Getter.ref "totalTheoreticalSupplyAttoRep"))),
  Stmt_requireStmt (Expr_binary BinaryOp_le (wvar "#operand1588") (wvar "#operand1589")) (Option_some (lit "Mint exceeds theoretical supply"))]
def cost := Stmt_exprStmt (supplyOp BinaryOp_sub theoretical.name "valueAttoRep")
def effects : Kind → Pattern Stmt
  | .mint => block [mintGuard,go .mint,logged .mint]
  | .burn => block [go .burn,cost,logged .burn]
def shape (k : Kind) := block [Stmt_skip,param "valueAttoRep",block [block [authority,Stmt_captureReturn List_nil (effects k)]]]
def metaOk (f : FunctionDef) := match f.params,f.returns with
  | [⟨"account",.address,false⟩,⟨"valueAttoRep",.uint256,false⟩],[] => true | _,_ => false
def func (k : Kind) := model.core.findFunctionByName? (entryName k)
private def test (k : Kind) := ((func k).map fun f => metaOk f && (shape k).test f.body) == some true
private theorem all : test .mint && test .burn := by native_decide
private theorem certify (k : Kind) (o : Option FunctionDef) (h : (o.map fun f => metaOk f && (shape k).test f.body)=some true) :
    ∃ f, o=some f ∧ f.params=[⟨"account",.address,false⟩,⟨"valueAttoRep",.uint256,false⟩] ∧ f.returns=[] ∧ f.body=(shape k).value := by
  cases o with
  | none => contradiction
  | some f =>
    simp only [Option.map_some,Option.some.injEq,Bool.and_eq_true] at h
    obtain ⟨m,b⟩ := h
    refine ⟨f,rfl,?_,?_,(shape k).sound _ b⟩ <;> unfold metaOk at m <;> split at m <;> simp_all
set_option maxHeartbeats 2000000 in
theorem linked (k : Kind) : ∃ f, func k=some f ∧ f.params=[⟨"account",.address,false⟩,⟨"valueAttoRep",.uint256,false⟩] ∧
    f.returns=[] ∧ f.body=(shape k).value := by
  apply certify
  have found := all
  simp only [test,Bool.and_eq_true,beq_iff_eq] at found
  cases k <;> first | exact found.1 | exact found.2
end Inv39.Child

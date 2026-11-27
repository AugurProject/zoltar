import Inv48QuoteMemoryFunding
import Inv32Shapes
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def quoteKey := "__internal__quoteReportFunding(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
def actualStatements : List Stmt :=
  match Inv48.Source.model.core.table.lookup? quoteKey with
  | some fn => match fn.body with
    | .block [_,_,_,_,.block ss] => ss
    | _ => []
  | none => []

def cleanP (e : Pattern Expr) := Expr_castOp CastKind_uintCleanup (lit 256) e
def wordP (n : Nat) := Expr_word (lit n)
def varP (s : String) := Expr_var (lit s)
def fieldP (i : Nat) := Inv08.Integral.member "quote" i

def targetP (i : Nat) : Pattern LValue where
  value := .index (.var "quote") (.word i)
  test | .index (.var n) (.word j) => n == "quote" && j == i | _ => false
  sound v h := by
    split at h <;> simp_all

def immutableP (name : String) : Pattern Expr where
  value := .immutable name
  test | .immutable n => n == name | _ => false
  sound v h := by
    split at h <;> simp_all
def writeP (i : Nat) (e : Pattern Expr) :=
  Stmt_assign (targetP i) (cleanP e)
def hoistP := Expr_castOp CastKind_uintCast (lit 256) (varP "_sol_hoist_0")
def collateralWrite := (writeP 0 (varP "requestedInitialAttoWeth")).value
def repWrite := (writeP 1 hoistP).value
def haltWrite := (writeP 2 hoistP).value
def settlementWrite := (writeP 4 hoistP).value


def exposureP := writeP 3 (cleanP (Expr_binary BinaryOp_mul
  (cleanP (cleanP (Expr_binary BinaryOp_sub (cleanP (fieldP 0))
    (cleanP (immutableP "minimumReportCollateral")))))
  (Expr_ternary (wordP 1) (wordP 100) (wordP 100))))
def exposureWrite := exposureP.value

def enumP (size : Nat) (p : Pattern Expr) : Pattern Expr where
  value := .enumFromUInt size p.value
  test | .enumFromUInt n e => n == size && p.test e | _ => false
  sound v h := by
    split at h
    next n e =>
      simp only [Bool.and_eq_true,beq_iff_eq] at h
      have E := p.sound e h.2
      simp [h.1,E]
    next => contradiction

def ceilPattern : Pattern Stmt := Stmt_block (seq [
  Stmt_varDecl Ty_uint256 (lit "_ic_arg_0") (Option_some (cleanP (fieldP 0))),
  Stmt_varDecl Ty_uint256 (lit "_ic_arg_1") (Option_some (cleanP (varP "proposedRepPerEthPrice"))),
  Stmt_varDecl Ty_uint256 (lit "_ic_arg_2") (Option_some (Expr_ternary (wordP 1) (wordP (10^18)) (wordP (10^18)))),
  Stmt_varDecl Ty_uint256 (lit "_ic_arg_3") (Option_some (enumP 3 (cleanP (wordP 1)))),
  Stmt_varDecl Ty_uint256 (lit Inv32CeilHoist.dest) Option_none,
  Stmt_captureReturn (lit [Inv32CeilHoist.dest])
    (Stmt_internalCall (lit [Inv32CeilHoist.dest]) (lit Inv32Bodies.Ceil.key)
      (seq [varP "_ic_arg_0",varP "_ic_arg_1",varP "_ic_arg_2",varP "_ic_arg_3"])),
  Stmt_assign (LValue_var (lit "_sol_hoist_0")) (varP Inv32CeilHoist.dest)])

def fundingPattern : Pattern (List Stmt) := seq [
  Stmt_varDecl Ty_uint256 (lit "_sol_hoist_0") Option_none,
  ceilPattern,writeP 1 hoistP]

def checks (ss : List Stmt) : Bool :=
  fundingPattern.test (ss.drop 2 |>.take 3) &&
  (Option_some (writeP 0 (varP "requestedInitialAttoWeth"))).test ss[1]? &&
  (Option_some (writeP 1 hoistP)).test ss[4]? &&
  (Option_some (writeP 2 hoistP)).test ss[7]? &&
  (Option_some (writeP 4 hoistP)).test ss[22]? &&
  (Option_some exposureP).test ss[19]?

theorem certified : checks actualStatements = true := by native_decide

theorem actualCollateral : actualStatements[1]? = some collateralWrite := by
  have h := certified
  simp only [checks,Bool.and_eq_true] at h
  exact (Option_some (writeP 0 (varP "requestedInitialAttoWeth"))).sound _ h.1.1.1.1.2
theorem actualRep : actualStatements[4]? = some repWrite := by
  have h := certified
  simp only [checks,Bool.and_eq_true] at h
  exact (Option_some (writeP 1 hoistP)).sound _ h.1.1.1.2
theorem actualHalt : actualStatements[7]? = some haltWrite := by
  have h := certified
  simp only [checks,Bool.and_eq_true] at h
  exact (Option_some (writeP 2 hoistP)).sound _ h.1.1.2
theorem actualSettlement : actualStatements[22]? = some settlementWrite := by
  have h := certified
  simp only [checks,Bool.and_eq_true] at h
  exact (Option_some (writeP 4 hoistP)).sound _ h.1.2
theorem actualExposure : actualStatements[19]? = some exposureWrite := by
  have h := certified
  simp only [checks,Bool.and_eq_true] at h
  exact (Option_some exposureP).sound _ h.2

theorem actualFunding : (actualStatements.drop 2).take 3 = fundingCode := by
  have h := certified
  simp only [checks,Bool.and_eq_true] at h
  exact fundingPattern.sound _ h.1.1.1.1.1

#print axioms actualFunding

#print axioms actualCollateral
#print axioms actualRep
#print axioms actualHalt
#print axioms actualSettlement
#print axioms actualExposure
end Inv48.QuoteMemory

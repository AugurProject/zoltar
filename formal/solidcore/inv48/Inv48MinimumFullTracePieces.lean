import Inv48MinimumFullTraceHoist
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumFullTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- This checks the retained generated statements and follows registered math
bodies recursively. Helper oracle calls are deliberately absent from these pieces. -/
def pureCertificate : Bool :=
  (Inv48.MinimumSuffixPath.prologue.all (stmtSafe 100 Inv48.Source.model.core.table)) &&
  (Inv48.MinimumSuffixPath.guardPrefix.all (stmtSafe 100 Inv48.Source.model.core.table)) &&
  (Inv48.MinimumSuffixPath.suffix.all (stmtSafe 100 Inv48.Source.model.core.table))

theorem pureCertificateChecked : pureCertificate = true := by native_decide

theorem prologueSafe : Inv48.MinimumSuffixPath.prologue.all (stmtSafe 100 Inv48.Source.model.core.table) = true := by
  have h := pureCertificateChecked
  simp only [pureCertificate,Bool.and_eq_true] at h
  exact h.1.1

theorem guardSafe : Inv48.MinimumSuffixPath.guardPrefix.all (stmtSafe 100 Inv48.Source.model.core.table) = true := by
  have h := pureCertificateChecked
  simp only [pureCertificate,Bool.and_eq_true] at h
  exact h.1.2

theorem suffixSafe : Inv48.MinimumSuffixPath.suffix.all (stmtSafe 100 Inv48.Source.model.core.table) = true := by
  have h := pureCertificateChecked
  simp only [pureCertificate,Bool.and_eq_true] at h
  exact h.2
end Inv48.MinimumFullTrace

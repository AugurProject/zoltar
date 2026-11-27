import Inv48ChildExtractionTransfer
import Inv48MinimaCanonical
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowDecode
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def signature := "createReportEscrow(address,address,uint256,uint256,uint256,uint256,uint32)"
theorem selectorSignature : ABI.selectorFromSignature signature = 2391489481 := by native_decide

def cleanupTest : List AbiCleanup → Bool
  | [.none, .none, .uint 256, .uint 256, .uint 256, .uint 256, .uint 32] => true
  | _ => false

theorem cleanupCertificate :
    (Inv48.Source.model.core.findFunctionByName? "createReportEscrow").any
      (fun f => cleanupTest f.paramAbiCleanups) = true := by native_decide

theorem cleanupSound (cs : List AbiCleanup) (h : cleanupTest cs = true) :
    cs = [.none, .none, .uint 256, .uint 256, .uint 256, .uint 256, .uint 32] := by
  unfold cleanupTest at h
  split at h
  · rfl
  · contradiction

theorem cleanups : Inv48.EscrowEntry.fn.paramAbiCleanups =
    [.none, .none, .uint 256, .uint 256, .uint 256, .uint 256, .uint 32] := by
  have h := cleanupCertificate
  rw [Inv48.EscrowEntry.found] at h
  simp only [Option.any_some] at h
  exact cleanupSound _ h

#print axioms selectorSignature
#print axioms cleanups
end Inv48.EscrowDecode

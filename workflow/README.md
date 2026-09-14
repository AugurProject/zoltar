Workflow changes awaiting application
====================================

Move the eight YAML files in this directory into `.github/workflows/`, replacing their existing versions. Delete `.github/workflows/augur-scan.yml`: its jobs are covered by the component workflow. Then remove this README and the empty `workflow/` directory.

These files are staged here because the publishing credential cannot modify GitHub workflow files. Until they are moved, the active workflows are the versions from main and are not compatible with every workspace/build change in this PR.


import contextlib
import json
import logging
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional

# Configure logging from environment variable
LOG_LEVEL_ENV_VAR = "GITO_HANDLE_MENTIONS_LOG_LEVEL"
log_level = os.getenv(LOG_LEVEL_ENV_VAR, "INFO").upper()
logging.basicConfig(
	level=getattr(logging, log_level, logging.INFO),
	format='%(levelname)s: %(message)s',
	force=True
)
logger = logging.getLogger(__name__)

AGENT_CONFIGS_DIR = pathlib.Path(".github/gito-agents")
GITO_WORKING_DIR = pathlib.Path(".gito")
REVIEW_TRIGGER_PATTERN = re.compile(r'(?:^|\s)/(?:review|code-review)\b|\b(?:review|code-review)\b')
FIX_REQUEST_PATTERN = re.compile(r"fix\b", re.IGNORECASE)


@dataclass
class AgentConfig:
	name: str
	triggers: List[str]
	path: pathlib.Path


def get_review_dir(agent_name: str) -> pathlib.Path:
	return pathlib.Path(f"./review-{agent_name}")


def get_report_path(agent_name: str) -> pathlib.Path:
	return get_review_dir(agent_name) / "code-review-report.md"


def is_review_request(text: str) -> bool:
	text = text.lower().strip()
	return REVIEW_TRIGGER_PATTERN.search(text) is not None


def load_agent_configs() -> List[AgentConfig]:
	if not AGENT_CONFIGS_DIR.exists():
		logger.warning(f"Agent configs directory {AGENT_CONFIGS_DIR} does not exist")
		return []

	agents = []
	for toml_path in AGENT_CONFIGS_DIR.glob("*.toml"):
		try:
			with open(toml_path, "rb") as f:
				config = tomllib.load(f)

			triggers = config.get("mention_triggers", [])
			valid_triggers = []

			for trigger in triggers:
				if not trigger or not trigger.strip():
					logger.warning(f"Agent '{toml_path.stem}' has empty/whitespace trigger, ignoring: {repr(trigger)}")
					continue

				normalized = trigger.strip()
				valid_triggers.append(normalized)

			if not valid_triggers:
				logger.warning(f"Agent '{toml_path.stem}' has no valid mention_triggers, skipping")
				continue

			agents.append(AgentConfig(
				name=toml_path.stem,
				triggers=valid_triggers,
				path=toml_path
			))
		except Exception as e:
			logger.warning(f"Failed to load agent config {toml_path}: {e}")

	return agents


def parse_and_validate_environment() -> Tuple[int, str]:
	pr_number = os.getenv("PR_NUMBER")
	if not pr_number:
		raise ValueError("PR_NUMBER environment variable not set")

	try:
		pr_number = int(pr_number)
	except ValueError:
		raise ValueError(f"Invalid PR_NUMBER: {pr_number}")

	event_path = os.getenv("GITHUB_EVENT_PATH")
	if not event_path or not os.path.exists(event_path):
		raise ValueError("GITHUB_EVENT_PATH not set or file missing")

	return pr_number, event_path


def load_event_payload(event_path: str) -> Dict:
	with open(event_path, "r", encoding="utf-8") as f:
		return json.load(f)


def extract_comment_body(event: Dict) -> str:
	try:
		return event["comment"]["body"]
	except KeyError:
		raise ValueError("Could not extract comment body from event payload - missing 'comment.body' key")


def find_triggered_agents(comment_body: str, agent_configs: List[AgentConfig]) -> List[AgentConfig]:
	triggered_agents = []
	for agent in agent_configs:
		for trigger in agent.triggers:
			if not trigger or not trigger.strip():
				logger.warning(f"Agent '{agent.name}' encountered empty trigger, skipping")
				continue

			pattern = r"@" + re.escape(trigger) + r"\b"
			if re.search(pattern, comment_body, re.IGNORECASE):
				triggered_agents.append(agent)
				break

	return triggered_agents


def run_gito_command(args: List[str], capture_output: bool = False) -> subprocess.CompletedProcess:
	full_command = ["gito"] + args
	result = subprocess.run(
		full_command,
		capture_output=capture_output,
		text=True,
	)
	return result


def require_success(result: subprocess.CompletedProcess, agent_name: str, operation: str) -> None:
	if result.returncode != 0:
		logger.error(f"{agent_name}: {operation} failed with exit code {result.returncode}")
		if result.stderr:
			logger.error(result.stderr)
		raise RuntimeError(f"{agent_name}: {operation} failed")

def post_github_comment(agent_name: str, content: str, pr_number: int) -> None:
	with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as tmp:
		tmp.write(content)
		temporary_markdown_file_path = tmp.name

	try:
		subprocess_result = run_gito_command(
			["github-comment", "--md-report-file", temporary_markdown_file_path, "--pr", str(pr_number)],
			capture_output=True
		)
		require_success(subprocess_result, agent_name, "github-comment")
	finally:
		with contextlib.suppress(OSError):
			os.unlink(temporary_markdown_file_path)


def setup_agent_working_dir(agent: AgentConfig) -> None:
	GITO_WORKING_DIR.mkdir(parents=True, exist_ok=True)
	shutil.copyfile(agent.path, GITO_WORKING_DIR / "config.toml")


def collapse_previous_reviews(agent_name: str, pr_number: int) -> None:
	env = os.environ.copy()
	env["PR_NUMBER"] = str(pr_number)
	env["AGENT_NAME"] = agent_name

	subprocess_result = subprocess.run(
		[sys.executable, ".github/scripts/collapse_agent_reviews.py"],
		env=env,
		capture_output=True,
		text=True,
	)
	require_success(subprocess_result, agent_name, "collapse script")


def process_review_request(agent: AgentConfig, pr_number: int) -> None:
	agent_name = agent.name
	logger.info(f"{agent_name}: Triggering code review...")

	review_dir = get_review_dir(agent_name)
	subprocess_result = run_gito_command(
		["review", "--out", str(review_dir), "--pr", str(pr_number)],
		capture_output=True
	)
	require_success(subprocess_result, agent_name, "review command")

	logger.info(f"{agent_name}: Collapsing previous reviews...")
	collapse_previous_reviews(agent_name, pr_number)

	logger.info(f"{agent_name}: Posting review comment...")
	report_path = get_report_path(agent_name)
	if not report_path.exists():
		raise FileNotFoundError(f"{agent_name}: Review report not found at {report_path}")

	subprocess_result = run_gito_command(
		["github-comment", "--md-report-file", str(report_path), "--pr", str(pr_number)],
		capture_output=True
	)
	require_success(subprocess_result, agent_name, "github-comment")

	logger.info(f"{agent_name}: Review posted.")


def process_question(agent: AgentConfig, pr_number: int, comment_body: str) -> None:
	agent_name = agent.name
	# Normalize whitespace and strip
	question = re.sub(r"\s+", " ", comment_body).strip()
	if not question:
		logger.info(f"{agent_name}: Could not extract a question after cleanup. Skipping.")
		return

	logger.info(f"{agent_name}: Asking: {question}")

	subprocess_result = run_gito_command(
		["ask", question, "--pr", str(pr_number)],
		capture_output=True
	)
	require_success(subprocess_result, agent_name, "ask command")

	answer_text = subprocess_result.stdout.strip()
	if not answer_text:
		logger.info(f"{agent_name}: Empty answer received, skipping.")
		return

	prefix = f"**{agent_name.capitalize()}:** "
	full_comment = prefix + answer_text

	post_github_comment(agent_name, full_comment, pr_number)

	logger.info(f"{agent_name}: Answer posted.")


def process_agent(agent: AgentConfig, pr_number: int, comment_body: str) -> bool:
	agent_name = agent.name
	logger.info(f"\n=== Processing agent: {agent_name} ===")

	try:
		setup_agent_working_dir(agent)

		body = comment_body.strip()

		if FIX_REQUEST_PATTERN.search(body):
			logger.info(f"{agent_name}: Fix requests are not supported via mentions yet. Skipping.")
			return True

		if is_review_request(body):
			process_review_request(agent, pr_number)
			return True

		process_question(agent, pr_number, comment_body)
		return True

	except Exception as e:
		logger.error(f"Error processing agent {agent_name}: {e}")
		return False


def main() -> None:
	try:
		pr_number, event_path = parse_and_validate_environment()

		event = load_event_payload(event_path)
		comment_body = extract_comment_body(event)
	except ValueError as e:
		logger.error(str(e))
		sys.exit(1)

	agent_configs = load_agent_configs()
	triggered_agents = find_triggered_agents(comment_body, agent_configs)

	if not triggered_agents:
		logger.info("No agents triggered by this comment")
		sys.exit(0)

	any_failed = False
	for agent in triggered_agents:
		success = process_agent(agent, pr_number, comment_body)
		if not success:
			any_failed = True

	if any_failed:
		sys.exit(1)
	else:
		sys.exit(0)


if __name__ == "__main__":
	main()

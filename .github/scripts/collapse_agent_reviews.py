"""
Selectively collapse previous reviews from the same agent only.
"""

import os
import re
import subprocess
import sys
from typing import Optional

import requests

_COLLAPSED_HEADER = "<details>\n<summary>🗑️ Outdated Code Review by Gito</summary>"
_TIMEOUT = 30


def get_agent_header_from_report(report_path: str) -> Optional[str]:
	try:
		with open(report_path, "r", encoding="utf-8") as f:
			for line in f:
				line = line.strip()
				if line.startswith("## "):
					return line
		return None
	except FileNotFoundError:
		print(f"Report file not found: {report_path}", file=sys.stderr)
		return None
	except Exception as e:
		print(f"Error reading report: {e}", file=sys.stderr)
		return None


def get_repository_from_env_or_git() -> Optional[str]:
	repo = os.getenv("GITHUB_REPOSITORY")
	if repo:
		return repo
	# Try git remote
	try:
		result = subprocess.run(
			["git", "config", "--get", "remote.origin.url"],
			capture_output=True, text=True
		)
		url = result.stdout.strip()
		# Extract owner/repo from HTTPS or SSH URL
		m = re.search(r"github\.com[/:]([^/]+/[^/]+?)(?:\.git)?/?$", url)
		if m:
			return m.group(1)
	except Exception as e:
		print(f"Error getting repository from git: {e}", file=sys.stderr)
	return None


def has_gito_marker(comment_body: str) -> bool:
	return "<!-- GITO_CR -->" in comment_body


def has_agent_header(comment_body: str, agent_header: str) -> bool:
	return agent_header in comment_body


def is_already_collapsed(comment_body: str) -> bool:
	stripped = comment_body.lstrip()
	return stripped.startswith(_COLLAPSED_HEADER)


def build_collapsed_body(original_body: str) -> str:
	return f"{_COLLAPSED_HEADER}\n\n{original_body}\n</details>"


def get_next_page_url(link_header: str) -> Optional[str]:
	if not link_header:
		return None
	for link in link_header.split(","):
		if 'rel="next"' in link:
			match = re.search(r'<([^>]+)>', link)
			if match:
				return match.group(1)
	return None


def is_target_comment(comment_body: str, agent_header: str) -> bool:
	return has_gito_marker(comment_body) and has_agent_header(comment_body, agent_header)


def minimize_comment(node_id: str, token: str) -> bool:
	try:
		graphql_url = "https://api.github.com/graphql"
		graphql_headers = {"Authorization": f"bearer {token}"}
		query = """mutation($oid: ID!) { minimizeComment(input: {subjectId: $oid, classifier: OUTDATED}) { clientMutationId } }"""
		variables = {"oid": node_id}
		resp = requests.post(graphql_url, json={"query": query, "variables": variables}, headers=graphql_headers, timeout=_TIMEOUT)

		if resp.status_code != 200:
			print(f"Failed to minimize comment {node_id}: {resp.status_code} {resp.text}", file=sys.stderr)
			return False

		result = resp.json()
		if "errors" in result:
			print(f"GraphQL errors minimizing comment {node_id}: {result['errors']}", file=sys.stderr)
			return False

		return True
	except Exception as e:
		print(f"Error minimizing comment {node_id}: {e}", file=sys.stderr)
		return False


def collapse_comment(comment: dict, owner: str, repo: str, token: str) -> bool:
	try:
		comment_id = comment["id"]
		update_url = f"https://api.github.com/repos/{owner}/{repo}/issues/comments/{comment_id}"
		new_body = build_collapsed_body(comment.get("body", ""))
		resp = requests.patch(update_url, headers={"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}, json={"body": new_body}, timeout=_TIMEOUT)
		if resp.status_code == 200:
			return minimize_comment(comment["node_id"], token)
		print(f"Failed to collapse comment {comment_id}: {resp.status_code} {resp.text}", file=sys.stderr)
	except Exception as e:
		print(f"Error updating comment {comment.get('id')}: {e}", file=sys.stderr)
	return False


def fetch_comments_page(url: str, headers: dict) -> tuple[Optional[list[dict]], Optional[str]]:
	try:
		resp = requests.get(url, headers=headers, timeout=_TIMEOUT)
		if resp.status_code != 200:
			print(f"Failed to fetch comments: {resp.status_code} {resp.text}", file=sys.stderr)
			return None, None
		comments = resp.json()
		next_url = get_next_page_url(resp.headers.get("Link", ""))
		return comments, next_url
	except Exception as e:
		print(f"Failed to fetch comments: {e}", file=sys.stderr)
		return None, None


def fetch_all_comments(owner: str, repo: str, pr_number: int, token: str) -> list[dict]:
	url = f"https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments"
	headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}

	all_comments = []
	while url:
		comments, next_url = fetch_comments_page(url, headers)
		if comments is None:
			break
		all_comments.extend(comments)
		url = next_url

	return all_comments


def collapse_previous_reviews(owner: str, repo: str, pr_number: int, agent_header: str, token: str) -> int:
	collapsed = 0
	all_comments = fetch_all_comments(owner, repo, pr_number, token)

	for comment in all_comments:
		body = comment.get("body") or ""
		if not is_target_comment(body, agent_header):
			continue
		if is_already_collapsed(body):
			continue
		if collapse_comment(comment, owner, repo, token):
			collapsed += 1

	return collapsed


def main():
	pr_number = os.getenv("PR_NUMBER")
	if not pr_number:
		print("PR_NUMBER environment variable not set", file=sys.stderr)
		sys.exit(1)
	try:
		pr_number = int(pr_number)
	except ValueError:
		print(f"Invalid PR_NUMBER: {pr_number}", file=sys.stderr)
		sys.exit(1)

	agent_name = os.getenv("AGENT_NAME")
	if not agent_name:
		print("AGENT_NAME environment variable not set", file=sys.stderr)
		sys.exit(1)

	report_path = f"./review-{agent_name}/code-review-report.md"
	header = get_agent_header_from_report(report_path)
	if not header:
		print(f"Could not determine agent header from {report_path}", file=sys.stderr)
		sys.exit(1)

	gh_token = os.getenv("GITHUB_TOKEN")
	if not gh_token:
		print("GITHUB_TOKEN environment variable not set", file=sys.stderr)
		sys.exit(1)

	repo = get_repository_from_env_or_git()
	if not repo:
		print("Could not determine GitHub repository (set GITHUB_REPOSITORY)", file=sys.stderr)
		sys.exit(1)

	try:
		owner, repo_name = repo.split("/", 1)
	except ValueError:
		print(f"Invalid repository format: {repo}", file=sys.stderr)
		sys.exit(1)

	collapsed = collapse_previous_reviews(owner, repo_name, pr_number, header, gh_token)
	print(f"Collapsed {collapsed} previous {agent_name} review(s).")
	sys.exit(0)


if __name__ == "__main__":
	main()
